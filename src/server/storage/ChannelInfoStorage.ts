import App from "../App";
import { StorageConfig } from "../Config";
import { CacheStore } from "../CacheManager";
import { ChannelInfoType, RootGroupInfoType } from "../message/Sender";
import { ModelRegistry } from "../DatabaseManager";
import { ChannelInfoSchemaType } from "../odm/ChannelInfo";
import { RobotStorage } from "./RobotStorage";

export class ChannelInfoStorage {
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

        this.cache = app.cache.getStore(['ObjectCache', storages.robotId, 'channel_info']);
    }

    public async initialize() {
        this.models = this.storages.models;
    }

    public async get(channelId: string, fetchFromBot: boolean = false): Promise<ChannelInfoSchemaType | null> {
        // from cache
        let channelInfo = await this.cache.get<ChannelInfoSchemaType>(channelId);
        if (channelInfo) {
            return channelInfo;
        }

        if (fetchFromBot) {
            return await this.fetchFromRobot(channelId);
        } else if (this.models) {
            let doc = await this.models.channelInfo.findOne({
                channelId,
            });

            if (doc) {
                channelInfo = doc.toObject();

                await this.cache.set(channelId, channelInfo, this.cacheTTL);
                return channelInfo;
            }
        } else {
            this.app.logger.warn('未配置 Database');
        }

        return null;
    }

    public async getByRef(channelInfo: ChannelInfoSchemaType | string): Promise<ChannelInfoSchemaType | null> {
        if (typeof channelInfo === 'string') {
            return await this.get(channelInfo, false);
        } else {
            return await this.get(channelInfo.channelId, false);
        }
    }

    public async fetchFromRobot(channelId: string): Promise<ChannelInfoSchemaType | null> {
        const robot = this.storages.robot;
        if (robot) {
            const channelInfo = await robot.getChannelInfo?.(channelId);
            if (channelInfo) {
                return await this.set(channelInfo);
            }
        } else {
            this.app.logger.error(`无法找到机器人配置：${this.storages.robotId}`);
        }
        return null;
    }

    public async set(channelInfo: ChannelInfoType): Promise<ChannelInfoSchemaType> {
        let data: ChannelInfoSchemaType = {
            ...channelInfo
        };

        if (this.models) {
            await this.models.channelInfo.updateOne({
                channelId: data.channelId,
            }, data, {
                upsert: true,
                setDefaultsOnInsert: true,
            });
        }

        await this.cache.set(data.channelId, data, this.cacheTTL);

        return data;
    }

    public async remove(channelId: string): Promise<void> {
        if (this.models) {
            await this.models.channelInfo.deleteOne({
                channelId,
            });
        }

        await this.cache.del(channelId);
    }
}