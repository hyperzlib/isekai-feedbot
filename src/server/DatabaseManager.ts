import mongoose, { Model } from "mongoose";
import App from "./App";
import { DatabaseConfig } from "./types/config";
import { ChannelInfoModelType, ChannelInfoSchema, ChannelInfoSchemaType } from "./odm/ChannelInfo";
import { GroupInfoModelType, GroupInfoSchema, GroupInfoSchemaType } from "./odm/GroupInfo";
import { RootGroupInfoModelType, RootGroupInfoSchema, RootGroupInfoSchemaType } from "./odm/RootGroupInfo";
import { UserInfoModelType, UserInfoSchema, UserInfoSchemaType } from "./odm/UserInfo";
import { GroupUserInfoModelType, GroupUserInfoSchema, GroupUserInfoSchemaType } from "./odm/GroupUserInfo";
import { MessageModelType, MessageSchema, MessageSchemaType } from "./odm/Message";

export interface ModelBase<TModel extends mongoose.Model<any> = any> {
    table: string;
    schema: (robotId: string) => mongoose.Schema<any, any, TModel>;
}

export type ModelRegistry = {
    userInfo: UserInfoModelType,
    channelInfo: ChannelInfoModelType,
    groupInfo: GroupInfoModelType,
    rootGroupInfo: RootGroupInfoModelType,
    groupUserInfo: GroupUserInfoModelType,
    message: MessageModelType,
}

export class DatabaseManager {
    private app: App;
    private config: DatabaseConfig;

    private robotModels: Record<string, ModelRegistry> = {};

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
        mongoose.pluralize(null);
        await mongoose.connect(this.config.url, options);

        this.app.logger.info('数据库连接初始化成功');
    }

    public createModel = mongoose.model;

    public async getModels(robotId: string): Promise<ModelRegistry> {
        if (!this.app.robot.getRobot(robotId)) {
            throw new Error(`未找到机器人 ${robotId}`);
        }

        // 如果已生成则直接返回
        if (robotId in this.robotModels) {
            return this.robotModels[robotId];
        }

        return this.initRobotModels(robotId);
    }

    public async initRobotModels(robotId: string): Promise<ModelRegistry> {
        if (!this.app.robot.getRobot(robotId)) {
            throw new Error(`未找到机器人 ${robotId}`);
        }

        if (robotId in this.robotModels) {
            throw new Error(`机器人 ${robotId} 的模型已初始化`);
        }

        const models: ModelRegistry = {
            userInfo: mongoose.model<UserInfoSchemaType>(`${robotId}_user_info`, UserInfoSchema(robotId)),
            channelInfo: mongoose.model<ChannelInfoSchemaType>(`${robotId}_channel_info`, ChannelInfoSchema(robotId)),
            groupInfo: mongoose.model<GroupInfoSchemaType>(`${robotId}_group_info`, GroupInfoSchema(robotId)),
            rootGroupInfo: mongoose.model<RootGroupInfoSchemaType>(`${robotId}_root_group_info`, RootGroupInfoSchema(robotId)),
            groupUserInfo: mongoose.model<GroupUserInfoSchemaType>(`${robotId}_group_user_info`, GroupUserInfoSchema(robotId)),
            message: mongoose.model<MessageSchemaType>(`${robotId}_message`, MessageSchema(robotId)),
        };

        this.robotModels[robotId] = models;

        return models;
    }
}