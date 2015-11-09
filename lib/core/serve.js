'use strict';

var express = require('express'),
    _ = require('underscore'),
    parseDeps = require('../parseDeps.js').parseDeps,
    pmt = require('../prompt.js'),
    resolve = require('./resolve.js'),
    publish = require('./publish'),
    unpublish = require('./unpublish'),
    log;

var server = function(config) {
    /*jshint maxcomplexity:8 */
    var p = pmt.config(config);
    log = p.log;

    var app = express();
    //TODO:how to make both and shim optional
    app.get('/q/:list/shim/?:shim?$', function(req, res) {
        var id = req.query.id || 'bundleid',
            list = req.params.list.split(','),
            shim = (req.params.shim || '').split(',')
            .filter(function(n) {
                return !!n;
            }),
            shimObj = parseDeps(shim, ':'),
            deps = parseDeps(list, ':');

        resolve(deps, id, shimObj, config)
            .then(function(result) {
                res.jsonp(result);
            });
    });

    app.get('/q/:list', function(req, res) {
        var list = req.params.list.split(','),
            deps = parseDeps(list, ':');
        resolve(deps, 'bundleid', {}, config)
            .then(function(result) {
                res.jsonp(result);
            });
    });

    app.get('/p/:list', function(req, res) {
        var ignored = {};
        var list = req.params.list.split(','),
            deps = parseDeps(list, ':', ignored);
        publish(deps, config)
            .then(function(result) {
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
