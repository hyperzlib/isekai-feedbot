import Pusher from 'pusher-js';
import { FSWatcher, watch } from 'chokidar';
import Yaml from 'yaml';
import * as fs from 'fs';
import { NotFoundError, ParseError, PluginDependencyError } from "#ibot-api/error/errors";
import { PluginController } from "#ibot-api/PluginController";
import { basename, resolve } from "path";
import { ReactiveConfig } from '#ibot/utils/ReactiveConfig';
import ChannelFrameworkController, { ChannelInfo } from '../channel/PluginController';
import { prepareDir } from '#ibot/utils';
import { Next } from 'koa';
import got from 'got';
import { RouterContext } from 'koa-router';
import { FullRestfulContext } from '#ibot/RestfulApiManager';

const defaultConfig = {
    brec_api: '',
    brec_auth: null as null | { username: string, password: string },
};

export type BrecRoomBaseInfo = {
    id: string;
    nickname: string;
    title: string;
};

export default class BrecChannelController extends PluginController<typeof defaultConfig> {
    /** 已订阅的直播间 */
    public roomInfoCache!: ReactiveConfig<Record<string, BrecRoomBaseInfo>>;

    private channelPlugin!: ChannelFrameworkController;

    public async initialize() {
        let channelPlugin = this.app.getPlugin<ChannelFrameworkController>("channel");
        if (!channelPlugin) {
            throw new PluginDependencyError("Channel plugin not found");
        }
        
        channelPlugin.registerChannelType({
            id: 'bliveStreamStarted',
            title: "Bilibili 开播推送",
            help: "从录播姬接收B站直播间开播推送。",
            templates: [
                { template: "{{ nickname }} 开播了\n《{{ title }}》" }
            ],
            templateHelp: "",
            initChannel: (channelId) => this.initChannel(channelId, 'started'),
            getChannelInfo: (channelId) => this.getChannelInfo(channelId, 'started')
        });

        channelPlugin.registerChannelType({
            id: 'bliveStreamEnded',
            title: "Bilibili 下播推送",
            help: "从录播姬接收B站直播间下播推送。",
            templates: [
                { template: "{{ nickname }} 下播了" }
            ],
            templateHelp: "",
            initChannel: (channelId) => this.initChannel(channelId, 'ended'),
            getChannelInfo: (channelId) => this.getChannelInfo(channelId, 'ended')
        });

        this.channelPlugin = channelPlugin;

        if (this.app.debug) {
            Pusher.logToConsole = true;
        }

        await this.initConfigs();

        await this.refreshRoomInfo();
        
        this.initRestfulApi();
    }

    public async initConfigs() {
        const roomInfoCachePath = resolve(this.getConfigPath(), '_room_info.yaml');
        this.roomInfoCache = new ReactiveConfig<Record<string, BrecRoomBaseInfo>>(roomInfoCachePath, {});
        await this.roomInfoCache.initialize(true);

        this.roomInfoCache.on('change', () => {
            this.refreshRoomInfo();
        });
    }

    public initRestfulApi() {
        const { router, setupRouter } = this.getRestfulRouter();

        router.get('/event', (ctx, next) => {
            ctx.body = { code: 400, message: 'Please use POST method.' };
        })

        router.post('brec_event', '/event', this.handleEvent.bind(this));
        
        const eventUrl = router.url('brec_event', {});
        this.logger.info(`录播姬事件接口: ${eventUrl}`);

        setupRouter();
    }
    
    public async destroy() {
        await this.roomInfoCache.destory();
    }

    public async initChannel(roomId: string, eventType: 'started' | 'ended') {
        if (roomId in this.roomInfoCache.value) { // 已创建
            await this.refreshRoomInfo();
        }

        return await this.getChannelInfo(roomId, eventType);
    }

    public async refreshRoomInfo() {
        if (!this.config.brec_api) {
            this.logger.info('录播姬API未配置，已禁用直播推送。');
            return;
        }

        try {
            const res = await got.get(this.config.brec_api + '/api/room', {
                username: this.config.brec_auth?.username,
                password: this.config.brec_auth?.password,
                responseType: 'json',
            }).json<any>();

            if (!Array.isArray(res)) {
                throw new ParseError("Invalid response");
            }

            this.roomInfoCache.value = {};
            res.forEach((roomInfo) => {
                const roomId = roomInfo.roomId.toString();
                this.roomInfoCache.value[roomId] = {
                    id: roomId,
                    nickname: roomInfo.name,
                    title: roomInfo.title,
                }
            });

            this.roomInfoCache.lazySave();
        } catch (error: any) {
            this.logger.error('Failed to fetch room info:', error.message);
            console.error(error);

            this.roomInfoCache.value = {};
        }
    }

    public async getChannelInfo(roomId: string, eventType: 'started' | 'ended'): Promise<ChannelInfo | null> {
        const roomInfo = this.roomInfoCache.value[roomId];
        if (!roomInfo) {
            return null;
        }

        return {
            id: roomId,
            title: `${roomInfo.nickname} 的直播间：` + (eventType === 'started' ? '开播通知' : '下播通知'),
            updateMode: 'push',
        };
    }

    public async handleEvent(ctx: FullRestfulContext, next: Next) {
        if (!ctx.request.body?.EventType) {
            ctx.body = { code: 400, message: 'Invalid request' };
            await next();
            return;
        }

        const body = ctx.request.body as any;

        const roomId = body.EventData?.RoomId?.toString();
        const nickName = body.EventData?.Name;
        const title = body.EventData?.Title;

        if (!roomId && !nickName && !title) {
            ctx.body = { code: 400, message: 'Invalid request' };
            await next();
            return;
        }

        if (!(roomId in this.roomInfoCache.value)) {
            // 没有添加的直播间
            ctx.body = { code: 200, message: 'OK' };
            await next();
            return;
        }

        // 更新房间信息
        this.roomInfoCache.value[roomId] = {
            id: roomId,
            nickname: nickName,
            title: title,
        };
        this.roomInfoCache.lazySave();

        switch (body.EventType) {
            case 'StreamStarted':
                this.channelPlugin.pushMessage('bliveStreamStarted', roomId, {
                    nickname: nickName,
                    title: title,
                });
                break;
            case 'StreamEnded':
                this.channelPlugin.pushMessage('bliveStreamEnded', roomId, {
                    nickname: nickName,
                    title: title,
                });
                break;
        }

        ctx.body = { code: 200, message: 'OK' };
        await next();
    }
}