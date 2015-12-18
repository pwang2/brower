'use strict';

var _ = require('underscore'),
    Promise = require('bluebird'),
    path = require('path'),
    j = path.join,
    fs = Promise.promisifyAll(require('fs-extra')),
    processDeps = require('../util/parseDeps.js'),
    pmt = require('../util/prompt.js'),
    uniqer = processDeps.uniqer,
    reducer = processDeps.reducer,
    stackDeps = processDeps.stackDeps;

var cdnpath = process.env.CDN_PHYSICAL_PATH || './cdn',
    metaDir = j(cdnpath, 'meta'),
    cdnPrefix = process.env.CDN_PREFIX || 'http://127.0.0.1:' + process.env.PORT + '/static/', //SSL
    rootMetaBootstrap = require('../../templates/meta.json'),
    console;

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

/**
 * preShim
 *
 * @param root
 * @param shimObj
 * @param overwriteObj
 * {
 *     "angular":"jquery,underscore",
 *     "boostrap":"toastr"
 * }
 * @return {undefined}
 */
var preShim = function(root, shimObj, overwriteObj) {
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
        var meta = j(metaDir, name, version, 'meta.json');
        var p = fs.readJsonAsync(meta)
            .then(function(shimVersion) {
                console.log(shimVersion);
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
            //after shim, we should be able to target fron name only
            var cache = {};
            var loadItemToCache = function(r, item, findAll) {
                var deps = r.dependencies;
                if (deps[item]) {
                    if (!cache[item]) {
                        cache[item] = [deps[item]];
                    } else if (findAll) {
                        cache[item].push(deps[item]);
                    } else {
                        return;
                    }
                }
                for (var sub in deps) {
                    if (deps.hasOwnProperty(sub)) {
                        loadItemToCache(deps[sub], item, findAll);
                    }
                }
            };
            //load overwrite and target object to cache as array
            //for target, we need to find all match to hook our overwrite to.
            //for override, only need to find one instance(we shimmed already)
            _.each(overwriteObj, function(depstr, component) {
                loadItemToCache(root, component, true);
                _.each(depstr.split(','), function(item) {
                    loadItemToCache(root, item);
                });
            });

            //TODO:smelly code
            //change those object(also reflect on root object)
            _.each(overwriteObj, function(depstr, component) {
                var targetList = cache[component];
                _.each(targetList, function(target) {
                    _.each(depstr.split(','), function(item) {
                        var newDep = {};
                        newDep[item] = (cache[item] || [])[0] || {};
                        target.dependencies = _.extend(target.dependencies, newDep);
                    });
                });
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
            //convert it to a better look in json
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
    var rootMeta = JSON.parse(JSON.stringify(rootMetaBootstrap));
    var attachedPromises = [];
    _.each(deps, function(version, name) {
        var metaFile = j(metaDir, name, version, 'meta.json');
        var p = fs.readJsonAsync(metaFile)
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
};

var precheckInstall = function(deps, shims) {
    var input = _.extend({}, deps, shims),
        promises = [];
    _.each(input, function(v, k) {
        var p = fs.statAsync(j(metaDir, k, v))
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

var echoDependencies = function(rootMeta, config) {
    var layerArray = stackDeps(rootMeta, true, console);
    var uniqList = _.chain(layerArray)
        .reduceRight(reducer, [])
        .uniq(uniqer);
    var fileList = uniqList.map(function(n) {
            var m = n.pkgMeta;
            var urlPath = cdnPrefix + m.name + '/' + m.version;
            return m.main.map(function(item) {
                var ext = path.extname(item);
                //only include js/css
                if (['.js', '.css'].indexOf(ext) > -1) {
                    var file = urlPath + '/' + item;
                    if (config.debug) {
                        return file;
                    } else {
                        var filename = path.basename(file, ext);
                        var dirname = path.dirname(item);
                        return urlPath + '/' + dirname + '/' + filename + '.min' + ext;
                    }
                }
            });
        })
        .reduce(reducer, [])
        .filter(function(n) {
            return !!n;
        })
        ._wrapped;

    console.log(fileList);

    var comList = {};
    uniqList.each(function(n) {
            comList[n.pkgMeta.name] = n.pkgMeta.version;
        })
        ._wrapped;
    return {
        fileList: fileList,
        comList: comList
    };
};

var resolve = function(deps, bundleId, shimObj, overwriteObj, config) {
    bundleId = bundleId || 'bundleId';
    console = pmt.config(config);

    console.log('resolve input', deps);
    console.log('shim passed', shimObj);
    console.log('overwrite passed', overwriteObj);

    return precheckInstall(deps, shimObj)
        .then(function() {
            return attachToRoot(deps);
        })
        .then(function(rootMeta) {
            return preShim(rootMeta, shimObj, overwriteObj);
        })
        .then(function(rootMeta) {
            return detectConflict(rootMeta);
        })
        .then(function(rootMeta) {
            return echoDependencies(rootMeta, config);
        })
        .then(function(result) {
            return {
                id: bundleId,
                bundle: deps,
                shim: shimObj,
                coms: result.comList,
                deps: result.fileList
            };
        })
        .catch(function(e) {
            Object.defineProperty(e, 'message', {
                enumerable: true
            });
            return {
                id: bundleId,
                bundle: deps,
                shim: shimObj,
                error: e
            };
        });
};

module.exports = resolve;
