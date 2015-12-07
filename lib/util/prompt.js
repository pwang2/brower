'use strict';
var chalk = require('chalk'),
    _ = require('underscore'),
    eol = require('os').EOL;

//work as a singleton, should call config priorly,
//or it is the same as console
var console1 = {
    info: console.info,
    warn: console.warn,
    log: console.log,
    error: console.error,
    time: console.time,
    timeEnd: console.timeEnd
};

var config = {
    quiet: process.env.quiet === 'true',
    verbose: process.env.verbose === 'true'
};

if (config.quiet) {
    console1.log = function() {};
    console1.warn = function() {};
    console1.info = function() {};
    console1.time = function() {};
    console1.timeEnd = function() {};
}

var format = function(msg, sep) {
    var separator = eol + new Array(20).join(sep) + eol;
    console1.log(chalk.red(separator));
    console1.log(chalk.red.bold(msg));
    console1.log(chalk.red(separator));
};

var warn = function(msg) {
    format(msg, '🔴  ');
};

var banner = function(msg) {
    if (config.verbose) {
        var repeat = Math.floor((81 - msg.length) / 2);
        var stroke = new Array(repeat).join(' ');
        msg = stroke + msg + stroke;
        console1.log(chalk.white.bgBlack(msg));
    }
};

module.exports = {
    //allow programatic change the configuration
    config: function(c) {
        config = _.extend(config, c);
        if (!config.quiet || config.verbose) {
            console1 = _.extend({}, console);
        }
        return this;
    },
    warn: warn,
    banner: banner,
    info: console1.info,
    log: console1.log,
    error: console.error,
    time: console1.time,
    timeEnd: console1.timeEnd
};
