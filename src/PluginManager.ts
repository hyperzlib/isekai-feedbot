import { EventManager } from "./EventManager";
import { CommonReceivedMessage } from "./message/Message";
import { Robot } from "./RobotManager";
import chokidar from 'chokidar';
import App from "./App";
import EventEmitter from "events";
import path from "path";

export const MessagePriority = {
    LOWEST: 0,
    LOW: 20,
    DEFAULT: 40,
    /**
     * 在控制器中添加的临时会话处理器。
     * 用于处理深层会话，会比一般指令优先级高。
     */
    TEMP_HANDLER: 60,
    HIGH: 80,
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

export type MessageCallback = (message: CommonReceivedMessage, resolved: VoidFunction) => any;
export type CommandCallback = (args: string, message: CommonReceivedMessage, resolved: VoidFunction) => any;
export type RawEventCallback = (robot: Robot, event: any, resolved: VoidFunction) => any;

export type AllowedList = string[] | '*';

export type ControllerSubscribeSource = {
    type: 'private' | 'group' | 'channel' | 'raw' | string,
    robot: Robot,
    groupId?: string,
    userId?: string,
    channelId?: string,
}

export class PluginManager extends EventEmitter {
    private app: App;
    private pluginPath: string;

    private watcher!: chokidar.FSWatcher;
    public controllers: Record<string, PluginController>;
    public fileControllers: Record<string, PluginController>;

    constructor(app: App, pluginPath: string) {
        super();

        this.app = app;
        this.pluginPath = pluginPath;
        this.controllers = {};
        this.fileControllers = {};
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
    }

    async loadController(file: string) {
        if (!file.match(/\.m?js$/)) return;

        let moduleName = path.resolve(file).replace(/\\/g, '/').replace(/\.m?js$/, '');
        
        try {
            const controller = await import(moduleName);
            if (controller) {
                const controllerClass = controller.default ?? controller;
                const controllerInstance: PluginController = new controllerClass(this.app, this.app.event);
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
                        console.log(`已重新加载Controller: ${file}`);
                        this.emit('controllerReloaded', controllerInstance);
                    } else {
                        console.log(`已加载Controller: ${file}`);
                        this.emit('controllerLoaded', controllerInstance);
                    }

                    await controllerInstance.initialize();
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
            await controller.destroy();
            
            delete this.controllers[file];
            delete this.fileControllers[file];
            this.emit('controllerRemoved', controller);

            if (!isReload) {
                console.log(`已移除Controller: ${controller.id}`);
            }
        }
    }
}

export class PluginController {
    public id: string = '';
    public name: string = '未命名功能';
    public description: string = '';

    private app: App;
    private eventManager: EventManager;

    public autoSubscribe = false;
    public forceSubscribe = false;
    public showInSubscribeList = true;

    public allowPrivate = true;
    public allowGroup = true;
    public allowChannel = true;

    public allowedRobotTypeList: AllowedList = '*';

    private commandList: CommandInfo[] = [];
    private eventList: Record<string, EventListenerInfo[]> = {};

    constructor(app: App, eventManager: EventManager) {
        this.app = app;
        this.eventManager = eventManager;
    }

    public isAllowSubscribe: (source: ControllerSubscribeSource) => boolean = (source) => {
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
     * Add private message handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    protected on(event: 'message/private', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add group message handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    protected on(event: 'message/group', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add channel message handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    protected on(event: 'message/channel', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add message handle.
     * will be trigger on private message or group message with mentions to robot
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    protected on(event: 'message/focused', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add message handler.
     * Will handle all messages (group, private, channel)
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    protected on(event: 'message', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add raw message handler.
     * Will be triggered even when the message is a command.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    protected on(event: 'raw/message', callback: MessageCallback, options?: MessageEventOptions): void
    /**
     * Add robot raw event handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    protected on(event: 'raw/event', callback: RawEventCallback, options?: MessageEventOptions): void
    /**
     * Add other event handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    protected on(event: string, callback: CallableFunction, options?: MessageEventOptions): void
    /**
     * Add event handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    protected on(event: string, callback: CallableFunction, options?: MessageEventOptions): void {
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

        this.eventManager.on(event, this, callback, options);
    }

    protected off(event: string, callback: CallableFunction): void {
        if (Array.isArray(this.eventList[event])) {
            this.eventList[event] = this.eventList[event].filter((eventInfo) => {
                return eventInfo.callback !== callback;
            });
        }

        this.eventManager.off(event, this, callback);
    }

    /**
     * Register command.
     * @param command 
     * @param name 
     * @param callback 
     * @param options 
     */
    protected registerCommand(command: string, name: string, callback: CommandCallback, options?: MessageEventOptions): void
    protected registerCommand(commandInfo: CommandInfo, callback: CommandCallback, options?: MessageEventOptions): void
    protected registerCommand(...args: any[]): void {
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
                this.on(`command/${cmd}`, callback, options);
            });
        }
    }

    /**
     * Initialize plugin controller.
     */
    public async initialize() {

    }

    /**
     * Destroy eventGroup.
     * Will remove all event listeners.
     */
    public async destroy() {
        this.eventManager.off(this);

        this.eventList = {};
    }
}