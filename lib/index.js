// Load modules

var Mongoose = require('mongoose');
var Hoek = require('hoek');
var Joi = require('joi');
var Lodash = require('lodash');


// Declare internals

var internals = {
    schema: Joi.object({
        http: Joi.number().required(),
        specification: Joi.alternatives().try(Joi.func(), Joi.string()).required()
    })
};


exports.register = function (server, options, next) {

    var results = Joi.validate(options || {}, internals.schema);
    Hoek.assert(!results.error, results.error);
    var settings = results.value;

    var specification;
    if (typeof settings.specification === 'function') {
        specification = settings.specification
    }
    else {
        specification = internals[settings.specification];
        if (!specification) {
            return next(new Error('Specification `' + settings.specification + '` not supported yet'));
        }
    }

    // http code to respond
    var http = settings.http;

    // Inspect all response to catch mongoose ValidationError

    server.ext('onPreResponse', function (request, reply) {

        var response = request.response;
        if (response.isBoom) {
            if (response instanceof Mongoose.Error.ValidationError) {
                return reply(specification(response, http)).code(http);
            }

            // If hapi-mongoose-request plugin is present, check for
            // native errors
            if (request.Model) {
                internals.handleNativeError(response, request.Model, function (err) {

                    // Verify if it could convert
                    if (err instanceof Mongoose.Error.ValidationError) {
                        return reply(specification(err, http)).code(http);
                    }

                    return reply.continue();
                })
            } else {
                return reply.continue();
            }
        } else {
            return reply.continue();
        }
    });

    next();
};


exports.register.attributes = {
    pkg: require('../package.json')
};


// http://jsonapi.org
internals.jsonapi = function (err, http) {

    var error = { errors: [] };
    Lodash.each(err.errors, function (validatorError) {

        error.errors.push({
            status: http,
            source: {
                pointer: 'data/attributes/' + validatorError.path
            },
            detail: validatorError.toString()
        });
    });

    return error;
};


internals.handleNativeError = function (err, model, callback) {

    if (!(err.name === 'MongoError')) {
        return Hoek.nextTick(callback)(err);
    }

    // For now only support errors with unique constrain
    // https://docs.mongodb.org/v3.0/core/index-unique/

    if (!(err.code === 11000 || err.code === 11001)) {
        return Hoek.nextTick(callback)(err);
    }

    var regex = /index:\s*.+?\.\$(\S*)\s*dup key:\s*\{.*?:\s*(.*)\s*\}/;
    var match = regex.exec(err.message)

    if (match && match[1]) {
        model.collection.indexInformation(function (dbError, indexes) {

            var error = new Mongoose.Error.ValidationError(err);
            var index = indexes && indexes[match[1]];

            if (!dbError && index) {
                var path;
                var props;
                index.forEach(function (item) {

                    path = model.schema.paths[item[0]];
                    props = {
                        type: 'Duplicate value',
                        path: item[0],
                        value: match[2],
                        message: path.options.uniqueErrorMsg || 'Duplicate value'
                    };
                    error.errors[item[0]] = new Mongoose.Error.ValidatorError(props);
                });

                // Return the error generated on next tick
                err = error;
            }

            return Hoek.nextTick(callback)(err);
        });
    }
    else {
        return Hoek.nextTick(callback)(err);
    }
};
