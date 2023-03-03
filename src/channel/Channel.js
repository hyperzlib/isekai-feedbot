import { Utils as utils } from '../utils/Utils';

export default class Channel {
    constructor(app, config){
        this.app = app;
        this.config = config;
    }

    static checkConfig(data){
        if(typeof data !== 'object') return false;
        
        return true;
    }

    setData(data){
        this.config = data;

        this.channelName = data.channel;
        this.baseTemplates = data.templates;
        this.prepareFileList = data.files;
        this.receiver = data.receiver;

        this.initTemplates();
        this.initReceiver();
    }

    bind(){
        this.channel = this.app.pusher.subscribe(this.channelName);
        this.channel.bind_global(this.onPush.bind(this));
    }

    unbind(){
        this.channel.unbind();
    }

    initTemplates(){
        this.template = {};
        for(let key in this.baseTemplates){
            let one = this.baseTemplates[key];
            this.template[key] = this.buildTemplateCallback(one);
        }
    }

    initReceiver(){
        this.getReceiver = this.buildGetReceiver();
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

    getDataVal(data, key, defaultVal = undefined){
        let keyList = key.split('.');
        let finded = data;
        for(let key of keyList){
            if(typeof finded === 'object' && key in finded){
                finded = finded[key];
            } else {
                return defaultVal;
            }
        }
        return finded;
    }

    buildGetReceiver(){
        if(typeof this.receiver === 'string'){
            return (data) => {
                return this.getDataVal(data, this.receiver);
            };
        } else {
            let resultFunc = {};
            for(let type of ['group', 'user']){
                if(type in this.receiver){
                    if(typeof this.receiver[type] === 'string'){
                        resultFunc[type] = (data) => {
                            return this.getDataVal(data, this.receiver[type]);
                        };
                    } else if(Array.isArray(this.receiver[type])) {
                        let staticTargets = [];
                        let paramTargets = [];
                        for(let val of this.receiver[type]){
                            if(typeof val === "number"){
                                staticTargets.push(val);
                            } else {
                                paramTargets.push(val);
                            }
                        }
                        resultFunc[type] = (data) => {
                            let targets = staticTargets.slice();
                            for(let key of paramTargets){
                                targets.push(this.getDataVal(data, key))
                            }
                            return targets;
                        };
                    }
                }
            }
            return (data) => {
                let ret = {};
                if('group' in resultFunc){
                    ret.group = resultFunc.group();
                }
                if('user' in resultFunc){
                    ret.user = resultFunc.user();
                }
                return ret;
            };
        }
    }

    onPush(type, data){
        try {
            if(type.indexOf('pusher:') == 0 || !this.template[type]){
                return;
            }

            let finalMessage = this.template[type](data);
            let receiver = this.getReceiver();
            if(typeof receiver === 'object'){
                if('group' in receiver){
                    this.app.robot.sendToGroup(receiver.group, finalMessage);
                }
                if('user' in receiver){
                    this.app.robot.sendToUser(receiver.user, finalMessage);
                }
            }
        } catch(ex){
            console.log(ex);
        }
    }
}
