var fs = require('fs');
var Yaml = require('yaml');
var Pusher = require('pusher');

var config = Yaml.parse(fs.readFileSync('../config.yml', {encoding: 'utf-8'}));

var pusher = new Pusher({
  appId: config.service.pusher.app_id,
  key: config.service.pusher.key,
  secret: config.service.pusher.secret,
  cluster: config.service.pusher.cluster
});

pusher.trigger('debug', 'echo', {
  msg: "推送系统应该已经好了"
});
