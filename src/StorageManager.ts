import App from "./App";
import { StorageConfig } from "./Config";
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
        if (robotId in this.robotStorages) {
            return this.robotStorages[robotId];
        }

        const storages = new RobotStorage(this.app, this.config, robotId);

        await storages.initialize();

        return storages;
    }
}