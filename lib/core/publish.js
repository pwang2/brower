'use strict';

var _ = require('underscore'),
    path = require('path'),
    j = path.join,
    Promise = require('bluebird'),
    parseDeps = require('../util/parseDeps.js'),
    pmt = require('../util/prompt.js');

var fs = Promise.promisifyAll(require('fs-extra')),
    writeFile = fs.writeFileAsync,
    cp = require('child_process'),
    exec = Promise.promisify(cp.exec),
    tmp = Promise.promisifyAll(require('tmp')),
    extend = require('extend');

var //cdnPrefix = process.env.CDN_PREFIX || 'http://127.0.0.1/static/',
    cdnpath = process.env.CDN_PHYSICAL_PATH || './cdn',
    staticDir = j(cdnpath, 'static'),
    metaDir = j(cdnpath, 'meta'),
    templateBowerJson = './templates/bower.json',
    templateBowerrc = './templates/.bowerrc' || process.env.BOWERRC,
    logger;

var processMainFiles = require('../bower/processMainFiles.js'),
    isWin = /^win.*/.test(process.platform),
    bowerBin = j(process.cwd(), 'node_modules/.bin/bower') + (isWin ? '.cmd' : '');

var format = function(obj) {
    return JSON.stringify(obj, null, 4);
};

var createTempDir = function() {
    return tmp.dirAsync()
        .then(function(name) {
            logger.log('tempdir', name);
            return {
                tmpdirname: name,
                targetBowerrc: path.resolve(name, '.bowerrc'),
                targetBowerJson: path.resolve(name, 'bower.json'),
                targetBowerMeta: path.resolve(name, 'bowerlist.json')
            };
        });
};

var prepareInstall = function(deps, files) {
    return fs.readJsonAsync(templateBowerJson)
        .then(function(bowerObj) {
            bowerObj.dependencies = deps;
            return Promise.all([
                fs.writeJsonAsync(files.targetBowerJson, bowerObj),
                fs.copyAsync(templateBowerrc, files.targetBowerrc)
            ]);
        });
};

var getAggMeta = function(config, files) {
    var installCmdline = bowerBin + ' install -p  --config.interactive=false --allow-root ',
        listCmdline = bowerBin + ' list --offline --json --allow-root >' + files.targetBowerMeta,
        options = {
            cwd: files.tmpdirname,
            timeout: 120000
        };
    if (!config.verbose) {
        installCmdline += ' --silent';
    }
    if (config.offline) {
        installCmdline += ' --offline';
    }

    logger.log('start bower install with %s', installCmdline);
    return exec(installCmdline, options)
        .then(function(data) {
            console.log(data);
            return exec(listCmdline, options);
        });
};

var generateMetas = function(metaObj, failedDeps, logger) {
    var promises = [];
    var flatDep = parseDeps.flatDependencies(metaObj, logger, true);
    _.each(flatDep, function(item) {
        var meta = item.pkgMeta;
        logger.banner(meta.name + '#' + meta.version);
        var distMeta = j(metaDir, meta.name, meta.version);

        var p = fs.ensureDirAsync(distMeta)
            .then(function() {
                var metaFile = j(distMeta, 'meta.json'),
                    regNameFile = j(metaDir, meta.name, 'regname.txt');
                return Promise.all([
                    writeFile(metaFile, format(item)),
                    writeFile(regNameFile, item.regName)
                ]);
            })
            .catch(function(e) {
                Object.defineProperty(e, "message", {
                    enumerable: true
                });
                try {
                    fs.removeSync(distMeta);
                    fs.removeSync(j(staticDir, meta.name, meta.version));
                } catch (e) {
                    logger.log('mute permission error on deleting');
                }
                failedDeps.push({
                    name: meta.name,
                    version: meta.version,
                    error: e
                });
            });
        promises.push(p);
    });
    return Promise.all(promises);
};

var cleanup = function(tmpdirname) {
    logger.log('removing tmp dir', tmpdirname);
    fs.removeSync(tmpdirname);
};

var checkExist = function(input) {
    var promises = [];
    _.each(input, function(version, name) {
        var p = fs.statAsync(j(metaDir, name, version))
            .then(function() {
                return {
                    exists: true,
                    name: name,
                    version: version
                };
            })
            .catch(function() {
                return {
                    exists: false,
                    name: name,
                    version: version
                };
            });
        promises.push(p);
    });

    return Promise.all(promises)
        .spread(function() {
            var exists = {},
                args = [].slice.call(arguments, 0);

            _.each(args, function(n) {
                if (n.exists) {
                    var obj = {};
                    obj[n.name] = n.version;
                    _.extend(exists, obj);
                }
            });

            if (_.isEmpty(exists)) {
                return [];
            } else {
                var inputLen = Object.keys(input).length;
                var existsLen = Object.keys(exists).length;
                if (inputLen === existsLen) {
                    return Promise.reject({
                        statuscode: 999,
                        deps: input,
                        existed: exists,
                        message: 'All components are already existed'
                    });
                }
                return exists;
            }
        });
};

var narrowDown = function(deps, exists) {
    var org = extend(true, {}, deps);
    var existAsArray = [];

    _.each(exists, function(v, k) {
        existAsArray.push(k + '#' + v);
    });

    _.mapObject(deps, function(v, k) {
        var identity = k + '#' + v;
        if (existAsArray.indexOf(identity) > -1) {
            delete org[k];
        }
    });
    return org;
};

//publish mode: publish dependencey file and meta from bower to cdn
var publish = function(deps, config) {
    logger = pmt.config(config);

    return checkExist(deps)
        .bind({}) //see http://bluebirdjs.com/docs/api/promise.bind.html
        .then(function(existsRecord) {
            logger.log('1. checking installed packages');
            this.exists = existsRecord;
            this.processed = narrowDown(deps, this.exists);
            return this;
        })
        .then(function() {
            logger.log('2. creating tmpfolder and bower meta files');
            return createTempDir();
        })
        .then(function(bowerFiles) {
            this.files = bowerFiles;
            logger.log('3. preparing bower.json/.bowerrc for bower instal');
            return prepareInstall(this.processed, this.files);
        })
        .then(function() {
            logger.log('4. getting aggregated meta file for dependencies extracting');
            //pipe meta json to targetBowerMeta file.
            return getAggMeta(config, this.files);
        })
        .then(function() {
            logger.log('5. get meta object for processing');
            return fs.readJsonAsync(this.files.targetBowerMeta)
                .then(function(metaObj) {
                    return metaObj;
                });
        })
        .then(function(metaObj) {
            //failedDeps as an array coz we want to target error per package
            this.failedDeps = [];
            this.metaObj = metaObj;
            logger.log('6. copying static files ');
            return processMainFiles(metaObj, this.failedDeps, logger);
        })
        .then(function() {
            logger.log('7. save meta file for quick resolve');
            return generateMetas(this.metaObj, this.failedDeps, logger);
        })
        .then(function() {
            logger.log('8. logging out failed processing');
            if (this.failedDeps.length > 0) {
                this.failedDeps = _.unique(this.failedDeps, function(n) {
                    return n.name + '#' + n.version;
                });
                logger.warn(['Following components failed, try publish again!',
                    format(this.failedDeps)
                ].join('\n'));
            }
        })
        .then(function() {
            logger.log('9. return install result');
            var message = [
                'Components requested have been published, ',
                'If failed list is not empty, try again with the failed ones. '
            ].join('');

            var failed = {}; //failedDeps is an array, need to convert back to Object
            _.each(this.failedDeps, function(n) {
                failed[n.name] = n.version;
            });
            return {
                message: message,
                deps: deps,
                installed: narrowDown(this.processed, failed),
                existed: this.exists,
                failed: this.failedDeps
            };
        })
        .then(function(response) {
            logger.log('10. clean tempfolder and return response (to web request)');
            cleanup(this.files.tmpdirname);
            return response;
        })
        .catch(function(e) {
            if (e.statuscode === 999) { //all exists
                return e;
            }
            var message = [
                'Published failed! see error for detail. ',
                'Make sure components registered with ',
                'either public bower or enterprise private bower.'
            ].join('');
            //enumerable:false will NOT be serilized to json
            Object.defineProperty(e, "message", {
                enumerable: true
            });
            Object.defineProperty(e, "stack", {
                enumerable: true
            });
            var response = {
                message: message,
                deps: deps,
                error: e
            };
            logger.warn(format(response));
            return response;
        });
};

module.exports = publish;
