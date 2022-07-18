import fs from "fs";
import Yaml from "yaml";
import chokidar from 'chokidar';

import App from "./App";

export interface Target {
    type: string;
    identity: string;
}

/**
 * 订阅管理
 * @todo 取消通配符支持，仅支持订阅单频道和频道组下的单层频道
 */
export class SubscribeManager {
    private app: App;
    private subscribeFile: string;
    private watcher!: chokidar.FSWatcher;
    private subscribeList: {
        [channelId: string]: {
            [robotId: string]: Target[]
        }
    };

    private subscribeConfig: {
        [robotId: string]: {
            [targetType: string]: {
                [targetIdentity: string]: string[]
            }
        }
    };

    constructor(app: App, subscribeFile: string) {
        this.app = app;
        this.subscribeFile = subscribeFile;
        this.subscribeList = {};
        this.subscribeConfig = {};

        this.loadSubscribeFile();
        this.rebuildTree();
    }

    public async initialize() {
        this.watcher = chokidar.watch(this.subscribeFile, {
            ignorePermissionErrors: true,
            persistent: true
        });
        
        this.watcher.on('change', () => {
            this.reloadSubscribeFile();
        });
    }

    private loadSubscribeFile() {
        this.subscribeConfig = Yaml.parse(fs.readFileSync(this.subscribeFile, { encoding: 'utf-8' }));
    }

    /**
     * 重载订阅文件
     */
    private reloadSubscribeFile() {
        this.loadSubscribeFile();
        this.subscribeList = {};
        this.rebuildTree();
        console.log('已重载Subscribe');
    }

    /**
     * 重载订阅树
     */
    public rebuildTree() {
        for (let robotId in this.subscribeConfig) {
            let targetConf = this.subscribeConfig[robotId];
            for (let targetType in targetConf) {
                let targetTypeConf = targetConf[targetType];
                for (let targetId in targetTypeConf) {
                    let subscribeList = targetTypeConf[targetId];
                    for (let channelId of subscribeList) {
                        this.addSubscribe(robotId, targetType, targetId, channelId);
                    }
                }
            }
        }
    }

    /**
     * 初始化订阅树
     * @param robotId 
     * @param channelId 
     */
    public prepareTree(robotId: string, channelId: string) {
        if (!(channelId in this.subscribeList)) {
            this.subscribeList[channelId] = {};
        }

        if (!(robotId in this.subscribeList[channelId])) {
            this.subscribeList[channelId][robotId] = [];
        }
    }

    /**
     * 添加订阅
     * @param robotId 机器人ID
     * @param targetType 目标类型
     * @param targetId 目标ID
     * @param channelId 频道ID
     */
    public addSubscribe(robotId: string, targetType: string, targetId: string, channelId: string) {
        this.prepareTree(robotId, channelId);
        this.subscribeList[channelId][robotId].push({
            type: targetType,
            identity: targetId
        });
    }

    /**
     * 移除订阅
     * @param robotId 机器人ID
     * @param targetType 目标类型
     * @param targetId 目标ID
     * @param channelId 频道ID
     */
    public removeSubscribe(robotId: string, targetType: string, targetId: string, channelId: string) {
        if (this.subscribeList?.[channelId]?.[robotId]) {
            this.subscribeList[channelId][robotId] = this.subscribeList[channelId][robotId].filter((target) => {
                return (target.type !== targetType || targetId != targetId);
            });
        }
    }

    /**
     * 添加频道并更新订阅列表
     * @param channelId 频道ID
     */
    public addChannel(channelId: string) {
        
    }
    
    /**
     * 移除频道并更新订阅列表
     * @param channelId 频道ID
     */
    public removeChannel(channelId: string) {
        
    }

    /**
     * 获取频道订阅者
     * @param channelId 频道ID
     * @param robotId 机器人ID
     * @returns 
     */
    public getSubscriber(channelId: string, robotId: string): Target[] | null {
        let subscribers: Target[] = [];
        // 先获取频道本身的订阅
        if (this.subscribeList?.[channelId]?.[robotId]) {
            subscribers.push(...this.subscribeList[channelId][robotId]);
        }
        // 获取父级（频道组）的订阅
        if (channelId.includes('/')) {
            let channelGroupPath = channelId.substring(0, channelId.lastIndexOf('/'));
            if (this.subscribeList?.[channelGroupPath]?.[robotId]) {
                subscribers.push(...this.subscribeList[channelGroupPath][robotId]);
            }
        }
        
        if (subscribers.length > 0) {
            return subscribers;
        } else {
            return null;
        }
    }
}
