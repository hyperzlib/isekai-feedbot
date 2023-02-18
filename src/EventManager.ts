import App from "./App";
import { CommonReceivedMessage, CommonSendMessage } from "./message/Message";
import { GroupSender, UserSender } from "./message/Sender";
import { ControllerSubscribeSource, MessageEventOptions, MessagePriority, PluginController } from "./PluginManager";
import { Robot } from "./RobotManager";

export type PluginControllerListenerInfo = {
    priority: number;
    callback: CallableFunction;
    controller: PluginController;
}

export class EventManager {
    private app: App;
    private eventSortDebounce: Record<string, NodeJS.Timeout> = {};
    private eventList: Record<string, PluginControllerListenerInfo[]> = {};

    constructor(app: App) {
        this.app = app;
    }

    public async initialize() {
        
    }

    on(event: string, controller: PluginController, callback: CallableFunction, options?: MessageEventOptions) {
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
            controller: controller
        };

        this.eventList[event].push(eventInfo);

        this.sortEvent(event);
    }

    off(event: string, controller: PluginController, callback: CallableFunction): void
    off(controller: PluginController): void
    off(...args: any): void {
        if (typeof args[0] === 'string') {
            let [event, controller, callback] = args;
            if (Array.isArray(this.eventList[event])) {
                this.eventList[event] = this.eventList[event].filter((eventInfo) => eventInfo.callback !== callback || eventInfo.controller !== controller);
            }
        } else if (typeof args[0] !== 'undefined') {
            let controller = args[0];
            for (let event in this.eventList) {
                this.eventList[event] = this.eventList[event].filter((eventInfo) => eventInfo.controller !== controller);
            }
        }
    }

    public async emit(eventName: string, senderInfo: ControllerSubscribeSource, ...args: any[]) {
        const eventList = this.eventList[eventName];
        if (!eventList) return false;

        let isResolved = false;

        const resolved = () => {
            isResolved = true;
        };

        for (let eventInfo of eventList) {
            if (eventInfo.controller.autoSubscribe) {
                if (!eventInfo.controller.isAllowSubscribe(senderInfo)) {
                    continue;
                } else {
                    // 需要添加订阅检测
                }
            } else {
                // 需要添加订阅检测
                continue;
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
            isResolved = await this.emit(`message/focused`, this.getSenderInfo(message), message);
            if (isResolved) return true;
        }

        isResolved = await this.emit(`message/${message.origin}`, this.getSenderInfo(message), message);
        if (isResolved) return true;

        isResolved = await this.emit('message', this.getSenderInfo(message), message);
        if (isResolved) return true;

        return false;
    }

    public async emitCommand(command: string, args: string, message: CommonReceivedMessage) {
        return await this.emit(`command/${command}`, this.getSenderInfo(message), args, message);
    }

    public async emitRawEvent(robot: Robot, event: string, ...args: any[]) {
        return await this.emit(`raw/${robot.type}/${event}`, { type: 'raw', robot: robot }, event);
    }

    public async emitRawMessage(message: CommonReceivedMessage) {
        let isResolved = false;
        isResolved = await this.emit(`raw/${message.receiver.type}/message`, this.getSenderInfo(message), message);
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
