import koa from "koa";
import got from "got/dist/source";

import App from "../../App";
import { Robot, RobotAdapter } from "../Robot";
import { Target } from "../../SubscribeManager";
import { Utils } from "../../utils/Utils";
import { FullRestfulContext, RestfulApiManager, RestfulRouter } from "../../RestfulApiManager";
import { convertMessageToQQChunk, parseQQMessageChunk, QQAttachmentMessage, QQGroupMessage, QQGroupSender, QQPrivateMessage, QQUserSender } from "./qq/Message";
import { CommonReceivedMessage, CommonSendMessage, MessageChunk } from "../../message/Message";
import { PluginController } from "../../PluginManager";
import { RobotConfig } from "../../Config";
import { ChatIdentity } from "../../message/Sender";
import { QQInfoProvider } from "./qq/InfoProvider";

export type QQRobotConfig = RobotConfig & {
    userId: string;
    host: string;
    command_prefix?: string;
}

export type QQGroupInfo = {
    groupId: string,
    groupName?: string,
    memberCount?: number,
    memberLimit?: number
};

export default class QQRobot implements RobotAdapter {
    public type = 'qq';

    public userId: string;
    public robotId: string;
    public description: string;

    public infoProvider: QQInfoProvider;

    private config: QQRobotConfig;

    private app: App;
    private wrapper!: Robot<QQRobot>;
    private endpoint: string;

    private taskId?: NodeJS.Timer;

    private messageTypeHandler: Record<string, (message: CommonSendMessage) => Promise<CommonSendMessage | void>> = {};
    private emojiMap: Record<string, string> = {};

    constructor(app: App, robotId: string, config: QQRobotConfig) {
        this.app = app;
        this.robotId = robotId;
        this.config = config;
        this.endpoint = 'http://' + config.host;
        this.userId = config.userId.toString();

        this.description = config.description ?? this.app.config.robot_description ?? 'Isekai Feedbot for QQ';

        this.messageTypeHandler.help = this.parseHelpMessage.bind(this);
        this.infoProvider = new QQInfoProvider(app, this, config);
    }

    async initialize(wrapper: Robot) {
        this.wrapper = wrapper;

        if (this.config.command_prefix) {
            if (Array.isArray(this.config.command_prefix)) {
                this.wrapper.commandPrefix = this.config.command_prefix;
            } else if (typeof this.config.command_prefix === 'string') {
                this.wrapper.commandPrefix = [this.config.command_prefix];
            }
        }

        this.wrapper.account = this.userId;

        await this.initRestfulApi(this.wrapper.restfulRouter);
        await this.infoProvider.initialize();
    }

    async destroy() {
        await this.infoProvider.destroy();
    }

    async initRestfulApi(router: RestfulRouter) {
        router.post(`/event`, this.handlePostEvent.bind(this));
    }

    async handlePostEvent(ctx: FullRestfulContext, next: koa.Next) {
        if (ctx.request.body?.post_type) {
            const postData = ctx.request.body;
            // if (this.app.debug && postData.post_type !== "meta_event" && postData.meta_event_type !== "heartbeat") {
            //     console.log("收到QQ机器人事件", postData);
            // }
            switch (postData.post_type) {
                case 'message':
                    this.handleMessage(postData);
                    break;
                case 'notice':
                    switch (postData.notice_type) {
                        case 'group_upload':
                            this.handleGroupFile(postData);
                            break;
                    }
                    break;
            }
        }

        ctx.body = 'OK';
        await next();
    }

    public getUsersInfo = (userIds: string[]) => this.infoProvider.getUsersInfo(userIds);
    public getGroupInfo = (groupId: string, rootGroupId?: string | undefined) => this.infoProvider.getGroupInfo(groupId, rootGroupId);
    public getGroupUsersInfo = (userIds: string[], groupId: string, rootGroupId?: string | undefined) =>
        this.infoProvider.getGroupUsersInfo(userIds, groupId, rootGroupId);

    async parseHelpMessage(message: CommonSendMessage) {
        const controllers = message.extra.controllers as PluginController[];

        let helpBuilder: string[] = [];
        if (this.description) {
            helpBuilder.push(this.description, '');
        }

        helpBuilder.push(
            '可用的指令前缀："' + this.wrapper.commandPrefix.join('"、"') + '"',
            '功能列表：'
        );
        const mainCommandPrefix = this.wrapper.commandPrefix[0];

        for (let controller of controllers) {
            helpBuilder.push(`【${controller.name}】`);
            if (controller.event.commandList.length > 0) {
                controller.event.commandList.forEach(commandInfo => {
                    helpBuilder.push(`${mainCommandPrefix}${commandInfo.command} - ${commandInfo.name}`);
                });
            } else {
                helpBuilder.push('此功能没有指令');
            }
            helpBuilder.push('');
        }

        if (helpBuilder[helpBuilder.length - 1] === '') {
            helpBuilder.pop();
        }

        message.content = [{
            type: ['text'],
            text: helpBuilder.join('\n'),
            data: {},
        }];
    }

    /**
     * 处理消息事件
     * @param postData 
     */
    async handleMessage(postData: any) {
        let isResolved = false;
        if (postData.type) {
            isResolved = await this.app.event.emitRawEvent(this.wrapper, postData.type, postData);
            if (isResolved) return;
        }

        if (postData.message_id) {
            let message: QQGroupMessage | QQPrivateMessage | undefined;
            if (postData.message_type === 'group') {
                // 处理群消息
                let groupInfo = this.infoProvider.groupList.find((info) => info.groupId === postData.group_id);

                let groupSender = new QQGroupSender(this.wrapper, postData.group_id.toString(), postData.user_id.toString());
                groupSender.groupInfo = groupInfo;
                groupSender.groupName = groupInfo?.groupName;
                groupSender.globalNickName = postData.sender?.nickname;
                groupSender.nickName = postData.sender?.card;
                groupSender.role = postData.sender?.role ?? 'member';
                groupSender.level = postData.sender?.level;
                groupSender.title = postData.sender?.title;

                message = new QQGroupMessage(groupSender, this.wrapper, postData.message_id.toString());
                message.time = new Date(postData.time * 1000);

                message = await parseQQMessageChunk(this, postData.message ?? [], message);

                await this.infoProvider.updateGroupSender(groupSender);
                await this.infoProvider.updateUserSender(groupSender.userSender);
            } else if (postData.message_type === 'private') {
                // 处理私聊消息
                let userSender = new QQUserSender(this.wrapper, postData.user_id.toString());
                userSender.nickName = postData.sender?.nickname;

                message = new QQPrivateMessage(userSender, this.wrapper, postData.message_id.toString());
                message.time = new Date(postData.time * 1000);

                message = await parseQQMessageChunk(this, postData.message ?? [], message);

                await this.infoProvider.updateUserSender(userSender);
            }

            if (message) {
                // 保存消息
                let messageRef = this.infoProvider.saveMessage(message);

                // 处理原始消息
                isResolved = await this.app.event.emitRawMessage(messageRef);
                if (isResolved) return;

                // 处理指令
                let commandText = this.getCommandContentText(messageRef);
                if (commandText) {
                    await this.app.event.emitCommand(commandText, messageRef);
                    return;
                }

                // 处理消息
                isResolved = await this.app.event.emitMessage(messageRef);
                if (isResolved) return;
            }
        }
    }

    /**
     * 处理群文件
     * @param postData 
     * @returns 
     */
    async handleGroupFile(postData: any) {
        // 处理群消息
        let groupInfo = this.infoProvider.groupList.find((info) => info.groupId === postData.group_id);

        let groupSender = new QQGroupSender(this.wrapper, postData.group_id.toString(), postData.user_id.toString());
        groupSender.groupInfo = groupInfo;
        groupSender.groupName = groupInfo?.groupName;

        let message = new QQGroupMessage(groupSender, this.wrapper);
        message.time = new Date(postData.time * 1000);

        message.type = 'attachment';
        message.content.push({
            type: ['attachement', 'qqattachment'],
            data: {
                sender_type: 'group',
                sender_id: postData.group_id.toString(),
                url: postData.file?.url ?? '',
                fileName: postData.file?.name ?? '',
                size: postData.file?.size,
                file_id: postData.file?.id,
                busid: postData.file?.busid,
            }
        } as QQAttachmentMessage);

        let messageRef = await this.infoProvider.saveMessage(message);

        let isResolved = false;
        // 处理原始消息
        isResolved = await this.app.event.emitRawMessage(messageRef);
        if (isResolved) return;

        // 处理消息
        isResolved = await this.app.event.emitMessage(messageRef);
        if (isResolved) return;
    }

    getCommandContentText(message: CommonReceivedMessage) {
        for (let prefix of this.wrapper.commandPrefix) {
            if (message.contentText.startsWith(prefix)) {
                // 移除指令前缀
                if (message.content[0].data?.text) {
                    message.content[0].data.text = message.content[0].data.text.substring(prefix.length);
                }
                return message.contentText.substring(prefix.length);
            }
        }
        return null;
    }

    async retrieveMediaUrl(mediaMessageChunk: MessageChunk): Promise<void> {
        if (!mediaMessageChunk.data.url) {
            if (mediaMessageChunk.type.includes('qqattachment')) {
                let data = mediaMessageChunk.data;
                if (data.sender_type === "group") {
                    data.url = await this.getGroupFileUrl({
                        group_id: data.sender_id,
                        busid: data.busid,
                        file_id: data.file_id,
                    });
                }
            }
        }
    }

    async markRead(message: CommonReceivedMessage): Promise<boolean> {
        if (message.id) {
            await this.callRobotApi('mark_msg_as_read', {
                message_id: message.id
            });
        }
        return true;
    }

    /**
     *  获取合并转发的原消息列表
     */
    async getReferencedMessages(resId: string): Promise<CommonReceivedMessage[] | null> {
        const res = await this.callRobotApi('get_forward_msg', {
            message_id: resId,
        });
        if (!Array.isArray(res?.data?.messages)) {
            return null;
        }

        let messageList: CommonReceivedMessage[] = [];
        for (let messageData of res.data.messages) {
            if (messageData) {
                messageData.content ??= [];

                let userSender = new QQUserSender(this.wrapper, messageData.sender?.user_id.toString());
                userSender.nickName = messageData.sender?.nickname;

                let message = new QQPrivateMessage(userSender, this.wrapper);
                
                // 生成消息ID
                message.id = `ref:${userSender.userId}:${messageData.time}`;
                message.time = new Date(messageData.time * 1000);

                // 修改回复消息的指向
                messageData.content.forEach((chunk: any) => {
                    if (chunk?.type === 'reply' && chunk.data?.qq && chunk.data?.time) {
                        chunk.data.id = `ref:${chunk.data.qq}:${chunk.data.time}`;
                    }
                })

                message = await parseQQMessageChunk(this, messageData.content ?? [], message);

                messageList.push(message);
            }
        }

        return messageList;
    }

    /**
     * 发送私聊消息
     * @param user - QQ号
     * @param message - 消息
     * @returns 回调
     */
    async sendToUser(user: string | string[], message: string | any[]) {
        if (Array.isArray(user)) { //发送给多个用户的处理
            for (let one of user) {
                await this.sendToUser(one, message);
                await Utils.sleep(100);
            }
            return;
        }

        return await this.callRobotApi('send_private_msg', {
            user_id: user,
            message: message
        });
    }

    /**
     * 发送群消息
     */
    async sendToGroup(group: string | string[], message: string | any[]) {
        if (Array.isArray(group)) { //发送给多个群组的处理
            for (let one of group) {
                await this.sendToGroup(one, message);
                await Utils.sleep(100);
            }
            return;
        }

        return await this.callRobotApi('send_group_msg', {
            group_id: group,
            message: message
        });
    }

    /**
     * 发送消息
     * @param message 
     */
    async sendMessage(message: CommonSendMessage): Promise<CommonSendMessage> {
        if (message.type in this.messageTypeHandler) {
            this.app.logger.debug('[DEBUG] 运行消息类型处理器', message.type);
            let newMessage = await this.messageTypeHandler[message.type](message);
            if (newMessage) message = newMessage;
        }

        let msgData = await convertMessageToQQChunk(message);

        try {
            let res: any = {};
            if (message.chatType === 'private') {
                this.app.logger.debug('[DEBUG] 发送私聊消息', message.receiver.userId, msgData);
                res = await this.sendToUser(message.receiver.userId!, msgData);
            } else if (message.chatType === 'group') {
                this.app.logger.debug('[DEBUG] 发送群消息', message.receiver.groupId, msgData);
                res = await this.sendToGroup(message.receiver.groupId!, msgData);
            }

            // 保存 Message ID
            if (res?.data?.message_id) {
                message.id = res.data.message_id;
            }
            
            // 保存消息
            this.infoProvider.saveMessage(message);
        } catch(err: any) {
            console.error(err);
        }

        return message;
    }

    /**
     * 发送消息
     */
    async sendPushMessage(targets: Target[], message: string) {
        let groupList: string[] = [];
        let userList: string[] = [];
        for (let target of targets) {
            if (target.type === "group") {
                groupList.push(target.identity);
            } else if (target.type === "user") {
                userList.push(target.identity);
            }
        }

        if (groupList.length > 0) {
            await this.sendToGroup(groupList, message);
        }
        if (userList.length > 0) {
            await this.sendToUser(userList, message);
        }
    }

    async deleteMessage(chatIdentity: ChatIdentity, messageId: string): Promise<boolean> {
        await this.callRobotApi('delete_msg', {
            message_id: messageId
        });
        return true;
    }

    async getGroupFileUrl(data: any): Promise<string> {
        const res = await this.callRobotApi('get_group_file_url', data);
        if (res && res.status === 'ok') {
            return res.data?.url ?? "";
        } else {
            return "";
        }
    }

    /**
     * 执行API调用
     */
    callRobotApi(method: string, data: any): Promise<any> {
        return got.post(this.endpoint + '/' + method, {
            json: data,
            timeout: 10000
        }).json<any>();
    }
}
