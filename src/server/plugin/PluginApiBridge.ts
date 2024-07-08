import { PluginController } from "#ibot-api/PluginController";
import App from "#ibot/App";
import { PluginEvent, ScopeOptions } from "#ibot/PluginManager";
import { CreateRouterResule as CreateRouterResult, RestfulRouter, RestfulWsRouter } from "#ibot/RestfulApiManager";

export const MAIN_SCOPE_NAME = "main";

export class PluginApiBridge {
    private app: App;
    private _pluginId: string;
    private _controller!: PluginController;
    private currentScope: string | null = null;

    public scopedEvent: Record<string, PluginEvent> = {};

    constructor(app: App, pluginId: string) {
        this.app = app;
        this._pluginId = pluginId;

        this.scopedEvent[MAIN_SCOPE_NAME] = new PluginEvent(this.app, pluginId, "main");
    }

    get event() {
        if (this.currentScope && this.scopedEvent[this.currentScope]) {
            return this.scopedEvent[this.currentScope];
        } else {
            return this.scopedEvent[MAIN_SCOPE_NAME];
        }
    }

    get mainEvent() {
        return this.scopedEvent[MAIN_SCOPE_NAME];
    }

    get pluginId() {
        return this._pluginId;
    }

    get controller() {
        return this._controller;
    }

    public setController(controller: PluginController) {
        this._controller = controller;
    }

    public async destroy() {
        // Remove all event listeners
        for (const scope in this.scopedEvent) {
            await this.scopedEvent[scope].destroy();
        }
    }

    public async getDataPath(creation: boolean = false) {
        return this.app.plugin.getPluginDataPath(this._pluginId, creation);
    }

    public getConfigPath() {
        return this.app.plugin.getPluginConfigPath(this._pluginId);
    }

    public getRestfulRouter(): CreateRouterResult {
        return this.app.restfulApi.getPluginRouter(this._pluginId);
    }

    public useScope(scopeName: string, callback: (event: PluginEvent) => void, scopeOptions?: ScopeOptions) {
        let newScopeEvent = new PluginEvent(this.app, this._pluginId, scopeName, scopeOptions);
        this.scopedEvent[scopeName] = newScopeEvent;
        this.currentScope = scopeName;
        callback(newScopeEvent);
        this.currentScope = null;
    }
}