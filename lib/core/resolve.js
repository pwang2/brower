'use strict';

var _ = require('underscore'),
    Promise = require('bluebird'),
    path = require('path'),
    fs = Promise.promisifyAll(require('fs-extra')),
    processDeps = require('../processDeps.js'),
    pmt = require('../prompt.js'),
    uniqer = processDeps.uniqer,
    reducer = processDeps.reducer,
    stackDeps = processDeps.stackDeps;

var metaDir = '/Library/WebServer/Documents/meta/',
    cdnPrefix = process.env.CDN_PREFIX || 'http://127.0.0.1/static/', //SSL always
    rootMetaTemplate = './templates/meta.json',
    logger;

var traverse = function(cur, op, exitOnFind) {
    /*jshint maxcomplexity:8 */
    var parentStack = [];

    return (function t(cur, op, exitOnFind) {
        var ret = op(cur);
        if (exitOnFind && ret) {
            return ret;
        }
        var deps = cur.dependencies;
        _.each(deps, function(v) {
            parentStack.push(v);
        });
        while (true) {
            var node = parentStack.pop();
            if (!node) {
                break;
            }
            return t(node, op, exitOnFind);
        }
    })(cur, op, exitOnFind);
};

var preShim = function(root, shimObj) {
    var replace = function(cur, shims) {
        _.each(shims, function(shim) {
            var cmeta = cur.pkgMeta,
                smeta = shim.pkgMeta;
            if (cmeta.name === smeta.name) {
                if (cmeta.version !== smeta.version) {
                    _.extend(cmeta, smeta);
                }
            }
        });
    };

    var shimPromises = [];
    _.each(shimObj, function(version, name) {
        var meta = metaDir + name + '/' + version + '/meta.json';
        var p = fs.readJsonAsync(meta)
            .then(function(shimVersion) {
                logger.banner("shim version found");
                logger.log(shimVersion);
                return shimVersion;
            });
        shimPromises.push(p);
    });

    return Promise.all(shimPromises)
        .spread(function() {
            var shims = [].slice.call(arguments, 0);
            traverse(root, function(cur) {
                replace(cur, shims);
            });
            return root;
        });
};

var detectConflict = function(root) {
    var depList = [];
    (function flatenDeps(root, depList) {
        var cur = root;
        var dep = cur.dependencies;
        _.each(dep, function(v, k) {
            flatenDeps(v, depList);
            depList.push({
                name: k,
                version: v.pkgMeta.version
            });
        });
    })(root, depList);

    var conflicts = _.chain(depList)
        .unique(function(n) {
            return n.name + '#' + n.version;
        })
        .groupBy('name')
        .filter(function(n) {
            return n.length > 1;
        })
        .map(function(g) {
            //a better look in json
            return _.reduce(g, function(reducer, cur) {
                reducer.push(cur.name + ':' + cur.version);
                return reducer;
            }, []);
        })
        ._wrapped;

    if (conflicts.length > 0) {
        return Promise.reject({
            message: 'version resolution meet conflicts, pass shim to resolve',
            conflicts: conflicts
        });
    } else {
        return Promise.resolve(root);
    }
};

var attachToRoot = function(deps) {
    return fs.readJsonAsync(rootMetaTemplate) //TODO: maybe JSON.parse is faster?
        .then(function(rootMeta) {
            var attachedPromises = [];
            _.each(deps, function(version, name) {
                var meta = metaDir + name + '/' + version + '/meta.json';
                var p = fs.readJsonAsync(meta)
                    .then(function(meta) {
                        rootMeta.dependencies[name] = meta;
                        return rootMeta;
                    });
                attachedPromises.push(p);
            });

            return Promise.all(attachedPromises)
                .then(function() {
                    return rootMeta;
                });
        });
};

var precheckInstall = function(deps, shims) {
    var input = _.extend({}, deps, shims),
        promises = [];
    _.each(input, function(v, k) {
        var p = fs.statAsync(metaDir + k + '/' + v)
            .then(function() {
                return false; //a marker say no error;
            })
            .catch(function(e) {
                if (e.code === 'ENOENT') {
                    var missing = {};
                    missing[k] = v;
                    return missing;
                } else { //who knows
                    return Promise.reject(e);
                }
            });
        promises.push(p);
    });

    return Promise.all(promises)
        .spread(function() {
            var missings = {},
                args = [].slice.call(arguments, 0);
            _.each(args, function(n) {
                if (n) { //missing
                    _.extend(missings, n);
                }
            });
            if (_.isEmpty(missings) === false) {
                return Promise.reject({
                    message: 'requesed/shimed component missing on CDN',
                    missings: missings
                });
            }
        });
};

var echoDependencies = function(rootMeta) {
    var layerArray = stackDeps(rootMeta, true, logger);
    var result = _.chain(layerArray)
        .reduceRight(reducer, [])
        .uniq(uniqer)
        .map(function(n) {
            var m = n.pkgMeta;
            var urlPath = cdnPrefix + m.name + '/' + m.version;
            return m.main.map(function(item) {
                var ext = path.extname(item);
                //only include js/css
                if (['.js', '.css'].indexOf(ext) > -1) {
                    return urlPath + '/' + item;
                }
            });
        })
        .reduce(reducer, [])
        .filter(function(n) {
            return !!n;
        })
        ._wrapped;

    logger.log(result);
    return result;
};

var resolve = function(deps, bundleId, shimObj, config) {
    bundleId = bundleId || 'bundleId';
    logger = pmt.config(config);

    logger.banner('resolve input');
    logger.log(deps);
    logger.banner('shim passed');
    logger.log(shimObj);

    return precheckInstall(deps, shimObj)
        .then(function() {
            return attachToRoot(deps);
        })
        .then(function(rootMeta) {
            return preShim(rootMeta, shimObj);
        })
        .then(function(rootMeta) {
            return detectConflict(rootMeta);
        })
        .then(function(rootMeta) {
            return echoDependencies(rootMeta);
        })
        .then(function(result) {
            return {
                id: bundleId,
                bundle: deps,
                shim: shimObj,
                deps: result
            };
        })
        .catch(function(e) {
            return {
                id: bundleId,
                bundle: deps,
                shim: shimObj,
                error: e
            };
        });
};

module.exports = resolve;
