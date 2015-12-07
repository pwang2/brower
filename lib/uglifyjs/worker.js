'use strict';

var fs = require('fs'),
    console = require('../util/prompt.js'),
    uglifyJS = require("uglify-js");

process.on('message', function(m) {
    var item = m.item;
    var id = process.pid;
    try {
        console.time('[uglifyjs: ' + id + '] ' + item.srcFileName);
        var output = uglifyJS.minify(item.srcFile, {
            outSourceMap: item.minMapFileName
        });
        fs.writeFileSync(item.minDistFile, output.code);
        fs.writeFileSync(item.minMapDistFile, output.map);
        console.timeEnd('[uglifyjs: ' + id + '] ' + item.srcFileName);
        m.status = 'okay';
    } catch (e) {
        m.status = 'error';
        m.reason = e;
    } finally {
        process.send(m);
    }
});
