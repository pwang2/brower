#!/usr/bin/env node

'use strict';
var tmp = require('tmp'),
    _ = require('underscore'),
    path = require('path'),
    Promise = require('bluebird'),
    fs = Promise.promisifyAll(require('fs-extra')),
    exec = Promise.promisify(require('child_process').exec),
    argv = require('minimist')(process.argv.slice(2)),
    tmpdir = tmp.dirSync(),
    tmpdirname = tmpdir.name,
    targetBowerJson = path.resolve(tmpdirname, 'bower.json'),
    targetBowerrc = path.resolve(tmpdirname, '.bowerrc'),
    targetBowerMeta = path.resolve(tmpdirname, 'bowerlist.json'),
    layerArray = [];

var parseInput = function(argv) {
    var input = argv._;
    var deps = {};
    input.map(function(item) {
        var pair = item.split('#');
        deps[pair[0]] = pair[1];
    });
    return deps;
};

var prepareInstall = function() {
    var deps = parseInput(argv);
    return fs.readJsonAsync('./templates/bower.json')
        .then(function(bowerObj) {
            bowerObj.dependencies = deps;
            return Promise.all([
                fs.writeJsonAsync(targetBowerJson, bowerObj),
                fs.copyAsync('./templates/.bowerrc', targetBowerrc)
            ]);
        });
};

var getAggregateBowerMeta = function() {
    return exec('bower install -p', {
            cwd: tmpdirname
        })
        .then(function() {
            var cmdline = 'bower list --offline --json >' + targetBowerMeta;
            return exec(cmdline, {
                cwd: tmpdirname
            });
        });
};

var stackDeps = function(obj, layer, layerArray) {
    var pkgMeta = obj.pkgMeta,
        pkgDeps = obj.dependencies,
        pkg = _.pick(pkgMeta, 'name', 'version', 'main', 'canonicalDir');

    layerArray[layer] = layerArray[layer] || [];
    Object.keys(pkgDeps)
        .map(function(depName) {
            var dep = pkgDeps[depName];
            stackDeps(dep, layer + 1, layerArray);
        });
    layerArray[layer].push(pkg);
};

var datamining = function() {
    var input = path.resolve(tmpdirname, targetBowerMeta);
    fs.readJsonAsync(input)
        .then(function(obj) {
            stackDeps(obj, 0, layerArray);
            var reducer = function(prev, cur) {
                return prev.concat(cur);
            };
            var result = _.chain(layerArray)
                .reduceRight(reducer, [])
                .uniq(function(item) {
                    return item.name + '#' + item.version;
                })
                .splice(-1, 1)
                .map(function(item) {
                    if (!Array.isArray(item.main)) {
                        item.main = item.main ? [item.main] : [];
                    }
                    return item;
                });
            console.log(JSON.stringify(result, null, 4));
        });
};

prepareInstall()
    .then(getAggregateBowerMeta)
    .then(datamining);

console.log(tmpdirname);
