import App from "../App";
import { Robot } from "../RobotManager";
import { Target } from "../SubscribeManager";
import request from "request-promise";
import { Utils } from "../utils/Utils";
import { FullRestfulContext, RestfulApiManager, RestfulRouter } from "../RestfulApiManager";
import koa from "koa";
import { convertMessageToQQChunk, parseQQMessageChunk, QQFaceMessage, QQGroupMessage, QQGroupSender, QQImageMessage, QQPrivateMessage, QQUserSender, QQVoiceMessage } from "./qq/Message";
import { CommonReceivedMessage, CommonSendMessage, MentionMessage, TextMessage } from "../message/Message";

export type QQRobotConfig = {
    user: string;
    host: string;
    command_prefix?: string;
}

export type QQGroupInfo = {
    groupId: string,
    groupName?: string,
    memberCount?: number,
    memberLimit?: number
};

export default class QQRobot implements Robot {
    public type = 'qq';

    public uid: string;
    public robotId: string;

    public commandPrefix: string[] = ['/', '！', '!', '／'];

    private app: App;
    private endpoint: string;

    private taskId?: NodeJS.Timer;

    private groupList: QQGroupInfo[] = [];

    constructor(app: App, robotId: string, config: QQRobotConfig) {
        this.app = app;
        this.robotId = robotId;
        this.endpoint = 'http://' + config.host;
        this.uid = config.user;

        if (config.command_prefix) {
            if (Array.isArray(config.command_prefix)) {
                this.commandPrefix = config.command_prefix;
            } else if (typeof config.command_prefix === 'string') {
                this.commandPrefix = [config.command_prefix];
            }
        }
    }

    async initialize() {
        this.refreshRobotInfo();

        // 每30分钟刷新一次信息
        this.taskId = setInterval(() => {
            this.refreshRobotInfo();
        }, 30 * 60 * 1000);
    }

    async refreshRobotInfo() {
        // 刷新群信息
        let remoteGroupList = await this.getGroupList();
        remoteGroupList.forEach((groupInfo) => {
            if (groupInfo.group_id) {
                this.groupList.push({
                    groupId: groupInfo.group_id,
                    groupName: groupInfo.group_name,
                    memberCount: groupInfo.member_count,
                    memberLimit: groupInfo.max_member_count
                });
            }
        });
    }

    async initRestfulApi(router: RestfulRouter, api: RestfulApiManager) {
        router.post(`/event`, this.handlePostEvent.bind(this));
    }

    async handlePostEvent(ctx: FullRestfulContext, next: koa.Next) {
        if (ctx.request.body?.post_type) {
            const postData = ctx.request.body;
            switch (postData.post_type) {
                case 'message':
                    this.handleMessage(postData);
                    break;
            }
        }

        ctx.body = 'OK';
        await next();
    }

    /**
     * 处理消息事件
     * @param postData 
     */
    async handleMessage(postData: any) {
        let isResolved = false;
        if (postData.type) {
            isResolved = await this.app.event.emitRawEvent(this, postData.type, postData);
            if (isResolved) return;
        }

        if (postData.message_id) {
            let message: QQGroupMessage | QQPrivateMessage | undefined;
            if (postData.message_type === 'group') {
                // 处理群消息
                let groupInfo = this.groupList.find((info) => info.groupId === postData.group_id);

                let groupSender = new QQGroupSender(postData.group_id.toString(), postData.user_id.toString());
                groupSender.groupInfo = groupInfo;
                groupSender.groupName = groupInfo?.groupName;
                groupSender.globalNickName = postData.sender?.nickname;
                groupSender.nickName = postData.sender?.card;
                groupSender.role = postData.sender?.role ?? 'member';
                groupSender.level = postData.sender?.level;
                groupSender.title = postData.sender?.title;

                message = new QQGroupMessage(groupSender, this, postData.message_id.toString());
                message.time = new Date(postData.time * 1000);

                message = await parseQQMessageChunk(this, postData.message ?? [], message);
            } else if (postData.message_type === 'private') {
                // 处理私聊消息
                let userSender = new QQUserSender(postData.user_id.toString());
                userSender.nickName = postData.sender?.nickname;

                message = new QQPrivateMessage(userSender, this, postData.message_id.toString());
                message.time = new Date(postData.time * 1000);

                message = await parseQQMessageChunk(this, postData.message ?? [], message);
            }

            if (message) {
                // 处理原始消息
                isResolved = await this.app.event.emitRawMessage(message);
                if (isResolved) return;

                // 处理指令
                let commandText = this.getCommandContentText(message);
                if (commandText) {
                    await this.app.event.emitCommand(commandText, message);
                    return;
                }

                // 处理消息
                isResolved = await this.app.event.emitMessage(message);
                if (isResolved) return;
            }
        }
    }

    getCommandContentText(message: CommonReceivedMessage) {
        for (let prefix of this.commandPrefix) {
            if (message.contentText.startsWith(prefix)) {
                return message.contentText.substring(prefix.length);
            }
        }
        return null;
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

        return await this.doApiRequest('send_private_msg', {
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

        return await this.doApiRequest('send_group_msg', {
            group_id: group,
            message: message
        });
    }

    /**
     * 发送消息
     * @param message 
     */
    async sendMessage(message: CommonSendMessage): Promise<CommonSendMessage> {
        let msgData = await convertMessageToQQChunk(message);

        if (message.origin === 'private') {
            if (this.app.debug) console.log('[DEBUG] 发送私聊消息', message.targetId, msgData);
            
            await this.sendToUser(message.targetId, msgData);
        } else if (message.origin === 'group') {
            if (this.app.debug) console.log('[DEBUG] 发送群消息', message.targetId, msgData);
            
            await this.sendToGroup(message.targetId, msgData);
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

    async getGroupList(): Promise<any[]> {
        const res = await this.doApiRequest('get_group_list', {});
        if (res && res.status === 'ok') {
            return res.data;
        } else {
            return [];
        }
    }

    /**
     * 执行API调用
     */
    async doApiRequest(method: string, data: any): Promise<any> {
        return await request({
            method: 'POST',
            uri: this.endpoint + '/' + method,
            body: data,
            json: true,
            timeout: 10000
        });
    }
}
