import { CommonMessage, CommonReceivedMessage, MessageChunk } from "#ibot/message/Message";
import { Robot } from "#ibot/robot/Robot";
import { Reactive } from "#ibot/utils";

export type MessageEventOptions = {
    priority?: number,
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

export type PrivateMessageEvent = { 'message/private': MessageCallback };
export type GroupMessageEvent = { 'message/group': MessageCallback };
export type ChannelMessageEvent = { 'message/channel': MessageCallback };
export type FocusedMessageEvent = { 'message/focused': MessageCallback };
export type MessageEvent = { 'message': MessageCallback };
export type RawMessageEvent = { 'raw/message': MessageCallback };
export type BotRawEventEvent = { 'raw/event': MessageCallback };
export type EditMessageEvent = { 'editMessage': (message: Reactive<CommonReceivedMessage>, oldMessageContent: MessageChunk[], resolved: VoidFunction) => void };
export type DeleteMessageEvent = { 'deleteMessage': (message: Reactive<CommonMessage>, resolved: VoidFunction) => void };
export type InteractMessageEvent = { 'interactMessage': CommandCallback };
export type ConfigUpdatedEvent = { 'configUpdated': (config: any) => void };
export type PluginInitializedEvent = { 'plugin/initialized': () => void };

export type InternalEvents = PrivateMessageEvent & GroupMessageEvent & ChannelMessageEvent & FocusedMessageEvent & MessageEvent & RawMessageEvent &
    BotRawEventEvent & EditMessageEvent & DeleteMessageEvent & InteractMessageEvent & ConfigUpdatedEvent & PluginInitializedEvent;
    
export type CommandEvent = Record<string, MessageCallback>;

export type ListenSystemEventsFunc = {
    <EventDef = InternalEvents, EventName extends keyof EventDef = keyof EventDef>
    (event: EventName, callback: EventDef[EventName], options?: MessageEventOptions): void;
    (event: string, callback: (...args: any[]) => any, options?: MessageEventOptions): void;
};

export type ListenHookEventsFunc = {
};

export type ListenEventsFunc = ListenSystemEventsFunc & ListenHookEventsFunc;