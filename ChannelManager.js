var fs = require('fs');
var path = require('path');

var Yaml = require('yaml');
var Channel = require('./Channel');
var BroadcastChannel = require('./BroadcastChannel');

class ChannelManager {
    constructor(app, configPath){
        this.app = app;
        this.configPath = configPath;
        this.channels = {};

        this.initChannels();
    }

    initChannels(){
        let files = fs.readdirSync(this.configPath);
        files.forEach((file) => {
            if(!file.match(/\.yml$/)){
                return;
            }
            let name = file.replace(/\.yml$/, '');
            let content = fs.readFileSync(this.configPath + '/' + file, {encoding: 'utf-8'});
            let config = Yaml.parse(content);
            let channel = new Channel(this.app, config);

            this.channels[name] = channel;

            console.log('已加载Channel配置: ' + name + '，对应channel: ' + config.channel);
        });

        this.channels['broadcast'] = new BroadcastChannel(this.app);
    }
}

module.exports = ChannelManager;