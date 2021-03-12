// Load modules

var Lab = require('@hapi/lab');
var Code = require('@hapi/code');
var Hoek = require('@hapi/hoek');
var Hapi = require('@hapi/hapi');
var Plugin = require('../lib');
var Mongoose = require('mongoose');
var Lodash = require('lodash');
var HapiMongooseRequest = require('hapi-mongoose-request');


// Tests

var lab = exports.lab = Lab.script();

lab.experiment('Hapi-mongoose-errors', () => {

  var Model;
  var ModelWithUnique;


  lab.before(async () => {
      var uri = 'mongodb://localhost/test-hapi-mongoose-request';
      Mongoose.connect(uri);
      
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
      return ModelWithUnique.remove({})
      .then(() => ModelWithUnique.create({ name: 'uniqueName', age: 18 }));
        
  });

  lab.experiment('Hapi-mongoose-errors with function specification', () => {

      var server;
      var specificationIdentifier = 'my-specification';
      var options = {
          http: 422,
          specification: (err, http) => {

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

      lab.before(async () => {        
        
          server = Hapi.server({ port: 3000 });
          return server.start().then(() => {            
            server.route([{
                method: 'POST',
                path: '/',
                handler: (request, h) => Model.create(request.payload)
            }, {
                method: 'POST',
                path: '/test',
                handler: (request, h) => new Error('Ouuhhhh nou!')
            }])
          })        
      });

      lab.test('successfully registered', async () => {
          return server.register([{
              plugin: Plugin,
              options: options
          }]);
      });

      lab.experiment('inject request with bad payload', () => {

          lab.test('it returns object defined in specification with statusCode equal to options', async () => {

              return server.inject({
                  method: 'POST',
                  url: '/',
                  payload: {
                      name: null
                  }
              }).then((response) => {
                  Code.expect(response.result).to.include({ identifier: specificationIdentifier });
                  Code.expect(response.statusCode).to.be.equal(options.http);
              });

          });
      });

      lab.experiment('inject request with correct payload', () => {

          lab.test('it returns object with payload information and statusCode 200', async () => {
              return server.inject({
                  method: 'POST',
                  url: '/',
                  payload: {
                      name: 'Hello world!',
                      age: 21
                  }
              }).then((response) => {
                  Code.expect(response.result.toObject()).to.include({ name: 'Hello world!' });
                  Code.expect(response.statusCode).to.be.equal(200);
              });
          });
      });

      lab.experiment('inject request with not models handler', () => {

          lab.test('it returns Boom object with statusCode 500', async () => {

              return server.inject({
                  method: 'POST',
                  url: '/test'
              }).then((response) => {
                  Code.expect(response.statusCode).to.be.equal(500);
              });
          });
      });

      lab.after(async () => server.stop());
  });

  lab.experiment('Hapi-mongoose-errors with supported specification', () => {

      var server;
      var options = {
          http: 422,
          specification: 'jsonapi'
      };
      
      lab.before(async () => {
        server = Hapi.server({ port: 3000 });
        return server.start();
      });

      lab.test('successfully registered', async () => {

          return server.register([{
              plugin: Plugin,
              options: options
          }]);
      });
      
      lab.after(async () => server.stop());
  });

  lab.experiment('Hapi-mongoose-errors with unsupported specification', () => {

      var server;
      var options = {
          http: 422,
          specification: 'notsupported'
      };

      lab.before(async () => {
        server = Hapi.server({ port: 3000 });
        return server.start();
      });

      lab.test('not registered', async () => {

          return server.register([{
              plugin: Plugin,
              options: options
          }]);
      });
      
      lab.after(async () => server.stop());
  });

  lab.experiment('Hapi-mongoose-errors with `hapi-mongoose-request` support', () => {

      var server;
      var options = {
          http: 422,
          specification: 'jsonapi'
      };

      lab.before(async () => {
        
          server = Hapi.server({ port: 3000 });
          return server.start()
          .then(() => {
              server.route([{
                  method: 'POST',
                  path: '/{model}',
                  handler: async (request, h) =>  {

                      if (!request.payload) {
                          return new Error('Ouuuu nou!');
                      }
                      return ModelWithUnique.create(request.payload);;
                  }
              }, {
                  method: 'POST',
                  path: '/{model}/native/unknown',
                  handler: (request, h) =>  {

                      var error = new Error();
                      error.name = 'MongoError';
                      error.code = 10318;                 // Invalid regex string
                      return error;
                  }
              }, {
                  method: 'POST',
                  path: '/{model}/native/unique',
                  handler: (request, h) =>  {

                      var error = new Error();
                      error.name = 'MongoError';
                      error.code = 11000;                 // Unique index
                      error.message = 'unknown error';

                      return error;
                  }
              }, {
                  method: 'POST',
                  path: '/{model}/native/unique2',
                  handler: (request, h) =>  {

                      var error = new Error();
                      error.name = 'MongoError';
                      error.code = 11000;                 // Unique index

                      // Unknown path
                      error.message = 'E11000 duplicate key error index: test-hapi-mongoose-errors.test2.$unknown_1 dup key: { : "uniqueName" }'

                      return error;
                  }
              }]);
          });
      });

      lab.test('successfully registered', async () => {

          return server.register([{
              plugin: HapiMongooseRequest,
              options: {
                  param: 'model',
                  singularize: false,
                  capitalize: true,
                  mongoose: Mongoose
              }
          }, {
              plugin: Plugin,
              options: options
          }]);
      });

      lab.experiment('inject request with payload who does not have a unique name', () => {

          lab.test('it returns object defined in specification with statusCode equal to options and uniqueErrorMsg it was defined', async () => {

              return server.inject({
                  method: 'POST',
                  url: '/test2',
                  payload: {
                      name: 'uniqueName',
                      age: 45
                  }
              }).then((response) => {
                  Code.expect(response.result.errors).to.deep.include([{
                      detail: 'my-custom-message'
                  }]);
                  Code.expect(response.statusCode).to.be.equal(options.http);
              });
          });

          lab.test('it returns object defined in specification with statusCode equal to options and default message', async () => {

              return server.inject({
                  method: 'POST',
                  url: '/test2',
                  payload: {
                      name: 'new',
                      age: 18
                  }
              }).then((response) => {
                  Code.expect(response.result.errors).to.deep.include([{
                      detail: 'Duplicate value'
                  }]);
                  Code.expect(response.statusCode).to.be.equal(options.http);
              });
          });
      });

      lab.experiment('inject request with not payload', () => {

          lab.test('it returns Boom object with statusCode 500', async () => {

              return server.inject({
                  method: 'POST',
                  url: '/test2'
              }).then((response) => {
                  Code.expect(response.statusCode).to.be.equal(500);
              });
          });
      });

      lab.experiment('inject request searching a mongodb native error diferent to 1100', () => {

          lab.test('it returns Boom object with statusCode 500', async () => {

              return server.inject({
                  method: 'POST',
                  url: '/test2/native/unknown'
              }).then((response) => {
                  Code.expect(response.statusCode).to.be.equal(500);
              });
          });
      });

      lab.experiment('inject request searching a mongodb native error with unknown message', () => {

          lab.test('it returns Boom object with statusCode 500', async () => {

              return server.inject({
                  method: 'POST',
                  url: '/test2/native/unique'
              }).then((response) => {
                  Code.expect(response.statusCode).to.be.equal(500);
              });
          });
      });

      lab.experiment('inject request searching a mongodb native error with unknown path', () => {

          lab.test('it returns Boom object with statusCode 500', async () => {

              return server.inject({
                  method: 'POST',
                  url: '/test3/native/unique2'
              }).then((response) => {
                  Code.expect(response.statusCode).to.be.equal(500);
              });
          });
      });    

      lab.after(async () => server.stop());
  });

  lab.after(async () => Mongoose.disconnect());

});
