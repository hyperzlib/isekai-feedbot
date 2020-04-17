var Channel = require('./Channel');

class BroadcastChannel extends Channel {
    constructor(app){
        super(app, {});
    }

    initialize(){
        this.channelName = 'broadcast';
        this.baseTemplate = '{{data.message}}';
        this.parseTemplate = this.buildTemplateCallback(this.baseTemplate);

        this.initPush();
    }

    onMessage(data){
        try {
            let finalMessage = this.parseMessage(data);
            if(data.target.group){
                this.app.robot.sendToGroup(data.target.group, finalMessage);
            }
            if(data.target.user){
                this.app.robot.sendToUser(data.target.group, finalMessage);
            }
        } catch(ex){
            console.log(ex);
        }
    }
}

module.exports = BroadcastChannel;