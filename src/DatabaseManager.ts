import mongoose from "mongoose";
import App from "./App";
import { DatabaseConfig } from "./Config";

export class DatabaseManager {
    private app: App;
    private config: DatabaseConfig;

    constructor(app: App, config: DatabaseConfig) {
        this.app = app;
        this.config = config;
    }

    async initialize() {
        let options: mongoose.ConnectOptions = {};
        if (this.config.user) {
            options.auth = {
                username: this.config.user,
                password: this.config.password
            };
        }
        await mongoose.connect(this.config.url, options);
    }
}