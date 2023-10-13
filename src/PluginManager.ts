import { EventManager } from "./EventManager";
import { CommonReceivedMessage } from "./message/Message";
import { Robot } from "./RobotManager";
import fs from 'fs';
import fsAsync from 'fs/promises';
import chokidar from 'chokidar';
import Yaml from 'yaml';
import App from "./App";
import EventEmitter from "events";
import path from "path";
import { ChatIdentity } from "./message/Sender";
import { Utils } from "./utils/Utils";

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

export type MessageCallback = (message: CommonReceivedMessage, resolved: VoidFunction) => any;
export type CommandCallback = (args: CommandInputArgs, message: CommonReceivedMessage, resolved: VoidFunction) => any;
export type RawEventCallback = (robot: Robot, event: any, resolved: VoidFunction) => any;

export type AllowedList = string[] | '*';

export class PluginManager extends EventEmitter {
    private app: App;
    private pluginPath: string;
    private configPath: string;

    private watcher!: chokidar.FSWatcher;
    private configWatcher!: chokidar.FSWatcher;
    public controllers: Record<string, PluginController>;
    public fileControllers: Record<string, PluginController>;
    public configControllers: Record<string, PluginController>;

    constructor(app: App, pluginPath: string, configPath: string) {
        super();

        this.app = app;
        this.pluginPath = path.resolve(pluginPath);
        this.configPath = path.resolve(configPath);
        this.controllers = {};
        this.fileControllers = {};
        this.configControllers = {};
    }

    /**
     * 加载所有Controllers
     */
    async initialize() {
        this.watcher = chokidar.watch(this.pluginPath, {
            ignored: '*.bak',
            ignorePermissionErrors: true,
            persistent: true
        });
        this.watcher.on('add', this.loadController.bind(this));
        this.watcher.on('change', this.loadController.bind(this));
        this.watcher.on('unlink', this.removeController.bind(this));

        this.configWatcher = chokidar.watch(this.configPath + '/**/*.yml', {
            ignorePermissionErrors: true,
            persistent: true
        });
        this.configWatcher.on('change', this.reloadConfig.bind(this));
    }

    async loadController(file: string) {
        if (!file.match(/Controller\.m?js$/)) return;

        let moduleName = path.resolve(file).replace(/\\/g, '/').replace(/\.m?js$/, '');
        
        try {
            const controller = await import(moduleName);
            if (controller) {
                const controllerClass = controller.default ?? controller;
                const controllerInstance: PluginController = new controllerClass(this.app);
                if (controllerInstance.id && controllerInstance.id !== '') {
                    const controllerId = controllerInstance.id;

                    let isReload = false;
                    if (controllerId in this.controllers) {
                        // Reload plugin
                        isReload = true;
                        await this.removeController(file, true);
                    }
                    this.controllers[controllerId] = controllerInstance;
                    this.fileControllers[file] = controllerInstance;

                    if (isReload) {
                        this.app.logger.info(`已重新加载Controller: ${file}`);
                        this.emit('controllerReloaded', controllerInstance);
                    } else {
                        this.app.logger.info(`已加载Controller: ${file}`);
                        this.emit('controllerLoaded', controllerInstance);
                    }

                    const pluginEvent = new PluginEvent(this.app);
                    controllerInstance.event = pluginEvent;

                    const controllerConfig = await this.loadControllerConfig('standalone', controllerInstance);

                    await controllerInstance.initialize(controllerConfig);
                } else {
                    throw new Error('PluginController ID is not defined.');
                }
            } else {
                throw new Error('PluginController does not have an export.');
            }
        } catch(err: any) {
            console.error(`加载Controller失败: ${file}`);
            console.error(err);
        }
    }

    async removeController(file: string, isReload = false) {
        const controller = this.fileControllers[file];
        if (controller) {
            const configFile = this.getConfigFile('standalone', controller);

            await controller.event.destroy();
            await controller.destroy?.();
            
            delete this.controllers[file];
            delete this.fileControllers[file];
            if (configFile in this.configControllers) {
                delete this.configControllers[configFile];
            }
            this.emit('controllerRemoved', controller);

            if (!isReload) {
                this.app.logger.info(`已移除Controller: ${controller.id}`);
            }
        }
    }

    getConfigFile(pluginId: string, controller: PluginController) {
        return path.resolve(this.configPath, pluginId, controller.id + '.yml');
    }

    async loadControllerConfig(pluginId: string, controller: PluginController) {
        const configFile = this.getConfigFile(pluginId, controller);
        try {
            if (configFile in this.configControllers) { // 防止保存时触发重载
                delete this.configControllers[configFile];
            }

            const defaultConfig = await controller.getDefaultConfig?.() ?? {};
            let config: any = defaultConfig;
            let shouldFill: boolean = false;

            if (fs.existsSync(configFile)) {
                let localConfig = Yaml.parse(await fsAsync.readFile(configFile, 'utf-8'));
                config = {...defaultConfig, ...localConfig};
                if (!Utils.compare(config, localConfig)) {
                    shouldFill = true;
                    this.app.logger.info(`配置文件已生成: ${configFile}`);
                }
            } else {
                shouldFill = true;
            }

            if (shouldFill) {
                Utils.prepareDir(path.dirname(configFile));
                await fsAsync.writeFile(configFile, Yaml.stringify(config));
            }

            setTimeout(() => {
                this.configControllers[configFile] = controller;
            }, 1000);

            return config;
        } catch(err: any) {
            this.app.logger.error(`加载Controller配置失败: ${configFile}`, err);
            console.error(err);
        }
    }

    async reloadConfig(file: string) {
        this.app.logger.info(`配置文件已更新: ${file}`);
        if (file in this.configControllers) {
            try {
                const controller = this.configControllers[file];
                if (controller.updateConfig) { // 如果控制器支持重载配置，则直接调用
                    const localConfig = Yaml.parse(await fsAsync.readFile(file, 'utf-8'));
                    await controller.updateConfig(localConfig);
                    this.app.logger.info(`已重载Controller配置: ${controller.id}`);
                } else { // 重载整个控制器
                    let controllerFile: string = '';
                    for (let [file, c] of Object.entries(this.fileControllers)) {
                        if (c === controller) {
                            controllerFile = file;
                            break;
                        }
                    }
                    if (controllerFile) {
                        await this.loadController(controllerFile);
                    }
                }
            } catch(err: any) {
                this.app.logger.error(`重载Controller配置失败: ${file}`, err);
                console.error(err);
            }
        }
    }

    /**
     * 获取订阅的控制器
     * @param senderInfo 
     * @returns 
     */
    public getSubscribedControllers(senderInfo: ChatIdentity): PluginController[] {
        let [subscribedControllers, disabledControllers] = this.app.event.getControllerSubscribe(senderInfo);

        return Object.values(this.controllers).filter((controller) => {
            if (controller.event.commandList.length === 0) return false;

            switch (senderInfo.type) {
                case 'private':
                    if (!controller.event.allowPrivate) {
                        return false;
                    }
                    if (!controller.event.isAllowSubscribe(senderInfo)) {
                        return false;
                    }
                    break;
                case 'group':
                    if (!controller.event.allowGroup) {
                        return false;
                    }
                    break;
                case 'channel':
                    if (!controller.event.allowChannel) {
                        return false;
                    }
                    break;
            }

            if (senderInfo.type !== 'private') { // 私聊消息不存在订阅，只判断群消息和频道消息
                if (controller.event.autoSubscribe) {
                    if (!controller.event.isAllowSubscribe(senderInfo)) {
                        return false;
                    } else {
                        // 检测控制器是否已禁用
                        if (disabledControllers.includes(controller.id)) {
                            return false;
                        }
                    }
                } else {
                    // 检测控制器是否已启用
                    if (!subscribedControllers.includes(controller.id)) {
                        return false;
                    }
                }
            }

            return true;
        });
    }
}

export interface PluginController {
    id: string;
    name: string;
    description?: string;

    event: PluginEvent;

    initialize: (config: any) => Promise<void>;
    destroy?: () => Promise<void>;

    getDefaultConfig?: () => Promise<any>;
    updateConfig?: (config: any) => Promise<void>;
}

export class EventScope {
    protected app: App;
    protected eventManager: EventManager;

    public commandList: CommandInfo[] = [];
    public eventList: Record<string, EventListenerInfo[]> = {};
    public eventSorted: Record<string, boolean> = {};

    constructor(app: App) {
        this.app = app;
        this.eventManager = app.event;
    }

    /**
     * Add private message handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    public on(event: 'message/private', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add group message handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    public on(event: 'message/group', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add channel message handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    public on(event: 'message/channel', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add message handle.
     * will be trigger on private message or group message with mentions to robot
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    public on(event: 'message/focused', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add message handler.
     * Will handle all messages (group, private, channel)
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    public on(event: 'message', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add raw message handler.
     * Will be triggered even when the message is a command.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    public on(event: 'raw/message', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add robot raw event handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    public on(event: 'raw/event', callback: RawEventCallback, options?: MessageEventOptions): void
    /**
     * Add other event handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    public on(event: string, callback: CallableFunction, options?: MessageEventOptions): void
    /**
     * Add event handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    public on(event: string, callback: CallableFunction, options?: MessageEventOptions): void {
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
    public controller?: PluginController;

    public autoSubscribe = false;
    public forceSubscribe = false;
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

    public init(controller: PluginController) {
        this.controller = controller;
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