'use strict';
var chalk = require('chalk'),
    _ = require('underscore'),
    eol = require('os').EOL,
    hostname = require('os').hostname(),
    toString = Object.prototype.toString,
    slice = Array.prototype.slice,
    join = Array.prototype.join;

var logInstrument = function() {
    var level = arguments[0];
    var action = console[level];
    var logMsgs = [];
    var logRawMsgs = slice.call(arguments[1], 0);
    for (var i = 0; i < logRawMsgs.length; i++) {
        var msg = logRawMsgs[i];
        if (toString.call(msg) === '[object Object]') {
            logMsgs.push(JSON.stringify(msg, null, 2));
        } else {
            logMsgs.push(msg);
        }
    }
    var content = ['hostname="' + hostname + '"',
        'service_name="brower"',
        'event_severity="' + level + '"',
        'message="' + join.call(logMsgs, ' ') + '"'
    ];
    if (typeof action !== 'function') {
        action = console.log;
    }
    var formated = join.call(content, ' ');
    action.call(null, formated);
};

//work as a singleton, should call config priorly,
//or it is the same as console
var console1 = {
    info: function() {
        logInstrument('info', arguments);
    },
    warn: function() {
        logInstrument('warn', arguments);
    },
    log: function() {
        logInstrument('log', arguments);
    },
    error: function() {
        logInstrument('error', arguments);
    },
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
    format(msg, '⚠️   ');
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
