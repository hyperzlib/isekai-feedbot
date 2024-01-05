import fs from "fs";
import Yaml from "yaml";
import chokidar from 'chokidar';

import App from "./App";

export interface Target {
    type: string;
    identity: string;
}

export type SubscribeConfig = {
    [robotId: string]: {
        [targetType: string]: {
            [targetIdentity: string]: {
                [sourceType: string]: string[]
            }
        }
    }
}

/**
 * 订阅管理
 */
export class SubscribeManager {
    private app: App;
    private subscribeFile: string;
    private watcher!: chokidar.FSWatcher;
    
    private subscribeList: {
        [sourceId: string]: {
            [robotId: string]: Target[]
        }
    };

    private subscribeConfig: SubscribeConfig;

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
        this.app.logger.info('已重载Subscribe');
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
                    for (let sourceType in subscribeList) {
                        let sourceList = subscribeList[sourceType];
                        for (let sourceId of sourceList) {
                            this.addSubscribe(robotId, targetType, targetId, sourceType + ':' + sourceId);
                        }
                    }
                }
            }
        }
    }

    /**
     * 初始化订阅树
     * @param robotId 
     * @param sourceId 
     */
    public prepareTree(robotId: string, sourceId: string) {
        if (!(sourceId in this.subscribeList)) {
            this.subscribeList[sourceId] = {};
        }

        if (!(robotId in this.subscribeList[sourceId])) {
            this.subscribeList[sourceId][robotId] = [];
        }
    }

    /**
     * 添加订阅
     * @param robotId 机器人ID
     * @param targetType 目标类型
     * @param targetId 目标ID
     * @param sourceId 订阅源ID
     */
    public addSubscribe(robotId: string, targetType: string, targetId: string, sourceId: string) {
        this.prepareTree(robotId, sourceId);
        this.subscribeList[sourceId][robotId].push({
            type: targetType,
            identity: targetId
        });
    }

    /**
     * 移除订阅
     * @param robotId 机器人ID
     * @param targetType 目标类型
     * @param targetId 目标ID
     * @param sourceId 订阅源ID
     */
    public removeSubscribe(robotId: string, targetType: string, targetId: string, sourceId: string) {
        if (this.subscribeList?.[sourceId]?.[robotId]) {
            this.subscribeList[sourceId][robotId] = this.subscribeList[sourceId][robotId].filter((target) => {
                return (target.type !== targetType || targetId != targetId);
            });
        }
    }

    /**
     * 获取订阅者
     * @param sourceId 订阅源ID
     * @param robotId 机器人ID
     * @returns 
     */
    public getSubscriber(sourceId: string, robotId: string): Target[] | null {
        let subscribers: Target[] = [];
        // 获取订阅
        if (this.subscribeList?.[sourceId]?.[robotId]) {
            subscribers.push(...this.subscribeList[sourceId][robotId]);
        }

        if (sourceId.startsWith('channel:') && sourceId.includes('/')) {
            // 获取父级（频道组）的订阅
            let channelGroupPath = sourceId.substring(0, sourceId.lastIndexOf('/'));
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

    public getSubscribedList(robotId: string, targetType: string, targetId: string, sourceType: string): string[] {
        return this.subscribeConfig?.[robotId]?.[targetType]?.[targetId]?.[sourceType] ?? [];
    }
}
