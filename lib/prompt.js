'use strict';
var chalk = require('chalk');
var eol = require('os').EOL;

var config = {};
var warn = function(msg) {
    var separator = eol + new Array(20).join('💔  ') + eol;
    console.warn(chalk.red(separator));
    console.warn(chalk.red.bold(msg));
    console.warn(chalk.red(separator));
};

var banner = function(msg) {
    if (config.verbose) {
        var repeat = Math.floor((81 - msg.length) / 2);
        var stroke = new Array(repeat).join(' ');
        msg = stroke + msg + stroke;
        console.log(chalk.white.bgBlack(msg));
    }
};

var log = function() {
    if (config.verbose) {
        return console.log.apply(null, [].slice.call(arguments, 0));
    }
};

module.exports = {
    config: function(c) {
        config = c;
        return this;
    },
    warn: warn,
    banner: banner,
    log: log
};
