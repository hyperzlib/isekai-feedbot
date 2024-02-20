import fs from 'fs';
import winston from 'winston';
import Yaml from 'yaml';
import { fileURLToPath } from 'url';
import path from 'path';

import { Setup } from './Setup';
import { ChannelConfig, Config } from './types/config';
import { EventManager } from './EventManager';
import { PluginInstance, PluginManager } from './PluginManager';
import { RestfulApiManager } from './RestfulApiManager';
import { RobotManager } from './RobotManager';
import { SubscribeManager } from './SubscribeManager';
import { CacheManager } from './CacheManager';
import { StorageManager } from './StorageManager';
import { DatabaseManager } from './DatabaseManager';
import { Logger } from './utils/Logger';
import { PluginController } from '#ibot-api/PluginController';
import * as Utils from './utils';

export * from './utils/contextHooks';

export default class App {
    public config: Config;
    
    public srcPath: string = path.dirname(fileURLToPath(import.meta.url));
    public basePath: string = path.dirname(this.srcPath);

    public debug: boolean = false;

    public baseLogger!: winston.Logger;
    public logger!: Logger;
    public event!: EventManager;
    public cache!: CacheManager;
    public storage!: StorageManager;
    public database?: DatabaseManager;
    public robot!: RobotManager;
    public subscribe!: SubscribeManager;
    public plugin!: PluginManager;
    public restfulApi!: RestfulApiManager;

    public constructor(configFile: string, initImmediate: boolean = true) {
        this.config = Yaml.parse(fs.readFileSync(configFile, { encoding: 'utf-8' }));
        this.debug = this.config.debug;

        (import.meta as any)._isekaiFeedbotApp = this;

        if (initImmediate) {
            this.initialize();
        }
    }

    public async initialize() {
        await this.initModules();
        await this.initRestfulApiManager();
        await this.initEventManager();
        await this.initCacheManager();
        await this.initStorageManager();
        await this.initDatabaseManager();
        await this.initRobot();
        await this.initSubscribeManager();
        await this.initPluginManager();

        this.logger.info('初始化完成，正在接收消息');
    }

    private async initModules() {
        await Setup.initHandlebars();
        
        // 创建Logger
        const loggerFormat = winston.format.printf(({ level, message, timestamp, tag }) => {
            return `${timestamp} [${level}]: ${message}`;
        });

        this.baseLogger = winston.createLogger({
            level: 'info',
            format: winston.format.json(), 
        });

        if (this.debug) {
            this.baseLogger.add(
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
            this.baseLogger.add(
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

        this.logger = this.getLogger("Core");
    }

    private async initRestfulApiManager() {
        this.restfulApi = new RestfulApiManager(this, this.config.http_api);
        await this.restfulApi.initialize();
    }

    private async initEventManager() {
        this.event = new EventManager(this);
        await this.event.initialize();
    }

    private async initCacheManager() {
        this.cache = new CacheManager(this, this.config.cache);
        await this.cache.initialize();
    }

    private async initStorageManager() {
        this.storage = new StorageManager(this, this.config.storage);
        await this.storage.initialize();
    }

    private async initDatabaseManager() {
        if (this.config.db) {
            this.database = new DatabaseManager(this, this.config.db);
            await this.database.initialize();
        }
    }

    private async initRobot() {
        this.robot = new RobotManager(this, this.config.robot);
        await this.robot.initialize();
    }

    private async initSubscribeManager() {
        this.subscribe = new SubscribeManager(this, this.config.subscribe_config);
        await this.subscribe.initialize();
    }

    private async initPluginManager() {
        this.plugin = new PluginManager(this, this.config.plugin_path, this.config.plugin_config_path, this.config.plugin_data_path);
        await this.plugin.initialize();
    }

    public get utils() {
        return Utils;
    }

    public getLogger(tag: string) {
        return new Logger(this.baseLogger, tag);
    }

    /**
     * 获取插件控制器
     * @param pluginId 插件ID
     * @returns 
     */
    public getPlugin<T extends PluginController<any> = PluginController>(pluginId: string): T | null {
        return this.plugin.getPluginController<T>(pluginId) ?? null;
    }

    /**
     * 获取插件实例
     * @param pluginId 插件ID
     * @returns 
     */
    public getPluginInstance<T extends PluginController = PluginController>(pluginId: string): PluginInstance<T> | null {
        return this.plugin.getPluginInstance<T>(pluginId) ?? null;
    }
}
