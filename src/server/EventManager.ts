import App from "./App";
import { CommandOverrideConfig } from "./types/config";
import { PermissionDeniedError, RateLimitError } from "../api/error/errors";
import { CommonReceivedMessage } from "./message/Message";
import { ChatIdentity } from "./message/Sender";
import { CommandInfo, CommandInputArgs, EventScope, MessageEventOptions, MessagePriority, PluginEvent } from "./PluginManager";
import { Robot } from "./robot/Robot";
import { SubscribeItem, SubscribeTargetInfo } from "./SubscribeManager";
import { Reactive } from "./utils/reactive";

export type ControllerEventInfo = {
    priority: number;
    callback: CallableFunction;
    eventScope: PluginEvent;
}

export type SessionEventInfo = {
    activeTime: Date;
    eventScope: EventScope;
}

export type ControllerCommandInfo = {
    commandInfo: CommandInfo;
    eventScope: PluginEvent;
}

export type EventMeta = {
    sender?: ChatIdentity;
    userRules?: string[];
}

export class EventManager {
    private app: App;

    /** 事件排序的debounce */
    private eventSortDebounce: Record<string, NodeJS.Timeout> = {};

    /** 全局事件列表 */
    private eventList: Record<string, ControllerEventInfo[]> = {};
    
    /** 会话事件列表 */
    private sessionEventList: Record<string, EventScope> = {};

    /** 全局指令列表 */
    private commandList: Record<string, ControllerCommandInfo> = {};

    /** 指令信息 */
    private commandInfoList: ControllerCommandInfo[] = [];

    /** 指令信息覆盖配置 */
    private commandOverride: CommandOverrideConfig;

    constructor(app: App) {
        this.app = app;
        this.commandOverride = app.config.command_override ?? {};
    }

    public async initialize() {
        
    }

    public on<Callback extends CallableFunction = CallableFunction>(event: string, eventScope: PluginEvent, callback: Callback, options?: MessageEventOptions) {
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
            priority: options.priority!,
            eventScope
        };

        this.eventList[event].push(eventInfo);

        this.sortEvent(event);
    }

    public off(event: string, eventScope: PluginEvent, callback: CallableFunction): void
    public off(eventScope: PluginEvent): void
    public off(...args: any): void {
        if (typeof args[0] === 'string') {
            let [event, controller, callback] = args;
            if (Array.isArray(this.eventList[event])) {
                this.eventList[event] = this.eventList[event].filter((eventInfo) => eventInfo.callback !== callback || eventInfo.eventScope !== controller);
            }
        } else if (typeof args[0] !== 'undefined') {
            let controller = args[0];
            for (let event in this.eventList) {
                this.eventList[event] = this.eventList[event].filter((eventInfo) => eventInfo.eventScope !== controller);
            }
        }
    }

    public addCommand(commandInfo: CommandInfo, eventScope: PluginEvent) {
        // 如果配置了Command覆盖，则覆盖原本的指令设置
        if (commandInfo.command in this.commandOverride) {
            commandInfo = {
                ...commandInfo,
                ...this.commandOverride[commandInfo.command]
            };
        }

        let data = {
            commandInfo,
            eventScope: eventScope
        };
        this.commandInfoList.push(data);
        this.commandList[commandInfo.command.toLocaleLowerCase()] = data;
        if (Array.isArray(commandInfo.alias)) {
            commandInfo.alias.forEach((alias) => {
                this.commandList[alias.toLocaleLowerCase()] = data;
            });
        }
    }

    public removeCommand(commandInfo: CommandInfo): void
    public removeCommand(eventScope: PluginEvent): void
    public removeCommand(...args: any): void {
        if ('command' in args[0]) {
            let commandInfo: CommandInfo = args[0];
            this.commandInfoList = this.commandInfoList.filter((commandInfoItem) => commandInfoItem.commandInfo !== commandInfo);
            delete this.commandList[commandInfo.command.toLocaleLowerCase()];
            if (Array.isArray(commandInfo.alias)) {
                commandInfo.alias.forEach((alias) => {
                    delete this.commandList[alias.toLocaleLowerCase()];
                });
            }
        } else if (typeof args[0] !== 'undefined' && args[0].pluginId) {
            let eventScope: PluginEvent = args[0];
            this.commandInfoList = this.commandInfoList.filter((commandInfoItem) => commandInfoItem.eventScope !== eventScope);
            for (let command in this.commandList) {
                if (this.commandList[command].eventScope.pluginId === eventScope.pluginId) {
                    delete this.commandList[command];
                }
            }
        }
    }

    public async emit(eventName: string, meta: EventMeta, ...args: any[]) {
        if (this.app.debug) {
            if (typeof args[0] === 'object' && args[0].chatType) {
                this.app.logger.debug(`触发事件 ${eventName} ${args[0].contentText}`);
            } else {
                this.app.logger.debug(`触发事件 ${eventName}`);
            }
        }
        
        const eventList = this.eventList[eventName];
        if (!eventList) return false;

        const isFilter = eventName.startsWith('filter/');
        const isCommand = eventName.startsWith('command/');

        let isResolved = false;

        const resolved = () => {
            isResolved = true;
        };

        const buildOnError = (eventInfo: ControllerEventInfo) => (error: Error) => {
            this.app.logger.error(`[${eventInfo.eventScope.pluginId}/${eventInfo.eventScope.scopeName}] 处理事件 ${eventName} 时出错`, error);
            console.error(error);

            for (let arg of args) {
                if (typeof arg === 'object' && arg.chatType) {
                    const msg: CommonReceivedMessage = arg;
                    if (error instanceof RateLimitError) {
                        const retryAfterMinutes = Math.ceil(error.retryAfter / 60);
                        msg.sendReply(`使用太多了，${retryAfterMinutes} 分钟后再试吧`);
                    } else if (error instanceof PermissionDeniedError) {
                        msg.sendReply(`使用此功能需要 ${error.requiredPermission} 权限`);
                    }
                    break;
                }
            }
        }

        let subscribedPlugins = this.getPluginSubscribe(meta.sender);

        for (let eventInfo of eventList) {
            if (!isFilter && meta.sender) {
                switch (meta.sender.type) {
                    case 'private':
                        if (!eventInfo.eventScope.allowPrivate) {
                            continue;
                        }
                        if (!eventInfo.eventScope.isAllowSubscribe(meta.sender)) {
                            continue;
                        }
                        break;
                    case 'group':
                        if (!eventInfo.eventScope.allowGroup) {
                            continue;
                        }
                        break;
                    case 'channel':
                        if (!eventInfo.eventScope.allowChannel) {
                            continue;
                        }
                        break;
                }

                const eventScope = eventInfo.eventScope;

                // 检测用户是否有使用此控制器的权限
                const ruleName = `${eventScope.pluginId}/${eventScope.scopeName}`;
                if (meta.userRules && !meta.userRules.includes(ruleName)) {
                    this.app.logger.debug(`用户权限不足，用户权限：[${meta.userRules.join(', ')}]，所需权限：[${ruleName}]`);
                    continue;
                }
                
                // 检测控制器是否已禁用
                if (!this.isPluginScopeInList(eventScope.pluginId, eventScope.scopeName, subscribedPlugins)) {
                    if (isCommand) {
                        // 如果是指令，标记为权限不足
                        console.log('权限不足：', eventScope.pluginId, eventScope.scopeName);
                    }
                    continue;
                }
            }

            try {
                const ret = await eventInfo.callback(...args, resolved);
                if (isResolved) {
                    break;
                }
                // detect ret is promise
                if (ret && typeof ret.catch === 'function') {
                    ret.catch(buildOnError(eventInfo));
                }
            } catch(err: any) {
                buildOnError(eventInfo)(err);
            }
        }
        
        return isResolved;
    }

    public async emitMessage(message: Reactive<CommonReceivedMessage>) {
        let isResolved = false;

        const sender = this.getSenderInfo(message);
        const userRules = await this.app.role.getUserRules(sender);

        if (message.chatType === 'private' || (message.chatType === 'group' && message.mentionedReceiver)) {
            if (this.app.config.focused_as_command) {
                // 在开启@直接触发指令时，先检测当前消息是否是指令
                isResolved = await this.emitCommand(message.contentText, message);
                if (isResolved) return true;
            }
            
            isResolved = await this.emit(`message/focused`, { sender, userRules }, message);
            if (isResolved) return true;
        }

        isResolved = await this.emit(`message/${message.chatType}`, { sender, userRules }, message);
        if (isResolved) return true;

        isResolved = await this.emit('message', { sender, userRules }, message);
        if (isResolved) return true;

        return false;
    }

    public async emitCommand(contentText: string, message: Reactive<CommonReceivedMessage>) {
        let command = '';
        let param = '';

        // 尝试识别空格分隔的指令
        if (contentText.includes(' ')) {
            command = contentText.split(' ')[0].toLocaleLowerCase();
            param = contentText.substring(command.length + 1);

            if (!(command in this.commandList)) {
                command = '';
            }
        }

        // 尝试使用最长匹配查找指令
        if (command.length === 0) {
            for (let registeredCommand in this.commandList) {
                if (contentText.startsWith(registeredCommand)) {
                    if (registeredCommand.length > command.length) {
                        command = registeredCommand;
                    }
                }
            }

            if (command.length === 0) {
                return false;
            }

            param = contentText.substring(command.length);
        }

        if (this.app.debug) {
            this.app.logger.debug('指令识别结果', command, param);
        }

        let commandArgs: CommandInputArgs = {
            command,
            param
        };

        const sender = this.getSenderInfo(message);
        const userRules = await this.app.role.getUserRules(sender);

        return await this.emit(`command/${command}`, { sender, userRules }, commandArgs, message);
    }

    public async emitRawEvent(robot: Robot, event: string, ...args: any[]) {
        return await this.emit(`raw/${robot.type}/${event}`, { sender: { type: 'raw', robot: robot } }, event);
    }

    public async emitRawMessage(message: Reactive<CommonReceivedMessage>) {
        let isResolved = false;

        await this.emit(`filter/message`, {}, message);

        const sender = this.getSenderInfo(message);
        const userRules = await this.app.role.getUserRules(sender);

        isResolved = await this.emit(`raw/${message.receiver.type}/message`, { sender: sender, userRules }, message);
        if (isResolved) return true;

        return await this.emit('raw/message', { sender, userRules }, message);
    }

    public async emitFilterSendMessage(message: Reactive<CommonReceivedMessage>) {
        
    }

    public getSenderInfo(message: CommonReceivedMessage): ChatIdentity {
        if (message.chatType === 'private') {
            return {
                type: 'private',
                robot: message.receiver,
                userId: message.sender.userId,
                userRoles: message.sender.userRoles ?? [],
            };
        } else if (message.chatType === 'group') {
            return {
                type: 'group',
                robot: message.receiver,
                groupId: message.sender.groupId,
                userId: message.sender.userId,
                userRoles: message.sender.userRoles ?? [],
            };
        }

        return {
            type: 'unknown',
            robot: message.receiver
        }
    }

    public getPluginSubscribe(senderInfo?: ChatIdentity | null): SubscribeItem[] {
        let subscribedCommands: SubscribeItem[] = [];

        if (senderInfo) {
            let targetInfo: SubscribeTargetInfo = {
                robot: senderInfo.robot.robotId!,
            };

            if (senderInfo.type === 'private') {
                targetInfo.user = true;
            } else if (senderInfo.type === 'channel') {
                targetInfo.channel = senderInfo.channelId;
            } else if (senderInfo.type === 'group') {
                targetInfo.group = senderInfo.groupId;
                targetInfo.rootGroup = senderInfo.rootGroupId;
            }
            
            subscribedCommands = this.app.subscribe.getSubscribeItems(targetInfo);
        }

        return subscribedCommands;
    }

    public isPluginScopeInList(pluginId: string, scopeName: string, subList: SubscribeItem[]): boolean {
        return subList.some((subItem) =>
            subItem.id === pluginId && (subItem.scope === "*" || subItem.scope === scopeName)
        );
    }

    private sortEvent(eventName: string) {
        if (this.eventSortDebounce[eventName]) {
            return;
        }

        this.eventSortDebounce[eventName] = setTimeout(() => {
            this.eventList[eventName] = this.eventList[eventName].sort((a, b) => b.priority - a.priority);

            delete this.eventSortDebounce[eventName];
        }, 200);
    }
}
