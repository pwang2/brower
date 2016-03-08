var zookeeper = require('node-zookeeper-client'),
    Promise = require('bluebird'),
    ensemble = process.env.ZK_ENSEMBLE,
    retryLimit = process.env.ZK_CONNECT_RETRY_LIMIT || 2,
    client = zookeeper.createClient(ensemble, {
        retries: retryLimit
    });

client.connect();

process.on('exit', function() {
    client.close();
});

var clientAsync = Promise.promisifyAll(client);

var ready = clientAsync.onceAsync('connected');

var get = function(path) {
    if (!path) {
        throw Error("invalid zookeeper path");
    }
    return ready.then(function() {
        return clientAsync.getDataAsync(path);

    }).then(function(buf) {
        return buf.toString('utf8');
    });
};
var write = function(path, data) {
    if (!path) {
        throw Error("invalid zookeeper path");
    }
    return ready.then(function() {
        //no error throw for mkdirp and setData even already exists
        return clientAsync.mkdirpAsync(path)
            .then(function(path) {
                return clientAsync.setDataAsync(path, new Buffer(data));
            })
            .then(function() {
                console.log('success write content to ' + path);
            });
    });
};

var exists = function(path) {
    if (!path) {
        throw Error("invalid zookeeper path");
    }
    return ready.then(function() {
        return clientAsync.existsAsync(path)
            .then(function(stats) {
                return !!stats;
            });
    });
};

var remove = function(path) {
    return ready.then(function() {
        return clientAsync.removeAsync(path, -1);
    });
};

module.exports = {
    client: client,
    ready: ready,
    get: get,
    write: write,
    exists: exists,
    remove: remove
};
