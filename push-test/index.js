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

pusher.trigger('isekai', 'newPage', {
  author: "Hyperzlib",
  title: "沙盒",
  summary: "机器人应该可以用了",
  url: "https://www.isekai.cn/ShaHe"
});
