'use strict';
var chakram = require('chakram'),
    path = require('path'),
    j = path.join,
    expect = chakram.expect,
    fs = require('fs-extra'),
    tmpPath,
    runningServer;

describe('Chakram', function() {
    before(function() {
        tmpPath = process.env.CDN_PHYSICAL_PATH;
        fs.removeSync(tmpPath);
        runningServer = require('../../lib/core/serve.js').server().listen(8989);
    });

    it('should publish jquery 1.11.1', function() {
        return chakram.get('http://localhost:8989/p/jquery:1.11.1').then(
            function(response) {
                expect(response).to.have.status(200);
                expect(response).to.have.json('installed', {
                    'jquery': '1.11.1'
                });
            });
    });

    it('should report jquery 1.11.1 already exists', function() {
        return chakram.get('http://localhost:8989/p/jquery:1.11.1').then(
            function(response) {
                expect(response).to.have.status(200);
                expect(response).to.have.json('statuscode', 999);
            });
    });

    it('should report jquery 1.11.1 already exists but also install d3', function() {
        return chakram.get('http://localhost:8989/p/jquery:1.11.1,d3:3.3.3').then(
            function(response) {
                expect(response).to.have.status(200);
                expect(response).to.have.json('installed', {
                    'd3': '3.3.3'
                });
                expect(response).to.have.json('existed', {
                    'jquery': '1.11.1'
                });
            });
    });

    it('should query 1.11.1', function() {
        return chakram.get('http://localhost:8989/q/jquery:1.11.1')
            .then(function(response) {
                expect(response).to.have.status(200);
                expect(response).to.have.json('bundle', {
                    'jquery': '1.11.1'
                });
                expect(response.body.deps[0]).to.contain('dist/jquery.min.js');
            });
    });

    it('should publish ingore the former version of jquery', function() {
        fs.removeSync(tmpPath);
        return chakram.get('http://localhost:8989/p/jquery:2.1.4,jquery:1.11.1')
            .then(function(response) {
                expect(response).to.have.status(200);
                expect(response).to.have.json('installed', {
                    'jquery': '1.11.1'
                });
            });
    });

    it('should query with ~ and return the best Match version', function() {
        var fs = require('fs-extra');
        var j = require('path').join;
        fs.outputJSONSync(j(tmpPath, 'meta', 'jquery', '~1.11.json'), {
            bestMatch: "1.11.3"
        });

        return chakram.get('http://localhost:8989/q/jquery:~1.11.1').then(
            function(response) {
                expect(response).to.have.status(200);
                expect(response.body.error.missings.jquery).to.equal('1.11.3');
            });
    });

    it('should query ignore the former jquery when pass multiple jquery', function() {
        return chakram.get('http://localhost:8989/q/jquery:2.1.4,jquery:1.11.1')
            .then(function(response) {
                expect(response).to.have.status(200);
                expect(response).to.have.json('bundle', {
                    'jquery': '1.11.1'
                });
            });
    });

    it('should report failed of install', function() {
        fs.chmodSync(j(tmpPath, 'meta', 'jquery'), '0000');
        return chakram.get('http://localhost:8989/p/jquery:1.11.3').then(
            function(response) {
                expect(response).to.have.status(200);
                expect(response.body.failed).not.to.equal(undefined);
            });
    });

    it('should publish foundation#5.5.3 which depends on jquery 2.1.4 and publish jquery 2.1.4 as well', function() {
        return chakram.get('http://localhost:8989/p/foundation:5.5.3').then(
            function(response) {
                expect(response).to.have.status(200);
                expect(response).to.have.json('installed', {
                    'foundation': '5.5.3'
                });
                return chakram.get('http://localhost:8989/q/jquery:2.1.4')
                    .then(function(response) {
                        expect(response.body.deps[0]).to.contain('dist/jquery.min.js');
                    });
            });
    });

    it('should ask shim when resolve found different version of jquery', function() {
        return chakram.get('http://localhost:8989/q/foundation:5.5.3,jquery:1.11.1')
            .then(function(response) {
                expect(response).to.have.status(200);
                expect(response.body.error.conflicts.length > 0).to.equal(true);
                expect(response.body.error.conflicts[0][0].indexOf('jquery') > -1).to.equal(true);
            });
    });

    it('should conflict resolved when passing shim of jquery', function() {
        return chakram.get('http://localhost:8989/q/foundation:5.5.3,jquery:1.11.1/shim/jquery:1.11.1')
            .then(function(response) {
                expect(response).to.have.status(200);
                expect(response).not.to.have.json('error');
            });
    });

    it('should echo with jsonp', function() {
        return chakram.get('http://localhost:8989/q/jquery:2.1.4?callback=abcFunc')
            .then(function(response) {
                expect(response.body.indexOf('abcFunc') > -1).to.equal(true);
            });
    });

    it('should echo back the id in querystring', function() {
        return chakram.get('http://localhost:8989/q/jquery:2.1.4?id=idabc')
            .then(function(response) {
                expect(response).to.have.json('id', 'idabc');
            });
    });

    it('should give debug file when passing ?debug', function() {
        return chakram.get('http://localhost:8989/q/jquery:2.1.4?debug')
            .then(function(response) {
                expect(response.body.deps[0]).to.contain('dist/jquery.js');
            });
    });

    it('should overrite ensure jquery load before angular', function() {
        return chakram.get('http://localhost:8989/p/angular-cookies:1.3.15,jquery:2.1.4')
            .then(function() {
                return chakram.get('http://localhost:8989/q/angular-cookies:1.3.15,jquery:2.1.4?overwrite={%22angular%22:%22jquery%22}')
                    .then(function(response) {
                        expect(response.body.deps[0]).to.contain('jquery.min.js');
                    });
            });
    });

    afterEach(function() {
        fs.chmodSync(j(tmpPath, 'meta', 'jquery'), '0777');
    });

    after(function() {
        fs.removeSync(tmpPath);
        runningServer.close();
    });
});
