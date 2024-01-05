import App from "#ibot/App";

export class PluginApiBridge {
    private app!: App;

    constructor(app: App) {
        this.app = app;
    }
}