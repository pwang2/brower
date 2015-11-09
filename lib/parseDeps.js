'use strict';
module.exports = {
    parseDeps: function(input, spr, ignored) {
        /*jshint maxcomplexity:8 */
        var deps = {};
        spr = spr || /[#:]/;
        input.forEach(function(item) {
            var pair = item.split(spr);
            var v = pair[1][0] === 'v' ? pair[0].substr(1) : pair[1];
            if (ignored) {
                if (deps[pair[0]]) {
                    ignored[pair[0]] = deps[pair[0]];
                }
            }
            deps[pair[0]] = v;
        });
        return deps;
    }
};
