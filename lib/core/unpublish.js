'use strict';

var Promise = require('bluebird'),
    _ = require('underscore'),
    extend = require('extend'),
    fs = Promise.promisifyAll(require('fs-extra')),
    pmt = require('../prompt.js');

var staticDir = './cdn/static/',
    metaDir = './cdn/meta/',
    logger;

var unpublish = function(deps, config) {
    logger = pmt.config(config);
    var depsOrigin = extend(true, {}, deps);
    var promises = [];
    _.each(deps, function(v, k) {
        var p = Promise.all([
            fs.removeAsync(staticDir + k + '/' + v),
            fs.removeAsync(metaDir + k + '/' + v)
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
                message: 'All component listed has been deleted'
            };
        })
        .catch(function(e) {
            return {
                message: 'deletion terminated unexpectedly,retry to delete failed ones',
                failed: deps,
                error: e
            };
        });
};

module.exports = unpublish;
