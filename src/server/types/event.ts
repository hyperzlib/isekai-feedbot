import { MessageCallback, MessageEventOptions, RawEventCallback } from "#ibot/PluginManager";

export type PrivateMessageEvent = ['message/private', MessageCallback];
export type GroupMessageEvent = ['message/group', MessageCallback];
export type ChannelMessageEvent = ['message/channel', MessageCallback];
export type FocusedMessageEvent = ['message/focused', MessageCallback];
export type MessageEvent = ['message', MessageCallback];
export type RawMessageEvent = ['raw/message', MessageCallback];
export type BotRawEventEvent = ['raw/event', MessageCallback];
export type ConfigUpdatedEvent = ['configUpdated', (config: any) => void];
export type PluginInitializedEvent = ['plugin/initialized', () => void];

export type InternalEvents = PrivateMessageEvent | GroupMessageEvent | ChannelMessageEvent | FocusedMessageEvent | MessageEvent | RawMessageEvent |
    BotRawEventEvent | ConfigUpdatedEvent | PluginInitializedEvent;
    
export type CommandEvent = [string, MessageCallback];

export type ListenSystemEventsFunc = {
    <EventDef extends [string, CallableFunction] = InternalEvents>
    (event: EventDef[0], callback: EventDef[1], options?: MessageEventOptions): void;
};

export type ListenHookEventsFunc = {
};

export type ListenEventsFunc = ListenSystemEventsFunc & ListenHookEventsFunc;