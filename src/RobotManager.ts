import fs from "fs";
import path from "path";

import App from "./App";
import { MultipleMessage } from "./base/provider/BaseProvider";
import { RobotConfig } from "./Config";
import { CommonGroupMessage, CommonPrivateMessage, CommonReceivedMessage, CommonSendMessage } from "./message/Message";
import { GroupSender, ChatIdentity, UserSender } from "./message/Sender";
import { CommandInfo } from "./PluginManager";
import { RestfulApiManager, RestfulContext, RestfulRouter } from "./RestfulApiManager";
import { SessionStore } from "./SessionManager";
import { Target } from "./SubscribeManager";

export interface Robot {
    type: string;
    robotId?: string;
    uid?: string;
    description?: string;
    initialize?: () => Promise<any>;
    initRestfulApi?: (router: RestfulRouter, api: RestfulApiManager) => Promise<any>;
    setCommands?(commands: CommandInfo[]): Promise<any>;
    sendTyping?(chatIdentity: ChatIdentity): Promise<boolean>;
    sendMessage(message: CommonSendMessage): Promise<CommonSendMessage>;
    sendPushMessage(targets: Target[], message: string): Promise<any>;
    deleteMessage?(chatIdentity: ChatIdentity, messageId: string): Promise<boolean>;
    getSession(chatIdentity: ChatIdentity, type: string): SessionStore;
}

export class RobotManager {
    private app: App;
    private config: Record<string, RobotConfig>;

    private robotClasses: Record<string, any>;
    private robots: Record<string, Robot>;

    constructor(app: App, config: Record<string, RobotConfig>) {
        this.app = app;
        this.config = config;

        this.robotClasses = {};
        this.robots = {};
    }

    public async initialize() {
        const ROBOT_PATH = path.join(this.app.srcPath, "robot");

        for (let file of fs.readdirSync(ROBOT_PATH)) {
            let robotFile = `${ROBOT_PATH}/${file}`;
            if (robotFile.match(/\.m?js$/)) {
                // 加载js文件
                let robotName = path.basename(robotFile).replace(/Robot\.m?js$/gi, "").toLocaleLowerCase();
                try {
                    let robotClass = await import(robotFile);
                    if (!robotClass || !robotClass.default) {
                        throw new Error("robot api is empty");
                    }
                    this.robotClasses[robotName] = robotClass.default;
                } catch(err) {
                    this.app.logger.error(`无法加载Robot API: ${robotName}`, err);
                }
            }
        }

        for (let robotId in this.config) {
            let robotConfig = this.config[robotId];
            let robotType: string = robotConfig.type;
            if (!robotType) {
                this.app.logger.error("无法加载 " + robotId + " Robot: 配置文件中未定义 'type'");
                continue;
            }
            robotType = robotType.toLocaleLowerCase();
            if (robotType in this.robotClasses) {
                let robotClass = this.robotClasses[robotType];
                try {
                    let robotObject: Robot = new robotClass(this.app, robotId, robotConfig);

                    await robotObject.initialize?.();
                    await robotObject.initRestfulApi?.(this.app.restfulApi.getRobotRouter(robotId), this.app.restfulApi);

                    this.robots[robotId] = robotObject;
                    this.app.logger.info(`已加载Robot: ${robotId}`);
                } catch(err) {
                    console.error(`无法加载 ${robotId} Robot: `, err);
                }
            } else {
                console.error(`无法加载 ${robotId} Robot: Robot不存在`);
            }
        }
    }
    
    public async sendPushMessage(channelId: string, messages: MultipleMessage) {
        for (let robotId in this.robots) {
            let robot = this.robots[robotId];
            let robotType = robot.type;
            let currentMsg: string | null = null;
            if (robotId in messages) {
                currentMsg = messages[robotId];
            } else if (robotType && robotType in messages) {
                currentMsg = messages[robotType];
            } else if ("base" in messages) {
                currentMsg = messages["base"];
            }
            if (!currentMsg) { // 未找到消息
                continue;
            }

            let targets = this.app.getChannelSubscriber(channelId, robotId);
            if (!targets) {
                continue;
            }

            try {
                await robot.sendPushMessage(targets, currentMsg);
            } catch(err) {
                console.error(`[${channelId}] 无法发送消息到 ${robotId} : `, err);
            }
        }
    }

    public getSenderIdentity(robot: Robot, message: CommonReceivedMessage) {
        let sender: ChatIdentity = {
            robot: robot,
            type: 'raw',
        };
        if (message instanceof CommonPrivateMessage) {
            const messageSender = message.sender as UserSender;
            sender.type = 'private';
            sender.userId = messageSender.uid;
        } else if (message instanceof CommonGroupMessage) {
            const messageSender = message.sender as GroupSender;
            sender.type = 'group';
            sender.userId = messageSender.uid;
            sender.groupId = messageSender.groupId;
            sender.rootGroupId = messageSender.rootGroupId;
        }

        return sender;
    }

    public getSessionPath(sender: ChatIdentity, type: string = 'chat'): string[] {
        if (type === 'global') { // 全局Session
            return ['global'];
        }

        let ret: string[] = ['robot', sender.robot.robotId!];

        if (type === 'robot') { // 机器人Session
            return ret;
        }

        if (!sender.userId) {
            throw new Error("Unknown sender");
        }

        if (type === 'user' || sender.type === 'private') { // 用户Session
            ret.push('user', sender.userId!);
            return ret;
        }

        if (sender.type === 'group') {
            if (sender.rootGroupId && sender.groupId) {
                ret.push('group', sender.rootGroupId);
                if (type === 'rootGroup') return ret;

                ret.push(sender.groupId);
                if (type === 'group') return ret;

                ret.push(sender.userId!);
                if (type === 'chat') return ret;
            } else if (sender.rootGroupId || sender.groupId) {
                ret.push('group', sender.rootGroupId || sender.groupId!);
                if (type === 'rootGroup' || type === 'group') return ret;

                ret.push(sender.userId!);
                if (type === 'chat') return ret;
            }
        }

        throw new Error(`Unknown session type: ${type}`);
    }
}
