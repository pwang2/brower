'use strict';

var Promise = require('bluebird'),
    _ = require('underscore'),
    eol = require('os').EOL,
    path = require('path'),
    SHA = require('./sha1.js'),
    fs = Promise.promisifyAll(require('fs-extra')),
    j = path.join,
    indexOf2nd = require('./versionUtil.js').indexOf2nd,
    cdnpath = process.env.CDN_PHYSICAL_PATH || './cdn',
    metaDir = j(cdnpath, 'meta');

var normalizeMeta = function(obj, instrumentAkamai) {
    /*jshint maxcomplexity:8 */
    var meta = obj.pkgMeta;

    //when a non semver was used as version resolver,
    //_target return the branch, commit id
    meta.version = meta.version || meta._target;

    if (!Array.isArray(meta.main)) {
        meta.main = meta.main ? [meta.main] : [];
    }

    var trimDot = function(f) {
        f = f.trim();
        if (f.indexOf('./') === 0) {
            f = f.substr(2);
        }
        return f;
    };

    var tmp = _.map(meta.main, trimDot);
    meta.main = _.filter(tmp, function(n) {
        return !!n;
    });
    if (instrumentAkamai && meta.name !== 'template-app') {
        var outputDir = j(cdnpath, 'static', meta.name, meta.version);
        meta.mainMin = _.map(meta.main, function(n) {
            var ext = path.extname(n);
            return n.substr(0, n.length - ext.length) + '.min' + ext;
        });
        meta.mainSHA = _.map(meta.main, function(n) {
            var buffer = fs.readFileSync(j(outputDir, n));
            var sha = SHA(buffer);
            return sha + '/' + n;
        });
        meta.mainMinSHA = _.map(meta.mainMin, function(n) {
            var buffer = fs.readFileSync(j(outputDir, n));
            var sha = SHA(buffer);
            return sha + '/' + n;
        });
    }
};

//clean pkgMeta for saving purpose
//the remainings are just essential for composition
var cleanupMeta = function(obj) {
    delete obj.endpoint;
    delete obj._resolution;
    delete obj.nrDependants;
    var meta = obj.pkgMeta;
    obj.pkgMeta = {
        name: meta.name,
        version: meta.version,
        main: meta.main,
        mainMin: meta.mainMin,
        mainSHA: meta.mainSHA,
        mainMinSHA: meta.mainMinSHA,
        _resolution: meta._resolution
    };
};

var reducer = function(prev, cur) {
    return prev.concat(cur);
};

var uniqer = function(item) {
    return item.pkgMeta.name + '#' + item.pkgMeta.version;
};

var stackDeps = function stackDeps(obj, logger, instrumentAkamai) {
    /*jshint maxcomplexity:8 */
    var layerArray = [],
        layer = 0,
        depCache = {},
        warn = logger.warn;

    (function s(obj, layer) {
        normalizeMeta(obj, instrumentAkamai);
        cleanupMeta(obj);
        var pkg = _.pick(obj, 'pkgMeta', 'dependencies', 'canonicalDir', 'regName');
        var cacheHit = (depCache[pkg.pkgMeta.name] || {}).dependencies || {};

        pkg.dependencies = _.extend(pkg.dependencies, cacheHit);

        if (obj.pkgMeta.name !== 'template-app') {
            var t = obj.pkgMeta._resolution.type;
            if (t !== 'version') {
                warn('[%s]: %s%s is not suggested', obj.pkgMeta.name, eol, t);
            }
        }

        layerArray[layer] = layerArray[layer] || [];

        //NOTE:this is a workaround for bower meta dependency missing bug
        //https://github.com/bower/bower/issues/2098
        _.mapObject(pkg.dependencies, function(dep, name) {
            //name here is the bower registry name
            if (depCache[name]) return;
            depCache[name] = dep;
        });

        _.mapObject(pkg.dependencies, function(dep, name) {
            dep.regName = dep.regName || name;
            s(dep, layer + 1);
        });
        layerArray[layer].push(pkg);

    }(obj, layer));
    return layerArray;
};

var parseDeps = function(input, spr, requestType) {
    /*jshint maxcomplexity:8 */
    var ignored = {},
        deps = {},
        error = {},
        isQuery = requestType === 'q';
    spr = spr || /[#:]/;

    input.forEach(function(item) {
        var pair = item.split(spr);
        var v = pair[1][0] === 'v' ? pair[0].substr(1) : pair[1];
        if (deps[pair[0]]) {
            //will not publish same library with differnt version at a single request
            ignored[pair[0]] = deps[pair[0]];
        }

        var resolved = v;
        if (v[0] === '~') {
            if (isQuery) {
                var tildeVersion = v;
                if (v.split('.').length >= 3) {
                    tildeVersion = v.substr(0, indexOf2nd(v, '.'));
                }

                var match = j(metaDir, pair[0], tildeVersion + '.json');
                var info = fs.readJsonSync(match); //TODO, this should also be aync
                if (info) {
                    resolved = info.bestMatch;
                }
            } else {
                error.code = -1;
                error.message = 'tield version match only support in resolve mode';
            }
        }
        deps[pair[0]] = resolved;
    });
    return {
        deps: deps,
        ignored: ignored,
        error: error,
    };
};

var flatDependencies = function(metaObj, logger,instrumentAkamai) {
    var layerArray = stackDeps(metaObj, logger,instrumentAkamai);
    var flatDep = _.chain(layerArray)
        .reduceRight(reducer, [])
        .uniq(uniqer)
        .splice(-1, 1)
        ._wrapped;
    return flatDep;
};

module.exports = {
    parseDeps: parseDeps,
    uniqer: uniqer,
    reducer: reducer,
    stackDeps: stackDeps,
    flatDependencies: flatDependencies
};
