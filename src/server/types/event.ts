import { MessageCallback, MessageEventOptions, RawEventCallback } from "#ibot/PluginManager";

export type ListenSystemEventsFunc = {
    /**
     * Add private message handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    (event: 'message/private', callback: MessageCallback, options?: MessageEventOptions): void;
    /**
     * Add group message handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    (event: 'message/group', callback: MessageCallback, options?: MessageEventOptions): void;
    /**
     * Add channel message handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    (event: 'message/channel', callback: MessageCallback, options?: MessageEventOptions): void;
    /**
     * Add focused message handle.
     * will be trigger on private message or group message with mentions to robot
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    (event: 'message/focused', callback: MessageCallback, options?: MessageEventOptions): void;
    /**
     * Add message handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    (event: 'message', callback: MessageCallback, options?: MessageEventOptions): void;
    /**
     * Add raw message handler.
     * Will be triggered even when the message is a command.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    (event: 'raw/message', callback: MessageCallback, options?: MessageEventOptions): void;
    /**
     * Add robot raw event handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    (event: 'raw/event', callback: RawEventCallback, options?: MessageEventOptions): void;
    /**
     * Add config updated handler.
     * @param event Event name
     * @param callback Callback function
     */
    (event: 'configUpdated', callback: (config: any) => void): void;
    /**
     * Add event handler.
     * @param event Event name
     * @param callback Callback function
     * @param options Options
     */
    (event: string, callback: CallableFunction, options?: MessageEventOptions): void
};

export type ListenHookEventsFunc = {
};

export type ListenEventsFunc = ListenSystemEventsFunc & ListenHookEventsFunc;