var Pusher = require('pusher');

var pusher = new Pusher({
  appId: '',
  key: '',
  secret: '',
  cluster: ''
});

pusher.trigger('debug', 'message', {"message": "Isekai Puser远端推送测试 （二周目）"});