// Load modules

var Mongoose = require('mongoose');
var Hoek = require('@hapi/hoek');
var Joi = require('joi');
var Lodash = require('lodash');


// Declare internals

const internals = {};

internals.pkg = require('../package.json');

internals.schema = Joi.object({
    http: Joi.number().required(),
    specification: Joi.alternatives().try(Joi.func(), Joi.string()).required()
});


// http://jsonapi.org
internals.jsonapi = (err, http) => {

    var error = { errors: [] };

    Lodash.each(err.errors, (validatorError) => {
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

internals.handleNativeError = async (err, model) => {

    if (!(err.name === 'MongoError')) {
      return new Promise((resolve) => resolve(err));
    }

    // For now only support errors with unique constrain
    // https://docs.mongodb.org/v3.0/core/index-unique/

    if (!(err.code === 11000 || err.code === 11001)) {
      return new Promise((resolve) => resolve(err));
    }

    var regex = /index:\s*.+?\.\$(\S*)\s*dup key:\s*\{.*?:\s*(.*)\s*\}/;
    var match = regex.exec(err.message)

    console.log(match);
    if (!match || !match[1]) {      
      return new Promise((resolve) => resolve(err));
    }

    return model.collection.indexInformation().then((dbError, indexes) => {

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

        return new Promise((resolve) => resolve(err));
    });
};

internals.register = async (server, options) => {

    options = Hoek.applyToDefaults({}, options);
    var results = internals.schema.validate(options);
    Hoek.assert(!results.error, results.error);
    var settings = results.value;

    var specification;
    if (typeof settings.specification === 'function') {
        specification = settings.specification
    }
    else {
        specification = internals[settings.specification];
        if (!specification) {
            return new Promise((resolve) => resolve(new Error('Specification `' + settings.specification + '` not supported yet')));
        }
    }

    // http code to respond
    var http = settings.http;

    // Inspect all response to catch mongoose ValidationError

    return new Promise((resolve) => {
      server.ext('onPreResponse',  async (request, h) => {

          var response = request.response;

          if (!response.isBoom) {
              return h.continue;
          }

          if (response instanceof Mongoose.Error.ValidationError) {
              return h.response(specification(response, http)).code(http);
          }

          if (!request.Model) {
              return h.continue;
          }

          // If hapi-mongoose-request plugin is present, check for
          // native errors          
          return internals.handleNativeError(response, request.Model)
          .then((err) => {
            // Verify if it could convert
            if (err instanceof Mongoose.Error.ValidationError) {
              return h.response(specification(response, http)).code(http);
            }
            return h.continue;
          });
      });
      resolve();
    });
    
};


module.exports = {
    pkg: internals.pkg,
    register: async (server, options) => { 
      return internals.register(server, options);
    }
};
