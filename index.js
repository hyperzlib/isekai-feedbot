var fs = require('fs');

var Yaml = require('yaml');
var QQRobot = require('./QQRobot');
var ChannelManager = require('./ChannelManager');
var Pusher = require('pusher-js');

class App {
    constructor(){
        this.config = Yaml.parse(fs.readFileSync('./config.yml', {encoding: 'utf-8'}));

        this.initRobot();
        this.initPusher();
        this.initChannelManager();
        console.log('加载完成，正在接收消息');
    }

    initRobot(){
        this.robot = new QQRobot(this.config.robot);
    }

    initPusher(){
        this.pusher = new Pusher(this.config.pusher.key, {
            cluster: this.config.pusher.cluster,
            forceTLS: true,
        });
        if(this.config.debug){
            Pusher.logToConsole = true;
        }
    }

    initChannelManager(){
        this.channels = new ChannelManager(this, this.config.channel_config_path);
    }
}

new App();