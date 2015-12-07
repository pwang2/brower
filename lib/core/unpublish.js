'use strict';

var Promise = require('bluebird'),
    _ = require('underscore'),
    extend = require('extend'),
    path = require('path'),
    j = path.join,
    fs = Promise.promisifyAll(require('fs-extra')),
    pmt = require('../util/prompt.js');

var cdnpath = process.env.CDN_PHYSICAL_PATH || './cdn',
    staticDir = j(cdnpath, 'static'),
    metaDir = j(cdnpath, 'meta'),
    logger;

var unpublish = function(deps, config) {
    logger = pmt.config(config);
    var depsOrigin = extend(true, {}, deps);
    var promises = [];
    _.each(deps, function(v, k) {
        var p = Promise.all([
            fs.removeAsync(j(staticDir, k, v)),
            fs.removeAsync(j(metaDir, k, v))
        ]).then(function() {
            logger.log('unpublish %s successfully! ', k + '#' + v);
            delete deps[k];
        });
        promises.push(p);
    });
    return Promise.all(promises)
        .spread(function() {
            return {
                deps: depsOrigin,
                message: 'All components listed have been deleted'
            };
        })
        .catch(function(e) {
            return {
                message: 'deletion terminated unexpectedly, please retry',
                failed: deps,
                error: e
            };
        });
};

module.exports = unpublish;
