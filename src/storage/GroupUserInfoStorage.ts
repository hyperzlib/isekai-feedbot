import App from "../App";
import { StorageConfig } from "../Config";
import { CacheStore } from "../CacheManager";
import { GroupUserInfoType } from "../message/Sender";
import { ModelRegistry } from "../DatabaseManager";
import { UserInfoSchemaType } from "../odm/UserInfo";
import { GroupInfoSchemaType } from "../odm/GroupInfo";
import { RobotStorage } from "./RobotStorage";
import { GroupUserInfoSchemaType } from "../odm/GroupUserInfo";
import { RootGroupInfoSchemaType } from "../odm/RootGroupInfo";

export class GroupUserInfoStorage {
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

        this.cache = app.cache.getStore(['ObjectCache', storages.robotId, 'group_user_info']);
    }

    public async initialize() {
        this.models = this.storages.models;
    }

    private makeKey(userId: string, groupId: string, rootGroupId?: string): string {
        if (rootGroupId) {
            return this.cache.makeKey([userId, rootGroupId, groupId]);
        } else {
            return this.cache.makeKey([userId, groupId]);
        }
    }

    public async get(userId: string, groupId: string, rootGroupId?: string, fetchFromBot: boolean = false): Promise<GroupUserInfoSchemaType | null> {
        // from cache
        let groupUserInfo = await this.cache.get<GroupUserInfoSchemaType>(this.makeKey(userId, groupId, rootGroupId));
        if (groupUserInfo) {
            return groupUserInfo;
        }

        if (fetchFromBot) {
            // from bot
            return await this.fetchFromRobot(userId, groupId);
        } else if (this.models) { // from database
            let doc = await this.models.groupUserInfo.findOne({
                userId,
                groupId,
                rootGroupId,
            });

            if (doc) {
                groupUserInfo = doc.toObject();

                await this.cache.set(this.makeKey(userId, groupId, rootGroupId), groupUserInfo, this.cacheTTL);
                return groupUserInfo;
            }
        } else {
            this.app.logger.warn('未配置 Database');
        }

        return null;
    }

    public async fetchFromRobot(userId: string, groupId: string, rootGroupId?: string): Promise<GroupUserInfoSchemaType | null> {
        const robot = this.app.robot.getRobot(this.storages.robotId);
        if (robot) {
            const groupUserInfoList = await robot.getGroupUsersInfo?.([userId], groupId);
            if (groupUserInfoList && groupUserInfoList.length > 0) {
                const groupUserInfo = groupUserInfoList[0];
                if (groupUserInfo) {
                    return await this.set(groupUserInfo, userId, groupId, rootGroupId);
                }
            }
        } else {
            this.app.logger.error(`无法找到机器人配置：${this.storages.robotId}`);
        }
        return null;
    }

    public async set(groupUserInfo: GroupUserInfoType, userInfo: string | UserInfoSchemaType,
            groupInfo: string | GroupInfoSchemaType, rootGroupInfo?: string | RootGroupInfoSchemaType): Promise<GroupUserInfoSchemaType> {
        let data: GroupUserInfoSchemaType = {
            ...groupUserInfo,
            userId: typeof userInfo === 'string' ? userInfo : userInfo.userId,
            groupId: typeof groupInfo === 'string' ? groupInfo : groupInfo.groupId,
            rootGroupId: typeof rootGroupInfo === 'string' ? rootGroupInfo : rootGroupInfo?.rootGroupId,
        };

        // 保存到数据库
        if (this.models) {
            await this.models.groupUserInfo.updateOne({
                userId: data.userId,
                groupId: data.groupId,
            }, data, {
                upsert: true,
                setDefaultsOnInsert: true,
            });
        }

        await this.cache.set(this.makeKey(data.userId, data.groupId, data.rootGroupId), data, this.cacheTTL);

        return data;
    }

    public async remove(userId: string, groupId: string): Promise<void> {
        if (this.models) {
            await this.models.groupUserInfo.deleteOne({
                userId,
                groupId,
            });
        }

        await this.cache.del(this.makeKey(userId, groupId));
    }
}