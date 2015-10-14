# hapi-mongoose-errors

Support for transform mongoose errors to different specifications on Hapi.js

## Install

```bash
$ npm install hapi-mongoose-errors
```

## Usage

```javascript
var Hapi = require('hapi');
var server = new Hapi.Server();
server.connection({ port: 8000 });

server.register([{
        register: require('hapi-mongoose-connect'),
        options: {
            mongooseUri: 'mongodb://localhost/my-database'
        }
    }, {
        register: require('hapi-mongoose-models'),
        options: {
            globPattern: './models/**/*.js',
            globOptions: {
                cwd: __dirname
            }
        }
    }, {
        register: require('hapi-mongoose-request'),
        options: {
            param: 'model',
            capitalize: true,
            singularize: true
        }
    }, {
        register: require('hapi-mongoose-errors'),
        options: {
            specification: 'jsonapi',   // Or custom function (err, http) (REQUIRED)
            http: 422                   // Http code to respond (REQUIRED)
        }   
    }], function (err) {

        if (err) {
            throw err;
        }

        server.route({
            method: 'POST',
            path: '/api/v1/{model}',    // The same is declared in the `hapi-mongoose-request` options
            method: function (request, reply) {

                request.Model.create(request.payload, function (err, doc) {

                    // If you send a Error object, the plugin will check if can convert to declare specification
                    reply(err, doc);
                });
            }
        });

        server.start(function (err) {

            if (err) {
                throw err;
            }
            console.log('Server started at: ' + server.info.uri);
        });
    }
});
```

## Specifications
For now only support [**jsonapi**](http://jsonapi.org). You can implement a custom specification in options:

```javascript
    var Lodash = require('lodash');
    var options = {
        http: 422,
        specification: function (err, http) {

            var error = {};
            Lodash.each(err.errors, function (validatorError) {

                // validationError is a Mongoose.Error.ValidatorError instance

                error[validatorError.path] = {
                    desc: validatorError.toString(),
                    httpStatus: http
                };
            });

            return error;       // New object to send to client
        }
    };
```

## Tests
Run comand `make test` or `npm test`. Include 100% test coverage.

# License
MIT
