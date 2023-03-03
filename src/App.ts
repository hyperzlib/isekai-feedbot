import fs from 'fs';
import winston from 'winston';
import Yaml from 'yaml';
import { fileURLToPath } from 'url';
import path from 'path';

import { BaseProvider, MultipleMessage } from './base/provider/BaseProvider';
import { Setup } from './Setup';
import { ChannelManager } from './ChannelManager';
import { ChannelConfig, Config } from './Config';
import { EventManager } from './EventManager';
import { PluginManager } from './PluginManager';
import { ProviderManager } from './ProviderManager';
import { RestfulApiManager } from './RestfulApiManager';
import { RobotManager } from './RobotManager';
import { Service, ServiceManager } from './ServiceManager';
import { SubscribeManager, Target } from './SubscribeManager';
import { SessionManager } from './SessionManager';

export default class App {
    public config: Config;
    
    public srcPath: string = path.dirname(fileURLToPath(import.meta.url));
    public basePath: string = path.dirname(this.srcPath);

    public debug: boolean = false;

    public logger!: winston.Logger;
    public event!: EventManager;
    public session!: SessionManager;
    public robot!: RobotManager;
    public provider!: ProviderManager;
    public service!: ServiceManager;
    public subscribe!: SubscribeManager;
    public channel!: ChannelManager;
    public plugin!: PluginManager;
    public restfulApi!: RestfulApiManager;

    constructor(configFile: string) {
        this.config = Yaml.parse(fs.readFileSync(configFile, { encoding: 'utf-8' }));
        this.debug = this.config.debug;

        this.initialize();
    }

    async initialize() {
        await this.initModules();
        await this.initRestfulApiManager();
        await this.initEventManager();
        await this.initSessionManager();
        await this.initRobot();
        await this.initProviderManager();
        await this.initServiceManager();
        await this.initSubscribeManager();
        await this.initChannelManager();
        await this.initPluginManager();

        this.logger.info('初始化完成，正在接收消息');
    }

    async initModules() {
        await Setup.initHandlebars();
        
        // 创建Logger
        const loggerFormat = winston.format.printf(({ level, message, timestamp }) => {
            return `${timestamp} [${level}]: ${message}`;
        });

        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.json(),
        });

        if (this.debug) {
            this.logger.add(
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.colorize(),
                        winston.format.simple(),
                        loggerFormat,
                        winston.format.metadata()
                    ),
                    level: 'debug'
                })
            );
        } else {
            this.logger.add(
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.colorize(),
                        winston.format.simple(),
                        loggerFormat
                    ),
                    level: 'info',
                })
            );
        }
    }

    async initRestfulApiManager() {
        this.restfulApi = new RestfulApiManager(this, this.config.http_api);
        await this.restfulApi.initialize();
    }

    async initEventManager() {
        this.event = new EventManager(this);
        await this.event.initialize();
    }

    async initSessionManager() {
        this.session = new SessionManager(this, this.config.session);
        await this.session.initialize();
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

    async initChannelManager() {
        this.channel = new ChannelManager(this, this.config.channel_config_path);

        await this.channel.initialize();
    }

    async initPluginManager() {
        this.plugin = new PluginManager(this, this.config.plugin_path, this.config.plugin_config_path);
        await this.plugin.initialize();
    }

    /**
     * 获取服务
     * @param serviceName 服务名称
     * @returns
     */
    getService<T extends Service>(serviceName: string): T {
        return this.service.get<T>(serviceName);
    }

    createChannel(provider: string, channelId: string, config: ChannelConfig): BaseProvider | null {
        return this.provider.create(provider, channelId, config);
    }

    getChannelSubscriber(channelId: string, robotId: string): Target[] | null {
        return this.subscribe.getSubscriber('channel:' + channelId, robotId);
    }

    /**
     * 发送推送消息
     * @param channelId Channel ID
     * @param messages 消息内容
     * @returns
     */
    async sendPushMessage(channelId: string, messages: MultipleMessage): Promise<void> {
        this.logger.info(`[${channelId}] 消息: `, messages);
        this.robot.sendPushMessage(channelId, messages);
    }
}
