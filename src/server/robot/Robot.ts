import { Reactive, reactive } from "#ibot/utils/reactive";
import App from "../App";
import { CacheStore } from "../CacheManager";
import { CommandInfo } from "../PluginManager";
import { RestfulRouter, RestfulWsRouter } from "../RestfulApiManager";
import { CommonReceivedMessage, CommonSendMessage, MessageChunk, CommonMessage, MessageDirection } from "../message/Message";
import { ChatIdentity, UserInfoType, GroupInfoType, RootGroupInfoType, ChannelInfoType, GroupUserInfoType, UserSender, BaseSender, GroupSender } from "../message/Sender";
import { MessageDataType, MessageSchemaType } from "../odm/Message";
import { RobotStorage } from "../storage/RobotStorage";

export interface RobotAdapter {
    type: string;
    robotId?: string;
    userId?: string;
    description?: string;
    initialize?: (wrapper: Robot<RobotAdapter>) => Promise<any>;
    destroy?: () => Promise<any>;
    markRead?(message: CommonReceivedMessage): Promise<boolean>;
    sendTyping?(chatIdentity: ChatIdentity, typing: boolean): Promise<boolean>;
    sendMessage(message: CommonSendMessage): Promise<CommonSendMessage>;
    deleteMessage?(chatIdentity: ChatIdentity, messageId: string): Promise<boolean>;
    retrieveMediaUrl?(mediaMessageChunk: MessageChunk): Promise<void>;

    getUsersInfo?(userIds: string[]): Promise<(UserInfoType | null)[]>;
    getGroupInfo?(groupId: string, rootGroupId?: string): Promise<GroupInfoType | null>;
    getRootGroupInfo?(rootGroupId: string): Promise<RootGroupInfoType | null>;
    getChannelInfo?(channelId: string): Promise<ChannelInfoType | null>;
    getGroupUsersInfo?(userIds: string[], groupId: string, rootGroupId?: string): Promise<(GroupUserInfoType | null)[]>;

    kickGroupUser?(groupId: string, userId: string): Promise<boolean>;

    parseDBMessage?(dbMessage: MessageSchemaType): Promise<CommonMessage>;
}

export class Robot<Adapter extends RobotAdapter = any> {
    public type: string;
    public robotId: string;
    public description: string = '';

    // 机器人配置项
    public commandPrefix: string[] = ['/'];
    public account: string = '';

    public adapter: Adapter;
    public storages?: RobotStorage;

    private app: App;

    constructor(app: App, robotId: string, adapter: Adapter) {
        this.app = app;

        this.robotId = robotId;
        this.adapter = adapter;
        this.type = adapter.type;
        this.description = adapter.description || '';
    }

    async initialize() {
        // Storages
        this.storages = await this.app.storage.getStorages(this.robotId);

        await this.adapter.initialize?.(this);
    }

    async destroy() {
        await this.adapter.destroy?.();
    }

    public getSession(chatIdentity: ChatIdentity, type: string) {
        const sessionPath = this.app.robot.getSessionPath(chatIdentity, type);
        return this.app.cache.getStore(sessionPath);
    }

    /**
     * 标记消息已读
     * @param message 
     * @returns 
     */
    public markRead(message: CommonReceivedMessage): Promise<boolean> {
        return this.adapter.markRead ? this.adapter.markRead(message) : Promise.resolve(false);
    }

    /**
     * 发送正在输入状态
     * @param chatIdentity 
     * @param typing
     * @returns 
     */
    public sendTyping(chatIdentity: ChatIdentity, typing: boolean): Promise<boolean> {
        return this.adapter.sendTyping ? this.adapter.sendTyping(chatIdentity, typing) : Promise.resolve(false);
    }

    /**
     * 在函数执行时保持输入状态
     * @param chatIdentity 
     * @param callback 
     */
    async wrapTyping(chatIdentity: ChatIdentity, callback: () => Promise<any>): Promise<any> {
        let timer = setInterval(() => {
            this.sendTyping(chatIdentity, true);
        });

        this.sendTyping(chatIdentity, true);

        try {
            await callback();
            clearInterval(timer);
            this.sendTyping(chatIdentity, false);
        } catch(err) {
            clearInterval(timer);
            this.sendTyping(chatIdentity, false);
            throw err;
        }
    }

    /**
     * 发送消息
     * @param message 
     * @returns 
     */
    public sendMessage(message: CommonSendMessage): Promise<CommonSendMessage> {
        return this.adapter.sendMessage ? this.adapter.sendMessage(message) : Promise.resolve(message);
    }

    /**
     * 删除消息
     * @param chatIdentity 
     * @param messageId 
     * @returns 
     */
    public deleteMessage(chatIdentity: ChatIdentity, messageId: string): Promise<boolean> {
        return this.adapter.deleteMessage ? this.adapter.deleteMessage(chatIdentity, messageId) : Promise.resolve(false);
    }

    /**
     * 获取消息的媒体文件URL，并更新消息内容
     * @param mediaMessageChunk 
     * @returns 
     */
    public retrieveMediaUrl(mediaMessageChunk: MessageChunk): Promise<void> {
        return this.adapter.retrieveMediaUrl ? this.adapter.retrieveMediaUrl(mediaMessageChunk) : Promise.resolve();
    }

    /**
     * 解析数据库中的消息
     * @param dbMessage 
     * @returns 
     */
    public async parseDBMessage(dbMessage: MessageSchemaType): Promise<Reactive<CommonMessage> | null> {
        let parsedMessage: CommonMessage | null = null;

        if (this.adapter.parseDBMessage) {
            parsedMessage = await this.adapter.parseDBMessage(dbMessage);
        } else {
            let dbChatIdentity: ChatIdentity = (dbMessage.chatIdentity as any).toObject();
            const chatIdentity: ChatIdentity = {
                ...dbChatIdentity,
                robot: this,
                type: dbMessage.chatType,
            };

            if (dbMessage.direction === MessageDirection.RECEIVE) {
                let sender: UserSender | GroupSender | null = null;
                if (dbMessage.chatType === 'private' && dbMessage.chatIdentity.userId) {
                    sender = new UserSender(this, dbMessage.chatIdentity.userId);
                    let userInfo = await this.storages?.userInfo.get(dbMessage.chatIdentity.userId);

                    if (userInfo) {
                        sender.userName = userInfo.userName;
                        sender.nickName = userInfo.nickName;
                    }
                } else if (dbMessage.chatType === 'group' && dbMessage.chatIdentity.userId && dbMessage.chatIdentity.groupId) {
                    sender = new GroupSender(this, dbMessage.chatIdentity.groupId, dbMessage.chatIdentity.userId);
                    let userInfo = await this.storages?.userInfo.get(dbMessage.chatIdentity.userId);
                    let rootGroupInfo = dbMessage.chatIdentity.rootGroupId ?
                        await this.storages?.rootGroupInfo.get(dbMessage.chatIdentity.rootGroupId) :
                        null;
                    let groupInfo = await this.storages?.groupInfo.get(dbMessage.chatIdentity.groupId, dbMessage.chatIdentity.rootGroupId);
                    let groupUserInfo = await this.storages?.groupUserInfo.get(dbMessage.chatIdentity.userId, dbMessage.chatIdentity.groupId);

                    if (userInfo) {
                        sender.userName = userInfo.userName;
                        sender.globalNickName = userInfo.nickName;
                    }

                    if (rootGroupInfo) {
                        sender.rootGroupName = rootGroupInfo.name;
                    }

                    if (groupInfo) {
                        sender.groupName = groupInfo.name;
                    }

                    if (groupUserInfo) {
                        sender.userName = groupUserInfo.userName;
                        sender.nickName = groupUserInfo.nickName;
                    }
                }
                
                if (sender) {
                    let message = new CommonReceivedMessage(this, sender, dbMessage.messageId);

                    message.content = dbMessage.content;
                    message.repliedId = dbMessage.repliedMessageId;
                    message.mentions = dbMessage.mentionedUserIds?.map((userId) => {
                        return {
                            userId,
                        };
                    }) ?? [];
                    message.time = dbMessage.time;
                }
            } else if (dbMessage.direction === MessageDirection.SEND) {
                let message = new CommonSendMessage(this, dbMessage.chatType, chatIdentity, dbMessage.content);
                message.id = dbMessage.messageId;
                message.repliedId = dbMessage.repliedMessageId;
                message.mentions = dbMessage.mentionedUserIds?.map((userId) => {
                    return {
                        userId,
                    };
                }) ?? [];
                message.time = dbMessage.time;
                message.extra = reactive(dbMessage.extra);

                parsedMessage = message;
            }
        }

        if (parsedMessage) {
            if (this.storages) {
                return this.storages.message.reactive(parsedMessage);
            } else {
                return reactive(parsedMessage);
            }
        }

        return null;
    }

    getUsersInfo(userIds: string[]): Promise<(UserInfoType | null)[]> {
        return this.adapter.getUsersInfo ? this.adapter.getUsersInfo(userIds) : Promise.resolve([]);
    }

    getGroupInfo(groupId: string, rootGroupId?: string): Promise<GroupInfoType | null> {
        return this.adapter.getGroupInfo ? this.adapter.getGroupInfo(groupId, rootGroupId) : Promise.resolve(null);
    }

    getRootGroupInfo(rootGroupId: string): Promise<RootGroupInfoType | null> {
        return this.adapter.getRootGroupInfo ? this.adapter.getRootGroupInfo(rootGroupId) : Promise.resolve(null);
    }

    getChannelInfo(channelId: string): Promise<ChannelInfoType | null> {
        return this.adapter.getChannelInfo ? this.adapter.getChannelInfo(channelId) : Promise.resolve(null);
    }

    getGroupUsersInfo(userIds: string[], groupId: string, rootGroupId?: string): Promise<(GroupUserInfoType | null)[]> {
        return this.adapter.getGroupUsersInfo ? this.adapter.getGroupUsersInfo(userIds, groupId, rootGroupId) : Promise.resolve([]);
    }
}