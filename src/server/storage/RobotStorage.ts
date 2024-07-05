import { Robot } from "#ibot/robot/Robot";
import App from "../App";
import { StorageConfig } from "../types/config";
import { ModelRegistry } from "../DatabaseManager";
import { ChannelInfoStorage } from "./ChannelInfoStorage";
import { GroupInfoStorage } from "./GroupInfoStorage";
import { GroupUserInfoStorage } from "./GroupUserInfoStorage";
import { MessageStorage } from "./MessageStorage";
import { RootGroupInfoStorage } from "./RootGroupInfoStorage";
import { UserInfoStorage } from "./UserInfoStorage";
import EventEmitter from "events";

export class RobotStorage {
    private app: App;
    private config: StorageConfig;
    private _robotId: string;
    private _robot?: Robot;
    private _models?: ModelRegistry;
    private _onLoadCallbacks: CallableFunction[] = [];

    private _readyState: 'create' | 'loading' | 'loaded' = 'create';

    public userInfo: UserInfoStorage;
    public channelInfo: ChannelInfoStorage;
    public rootGroupInfo: RootGroupInfoStorage;
    public groupInfo: GroupInfoStorage;
    public groupUserInfo: GroupUserInfoStorage;
    public message: MessageStorage;

    public constructor(app: App, config: StorageConfig, robotId: string) {
        this.app = app;
        this.config = config;
        this._robotId = robotId;

        this.userInfo = new UserInfoStorage(app, config, this);
        this.channelInfo = new ChannelInfoStorage(app, config, this);
        this.rootGroupInfo = new RootGroupInfoStorage(app, config, this);
        this.groupInfo = new GroupInfoStorage(app, config, this);
        this.groupUserInfo = new GroupUserInfoStorage(app, config, this);
        this.message = new MessageStorage(app, config, this);
    }

    public async initialize() {
        if (this._readyState === 'create') {
            this._readyState = 'loading';

            this._models = await this.app.database?.getModels(this.robotId);
            this._robot = this.app.robot.getRobot(this.robotId) ?? undefined;

            await this.userInfo.initialize();
            await this.channelInfo.initialize();
            await this.rootGroupInfo.initialize();
            await this.groupInfo.initialize();
            await this.groupUserInfo.initialize();
            await this.message.initialize();

            this._readyState = 'loaded';
            
            this._onLoadCallbacks.forEach((cb) => cb());
            this._onLoadCallbacks = [];
        }
    }

    public with(): Promise<void> {
        return new Promise((resolve, reject) => {
            switch (this._readyState) {
                case 'loaded':
                    resolve();
                    break;
                case 'create':
                    this.initialize().then(() => resolve()).catch((err) => reject(err));
                    break;
                case 'loading':
                    this._onLoadCallbacks.push(() => resolve());
                    break;
            }
        });
    }

    public get readyState() {
        return this._readyState;
    }

    public get robotId() {
        return this._robotId;
    }

    public get models() {
        return this._models;
    }

    public get robot() {
        return this._robot;
    }
}