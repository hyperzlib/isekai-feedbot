import fs from "fs";
import path from "path";

import App from "./App";
import { MultipleMessage } from "./base/provider/BaseProvider";
import { RobotConfig } from "./Config";
import { CommonSendMessage } from "./message/Message";
import { RestfulApiManager, RestfulContext, RestfulRouter } from "./RestfulApiManager";
import { Target } from "./SubscribeManager";

const ROBOT_PATH = __dirname + "/robot";

export interface Robot {
    type: string;
    robotId?: string;
    uid?: string;
    initialize?: () => Promise<any>;
    initRestfulApi?: (router: RestfulRouter, api: RestfulApiManager) => Promise<any>;
    sendMessage(message: CommonSendMessage): Promise<CommonSendMessage>;
    sendPushMessage(targets: Target[], message: string): Promise<any>;
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

    async initialize() {
        for (let file of fs.readdirSync(ROBOT_PATH)) {
            let robotFile = `${ROBOT_PATH}/${file}`;
            if (robotFile.match(/\.(js|mjs)$/)) {
                // 加载js文件
                let robotName = path.basename(robotFile).replace(/Robot\.(js|mjs)$/gi, "").toLocaleLowerCase();
                try {
                    let robotClass = require(robotFile)?.default;
                    if (!robotClass) {
                        throw new Error("robot api is empty");
                    }
                    this.robotClasses[robotName] = robotClass;
                } catch(err) {
                    console.log(`无法加载Robot API: ${robotName}`, err);
                }
            }
        }

        for (let robotId in this.config) {
            let robotConfig = this.config[robotId];
            let robotType: string = robotConfig.type;
            if (!robotType) {
                console.error("无法加载 " + robotId + " Robot: 配置文件中未定义 'type'");
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
                    console.log(`已加载Robot: ${robotId}`);
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

            let targets = this.app.getSubscriber(channelId, robotId);
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
}
