'use strict';
var fork = require('child_process').fork,
    guid = require('mout/random/guid'),
    console = require('../util/prompt.js'),
    _ = require('underscore'),
    Promise = require('bluebird'),
    cpus = require('os').cpus(),
    path = require('path'),
    QUEUE_LIMIT = 32,
    DEFAULT_TIMEOUT = 20000; //ms

/**
 * QueuedCluster: A customized cluster message balancer,
 * worker status are tracked and when new message comming,
 * it will always send to the idle worker to process.
 * when no idle worker, a random worker is piced
 * @constructor
 * @param worker file to fork in cluster
 * @param concurrentNo optional concurrent number to start cluster
 * @param args args for child_process.fork
 * @param options options for child_process.fork
 * @param timeout time allowance for a message processing,
 *      once excess, worker will be killed
 * @return {undefined}
 * */
function QueuedCluster(worker, concurrentNo, args, options, timeout) {
    this.worker = worker;
    this.workerShort = path.relative(process.cwd(), this.worker);
    this.args = args;
    this.options = options;
    this.timeout = timeout || DEFAULT_TIMEOUT;
    this.queue = [];
    this.taskQueue = {};
    this.pool = {};
    this.status = 'pending';
    this.concurrentNo = concurrentNo || process.env.WORKER_COUNT || cpus.length / 2;
    var that = this;

    //kill all worker on process exit
    process.on('exit', function() {
        that.disconnect();
    });

    setInterval(function() {
        that.scanPool();
    }, 1000);
}

/**
 * scan worker pool to see is anyone is dead
 * kill timeout job
 *
 * @return {undefined}
 */
QueuedCluster.prototype.scanPool = function() {
    /*jshint maxcomplexity:5*/
    var now = new Date();
    for (var pid in this.pool) {
        if (this.pool.hasOwnProperty(pid)) {
            var w = this.pool[pid];
            if (w.occupied === 1 && now - w.lastServeBy > this.timeout) {
                console.log('❌  force quit! ', w.currentMessage);
                w.worker.kill("SIGTERM");
                this.enqueue(w.currentMessage.item);
            }
        }
    }
};

/**
 * fired when a worker has finished the work.
 *
 * @return {undefined}
 */
QueuedCluster.prototype.updateQueue = function(m) {
    /*jshint maxcomplexity:8*/
    var that = this;
    var task = that.taskQueue[m.taskGuid],
        msgLen = task.taskMsgs.length,
        queueLen = that.queue.length,
        i;
    for (i = 0; i < queueLen; i++) {
        var qmsg = that.queue[i];
        if (m.guid === qmsg.guid) {
            that.queue.splice(i, 1);
            break;
        }
    }

    for (i = 0; i < msgLen; i++) {
        var tmsg = task.taskMsgs[i];
        if (m.guid === tmsg.guid) {
            task.taskMsgs.splice(i, 1);
            break;
        }
    }
    that.pool[m.pid].occupied = 0;
    task.resolveValue.push(m);

    if (task.taskMsgs.length === 0) {
        //Promise magic: task finished, fulfil promise of enqueue
        task.resolve(task.resolveValue);
        delete that.taskQueue[m.taskGuid];
    }

    //find if still any message ready to sent to queue
    var next = _.find(that.queue, function(item) {
        return !item.inqueue;
    });
    if (next) {
        that.queuedScheduler(next);
    }
};

/**
 * create worker for cluster fromt the file to fork
 *
 * @return {undefined}
 */
QueuedCluster.prototype.createWorker = function() {
    var that = this;
    var p = fork(that.worker, that.args, that.options);
    console.log(that.workerShort, 'worker ' + p.pid + ' created');
    that.pool[p.pid] = {
        worker: p,
        occupied: 0
    };

    //in worker, we use process.send to send message to here.
    //here the handler grab the message and emit it to the cluster
    p.on('message', function(m) {
        if (m.status !== 'okay') {
            console.warn('process failed!\n' + JSON.stringify(m, null, 4));
        }
        that.updateQueue(m);
    });
    return p;
};

/**
 * start the cluster by forking concurrentNo of worker
 * @return {undefined}
 */
QueuedCluster.prototype.start = function() {
    if (this.status === 'started') {
        return;
    }
    var that = this;
    var iter = _.range(that.concurrentNo);
    _.each(iter, function() {
        var worker = that.createWorker();
        worker.on('exit', function(code, signal) {
            delete that.pool[worker.pid];
            console.warn('💣  worker %d died (%s).', worker.pid, code || signal);
            console.log('restarting....');
            var newWorker = that.createWorker();
            console.log('🔧  recreating worker ' + newWorker.pid);
        });
    });

    this.status = 'started';
    return this;
};

/**
 * disconnect all worker
 * @return {undefined}
 */
QueuedCluster.prototype.disconnect = function() {
    _.each(this.pool, function(w) {
        w.worker.kill();
    });
};

/**
 * getIdleWorkers: get idle worker in the pool
 *
 * @return {undefined}
 */
QueuedCluster.prototype.getIdleWorkers = function() {
    var idles = [];
    _.each(this.pool, function(w) {
        if (w.occupied === 0) {
            idles.push(w);
        }
    });
    return idles;
};

/**
 * enQueue: append message to processing queue
 *
 * @param messages
 * @return {undefined}
 */
QueuedCluster.prototype.enqueue = function(messages) {
    /*jshint maxcomplexity:5*/
    if (this.queue.length > QUEUE_LIMIT) {
        console.warn(this.queue.length + ' items in queue, think about scaling');
    }
    if (!messages || messages.length === 0) {
        return new Promise(function(resolve) {
            resolve([]);
        });
    }
    var that = this;
    var taskMsgs = Array.isArray(messages) ? messages : [messages];
    var taskGuid = guid();
    var cookedMessages = _.map(taskMsgs, function(m) {
        var cookedMessage = {};
        cookedMessage.item = m;
        cookedMessage.taskGuid = taskGuid;
        cookedMessage.guid = guid();
        that.queue.push(cookedMessage);
        that.queuedScheduler(cookedMessage);
        return cookedMessage;
    });
    var p = new Promise(function(resolve, reject) {
        var context = this;
        that.taskQueue[taskGuid] = {
            taskMsgs: cookedMessages,
            resolveValue: [],
            resolve: resolve.bind(context),
            reject: reject.bind(context)
        };
    });
    return p;
};

/**
 * queuedScheduler:
 *
 * @param m message to process
 * @return {undefined}
 */
QueuedCluster.prototype.queuedScheduler = function(m) {
    var idleWorkers = this.getIdleWorkers();
    if (idleWorkers.length === 0) {
        console.log('all workers are busy, waiting for next chance');
        return;
    }
    var w = idleWorkers[0];
    w.occupied = 1;
    w.lastServeBy = new Date();
    m.pid = w.worker.pid;
    m.inqueue = true;
    w.currentMessage = m;
    w.worker.send(m);
    console.log(this.workerShort, '[', m.pid, '] start processing');
};

module.exports = QueuedCluster;
