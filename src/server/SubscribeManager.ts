import fs from "fs";
import Yaml from "yaml";
import chokidar from 'chokidar';

import App from "./App";

export type SubscribeItem = {
    id: string,
    scope?: string,
    enable?: boolean,
    params?: Record<string, any>,
    allowed_roles?: string[],
};

export type SubscribeTargetInfo = {
    global?: boolean,
    robot?: string,
    user?: boolean,
    channel?: string,
    group?: string,
    rootGroup?: string,
}

export type SubscribeTargetConfig = SubscribeTargetInfo & {
    plugins: SubscribeItem[],
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
    private watcher!: chokidar.FSWatcher;

    private fileWillChange: boolean = false;

    private targetSubMap: Record<string, SubscribeItem[]>;
    private allTargetSubMap: Record<string, SubscribeItem[]>;
    private subTargetMap: Record<string, SubscribeTargetConfig>;

    constructor(app: App, subscribeFile: string) {
        this.app = app;
        this.subscribeFile = subscribeFile;
        this.targetSubMap = {};
        this.allTargetSubMap = {};
        this.subTargetMap = {};

        this.loadSubscribeFile();
    }

    public async initialize() {
        this.watcher = chokidar.watch(this.subscribeFile, {
            ignorePermissionErrors: true,
            persistent: true
        });
        
        this.watcher.on('change', () => {
            if (!this.fileWillChange) {
                this.reloadSubscribeFile();
            } else {
                this.fileWillChange = false;
            }
        });
    }

    /**
     * 加载订阅文件
     */
    private loadSubscribeFile() {
        let subscribeMap: SubscribeConfig = Yaml.parse(fs.readFileSync(this.subscribeFile, { encoding: 'utf-8' }));
        if (subscribeMap) {
            for (let robotId in subscribeMap) {
                if (robotId === 'global') {
                    const globalItems: SubscribeItem[] = subscribeMap.global!.plugins;
                    globalItems.forEach((item) => {
                        this.addSubscribe({ global: true }, item, false);
                    });
                } else {
                    const targetConfigList = subscribeMap[robotId] as SubscribeTargetConfig[];
                    for (let targetConfig of targetConfigList) {
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
                res.global.plugins.push(...target.plugins);
            } else if (target.robot) {
                if (!res[target.robot]) {
                    res[target.robot] = {
                        user: target.user,
                        channel: target.channel,
                        group: target.group,
                        rootGroup: target.rootGroup,
                        plugins: [],
                    };
                }
                res[target.robot].plugins.push(...target.plugins);
            }
        }

        this.fileWillChange = true;
        fs.writeFileSync(this.subscribeFile, Yaml.stringify(res), { encoding: 'utf-8' });
    }

    /**
     * 重载订阅文件
     */
    private reloadSubscribeFile() {
        // 先不比较了，直接全部清除
        this.subTargetMap = {};
        this.allTargetSubMap = {};
        this.targetSubMap = {};

        this.loadSubscribeFile();

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

        if (!subscribeItem.scope) subscribeItem.scope = '*';
        if (!subscribeItem.enable) subscribeItem.enable = true;
        if (!subscribeItem.params) subscribeItem.params = {};

        // 添加订阅到target-sub查找表
        this.prepareSubTarget(targetIdentity);
        let targetKey = targetIdentity.global ? 'global' : this.makeTargetKey(targetIdentity);
        let targetSub = this.subTargetMap[targetKey];
        if (targetSub) {
            let oldId = targetSub.plugins.findIndex((item) => item.id === subscribeItem.id && item.scope === subscribeItem.scope);
            if (oldId >= 0) {
                targetSub.plugins[oldId] = subscribeItem;
            } else {
                targetSub.plugins.push(subscribeItem);
            }
        }

        // 添加订阅到sub-target查找表
        let subItemKey = this.makeSubItemKey(subscribeItem);
        if (!this.targetSubMap[subItemKey]) {
            this.targetSubMap[subItemKey] = [];
        }
        let oldId = this.targetSubMap[subItemKey].findIndex((item) =>
            item.id === subscribeItem.id && item.scope === subscribeItem.scope);
        if (oldId >= 0) {
            this.targetSubMap[subItemKey][oldId] = subscribeItem;
        } else {
            this.targetSubMap[subItemKey].push(subscribeItem);
        }

        // 删除完整订阅表缓存
        if (!targetIdentity.global && targetKey in this.allTargetSubMap) {
            delete this.allTargetSubMap[targetKey];
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
            this.allTargetSubMap = {};
        } else {
            let targetKey = this.makeTargetKey(targetIdentity);
            let targetSub = this.subTargetMap[targetKey];
            if (targetSub) {
                targetSub.plugins = targetSub.plugins.filter((item) =>
                    item.id !== subscribeItem.id || item.scope !== subscribeItem.scope);
            }

            // 删除订阅表缓存
            if (targetKey in this.allTargetSubMap) {
                delete this.allTargetSubMap[targetKey];
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

    public getSubscribeItems(targetInfo: SubscribeTargetInfo): SubscribeItem[] {
        if (!targetInfo.robot) {
            throw new Error('获取订阅项时机器人ID不能为空');
        }

        const targetKey = this.makeTargetKey(targetInfo);
        const robotId = targetInfo.robot;
        
        let subItems: SubscribeItem[] = [];
        if (!this.allTargetSubMap[targetKey]) {
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
            subItems = this.allTargetSubMap[targetKey];
        }

        return subItems;
    }
}
