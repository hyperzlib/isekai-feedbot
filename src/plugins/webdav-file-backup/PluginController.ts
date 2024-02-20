import { AuthType, createClient } from "webdav";
import App from "#ibot/App";
import { extname } from "path";
import { AttachmentMessage } from "#ibot/message/Message";
import { CommonReceivedMessage } from "#ibot/message/Message";
import { MessagePriority, PluginEvent } from "#ibot/PluginManager";
import got from "got/dist/source";
import { RandomMessage } from "#ibot/utils/RandomMessage";
import { PluginController } from "#ibot-api/PluginController";

export type WebdavConfig = {
    url: string,
    username?: string,
    password?: string,
    path?: string,
    exclusive?: boolean;
};

const defaultConfig = {
    groups: {} as Record<string, WebdavConfig>,
    messages: {
        error: [
            '转存群文件失败：{{{error}}}',
            '在转存群文件时发生了错误：{{{error}}}',
            '未能将群文件转存到资料库：{{{error}}}',
            '由于以下错误，文件转存失败：{{{error}}}',
            '很抱歉，文件无法成功转存至群组资料库，原因是：{{{error}}}。',
            '转存群组文件时出现问题，错误详情：{{{error}}}。',
            '文件无法转存到资料库，错误信息如下：{{{error}}}。',
            '出现错误，导致文件无法成功转存至群组资料库：{{{error}}}。',
            '转存群文件遇到问题，以下是错误的详细信息：{{{error}}}。',
            '文件转存失败，原因是：{{{error}}}。',
            '抱歉，由于以下错误，文件未能成功转存至群组资料库：{{{error}}}。',
            '在尝试将文件转存至群组资料库时，发生了如下错误：{{{error}}}。',
            '文件转存操作失败，错误详情：{{{error}}}。',
        ]
    }
};

export default class WebdavFileBackupController extends PluginController<typeof defaultConfig> {
    private SESSION_KEY_GENERATE_COUNT = 'stablediffusion_generateCount';
    
    public chatGPTClient: any;
    
    private messageGroup: Record<string, RandomMessage> = {}
    
    async getDefaultConfig() {
        return defaultConfig;
    }

    async initialize(config: any) {
        this.event.on('message/group', async (message, resolved) => {
            if (message.type !== 'attachment') return;

            let groupId = message.sender.groupId;
            if (!groupId) return;

            let groupConfig = this.config.groups[groupId];
            if (!groupConfig) return;

            if (groupConfig.exclusive) {
                resolved();
            }

            return this.uploadGroupFile(message, groupConfig);
        }, {
            priority: MessagePriority.HIGH,
        });
    }

    async destroy() {
        
    }

    async updateConfig(config: any) {
        // 随机消息
        for (let [key, value] of Object.entries(this.config.messages)) {
            this.messageGroup[key] = new RandomMessage(value);
        }
    }

    async uploadGroupFile(message: CommonReceivedMessage, groupConfig: WebdavConfig) {
        if (message.content[0] &&
                (message.content[0].type.includes('attachment'))) {
            let attachmentMsg = message.content[0] as AttachmentMessage;
            let fileName = attachmentMsg.data.fileName;
            let url = attachmentMsg.data.url;
            let fileSize = attachmentMsg.data.size;

            message.markRead()

            this.app.logger.info(`[群号：${message.sender.groupId}] 收到群文件：${fileName}，开始转存`);

            let authOption: any = {};
            if (groupConfig.username) {
                authOption.username = groupConfig.username;
            }
            if (groupConfig.password) {
                authOption.password = groupConfig.password;
            }

            let client = createClient(groupConfig.url, groupConfig);

            let filePath = '';
            if (groupConfig.path) {
                filePath = groupConfig.path.replace(/\$\{(\w+)\}/g, (match, p1) => {
                    switch (p1) {
                        case 'groupId':
                            return message.sender.groupId;
                        case 'groupName':
                            return message.sender.groupName;
                        case 'userId':
                        case 'uid':
                            return message.sender.userId;
                        case 'fileName':
                            return fileName;
                        case 'date':
                            return message.time.toISOString().replace(/T/, ' ').replace(/\..+/, '');
                        case 'year':
                            return message.time.getFullYear().toString();
                        case 'month':
                            return (message.time.getMonth() + 1).toString();
                        case 'day':
                            return message.time.getDate().toString();
                        case 'timestamp':
                            return message.time.getTime().toString();
                        default:
                            return match;
                    }
                })
            } else {
                filePath = '/' + fileName;
            }

            
            try {
                let fileShortName = fileName.substring(0, 10);
                if (fileShortName.length !== fileName.length) {
                    fileShortName += '...';
                }

                // create path
                let path = filePath.split('/');
                path.pop();
                let currentPath = '';
                for (let i = 0; i < path.length; i++) {
                    currentPath += '/' + path[i];
                    try {
                        if (!await client.exists(currentPath)) {
                            await client.createDirectory(currentPath);
                        }
                    } catch (e) {
                        console.error(e);
                    }
                }

                if (await client.exists(filePath)) {
                    let fileExt = extname(filePath);
                    if (fileExt) {
                        filePath = filePath.replace(fileExt, `_${Date.now()}${fileExt}`);
                    } else {
                        filePath = filePath + `_${Date.now()}`;
                    }
                }

                /*if (fileSize && fileSize > 1024 * 1024 * 10) {
                    await message.sendReply('正在转存文件：' + fileShortName, false);
                }*/

                await new Promise((resolve, reject) => {
                    got.stream(url).pipe(client.createWriteStream(filePath))
                        .on('finish', resolve)
                        .on('error', reject);
                });
                // await message.sendReply('文件 ' + fileShortName + ' 已经转存到资料库了', false);
            } catch(err: any) {
                this.app.logger.error("转存群文件失败：" + err.message, err);
                console.error(err);

                let msg = this.messageGroup.error.nextMessage(err.message);
                await message.sendReply(msg ?? `转存群文件失败：${err.message}`, false);
            }
        }
    }
}