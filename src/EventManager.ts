import App from "./App";
import { CommonReceivedMessage, CommonSendMessage } from "./message/Message";
import { CommandInfo, ControllerSubscribeSource, MessageEventOptions, MessagePriority, PluginController, PluginEvent } from "./PluginManager";
import { Robot } from "./RobotManager";

export type PluginControllerListenerInfo = {
    priority: number;
    callback: CallableFunction;
    controllerEvent: PluginEvent;
}

export type PluginControllerCommandInfo = {
    commandInfo: CommandInfo;
    controllerEvent: PluginEvent;
}

export class EventManager {
    private app: App;
    private eventSortDebounce: Record<string, NodeJS.Timeout> = {};
    private eventList: Record<string, PluginControllerListenerInfo[]> = {};
    private commandList: Record<string, PluginControllerCommandInfo> = {};

    constructor(app: App) {
        this.app = app;
    }

    public async initialize() {
        
    }

    public on(event: string, controllerEvent: PluginEvent, callback: CallableFunction, options?: MessageEventOptions) {
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
            controllerEvent
        };

        this.eventList[event].push(eventInfo);

        this.sortEvent(event);
    }

    public off(event: string, controllerEvent: PluginEvent, callback: CallableFunction): void
    public off(controllerEvent: PluginEvent): void
    public off(...args: any): void {
        if (typeof args[0] === 'string') {
            let [event, controller, callback] = args;
            if (Array.isArray(this.eventList[event])) {
                this.eventList[event] = this.eventList[event].filter((eventInfo) => eventInfo.callback !== callback || eventInfo.controllerEvent !== controller);
            }
        } else if (typeof args[0] !== 'undefined') {
            let controller = args[0];
            for (let event in this.eventList) {
                this.eventList[event] = this.eventList[event].filter((eventInfo) => eventInfo.controllerEvent !== controller);
            }
        }
    }

    public addCommand(commandInfo: CommandInfo, controllerEvent: PluginEvent) {
        let data = {
            commandInfo,
            controllerEvent: controllerEvent
        };
        this.commandList[commandInfo.command] = data;
        if (Array.isArray(commandInfo.alias)) {
            commandInfo.alias.forEach((alias) => {
                this.commandList[alias] = data;
            });
        }
    }

    public removeCommand(commandInfo: CommandInfo): void
    public removeCommand(controllerEvent: PluginEvent): void
    public removeCommand(...args: any): void {
        if ('command' in args[0]) {
            let commandInfo: CommandInfo = args[0];
            delete this.commandList[commandInfo.command];
            if (Array.isArray(commandInfo.alias)) {
                commandInfo.alias.forEach((alias) => {
                    delete this.commandList[alias];
                });
            }
        } else if (typeof args[0] !== 'undefined') {
            let controllerEvent = args[0];
            for (let command in this.commandList) {
                if (this.commandList[command].controllerEvent.controller?.id === controllerEvent.controller?.id) {
                    delete this.commandList[command];
                }
            }
        }
    }

    public async emit(eventName: string, senderInfo?: ControllerSubscribeSource | null, ...args: any[]) {
        if (this.app.debug) {
            if (args[0] instanceof CommonReceivedMessage) {
                console.log(`[DEBUG] 触发事件 ${eventName} ${args[0].contentText}`);
            } else {
                console.log(`[DEBUG] 触发事件 ${eventName}`);
            }
        }
        
        const eventList = this.eventList[eventName];
        if (!eventList) return false;

        const isFilter = eventName.startsWith('filter/');

        let isResolved = false;

        const resolved = () => {
            isResolved = true;
        };

        let subscribeList: string[] = [];

        if (senderInfo) {
            // 获取订阅列表
            let targetType = '';
            let targetId = '';
            switch (senderInfo.type) {
                case 'private':
                    targetType = 'user';
                    targetId = senderInfo.userId!;
                    break;
                case 'group':
                    targetType = 'group';
                    targetId = senderInfo.groupId!;
                    break;
                case 'channel':
                    targetType = 'channel';
                    targetId = senderInfo.channelId!;
                    break;
            }
            subscribeList = this.app.subscribe.getSubscribedList(senderInfo.robot.robotId!, targetType, targetId, 'controller');
        }

        for (let eventInfo of eventList) {
            if (!isFilter && senderInfo) {
                if (eventInfo.controllerEvent.autoSubscribe) {
                    if (!eventInfo.controllerEvent.isAllowSubscribe(senderInfo)) {
                        continue;
                    } else {
                        // 需要添加订阅检测
                    }
                } else if (senderInfo.type !== 'private') {
                    if (!eventInfo.controllerEvent.controller || !subscribeList.includes(eventInfo.controllerEvent.controller.id)) {
                        continue;
                    }
                }
            }

            try {
                await eventInfo.callback(...args, resolved);
                if (isResolved) {
                    break;
                }
            } catch(err: any) {
                console.error(`事件 ${eventName} 处理失败`);
                console.error(err);
            }
        }
        
        return isResolved;
    }

    public async emitMessage(message: CommonReceivedMessage) {
        let isResolved = false;

        if (message.origin === 'private' || (message.origin === 'group' && message.mentionedReceiver)) {
            if (this.app.config.focused_as_command) {
                isResolved = await this.emitCommand(message.contentText, message);
                if (isResolved) return true;
            }
            
            isResolved = await this.emit(`message/focused`, this.getSenderInfo(message), message);
            if (isResolved) return true;
        }

        isResolved = await this.emit(`message/${message.origin}`, this.getSenderInfo(message), message);
        if (isResolved) return true;

        isResolved = await this.emit('message', this.getSenderInfo(message), message);
        if (isResolved) return true;

        return false;
    }

    public async emitCommand(contentText: string, message: CommonReceivedMessage) {
        let command = '';
        let args = '';

        // 尝试识别空格分隔的指令
        if (contentText.includes(' ')) {
            command = contentText.split(' ')[0];
            args = contentText.substring(command.length + 1);

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

            args = contentText.substring(command.length);
        }

        if (this.app.debug) {
            console.log('[DEBUG] 指令识别结果', command, args);
        }

        return await this.emit(`command/${command}`, this.getSenderInfo(message), args, message);
    }

    public async emitRawEvent(robot: Robot, event: string, ...args: any[]) {
        return await this.emit(`raw/${robot.type}/${event}`, { type: 'raw', robot: robot }, event);
    }

    public async emitRawMessage(message: CommonReceivedMessage) {
        let isResolved = false;

        await this.emit(`filter/message`, null, message);

        isResolved = await this.emit(`raw/${message.receiver.type}/message`, this.getSenderInfo(message), message);
        if (isResolved) return true;

        return await this.emit('raw/message', this.getSenderInfo(message), message);
    }

    public async emitFilterSendMessage(message: CommonSendMessage) {
        
    }

    public getSenderInfo(message: CommonReceivedMessage): ControllerSubscribeSource {
        if (message.origin === 'private') {
            return {
                type: 'private',
                robot: message.receiver,
                userId: message.sender.uid
            };
        } else if (message.origin === 'group') {
            return {
                type: 'group',
                robot: message.receiver,
                groupId: message.sender.groupId,
                userId: message.sender.uid
            };
        }

        return {
            type: 'unknown',
            robot: message.receiver
        }
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
