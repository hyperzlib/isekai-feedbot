import App from "../App";
import { StorageConfig } from "../Config";
import { CacheStore } from "../CacheManager";
import { RootGroupInfoType } from "../message/Sender";
import { ModelRegistry } from "../DatabaseManager";
import { RobotStorage } from "./RobotStorage";
import { RootGroupInfoSchemaType } from "../odm/RootGroupInfo";

export class RootGroupInfoStorage {
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

        this.cache = app.cache.getStore(['ObjectCache', storages.robotId, 'root_group_info']);
    }

    public async initialize() {
        this.models = this.storages.models;
    }

    public async get(rootGroupId: string, fetchFromBot: boolean = false): Promise<RootGroupInfoSchemaType | null> {
        // from cache
        let rootGroupInfo = await this.cache.get<RootGroupInfoSchemaType>(rootGroupId);
        if (rootGroupInfo) {
            return rootGroupInfo;
        }

        if (fetchFromBot) {
            return await this.fetchFromRobot(rootGroupId);
        } else if (this.models) {
            let doc = await this.models.rootGroupInfo.findOne({
                rootGroupId,
            });

            if (doc) {
                rootGroupInfo = doc.toObject();

                await this.cache.set(rootGroupId, rootGroupInfo, this.cacheTTL);
                return rootGroupInfo;
            }
        } else {
            this.app.logger.warn('未配置 Database');
        }

        return null;
    }

    public async getByRef(rootGroupInfo: RootGroupInfoSchemaType | string): Promise<RootGroupInfoSchemaType | null> {
        if (typeof rootGroupInfo === 'string') {
            return await this.get(rootGroupInfo, false);
        } else {
            return await this.get(rootGroupInfo.rootGroupId, false);
        }
    }

    public async fetchFromRobot(rootGroupId: string): Promise<RootGroupInfoSchemaType | null> {
        const robot = this.app.robot.getRobot(this.storages.robotId);
        if (robot) {
            const rootGroupInfo = await robot.getRootGroupInfo?.(rootGroupId);
            if (rootGroupInfo) {
                return await this.set(rootGroupInfo);
            }
        } else {
            this.app.logger.error(`无法找到机器人配置：${this.storages.robotId}`);
        }
        return null;
    }

    public async set(rootGroupInfo: RootGroupInfoType): Promise<RootGroupInfoSchemaType> {
        let data: RootGroupInfoSchemaType = {
            ...rootGroupInfo,
        };

        if (this.models) {
            await this.models.rootGroupInfo.updateOne({
                rootGroupId: data.rootGroupId,
            }, data, {
                upsert: true,
                setDefaultsOnInsert: true,
            });
        }

        await this.cache.set(data.rootGroupId, data, this.cacheTTL);

        return data;
    }

    public async remove(rootGroupId: string): Promise<void> {
        if (this.models) {
            await this.models.rootGroupInfo.deleteOne({
                rootGroupId,
            });
        }

        await this.cache.del(rootGroupId);
    }
}