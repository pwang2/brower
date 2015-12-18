#!/usr/bin/env node

'use strict';
var Promise = require('bluebird'),
    CronJob = require('cron').CronJob,
    _ = require('underscore'),
    fs = require('fs-extra'),
    pVault = require('./lib/util/processVault.js'),
    readdir = Promise.promisify(fs.readdir),
    console = require('./lib/util/prompt.js'),
    path = require('path'),
    j = path.join,
    cdnpath = process.env.CDN_PHYSICAL_PATH || './cdn',
    metaDir = j(cdnpath, 'meta');

var cluster = pVault.prefetchCluster;
cluster.start();

var prefetchVersions = function() {
    var isdir = function(dir) {
        return fs.statSync(dir).isDirectory();
    };

    return readdir(metaDir)
        .then(function(list) {
            var dirs = _.filter(list, function(d) {
                return isdir(j(metaDir, d));
            });
            var inputs = _.map(dirs, function(dir) {
                var path = j(metaDir, dir, 'regname.txt');
                return {
                    regname: fs.readFileSync(path, {
                        encoding: 'utf8'
                    }),
                    name: dir
                };
            });
            return cluster.enqueue(inputs);
        });
};

var job = new CronJob({
    cronTime: '22 * * * * ',
    onTick: function() {
        console.log('prefetcher versions for tidle match..');
        prefetchVersions();
    }
});

if (process.argv[1] === __filename) {
    prefetchVersions()
        .finally(function() {
            process.exit();
        });
}

job.start();

process.on('exit', function() {
    job.stop();
});
