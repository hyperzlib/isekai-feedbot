import fs from 'fs/promises';
import path from 'path';
import Yaml from 'yaml';
import chokidar from 'chokidar';
import { debounce } from 'throttle-debounce';
import EventEmitter from 'events';

import App from './App';
import { BaseProvider } from './base/provider/BaseProvider';
import { ChannelConfig } from './Config';

export class ChannelManager extends EventEmitter {
    private app: App;
    private channelPath: string;
    private loadChannelCallback: (file: string) => any;
    private removeChannelCallback: (file: string) => any;
    private setLoading?: debounce<Function>;
    private watcher!: chokidar.FSWatcher;
    
    public channels: { [key: string]: BaseProvider };
    public channelName: { [key: string]: string };

    constructor(app: App, channelPath: string) {
        super();

        this.app = app;
        this.channelPath = channelPath;
        this.channels = {};
        this.channelName = {};

        this.loadChannelCallback = this.loadChannel.bind(this);
        this.removeChannelCallback = this.removeChannel.bind(this);
    }

    /**
     * 加载所有Channel
     */
    async initialize() {
        this.watcher = chokidar.watch(this.channelPath, {
            ignored: '*.bak',
            ignorePermissionErrors: true,
            persistent: true
        });

        this.watcher.on('add', this.loadChannelCallback);
        this.watcher.on('change', this.loadChannelCallback);
        this.watcher.on('unlink', this.removeChannelCallback);
    }

    /**
     * 获取Channel ID
     * @param {string} file - channel config file
     * @returns 
     */
    getChannelId(file: string): string {
        let channelPath = path.relative(this.channelPath, file).replace(/\\/g, "/").replace(/\..*?$/, "");
        return channelPath;
    }

    /**
     * 获取Channel的全名
     * @param {string} channelId - channel ID
     */
    getChannelFullName(channelId: string): string {
        // 从最顶层开始查找
        let pathList = channelId.split("/");
        let nameList: string[] = [];
        for (let i = 0; i < pathList.length; i++) {
            let currentPath = pathList.slice(0, i + 1).join("/");
            let findedName = this.channelName[currentPath];
            if (findedName) {
                nameList.push(findedName);
            } else {
                nameList.push(pathList[i]);
            }
        }
        return nameList.join("/");
    }

    /**
     * 获取Provider名
     * @param config 
     * @returns 
     */
    getProviderName(config: ChannelConfig): string {
        return config.provider;
    }

    /**
     * 读取或更新Channel配置文件
     * @param {string} file 
     */
    async loadChannel(file: string) {
        try {
            let content = await fs.readFile(file, { encoding: 'utf-8' });
            let config = Yaml.parse(content);
            let channelId = this.getChannelId(file);
            if (path.basename(channelId) === "_group") {
                // 只是group标记
                channelId = path.dirname(channelId);
                this.channelName[channelId] = config?.name;
            } else {
                if (BaseProvider.checkConfig(config)) {
                    // console.log(`正在加载Channel: ${channelId}`);
                    // 处理channel
                    let providerName = this.getProviderName(config);
                    let isReload = false;
                    if (channelId in this.channels) {
                        // 重载配置
                        isReload = true;
                        await this.channels[channelId].destory();
                    }
                    // 读取配置
                    let channel = this.app.createChannel(providerName, channelId, config);
                    if (channel) {
                        await channel.initialize();
                        // 更新列表
                        this.channels[channelId] = channel;
                        this.channelName[channelId] = config?.name;
                        if (isReload) {
                            this.emit('reload', channelId);
                            console.log(`已重载Channel: ${channelId}`);
                        } else {
                            this.emit('add', channelId);
                            console.log(`已加载Channel: ${channelId}`);
                        }
                    }
                } else {
                    console.error(`配置文件: ${file} 格式错误`);
                }
            }
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    }

    /**
     * 移除Channel
     * @param {string} file
     */
    async removeChannel(file: string) {
        let channelId = this.getChannelId(file);
        if (path.basename(channelId) === "_group") {
            // 仅删除组名
            channelId = path.basename(channelId);
            delete this.channelName[channelId];
        } else {
            let channel = this.channels[channelId];
            if (channel) {
                await channel.destory();
                delete this.channels[channelId];
                delete this.channelName[channelId];
                this.emit('remove', channelId);
                console.log("已移除Channel: ", this.getChannelFullName(channelId));
            }
        }
    }

    onLoad() {

    }
}
