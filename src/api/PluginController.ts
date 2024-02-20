import App from "#ibot/App";
import { PluginEvent, PluginInstance } from "#ibot/PluginManager";
import { CommonMessage } from "#ibot/message/Message";
import { PluginApiBridge } from "#ibot/plugin/PluginApiBridge";
import { Logger } from "#ibot/utils/Logger";

export type PluginIndexFileType = {
    id: string,
    controller?: string,
    name?: string,
    description?: string,
    version?: string,
    author?: string,
    message_path?: string,
}

export class PluginController<ConfigType = Record<string, string>> {
    public static reloadWhenConfigUpdated?: boolean;

    public id: string = "";

    private _app: App;
    private _logger: Logger;
    private _bridge: PluginApiBridge;
    private _pluginInfo: PluginIndexFileType;
    
    public config!: ConfigType;

    constructor(app: App, pluginApi: PluginApiBridge, pluginInfo: PluginIndexFileType) {
        this._app = app;
        this._bridge = pluginApi;
        this._pluginInfo = pluginInfo;

        this._logger = app.getLogger(pluginInfo.name ?? "Plugin");
    }

    public get app() {
        return this._app;
    }

    public get logger() {
        return this._logger;
    }

    public get pluginInfo() {
        return this._pluginInfo;
    }

    public get event() {
        return this._bridge.event;
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