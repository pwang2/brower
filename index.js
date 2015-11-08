#!/usr/bin/env node

'use strict';
var argv = require('minimist')(process.argv.slice(2)),
    pmt = require('./lib/prompt.js'),
    parseDeps = require('./lib/parseDeps.js').parseDeps,
    core = require('./lib/core.js');

var extractCfg = function(argv) {
    /*jshint maxcomplexity:8 */
    var config = {};
    config.offline = !!argv.offline || !!argv.o;
    config.verbose = !!argv.verbose || !!argv.v;
    config.resolve = !!argv.resolve || !!argv.r;
    config.serve = !!argv.serve || !!argv.s;
    return config;
};

var config = extractCfg(argv);
var p = pmt.config(config);

var deps = parseDeps(argv._);
p.log('input:', deps);

var app = core.setInput(deps, config);

if (config.resolve) {
    app.resolve(deps, 'bundleid', {});
} else if (config.serve) {
    app.serve();
} else {
    app.publish(deps);
}
