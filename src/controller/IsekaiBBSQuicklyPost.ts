import { AuthType, createClient } from "webdav";
import App from "../App";
import { extname } from "path";
import { AttachmentMessage } from "../message/Message";
import { CommonReceivedMessage } from "../message/Message";
import { MessagePriority, PluginController, PluginEvent } from "../PluginManager";
import got from "got/dist/source";
import { RandomMessage } from "../utils/RandomMessage";
import { QQForwardingMessage } from "../robot/qq/Message";
import QQRobot from "../robot/QQRobot";
import { ChatIdentity, UserSender } from "../message/Sender";
import { Utils } from "../utils/Utils";
import { MessageUtils } from "../utils/message";

export type IsekaiBBSQuicklyPostConfig = {
    api_endpoint: string,
    token: string,
};

export default class IsekaiBBSQuicklyPost implements PluginController {
    private config!: Awaited<ReturnType<typeof this.getDefaultConfig>>;

    public event!: PluginEvent;
    public app: App;
    public chatGPTClient: any;

    public id = 'isekaibbs_quicklypost';
    public name = '异世界红茶馆 快速发帖';
    public description = '将合并转发的内容自动发布到异世界红茶馆';
    
    private messageGroup: Record<string, RandomMessage> = {}

    constructor(app: App) {
        this.app = app;
    }

    async getDefaultConfig() {
        return {
            groups: {} as Record<string, IsekaiBBSQuicklyPostConfig>,
            messages: {
                error: [
                    '快速发帖失败：{{{error}}}',
                    '在发帖时发生了错误：{{{error}}}',
                    '未能将这些消息转发到论坛：{{{error}}}',
                    '由于以下错误，发帖失败：{{{error}}}',
                    '很抱歉，消息无法发送至论坛，原因是：{{{error}}}。',
                    '转发消息时出现问题，错误详情：{{{error}}}。',
                    '消息无法发送到论坛，错误信息如下：{{{error}}}。',
                    '出现错误，导致消息无法成功发送至论坛：{{{error}}}。',
                    '转发消息遇到问题，以下是错误的详细信息：{{{error}}}。',
                    '发帖失败，原因是：{{{error}}}。',
                ]
            }
        };
    }

    async initialize(config: any) {
        await this.updateConfig(config);

        this.event.init(this);

        this.event.on('message/group', async (message, resolved) => {
            if (message.type !== 'reference') return;

            let groupId = message.sender.groupId;
            if (!groupId) return;

            let groupConfig = this.config.groups[groupId];
            if (!groupConfig) return;
            
            resolved();

            return this.postNewThread(message, groupConfig);
        }, {
            priority: MessagePriority.HIGH,
        });
    }

    async destroy() {
        
    }

    async updateConfig(config: any) {
        this.config = config;
        
        // 随机消息
        for (let [key, value] of Object.entries(this.config.messages)) {
            this.messageGroup[key] = new RandomMessage(value);
        }
    }

    // 隐藏用户账号的中间几位
    async maskUsername(username: string) {
        const maskLen = 4;
        const maskOffset = 2;
        if (username.length <= maskLen) return username;
        return username.substring(0, maskOffset) + '_'.repeat(maskLen) + username.substring(maskOffset + maskLen);
    }

    async messageToMarkdown(message: CommonReceivedMessage) {
        let markdownBuilder: string[] = [];
        message.content.forEach(messageChunk => {
            if (messageChunk.type.includes('text')) {
                markdownBuilder.push(messageChunk.data?.text ?? '');
            } else if (messageChunk.type.includes('image')) {
                markdownBuilder.push(`![${messageChunk.data?.alt ?? ''}](${messageChunk.data?.url ?? ''})`);
            } else if (messageChunk.type.includes('mention')) {
                if (messageChunk.data?.text) {
                    markdownBuilder.push(`&#64;${messageChunk.data.text}`);
                }
            }
        });
    }

    async postNewThread(message: CommonReceivedMessage, groupConfig: IsekaiBBSQuicklyPostConfig) {
        if (message.receiver.type !== 'qq') {
            // TODO: support other platform
            return;
        }
        let attachmentMsg = message.content[0] as QQForwardingMessage;
        let resId = attachmentMsg.data.res_id;
        let robot = message.receiver as QQRobot;

        message.markRead()

        this.app.logger.info(`[群号：${message.sender.groupId}] 收到合并转发消息，正在发送到BBS。`);

        let messageList = await robot.getReferencedMessages(resId);

        if (!messageList || messageList.length === 0) {
            this.app.logger.info(`[群号：${message.sender.groupId}] 合并转发消息内容为空或无法获取。`);
            return;
        }
        
        try {
            let markdownBuilder = [];
            for (let message of messageList) {
                
            }
        } catch(err: any) {
            this.app.logger.error("转存群文件失败：" + err.message, err);
            console.error(err);

            let msg = this.messageGroup.error.nextMessage(err.message);
            await message.sendReply(msg ?? `转存群文件失败：${err.message}`, false);
        }
    }
}