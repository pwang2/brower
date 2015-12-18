'use strict';
var _ = require('underscore'),
    semver = require('semver'),
    Promise = require('bluebird'),
    exec = Promise.promisify(require('child_process').exec),
    fs = Promise.promisifyAll(require('fs-extra')),
    console = require('../util/prompt.js'),
    outputJson = Promise.promisify(fs.outputJson),
    path = require('path'),
    j = path.join,
    indexOf2nd = require('../util/versionUtil.js').indexOf2nd;

var cdnpath = process.env.CDN_PHYSICAL_PATH || './cdn',
    metaDir = j(cdnpath, 'meta'),
    isWin = /^win.*/.test(process.platform),
    bowerBin = j(process.cwd(), 'node_modules/.bin/bower') + (isWin ? '.cmd' : '');

var getBowerInfo = function(regname, name) {
    var options = {
        cwd: './templates' //need bowerrc
    };
    return exec(bowerBin + ' info ' + regname + ' -p --json --allow-root', options)
        .then(function(result) {
            var infoObj = JSON.parse(result);
            var versions = infoObj.versions;
            var gps = _.groupBy(versions, function(n) {
                var indexOf2ndDot = indexOf2nd(n, '.');
                if (indexOf2ndDot === -1) {
                    return Promise.reject(new Error('Should be valid semantic version.'));
                }
                return n.substr(0, indexOf2ndDot);
            });

            var promises = [];
            _.each(gps, function(value, gkey) {
                if (value.length === 0) {
                    return;
                }
                var fname = j(metaDir, name, '~' + gkey + '.json'),
                    sortV = value.sort(semver.rcompare),
                    p = outputJson(fname, {
                        bestMatch: sortV[0],
                        matches: sortV
                    });
                promises.push(p);
            });
            return Promise.all(promises);
        });
};

process.on('message', function(m) {
    var id = process.pid;
    console.time('[prefetch ' + id + ']:' + m.item);
    getBowerInfo(m.item.regname, m.item.name)
        .then(function() {
            m.status = 'okay';
            console.timeEnd('[prefetch ' + id + ']:' + m.item);
        }).catch(function(e) {
            m.status = 'error';
            m.reason = e;
        }).finally(function() {
            process.send(m);
        });
});
