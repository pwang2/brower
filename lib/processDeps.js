'use strict';
var _ = require('underscore'),
    eol = require('os').EOL;
var normalizeMeta = function(obj) {
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
        _resolution: meta._resolution
    };
};

var reducer = function(prev, cur) {
    return prev.concat(cur);
};

var uniqer = function(item) {
    return item.pkgMeta.name + '#' + item.pkgMeta.version;
};

var stackDeps = function stackDeps(obj, forSave, logger) {
    /*jshint maxcomplexity:8 */
    var layerArray = [],
        layer = 0,
        warn = logger.warn;

    (function s(obj, layer, forSave) {
        normalizeMeta(obj);
        cleanupMeta(obj);

        var pkg = _.pick(obj, 'pkgMeta', 'dependencies', 'canonicalDir');
        if (forSave) {
            delete obj.canonicalDir;
            delete obj.pkgMeta._resolution;
        } else {
            if (obj.pkgMeta.name !== 'template-app') {
                var t = obj.pkgMeta._resolution.type;
                if (t !== 'version') {
                    warn('[%s]: %s%s is not suggested', obj.pkgMeta.name, eol, t);
                }
            }
        }

        layerArray[layer] = layerArray[layer] || [];
        _.mapObject(pkg.dependencies, function(dep) {
            s(dep, layer + 1, forSave);
        });
        layerArray[layer].push(pkg);

    }(obj, layer, forSave));

    return layerArray;
};

module.exports = {
    uniqer: uniqer,
    reducer: reducer,
    stackDeps: stackDeps
};
