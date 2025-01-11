import { NotFoundError } from "#ibot-api/error/errors";
import { PluginController } from "#ibot-api/PluginController";
import { CommonReceivedMessage } from "#ibot/message/Message";
import { CommandInfo } from "#ibot/PluginManager";
import { SystemManagerFramework } from "./SystemManagerFramework";

export default class SystemController extends PluginController {
    public manager!: SystemManagerFramework;

    async initialize() {
        this.manager = new SystemManagerFramework(this.app);

        // 基础指令
        this.useScope('main', (event) => {
            event.registerCommand({
                command: '帮助',
                name: '获取帮助',
                alias: ['help'],
            }, (args, message, resolved) => {
                resolved();
    
                this.handleHelp(args.param, message);
            });
        });

        this.useScope('admin', (event) => {
            event.registerCommand({
                command: '启用插件',
                name: '在当前群组中启用插件',
                alias: ['enableplug'],
            }, (args, message, resolved) => {
                resolved();

                this.handleEnablePlugin(args.param, message);
            });

            event.registerCommand({
                command: '禁用插件',
                name: '在当前群组中禁用插件',
                alias: ['disableplug'],
            }, (args, message, resolved) => {
                resolved();

                this.handleDisablePlugin(args.param, message);
            });
        });
    }

    async handleHelp(args: string, message: CommonReceivedMessage) {
        const senderInfo = this.app.event.getSenderInfo(message);
        const subscribedPlugins = this.app.plugin.getSubscribed(senderInfo);

        const userRules = new Set(await this.app.role.getUserRules(senderInfo));

        if (args) { // 获取指定插件的帮助
            let inputCommand = args.trim();
            for (let subscribedItem of subscribedPlugins) {
                let controller = subscribedItem.controller;
                for (let eventGroup of subscribedItem.eventGroups) {
                    for (let commandInfo of eventGroup.commandList) {
                        if (commandInfo.command === inputCommand || commandInfo.alias?.includes(inputCommand)) {
                            if (!userRules.has(eventGroup.ruleId)) {
                                await message.sendReply(`缺少使用此指令的必要权限`);
                                return;
                            }

                            let replyMsg = message.createReplyMessage();
                            replyMsg.type = 'commandHelp';
                            replyMsg._context.subscribed = subscribedPlugins;
                            replyMsg.content = [{
                                type: ['text'],
                                text: `【${controller.pluginInfo.name}】${commandInfo.name}\n\n${commandInfo.help ?? '此指令没有更详细的帮助'}`,
                                data: {},
                            }];
                            
                            await replyMsg.send();
                            return;
                        }

                    }
                }
            }

            await message.sendReply(`未找到指令：${inputCommand}`);
        } else {
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
                    if (!userRules.has(eventGroup.ruleId)) {
                        continue; // 没有权限的指令不显示
                    }

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

    async handleEnablePlugin(args: string, message: CommonReceivedMessage) {
        let pluginAndScope = args.trim();

        if (!pluginAndScope) {
            await message.sendReply('请提供插件ID');
            return;
        }

        const senderInfo = this.app.event.getSenderInfo(message);
        try {
            this.manager.adminSetPluginEnabled(senderInfo, pluginAndScope, true);
        } catch (err) {
            if (err instanceof NotFoundError) {
                await message.sendReply('未找到订阅项');
            } else {
                await message.sendReply('启用插件失败');
                console.error('Cannot change plugin enable status: ', err);
            }

            return;
        }

        await message.sendReply('启用插件成功');
    }

    async handleDisablePlugin(args: string, message: CommonReceivedMessage) {
        let pluginAndScope = args.trim();

        if (!pluginAndScope) {
            await message.sendReply('请提供插件ID');
            return;
        }

        const senderInfo = this.app.event.getSenderInfo(message);
        try {
            this.manager.adminSetPluginEnabled(senderInfo, pluginAndScope, false);
        } catch (err) {
            if (err instanceof NotFoundError) {
                await message.sendReply('未找到订阅项');
            } else {
                await message.sendReply('禁用插件失败');
                console.error('Cannot change plugin enable status: ', err);
            }

            return;
        }

        await message.sendReply('禁用插件成功');
    }
}