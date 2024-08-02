import TelegramBot from "node-telegram-bot-api";
import App from "../../App";
import { RobotConfig } from "../../types/config";
import { CommonMessage, CommonReceivedMessage, CommonSendMessage, MessageChunk } from "../../message/Message";
import { CommandInfo, EventScope } from "../../PluginManager";
import { RobotAdapter } from "../Robot";
import { asleep } from "#ibot/utils";
import { PluginInitializedEvent } from "#ibot/types/event";
import { BaseSender, ChannelInfoType, ChatIdentity, GroupInfoType, GroupUserInfoType, RootGroupInfoType, UserInfoType } from "#ibot/message/Sender";
import { MessageSchemaType } from "#ibot/odm/Message";

export type TelegramRobotConfig = RobotConfig & {
    token: string;
    proxy?: string;
}

export default class TelegramRobot implements RobotAdapter {
    private app: App;

    public type = 'telegram';
    public robotId: string;
    public userId?: string;
    public description: string;

    private bot: TelegramBot;
    private events: EventScope;

    public constructor(app: App, robotId: string, config: TelegramRobotConfig) {
        this.app = app;
        
        this.robotId = robotId;
        this.description = config.description ?? app.config.robot_description ?? 'Isekai Feedbot for Telegram';

        let botOptions: any = {
            polling: true
        };
        if (config.proxy) {
            botOptions.request = {
                proxy: config.proxy
            };
        }

        this.bot = new TelegramBot(config.token, botOptions);
        this.events = new EventScope(this.app, 'bot/telegram', 'main');

        this.events.on<PluginInitializedEvent>('plugin/initialized', async () => {
            await this.initCommands();
        });
    }
    destroy?: (() => Promise<any>) | undefined;
    sendMessage(message: CommonSendMessage): Promise<CommonSendMessage> {
        throw new Error("Method not implemented.");
    }
    retrieveMediaUrl?(mediaMessageChunk: MessageChunk): Promise<void> {
        throw new Error("Method not implemented.");
    }
    getUsersInfo?(userIds: string[]): Promise<(UserInfoType | null)[]> {
        throw new Error("Method not implemented.");
    }
    getGroupInfo?(groupId: string, rootGroupId?: string): Promise<GroupInfoType | null> {
        throw new Error("Method not implemented.");
    }
    getRootGroupInfo?(rootGroupId: string): Promise<RootGroupInfoType | null> {
        throw new Error("Method not implemented.");
    }
    getChannelInfo?(channelId: string): Promise<ChannelInfoType | null> {
        throw new Error("Method not implemented.");
    }
    getGroupUsersInfo?(userIds: string[], groupId: string, rootGroupId?: string): Promise<(GroupUserInfoType | null)[]> {
        throw new Error("Method not implemented.");
    }
    kickGroupUser?(groupId: string, userId: string): Promise<boolean> {
        throw new Error("Method not implemented.");
    }
    parseDBMessage?(dbMessage: MessageSchemaType): Promise<CommonMessage> {
        throw new Error("Method not implemented.");
    }

    public async initialize() {
        
    }

    public async initCommands() {
        this.bot.setMyCommands([
            { command: 'start', description: '显示机器人简介信息' },
            { command: 'getchatid', description: '获取当前会话的id' }
        ], {
            language_code: 'zh'
        });

        this.bot.onText(/^\/start/, async (message) => {
            const chatId = message.chat.id;
            this.bot.sendMessage(chatId, '这是异世界百科的推送机器人，目前还未开放加入其他群组的功能。');
        });

        this.bot.onText(/^\/getchatid/, async (message) => {
            const chatId = message.chat.id;
            this.bot.sendMessage(chatId, '当前会话ID：' + chatId);
        });
    }

    private getChatIdFromMessage(message: CommonReceivedMessage) {
        const sender = message.sender as BaseSender;
        return sender.targetId;
    }

    private getTargetChatId(chatIdentity: ChatIdentity) {
        switch (chatIdentity.type) {
            case 'private':
                return chatIdentity.userId!;
            case 'group':
                return chatIdentity.groupId!;
            case 'channel':
                return chatIdentity.channelId!;
        }

        return '';
    }

    public async markRead(message: CommonReceivedMessage): Promise<boolean> {
        return true;
    }

    public async sendTyping(chatIdentity: ChatIdentity, typing: boolean): Promise<boolean> {
        if (typing) {
            const chatId = this.getTargetChatId(chatIdentity);
            this.bot.sendChatAction(chatId, 'typing');
        }

        return true;
    }

    public async deleteMessage(chatIdentity: ChatIdentity, messageId: string): Promise<boolean> {
        const chatId = this.getTargetChatId(chatIdentity);
        return await this.bot.deleteMessage(chatId, messageId);
    }
}