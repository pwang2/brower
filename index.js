#!/usr/bin/env node

'use strict';
var argv = require('minimist')(process.argv.slice(2)),
    parseDeps = require('./lib/parseDeps.js').parseDeps,
    core = require('./lib/core');

var extractCfg = function(argv) {
    /*jshint maxcomplexity:8 */
    var config = {};
    config.offline = !!argv.offline || !!argv.o;
    config.verbose = !!argv.verbose || !!argv.v;
    config.resolve = !!argv.resolve || !!argv.r;
    config.serve = !!argv.serve || !!argv.s;
    return config;
};

console.log(argv);
var config = extractCfg(argv);
var deps = parseDeps(argv._);

if (config.resolve) {
    var shim = argv.shim || '';
    //force to show output when run in CLI
    config.verbose = true;
    //note here unlike the deps, we need to use , to seperate
    //as this is a named parameter
    var shimObj = !shim ? {} : parseDeps(shim.split(','));
    core.resolve(deps, 'bundleid', shimObj, config);
} else if (config.serve) {
    core.serve(config);
} else {
    core.publish(deps, config);
}
