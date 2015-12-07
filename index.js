#!/usr/bin/env node

'use strict';
var argv = require('minimist')(process.argv.slice(2)),
    parseDeps = require('./lib/util/parseDeps.js').parseDeps,
    core = require('./lib/core');

var extractCfg = function(argv) {
    /*jshint maxcomplexity:8 */
    var config = {};
    config.offline = !!argv.offline || !!argv.o;
    config.verbose = !!argv.verbose || !!argv.v;
    config.resolve = !!argv.resolve || !!argv.r;
    config.serve = !!argv.serve || !!argv.s;
    config.publish = !!argv.publish || !!argv.p;
    config.unpublish = !!argv.unpublish || !!argv.u;
    return config;
};

console.log(argv);
var config = extractCfg(argv);

//force to show output when run in CLI
var _v = config.verbose;
config.verbose = true;

if (config.unpublish) {
    var deps = parseDeps(argv._, '#').deps;
    core.unpublish(deps, config);
} else if (config.resolve) {
    var shim = argv.shim || '';
    var inputObj = parseDeps(argv._, '#').deps;
    //unlike deps, shim is a named parameter
    var shimObj = !shim ? {} : parseDeps(shim.split(','), '#', 'q');
    core.resolve(inputObj.deps, 'bundleid', shimObj.deps, config);
} else if (config.serve) {
    config.verbose = _v;
    core.serve(config);
} else {
    var deps = parseDeps(argv._, '#', 'p').deps;
    core.publish(deps, config)
        .finally(function() {
            process.exit(); //send signal to cluster to disconnect
        });
}
