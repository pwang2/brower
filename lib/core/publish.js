'use strict';

var _ = require('underscore'),
    path = require('path'),
    Promise = require('bluebird');

var fs = Promise.promisifyAll(require('fs-extra')),
    writeFile = Promise.promisify(fs.writeFile),
    exec = Promise.promisify(require('child_process').exec),
    tmp = Promise.promisifyAll(require('tmp')),
    pmt = require('../prompt.js');

var failedDeps = [],
    logger;

var staticDir = '/Library/WebServer/Documents/static/',
    metaDir = '/Library/WebServer/Documents/meta/',
    cdnPrefix = 'http://172.28.18.16/static/', //SSL always
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

//publish mode: publish dependencey file and meta from bower to cdn
var publish = function(deps, config) {
    logger = pmt.config(config);

    return createTempDir()
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
        .finally(cleanup);
};

module.exports = publish;
