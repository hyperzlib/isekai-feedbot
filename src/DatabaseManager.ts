import mongoose from "mongoose";
import App from "./App";
import { DatabaseConfig } from "./Config";
import { MessageSchema, MessageSchemaType } from "./orm/Message";

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

        this.app.logger.info('数据库连接初始化成功');
    }

    getModel<T>(name: string, schema: mongoose.Schema<T>): mongoose.Model<T> {
        return mongoose.model<T>(name, schema);
    }

    getMessageModel(type: 'private' | 'group' | 'channel', id?: string): mongoose.Model<MessageSchemaType> {
        if (type === 'private') {
            return this.getModel<MessageSchemaType>('Private_Message', MessageSchema);
        } else if (type === 'group') {
            return this.getModel<MessageSchemaType>(`Group_${id}_Message`, MessageSchema);
        } else if (type === 'channel') {
            return this.getModel<MessageSchemaType>(`Channel_${id}_Message`, MessageSchema);
        } else {
            throw new Error('Invalid message type');
        }
    }
}