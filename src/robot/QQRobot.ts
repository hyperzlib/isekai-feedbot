import koa from "koa";
import got from "got/dist/source";

import App from "../App";
import { Robot } from "../RobotManager";
import { Target } from "../SubscribeManager";
import { Utils } from "../utils/Utils";
import { FullRestfulContext, RestfulApiManager, RestfulRouter } from "../RestfulApiManager";
import { convertMessageToQQChunk, parseQQMessageChunk, QQGroupMessage, QQGroupSender, QQPrivateMessage, QQUserSender } from "./qq/Message";
import { CommonReceivedMessage, CommonSendMessage } from "../message/Message";
import { PluginController } from "../PluginManager";
import { RobotConfig } from "../Config";
import { ChatIdentity } from "../message/Sender";

export type QQRobotConfig = RobotConfig & {
    uid: string;
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
    public description: string;

    public commandPrefix: string[] = ['/', '！', '!', '／'];

    private app: App;
    private endpoint: string;

    private taskId?: NodeJS.Timer;

    private groupList: QQGroupInfo[] = [];

    private messageTypeHandler: Record<string, (message: CommonSendMessage) => Promise<CommonSendMessage | void>> = {};

    constructor(app: App, robotId: string, config: QQRobotConfig) {
        this.app = app;
        this.robotId = robotId;
        this.endpoint = 'http://' + config.host;
        this.uid = config.uid.toString();

        this.description = config.description ?? this.app.config.robot_description ?? 'Isekai Feedbot for QQ';

        if (config.command_prefix) {
            if (Array.isArray(config.command_prefix)) {
                this.commandPrefix = config.command_prefix;
            } else if (typeof config.command_prefix === 'string') {
                this.commandPrefix = [config.command_prefix];
            }
        }

        this.messageTypeHandler.help = this.parseHelpMessage.bind(this);
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

    async parseHelpMessage(message: CommonSendMessage) {
        const controllers = message.extra.controllers as PluginController[];

        let helpBuilder: string[] = [];
        if (this.description) {
            helpBuilder.push(this.description, '');
        }

        helpBuilder.push(
            '可用的指令前缀："' + this.commandPrefix.join('"、"') + '"',
            '功能列表：'
        );
        const mainCommandPrefix = this.commandPrefix[0];

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
            type: 'text',
            data: {
                text: helpBuilder.join('\n')
            }
        }];
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

                let groupSender = new QQGroupSender(this, postData.group_id.toString(), postData.user_id.toString());
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
                let userSender = new QQUserSender(this, postData.user_id.toString());
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

    getSession(chatIdentity: ChatIdentity, type: string) {
        const sessionPath = this.app.robot.getSessionPath(chatIdentity, type);
        return this.app.session.getStore(sessionPath);
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
        if (message.type in this.messageTypeHandler) {
            this.app.logger.debug('[DEBUG] 运行消息类型处理器', message.type);
            let newMessage = await this.messageTypeHandler[message.type](message);
            if (newMessage) message = newMessage;
        }

        let msgData = await convertMessageToQQChunk(message);

        let res: any = {};
        if (message.origin === 'private') {
            this.app.logger.debug('[DEBUG] 发送私聊消息', message.targetId, msgData);
            res = await this.sendToUser(message.targetId, msgData);
        } else if (message.origin === 'group') {
            this.app.logger.debug('[DEBUG] 发送群消息', message.targetId, msgData);
            res = await this.sendToGroup(message.targetId, msgData);
        }

        // 保存 Message ID
        if (res?.data?.message_id) {
            message.id = res.data.message_id;
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
        await this.doApiRequest('delete_msg', {
            message_id: messageId
        });
        return true;
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
        return await got.post(this.endpoint + '/' + method, {
            json: data,
            timeout: 10000
        }).json<any>();
    }
}
