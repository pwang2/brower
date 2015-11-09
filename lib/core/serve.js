'use strict';

var express = require('express'),
    _ = require('underscore'),
    parseDeps = require('../parseDeps.js').parseDeps,
    pmt = require('../prompt.js'),
    resolve = require('./resolve.js'),
    publish = require('./publish'),
    unpublish = require('./unpublish');

var server = function(config) {
    /*jshint maxcomplexity:8 */
    var app = express(),
        logger = pmt.config(config),
        log = logger.log,
        reg = new RegExp('/q/([^/]+)(/shim/([^?]+))?');

    app.get(reg, function(req, res) {
        var id = req.query.id || 'bundleid';
        var list = req.params[0].split(','),
            shim = (req.params[2] || '').split(',')
            .filter(function(n) {
                return !!n;
            }),
            deps = parseDeps(list, ':'),
            shimObj = parseDeps(shim, ':');

        resolve(deps, id, shimObj, config)
            .then(function(result) {
                res.jsonp(result);
            });
    });

    app.get('/p/:list', function(req, res) {
        var ignored = {},
            list = req.params.list.split(','),
            deps = parseDeps(list, ':', ignored);

        publish(deps, config)
            .then(function(result) {
                //CANNOT parse conflict version at on request
                if (_.isEmpty(ignored) === false) {
                    result.ignored = ignored;
                }
                res.jsonp(result);
            });
    });

    app.get('/unp/:list', function(req, res) {
        var list = req.params.list.split(','),
            deps = parseDeps(list, ':');

        unpublish(deps, config)
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

module.exports = server;
