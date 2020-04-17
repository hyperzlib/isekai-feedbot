var utils = require('./Utils');

class Channel {
    constructor(app, data){
        this.app = app;

        this.initialize(data);
    }

    initialize(data){
        this.config = data;

        this.channelName = data.channel;
        this.baseTemplates = data.templates;
        this.prepareFileList = data.files;
        this.receiver = data.receiver;

        this.initPush();
        this.initTemplates();
    }

    initPush(){
        this.channel = this.app.pusher.subscribe(this.channelName);
        this.channel.bind_global(this.onPush.bind(this));
    }

    initTemplates(){
        this.template = {};
        for(let key in this.baseTemplates){
            let one = this.baseTemplates[key];
            this.template[key] = this.buildTemplateCallback(one);
        }
    }

    initPrepareFileList(){
        this.prepareFileCallback = {};
        for(let key in this.prepareFileList){
            let one = this.prepareFileList[key];
            this.prepareFileCallback[key] = this.buildPrepareFileCallback(one);
        }
    }

    destory(){
        this.app.pusher.unsubscribe(this.channelName);
        this.channel.unbind();
    }

    parseTemplate(template){
        template = template.replace(/\\/g, "\\\\").replace(/\r\n/g, "\n").replace(/\n/g, "\\n").replace(/'/g, "\\'");
        if(template.indexOf('{{') == 0){ //开头是{{
            template = template.substr(2);
        } else {
            template = "'" + template;
        }
        
        if(template.indexOf('}}') == template.length - 2){ //结尾是}}
            template = template.substr(0, template.length - 2);
        } else {
            template = template + "'";
        }

        template = template.replace(/\{\{/g, "' + ").replace(/\}\}/g, " + '");
        return template;
    }

    buildTemplateCallback(template){
        return eval('(function(data){ return ' + this.parseTemplate(template) + '; })').bind(this);
    }

    buildPrepareFileCallback(cond){
        return eval('(function(data){ return ' + cond + '; })').bind(this);
    }

    parseMessage(data){
        try {
            return this.parseTemplate(data);
        } catch(ex){
            return this.baseTemplate;
        }
    }

    onPush(channel, data){
        try {
            if(channel.indexOf('pusher:') == 0 || !this.template[channel]){
                return;
            }

            let finalMessage = this.template[channel](data);
            if(this.receiver.group){
                this.app.robot.sendToGroup(this.receiver.group, finalMessage);
            }
            if(this.receiver.user){
                this.app.robot.sendToUser(this.receiver.user, finalMessage);
            }
        } catch(ex){
            console.log(ex);
        }
    }
}

module.exports = Channel;