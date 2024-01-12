import App from "#ibot/App";
import { PluginEvent } from "#ibot/PluginManager";
import { PluginApiBridge } from "#ibot/plugin/PluginApiBridge";
import { Logger } from "#ibot/utils/Logger";

export class PluginController<ConfigType = Record<string, string>> {
    public static id: string;
    public static pluginName?: string;
    public static description?: string;

    public static reloadWhenConfigUpdated?: boolean;

    private _app: App;
    private _logger: Logger;
    private _bridge: PluginApiBridge;
    
    public config!: ConfigType;

    constructor(app: App, pluginApi: PluginApiBridge) {
        this._app = app;
        this._bridge = pluginApi;

        const ctor = this.constructor as typeof PluginController;
        this._logger = app.getLogger(ctor.pluginName ?? "Plugin");
    }

    public get app() {
        return this._app;
    }

    public get logger() {
        return this._logger;
    }

    public get event() {
        return this._bridge.event;
    }

    public getMessage(msgId: string) {

    }

    public async _initialize(config: any): Promise<void> {
        await this._setConfig(config);
        await this.initialize(config);
    }
    public async initialize(config: any): Promise<void> { }

    public async destroy(): Promise<void> { };

    public async getDefaultConfig(): Promise<any> {
        return {};
    }
    
    public async _setConfig(config: any): Promise<void> {
        this.config = config;
        await this.setConfig(config);
    }
    public async setConfig(config: any): Promise<void> { }

    public useScope(scopeName: string, callback: (event: PluginEvent) => void) {
        this._bridge.useScope(scopeName, callback);
    }
}