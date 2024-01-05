import fs from 'fs';
import path from 'path';
import App from './App';
import { BaseProvider } from './base/provider/BaseProvider';
import { ChannelConfig } from './Config';

export class ProviderManager {
    private app: App;
    private providerClasses: { [key: string]: any }

    constructor(app: App) {
        this.app = app;
        this.providerClasses = {};
    }

    async initialize() {
        const PROVIDER_PATH = path.join(this.app.srcPath, "provider");

        for (let file of fs.readdirSync(PROVIDER_PATH)) {
            let providerFile = `${PROVIDER_PATH}/${file}`;
            if (providerFile.match(/\.(js|mjs)$/)) {
                // 加载js文件
                let providerName = path.basename(providerFile).replace(/Provider\.(js|mjs)$/gi, "").toLocaleLowerCase();
                try {
                    let provider = await import(providerFile);
                    if (!provider || !provider.default) {
                        throw new Error("provider is empty");
                    }
                    this.providerClasses[providerName] = provider.default;
                    this.app.logger.info(`已加载Provider: ${providerName}`);
                } catch(err) {
                    this.app.logger.info(`无法加载Provider: ${providerName}`, err);
                }
            }
        }
    }
    
    /**
     * 创建Provider
     * @param {string} providerName
     * @param {any} config
     */
    create(providerName: string, channelId: string, config: ChannelConfig): BaseProvider | null {
        providerName = providerName.toLocaleLowerCase();
        if (providerName in this.providerClasses) {
            let CurrentProvider: any = this.providerClasses[providerName];
            return new CurrentProvider(this.app, channelId, config);
        } else {
            return null;
        }
    }
}
