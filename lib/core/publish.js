'use strict';

var _ = require('underscore'),
    path = require('path'),
    Promise = require('bluebird');

var fs = Promise.promisifyAll(require('fs-extra')),
    writeFile = Promise.promisify(fs.writeFile),
    exec = Promise.promisify(require('child_process').exec),
    tmp = Promise.promisifyAll(require('tmp')),
    extend = require('extend'),
    pmt = require('../prompt.js');

var failedDeps = [],
    logger;

var staticDir = './cdn/static/',
    metaDir = './cdn/meta/',
    cdnPrefix = process.env.CDN_PREFIX || 'http://127.0.0.1/static/', //SSL always
    templateBowerJson = './templates/bower.json',
    templateBowerrc = './templates/.bowerrc',
    tmpdirname,
    targetBowerJson,
    targetBowerrc,
    targetBowerMeta;

var processDeps = require('../processDeps.js'),
    uniqer = processDeps.uniqer,
    reducer = processDeps.reducer,
    stackDeps = processDeps.stackDeps;

var createTempDir = function() {
    return tmp.dirAsync()
        .then(function(name) {
            tmpdirname = name;
            targetBowerJson = path.resolve(tmpdirname, 'bower.json');
            targetBowerrc = path.resolve(tmpdirname, '.bowerrc');
            targetBowerMeta = path.resolve(tmpdirname, 'bowerlist.json');
        });
};

var prepareInstall = function(deps) {
    return fs.readJsonAsync(templateBowerJson)
        .then(function(bowerObj) {
            bowerObj.dependencies = deps;
            return Promise.all([
                fs.writeJsonAsync(targetBowerJson, bowerObj),
                fs.copyAsync(templateBowerrc, targetBowerrc)
            ]);
        });
};

var getAggMeta = function(config) {
    var installCmdline = 'bower install -p  --config.interactive=false ',
        listCmdline = 'bower list --offline --json >' + targetBowerMeta,
        options = {
            cwd: tmpdirname
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
            logger.log(data);
            return exec(listCmdline, options);
        });
};

var datamining = function() {
    var input = path.resolve(tmpdirname, targetBowerMeta);
    return fs.readJsonAsync(input)
        .then(function(obj) {
            var layerArray = stackDeps(obj, false, logger);
            var flatDep = _.chain(layerArray)
                .reduceRight(reducer, [])
                .uniq(uniqer)
                .splice(-1, 1)
                ._wrapped;
            return flatDep;
        });
};

var copyFiles = function(flatDep) {
    var copyFolderPromise = function(item) {
        var distDir = staticDir + item.pkgMeta.name + '/' + item.pkgMeta.version + '/',
            srcDir = item.canonicalDir;

        var copyAllFilePromise = function() {
            var copyPromises = _.map(item.pkgMeta.main, function(f) {
                var srcFile = path.resolve(srcDir, f);
                return fs.copyAsync(srcFile, distDir + f);
            });
            return Promise.all(copyPromises);
        };

        return fs.ensureDirAsync(distDir)
            .then(copyAllFilePromise)
            .error(function(e) {
                //TODO:how to simulate this
                fs.removeAsync(distDir);
                fs.removeAsync(metaDir + item.pkgMeta.name + '/' + item.pkgMeta.version);
                failedDeps.push({
                    name: item.pkgMeta.name,
                    version: item.pkgMeta.version,
                    error: e
                });
            });
    };

    var copyAllItemPromises = _.map(flatDep, copyFolderPromise);

    return Promise.all(copyAllItemPromises);
};

//generate meta file for quick resolution from browser request
var generateMetas = function(flatDep) {
    Promise.all(
        _.each(flatDep, function(item) {
            logger.banner(item.pkgMeta.name + '#' + item.pkgMeta.version);

            var distMeta = metaDir + item.pkgMeta.name + '/' + item.pkgMeta.version;
            var urlPath = cdnPrefix + item.pkgMeta.name + '/' + item.pkgMeta.version;
            var flatLayerArray = stackDeps(item, true, logger);
            var result = _.chain(flatLayerArray)
                .reduceRight(reducer, [])
                .uniq(uniqer)
                .map(function(n) {
                    return n.pkgMeta.main.map(function(item) {
                        return urlPath + '/' + item;
                    });
                })
                .reduce(reducer, [])
                ._wrapped;

            var obj = {
                id: item.pkgMeta.name + '#' + item.pkgMeta.version,
                deps: result
            };
            var fileContent = JSON.stringify(obj, null, 4);
            var metaContent = JSON.stringify(item, null, 4);

            return fs.ensureDirAsync(distMeta)
                .then(function() {
                    return Promise.all([
                        writeFile(distMeta + '/index.js', ';quikr.s(' + fileContent + ');'),
                        writeFile(distMeta + '/meta.json', metaContent)
                    ]);
                })
                .error(function(e) {
                    fs.removeAsync(distMeta);
                    fs.removeAsync(staticDir + item.pkgMeta.name + '/' + item.pkgMeta.version);
                    failedDeps.push({
                        name: item.pkgMeta.name,
                        version: item.pkgMeta.version,
                        error: e
                    });
                });
        }));
};

var cleanup = function() {
    logger.log('removing tmp dir', tmpdirname);
    fs.removeSync(tmpdirname);
};

var checkExist = function(input) {
    var promises = [];
    _.each(input, function(v, k) {
        var p = fs.statAsync(metaDir + k + '/' + v)
            .then(function() {
                var missing = {};
                missing[k] = v;
                return missing;
            })
            .catch(function() { //component to be published
                return false;
            });
        promises.push(p);
    });
    return Promise.all(promises)
        .spread(function() {
            var exists = {},
                args = [].slice.call(arguments, 0);
            _.each(args, function(n) {
                if (n) {
                    _.extend(exists, n);
                }
            });
            if (_.isEmpty(exists) === false) {
                return exists;
            } else {
                return true;
            }
        });
};

var narrowDownWithExists = function(deps, exists) {
    if (Object.keys(deps).length === Object.keys(exists).length) {
        return Promise.reject({
            errorno: 999,
            dep: deps,
            message: 'All components request to publish already existed'
        });
    }
    var existAsArray = [];

    _.each(exists, function(v, k) {
        existAsArray.push(k + '#' + v);
    });

    _.mapObject(deps, function(v, k) {
        var identity = k + '#' + v;
        if (existAsArray.indexOf(identity) > -1) {
            //narrow down deps to publish by modifying object itself
            delete deps[k];
        }
    });
    return deps;
};

//publish mode: publish dependencey file and meta from bower to cdn
var publish = function(deps, config) {
    logger = pmt.config(config);
    var exists = {}; //use to relay the existing to the end.
    var depsOriginal = extend(true, {}, deps);
    return checkExist(deps)
        .then(function(existsRecord) {
            if (typeof existsRecord === 'object') {
                exists = existsRecord; //use this as a simple relay
                //if all existed, will reject from here
                deps = narrowDownWithExists(deps, exists);
                return deps;
            }
            return true;
        })
        .then(createTempDir)
        .then(function() {
            return prepareInstall(deps);
        })
        .then(function() {
            //WEIRD, config need to be passed in this way
            //or the config closure chain is broken
            return getAggMeta(config);
        })
        .then(datamining)
        .then(function(flatDep) {
            return Promise.all(
                copyFiles(flatDep),
                generateMetas(flatDep)
            );
        })
        .then(function() {
            if (failedDeps.length > 0) {
                failedDeps = _.unique(failedDeps, uniqer);
                logger.warn('Following sub components publish failed:');
                logger.warn('You need to publish again!');
                logger.warn(JSON.stringify(failedDeps, null, 4));
            }
        })
        .then(function() {
            var message = [
                'Components requested have been published, ',
                'you may need to publish components listed in failed if it is not empty'
            ].join('');
            return {
                message: message,
                installed: deps,
                existed: exists,
                failed: failedDeps
            };
        })
        .then(function(response) {
            cleanup();
            return response;
        })
        .catch(function(e) {
            if (e.errorno === 999) { //all exists
                return e;
            } else {
                var message = [
                    'published failed due to unknow reason, ',
                    'please make sure the component has already registered with ',
                    'either public bower or enterprice private bower.'
                ].join('');
                return {
                    message: message,
                    deps: depsOriginal,
                    error: e
                };
            }
        });
};

module.exports = publish;
