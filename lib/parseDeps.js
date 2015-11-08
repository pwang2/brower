'use strict';
module.exports = {
    parseDeps: function(input, spr) {
        var deps = {};
        spr = spr || /[#:]/;
        input.forEach(function(item) {
            var pair = item.split(spr);
            var v = pair[1][0] === 'v' ? pair[0].substr(1) : pair[1];
            deps[pair[0]] = v;
        });
        return deps;
    }
};
