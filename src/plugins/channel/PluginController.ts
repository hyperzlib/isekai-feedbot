import Handlebars from "handlebars";

import { PluginController } from "#ibot-api/PluginController";
import { NotFoundError, ParseError } from "#ibot-api/error/errors";
import { ChatIdentity } from "#ibot/message/Sender";
import { arrayDiff, parseMessageChunksFromXml, splitPrefix } from "#ibot/utils";
import { ReactiveConfig } from "#ibot/utils/ReactiveConfig";
import { resolve } from "path";
import { OnSubscribeChannelParams } from "./events";
import { MessageChunk } from "#ibot/message/Message";
import { ChannelCommandController } from "./ChannelCommandController";

export type ChannelSubscribeList = {
    [channelId: string]: string[]
};

export type ChannelTypeSubscribeList = {
    [channelType: string]: ChannelSubscribeList
};

export type ChannelPushTemplateDefinition = {
    template: string,
    robotType?: string,
};

export type CustomTemplateMap = Record<string, Record<string, string>>;

const defaultConfig = {
    deduplicate_interval: 1000,
};

export interface ChannelInfo {
    id: string;
    title: string;
    description?: string;
    updateMode: 'poll' | 'push';
    pollInterval?: number;
}

export interface ChannelTypeInfo {
    id: string;
    title: string;
    description?: string;
    help?: string;
    templates: ChannelPushTemplateDefinition[];
    templateHelp: string;
    hidden?: boolean;
    getChannelInfo: (channelId: string) => Promise<ChannelInfo | null>;
    initChannel?: (channelId: string) => Promise<ChannelInfo | null>;
    cleanupChannel?: (channelId: string) => Promise<void>;
}

export interface PushMessageResponse {
    isSuccess: boolean,
    successCount: number,
    errors: Error[],
}

export default class ChannelFrameworkController extends PluginController<typeof defaultConfig> {
    public channelTypeList: Record<string, ChannelTypeInfo> = {};
    private commandController: ChannelCommandController = new ChannelCommandController(this.app, this);

    private subscribeConfig!: ReactiveConfig<ChannelTypeSubscribeList>;
    private customTplConfig!: ReactiveConfig<CustomTemplateMap>;
    private createdChannelsCache!: ReactiveConfig<string[]>;
    public chatSubscribeList: Record<string, [string, string][]> = {};

    private subscribeLoaded: boolean = false;

    public async initialize() {
        const customTplConfigPath = resolve(this.getConfigPath(), 'custom_template.yaml');
        this.customTplConfig = new ReactiveConfig(customTplConfigPath, {});
        await this.customTplConfig.initialize(true);

        const subscribeConfigPath = resolve(this.getConfigPath(), 'subscribe.yaml');
        this.subscribeConfig = new ReactiveConfig(subscribeConfigPath, {});
        await this.subscribeConfig.initialize(true);

        const createdChannelsCachePath = resolve(this.getConfigPath(), '_created_channels.yaml');
        this.createdChannelsCache = new ReactiveConfig<string[]>(createdChannelsCachePath, []);
        await this.createdChannelsCache.initialize(true);

        // Create per-chat subscribed channels list
        for (const channelType in this.subscribeConfig.value) {
            const channelTypeInfo = this.subscribeConfig.value[channelType];
            for (const channelId in channelTypeInfo) {
                for (const chatIdentityStr of channelTypeInfo[channelId]) {
                    if (!this.chatSubscribeList[chatIdentityStr]) {
                        this.chatSubscribeList[chatIdentityStr] = [];
                    }

                    this.chatSubscribeList[chatIdentityStr].push([channelType, channelId]);
                }
            }
        }

        // 加载指令控制器
        await this.commandController.initialize();
    }

    public async postInit() {
        let currentChannels: string[] = [];
        // 获取当前已订阅的所有频道列表
        for (let channelList of Object.values(this.chatSubscribeList)) {
            for (let [channelType, channelId] of channelList) {
                const channelPath = channelType + '/' + channelId;
                if (!currentChannels.includes(channelPath)) {
                    currentChannels.push(channelPath);
                }
            }
        }

        let diffResult = arrayDiff(this.createdChannelsCache.value, currentChannels);

        // 创建新订阅的频道
        for (let channelPath of diffResult.added) {
            let [channelType, channelId] = splitPrefix(channelPath, '/');
            const channelTypeInfo = this.channelTypeList[channelType];
            if (channelTypeInfo) {
                this.logger.info(`正在初始化推送频道：${channelPath}`);
                await channelTypeInfo.initChannel?.(channelId);
            }
        }

        // 清理已退订的频道
        for (let channelPath of diffResult.removed) {
            let [channelType, channelId] = splitPrefix(channelPath, '/');
            const channelTypeInfo = this.channelTypeList[channelType];
            if (channelTypeInfo) {
                this.logger.info(`正在清理推送频道：${channelPath}`);
                await channelTypeInfo.cleanupChannel?.(channelId);
            }
        }
    }

    public async getDefaultConfig() {
        return defaultConfig;
    }

    /**
     * 获取订阅频道的聊天列表
     * @param channelType 
     * @param channelId 
     * @returns 
     */
    public getSubscribedChats(channelType: string, channelId: string) {
        return this.subscribeConfig.value[channelType]?.[channelId] ?? [];
    }

    /**
     * 获取聊天订阅的频道列表
     * @param chatIdentity
     */
    public getChatSubscribedChannels(chatIdentity: ChatIdentity) {
        return this.chatSubscribeList[this.chatIdentityToString(chatIdentity)] ?? [];
    }

    public chatIdentityToString(identity: ChatIdentity): string {
        switch (identity.type) {
            case 'private':
                return `user:${identity.robot.robotId}@${identity.userId}`;
            case 'channel':
                return `channel:${identity.robot.robotId}@${identity.channelId}`;
            case 'group':
                if (identity.rootGroupId) {
                    return `group:${identity.robot.robotId}@${identity.rootGroupId}:${identity.groupId}`;
                } else {
                    return `group:${identity.robot.robotId}@${identity.groupId}`;
                }
            default:
                return '';
        }
    }

    public parseChatIdentityFromString(identityStr: string): ChatIdentity {
        if (!identityStr) {
            throw new ParseError('Invalid chat identity string');
        }

        const [prefix, itemStr] = splitPrefix(identityStr, ':');
        const [robotId, targetId] = splitPrefix(itemStr, '@');

        const robot = this.app.robot.getRobot(robotId);
        if (!robot) {
            throw new NotFoundError('Robot not found', robotId);
        }

        switch (prefix) {
            case 'user':
                return {
                    type: 'private',
                    userId: targetId,
                    robot,
                };
            case 'channel':
                return {
                    type: 'channel',
                    channelId: targetId,
                    robot,
                };
            case 'group':
                let chunks = targetId.split(':');
                if (chunks.length === 1) {
                    return {
                        type: 'group',
                        groupId: chunks[0],
                        robot,
                    };
                } else {
                    return {
                        type: 'group',
                        rootGroupId: chunks[0],
                        groupId: chunks[1],
                        robot,
                    };
                }
            default:
                throw new Error('Invalid chat identity string');
        }
    }

    /**
     * 获取频道信息
     * @param channelType 
     * @param channelId 
     * @returns 
     */
    public async getChannelInfo(channelType: string, channelId: string): Promise<ChannelInfo | null> {
        if (!(channelType in this.channelTypeList)) {
            return null;
        }

        const channelTypeInfo = this.channelTypeList[channelType];
        let channelInfo = await channelTypeInfo.getChannelInfo(channelId);

        if (!channelInfo) {
            return null;
        }

        return channelInfo;
    }

    public getActualPushTemplate(chatIdentity: ChatIdentity, templates: ChannelPushTemplateDefinition[]): ChannelPushTemplateDefinition | undefined {
        const robotType = chatIdentity.robot.type;
        let tpl: ChannelPushTemplateDefinition | undefined;
        // 根据机器人类型选择模板
        tpl = templates.find((tpl) => tpl.robotType === robotType);
        if (tpl) {
            return tpl;
        }

        // 使用通用模板
        tpl = templates.find((tpl) => !tpl.robotType);

        return tpl;
    }

    // ============================================================================
    //  API for 3rd-party plugins
    // ============================================================================
    /**
     * Register a channel type
     * @param channelTypeInfo 
     */
    public registerChannelType(channelTypeInfo: ChannelTypeInfo) {
        this.channelTypeList[channelTypeInfo.id] = channelTypeInfo;
    }

    /**
     * Send a push message from a channel
     * @param channelId Channel ID
     * @param pushData Data to send
     * @param tag Tag for the message (for deduplication)
     */
    public pushMessage(channelId: string, pushData: Record<string, any>, tag: string = 'default'): PushMessageResponse {
        const [channelType, channelName] = splitPrefix(channelId, '/');

        if (!(channelType in this.channelTypeList)) {
            throw new NotFoundError('Channel type not found', channelType);
        }

        const channelTypeInfo = this.channelTypeList[channelType];

        let robotTypeMessageCache: Record<string, MessageChunk[]> = {};

        const targetList = this.getSubscribedChats(channelType, channelName);

        if (targetList.length === 0) {
            return {
                isSuccess: true,
                successCount: 0,
                errors: [],
            };
        }

        let successCount: number = 0;
        let errors: Error[] = [];

        for (const chatIdentityStr of targetList) {
            try {
                const chatIdentity = this.parseChatIdentityFromString(chatIdentityStr);
                const robotType = chatIdentity.robot.type;
                let messageChunks: MessageChunk[] = [];

                if (chatIdentityStr in this.customTplConfig.value) { // 如果存在自定义模板
                    const render = Handlebars.compile(this.customTplConfig.value[chatIdentityStr]);
                    let messageText = render(pushData);
                    messageChunks = parseMessageChunksFromXml(messageText);
                } else if (robotType in robotTypeMessageCache) { // 命中缓存
                    messageChunks = robotTypeMessageCache[robotType];
                } else { // 根据机器人类型选择模板
                    let tpl = this.getActualPushTemplate(chatIdentity, channelTypeInfo.templates);
                    if (!tpl) {
                        throw new Error('No default template found');
                    }

                    if (tpl.robotType && '*' in robotTypeMessageCache) { // 调用缓存通用模板
                        messageChunks = robotTypeMessageCache['*'];
                    } else {
                        const render = Handlebars.compile(tpl.template);
                        let messageText = render(pushData);
                        messageChunks = parseMessageChunksFromXml(messageText);

                        robotTypeMessageCache[robotType] = messageChunks; // 缓存结果
                    }
                }

                this.app.sendMessage(chatIdentity, messageChunks);
                successCount ++;
            } catch (err: any) {
                errors.push(err);

                if (this.app.debug) { // Show error message in debug mode
                    this.app.logger.error(`Failed to send push message to ${chatIdentityStr}: ${err.message}`);
                    console.error(err);
                }
            }
        }

        return {
            isSuccess: errors.length === 0,
            successCount,
            errors: errors,
        };
    }

    /**
     * Add a channel subscription
     * @param channelType Channel type
     * @param channelId Channel ID
     * @param chatIdentity Chat identity
     * @throws {NotFoundError} Channel type or channel not found
     */
    public async addChannelSubscribe(channelType: string, channelId: string, chatIdentity: ChatIdentity) {
        const channelTypeInfo = this.channelTypeList[channelType];
        const channelUrl = channelType + '/' + channelId;
        
        if (!channelTypeInfo) {
            throw new NotFoundError('Channel type not found', channelType);
        }

        let channelInfo: ChannelInfo | null = await this.getChannelInfo(channelType, channelId); // inform other plugins to create channel if not exists
        if (!channelInfo) {
            this.logger.info(`正在初始化推送频道：${channelType}/${channelId}`);
            channelInfo = await channelTypeInfo.initChannel?.(channelId) ?? null;
        }

        if (!channelInfo) {
            throw new NotFoundError('Channel not found', channelId);
        }

        const chatIdentityStr = this.chatIdentityToString(chatIdentity);

        // Add to chat subscribe list
        if (!this.chatSubscribeList[chatIdentityStr]) {
            this.chatSubscribeList[chatIdentityStr] = [];
        }

        this.chatSubscribeList[chatIdentityStr].push([channelType, channelId]);

        // Add to channel subscribe list
        if (!this.subscribeConfig.value[channelType]) {
            this.subscribeConfig.value[channelType] = {};
        }

        if (!this.subscribeConfig.value[channelType][channelId]) {
            this.subscribeConfig.value[channelType][channelId] = [];
        }

        this.subscribeConfig.value[channelType][channelId].push(chatIdentityStr);

        let subscribedCount = this.subscribeConfig.value[channelType][channelId].length;

        this.subscribeConfig.lazySave();

        if (!this.createdChannelsCache.value.includes(channelUrl)) { // Add to created channels cache
            this.createdChannelsCache.value.push(channelUrl);
            this.createdChannelsCache.lazySave();
        }

        try {
            this.event.emit('channel/subscribe', {
                channelType,
                channelId,
                count: subscribedCount,
                target: chatIdentity,
            } as OnSubscribeChannelParams);
        } catch (err: any) {
            this.logger.error(`Cannot emit event for channel subscribe: ${err.message}`);
            console.error(err);
        }
    }

    /**
     * Remove a channel subscription
     * @param channelType Channel type
     * @param channelId Channel ID
     * @param chatIdentity Chat identity
     * @throws {NotFoundError} Channel type or channel not found
     */
    public async removeChannelSubscribe(channelType: string, channelId: string, chatIdentity: ChatIdentity) {
        const chatIdentityStr = this.chatIdentityToString(chatIdentity);
        const channelUrl = channelType + '/' + channelId;

        // Remove from chat subscribe list
        if (this.chatSubscribeList[chatIdentityStr]) {
            this.chatSubscribeList[chatIdentityStr] = this.chatSubscribeList[chatIdentityStr]
                .filter(([type, id]) => type !== channelType || id !== channelId);
        }

        // Remove from channel subscribe list
        if (this.subscribeConfig.value[channelType] && this.subscribeConfig.value[channelType][channelId]) {
            this.subscribeConfig.value[channelType][channelId] = this.subscribeConfig.value[channelType][channelId]
                .filter((identity) => identity !== chatIdentityStr);

            let subscribedCount = this.subscribeConfig.value[channelType][channelId].length;

            if (subscribedCount === 0) {
                // remoe the channel if no one subscribed
                delete this.subscribeConfig.value[channelType][channelId];
            }

            this.subscribeConfig.lazySave();

            try {
                await this.event.emit('channel/unsubscribe', {
                    channelType,
                    channelId,
                    count: subscribedCount,
                    target: chatIdentity,
                });

                if (subscribedCount === 0) {
                    const channelTypeInfo = this.channelTypeList[channelType];
                    this.logger.info(`正在清理推送频道：${channelType}/${channelId}`);
                    await channelTypeInfo?.cleanupChannel?.(channelId);

                    if (this.createdChannelsCache.value.includes(channelUrl)) { // Remove from created channels cache
                        this.createdChannelsCache.value = this.createdChannelsCache.value.filter((item) => item !== channelUrl);
                        this.createdChannelsCache.lazySave();
                    }
                }
            } catch (err: any) {
                this.logger.error(`Cannot emit event for channel unsubscribe: ${err.message}`);
                console.error(err);
            }
        }
    }

    /**
     * Set custom template for a chat
     * @param chatIdentity 
     * @param template 
     */
    public setCustomTemplate(chatIdentity: ChatIdentity, channelType: string, channelId: string | null, template: string) {
        const chatIdentityStr = this.chatIdentityToString(chatIdentity);
        channelId ??= '*';
        const channelUrl = `${channelType}/${channelId}`;

        if (!this.customTplConfig.value[chatIdentityStr]) {
            this.customTplConfig.value[chatIdentityStr] = {};
        }

        this.customTplConfig.value[chatIdentityStr][channelUrl] = template;

        this.customTplConfig.lazySave();
    }

    /**
     * Get custom template for a chat
     * @param chatIdentity 
     * @returns 
     */
    public getCustomTemplate(chatIdentity: ChatIdentity, channelType: string, channelId: string | null): string | null {
        const chatIdentityStr = this.chatIdentityToString(chatIdentity);
        channelId ??= '*';
        let channelUrl = `${channelType}/${channelId}`;

        if (!this.customTplConfig.value[chatIdentityStr]) {
            return null;
        }

        // 先获取指定频道的模板
        let tpl = this.customTplConfig.value[chatIdentityStr][channelUrl];
        if (tpl) {
            return tpl;
        }

        // 获取默认模板
        channelUrl = `${channelType}/*`;
        tpl = this.customTplConfig.value[chatIdentityStr][channelUrl];
        if (tpl) {
            return tpl;
        }

        return null;
    }

    /**
     * Remove custom template for a chat
     * @param chatIdentity
     */
    public removeCustomTemplate(chatIdentity: ChatIdentity, channelType: string, channelId: string | null) {
        const chatIdentityStr = this.chatIdentityToString(chatIdentity);
        channelId ??= '*';
        let channelUrl = `${channelType}/${channelId}`;

        if (!this.customTplConfig.value[chatIdentityStr]) {
            return;
        }

        if (channelUrl in this.customTplConfig.value[chatIdentityStr]) {
            delete this.customTplConfig.value[chatIdentityStr][channelUrl];

            if (Object.keys(this.customTplConfig.value[chatIdentityStr]).length === 0) {
                delete this.customTplConfig.value[chatIdentityStr];
            }
            
            this.customTplConfig.lazySave();
        }
    }
};