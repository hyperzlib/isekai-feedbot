import * as path from "path";

import App from "./App";
import { CacheStore } from "./CacheManager";
import { ReactiveConfig } from "./utils/ReactiveConfig";
import { ChatIdentity } from "./message/Sender";
import { chatIdentityToCacheKey } from "./utils";

export type GroupConfig = {
    name: string,
    bindBotRoles?: string[],
    inherit?: string[],
    rules?: Record<string, boolean>
};

export type GroupsConfig = Record<string, GroupConfig>;
export type UserGroupsConfig = {
    [robotId: string]: Record<string, string[]>,
};

export class RoleManager {
    private app: App;
    private cache: CacheStore;

    private rulesList: string[] = [];
    private rulesIdMap: Record<string, number> = {};

    private baseGroupRules: Record<string, number[]> = {};
    private groupRules: Record<string, number[]> = {};
    private groupsConfig!: ReactiveConfig<GroupsConfig>;
    private userGroupsConfig!: ReactiveConfig<UserGroupsConfig>;

    constructor(app: App) {
        this.app = app;

        this.cache = this.app.cache.getInternalStore(['sys', 'roles'], false);
    }

    public async initialize() {
        // 加载配置文件
        this.groupsConfig = new ReactiveConfig<GroupsConfig>(path.join(this.app.config.role_config_path, "groups.yaml"), {});
        this.userGroupsConfig = new ReactiveConfig<UserGroupsConfig>(path.join(this.app.config.role_config_path, "user_groups.yaml"), {});

        await this.groupsConfig.load();
        await this.userGroupsConfig.load();

        this.groupsConfig.on('change', () => {
            this.cache.reset();
            this.makeGroupRulesMap();
        });

        this.userGroupsConfig.on('change', () => {
            this.cache.reset();
        });
    }

    /**
     * 添加规则
     * @param rule 规则标识符 
     * @param defaultGroup 默认分配的分组
     */
    public addRule(rule: string, defaultGroup?: string) {
        // 添加到映射表
        let ruleId: number = -1;
        if (!this.rulesIdMap[rule]) {
            ruleId = this.rulesList.push(rule) - 1;
            this.rulesIdMap[rule] = ruleId;
        } else {
            ruleId = this.rulesIdMap[rule];
        }

        // 添加到默认规则
        if (defaultGroup === undefined) {
            if (rule.endsWith('/admin')) { // 将admin scope的默认分组设置为群管理
                defaultGroup = 'groupAdmin';
            } else if (rule.endsWith('/manage')) { // 将manage scope的默认分组设置为机器人管理
                defaultGroup = 'botAdmin';
            } else { // 其他默认分组为user
                defaultGroup = 'user';
            }
        }

        // defaultGroup为null时不分配默认分组
        if (defaultGroup) {
            this.baseGroupRules[defaultGroup] ??= [];
            this.baseGroupRules[defaultGroup].push(ruleId);
        }
    }

    /**
     * 删除规则
     * @param rule 规则标识符
     */
    public removeRule(rule: string) {
        let ruleId = this.rulesIdMap[rule];
        if (ruleId !== undefined) {
            // 不删除规则，只是将规则对应的分组置空，防止ruleId变化
            this.rulesList[ruleId] = '';
            delete this.rulesIdMap[rule];
        }
    }

    /**
     * 清理规则
     */
    public purgeRules() {
        this.rulesList = this.rulesList.filter(rule => rule !== '');
        this.rulesIdMap = {};
        this.rulesList.forEach((rule, index) => {
            this.rulesIdMap[rule] = index;
        });
    }

    /**
     * 构建单个群组的权限规则列表
     * @param groupName 
     * @param inheritStack 
     * @returns 
     */
    private getOneGroupRules(groupName: string, inheritStack: string[] = []): number[] {
        if (groupName in this.groupRules) {
            return this.groupRules[groupName];
        }

        if (inheritStack.includes(groupName)) { // 检查是否有循环继承
            throw new Error(`Group ${groupName} has circular inherit!`);
        }

        let baseRules = this.baseGroupRules[groupName] ?? [];

        /** 另外添加的权限，包含继承的权限 */
        let appendRules: number[] = [];

        /** 移除的权限，包含继承的权限 */
        let stripRules: number[] = [];

        if (!(groupName in this.groupsConfig.value)) {
            throw new Error(`Group ${groupName} not found in groups config!`);
        }

        let groupConfig = this.groupsConfig.value[groupName];

        if (groupConfig.inherit && groupConfig.inherit.length > 0) {
            let newInheritStack = [...inheritStack, groupName];
            for (let inheritGroup of groupConfig.inherit) { // 将继承的权限添加到appendRules
                let inheritRules = this.getOneGroupRules(inheritGroup, newInheritStack);
                appendRules.push(...inheritRules);
            }
        }

        if (groupConfig.rules) {
            for (let rule in groupConfig.rules) {
                if (groupConfig.rules[rule]) {
                    appendRules.push(this.rulesIdMap[rule]);
                } else {
                    stripRules.push(this.rulesIdMap[rule]);
                }
            }
        }

        let groupRules = [...baseRules];

        // 添加新增的权限
        for (let rule of appendRules) {
            if (!groupRules.includes(rule)) {
                groupRules.push(rule);
            }
        }

        // 移除权限
        groupRules = groupRules.filter(rule => !stripRules.includes(rule));

        this.groupRules[groupName] = groupRules;

        return groupRules;
    }

    /**
     * 创建最终的分组规则
     * 根据群组配置文件生成每个分组的权限规则
     */
    public makeGroupRulesMap() {
        // 清除缓存
        this.groupRules = {};
        this.purgeRules();

        for (let groupName in this.groupsConfig.value) {
            if (!(groupName in this.groupRules)) {
                this.getOneGroupRules(groupName);
            }
        }
    }

    /**
     * 将用户的分组转换为权限规则标识
     * @param ruleIds 
     * @returns 
     */
    public ruleIdsToString(ruleIds: number[]): string[] {
        return ruleIds.map(id => this.rulesList[id]);
    }

    /**
     * 获取用户所属的用户组
     * @param chatIdentity 
     * @returns 
     */
    public async getUserGroups(chatIdentity: ChatIdentity): Promise<string[]> {
        const cacheKey = `userGroups:${chatIdentityToCacheKey(chatIdentity)}`;
        return this.cache.wrap(cacheKey, async () => {
            const userGroups: string[] = ['user'];
            const robotId = chatIdentity.robot.robotId;
            const userId = chatIdentity.userId!;
            const rootGroupId = chatIdentity.rootGroupId;
            const groupId = chatIdentity.groupId;

            // 优化：如果当前机器人没有任何配置，直接返回默认的user分组
            if (!(robotId in this.userGroupsConfig.value)) {
                return userGroups;
            }

            const keys: string[] = [
                userId,
            ];

            if (chatIdentity.rootGroupId) {
                keys.push(`${userId}@${rootGroupId}:*`);
                if (chatIdentity.groupId) {
                    keys.push(`${userId}@${rootGroupId}:${groupId}`);
                }
            } else if (chatIdentity.groupId) {
                keys.push(`${userId}@${groupId}`);
            }

            const currentBotGroupsConfig = this.userGroupsConfig.value[robotId];

            for (const key of keys) {
                if (key in currentBotGroupsConfig) {
                    userGroups.push(...currentBotGroupsConfig[key]);
                }
            }

            return [...new Set(userGroups)];
        });
    }

    /**
     * 获取用户所有的权限
     * @param chatIdentity 
     * @returns 
     */
    public async getUserRules(chatIdentity: ChatIdentity): Promise<number[]> {
        return this.cache.wrap(`userRules:${chatIdentityToCacheKey(chatIdentity)}`, async () => {
            let userGroups = await this.getUserGroups(chatIdentity);
            let userRules: number[] = [];
            for (let group of userGroups) {
                let groupRules = this.getOneGroupRules(group);
                userRules.push(...groupRules);
            }

            // 去重
            userRules = [...new Set(userRules)];
    
            return userRules;
        });
    }

    /**
     * 检测用户是否拥有指定权限
     * @param chatIdentity 
     * @param rules 
     * @returns 
     */
    public async userCan(chatIdentity: ChatIdentity, ...rules: string[]): Promise<boolean> {
        let userRules = await this.getUserRules(chatIdentity);
        let ruleIds = rules.map(rule => this.rulesIdMap[rule]);

        for (let ruleId of ruleIds) {
            if (!userRules.includes(ruleId)) {
                return false;
            }
        }

        return true;
    }

    /**
     * 检测用户是否拥有指定权限中的任意一个
     * @param chatIdentity 
     * @param rules 
     * @returns 
     */
    public async userCanAny(chatIdentity: ChatIdentity, ...rules: string[]): Promise<boolean> {
        let userRules = await this.getUserRules(chatIdentity);
        let ruleIds = rules.map(rule => this.rulesIdMap[rule]);

        for (let ruleId of ruleIds) {
            if (userRules.includes(ruleId)) {
                return true;
            }
        }

        return false;
    }

    public async userJoinGroup(chatIdentity: ChatIdentity, group: string) {

    }

    public async userLeaveGroup(chatIdentity: ChatIdentity, group: string) {

    }

    public async userResetGroups(chatIdentity: ChatIdentity) {

    }
}