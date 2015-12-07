'use strict';

var sass = require('node-sass'),
    Promise = require('bluebird'),
    fs = Promise.promisifyAll(require('fs')),
    console = require('../util/prompt.js'),
    render = Promise.promisify(sass.render);

process.on('message', function(m) {
    var item = m.item,
        id = process.pid;
    var timeid = '[sass worker:' + id + ']: working ' + item.srcFileName;
    console.time(timeid);

    render({
            file: item.srcFile
        })
        .then(function(result) {
            console.timeEnd(timeid);
            var saveName = item.srcFile.replace('.scss', '.css');
            fs.writeFileSync(saveName, result.css, 'utf8');
            m.status = 'okay';
        })
        .catch(function(e) {
            m.status = 'error';
            m.reason = e;
        })
        .finally(function() {
            process.send(m);
        });
});
