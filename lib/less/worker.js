'use strict';

var path = require('path'),
    less = require('less'),
    Promise = require('bluebird'),
    console = require('../util/prompt.js'),
    fs = Promise.promisifyAll(require('fs'));

process.on('message', function(m) {
    var item = m.item,
        id = process.pid;

    console.log('[cleancss worker:' + id + ']: working ' + item.srcFileName);

    var basedir = path.dirname(item.srcFile);
    process.chdir(basedir);
    less.render(fs.readFileSync(item.srcFile, 'utf8'))
        .then(function(result) {
            var saveName = item.srcFile.replace('.less', '.css');
            fs.writeFileSync(saveName, result.css, 'utf8');
            m.status = 'okay';
            process.send(m);
        })
        .catch(function(e) {
            m.status = 'error';
            m.reason = e;
            process.send(m);
        });
});
