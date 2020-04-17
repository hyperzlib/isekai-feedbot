const request = require('request-promise');

class QQRobot {
    constructor(config){
        this.endpoint = 'http://' + config.host;
    }

    /**
     * 发送私聊消息
     * @param {int|int[]} user - QQ号
     * @param {string} message - 消息
     * @returns {Promise<void>} 回调
     */
    sendToUser(user, message){
        if(Array.isArray(user)){ //发送给多个用户的处理
            let queue = [];
            user.forEach((one) => {
                queue.push(this.sendToUser(one, message));
            });
            return Promise.all(queue);
        }

        return this.doApiRequest('send_private_msg', {
            user_id: user,
            message: message,
        });
    }

    /**
     * 发送群消息
     * @param {int|int[]} group - 群号
     * @param {string} message - 消息
     * @returns {Promise<void>} 回调
     */
    sendToGroup(group, message){
        if(Array.isArray(group)){ //发送给多个用户的处理
            let queue = [];
            group.forEach((one) => {
                queue.push(this.sendToGroup(one, message));
            });
            return Promise.all(queue);
        }

        return this.doApiRequest('send_group_msg', {
            group_id: group,
            message: message,
        });
    }

    /**
     * 执行酷Q的API调用
     * @param {string} method - 方法名
     * @param {any} data - 数据
     * @returns {Promise<void>} 回调
     */
    doApiRequest(method, data){
        let opt = {
            method: 'POST',
            uri: this.endpoint + '/' + method,
            body: data,
            json: true,
        }
        return request(opt);
    }
}

module.exports = QQRobot;