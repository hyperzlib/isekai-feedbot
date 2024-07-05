import App from "./App";
import { StorageConfig } from "./types/config";
import { RobotStorage } from "./storage/RobotStorage";
import { UserInfoStorage } from "./storage/UserInfoStorage";

export class StorageManager {
    private app: App;
    private config: StorageConfig;

    private robotStorages: Record<string, RobotStorage> = {};

    public constructor(app: App, config: StorageConfig) {
        this.app = app;
        this.config = config;
    }

    public async initialize() {
        
    }

    public async getStorages(robotId: string): Promise<RobotStorage> {
        if (!this.app.robot.getRobot(robotId)) {
            throw new Error(`未找到机器人 ${robotId}`);
        }

        // 如果已生成则直接返回
        let storages: RobotStorage;
        if (robotId in this.robotStorages) {
            storages = this.robotStorages[robotId];
        } else {
            storages = new RobotStorage(this.app, this.config, robotId);
            this.robotStorages[robotId] = storages;
        }

        await storages.with();

        return storages;
    }
}