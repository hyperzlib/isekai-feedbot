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

const defaultConfig = {};

export type PusherChannelInfoConfig = {
    id: string,
    title: string,
    channel: string,
    event: string,
};

export type PusherChannelInfo = PusherChannelInfoConfig & {
    pusherInstance: Pusher,
    channelUrl: string,
};

export type PusherConfigType = {
    key: string,
    cluster: string,
    channels: PusherChannelInfoConfig[],
};

export default class PusherChannelController extends PluginController<typeof defaultConfig> {
    /** 已有订阅的的频道列表 */
    public subscribedChannelsConfig!: ReactiveConfig<string[]>;
    public subscribedChannels: Set<string> = new Set();

    /** Pusher配置文件表 */
    public pusherConfigMap = new Map<string, PusherConfigType>();

    /** Pusher实例表 */
    public pusherInstances = new Map<string, Pusher>();

    /** 已创建的Pusher Channel表 */
    public createdChannelMap = new Map<string, PusherChannelInfo>();

    private channelPlugin!: ChannelFrameworkController;
    private configWatcher!: FSWatcher;

    public async initialize() {
        let channelPlugin = this.app.getPlugin<ChannelFrameworkController>("channel");
        if (!channelPlugin) {
            throw new PluginDependencyError("Channel plugin not found");
        }
        
        channelPlugin.registerChannelType({
            id: 'pusher',
            title: "Pusher 推送",
            help: "支持从 Pusher 接收事件推送，请在模板中使用 Pusher 推送的对象中的参数。",
            templates: [
                { template: "{{ dump _data }}" }
            ],
            templateHelp: "",
            initChannel: this.initChannel.bind(this),
            cleanupChannel: this.cleanupChannel.bind(this),
            getChannelInfo: this.getChannelInfo.bind(this),
        });

        this.channelPlugin = channelPlugin;

        if (this.app.debug) {
            Pusher.logToConsole = true;
        }

        await this.initConfigs();
    }

    public async initConfigs() {
        const createdChannelsPath = resolve(this.getConfigPath(), '_created_channels.yaml');
        this.subscribedChannelsConfig = new ReactiveConfig<string[]>(createdChannelsPath, []);
        this.subscribedChannelsConfig.on('data', value => this.subscribedChannels = new Set(value));
        await this.subscribedChannelsConfig.initialize(true);

        const configPath = resolve(this.getConfigPath(), 'channels');
        prepareDir(configPath);

        this.configWatcher = watch(configPath, {
            ignorePermissionErrors: true
        });

        this.configWatcher.on('add', (path) => {
            if (!path.match(/\.(yaml|yml)$/))
                return;
            this.loadConfig(path).catch((e) => {
                this.logger.error(`Failed to load config ${path}`, e);
                console.error(e);
            });
        });
        
        this.configWatcher.on('change', (path) => {
            if (!path.match(/\.(yaml|yml)$/))
                return;
            this.reloadConfig(path).catch((e) => {
                this.logger.error(`Failed to load config ${path}`, e);
                console.error(e);
            });
        });

        this.configWatcher.on('unlink', (path) => {
            if (!path.match(/\.(yaml|yml)$/))
                return;
            this.unloadConfig(path).catch((e) => {
                this.logger.error(`Failed to unload config ${path}`, e);
                console.error(e);
            });
        });
    }
    
    public async destroy() {
        for (const pusher of this.pusherInstances.values()) { // 关闭所有Puhser连接
            pusher.unbind_all();
            pusher.disconnect();
        }

        await this.subscribedChannelsConfig.destory();
    }
    
    public async loadConfig(path: string) {
        const pusherId = basename(path).replace(/\.(yaml|yml)$/, '');

        let configContent = await fs.promises.readFile(path, { encoding: 'utf-8' });
        let config = Yaml.parse(configContent);

        let pusher = new Pusher(config.key, {
            cluster: config.cluster,
            forceTLS: true,
        });

        pusher.connection.bind('connected', () => {
            this.logger.info(`已创建 Pusher.com 连接: ${pusherId}`);
        });

        this.pusherConfigMap.set(pusherId, config);
        this.pusherInstances.set(pusherId, pusher);

        // 加载已经订阅的 channel
        for (let channelConfig of config.channels) {
            let channelUrl = `${pusherId}/${channelConfig.id}`;
            if (this.subscribedChannels.has(channelUrl)) {
                await this.initChannel(channelUrl);
            }
        }
    }

    private async unloadConfig(path: string) {
        const pusherId = basename(path).replace(/\.(yaml|yml)$/, '');
        const pusherInstance = this.pusherInstances.get(pusherId);
        if (!pusherInstance) {
            return;
        }

        this.destoryPusher(pusherInstance);

        this.pusherConfigMap.delete(pusherId);
        this.pusherInstances.delete(pusherId);

        let channelUrlPrefix = `${pusherId}/`;
        for (let channelUrl of this.createdChannelMap.keys()) {
            if (channelUrl.startsWith(channelUrlPrefix)) {
                this.createdChannelMap.delete(channelUrl);
            }
        }
    }

    private async reloadConfig(path: string) {
        await this.unloadConfig(path);
        await this.loadConfig(path);
    }

    private destoryPusher(pusher: Pusher) {
        for (let channel of pusher.allChannels()) {
            channel.unbind_all().unsubscribe();
        }

        pusher.unbind_all();
        pusher.disconnect();
    }

    public parsePusherChannelUrl(channelUrl: string): { pusherId: string, channelId: string } | null {
        let parts = channelUrl.split('/');
        if (parts.length !== 2) {
            return null;
        }

        return {
            pusherId: parts[0],
            channelId: parts[1]
        };
    }

    public async initChannel(channelUrl: string) {
        if (this.createdChannelMap.has(channelUrl)) { // 已创建
            return await this.getChannelInfo(channelUrl);
        }

        let channelPath = this.parsePusherChannelUrl(channelUrl);
        if (!channelPath) {
            throw new ParseError("Invalid channel URL");
        }

        let { pusherId, channelId } = channelPath;
        const pusherInstance = this.pusherInstances.get(pusherId);
        if (!pusherInstance) {
            throw new NotFoundError("Pusher instance not found", 'pusherInstance');
        }

        const pusherConfig = this.pusherConfigMap.get(pusherId);
        if (!pusherConfig) {
            throw new NotFoundError("Pusher config not found", 'pusherConfig');
        }

        const channelConfig = pusherConfig.channels.find((item) => item.id === channelId);
        if (!channelConfig) {
            throw new NotFoundError("Channel config not found", 'channelConfig');
        }

        // 在Pusher中监听事件
        const pusherChannel = pusherInstance.subscribe(channelConfig.channel);

        pusherChannel.bind(channelConfig.event, (data: any) => {
            this.onData(pusherId, channelId, data);
        });

        this.createdChannelMap.set(channelUrl, {
            pusherInstance,
            ...channelConfig,
            channelUrl,
        });

        if (!this.subscribedChannels.has(channelUrl)) {
            this.subscribedChannels.add(channelUrl);
            this.subscribedChannelsConfig.value = Array.from(this.subscribedChannels);
            this.subscribedChannelsConfig.lazySave();
        }

        return await this.getChannelInfo(channelUrl);
    }

    public async cleanupChannel(channelUrl: string) {
        let channelInfo = this.createdChannelMap.get(channelUrl)!;
        if (!channelInfo) {
            return;
        }
    
        channelInfo.pusherInstance
            .channel(channelInfo.channel)
            .unbind(channelInfo.event);

        this.createdChannelMap.delete(channelUrl);
    }

    public async getChannelInfo(channelUrl: string): Promise<ChannelInfo | null> {
        const channelInfo = this.createdChannelMap.get(channelUrl);
        if (!channelInfo) {
            return null;
        }

        return {
            id: channelInfo.id,
            title: channelInfo.title,
            updateMode: 'push',
        };
    }

    public async onData(pusherId: string, channelId: string, data: any) {
        data._data = { ...data }; // 增加用于dump的数据
        const channelUrl = `${pusherId}/${channelId}`;
        this.channelPlugin.pushMessage('pusher', channelUrl, data);
    }
}