'use strict';

var _ = require('underscore'),
    Promise = require('bluebird'),
    path = require('path'),
    zkClient = require('../zk/client.js'),
    j = path.join,
    processDeps = require('../util/parseDeps.js'),
    pmt = require('../util/prompt.js'),
    uniqer = processDeps.uniqer,
    reducer = processDeps.reducer,
    stackDeps = processDeps.stackDeps,

    cdnpath = process.env.CDN_PHYSICAL_PATH || '/cdn',
    metaDir = j(cdnpath, 'meta'),
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
        var p = zkClient.get(meta)
            .then(function(shimVersion) {
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
        var p = zkClient.get(metaFile)
            .then(function(meta) {
                rootMeta.dependencies[name] = JSON.parse(meta);
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
        var p = zkClient.exists(j(metaDir, k, v))
            .then(function(stats) {
                console.log('meta for ' + k + ' : ' + v + ' exists: ' + stats);
                if (stats) {
                    return false; //a marker say no error;
                } else {
                    console.log(k + ':' + v + ' missing');
                    var missing = {};
                    missing[k] = v;
                    return missing;
                }
            });
        promises.push(p);
    });

    return Promise.all(promises)
        .spread(function() {
            var missings = {},
                args = [].slice.call(arguments, 0);
            console.log(JSON.stringify(args));
            _.each(args, function(n) {
                if (n) { //missing
                    _.extend(missings, n);
                }
            });
            console.log('missings', missings);
            if (_.isEmpty(missings) === false) {
                console.log('missing found');
                return Promise.reject({
                    message: 'requesed/shimed component missing on CDN',
                    missings: missings
                });
            }
        });
};

var echoDependencies = function(rootMeta) {
    var layerArray = stackDeps(rootMeta, console);
    var uniqList = _.chain(layerArray)
        .reduceRight(reducer, [])
        .uniq(uniqer);
    var comList = uniqList.filter(function(n) {
            return (n.pkgMeta.name !== 'template-app');
        })
        .map(function(n) {
            var pkg = n.pkgMeta;
            return {
                name: pkg.name,
                version: pkg.version,
                mainSHA: pkg.mainSHA,
                mainMinSHA: pkg.mainMinSHA,
            };
        })
        ._wrapped;
    return comList;
};

var resolve = function(deps, bundleId, shimObj, overwriteObj, config) {
    bundleId = bundleId || 'bundleId';
    console = pmt.config(config);

    console.log('resolve input', deps);
    console.log('shim passed', shimObj);
    console.log('overwrite passed', overwriteObj);

    return precheckInstall(deps, shimObj)
        .then(function() {
            console.log('1. attache all deps to a virtual root');
            return attachToRoot(deps);
        })
        .then(function(rootMeta) {
            console.log('2. apply shim to point to desired version');
            return preShim(rootMeta, shimObj, overwriteObj);
        })
        .then(function(rootMeta) {
            console.log('3. detect if there is any conflicts');
            return detectConflict(rootMeta);
        })
        .then(function(rootMeta) {
            console.log('4. echo flated dependencies(include akamai URI)');
            return echoDependencies(rootMeta, config);
        })
        .then(function(comList) {
            return {
                id: bundleId,
                bundle: deps,
                shim: shimObj,
                coms: comList
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
