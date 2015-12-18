'use strict';

var express = require('express'),
    _ = require('underscore'),
    parseDeps = require('../util/parseDeps.js').parseDeps,
    path = require('path'),
    j = path.join,
    pmt = require('../util/prompt.js'),
    resolve = require('./resolve.js'),
    publish = require('./publish'),
    unpublish = require('./unpublish');

var server = function(config) {
    config = config || {};
    var app = express(),
        reg = new RegExp('/q/([^/]+)(/shim/([^?]+))?');

    app.get(reg, function(req, res) {
        /*jshint maxcomplexity:10*/
        var id = req.query.id || 'bundleid';
        var list = req.params[0].split(','),
            shim = (req.params[2] || '').split(',')
            .filter(function(n) {
                return !!n;
            });
        var debug = ['true', '1', ''].indexOf(req.query.debug) > -1;
        var parseInput = parseDeps(list, ':', 'q');
        var parseShim = parseDeps(shim, ':', 'q');
        var ovw = JSON.parse(req.query.overwrite || "{}");

        if (_.isEmpty(parseInput.error) && _.isEmpty(parseShim.error)) {
            var deps = parseInput.deps;
            var shimObj = parseShim.deps;
            var ignored = parseInput.ignored;
            config.debug = debug;

            resolve(deps, id, shimObj, ovw, config)
                .then(function(result) {
                    if (_.isEmpty(ignored) === false) {
                        result.ignored = ignored;
                    }
                    res.jsonp(result);
                });
        } else {
            var error = {
                'error': 'InputParseError'
            };
            res.jsonp(_.extend(error, parseInput.error, parseShim.error));
        }
    });

    app.get('/p/:list', function(req, res) {
        var list = req.params.list.split(',');
        var parseInput = parseDeps(list, ':', 'p');
        if (_.isEmpty(parseInput.error)) {
            var deps = parseInput.deps;
            var ignored = parseInput.ignored;
            publish(deps, config)
                .then(function(result) {
                    //when parsing conflict versions of same lib in one request,
                    //the previous ones will be ignored
                    if (_.isEmpty(ignored) === false) {
                        result.ignored = ignored;
                    }
                    res.jsonp(result);
                });
        } else {
            res.jsonp(parseInput.error);
        }
    });

    app.get('/unp/:list', function(req, res) {
        var list = req.params.list.split(',');
        var parseInput = parseDeps(list, ':', 'unp');
        if (_.isEmpty(parseInput.error)) {
            var deps = parseInput.deps;
            unpublish(deps, config)
                .then(function(result) {
                    res.jsonp(result);
                });
        } else {
            res.jsonp(parseInput.error);
        }
    });

    var cdnRoot = process.env.CDN_PHYSICAL_PATH || './cdn';
    app.use('/static', express.static(j(cdnRoot, 'static'), {
        maxage: 1000 * 60 * 60 * 24 * 200
    }));

    return app;
};

module.exports = {
    server: server,
    serve: function(config) {
        var logger = pmt.config(config);
        var app = server(config);
        var runningServer = app.listen(process.env.PORT || 8868,
            '0.0.0.0',
            function() {
                var host = runningServer.address().address;
                var port = runningServer.address().port;
                logger.log('Listening at http://%s:%s', host, port);
            });
    }
};
