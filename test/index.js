// Load modules

var Lab = require('lab');
var Code = require('code');
var Hoek = require('hoek');
var Hapi = require('hapi');
var Plugin = require('../lib');
var Mongoose = require('mongoose');
var Lodash = require('lodash');
var HapiMongooseRequest = require('hapi-mongoose-request');


// Tests

var lab = exports.lab = Lab.script();
var Model;
var ModelWithUnique;

lab.before(function (done) {

    var uri = 'mongodb://localhost/test-hapi-mongoose-request';

    Mongoose.connect(uri, function (err) {

        Hoek.assert(!err, err);
        return done();
    });
});

// Create a model for test.

lab.before(function (done) {

    Model = Mongoose.model('Test', new Mongoose.Schema({
        name: {
            type: String,
            required: true
        }
    }));

    ModelWithUnique = Mongoose.model('Test2', new Mongoose.Schema({
        name: {
            type: String,
            required: true,
            unique: true,
            uniqueErrorMsg: 'my-custom-message'     // Custom message
        },
        age: {
            type: Number,
            required: true,
            unique: true
        }
    }));

    // Model without indexes
    Mongoose.model('Test3', new Mongoose.Schema({
        _id: Boolean
    }));

    // Create a initial doc to handle mongodb native error
    return ModelWithUnique.remove({}, function () {

        ModelWithUnique.create({ name: 'uniqueName', age: 18 }, function (err) {

            return done(err);
        })
    });
});

lab.experiment('Hapi-mongoose-errors with function specification', function () {

    var server;
    var specificationIdentifier = 'my-especification';
    var options = {
        http: 422,
        specification: function (err, http) {

            var error = {};
            Lodash.each(err.errors, function (validatorError) {
                error[validatorError.path] = {
                    desc: validatorError.toString(),
                    httpStatus: http
                };
            });

            error.identifier = specificationIdentifier;
            return error;
        }
    };

    lab.before(function (done) {

        server = new Hapi.Server();
        server.connection({ port: 3000 });
        server.route([{
            method: 'POST',
            path: '/',
            handler: function (request, reply) {

                Model.create(request.payload, function (err, doc) {

                    return reply(err, doc);
                });
            }
        }, {
            method: 'POST',
            path: '/test',
            handler: function (request, reply) {

                reply(new Error('Ouuhhhh nou!'));
            }
        }]);
        return done();
    });

    lab.test('successfully registered', function (done) {

        server.register({
            register: Plugin,
            options: options
        }, function (err) {

            Code.expect(err).to.not.exist();
            return done();
        });
    });

    lab.experiment('inject request with bad payload', function () {

        lab.test('it returns object definided in specification with statusCode equal to options', function (done) {

            server.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: null
                }
            }, function (response) {

                Code.expect(response.result).to.include({ identifier: specificationIdentifier });
                Code.expect(response.statusCode).to.be.equal(options.http);
                return done();
            });
        });
    });

    lab.experiment('inject request with correct payload', function () {

        lab.test('it returns object with payload information and statusCode 200', function (done) {

            server.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'Hello world!',
                    age: 21
                }
            }, function (response) {
                Code.expect(response.result.toObject()).to.include({ name: 'Hello world!' });
                Code.expect(response.statusCode).to.be.equal(200);
                return done();
            });
        });
    });

    lab.experiment('inject request with not models handler', function () {

        lab.test('it returns Boom object with statusCode 500', function (done) {

            server.inject({
                method: 'POST',
                url: '/test'
            }, function (response) {
                Code.expect(response.statusCode).to.be.equal(500);
                return done();
            });
        });
    });

    lab.after(function (done) {

        server.stop(done);
    });
});

lab.experiment('Hapi-mongoose-errors with supported specification', function () {

    var server;
    var options = {
        http: 422,
        specification: 'jsonapi'
    };

    lab.before(function (done) {

        server = new Hapi.Server();
        server.connection({ port: 3001 });

        return done();
    });

    lab.test('successfully registered', function (done) {

        server.register({
            register: Plugin,
            options: options
        }, function (err) {

            Code.expect(err).to.not.exist();
            return done();
        });
    });

    lab.after(function (done) {

        server.stop(done);
    });
});

lab.after(function (done) {

    Mongoose.disconnect(done);
});

lab.experiment('Hapi-mongoose-errors with unsupported specification', function () {

    var server;
    var options = {
        http: 422,
        specification: 'notsupported'
    };

    lab.before(function (done) {

        server = new Hapi.Server();
        server.connection({ port: 3001 });

        return done();
    });

    lab.test('not registered', function (done) {

        server.register({
            register: Plugin,
            options: options
        }, function (err) {

            Code.expect(err).to.exist();
            return done();
        });
    });

    lab.after(function (done) {

        server.stop(done);
    });
});

lab.experiment('Hapi-mongoose-errors with `hapi-mongoose-request` support', function () {

    var server;
    var options = {
        http: 422,
        specification: 'jsonapi'
    };

    lab.before(function (done) {

        server = new Hapi.Server();
        server.connection({ port: 3001 });

        server.route([{
            method: 'POST',
            path: '/{model}',
            handler: function (request, reply) {

                if (!request.payload) {

                    return reply(new Error('Ouuuu nou!'));
                }

                ModelWithUnique.create(request.payload, function (err, doc) {

                    return reply(err, doc);
                });
            }
        }, {
            method: 'POST',
            path: '/{model}/native/unknown',
            handler: function (request, reply) {

                var error = new Error();
                error.name = 'MongoError';
                error.code = 10318;                 // Invalid regex string
                return reply(error);
            }
        }, {
            method: 'POST',
            path: '/{model}/native/unique',
            handler: function (request, reply) {

                var error = new Error();
                error.name = 'MongoError';
                error.code = 11000;                 // Unique index
                error.message = 'unknown error';

                return reply(error);
            }
        }, {
            method: 'POST',
            path: '/{model}/native/unique2',
            handler: function (request, reply) {

                var error = new Error();
                error.name = 'MongoError';
                error.code = 11000;                 // Unique index

                // Unknown path
                error.message = 'E11000 duplicate key error index: test-hapi-mongoose-errors.test2.$unknown_1 dup key: { : "uniqueName" }'

                return reply(error);
            }
        }]);

        return done();
    });

    lab.test('successfully registered', function (done) {

        server.register([{
            register: HapiMongooseRequest,
            options: {
                param: 'model',
                singularize: false,
                capitalize: true
            }
        }, {
            register: Plugin,
            options: options
        }], function (err) {

            Code.expect(err).to.not.exist();
            return done();
        });
    });

    lab.experiment('inject request with payload who does not have a unique name', function () {

        lab.test('it returns object definided in specification with statusCode equal to options and uniqueErrorMsg it was defined', function (done) {

            server.inject({
                method: 'POST',
                url: '/test2',
                payload: {
                    name: 'uniqueName',
                    age: 45
                }
            }, function (response) {

                Code.expect(response.result.errors).to.deep.include([{
                    detail: 'my-custom-message'
                }]);
                Code.expect(response.statusCode).to.be.equal(options.http);
                return done();
            });
        });

        lab.test('it returns object definided in specification with statusCode equal to options and default message', function (done) {

            server.inject({
                method: 'POST',
                url: '/test2',
                payload: {
                    name: 'new',
                    age: 18
                }
            }, function (response) {

                Code.expect(response.result.errors).to.deep.include([{
                    detail: 'Duplicate value'
                }]);
                Code.expect(response.statusCode).to.be.equal(options.http);
                return done();
            });
        });
    });

    lab.experiment('inject request with not payload', function () {

        lab.test('it returns Boom object with statusCode 500', function (done) {

            server.inject({
                method: 'POST',
                url: '/test2'
            }, function (response) {

                Code.expect(response.statusCode).to.be.equal(500);
                return done();
            });
        });
    });

    lab.experiment('inject request searching a mongodb native error diferent to 1100', function () {

        lab.test('it returns Boom object with statusCode 500', function (done) {

            server.inject({
                method: 'POST',
                url: '/test2/native/unknown'
            }, function (response) {

                Code.expect(response.statusCode).to.be.equal(500);
                return done();
            });
        });
    });

    lab.experiment('inject request searching a mongodb native error with unknown message', function () {

        lab.test('it returns Boom object with statusCode 500', function (done) {

            server.inject({
                method: 'POST',
                url: '/test2/native/unique'
            }, function (response) {

                Code.expect(response.statusCode).to.be.equal(500);
                return done();
            });
        });
    });

    lab.experiment('inject request searching a mongodb native error with unknown path', function () {

        lab.test('it returns Boom object with statusCode 500', function (done) {

            server.inject({
                method: 'POST',
                url: '/test3/native/unique2'
            }, function (response) {

                Code.expect(response.statusCode).to.be.equal(500);
                return done();
            });
        });
    });

    lab.after(function (done) {

        server.stop(done);
    });
});

lab.after(function (done) {

    Mongoose.disconnect(done);
});
