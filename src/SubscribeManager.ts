import fs from "fs";
import Yaml from "yaml";
import micromatch from "micromatch";
import chokidar from 'chokidar';

import App from "./App";

export interface Target {
    type: string;
    identity: string;
}

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

    private reloadSubscribeFile() {
        this.loadSubscribeFile();
        this.subscribeList = {};
        for (let channelId in this.app.channel.channels) {
            this.addChannel(channelId);
        }
        console.log('已重载Subscribe');
    }
    
    public addChannel(channelId: string) {
        this.subscribeList[channelId] = {};
        for (let robotId in this.subscribeConfig) {
            let targetConf = this.subscribeConfig[robotId];
            let matchedTargetList: Target[] = [];
            for (let targetType in targetConf) {
                let targetList = targetConf[targetType];
                for (let targetIdentity in targetList) {
                    let matchList = targetList[targetIdentity];
                    if (micromatch.isMatch(channelId, matchList)) {
                        matchedTargetList.push({
                            type: targetType,
                            identity: targetIdentity
                        });
                    }
                }
            }
            this.subscribeList[channelId][robotId] = matchedTargetList;
        }
    }

    public removeChannel(channelId: string) {
        delete this.subscribeList[channelId];
    }

    public getSubscriber(channelId: string, robotId: string): Target[] | null {
        if (channelId in this.subscribeList && robotId in this.subscribeList[channelId]) {
            return this.subscribeList[channelId][robotId];
        } else {
            return null;
        }
    }
}
