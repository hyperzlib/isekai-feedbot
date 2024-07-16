import TelegramBot from "node-telegram-bot-api";
import App from "../../App";
import { RobotConfig } from "../../types/config";
import { CommonSendMessage } from "../../message/Message";
import { CommandInfo, EventScope } from "../../PluginManager";
import { RobotAdapter } from "../Robot";
import { asleep } from "#ibot/utils";
import { PluginInitializedEvent } from "#ibot/types/event";

export type TelegramRobotConfig = RobotConfig & {
    token: string;
    proxy?: string;
}

export default class TelegramRobot implements RobotAdapter {
    private app: App;

    public type = 'telegram';
    public robotId: string;
    public userId?: string;
    public description: string;

    private bot: TelegramBot;
    private events: EventScope;

    constructor(app: App, robotId: string, config: TelegramRobotConfig) {
        this.app = app;
        
        this.robotId = robotId;
        this.description = config.description ?? app.config.robot_description ?? 'Isekai Feedbot for Telegram';

        let botOptions: any = {
            polling: true
        };
        if (config.proxy) {
            botOptions.request = {
                proxy: config.proxy
            };
        }

        this.bot = new TelegramBot(config.token, botOptions);
        this.events = new EventScope(this.app, 'bot/telegram', 'main');

        this.events.on<PluginInitializedEvent>('plugin/initialized', async () => {
            await this.initCommands();
        });
    }

    async initialize() {
        
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

    async setCommands(commands: CommandInfo[]) {
        /*
        let botCommands: TelegramBot.BotCommand[] = [];
        for (let command of commands) {
            botCommands.push({
                command: command.command,
                description: command.help ?? command.name
            });
        }
        await this.bot.setMyCommands(botCommands);
        */
    }

    /**
     * 发送群消息
     */
    async sendToChat(chatId: number|number[], message: string) {
        if(Array.isArray(chatId)){ //发送给多个群组的处理
            for (let one of chatId) {
                await this.sendToChat(one, message);
                await asleep(100);
            }
            return;
        }

        return await this.bot.sendMessage(chatId, message);
    }

    /**
     * 发送消息
     * @param message 
     */
    async sendMessage(message: CommonSendMessage): Promise<CommonSendMessage> {
        return message;
    }
}