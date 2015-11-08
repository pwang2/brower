'use strict';

var eol = require('os').EOL;

var _ = require('underscore'),
    path = require('path'),
    Promise = require('bluebird'),
    express = require('express'),
    pmt = require('./prompt.js'),
    parseDeps = require('./parseDeps.js').parseDeps;

var fs = Promise.promisifyAll(require('fs-extra')),
    writeFile = Promise.promisify(fs.writeFile),
    exec = Promise.promisify(require('child_process').exec),
    tmp = Promise.promisifyAll(require('tmp'));

var config = {},
    deps = {},
    failedDeps = [],
    warn,
    banner,
    log;

var staticDir = '/Library/WebServer/Documents/static/',
    metaDir = '/Library/WebServer/Documents/meta/',
    cdnPrefix = 'http://172.28.18.16/static/', //SSL always
    rootMetaTemplate = './templates/meta.json',
    templateBowerJson = './templates/bower.json',
    templateBowerrc = './templates/.bowerrc',
    tmpdirname,
    targetBowerJson,
    targetBowerrc,
    targetBowerMeta;

var reducer = function(prev, cur) {
    return prev.concat(cur);
};

var uniqer = function(item) {
    return item.name + '#' + item.version;
};

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

var getAggMeta = function() {
    var installCmdline = 'bower install -p --silent --config.interactive=false ',
        listCmdline = 'bower list --offline --json >' + targetBowerMeta,
        options = {
            cwd: tmpdirname
        };

    if (config.offline) {
        installCmdline += '--offline';
    }
    return exec(installCmdline, options)
        .then(function(data) {
            log(data);
            return exec(listCmdline, options);
        });
};

var normalizeMeta = function(obj) {
    /*jshint maxcomplexity:8 */
    var pkg = obj.pkgMeta;

    //when a non semver was used as version resolver,
    //_target return the branch, commit id
    pkg.version = pkg.version || pkg._target;

    if (!Array.isArray(pkg.main)) {
        pkg.main = pkg.main ? [pkg.main] : [];
    }

    var trimDot = function(f) {
        f = f.trim();
        if (f.indexOf('./') === 0) {
            f = f.substr(2);
        }
        return f;
    };

    var tmp = _.map(pkg.main, trimDot);
    pkg.main = _.filter(tmp, function(n) {
        return !!n;
    });
};

//clean pkgMeta for saving purpose
//the remainings are just essential for composition
var cleanupMeta = function(obj) {
    delete obj.canonicalDir;
    delete obj.endpoint;
    delete obj._resolution;
    delete obj.nrDependants;

    var pkg = obj.pkgMeta;
    obj.pkgMeta = {
        name: pkg.name,
        version: pkg.version,
        main: pkg.main
    };
};

var stackDeps = function(obj, cleanup) {
    /*jshint maxcomplexity:8 */
    var layerArray = [],
        layer = 0;

    (function s(obj, layer, cleanup) {
        normalizeMeta(obj);
        var pkgMeta = obj.pkgMeta,
            pkgDeps = obj.dependencies,
            pkg = _.pick(pkgMeta, 'name', 'version', 'main', '_resolution');

        if (cleanup) {
            cleanupMeta(obj);
        } else {
            if (pkg.name !== 'template-app') {
                var resolveType = pkgMeta._resolution.type;
                if (resolveType !== 'version') {
                    warn('[%s]: %s%s is not suggested', pkg.name, eol, resolveType);
                }
                //this is only need for cdn copy
                pkg.canonicalDir = obj.canonicalDir;
            }
        }
        pkg.pkgMeta = pkgMeta;
        pkg.dependencies = pkgDeps;

        layerArray[layer] = layerArray[layer] || [];

        _.mapObject(pkgDeps, function(dep) {
            s(dep, layer + 1, cleanup);
        });

        layerArray[layer].push(pkg);
    }(obj, layer, cleanup));

    return layerArray;
};

var datamining = function() {
    var input = path.resolve(tmpdirname, targetBowerMeta);
    return fs.readJsonAsync(input)
        .then(function(obj) {
            var layerArray = stackDeps(obj);
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
        var distDir = staticDir + item.name + '/' + item.version + '/',
            srcDir = item.canonicalDir;

        var copyAllFilePromise = function() {
            var copyPromises = _.map(item.main, function(f) {
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
                fs.removeAsync(metaDir + item.name + '/' + item.version);
                failedDeps.push({
                    name: item.name,
                    version: item.version,
                    error: e
                });
            });
    };

    var copyAllItemPromises = _.map(flatDep, copyFolderPromise);

    return Promise.all(copyAllItemPromises);
};

//generate meta file for quick resolution from browser request
var generateMetas = function(flatDep) {
    //TODO:need refactor
    Promise.all(
        _.each(flatDep, function(item) {
            banner(item.name + '#' + item.version);

            var distMeta = metaDir + item.name + '/' + item.version;
            var flatLayerArray = stackDeps(item, true);

            var result = _.chain(flatLayerArray)
                .reduceRight(reducer, [])
                .uniq(uniqer)
                .map(function(n) {
                    return n.main.map(function(item) {
                        return cdnPrefix + n.name + '/' + n.version + '/' + item;
                    });
                })
                .reduce(reducer, [])
                ._wrapped;

            var obj = {
                id: item.name + '#' + item.version,
                deps: result
            };
            var fileContent = JSON.stringify(obj, null, 4);
            var metaContent = JSON.stringify(item, null, 4);
            log(fileContent);
            return fs.ensureDirAsync(distMeta)
                .then(function() {
                    return Promise.all([
                        writeFile(distMeta + '/index.js', ';quikr.s(' + fileContent + ');'),
                        writeFile(distMeta + '/meta.json', metaContent)
                    ]);
                })
                .error(function(e) {
                    fs.removeAsync(distMeta);
                    fs.removeAsync(staticDir + item.name + '/' + item.version);
                    failedDeps.push({
                        name: item.name,
                        version: item.version,
                        error: e
                    });
                });
        }));
};

var cleanup = function() {
    log('removing tmp dir', tmpdirname);
    fs.removeSync(tmpdirname);
};

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
            if (cmeta.name === smeta.name && cmeta.version !== smeta.version) {
                cmeta.version = smeta.version;
                cmeta.main = smeta.main;
                cmeta.dependencies = smeta.dependencies;
            }
        });
    };

    var shimPromises = [];
    _.each(shimObj, function(version, name) {
        var meta = metaDir + name + '/' + version + '/meta.json';
        var p = fs.readJsonAsync(meta)
            .then(function(shimVersion) {
                banner("shim version found");
                log(shimVersion);
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
        .unique(uniqer)
        .groupBy('name')
        .filter(function(n) {
            return n.length > 1;
        })
        ._wrapped;

    return conflicts;
};

var attachToRoot = function(deps) {
    return fs.readJsonAsync(rootMetaTemplate)
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

var resolve = function(deps, bundleId, shimObj) {
    bundleId = bundleId || 'bundleId';
    banner('shim passed');
    log(shimObj);

    return attachToRoot(deps)
        .then(function(rootMeta) {
            banner('root before shim');
            log(JSON.stringify(rootMeta, null, 4));
            return preShim(rootMeta, shimObj);
        })
        .then(function(rootMeta) {
            banner('root after shim');
            log(JSON.stringify(rootMeta, null, 4));
            return rootMeta;
        })
        .then(function(rootMeta) {
            var conflicts = detectConflict(rootMeta);
            if (conflicts.length > 0) {
                return {
                    id: bundleId,
                    bundle: deps,
                    error: "conflict founded, you could pass resolution in the shim",
                    conflicts: conflicts
                };
            }

            var layerArray = stackDeps(rootMeta, true);
            var result = _.chain(layerArray)
                .reduceRight(reducer, [])
                .uniq(uniqer)
                .map(function(n) {
                    return n.main.map(function(item) {
                        return cdnPrefix + n.name + '/' + n.version + '/' + item;
                    });
                })
                .reduce(reducer, [])
                ._wrapped;

            return {
                id: bundleId,
                bundle: deps,
                deps: result
            };
        });
};

//publish mode: publish dependencey file and meta from bower to cdn
var publish = function(deps) {
    return createTempDir()
        .then(function() {
            return prepareInstall(deps);
        })
        .then(getAggMeta)
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
                warn('Following sub components publish failed:');
                warn('You need to publish again!');
                warn(JSON.stringify(failedDeps, null, 4));
            }
        })
        .finally(cleanup);
};

var resolveServer = function() {
    /*jshint maxcomplexity:8 */
    var app = express();

    app.get('/q/:list/:id?/shim/:shim?$', function(req, res) {
        var list = req.params.list.split(',');
        var id = req.params.id || 'bundleid';
        var shim = decodeURIComponent(req.params.shim || '');
        var shimObj = shim ? JSON.parse(shim) : {};

        log(list);
        log(shimObj);

        var deps = parseDeps(list, ':');
        resolve(deps, id, shimObj)
            .then(function(result) {
                res.jsonp(result);
            });
    });

    var server = app.listen(process.env.port || 8868, '0.0.0.0', function() {
        var host = server.address().address;
        var port = server.address().port;
        log('Listening at http://%s:%s', host, port);
    });
};

module.exports = {
    setInput: function(d, config) {
        deps = d;
        config = config;

        var p = pmt.config(config);
        warn = p.warn;
        log = p.log;
        banner = p.banner;
        return this;
    },
    publish: publish,
    resolve: resolve,
    serve: resolveServer
};


/* TODO:
 * Need to make file copy atomic!!
 * Need to check component which is a invalid bower component
 * Need to give proper error is a requested component does not exist
 *
 * should give error if the resolved component does not exist
 * should let loader handle css, map, font, js， bootstrap even has less in main
 * should mini, gz, sourcemap
 * should be able to download packed script for all
 * should quick resolve when passing component#version
 * should handle version conflict, raw idea is, passing the resolution with components in quikr loader
 * should add unpublish
 * should make the file copy a trasantion
 * Should provide a way to force republish. need to replace ensureDir
 *
 * Evaluate: decide if need to support auto version update
 * Evaluate: when failed Promise should going on, but reporting failured ones, then we could we try just with that one Promise all CAN NOT DO THE JOB, need allSettle here
 *
 * Could move CDN URI prefix out to save bandwidth
 *
 * Research: if JSONP is safe
 */
