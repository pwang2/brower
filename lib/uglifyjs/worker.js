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
            /*outSourceMap: item.minMapFileName,*/
            mangle: true
        });
        fs.writeFileSync(item.minDistFile, output.code);
        //the file is created from the tmp folder,
        //but will be copied to the cdn folder,
        //make all flat here.
        // var name = path.basename(item.srcFile);
        // var map = JSON.parse(output.map);
        // map.sources = [name];
        // map.file = item.srcFileName;
        //map.sourcesContent = [fs.readFileSync(item.srcFile, {
        //encoding: 'utf8'
        //})];
        // fs.writeFileSync(item.minMapDistFile, JSON.stringify(map));
        console.timeEnd('[uglifyjs: ' + id + '] ' + item.srcFileName);
        m.status = 'okay';
    } catch (e) {
        m.status = 'error';
        m.reason = e;
    } finally {
        process.send(m);
    }
});
