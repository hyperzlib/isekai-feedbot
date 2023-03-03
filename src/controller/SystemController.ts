import App from "../App";
import { CommonReceivedMessage, CommonSendMessage } from "../message/Message";
import { PluginController, PluginEvent } from "../PluginManager";

export default class SystemController implements PluginController {
    public event!: PluginEvent;
    public app: App;

    public id = 'system';
    public name = '系统功能';
    public description = '系统功能控制器';

    constructor(app: App) {
        this.app = app;
    }
    
    async initialize() {
        this.event.init(this);
        
        this.event.autoSubscribe = true;
        this.event.forceSubscribe = true;

        this.event.registerCommand({
            command: '帮助',
            name: '获取帮助',
            alias: ['help', '?', '？'],
        }, (args, message, resolved) => {
            resolved();

            this.handleHelp(args, message);
        });
    }

    async handleHelp(args: string, message: CommonReceivedMessage) {
        const senderInfo = this.app.event.getSenderInfo(message);
        const subscribedControllers = this.app.plugin.getSubscribedControllers(senderInfo);

        let replyMsg = message.createReplyMessage();
        replyMsg.type = 'help';
        replyMsg.extra.controllers = subscribedControllers;

        let helpBuilder: string[] = [];

        let robotDescription = message.receiver.description;
        if (robotDescription) {
            helpBuilder.push(robotDescription);
            helpBuilder.push('');
        }

        helpBuilder.push('功能列表：');

        for (let controller of subscribedControllers) {
            helpBuilder.push(`【${controller.name}】`);
            if (controller.event.commandList.length > 0) {
                controller.event.commandList.forEach(commandInfo => {
                    helpBuilder.push(`/${commandInfo.command} - ${commandInfo.name}`);
                });
            } else {
                helpBuilder.push('此功能没有指令');
            }
            helpBuilder.push('');
        }

        if (helpBuilder[helpBuilder.length - 1] === '') {
            helpBuilder.pop();
        }

        if (this.app.debug) {
            this.app.logger.debug(`收到帮助指令，已找到 ${subscribedControllers.length} 个控制器`);
        }

        replyMsg.content = [{
            type: 'text',
            data: {
                text: helpBuilder.join('\n')
            }
        }];
        
        if (this.app.debug) {
            this.app.logger.debug('发送帮助信息');
        }
        await replyMsg.send();
    }
}