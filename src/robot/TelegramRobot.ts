import Bluebird from "bluebird";
import TelegramBot from "node-telegram-bot-api";
import App from "../App";
import { Robot } from "../RobotManager";
import { Target } from "../SubscribeManager";
import { Utils } from "../Utils";

export type TelegramRobotConfig = {
    token: string;
    baseId?: string;
    proxy?: string;
}

export default class TelegramRobot implements Robot {
    private robotId: string;
    bot: TelegramBot;
    baseId?: string | undefined;

    constructor(app: App, robotId: string, config: TelegramRobotConfig) {
        this.robotId = robotId;
        this.baseId = config.baseId;

        let botOptions: any = {
            polling: true
        };
        if (config.proxy) {
            botOptions.request = {
                proxy: config.proxy
            };
        }
        this.bot = new TelegramBot(config.token, botOptions);
        
    }

    async initialize() {
        await this.initCommands();
    }

    async initCommands() {
        this.bot.setMyCommands([
            { command: 'start', description: '显示机器人简介信息' },
            { command: 'getchatid', description: '获取当前会话的id' }
        ], {
            language_code: 'zh'
        });

        this.bot.onText(/^\/start/, async (message) => {
            const chatId = message.chat.id;
            this.bot.sendMessage(chatId, '这是异世界百科的推送机器人，目前还未开放加入其他群组的功能。');
        });

        this.bot.onText(/^\/getchatid/, async (message) => {
            const chatId = message.chat.id;
            this.bot.sendMessage(chatId, '当前会话ID：' + chatId);
        });
    }

    /**
     * 发送群消息
     */
    async sendToChat(chatId: number|number[], message: string) {
        if(Array.isArray(chatId)){ //发送给多个群组的处理
            for (let one of chatId) {
                await this.sendToChat(one, message);
                await Utils.sleep(100);
            }
            return;
        }

        return await this.bot.sendMessage(chatId, message);
    }

    /**
     * 发送机器人消息
     * @param targets 发送目标
     * @param message 消息内容
     */
    async sendMessage(targets: Target[], message: string): Promise<void> {
        let chatIdList: number[] = [];
        for (let target of targets) {
            chatIdList.push(parseInt(target.identity));
        }
        await this.sendToChat(chatIdList, message);
    }
}