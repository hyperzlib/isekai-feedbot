import App from "../App";
import { Service } from "../ServiceManager";
import Pusher, { Channel } from 'pusher-js';
import { Utils } from "../Utils";

export type PusherServiceConfig = {
    app_id: string;
    key: string;
    secret: string;
    cluster: string;
};

export default class PusherService implements Service {
    private app: App;
    private config: PusherServiceConfig;
    private channelList: { [name: string]: Channel };
    private callbackList: { [name: string]: { [type: string]: Function } }

    public pusher!: Pusher;

    constructor(app: App, config: PusherServiceConfig) {
        this.app = app;
        this.config = config;

        this.channelList = {};
        this.callbackList = {};
    }

    async initialize() {
        this.pusher = new Pusher(this.config.key, {
            cluster: this.config.cluster,
            forceTLS: true,
        });
        if(this.app.config.debug){
            Pusher.logToConsole = true;
        }
    }

    // 好像不需要
    async destory() {

    }

    /**
     * 获取channel
     */
    getChannel(channelName: string): Channel {
        if (!(channelName in this.channelList)) {
            this.channelList[channelName] = this.pusher.subscribe(channelName);
            this.callbackList[channelName] = {};
        }
        return this.channelList[channelName];
    }

    /**
     * 解除订阅channel
     */
    public unsubscribeChannel(channelName: string) {
        this.pusher.unsubscribe(channelName);
        if (channelName in this.channelList) {
            delete this.channelList[channelName];
            delete this.callbackList[channelName];
        }
    }

    /**
     * 绑定事件
     */
    public on(channelName: string, eventName: string, callback: Function) {
        // 先解除绑定之前的
        this.off(channelName, eventName);

        let channel = this.getChannel(channelName);
        channel.bind(eventName, callback);
        this.callbackList[channelName][eventName] = callback;
    }

    /**
     * 解除绑定事件
     */
    public off(channelName: string, eventName: string) {
        if (!(channelName in this.channelList)) return;
        let channel = this.channelList[channelName];
        let callback = this.callbackList[channelName][eventName];
        if (callback) {
            channel.unbind(eventName);
            delete this.callbackList[channelName][eventName];
        }
        if (Utils.count(this.callbackList[channelName]) === 0) {
            this.unsubscribeChannel(channelName);
        }
    }
}
