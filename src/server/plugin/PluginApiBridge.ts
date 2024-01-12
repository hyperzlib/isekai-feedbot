import { PluginController } from "#ibot-api/PluginController";
import App from "#ibot/App";
import { PluginEvent } from "#ibot/PluginManager";

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

    }

    public useScope(scopeName: string, callback: (event: PluginEvent) => void) {
        let newScopeEvent = new PluginEvent(this.app, this._pluginId, scopeName);
        this.scopedEvent[scopeName] = newScopeEvent;
        this.currentScope = scopeName;
        callback(newScopeEvent);
        this.currentScope = null;
    }
}