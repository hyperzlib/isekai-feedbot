import App from "#ibot/App";
import { PluginEvent, PluginInstance, ScopeOptions } from "#ibot/PluginManager";
import { CommonMessage } from "#ibot/message/Message";
import { PluginApiBridge } from "#ibot/plugin/PluginApiBridge";
import { Logger } from "#ibot/utils/Logger";
import Router from "koa-router";
import { Resource } from "./types/interface";
import { CreateRouterResule, RestfulRouter, RestfulWsRouter } from "#ibot/RestfulApiManager";

export type PluginIndexFileType = {
    id: string,
    controller?: string,
    name?: string,
    description?: string,
    version?: string,
    author?: string,
    message_path?: string,
}

export type ResourceOptions = {
    ignoreInit?: boolean,
};

export type ResourceItem = {
    res: Resource,
    options: ResourceOptions,
};

export enum PluginReadyState {
    Created = 0,
    Initializing = 1,
    Initialized = 2,
    Destroyed = 4,
};

export class PluginController<ConfigType = Record<string, string>> {
    public static reloadWhenConfigUpdated?: boolean;

    public id: string = "";

    private _readyState: PluginReadyState = PluginReadyState.Created;
    public get readyState() {
        return this._readyState;
    }

    private _app: App;
    private _logger: Logger;
    private _bridge: PluginApiBridge;
    private _pluginInfo: PluginIndexFileType;
    private _router?: CreateRouterResule;

    public resources: ResourceItem[] = [];
    
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

    public get router() {
        return this._router;
    }

    public async _initialize(config: any): Promise<void> {
        await this._setConfig(config);
        this._readyState = PluginReadyState.Initializing;
        await this.initialize(config);
        this._readyState = PluginReadyState.Initialized;

        // Initialize resources
        for (const { res, options } of this.resources) {
            if (!options.ignoreInit) {
                await res.initialize?.();
            }
        }
    }
    public async initialize(config: any): Promise<void> { }

    public async postInit(): Promise<void> { }

    public async _destroy(): Promise<void> {
        this._readyState = PluginReadyState.Destroyed;
        await this.destroy();

        // Destroy resources
        for (const { res } of this.resources) {
            await res.destroy?.();
        }
    }

    public async destroy(): Promise<void> { };

    public async getDefaultConfig(): Promise<any> {
        return {};
    }
    
    public async _setConfig(config: any): Promise<void> {
        this.config = config;
        await this.setConfig(config);
    }
    public async setConfig(config: any): Promise<void> { }

    public getConfigPath(): string {
        return this._bridge.getConfigPath();
    }

    public async getDataPath(creation: boolean = false): Promise<string> {
        return this._bridge.getDataPath(creation);
    }

    public getRestfulRouter(): CreateRouterResule {
        this._router = this._bridge.getRestfulRouter();
        return this._router;
    }

    public useScope(scopeName: string, callback: (event: PluginEvent) => void, scopeOptions?: ScopeOptions) {
        this._bridge.useScope(scopeName, callback, scopeOptions);
    }

    public async initResource(resource: Resource, options: ResourceOptions = {}) {
        this.resources.push({ res: resource, options });

        // Initialize immediately
        if (!options.ignoreInit && this._readyState === PluginReadyState.Initialized) {
            await resource.initialize?.();
        }
    }

    public async removeResource(resource: Resource) {
        this.resources = this.resources.filter((item) => item.res !== resource);
    }
}