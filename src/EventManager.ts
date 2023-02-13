import EventEmitter from "events";
import { debounce } from "throttle-debounce";
import App from "./App";
import { CommonReceivedMessage } from "./message/Message";
import { GroupSender, UserSender } from "./message/Sender";
import { Robot } from "./RobotManager";

export class EventManager {
    private app: App;
    private eventEmitter: EventEmitter;
    private eventGroup: Record<string, EventGroup> = {};
    private eventHandlerList: Record<string, EventGroup[]> = {};

    constructor(app: App) {
        this.app = app;
        this.eventEmitter = new EventEmitter;
    }

    public async initialize() {

    }

    public getEventGroup() {

    }
}

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
    /** Base sources: private, group, channel */
    source?: string[],
    robotApi?: string[],
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
export type CommandCallback = (argv: string[], message: CommonReceivedMessage, resolved: VoidFunction) => any;
export type RawEventCallback = (robot: Robot, event: any, resolved: VoidFunction) => any;

export type AllowedList = string[] | '*';

export class EventGroup {
    readonly id: string;

    public allowPrivate = true;
    public allowGroup = true;

    public allowedGroupList: AllowedList = '*';

    private commandList: CommandInfo[] = [];
    private eventList: Record<string, EventListenerInfo[]> = {};

    constructor(id: string) {
        this.id = id;
    }

    public shouldAllowSource: (sender: any) => boolean = (sender) => {
        if (sender instanceof UserSender) {
            if (this.allowPrivate) {
                return true;
            }
        } else if (sender instanceof GroupSender) {
            if (this.allowedGroupList === '*') {
                return true;
            } else if (this.allowedGroupList.includes(sender.groupId)) {
                return true;
            }
        }
        return false;
    }

    public emit(eventName: string, ...args: any[]) {
        const eventList = this.eventList[eventName];

        let isResolved = false;
        let isBreakAll = false;

        const resolved = (breakAll: boolean = false) => {
            isResolved = true;
            if (breakAll) {
                isBreakAll = true;
            }
        };

        for (let eventInfo of eventList) {
            eventInfo.callback(...args, resolved);
            if (isResolved) {
                break;
            }
        }
        
        return !isBreakAll;
    }

    on(event: string, callback: CallableFunction, options?: MessageEventOptions) {
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
        const singleEventList = this.eventList[event];
        const priority = options.priority!;

        // Add event to specified position
        if (singleEventList.length === 0) {
            singleEventList.push(eventInfo);
        } else {
            for (let i = 0; i < singleEventList.length; i++) {
                if (singleEventList[i].priority < priority) {
                    const target = i - 1;
                    if (target === 0) {
                        singleEventList.unshift(eventInfo);
                    } else {
                        this.eventList[event] = [
                            ...singleEventList.slice(0, target),
                            eventInfo,
                            ...singleEventList.slice(target)
                        ];
                    }
                }
            }
        }
    }

    addCommand(command: string, name: string, callback: MessageCallback, options?: MessageEventOptions): void
    addCommand(commandInfo: CommandInfo, callback: MessageCallback, options?: MessageEventOptions): void
    addCommand(...args: any[]): void {
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

        // 注册消息
        this.commandList.push(commandInfo as any);
        this.on(`command/${commandInfo.command}`, callback, options);
        if (Array.isArray(commandInfo.alias)) { // Add event for alias
            commandInfo.alias.forEach((cmd) => {
                this.on(`command/${cmd}`, callback, options);
            });
        }
    }

    /**
     * Add message handle.
     * will be trigger on private message or group message with mentions to robot
     * @param callback 
     * @param options 
     */
    onMentionedMessage(callback: MessageCallback, options?: MessageEventOptions) {
        this.on('mentionedMessage', callback, options);
        this.on('privateMessage', callback, options);
    }

    /**
     * Add private message handle.
     * @param callback 
     * @param options 
     */
    onPrivateMessage(callback: MessageCallback, options?: MessageEventOptions) {
        this.on('privateMessage', callback, options);
    }

    /**
     * Add group message handle.
     * @param callback 
     * @param options 
     */
    onGroupMessage(callback: MessageCallback, options?: MessageEventOptions) {
        this.on('groupMessage', callback, options);
    }

    /**
     * Add message handle.
     * Will handle all messages in group
     * @param callback 
     * @param options 
     */
    onMessage(callback: MessageCallback, options?: MessageEventOptions) {
        this.on('message', callback, options);
    }

    /**
     * Add raw message handle.
     * Will be triggered even when the message is a command.
     * @param callback 
     * @param options 
     */
    onRawMessage(callback: MessageCallback, options?: MessageEventOptions) {
        this.on('rawMessage', callback, options);
    }

    onRawEvent(callback: RawEventCallback, options?: MessageEventOptions) {
        this.on('rawEvent', callback, options);
    }
}