const Promise = require('bluebird');
Promise.config({
    cancellation: true,
});

var App = require('./dist/App').default;
new App(__dirname + "/config.yml");