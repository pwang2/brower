'use strict';

var path = require('path'),
    CleanCSS = require('clean-css'),
    Promise = require('bluebird'),
    fs = Promise.promisifyAll(require('fs')),
    console = require('../util/prompt.js'),
    cleancss = new CleanCSS({
        sourceMap: true
    });

process.on('message', function(m) {
    var item = m.item;

    //in child process, promise will halt the process until it gets resolved
    fs.readFileAsync(item.srcFile, 'utf8')
        .then(function(content) {
            //some css file has sourceMapp commnent section, this will break the clean css
            content = content.replace(/\/\*# sourceMappingURL[^\*]*\*\//, '');
            console.time('cleancss ' + item.srcFileName);
            var minified = cleancss.minify(content);
            console.timeEnd('cleancss ' + item.srcFileName);

            if (minified.errors && minified.errors.length > 0) {
                m.status = 'error';
                m.reason = minified.errors;
                return;
            }
            var mapFileName = path.basename(item.minMapDistFile);
            var prepend = '/*# sourceMappingURL=' + mapFileName + ' */';
            outputStyle(item.minDistFile, minified.styles + prepend);
            outputMap(item.minMapDistFile, minified.sourceMap);
            m.status = 'okay';
        }).catch(function(e) {
            m.status = 'error';
            m.reason = e;
        }).finally(function() {
            process.send(m);
        });
});

function outputStyle(f, styles) {
    fs.writeFileSync(f, styles, 'utf8');
}

function outputMap(f, sourceMap) {
    fs.writeFileSync(f, sourceMap.toString(), 'utf-8');
}
