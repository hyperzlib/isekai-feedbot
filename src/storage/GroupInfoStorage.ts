import App from "../App";
import { StorageConfig } from "../Config";
import { CacheStore } from "../CacheManager";
import { GroupInfoType } from "../message/Sender";
import { ModelRegistry } from "../DatabaseManager";
import { GroupInfoSchemaType } from "../odm/GroupInfo";
import { RootGroupInfoSchemaType } from "../odm/RootGroupInfo";
import { Types } from "mongoose";
import { RobotStorage } from "./RobotStorage";

export class GroupInfoStorage {
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

        this.cache = app.cache.getStore(['ObjectCache', storages.robotId, 'group_info']);
    }

    public async initialize() {
        this.models = this.storages.models;
    }

    private makeKey(groupId: string, rootGroupId?: string): string {
        if (rootGroupId) {
            return this.cache.makeKey([groupId, rootGroupId]);
        } else {
            return groupId;
        }
    }

    public async get(groupId: string, rootGroupId?: string, fetchFromBot: boolean = false): Promise<GroupInfoSchemaType | null> {
        // from cache
        let groupInfo = await this.cache.get<GroupInfoSchemaType>(this.makeKey(groupId, rootGroupId));
        if (groupInfo) {
            return groupInfo;
        }

        if (fetchFromBot) {
            return await this.fetchFromRobot(groupId, rootGroupId);
        } else if (this.models) {
            let doc = await this.models.groupInfo.findOne(rootGroupId ? {
                groupId,
                rootGroupId,
            } : { groupId });

            if (doc) {
                groupInfo = doc.toObject();

                await this.cache.set(this.makeKey(groupId, rootGroupId), groupInfo, this.cacheTTL);
                return groupInfo;
            }
        } else {
            this.app.logger.warn('未配置 Database');
        }

        return null;
    }

    public async getByRef(groupInfo: GroupInfoSchemaType | string, rootGroupId?: string): Promise<GroupInfoSchemaType | null> {
        if (typeof groupInfo === 'string') {
            return await this.get(groupInfo, rootGroupId, false);
        } else {
            return await this.get(groupInfo.groupId, groupInfo.rootGroupId, false);
        }
    }

    public async fetchFromRobot(groupId: string, rootGroupId?: string): Promise<GroupInfoSchemaType | null> {
        const robot = this.storages.robot;
        if (robot) {
            const groupInfo = await robot.getGroupInfo?.(groupId, rootGroupId);
            if (groupInfo) {
                return await this.set(groupInfo, rootGroupId);
            }
        } else {
            this.app.logger.error(`无法找到机器人配置：${this.storages.robotId}`);
        }
        return null;
    }

    public async set(groupInfo: GroupInfoType, rootGroupInfo?: string | RootGroupInfoSchemaType): Promise<GroupInfoSchemaType> {
        let data: GroupInfoSchemaType = {
            ...groupInfo,
            rootGroupId: typeof rootGroupInfo === 'string' ? rootGroupInfo : rootGroupInfo?.rootGroupId,
        };

        if (this.models) {
            await this.models.groupInfo.updateOne({
                groupId: data.groupId,
                rootGroupId: data.rootGroupId,
            }, data, {
                upsert: true,
                setDefaultsOnInsert: true,
            });
        }

        await this.cache.set(this.makeKey(data.groupId, data.rootGroupId), data, this.cacheTTL);

        return data;
    }

    public async remove(groupId: string, rootGroupId?: string): Promise<void> {
        if (this.models) {
            await this.models.groupInfo.deleteOne({
                groupId,
                rootGroupId,
            });
        }

        await this.cache.del(this.makeKey(groupId, rootGroupId));
    }
}