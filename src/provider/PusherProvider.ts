import App from "../App";
import { BaseProvider, MultipleMessage } from "../base/provider/BaseProvider";
import { ChannelConfig } from "../Config";
import { ConfigCheckError } from "../error/ConfigCheckError";
import PusherService from "../service/PusherService";
import { string, optional, object, guard } from "decoders";

export type PusherProviderConfig = {
    source: {
        service: string;
        channel: string;
        type: string;
    }
}

export default class PusherProvider extends BaseProvider {
    static providerName = "pusher";
    static defaultConfig = {
        source: {
            service: "pusher"
        }
    };

    protected config: PusherProviderConfig;

    private service: PusherService;

    /**
     * @param {App} app 
     * @param {any} config 
     */
    constructor(app: App, channelId: string, config: ChannelConfig) {
        super(app, channelId, config);
        this.config = config;

        if (!this.checkConfig()) {
            throw new ConfigCheckError("配置文件错误");
        }
        
        let service = app.getService<PusherService>(config.source.service);
        this.service = service;
    }

    checkConfig() {
        let checkType = guard(
            object({
                source: object({
                    service: optional(string),
                    channel: string,
                    type: string,
                })
            })
        );

        return checkType(this.config);
    }

    async initialize() {
        await super.initialize();

        // 绑定事件
        let srcConf = this.config.source;
        this.service.on(srcConf.channel, srcConf.type, this.onData.bind(this));
    }

    async destory() {
        let srcConf = this.config.source;
        this.service.off(srcConf.channel, srcConf.type);
        await super.destory();
    }

    async onData(data: any) {
        let messages: MultipleMessage = {};
        try {
            messages = await this.generator.generate(data);
            this.sendMessage(messages);
        } catch(err: any) {
            this.error('无法解析数据', err);
        }
    }
}
