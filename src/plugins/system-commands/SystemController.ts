import { PluginController } from "#ibot-api/PluginController";
import App from "#ibot/App";
import { CommonReceivedMessage, CommonSendMessage } from "#ibot/message/Message";
import { CommandInfo, PluginEvent } from "#ibot/PluginManager";

export default class SystemController extends PluginController {
    async initialize() {
        // 基础指令
        this.useScope('common', (event) => {
            event.registerCommand({
                command: '帮助',
                name: '获取帮助',
                alias: ['help', '?', '？'],
            }, (args, message, resolved) => {
                resolved();
    
                this.handleHelp(args.param, message);
            });
        });

        this.useScope('manage', (event) => {
            event.registerCommand({
                command: '测试权限',
                name: '测试权限',
            }, (args, message, resolved) => {
                resolved();

                message.sendReply('权限测试通过');
            });
        });

        this.useScope('admin', (event) => {

        });
    }

    async handleHelp(args: string, message: CommonReceivedMessage) {
        const senderInfo = this.app.event.getSenderInfo(message);
        const subscribedPlugins = this.app.plugin.getSubscribed(senderInfo);

        let replyMsg = message.createReplyMessage();
        replyMsg.type = 'help';
        replyMsg._context.subscribed = subscribedPlugins;

        let helpBuilder: string[] = [];

        let robotDescription = message.receiver.description;
        if (robotDescription) {
            helpBuilder.push(robotDescription);
            helpBuilder.push('');
        }

        helpBuilder.push('功能列表：');

        for (let subscribedItem of subscribedPlugins) {
            let controller = subscribedItem.controller;
            helpBuilder.push(`【${controller.pluginInfo.name}】`);

            let commandList: CommandInfo[] = [];
            for (let eventGroup of subscribedItem.eventGroups) {
                commandList.push(...eventGroup.commandList);
            }
            if (commandList.length > 0) {
                commandList.forEach(commandInfo => {
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
            this.app.logger.debug(`收到帮助指令，已找到 ${subscribedPlugins.length} 个插件`);
        }

        replyMsg.content = [{
            type: ['text'],
            text: helpBuilder.join('\n'),
            data: {},
        }];
        
        if (this.app.debug) {
            this.app.logger.debug('发送帮助信息');
        }
        await replyMsg.send();
    }
}