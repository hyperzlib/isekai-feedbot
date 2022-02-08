import App from "../App";
import { Robot } from "../RobotManager";
import { Target } from "../SubscribeManager";
import request from "request-promise";
import { Utils } from "../Utils";

export type QQRobotConfig = {
    user: string;
    host: string;
    baseId?: string;
}

export default class QQRobot implements Robot {
    private robotId: string;
    private endpoint: string;
    private botQQ: number;

    public baseId?: string;

    constructor(app: App, robotId: string, config: QQRobotConfig) {
        this.robotId = robotId;
        this.endpoint = 'http://' + config.host;
        this.botQQ = parseInt(config.user);

        this.baseId = config.baseId;
    }

    async initialize() {
        
    }

    /**
     * 发送私聊消息
     * @param {int|int[]} user - QQ号
     * @param {string} message - 消息
     * @returns {Promise<void>} 回调
     */
    async sendToUser(user: number|number[], message: string) {
        if(Array.isArray(user)){ //发送给多个用户的处理
            for (let one of user) {
                await this.sendToUser(one, message);
                await Utils.sleep(100);
            }
            return;
        }

        return await this.doApiRequest('send_msg', {
            bot: this.botQQ,
            type: 1,
            qq: user,
            msg: message,
        });
    }

    /**
     * 发送群消息
     */
    async sendToGroup(group: number|number[], message: string) {
        if(Array.isArray(group)){ //发送给多个群组的处理
            for (let one of group) {
                await this.sendToGroup(one, message);
                await Utils.sleep(100);
            }
            return;
        }

        return await this.doApiRequest('send_msg', {
            bot: this.botQQ,
            type: 2,
            group: group,
            msg: message,
        });
    }

    /**
     * 发送消息
     */
    async sendMessage(targets: Target[], message: string) {
        let groupList: number[] = [];
        let userList: number[] = [];
        for (let target of targets) {
            if (target.type === "group") {
                groupList.push(parseInt(target.identity));
            } else if (target.type === "user") {
                userList.push(parseInt(target.identity));
            }
        }

        if (groupList.length > 0) {
            await this.sendToGroup(groupList, message);
        }
        if (userList.length > 0) {
            await this.sendToUser(userList, message);
        }
    }

    /**
     * 执行API调用
     */
    async doApiRequest(method: string, data: any): Promise<any> {
        return await request({
            method: 'POST',
            uri: this.endpoint + '/' + method,
            body: data,
            json: true,
            timeout: 10000
        });
    }
}
