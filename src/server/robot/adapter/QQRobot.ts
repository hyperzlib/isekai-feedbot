import koa from "koa";
import got, { TimeoutError } from "got/dist/source";
import * as ws from "ws";
import * as fs from "fs";

import App from "../../App";
import { Robot, RobotAdapter } from "../Robot";
import { FullRestfulContext, RestfulRouter, RestfulWsRouter } from "../../RestfulApiManager";
import { convertMessageToQQChunk, parseQQMessageChunk, QQAttachmentMessage, QQGroupMessage, QQGroupSender, QQPrivateMessage, QQUserSender } from "./qq/Message";
import { CommonReceivedMessage, CommonSendMessage, MessageChunk } from "../../message/Message";
import { RobotConfig } from "../../types/config";
import { ChatIdentity } from "../../message/Sender";
import { QQInfoProvider } from "./qq/InfoProvider";
import { CommandInfo, SubscribedPluginInfo } from "#ibot/PluginManager";
import { asleep } from "#ibot/utils";
import { randomUUID } from "crypto";
import path from "path";
import { detectImageType } from "#ibot/utils/file";
import { CronJob } from "cron";

export type QQRobotConfig = RobotConfig & {
    userId: string;
    host?: string;
    command_prefix?: string;
}

export type QQGroupInfo = {
    groupId: string,
    groupName?: string,
    memberCount?: number,
    memberLimit?: number
};

export type QueryQueueItem = {
    method: string,
    data: any,
    resolve: (value: any) => void,
    reject: (reason?: any) => void,
    time: number,
    queryId: string;
    retryTimes: number;
}

export default class QQRobot implements RobotAdapter {
    public readonly IMG_CACHE_EXPIRE = 7 * 86400 * 1000; // 7天

    public imgCleanupTask?: CronJob;

    public type = 'qq';

    public userId: string;
    public robotId: string;
    public description: string;

    public infoProvider: QQInfoProvider;

    private config: QQRobotConfig;

    private app: App;
    private wrapper!: Robot<QQRobot>;
    private endpoint?: string;

    private imgCachePath = '';

    private botSocket?: ws;
    private socketQueryQueue: QueryQueueItem[] = [];
    private socketResponseQueue: Record<string, QueryQueueItem> = {};
    private socketQueueRunning: boolean = false;
    private socketQueueCleanerTaskId?: NodeJS.Timer;

    private taskId?: NodeJS.Timer;

    private messageTypeHandler: Record<string, (message: CommonSendMessage) => Promise<CommonSendMessage | void>> = {};
    private emojiMap: Record<string, string> = {};

    constructor(app: App, robotId: string, config: QQRobotConfig) {
        this.app = app;
        this.robotId = robotId;
        this.config = config;
        if (config.host) {
            this.endpoint = 'http://' + config.host;
        }
        this.userId = config.userId.toString();

        this.description = config.description ?? this.app.config.robot_description ?? 'Isekai Feedbot for QQ';

        this.messageTypeHandler.help = this.parseHelpMessage.bind(this);
        this.infoProvider = new QQInfoProvider(app, this, config);
    }

    async initialize(wrapper: Robot) {
        this.wrapper = wrapper;

        this.imgCachePath = await this.app.initPath('cache', 'qq', this.userId, 'img');

        if (this.config.command_prefix) {
            if (Array.isArray(this.config.command_prefix)) {
                this.wrapper.commandPrefix = this.config.command_prefix;
            } else if (typeof this.config.command_prefix === 'string') {
                this.wrapper.commandPrefix = [this.config.command_prefix];
            }
        }

        this.wrapper.account = this.userId;

        await this.initRestfulApi();
        await this.infoProvider.initialize();

        this.socketQueueCleanerTaskId = setInterval(() => {
            this.cleanSocketQueryQueue();
        }, 1000);

        this.imgCleanupTask = new CronJob('0 0 0 * * *', async () => {
            await this.cleanImageCache();
        });

        await this.cleanImageCache();
    }

    async destroy() {
        if (this.socketQueueCleanerTaskId) {
            clearInterval(this.socketQueueCleanerTaskId);
        }

        await this.infoProvider.destroy();
    }

    async initRestfulApi() {
        const { router, wsRouter, setupRouter } = this.app.restfulApi.getRobotRouter(this.robotId);

        router.get('qq_robot_event', '/event', (ctx: FullRestfulContext, next: koa.Next) => {
            ctx.body = {
                status: 0,
                message: 'Please use POST method.'
            };
            next();
        });
        router.post('qq_robot_event_post', `/event`, this.handlePostEvent.bind(this));
        this.app.logger.info(`QQ机器人事件接口: ${router.url('qq_robot_event_post', {})}`);

        wsRouter.all('qq_robot_event_ws', '/ws', (ctx: FullRestfulContext, next: koa.Next) => {
            ctx.websocket.on('message', (messageBuffer: Buffer) => {
                try {
                    let message = JSON.parse(messageBuffer.toString('utf-8'));
                    
                    if (message.post_type === 'meta_event') {
                        if (message.meta_event_type === 'heartbeat') {
                            ctx.websocket.send(JSON.stringify({
                                ping: true,
                            }));
                        } else if (message.meta_event_type === 'lifecycle' && message.sub_type === 'connect') {
                            if (message.status?.self?.user_id && message.status.self.user_id !== parseInt(this.userId)) {
                                return;
                            }
                            this.botSocket = ctx.websocket;

                            this.app.logger.debug(`[QQRobot] Websocket Connected: ${ctx.socket.remoteAddress}:${ctx.socket.remotePort}`);

                            // 开始处理队列
                            this.startSocketQueryQueue();
                        }
                    } else if (message.echo) {
                        // 处理返回消息
                        if (message.echo in this.socketResponseQueue) {
                            this.socketResponseQueue[message.echo].resolve(message);
                            delete this.socketResponseQueue[message.echo];
                        }
                    } else {
                        // if (this.app.debug && message.post_type !== "meta_event" && message.meta_event_type !== "heartbeat") {
                        //     console.log("收到QQ机器人事件", message);
                        // }
                        switch (message.post_type) {
                            case 'message':
                                this.handleMessage(message);
                                break;
                            case 'notice':
                                switch (message.notice_type) {
                                    case 'group_upload':
                                        this.handleGroupFile(message);
                                        break;
                                }
                                break;
                        }
                    }
                } catch (err: any) {
                    this.app.logger.error('[QQRobot] Websocket Message Error ', err.message);
                    console.error(err);
                }
            });
            ctx.websocket.on('close', () => {
                
            });
        });

        this.app.logger.info(`QQ机器人事件接口 (WebSocket): ${wsRouter.url('qq_robot_event_ws', {})}`);

        setupRouter();
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

        ctx.body = {
            status: 1,
        };
        await next();
    }

    public getUsersInfo = (userIds: string[]) => this.infoProvider.getUsersInfo(userIds);
    public getGroupInfo = (groupId: string, rootGroupId?: string | undefined) => this.infoProvider.getGroupInfo(groupId, rootGroupId);
    public getGroupUsersInfo = (userIds: string[], groupId: string, rootGroupId?: string | undefined) =>
        this.infoProvider.getGroupUsersInfo(userIds, groupId, rootGroupId);

    async parseHelpMessage(message: CommonSendMessage) {
        const subscribedPlugins = (message._context.subscribed ?? []) as SubscribedPluginInfo[];

        let helpBuilder: string[] = [];
        if (this.description) {
            helpBuilder.push(this.description, '');
        }

        helpBuilder.push(
            '可用的指令前缀："' + this.wrapper.commandPrefix.join('"、"') + '"',
            '功能列表：'
        );
        const mainCommandPrefix = this.wrapper.commandPrefix[0];

        for (let subscribedItem of subscribedPlugins) {
            const pluginName = subscribedItem.controller.pluginInfo.name;
            helpBuilder.push(`【${pluginName}】`);

            let commandList: CommandInfo[] = [];
            for (let eventGroup of subscribedItem.eventGroups) {
                commandList.push(...eventGroup.commandList);
            }
            if (commandList.length > 0) {
                commandList.forEach(commandInfo => {
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
                groupSender.roles = [ postData.sender?.role ?? 'user' ];
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
                // 下载图片
                await this.downloadImages(message.content);

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

    async downloadImages(messageContent: MessageChunk[]): Promise<void> {
        for (let chunk of messageContent) {
            if (chunk.type.includes('qqimage')) {

                if (chunk.data.url) {
                    this.app.logger.debug(`正在下载图片：${chunk.data.url}`);
                    try {
                        let imgFileName = chunk.data.alt?.toLowerCase() ?? randomUUID();

                        // 使用前2位拆分文件夹
                        let imgPath = path.join(this.imgCachePath, imgFileName[0], imgFileName.substring(0, 2));
                        let imgFile = path.join(imgPath, imgFileName);

                        if (!fs.existsSync(imgPath)) {
                            await fs.promises.mkdir(imgPath, { recursive: true });
                        }

                        // 检测图片文件是否存在
                        const imgExts = ['.jpg', '.png', '.gif', '.webp'];
                        for (let ext of imgExts) {
                            if (fs.existsSync(imgFile + ext)) {
                                // 图片已存在
                                // 修改mtime，用于清理过期图片
                                let currentDate = new Date();
                                await fs.promises.utimes(imgFile + ext, currentDate, currentDate);
                                chunk.data.url = 'file://' + imgFile + ext;
                                return;
                            }
                        }

                        // 下载图片
                        let res = await got.get(chunk.data.url).buffer();

                        let imageType = detectImageType(res);

                        switch (imageType) {
                            case 'image/jpeg':
                                imgFile += '.jpg';
                                break;
                            case 'image/png':
                                imgFile += '.png';
                                break;
                            case 'image/gif':
                                imgFile += '.gif';
                                break;
                            case 'image/webp':
                                imgFile += '.webp';
                                break;
                        }
                        
                        await fs.promises.writeFile(imgFile, res);

                        chunk.data.url = 'file://' + imgFile;

                        console.log('图片已下载：' + chunk.data.url);
                    } catch (err: any) {
                        this.app.logger.error(`下载图片失败：${chunk.data.url}`);
                        console.error(err);
                        if (err.name === 'HTTPError' && err.response) {
                            console.error('Error Response: ', err.response?.body);
                        }
                    }
                }
            }
        }
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
            try {
                await this.callRobotApi('mark_msg_as_read', {
                    message_id: message.id
                });
            } catch(err) {
                this.app.logger.warn("[QQRobot] 当前API不支持markRead");
            }
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
                });

                message = await parseQQMessageChunk(this, messageData.content ?? [], message);

                messageList.push(message);
            }
        }

        return messageList;
    }

    /**
     * 踢出群成员
     * @param groupId 
     * @param userId 
     */
    async kickGroupUser(groupId: string, userId: string): Promise<boolean> {
        const res = await this.callRobotApi('set_group_kick', {
            group_id: groupId,
            user_id: userId,
        });
        if (res && res.status === 'ok') {
            return true;
        } else {
            return false;
        }
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
                await asleep(100);
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
                await asleep(100);
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

    async getImageUrl(data: any): Promise<string> {
        const res = await this.callRobotApi('get_image', data);
        if (res && res.status === 'ok') {
            return res.data?.url ?? "";
        } else {
            return "";
        }
    }

    // ================================================================================
    //  QQ专用API
    // ================================================================================
    /**
     * 设置群特殊头衔
     * @param group 
     * @param user 
     * @param title 
     * @returns 
     */
    async setGroupSpecialTitle(group: string, user: string, title: string) {
        const res = await this.callRobotApi('set_group_special_title', {
            group_id: group,
            user_id: user,
            special_title: title,
        });
        if (res && res.status === 'ok') {
            return true;
        } else {
            return false;
        }
    }

    /**
     * 封禁群成员
     * @param group 
     * @param user 
     * @param duration 
     * @returns 
     */
    async banGroupUser(group: string, user: string, duration: number) {
        const res = await this.callRobotApi('set_group_ban', {
            group_id: group,
            user_id: user,
            duration: duration,
        });
        if (res && res.status === 'ok') {
            return true;
        } else {
            return false;
        }
    }

    /**
     * 解除封禁群成员
     * @param group 
     * @param user 
     * @returns 
     */
    async unbanGroupUser(group: string, user: string) {
        return await this.banGroupUser(group, user, 0);
    }

    /**
     * 设置群全员禁言
     * @param group 
     * @param enable 
     * @returns 
     */
    async setGroupWholeBan(group: string, enable: boolean) {
        const res = await this.callRobotApi('set_group_whole_ban', {
            group_id: group,
            enable: enable,
        });
        if (res && res.status === 'ok') {
            return true;
        } else {
            return false;
        }
    }

    /**
     * 执行API调用
     */
    callRobotApi(method: string, data: any): Promise<any> {
        if (this.endpoint) {
            return got.post(this.endpoint + '/' + method, {
                json: data,
                timeout: 10000
            }).json<any>();
        } else {
            return this.doSocketQuery(method, data);
        }
    }

    async doSocketQuery(method: string, data: any): Promise<any> {
        return new Promise((resolve, reject) => {
            let queryId = randomUUID();
            this.socketQueryQueue.push({
                method,
                data,
                resolve,
                reject,
                queryId,
                time: Date.now(),
                retryTimes: 0,
            });

            this.startSocketQueryQueue();
        });
    }

    async startSocketQueryQueue() {
        if (this.socketQueueRunning) return;

        this.socketQueueRunning = true;

        while (this.botSocket && this.botSocket.readyState === this.botSocket.OPEN &&
                this.socketQueryQueue.length > 0) {
            try {
                let query = this.socketQueryQueue.shift();
                if (query) {
                    try {
                        let wsData = {
                            action: query.method,
                            echo: query.queryId,
                            params: query.data,
                        }
                        
                        await new Promise<void>((resolve, reject) => {
                            this.botSocket!.send(JSON.stringify(wsData), (err) => {
                                if (err) {
                                    reject(err);
                                }
                                resolve();
                            });
                        });

                        query.time = Date.now();
                        this.socketResponseQueue[query.queryId] = query;

                        if (['send_private_msg', 'send_group_msg', 'send_msg'].includes(query.data.action)) {
                            // 如果有发送消息的请求，等待一段时间再继续
                            await asleep(500);
                        }
                    } catch(err) {
                        if (query.retryTimes < 3) {
                            query.retryTimes++;
                            this.socketQueryQueue.unshift(query);
                        } else {
                            query.reject(err);
                        }
                    }
                }
            } catch(err: any) {
                this.app.logger.error('[QQRobot] Socket Query Error ', err.message);
                console.log(err);
            }
        }

        this.socketQueueRunning = false;
    }

    cleanSocketQueryQueue() {
        let currentTime = Date.now();
        this.socketQueryQueue = this.socketQueryQueue.filter((item) => {
            if (currentTime - item.time > 30000) {
                item.reject(new Error('Socket Query Timeout'));
                return false;
            }
            return true;
        });

        for (let key in this.socketResponseQueue) {
            let item = this.socketResponseQueue[key];
            if (currentTime - item.time > 30000) {
                item.reject(new Error('Socket Query Timeout'));
                delete this.socketResponseQueue[key];
            }
        }
    }

    async cleanImageCacheFromPath(basePath: string): Promise<number> {
        // 清理图片缓存
        const currentTime = Date.now();
        const files = await fs.promises.readdir(basePath);

        let count = 0;

        for (let file of files) {
            if (file.startsWith('.')) continue;

            const filePath = path.join(basePath, file);
            const stat = await fs.promises.stat(filePath);

            if (stat.isDirectory()) {
                count += await this.cleanImageCacheFromPath(filePath);
            } else {
                if (currentTime - stat.mtime.getTime() > this.IMG_CACHE_EXPIRE) {
                    try {
                        await fs.promises.unlink(filePath);
                    } catch(err: any) {
                        this.app.logger.error('清理QQ机器人图片缓存：无法删除文件，', err.message);
                        console.error(err);
                    }
                    count ++;
                }
            }
        }

        return count;
    }

    async cleanImageCache() {
        try {
            this.app.logger.info('正在清理QQ机器人图片缓存');
            let count = await this.cleanImageCacheFromPath(this.imgCachePath);
            this.app.logger.info(`清理QQ机器人图片缓存：已清理 ${count} 个文件`);
        } catch(err: any) {
            this.app.logger.error('清理QQ机器人图片缓存失败', err.message);
            console.error(err);
        }
    }
}
