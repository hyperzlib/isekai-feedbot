import App from "#ibot/App";
import { PluginApiBridge } from "#ibot/plugin/PluginApiBridge";

export class PluginController<ConfigType = Record<string, string>> {
    static id?: string;
    static pluginName?: string;
    static pluginNameMsg?: string;
    static description?: string;
    static descriptionMsg?: string;

    public _app!: App;
    private _config!: ConfigType;

    constructor(app: App, pluginApi: PluginApiBridge) {
        this._app = app;
    }

    public get app() {
        return this._app;
    }

    public getLoagger() {
    }

    public getMessage(msgId: string) {

    }
}