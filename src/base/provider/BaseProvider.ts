import App from "../../App";
import { ChannelConfig } from "../../Config";
import { Generator } from "../../generator/Generator";

export type MultipleMessage = { [type: string]: string };

export class BaseProvider {
    public static providerName: string = "";
    public static defaultConfig: any = {};

    protected app: App;
    protected channelId: string;
    protected config: ChannelConfig;
    protected generator!: Generator;

    constructor(app: App, channelId: string, config: ChannelConfig) {
        this.app = app;
        this.channelId = channelId;
        this.config = config;
    }

    async initialize() {
        this.generator = new Generator(this.app, this.config);
        await this.generator.initialize();
    }

    async destory() {
        if (this.generator) {
            await this.generator.destory();
        }
    }

    static checkConfig(config: any) {
        if (typeof config.source !== "object") {
            return false;
        }

        return true;
    }

    /**
     * 发送消息
     */
    sendMessage(messages: MultipleMessage) {
        this.app.sendMessage(this.channelId, messages)
            .then(() => {})
            .catch((err) => {
                this.error('无法发送消息', err);
            });
    }

    /**
     * 发送消息（异步）
     */
    sendMessageAsync(messages: MultipleMessage): Promise<void> {
        return this.app.sendMessage(this.channelId, messages);
    }

    /**
     * 输出错误信息
     * @param {string} message 
     * @param {Error|undefined} err 
     */
    error(message: string, err?: Error) {
        console.error(`[${this.channelId}] ${message}`, err);
    }
}
