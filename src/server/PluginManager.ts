import { EventManager } from "./EventManager";
import { CommonReceivedMessage } from "./message/Message";
import fs from 'fs';
import fsAsync from 'fs/promises';
import chokidar from 'chokidar';
import Yaml from 'yaml';
import App from "./App";
import EventEmitter from "events";
import path from "path";
import { ChatIdentity } from "./message/Sender";
import { Robot } from "./robot/Robot";
import { Reactive } from "./utils/reactive";
import { PluginController, PluginIndexFileType } from "#ibot-api/PluginController";
import { PluginApiBridge } from "./plugin/PluginApiBridge";
import { compareObject, prepareDir } from "./utils";
import { ListenEventsFunc } from "./types/event";

export const MessagePriority = {
    LOWEST: 0,
    LOW: 20,
    DEFAULT: 40,
    HIGH: 50,
    /**
     * 在控制器中添加的会话处理器。
     * 用于处理独占模式会话，会比一般指令优先级高，且会阻止所有后续事件。
     */
    SESSION_HANDLER: 60,
    HIGHER: 70,
    /**
     * 一些系统自带的事件处理，如：记录消息
     */
    SYSTEM: 90,
    /**
     * 最高优先级，可以覆盖系统原本的处理
     */
    HIGHEST: 100
};

export type MessageEventOptions = {
    priority?: number,
};

export type CommandInfo = {
    command: string,
    name: string,
    alias?: string[],
    help?: string,
};

export type EventListenerInfo = {
    priority: number;
    callback: CallableFunction;
}

export type CommandInputArgs = {
    command: string,
    param: string,
}

export type MessageCallback = (message: Reactive<CommonReceivedMessage>, resolved: VoidFunction) => any;
export type CommandCallback = (args: CommandInputArgs, message: Reactive<CommonReceivedMessage>, resolved: VoidFunction) => any;
export type RawEventCallback = (robot: Robot, event: any, resolved: VoidFunction) => any;

export type AllowedList = string[] | '*';

export type SubscribedPluginInfo = {
    id: string,
    controller: PluginController,
    eventGroups: PluginEvent[],
}

export type PluginInstance<Controller extends PluginController = PluginController> = {
    id: string,
    path: string,
    bridge: PluginApiBridge,
    controller: Controller,
}

export const MAIN_CONFIG_FILE = 'main_config.yaml';

export class PluginManager extends EventEmitter {
    private app: App;
    private pluginPath: string;
    private configPath: string;
    private dataPath: string;

    private watcher!: chokidar.FSWatcher;
    private configWatcher!: chokidar.FSWatcher;

    public pluginInstanceMap: Record<string, PluginInstance> = {};
    public configPluginMap: Record<string, string> = {};

    constructor(app: App, pluginPath: string, configPath: string, dataPath: string) {
        super();

        this.app = app;
        this.pluginPath = path.resolve(pluginPath);
        this.configPath = path.resolve(configPath);
        this.dataPath = path.resolve(dataPath);
        
        this.pluginInstanceMap = {};
    }

    /**
     * 加载所有Controllers
     */
    public async initialize() {
        // this.watcher = chokidar.watch(this.pluginPath + "/**/*.js", {
        //     ignorePermissionErrors: true,
        //     persistent: true,
        //     followSymlinks: true,
        //     depth: 1
        // });
        // this.watcher.on('add', this.onPluginFileAdded.bind(this));
        // this.watcher.on('change', this.onPluginFileChanged.bind(this));
        // this.watcher.on('unlink', this.onPluginFileRemoved.bind(this));

        for (let folder of fs.readdirSync(this.pluginPath)) {
            if (folder.startsWith('.')) continue;

            let pluginPath = path.join(this.pluginPath, folder);
            if (!fs.statSync(pluginPath).isDirectory()) continue;

            await this.loadPlugin(pluginPath);
        }

        await this.app.role.onPluginLoaded();

        await this.postInit();

        this.configWatcher = chokidar.watch(path.join(this.configPath, '**/*.yaml'), {
            ignorePermissionErrors: true,
            persistent: true
        });
        this.configWatcher.on('change', this.reloadConfig.bind(this));
    }

    public async postInit() {
        for (let plugin of Object.values(this.pluginInstanceMap)) {
            try {
                await plugin.controller.postInit();
            } catch(err: any) {
                this.app.logger.error(`插件 ${plugin.id} 延迟初始化失败`, err);
                console.error(err);

                this.emit('pluginPostInitFailed', plugin.controller);

                // 移除插件
                await this.unloadPlugin(plugin.id);
            }
        }
    }

    public async loadPlugin(folder: string) {
        folder = path.resolve(folder);
        this.app.logger.debug('尝试从 ' + folder + ' 加载插件');
        const pluginIndexFile = path.join(folder, 'plugin.yaml');
        if (!fs.existsSync(pluginIndexFile)) return;

        let pluginId = '';
        try {
            const pluginIndex = Yaml.parse(await fsAsync.readFile(pluginIndexFile, 'utf-8')) as PluginIndexFileType;
            
            if (!pluginIndex || typeof pluginIndex.controller !== "string") {
                this.app.logger.error('插件 ' + folder + ' 没有指定主文件');
                return;
            }
            if (typeof pluginIndex.id !== "string") {
                this.app.logger.error('插件 ' + folder + ' 没有指定ID');
                return;
            }
            if (!pluginIndex.controller.endsWith('.js')) {
                pluginIndex.controller += '.js';
            }

            const controllerFile = path.join(folder, pluginIndex.controller);
            pluginId = pluginIndex.id;

            if (!fs.existsSync(controllerFile)) {
                this.app.logger.error('插件 ' + folder + ' 控制器 ' + controllerFile + ' 不存在');
                return;
            }

            const controller = await import(controllerFile);
            if (controller) {
                const controllerClass: typeof PluginController = controller.default ?? controller;
                
                const pluginApiBridge = new PluginApiBridge(this.app, pluginId);
                const controllerInstance: PluginController = new controllerClass(this.app, pluginApiBridge, pluginIndex);

                const pluginInstance: PluginInstance = {
                    id: pluginId,
                    path: folder,
                    bridge: pluginApiBridge,
                    controller: controllerInstance
                };

                pluginApiBridge.setController(controllerInstance);

                let isReload = false;
                if (pluginId in this.pluginInstanceMap) {
                    // Reload plugin
                    isReload = true;
                    await this.unloadPlugin(pluginId, true);
                }

                this.pluginInstanceMap[pluginId] = pluginInstance;

                if (isReload) {
                    this.app.logger.info(`已重新加载插件: ${pluginId}`);
                    this.emit('pluginReloaded', controllerInstance);
                    
                    // 重新加载权限
                    await this.app.role.onPluginLoaded();
                } else {
                    this.app.logger.info(`已加载插件: ${pluginId}`);
                    this.emit('pluginLoaded', controllerInstance);
                }

                const controllerConfig = await this.loadMainConfig(pluginId, controllerInstance);

                await controllerInstance._initialize(controllerConfig);

                if (isReload) { // 重新加载插件时，加载后就执行延迟加载函数
                    try {
                        await controllerInstance.postInit();
                    } catch(err: any) {
                        this.app.logger.error(`插件 ${pluginId} 延迟初始化失败`, err);
                        console.error(err);

                        this.emit('pluginPostInitFailed', controllerInstance);

                        // 移除插件
                        await this.unloadPlugin(pluginId);
                    }
                }
            } else {
                throw new Error('PluginController does not have an export.');
            }
        } catch(err: any) {
            console.error(`加载插件失败: ${folder}`);
            console.error(err);

            if (pluginId && this.pluginInstanceMap[pluginId]) {
                delete this.pluginInstanceMap[pluginId];
            }
        }
    }

    public async unloadPlugin(pluginId: string, isReload = false) {
        const instance = this.pluginInstanceMap[pluginId];
        if (instance) {
            const configFile = this.getPluginMainConfigPath(pluginId);

            await instance.bridge.destroy();
            await instance.controller.destroy?.();
            
            delete this.pluginInstanceMap[pluginId];
            
            if (configFile in this.configPluginMap) {
                delete this.configPluginMap[configFile];
            }
            this.emit('pluginUnloaded', instance);

            if (!isReload) {
                this.app.logger.info(`已关闭插件: ${pluginId}`);
            }
        }
    }

    public async reloadPlugin(pluginId: string) {
        let pluginInstance = this.pluginInstanceMap[pluginId];
        if (!pluginInstance) return;

        await this.loadPlugin(pluginInstance.path);
    }

    public getPluginPathFromFile(filePath: string) {
        if (filePath.startsWith(this.pluginPath)) {
            return filePath.substring(this.pluginPath.length + 1).split(path.sep)[0];
        } else {
            return null
        }
    }

    public onPluginFileChanged(filePath: string) {
        // Unfinished
    }

    public getPluginConfigPath(pluginId: string) {
        return path.resolve(this.configPath, pluginId);
    }

    public getPluginMainConfigPath(pluginId: string) {
        return path.resolve(this.configPath, pluginId, MAIN_CONFIG_FILE);
    }

    private async loadMainConfig(pluginId: string, controller: PluginController) {
        const configFile = this.getPluginMainConfigPath(pluginId);
        try {
            if (configFile in this.configPluginMap) { // 防止保存时触发重载
                delete this.configPluginMap[configFile];
            }

            const defaultConfig = await controller.getDefaultConfig?.() ?? {};
            let config: any = defaultConfig;
            let shouldFill: boolean = false;

            if (fs.existsSync(configFile)) {
                let localConfig = Yaml.parse(await fsAsync.readFile(configFile, 'utf-8'));
                config = {...defaultConfig, ...localConfig};
                if (!compareObject(config, localConfig)) {
                    shouldFill = true;
                    this.app.logger.info(`配置文件已生成: ${configFile}`);
                }
            } else {
                shouldFill = true;
            }

            if (shouldFill) {
                prepareDir(path.dirname(configFile));
                await fsAsync.writeFile(configFile, Yaml.stringify(config));
            }

            setTimeout(() => {
                this.configPluginMap[configFile] = pluginId;
            }, 1000);

            return config;
        } catch(err: any) {
            this.app.logger.error(`加载插件主配置文件失败: ${configFile}`, err);
            console.error(err);
        }
    }

    public async reloadConfig(file: string) {
        this.app.logger.info(`配置文件已更新: ${file}`);
        if (file in this.configPluginMap) {
            const pluginId = this.configPluginMap[file];
            try {
                const pluginInstance = this.pluginInstanceMap[pluginId];
                if (pluginInstance) {
                    const ctor = pluginInstance.controller.constructor as typeof PluginController;
                    if (ctor.reloadWhenConfigUpdated) { // 重载整个控制器
                        await this.reloadPlugin(pluginId);
                        return;
                    }
                    
                    const localConfig = Yaml.parse(await fsAsync.readFile(file, 'utf-8'));
                    await pluginInstance.controller._setConfig(localConfig);
                    this.app.logger.info(`已重载插件配置文件: ${pluginId}`);
                }
            } catch(err: any) {
                this.app.logger.error(`重载插件 [${pluginId}] 配置失败: ${file}`, err);
                console.error(err);
            }
        }
    }

    /**
     * 获取订阅的控制器和事件组
     * @param senderInfo 
     * @returns 
     */
    public getSubscribed(senderInfo: ChatIdentity): SubscribedPluginInfo[] {
        let subscribedScopes = this.app.event.getPluginSubscribe(senderInfo);

        let subscribed: SubscribedPluginInfo[] = [];
        for (let pluginInstance of Object.values(this.pluginInstanceMap)) {
            let eventGroups: PluginEvent[] = [];
            for (let scopeName in pluginInstance.bridge.scopedEvent) {
                let eventGroup = pluginInstance.bridge.scopedEvent[scopeName];

                if (eventGroup.commandList.length === 0) continue;

                switch (senderInfo.type) {
                    case 'private':
                        if (!eventGroup.allowPrivate) {
                            continue;
                        }
                        if (!eventGroup.isAllowSubscribe(senderInfo)) {
                            continue;
                        }
                        break;
                    case 'group':
                        if (!eventGroup.allowGroup) {
                            continue;
                        }
                        break;
                    case 'channel':
                        if (!eventGroup.allowChannel) {
                            continue;
                        }
                        break;
                }

                // 检测控制器是否已启用
                if (!this.app.event.isPluginScopeInList(pluginInstance.id, scopeName, subscribedScopes)) {
                    continue;
                }

                eventGroups.push(eventGroup);
            }

            if (eventGroups.length > 0) {
                subscribed.push({
                    id: pluginInstance.id,
                    controller: pluginInstance.controller,
                    eventGroups: eventGroups
                });
            }
        }

        return subscribed;
    }

    public getPluginDataPath(pluginId: string, creation: boolean = false) {
        const dataPath = path.resolve(this.dataPath, pluginId);
        if (creation) {
            prepareDir(dataPath);
        }
        return dataPath;
    }

    public getPluginController<T extends PluginController>(pluginId: string): T | null {
        return (this.pluginInstanceMap[pluginId]?.controller ?? null) as any;
    }

    public getPluginInstance<T extends PluginController>(pluginId: string): PluginInstance<T> | null {
        return (this.pluginInstanceMap[pluginId] ?? null) as any;
    }
}

export type ScopeOptions = {
    defaultGroup?: string,
}

export class EventScope {
    protected app: App;
    protected eventManager: EventManager;

    public pluginId: string;
    public scopeName: string;

    public commandList: CommandInfo[] = [];
    public eventList: Record<string, EventListenerInfo[]> = {};
    public eventSorted: Record<string, boolean> = {};

    constructor(app: App, pluginId: string, scopeName: string, scopeOptions: ScopeOptions = {}) {
        this.app = app;
        this.eventManager = app.event;

        this.pluginId = pluginId;
        this.scopeName = scopeName;

        // 添加权限
        this.app.role.addBaseRule(`${pluginId}/${scopeName}`, scopeOptions.defaultGroup);
    }

    /**
     * Add event handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    public on: ListenEventsFunc = (event: string, callback: CallableFunction, options?: MessageEventOptions): void => {
        if (!(event in this.eventList)) {
            this.eventList[event] = [];
        }

        let defaultOptions: MessageEventOptions = {
            priority: MessagePriority.DEFAULT
        };
        if (!options) {
            options = defaultOptions;
        } else {
            options = {
                ...defaultOptions,
                ...options
            };
        }

        const eventInfo = {
            callback: callback,
            priority: options.priority!
        };
        this.eventList[event].push(eventInfo);
        this.eventSorted[event] = false;
        
        this.afterAddEventListener(event, callback, options);
    }

    /**
     * Remove event handler.
     * @param event 
     * @param callback 
     */
    public off(event: string, callback: CallableFunction): void {
        if (Array.isArray(this.eventList[event])) {
            this.eventList[event] = this.eventList[event].filter((eventInfo) => {
                return eventInfo.callback !== callback;
            });
        }

        this.afterRemoveEventListener(event, callback);
    }

    /**
     * Trigger event.
     * @param event Event name
     * @param args Arguments
     * @returns 
     */
    public async emit(event: string, ...args: any[]) {
        let isResolved = false;

        const resolved = () => {
            isResolved = true;
        };

        if (event in this.eventList) {
            if (!this.eventSorted[event]) { // 如果事件未排序，触发排序
                this.eventList[event].sort((a, b) => {
                    return a.priority - b.priority;
                });
            }

            for (const eventInfo of this.eventList[event]) {
                try {
                    await eventInfo.callback(...args, resolved);
                    if (isResolved) {
                        break;
                    }
                } catch (err) {
                    this.app.logger.error(err);
                }
            }
        }

        return isResolved;
    }

    /**
     * Register command.
     * @param command Command
     * @param name Command name
     * @param callback Callback function
     * @param options Command options
     */
    public registerCommand(command: string, name: string, callback: CommandCallback, options?: MessageEventOptions): void
    /**
     * Register command.
     * @param commandInfo Command info
     * @param callback Callback function
     * @param options Command options
     */
    public registerCommand(commandInfo: CommandInfo, callback: CommandCallback, options?: MessageEventOptions): void
    public registerCommand(...args: any[]): void {
        // 处理传入参数
        let commandInfo: Partial<CommandInfo> = {};
        let callback: MessageCallback;
        let options: MessageEventOptions;
        if (typeof args[0] === 'string' && typeof args[1] === 'string') {
            commandInfo = {
                command: args[0],
                name: args[1]
            };
            callback = args[2];
            options = args[3] ?? {};
        } else {
            commandInfo = args[0];
            callback = args[1];
            options = args[2] ?? {};
        }

        // 注册消息事件
        this.commandList.push(commandInfo as any);
        this.on(`command/${commandInfo.command}`, callback, options);
        if (Array.isArray(commandInfo.alias)) { // Add event for alias
            commandInfo.alias.forEach((cmd) => {
                this.on(`command/${cmd.toLocaleLowerCase()}`, callback, options);
            });
        }
        
        this.afterAddCommand(commandInfo as any);
    }

    protected afterAddEventListener(event: string, callback: CallableFunction, options?: MessageEventOptions): void {

    }

    protected afterRemoveEventListener(event: string, callback: CallableFunction): void { }

    protected afterAddCommand(commandInfo: CommandInfo): void { }
}

export class PluginEvent extends EventScope {
    public showInSubscribeList = true;

    public allowPrivate = true;
    public allowGroup = true;
    public allowChannel = true;

    public allowedRobotTypeList: AllowedList = '*';
    
    public isAllowSubscribe: (source: ChatIdentity) => boolean = (source) => {
        if (this.allowedRobotTypeList !== '*' && !this.allowedRobotTypeList.includes(source.robot.type)) {
            return false;
        }

        switch (source.type) {
            case 'private':
                if (!this.allowPrivate) {
                    return false;
                }
                break;
            case 'group':
                if (!this.allowGroup) {
                    return false;
                }
                break;
            case 'channel':
                if (!this.allowChannel) {
                    return false;
                }
                break;
        }
        return true;
    }

    /**
     * Destroy eventGroup.
     * Will remove all event listeners.
     */
    public async destroy() {
        this.eventManager.off(this);
        this.eventManager.removeCommand(this);

        this.eventList = {};
    }

    protected override afterAddEventListener(event: string, callback: CallableFunction, options?: MessageEventOptions): void {
        this.eventManager.on(event, this, callback, options);
    }

    protected override afterRemoveEventListener(event: string, callback: CallableFunction): void {
        this.eventManager.off(event, this, callback);
    }

    protected override afterAddCommand(commandInfo: CommandInfo): void {
        this.eventManager.addCommand(commandInfo as any, this);
    }
}