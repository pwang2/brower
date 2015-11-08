#!/usr/bin/env node

'use strict';
var argv = require('minimist')(process.argv.slice(2));

var _ = require('underscore'),
    path = require('path'),
    Promise = require('bluebird'),
    chalk = require('chalk'),
    express = require('express');

var fs = Promise.promisifyAll(require('fs-extra')),
    exec = Promise.promisify(require('child_process').exec),
    tmp = Promise.promisifyAll(require('tmp'));

var config = {},
    deps = {};

var publishDir = '/Library/WebServer/Documents/static/',
    metaDir = '/Library/WebServer/Documents/meta/',
    cdnPrefix = 'http://172.28.18.16/static/', //SSL always
    tmpdir = tmp.dirSync(),
    tmpdirname = tmpdir.name,

    templateBowerJson = './templates/bower.json',
    templateBowerrc = './templates/.bowerrc',
    targetBowerJson = path.resolve(tmpdirname, 'bower.json'),
    targetBowerrc = path.resolve(tmpdirname, '.bowerrc'),
    targetBowerMeta = path.resolve(tmpdirname, 'bowerlist.json');

var eol = require('os').EOL;

/*jshint maxcomplexity:8 */
var extractCfg = function(argv) {
    var config = {};
    config.offline = !!argv.offline || !!argv.o;
    config.verbose = !!argv.verbose || !!argv.v;
    config.resolve = !!argv.resolve || !!argv.r;
    config.serve = !!argv.serve || !!argv.s;
    return config;
};

//input should always with a valid version.
//e.g.:v1.2.3 or 1.2.3
var parseDeps = function(input, spr) {
    var deps = {};
    spr = spr || '#';
    input.forEach(function(item) {
        var pair = item.split(spr);
        var v = pair[1][0] === 'v' ? pair[0].substr(1) : pair[1];
        deps[pair[0]] = v;
    });
    return deps;
};

var warn = function(msg) {
    var separator = eol + new Array(20).join('💔  ') + eol;
    console.warn(chalk.red(separator));
    console.warn(chalk.red.bold(msg));
    console.warn(chalk.red(separator));
};

var banner = function(msg) {
    if (config.verbose) {
        var repeat = Math.floor((81 - msg.length) / 2);
        var stroke = new Array(repeat).join(' ');
        msg = stroke + msg + stroke;
        console.log(chalk.white.bgBlack(msg));
    }
};

var log = function() {
    if (config.verbose) {
        return console.log.apply(null, [].slice.call(arguments, 0));
    }
};

var reducer = function(prev, cur) {
    return prev.concat(cur);
};

var uniqer = function(item) {
    return item.name + '#' + item.version;
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
    var pkg = obj.pkgMeta;

    //when a non semver was used as version resolver,
    //_target return the branch, commit id
    pkg.version = pkg.version || pkg._target;

    //unify the main to an array
    if (!Array.isArray(pkg.main)) {
        pkg.main = pkg.main ? [pkg.main] : [];
    }

    //filter out the ./
    //../ should NOT be used
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
    var layerArray = [];
    var layer = 0;

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
                    warn('[' + pkg.name + ']: ' + eol + resolveType + ' is not suggested');
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

/* Get flat list for entry components,
 * this is mainly used for file copy,
 * as it includes all dependency files.
 *
 * Meta file generation will reuse targetBowerMeta
 * by targeting to a specific dependency node.
 * This is an easier apporach for people with recursion difficulty
 * especially myself(pwang2) */
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
    var copyItemPromise = function(item) {
        var distDir = publishDir + item.name + '/' + item.version + '/';
        var srcDir = item.canonicalDir;

        var copyAllFilePromise = function() {
            var copyPromises = _.map(item.main, function(f) {
                var srcFile = path.resolve(srcDir, f);
                return fs.copyAsync(srcFile, distDir + f);
            });
            return Promise.all(copyPromises);
        };

        return fs.ensureDirAsync(distDir)
            .then(copyAllFilePromise);
    };

    var copyAllItemPromises = _.map(flatDep, copyItemPromise);

    return Promise.all(copyAllItemPromises);
};

//generate meta file for quick resolution from browser request
var generateMetas = function(flatDep) {
    Promise.all(
        _.each(flatDep, function(item) {
            banner(item.name + '#' + item.version);

            var metaDest = metaDir + item.name + '/' + item.version;
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
            return fs.ensureDirAsync(metaDest)
                .then(function() {
                    var writeFile = Promise.promisify(fs.writeFile);
                    return Promise.all([
                        writeFile(metaDest + '/index.js', ';quikr.s(' + fileContent + ');'),
                        writeFile(metaDest + '/meta.json', metaContent)
                    ]);
                });
        }));
};

var cleanup = function() {
    log('removing tmp dir', tmpdirname);
    fs.removeSync(tmpdirname);
};

var traverse = function(name, version, cur, op, exitOnFind) {
    var parentStack = [];

    return (function t(name, version, cur, op, exitOnFind) {
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
            return t(name, version, node, op, exitOnFind);
        }
    })(name, version, cur, op, exitOnFind);
};

var preShim = function(root, shimObj) {
    _.each(shimObj, function(version, name) {
        //this coud be replaced by require('/meta/name/version/meta.json');
        //TODO:right now, it is full traverse as we need both find and traverse
        var find = function(cur) {
            if (cur.pkgMeta.name === name && cur.pkgMeta.version === version) {
                return cur;
            }
        };

        var replace = function(cur, shim) {
            var cmeta = cur.pkgMeta,
                smeta = shim.pkgMeta;
            if (cmeta.name === smeta.name && cmeta.version !== smeta.version) {
                cmeta.version = smeta.version;
                cmeta.main = smeta.main;
                cmeta.dependencies = smeta.dependencies;
            }
        };

        var shimVersion = traverse(name, version, root, find, true);
        banner("shim version found");
        log(shimVersion);

        //TODO: multiple shim coule be done in one traverse
        traverse(name, version, root, function(cur) {
            replace(cur, shimVersion);
        });
    });

    return root;
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

//resolve mode: locate saved meta file and get filelist
var resolve = function(deps, bundleId, shimObj) {
    bundleId = bundleId || 'bundleId';
    banner('shim passed');
    log(shimObj);

    var rootMeta = require('./templates/meta.json');

    var linkPromises = [];
    _.each(deps, function(version, name) {
        var p = fs.readJsonAsync(metaDir + name + '/' + version + '/meta.json')
            .then(function(meta) {
                rootMeta.dependencies[name] = meta;
                return rootMeta;
            });
        linkPromises.push(p);
    });

    return Promise.all(linkPromises)
        .then(function() {
            rootMeta = preShim(rootMeta, shimObj);
            banner('root after shim');
            log(JSON.stringify(rootMeta, null, 4));

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

            log(result);

            return {
                id: bundleId,
                bundle: deps,
                deps: result
            };
        });
};

//publish mode: publish dependencey file and meta from bower to cdn
var publish = function(deps) {
    return prepareInstall(deps)
        .then(getAggMeta)
        .then(datamining)
        .then(function(flatDep) {
            return Promise.all(
                copyFiles(flatDep),
                generateMetas(flatDep)
            );
        })
        .then(cleanup);
};

var resolveServer = function() {
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


config = extractCfg(argv);
deps = parseDeps(argv._);

if (config.resolve) {
    resolve(deps, 'bundleid', {});
} else if (config.serve) {
    resolveServer();
} else {
    publish(deps);
}

/* TODO:
 * Need to make file copy atomic!!
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
 */
