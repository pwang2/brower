//used to stop all cluster at CLI mode
'use strict';
var QueuedCluster = require('./queuedCluster.js'),
    path = require('path'),
    j = path.join;

module.exports = {
    cleanCssCluster: new QueuedCluster(j(__dirname, '../cleancss/worker.js')),
    uglifyJsCluster: new QueuedCluster(j(__dirname, '../uglifyjs/worker.js')),
    prefetchCluster: new QueuedCluster(j(__dirname, '../prefetch/worker.js')),
    nodesassCluster: new QueuedCluster(j(__dirname, '../nodesass/worker.js')),
    lessCluster: new QueuedCluster(j(__dirname, '../less/worker.js'))
};
