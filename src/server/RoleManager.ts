import * as path from "path";
import Yaml from "yaml";

import App from "./App";
import { CacheStore } from "./CacheManager";
import { ReactiveConfig } from "./utils/ReactiveConfig";
import { ChatIdentity } from "./message/Sender";
import { chatIdentityToCacheKey } from "./utils";
import { writeFile } from "fs/promises";

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

const CACHE_EXPIRE = 86400;

export class RoleManager {
    private app: App;
    private cache: CacheStore;
    
    private botRoleMap: Record<string, string> = {};
    private baseGroupRules: Record<string, string[]> = {};
    private groupRules: Record<string, string[]> = {};
    private groupsConfig!: ReactiveConfig<GroupsConfig>;
    private userGroupsConfig!: ReactiveConfig<UserGroupsConfig>;

    constructor(app: App) {
        this.app = app;

        this.cache = this.app.cache.getStore(['sys', 'roles']);
    }

    public async initialize() {
        // 加载配置文件
        this.groupsConfig = new ReactiveConfig<GroupsConfig>(path.join(this.app.config.role_config_path, "groups.yaml"), {});
        this.userGroupsConfig = new ReactiveConfig<UserGroupsConfig>(path.join(this.app.config.role_config_path, "user_groups.yaml"), {});

        await this.cache.reset();

        await this.groupsConfig.load();
        await this.userGroupsConfig.load();

        this.groupsConfig.on('change', () => {
            this.cache.reset();
            this.makeGroupRulesMap();
            this.app.logger.info('已重新加载用户组信息');
        });

        this.userGroupsConfig.on('change', () => {
            this.cache.reset();
            this.app.logger.info('已重新加载用户对应用户组配置');
        });

        this.userGroupsConfig.on('saved', () => {
            this.app.logger.info('已保存用户对应用户组配置');
        });

        this.app.logger.info('已加载用户组信息');

        this.app.logger.info('权限框架初始化成功');
    }

    /**
     * 添加默认规则（根据插件 scopes 生成）
     * @param rule 规则标识符 
     * @param defaultGroup 默认分配的分组
     */
    public addBaseRule(rule: string, defaultGroup?: string) {
        // 添加到默认规则
        if (defaultGroup === undefined) {
            if (rule.endsWith('/admin')) { // 将admin scope的默认分组设置为群管理
                defaultGroup = 'group_admin';
            } else if (rule.endsWith('/manage')) { // 将manage scope的默认分组设置为机器人管理
                defaultGroup = 'bot_admin';
            } else { // 其他默认分组为user
                defaultGroup = 'user';
            }
        }

        // defaultGroup为null时不分配默认分组
        if (defaultGroup) {
            this.baseGroupRules[defaultGroup] ??= [];
            this.baseGroupRules[defaultGroup].push(rule);
        }
    }

    /**
     * 删除默认规则
     * @param rules 
     */
    public removeBaseRules(rules: string[]) {
        for (let rule of rules) {
            for (let groupName in this.baseGroupRules) {
                this.baseGroupRules[groupName] = this.baseGroupRules[groupName].filter(r => r !== rule);
            }
        }
    }

    public async saveBaseGroupRules() {
        const filePath = path.join(this.app.config.role_config_path, "all_rules.yaml");
        const content = Yaml.stringify(this.baseGroupRules);
        await writeFile(filePath, content);
        this.app.logger.info('已保存基础分组规则');
    }

    public async onPluginLoaded() {
        await this.saveBaseGroupRules();
        this.makeGroupRulesMap();
    }

    /**
     * 构建单个群组的权限规则列表
     * @param groupName 
     * @param inheritStack 
     * @returns 
     */
    private getOneGroupRules(groupName: string, inheritStack: string[] = []): string[] {
        if (groupName in this.groupRules) {
            return this.groupRules[groupName];
        }

        if (inheritStack.includes(groupName)) { // 检查是否有循环继承
            throw new Error(`Group ${groupName} has circular inherit!`);
        }

        let baseRules = this.baseGroupRules[groupName] ?? [];

        /** 另外添加的权限，包含继承的权限 */
        let appendRules: string[] = [];

        /** 移除的权限，包含继承的权限 */
        let stripRules: string[] = [];

        if (!(groupName in this.groupsConfig.value)) {
            throw new Error(`Group ${groupName} not found in groups config!`);
        }

        let groupConfig = this.groupsConfig.value[groupName];

        if (groupConfig.bindBotRoles) {
            for (let role of groupConfig.bindBotRoles) {
                this.botRoleMap[role] = groupName;
            }
        }

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
                    appendRules.push(rule);
                } else {
                    stripRules.push(rule);
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
        this.botRoleMap = {};

        for (let groupName in this.groupsConfig.value) {
            if (!(groupName in this.groupRules)) {
                this.getOneGroupRules(groupName);
            }
        }
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

            if (chatIdentity.userRoles) { // 添加机器人角色对应的用户组
                for (let botRole of chatIdentity.userRoles) {
                    if (botRole in this.botRoleMap) {
                        userGroups.push(this.botRoleMap[botRole]);
                    }
                }
            }

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
        }, CACHE_EXPIRE);
    }

    /**
     * 获取用户所有的权限
     * @param chatIdentity 
     * @returns 
     */
    public async getUserRules(chatIdentity: ChatIdentity): Promise<string[]> {
        return this.cache.wrap(`userRules:${chatIdentityToCacheKey(chatIdentity)}`, async () => {
            let userGroups = await this.getUserGroups(chatIdentity);
            let userRules: string[] = [];
            for (let group of userGroups) {
                let groupRules = this.getOneGroupRules(group);
                userRules.push(...groupRules);
            }

            // 去重
            userRules = [...new Set(userRules)];
    
            return userRules;
        }, CACHE_EXPIRE);
    }

    /**
     * 检测用户是否拥有指定权限
     * @param chatIdentity 
     * @param rules 
     * @returns 
     */
    public async userCan(chatIdentity: ChatIdentity, ...rules: string[]): Promise<boolean> {
        let userRules = await this.getUserRules(chatIdentity);
        
        for (let rule of rules) {
            if (!userRules.includes(rule)) {
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
    public async userCanAny(chatIdentity: ChatIdentity, botRole: string | null = null, ...rules: string[]): Promise<boolean> {
        let userRules = await this.getUserRules(chatIdentity);

        for (let rule of rules) {
            if (userRules.includes(rule)) {
                return true;
            }
        }

        return false;
    }

    private chatIdentityToUserKey(chatIdentity: ChatIdentity) {
        if (chatIdentity.userId && chatIdentity.groupId && chatIdentity.rootGroupId) {
            return `${chatIdentity.userId}@${chatIdentity.rootGroupId}:${chatIdentity.groupId}`;
        } else if (chatIdentity.userId && chatIdentity.groupId) {
            return `${chatIdentity.userId}@${chatIdentity.groupId}`;
        } else if (chatIdentity.userId) {
            return chatIdentity.userId;
        }
    
        return '';
    }

    /**
     * 将用户添加到组
     * @param chatIdentity 
     * @param group 
     */
    public async userJoinGroup(chatIdentity: ChatIdentity, group: string) {
        let userKey = this.chatIdentityToUserKey(chatIdentity);
        if (!userKey) {
            throw new Error('Invalid chat identity');
        }

        let robotId = chatIdentity.robot.robotId;

        if (!(robotId in this.userGroupsConfig.value)) {
            this.userGroupsConfig.value[robotId] = {};
        }
        if (!(userKey in this.userGroupsConfig.value[robotId])) {
            this.userGroupsConfig.value[robotId][userKey] = [];
        }

        this.userGroupsConfig.value[robotId][userKey].push(group);
        
        this.userGroupsConfig.lazySave();
    }

    /**
     * 将用户从组中移除
     * @param chatIdentity 
     * @param group 
     */
    public async userLeaveGroup(chatIdentity: ChatIdentity, group: string) {
        let userKey = this.chatIdentityToUserKey(chatIdentity);
        if (!userKey) {
            throw new Error('Invalid chat identity');
        }

        let robotId = chatIdentity.robot.robotId;

        if (this.userGroupsConfig.value[robotId]?.[userKey]) {
            const botUserGroups = this.userGroupsConfig.value[robotId];
            botUserGroups[userKey] = botUserGroups[userKey].filter(g => g !== group);
        }

        if (this.userGroupsConfig.value[robotId][userKey].length === 0) {
            delete this.userGroupsConfig.value[robotId][userKey];
        }

        this.userGroupsConfig.lazySave();
    }

    /**
     * 清除用户的所有用户组
     * @param chatIdentity 
     */
    public async userResetGroups(chatIdentity: ChatIdentity) {
        let robotId = chatIdentity.robot.robotId;

        const botUserGroups = this.userGroupsConfig.value[robotId];
        if (botUserGroups) {
            for (let key in botUserGroups) {
                if (key === chatIdentity.userId || key.startsWith(`${chatIdentity.userId}@`)) {
                    delete botUserGroups[key];
                }
            }
        }

        this.userGroupsConfig.lazySave();
    }
}