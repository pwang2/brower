'use strict';

var indexOf2nd = function(str, matchstr) {
    var firstIndex = str.indexOf(matchstr);
    if (-1 === firstIndex) {
        return -1;
    }
    return 1 + firstIndex + str.slice(firstIndex + 1).indexOf(matchstr);
};

module.exports = {
    indexOf2nd: indexOf2nd
};
