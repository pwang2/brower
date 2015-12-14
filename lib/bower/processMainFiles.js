'use strict';
var _ = require('underscore'),
    Promise = require('bluebird'),
    fs = Promise.promisifyAll(require('fs-extra')),
    pVault = require('../util/processVault.js'),
    console = require('../util/prompt.js'),
    path = require('path'),
    j = path.join;

var cdnpath = process.env.CDN_PHYSICAL_PATH || './cdn',
    staticDir = j(cdnpath, 'static'),
    metaDir = j(cdnpath, 'meta');

var uglifyJsCluster = pVault.uglifyJsCluster.start(),
    cleanCssCluster = pVault.cleanCssCluster.start(),
    prefetchCluster = pVault.prefetchCluster.start(),
    nodesassCluster = pVault.nodesassCluster.start(),
    lessCluster = pVault.lessCluster.start();

var getJsMapFile = function(jsf) {
    if (!jsf) {
        throw new Error('Source File map to is invalid.');
    }
    return jsf.substring(0, jsf.length - 3) + '.min.js';
};

var getCssMapFile = function(cssf) {
    if (!cssf) {
        throw new Error('Source File map to is invalid.');
    }
    return cssf.substring(0, cssf.length - 4) + '.min.css';
};

var checkClusterReturn = function(result, type) {
    if (!result || result.length === 0) {
        return;
    }

    return Promise.map(result, function(m) {
        if (m.status !== 'okay') {
            throw new Error(type + ' process error', m.reason);
        }
    });
};

var copyComponentPromise = function(component, failedDeps) {
    var meta = component.pkgMeta,
        distStaticDir = j(staticDir, meta.name, meta.version),
        distMetaDir = j(metaDir, meta.name, meta.version),
        srcDir = component.canonicalDir;

    var map2UglifyJsMessage = function(jsf) {
        var srcFile = j(srcDir, jsf),
            minFileName = getJsMapFile(jsf),
            minDistFile = j(distStaticDir, minFileName),
            minMapFileName = path.basename(minFileName) + '.map',
            minMapDistFile = minDistFile + '.map';

        return {
            srcFileName: jsf,
            srcFile: srcFile,
            minMapFileName: minMapFileName,
            minDistFile: minDistFile,
            minMapDistFile: minMapDistFile
        };
    };

    var map2CleanCssMessage = function(cssf) {
        var srcFile = j(srcDir, cssf);
        var minFilename = getCssMapFile(cssf),
            minDistFile = j(distStaticDir, minFilename),
            minMapDistFile = minDistFile + '.map';

        return {
            srcFileName: cssf,
            srcFile: srcFile,
            minDistFile: minDistFile,
            minMapDistFile: minMapDistFile
        };
    };

    var map2ScssMessage = function(scssf) {
        var srcFile = j(srcDir, scssf);
        return {
            srcFileName: scssf,
            srcFile: srcFile,
        };
    };

    var jsMessages = _.chain(meta.main)
        .filter(function(f) {
            return path.extname(f) === '.js';
        })
        .map(map2UglifyJsMessage)
        ._wrapped;

    var transpileCssPromise = function(meta, type) {
        var messages = _.chain(meta.main)
            .filter(function(f) {
                return path.extname(f) === ('.' + type);
            })
            .map(map2ScssMessage)
            ._wrapped;

        var cluster = type === 'scss' ? nodesassCluster : lessCluster;

        return cluster.enqueue(messages)
            .then(function(result) {
                return checkClusterReturn(result, type);
            })
            .then(function() {
                _.each(meta.main, function(f, i) {
                    if (path.extname(f) === ('.' + type)) {
                        var dirname = path.dirname(f),
                            filename = path.basename(f, '.' + type);
                        meta.main[i] = j(dirname, filename + '.css');
                    }
                });
            });
    };

    var copyAllFilesPromise = function() {
        var minifyJSPromise = uglifyJsCluster.enqueue(jsMessages)
            .then(function(result) {
                return checkClusterReturn(result, 'uglifyjs');
            });

        var cssMessages = _.chain(meta.main)
            .filter(function(f) {
                return path.extname(f) === '.css';
            })
            .map(map2CleanCssMessage)
            ._wrapped;

        var minifyCSSPromise = cleanCssCluster.enqueue(cssMessages)
            .then(function(result) {
                return checkClusterReturn(result, 'css');
            });

        var copyBowerMainFilesPromise = Promise.map(meta.main, function(f) {
            var srcFile = j(srcDir, f),
                distFile = j(distStaticDir, f);
            return fs.copyAsync(srcFile, distFile);
        });

        return Promise.all([minifyJSPromise, minifyCSSPromise])
            .then(copyBowerMainFilesPromise);
    };

    return fs.ensureDirAsync(distStaticDir)
        .then(function() {
            return Promise.all([
                transpileCssPromise(meta, 'less'),
                transpileCssPromise(meta, 'scss')
            ]);
        })
        .then(copyAllFilesPromise)
        .catch(function(e) {
            console.log('ERROR when processing bower main file', e);
            fs.removeAsync(distStaticDir);
            fs.removeAsync(distMetaDir);
            failedDeps.push({
                name: meta.name,
                version: meta.version,
                error: JSON.stringify(e, null, 2)
            });
        });
};

var prefetchPromise = function(item) {
    var meta = item.pkgMeta;
    var name = meta.name;
    console.log('trigger prefetch for %s', name);
    //TODO: this is broken when bower registyname is different than bower.json name
    return prefetchCluster.enqueue(name);
};

var processMainFiles = function(flatDep, failedDeps) {
    var copyAll = _.map(flatDep, function(component) {
        return copyComponentPromise(component, failedDeps);
    });
    var prefetchAll = _.map(flatDep, prefetchPromise);
    return Promise.all(copyAll.concat(prefetchAll));
};

module.exports = processMainFiles;
