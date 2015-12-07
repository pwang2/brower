#!/usr/bin/env node

'use strict';
var Promise = require('bluebird'),
    CronJob = require('cron').CronJob,
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
    return readdir(metaDir)
        .then(function(dirs) {
            return cluster.enqueue(dirs);
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
