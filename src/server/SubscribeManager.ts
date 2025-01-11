import fs from "fs";
import Yaml from "yaml";
import chokidar from 'chokidar';

import App from "./App";
import { ReactiveConfig } from "./utils/ReactiveConfig";
import { stripObject } from "./utils";

export type SubscribeItem = {
    id: string,
    scope?: string,
    enabled?: boolean,
    params?: Record<string, any>,
    allowed_roles?: string[],
};

export type MappedSubscribeItem = {
    id: string,
    scope: string,
    enabled: boolean,
    params: Record<string, any>,
    allowed_roles?: string[],
};


export type SubscribeTargetInfo = {
    global?: boolean,
    robot?: string,
    user?: boolean,
    channel?: string,
    group?: string,
    rootGroup?: string,
    comment?: string,
}

export type SubscribeTargetConfig = SubscribeTargetInfo & {
    plugins: SubscribeItem[],
};

export type MappedSubscribeTargetConfig = SubscribeTargetInfo & {
    plugins: MappedSubscribeItem[],
};

export type GlobalSubscribeConfig = SubscribeItem[];

export type SubscribeConfig = {
    global?: {
        plugins: SubscribeItem[],
    }
} & Record<string, SubscribeTargetConfig[]>;

/**
 * 订阅管理
 */
export class SubscribeManager {
    private app: App;

    private subscribeFile: string;
    private subConfig!: ReactiveConfig<SubscribeConfig>;

    private fileWillChange: boolean = false;

    /** 订阅目标 -> 订阅项目查找表 */
    private targetSubMap: Record<string, MappedSubscribeItem[]>;
    /** 订阅项目 -> 订阅目标查找表 */
    private subTargetMap: Record<string, MappedSubscribeTargetConfig>;

    /** 订阅目标 -> 包含所有继承订阅项目的查找表 */
    private retrievedTargetSubMap: Record<string, MappedSubscribeItem[]>;

    constructor(app: App, subscribeFile: string) {
        this.app = app;
        this.subscribeFile = subscribeFile;
        this.targetSubMap = {};
        this.retrievedTargetSubMap = {};
        this.subTargetMap = {};
    }

    public async initialize() {
        this.subConfig = new ReactiveConfig<SubscribeConfig>(this.subscribeFile, {});
        
        await this.subConfig.load();
        this.buildSubscribeMap(this.subConfig.value);
        
        this.subConfig.on('change', (val, oldVal) => {
            if (!this.fileWillChange) {
                this.reloadSubscribeFile(val, oldVal);
            } else {
                this.fileWillChange = false;
            }
        });
    }

    public stripSubscribeItem(subItem: SubscribeItem): SubscribeItem {
        let newSubItem: SubscribeItem = {
            ...subItem,
        };

        if (newSubItem.scope === '*') {
            delete newSubItem.scope;
        }

        if (newSubItem.enabled === true) {
            delete newSubItem.enabled;
        }

        if (newSubItem.params && Object.keys(newSubItem.params).length === 0) {
            delete newSubItem.params;
        }

        return newSubItem;
    }

    /**
     * 构建订阅表
     */
    private buildSubscribeMap(subscribeMap: SubscribeConfig) {
        if (subscribeMap) {
            for (let robotId in subscribeMap) {
                if (robotId === 'global') {
                    // 添加全局订阅
                    const globalItems: SubscribeItem[] = subscribeMap.global!.plugins;
                    globalItems.forEach((item) => {
                        this.addSubscribe({ global: true }, item, false);
                    });
                } else {
                    const targetConfigList = subscribeMap[robotId] as SubscribeTargetConfig[];
                    for (let targetConfig of targetConfigList) {
                        // 添加单个目标的订阅
                        const targetIdentity = {
                            robot: robotId,
                            user: targetConfig.user,
                            channel: targetConfig.channel,
                            group: targetConfig.group,
                            rootGroup: targetConfig.rootGroup,
                        };

                        if (!Array.isArray(targetConfig?.plugins)) {
                            this.app.logger.error(`机器人${robotId}的订阅配置错误，缺少 "plugins"`);
                            continue;
                        }

                        targetConfig.plugins.forEach((item) => {
                            this.addSubscribe(targetIdentity, item, false);
                        });
                    }
                }
            }
        }
    }

    /**
     * 保存订阅文件
     */
    private saveSubscribeFile() {
        let res: any = {};
        for (let targetKey in this.subTargetMap) {
            let target = this.subTargetMap[targetKey];
            if (target.global) {
                if (!res.global) {
                    res.global = {
                        plugins: [],
                    };
                }

                res.global.plugins = target.plugins.map((item) => this.stripSubscribeItem(item));
            } else if (target.robot) {
                if (!res[target.robot]) {
                    res[target.robot] = [];
                }

                let cfgTarget: SubscribeTargetConfig = {
                    ...target,
                    plugins: target.plugins.map((item) => this.stripSubscribeItem(item)),
                };

                delete cfgTarget.global;
                delete cfgTarget.robot;

                res[target.robot].push(stripObject(cfgTarget));
            }
        }

        this.fileWillChange = true;
        fs.writeFileSync(this.subscribeFile, Yaml.stringify(res), { encoding: 'utf-8' });
    }

    /**
     * 重载订阅文件
     */
    private reloadSubscribeFile(val: SubscribeConfig, oldVal: SubscribeConfig) {
        // 先不比较了，直接全部清除
        this.subTargetMap = {};
        this.retrievedTargetSubMap = {};
        this.targetSubMap = {};

        this.buildSubscribeMap(val);

        this.app.logger.info('已重载Subscribe');
    }

    /**
     * 生成订阅目标的字符串key
     * @param robotId 
     * @param targetInfo 
     * @returns 
     */
    public makeTargetKey(targetInfo: SubscribeTargetInfo): string {
        if (!targetInfo.robot) {
            throw new Error('生成订阅目标的字符串key时机器人ID不能为空');
        }

        const robotId = targetInfo.robot;
        if (targetInfo.user) {
            return `${robotId}:user`;
        } else if (targetInfo.channel) {
            return `${robotId}:channel:${targetInfo.channel}`;
        } else {
            if (targetInfo.rootGroup && targetInfo.group) {
                return `${robotId}:group:${targetInfo.rootGroup}/${targetInfo.group}`;
            } else if (targetInfo.group) {
                return `${robotId}:group:${targetInfo.group}`;
            } else {
                return robotId;
            }
        }
    }

    /**
     * 生成订阅项的字符串key
     * @param subItem 
     * @returns 
     */
    public makeSubItemKey(subItem: SubscribeItem): string {
        return `${subItem.id}:${subItem.scope ?? '*'}`;
    }

    /**
     * 初始化订阅目标项目信息
     * @param targetIdentity 
     */
    public prepareSubTarget(targetIdentity: SubscribeTargetInfo) {
        if (targetIdentity.global) {
            if (!this.subTargetMap['global']) {
                this.subTargetMap['global'] = {
                    global: true,
                    plugins: [],
                };
            }
        } else if (targetIdentity.robot) {
            let targetKey = this.makeTargetKey(targetIdentity);
            if (!this.subTargetMap[targetKey]) {
                this.subTargetMap[targetKey] = {
                    ...targetIdentity,
                    plugins: [],
                };
            }
        }
    }

    /**
     * 添加订阅项
     * @param targetIdentity 订阅目标
     * @param subscribeItem 订阅项
     * @param save 是否保存到文件
     */
    public addSubscribe(targetIdentity: SubscribeTargetInfo, subscribeItem: SubscribeItem, save: boolean = true) {
        if (!targetIdentity.global && !targetIdentity.robot) {
            console.log(targetIdentity);
            throw new Error('添加订阅时机器人ID不能为空');
        }

        let newSubscribeItem: MappedSubscribeItem = {
            ...subscribeItem,
            scope: subscribeItem.scope ?? '*',
            enabled: subscribeItem.enabled ?? true,
            params: subscribeItem.params ?? {},
        }

        // 添加订阅到target-sub查找表
        this.prepareSubTarget(targetIdentity);
        let targetKey = targetIdentity.global ? 'global' : this.makeTargetKey(targetIdentity);
        let targetToSub = this.subTargetMap[targetKey];
        if (targetToSub) {
            let oldId = targetToSub.plugins.findIndex((item) => item.id === newSubscribeItem.id && item.scope === newSubscribeItem.scope);
            if (oldId >= 0) {
                targetToSub.plugins[oldId] = newSubscribeItem;
            } else {
                targetToSub.plugins.push(newSubscribeItem);
            }
        }

        // 添加订阅到sub-target查找表
        let subItemKey = this.makeSubItemKey(newSubscribeItem);
        if (!this.targetSubMap[subItemKey]) {
            this.targetSubMap[subItemKey] = [];
        }
        let oldId = this.targetSubMap[subItemKey].findIndex((item) =>
            item.id === newSubscribeItem.id && item.scope === newSubscribeItem.scope);
        if (oldId >= 0) {
            this.targetSubMap[subItemKey][oldId] = newSubscribeItem;
        } else {
            this.targetSubMap[subItemKey].push(newSubscribeItem);
        }

        // 删除完整订阅表缓存
        if (!targetIdentity.global && targetKey in this.retrievedTargetSubMap) {
            delete this.retrievedTargetSubMap[targetKey];
        }

        if (save) {
            this.saveSubscribeFile();
        }
    }

    /**
     * 更新订阅项配置
     * @param targetIdentity 订阅目标
     * @param subscribeItem 订阅项
     * @param save 是否保存到文件
     */
    public updateSubscribe(targetIdentity: SubscribeTargetInfo, subscribeItem: SubscribeItem, save: boolean = true) {
        this.addSubscribe(targetIdentity, subscribeItem, save);
    }

    /**
     * 移除订阅
     */
    public removeSubscribe(targetIdentity: SubscribeTargetInfo, subscribeItem: SubscribeItem, save: boolean = true) {
        if (!targetIdentity.robot) {
            throw new Error('移除订阅时机器人ID不能为空');
        }

        let subItemKey = this.makeSubItemKey(subscribeItem);

        // 移除订阅到target-sub查找表
        this.prepareSubTarget(targetIdentity);
        if (targetIdentity.global) {
            let targetSub = this.subTargetMap['global'];
            if (targetSub) {
                targetSub.plugins = targetSub.plugins.filter((item) =>
                    item.id !== subscribeItem.id || item.scope !== subscribeItem.scope);
            }

            // 移除所有订阅表缓存
            this.retrievedTargetSubMap = {};
        } else {
            let targetKey = this.makeTargetKey(targetIdentity);
            let targetSub = this.subTargetMap[targetKey];
            if (targetSub) {
                targetSub.plugins = targetSub.plugins.filter((item) =>
                    item.id !== subscribeItem.id || item.scope !== subscribeItem.scope);
            }

            // 删除订阅表缓存
            if (targetKey in this.retrievedTargetSubMap) {
                delete this.retrievedTargetSubMap[targetKey];
            }
        }

        // 移除订阅到sub-target查找表
        if (this.targetSubMap[subItemKey]) {
            this.targetSubMap[subItemKey] = this.targetSubMap[subItemKey].filter((item) =>
                item.id !== subscribeItem.id || item.scope !== subscribeItem.scope);
        }

        if (save) {
            this.saveSubscribeFile();
        }
    }

    /**
     * 获取订阅者
     * @param pluginId 插件ID
     * @param scopeId 作用域ID
     * @param robotId 机器人ID
     * @returns 
     */
    // public getSubscriber(robotId: string, pluginId: string, scopeId: string): Target[] | null {
    //     let subscribers: Target[] = [];
    //     // 获取订阅
    //     if (this.subscribeList?.[sourceId]?.[robotId]) {
    //         subscribers.push(...this.subscribeList[sourceId][robotId]);
    //     }

    //     if (sourceId.startsWith('channel:') && sourceId.includes('/')) {
    //         // 获取父级（频道组）的订阅
    //         let channelGroupPath = sourceId.substring(0, sourceId.lastIndexOf('/'));
    //         if (this.subscribeList?.[channelGroupPath]?.[robotId]) {
    //             subscribers.push(...this.subscribeList[channelGroupPath][robotId]);
    //         }
    //     }
        
    //     if (subscribers.length > 0) {
    //         return subscribers;
    //     } else {
    //         return null;
    //     }
    // }

    public getSubscribeItems(targetInfo: SubscribeTargetInfo, ignoreDisabled: boolean = true): MappedSubscribeItem[] {
        if (!targetInfo.robot) {
            throw new Error('获取订阅项时机器人ID不能为空');
        }

        const targetKey = this.makeTargetKey(targetInfo);
        const robotId = targetInfo.robot;
        
        let subItems: MappedSubscribeItem[] = [];
        if (!this.retrievedTargetSubMap[targetKey]) {
            let itemKeys: string[] = [];
            for (let key of [targetKey, robotId, 'global']) { // 同时添加上级订阅
                if (this.subTargetMap[key]) {
                    let plugins = this.subTargetMap[key].plugins;
                    for (let subItem of plugins) {
                        let subItemKey = this.makeSubItemKey(subItem);
                        if (!itemKeys.includes(subItemKey)) {
                            itemKeys.push(subItemKey);
                            subItems.push(subItem);
                        }
                    }
                }
            }
        } else {
            subItems = this.retrievedTargetSubMap[targetKey];
        }

        if (ignoreDisabled) {
            subItems = subItems.filter((item) => item.enabled);
        }

        return subItems;
    }
}
