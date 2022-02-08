import fs from 'fs';
import path from 'path';
import Yaml from 'yaml';
import { BaseProvider, MultipleMessage } from './base/provider/BaseProvider';

import { ChannelManager } from './ChannelManager';
import { ChannelConfig, Config } from './Config';
import { ProviderManager } from './ProviderManager';
import { RobotManager } from './RobotManager';
import { Service, ServiceManager } from './ServiceManager';
import { SubscribeManager, Target } from './SubscribeManager';

export default class App {
    public config: Config;
    public srcPath: string = __dirname;

    public robot!: RobotManager;
    public provider!: ProviderManager;
    public service!: ServiceManager;
    public subscribe!: SubscribeManager;
    public channel!: ChannelManager;

    constructor(configFile: string) {
        this.config = Yaml.parse(fs.readFileSync(configFile, { encoding: 'utf-8' }));
        this.initialize();
    }

    async initialize() {
        await this.initRobot();
        await this.initProviderManager();
        await this.initServiceManager();
        await this.initSubscribeManager();
        await this.initChannelManager();
        console.log('初始化完成，正在接收消息');
    }

    async initRobot() {
        this.robot = new RobotManager(this, this.config.robot);
        await this.robot.initialize();
    }

    async initProviderManager() {
        this.provider = new ProviderManager(this);
        await this.provider.initialize();
    }

    async initServiceManager() {
        this.service = new ServiceManager(this, this.config.service);
        await this.service.initialize();
    }

    async initSubscribeManager() {
        this.subscribe = new SubscribeManager(this, this.config.subscribe_config);
        await this.subscribe.initialize();
    }

    async initCommandManager() {

    }

    async initChannelManager() {
        this.channel = new ChannelManager(this, this.config.channel_config_path);

        this.channel.on('add', (channelId) => {
            this.subscribe.addChannel(channelId);
        });
        this.channel.on('remove', (channelId) => {
            this.subscribe.removeChannel(channelId);
        });

        await this.channel.initialize();
    }

    /**
     * 获取服务
     * @param serviceName 
     * @returns
     */
    getService<T extends Service>(serviceName: string): T {
        return this.service.get<T>(serviceName);
    }

    createChannel(provider: string, channelId: string, config: ChannelConfig): BaseProvider | null {
        return this.provider.create(provider, channelId, config);
    }

    getSubscriber(channelId: string, robotId: string): Target[] | null {
        return this.subscribe.getSubscriber(channelId, robotId);
    }

    /**
     * 发送消息
     * @param channelId Channel ID
     * @param messages 消息内容
     * @returns
     */
    async sendMessage(channelId: string, messages: MultipleMessage): Promise<void> {
        console.log(`[${channelId}] 消息: `, messages);
        this.robot.sendMessage(channelId, messages);
    }

    require(file: string): any {
        return require(path.join(this.srcPath, file));
    }
}
