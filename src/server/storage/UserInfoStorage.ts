import App from "../App";
import { StorageConfig } from "../types/config";
import { CacheStore } from "../CacheManager";
import { UserInfoType } from "../message/Sender";
import { ModelRegistry } from "../DatabaseManager";
import { UserInfoSchemaType } from "../odm/UserInfo";
import { RobotStorage } from "./RobotStorage";

export class UserInfoStorage {
    private app: App;
    private config: StorageConfig;
    private storages: RobotStorage;
    private models?: ModelRegistry;
    private cacheTTL: number;

    private cache: CacheStore;

    public constructor(app: App, config: StorageConfig, storages: RobotStorage) {
        this.app = app;
        this.config = config;
        this.cacheTTL = config.cache_ttl ?? 86400;
        this.storages = storages;

        this.cache = app.cache.getStore(['ObjectCache', storages.robotId, 'user_info']);
    }

    public async initialize() {
        this.models = this.storages.models;
    }

    public async get(userId: string, fetchFromBot: boolean = false): Promise<UserInfoSchemaType | null> {
        // from cache
        let userInfo = await this.cache.get<UserInfoSchemaType>(userId);
        if (userInfo) {
            return userInfo;
        }

        if (fetchFromBot) {
            return await this.fetchFromRobot(userId);
        } else if (this.models) {
            let doc = await this.models.userInfo.findOne({
                userId,
            });

            if (doc) {
                userInfo = doc.toObject();
                
                await this.cache.set(userId, userInfo, this.cacheTTL);
                return userInfo;
            }
        } else {
            this.app.logger.warn('未配置 Database');
        }

        return null;
    }

    public async getByRef(userInfo: UserInfoSchemaType | string): Promise<UserInfoSchemaType | null> {
        if (typeof userInfo === 'string') {
            return await this.get(userInfo, false);
        } else {
            return await this.get(userInfo.userId, false);
        }
    }

    public async fetchFromRobot(userId: string): Promise<UserInfoSchemaType | null> {
        const robot = this.app.robot.getRobot(this.storages.robotId);
        if (robot) {
            const userInfoList = await robot.getUsersInfo?.([userId]);
            if (userInfoList && userInfoList.length > 0) {
                const userInfo = userInfoList[0];
                if (userInfo) {
                    return await this.set(userInfo);
                }
            }
        } else {
            this.app.logger.error(`无法找到机器人配置：${this.storages.robotId}`);
        }
        return null;
    }

    public async set(userInfo: UserInfoType): Promise<UserInfoSchemaType> {
        let data: UserInfoSchemaType = {
            ...userInfo,
        }
        if (this.models) {
            await this.models.userInfo.updateOne({
                userId: data.userId,
            }, data, {
                upsert: true,
                setDefaultsOnInsert: true,
            });
        }

        await this.cache.set(data.userId, data, this.cacheTTL);

        return data;
    }

    public async remove(userId: string): Promise<void> {
        if (this.models) {
            await this.models.userInfo.deleteOne({
                userId,
            });
        }

        await this.cache.del(userId);
    }
}