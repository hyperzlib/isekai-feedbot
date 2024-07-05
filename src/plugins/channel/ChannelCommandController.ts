import App from "#ibot/App";
import { CommonReceivedMessage } from "#ibot/message/Message";
import { ChatIdentity } from "#ibot/message/Sender";
import { splitPrefix } from "#ibot/utils";
import ChannelFrameworkController from "./PluginController";

export class ChannelCommandController {
    private app: App;
    private mainController: ChannelFrameworkController;

    constructor(app: App, mainController: ChannelFrameworkController) {
        this.app = app;
        this.mainController = mainController;
    }

    public async initialize() {
        this.mainController.useScope('admin', (event) => {
            event.registerCommand({
                command: '订阅频道',
                name: '订阅推送频道',
                help: '订阅一个推送频道，可以使用“频道列表”查看所有可用频道。参数格式为“频道名”或者“频道类型/频道参数”',
                alias: ['订阅推送']
            }, async (context, message, resolved) => {
                resolved();
    
                let channelType = context.param;
                let channelId = 'main';
                if (channelId.indexOf('/') !== -1) {
                    [channelType, channelId] = splitPrefix(channelId, '/');
                }

                return this.addSubscribe(channelType, channelId, message);
            });

            event.registerCommand({
                command: '退订频道',
                name: '退订推送频道',
                help: '退订一个推送频道，可以使用“当前订阅频道”查看所有已订阅频道。参数格式为“频道名”或者“频道类型/频道参数”',
                alias: ['退订推送'],
            }, async (context, message, resolved) => {
                resolved();

                let channelType = context.param;
                let channelId = 'main';
                if (channelId.indexOf('/') !== -1) {
                    [channelType, channelId] = splitPrefix(channelId, '/');
                }

                return this.removeSubscribe(channelType, channelId, message);
            });

            event.registerCommand({
                command: '频道列表',
                name: '查看频道列表',
                help: '查看可以订阅的频道列表',
            }, async (_, message, resolved) => {
                resolved();

                return this.listChannels(message);
            });

            event.registerCommand({
                command: '频道信息',
                name: '查看频道类型的详细信息',
                help: '查看指定频道类型的信息，如：帮助信息、订阅频道参数。参数格式为“频道名”或者“频道类型/频道参数”，例：\n频道信息 test\n频道信息 test/sub1',
            }, async (context, message, resolved) => {
                resolved();

                return this.showChannelInfo(context.param, message);
            });

            event.registerCommand({
                command: '当前订阅频道',
                name: '查看当前订阅的频道列表',
                help: '查看当前订阅的频道列表',
            }, async (_, message, resolved) => {
                resolved();

                return this.listSubscribedChannels(message);
            });

            event.registerCommand({
                command: '频道推送模板',
                name: '查看频道推送模板',
                help: '查看指定频道类型的默认推送模板和自定义推送模板，可以使用“频道推送模板 频道类型”查看指定频道在当前群组的默认推送模板，例如：“频道推送模板 test”。\n' +
                    '使用“设置推送模板”可以更改推送的模板。',
            }, async (context, message, resolved) => {
                resolved();

                return this.showChannelTemplate(context.param, message);
            });

            event.registerCommand({
                command: '设置频道推送模板',
                name: '设置频道推送模板',
                help: '设置指定频道类型的推送模板。\n' +
                    '可以使用“设置频道推送模板 频道类型 模板内容”设置指定频道的推送模板，例如：“设置频道推送模板 test/sub1 推送模板内容”。\n' +
                    '使用“频道推送模板”可以查看当前推送模板。\n' +
                    '使用“重置频道推送模板”可以将当前群组的指定频道推送模板重置为默认。',
            }, async (context, message, resolved) => {
                resolved();

                return this.setChannelCustomTemplate(context.param, message);
            });

            event.registerCommand({
                command: '重置频道推送模板',
                name: '重置频道推送模板',
                help: '将指定频道类型的推送模板重置为默认推送模板，可以使用“重置频道推送模板 频道类型”清除指定频道的推送模板，例如：“重置频道推送模板 test”。\n' +
                    '使用“频道默认推送模板”可以查看默认推送模板。',
            }, async (context, message, resolved) => {
                resolved();

                return this.resetChannelCustomTemplate(context.param, message);
            });
        });
    }

    public async addSubscribe(channelType: string, channelId: string, message: CommonReceivedMessage) {
        try {
            let senderIdentity = message.sender?.identity;

            if (!senderIdentity) {
                await message.sendReply('无法获取发送者信息');
                return;
            }

            await this.mainController.addChannelSubscribe(channelType, channelId, senderIdentity);

            let channelInfo = await this.mainController.getChannelInfo(channelType, channelId);

            await message.sendReply(`已订阅频道：${channelInfo.title}`);
        } catch (err: any) {
            if (err.name === 'NotFoundError') {
                switch (err.message) {
                    case 'Channel type not found':
                        await message.sendReply('频道类型不存在或输入错误');
                        return;
                    case 'Channel not found':
                        await message.sendReply('频道不存在或输入错误');
                        return;
                }
            }
            
            await message.sendReply('订阅频道时出现错误：' + err.message);
        }
    }

    public async removeSubscribe(channelType: string, channelId: string, message: CommonReceivedMessage) {
        try {
            let senderIdentity = message.sender?.identity;

            if (!senderIdentity) {
                await message.sendReply('无法获取发送者信息');
                return;
            }

            let channelInfo = await this.mainController.getChannelInfo(channelType, channelId);

            await this.mainController.removeChannelSubscribe(channelType, channelId, senderIdentity);

            await message.sendReply(`已退订频道：${channelInfo.title}`);
        } catch (err: any) {
            if (err.name === 'NotFoundError') {
                switch (err.message) {
                    case 'Channel type not found':
                        await message.sendReply('频道类型不存在或输入错误');
                        return;
                    case 'Channel not found':
                        await message.sendReply('频道不存在或输入错误');
                        return;
                }
            }
            
            await message.sendReply('订阅频道时出现错误：' + err.message);
        }
    }

    public async listChannels(message: CommonReceivedMessage) {
        let channelTypeList = this.mainController.channelTypeList;
        let msgLines: string[] = ['可用推送频道列表：'];
        for (let [channelType, channelTypeInfo] of Object.entries(channelTypeList)) {
            msgLines.push(`[${channelType}] ${channelTypeInfo.title}`);
        }

        let replyMsg = message.createReplyMessage();
        replyMsg.type = 'channelList';
        replyMsg.content = [{
            type: ['text'],
            text: msgLines.join('\n'),
            data: {},
        }];

        await replyMsg.send();
    }

    public async showChannelInfo(args: string, message: CommonReceivedMessage) {
        args = args.trim();
        if (args.includes('/')) {
            let [channelType, channelId] = splitPrefix(args, '/');
            let channelInfo = await this.mainController.getChannelInfo(channelType, channelId);
            if (!channelInfo) {
                await message.sendReply(`频道未找到：${channelType}/${channelId}`);
            }

            let msgContent = `[${channelType}/${channelId}] ${channelInfo.title}:\n${channelInfo.description ?? '该频道没有详细描述'}`;
            switch (channelInfo.updateMode) {
                case 'push':
                    msgContent += '\n\n更新方式：推送';
                    break;
                case 'poll':
                    msgContent += '\n\n更新方式：定时刷新';
                    break;
            }

            let replyMsg = message.createReplyMessage();
            replyMsg.type = 'channelInfo';
            replyMsg.content = [{
                type: ['text'],
                text: msgContent,
                data: {},
            }];

            await replyMsg.send();
        } else {
            let channelType = args;

            if (!(channelType in this.mainController.channelTypeList)) {
                await message.sendReply(`频道类型未找到：${channelType}`);
            }

            const channelTypeInfo = this.mainController.channelTypeList[channelType];

            let msgContent = `[${channelType}] ${channelTypeInfo.title}:\n${channelTypeInfo.description ?? '该频道类型没有详细描述'}`;
            if (channelTypeInfo.help) {
                msgContent += `\n\n${channelTypeInfo.help}`;
            }

            let replyMsg = message.createReplyMessage();
            replyMsg.type = 'channelInfo';
            replyMsg.content = [{
                type: ['text'],
                text: msgContent,
                data: {},
            }];

            await replyMsg.send();
        }
    }

    public async listSubscribedChannels(message: CommonReceivedMessage) {
        let senderIdentity: ChatIdentity | undefined = message.sender?.identity;

        if (!senderIdentity) {
            await message.sendReply('无法获取发送者信息');
            return;
        }

        const subscribedChannels = this.mainController.getChatSubscribedChannels(senderIdentity);
        if (subscribedChannels.length === 0) {
            await message.sendReply('当前没有订阅的频道');
            return;
        }

        let contentLines: string[] = ['当前聊天订阅了以下推送频道：'];
        for (let [channelType, channelId] of subscribedChannels) {
            let channelTypeInfo = this.mainController.channelTypeList[channelType];
            if (!channelTypeInfo) continue;

            let channelInfo = await channelTypeInfo.getChannelInfo(channelId);
            if (channelInfo) {
                contentLines.push(`[${channelType}/${channelId}] ${channelTypeInfo.title}：${channelInfo.title}`);
            } else {
                contentLines.push(`[${channelType}/${channelId}] ${channelTypeInfo.title}`);
            }
        }

        let replyMsg = message.createReplyMessage();
        replyMsg.type = 'subscribedChannels';
        replyMsg.content = [{
            type: ['text'],
            text: contentLines.join('\n'),
            data: {},
        }];

        await replyMsg.send();
    }

    public async showChannelTemplate(args: string, message: CommonReceivedMessage) {
        let senderIdentity: ChatIdentity | undefined = message.sender?.identity;
        let channelType = args;
        let channelId = '*';
        if (args.includes('/')) {
            [channelType, channelId] = splitPrefix(args, '/');
        }

        let msgContent = '';

        if (!senderIdentity) {
            await message.sendReply('无法获取发送者信息');
            return;
        }

        let channelTypeInfo = this.mainController.channelTypeList[channelType];
        if (!channelTypeInfo) {
            await message.sendReply(`频道类型未找到：${channelType}`);
            return;
        }

        let defaultTemplate = this.mainController.getActualPushTemplate(senderIdentity, channelTypeInfo.templates);
        if (!defaultTemplate) {
            await message.sendReply(`频道类型 ${channelType} 没有默认推送模板`);
            return;
        }

        msgContent += `频道类型 ${channelType} 的默认推送模板：\n${defaultTemplate}`;

        let customTemplate = this.mainController.getCustomTemplate(senderIdentity, channelType, channelId);
        if (customTemplate) {
            msgContent += `\n---\n\n当前聊天的自定义推送模板：\n${customTemplate}`;
        }

        let replyMsg = message.createReplyMessage();
        replyMsg.type = 'channelDefaultTemplate';
        replyMsg.content = [{
            type: ['text'],
            text: msgContent,
            data: {},
        }];

        await replyMsg.send();
    }

    public async resetChannelCustomTemplate(args: string, message: CommonReceivedMessage) {
        let senderIdentity: ChatIdentity | undefined = message.sender?.identity;
        let channelType = args;
        let channelId = '*';
        if (args.includes('/')) {
            [channelType, channelId] = splitPrefix(args, '/');
        }

        if (!senderIdentity) {
            await message.sendReply('无法获取发送者信息');
            return;
        }

        let channelTypeInfo = this.mainController.channelTypeList[channelType];
        if (!channelTypeInfo) {
            await message.sendReply(`频道类型未找到：${channelType}`);
            return;
        }

        this.mainController.removeCustomTemplate(senderIdentity, channelType, channelId);
    }

    public async setChannelCustomTemplate(args: string, message: CommonReceivedMessage) {
        let senderIdentity: ChatIdentity | undefined = message.sender?.identity;

        args = args.trim();
        // 分离参数
        let argLines = args.split('\n');
        let firstLineArgs = argLines[0].split(' ');
        let channelType = '';
        if (firstLineArgs.length > 1) {
            channelType = firstLineArgs.shift()!;
            argLines[0] = firstLineArgs.join(' ');
        } else {
            channelType = firstLineArgs[0];
            argLines.shift();
        }

        let template = argLines.join('\n');

        // 检测频道类型
        let channelId = '*';
        if (channelType.includes('/')) {
            [channelType, channelId] = splitPrefix(args, '/');
        }

        if (!senderIdentity) {
            await message.sendReply('无法获取发送者信息');
            return;
        }

        let channelTypeInfo = this.mainController.channelTypeList[channelType];
        if (!channelTypeInfo) {
            await message.sendReply(`频道类型未找到：${channelType}`);
            return;
        }

        this.mainController.setCustomTemplate(senderIdentity, channelType, channelId, template);

        await message.sendReply(`频道 ${channelType}/${channelId} 的推送模板已设置`);
    }
}