import App from "#ibot/App";
import { AddReplyMode, CommonReceivedMessage } from "#ibot/message/Message";
import { CommandInputArgs, MessagePriority, PluginController, PluginEvent } from "../PluginManager";
import got from "got/dist/source";
import { RandomMessage } from "#ibot/utils/RandomMessage";
import { QQForwardingMessage } from "#ibot/robot/adapter/qq/Message";
import QQRobot from "#ibot/robot/adapter/QQRobot";
import { GroupSender } from "#ibot/message/Sender";
import { Robot } from "#ibot/robot/Robot";

export type IsekaiBBSQuicklyPostConfig = {
    api_endpoint: string,
    token: string,
};

export type IsekaiQuicklyPostMessageData = {
    /** 发布账号 */
    account: string,
    /** 发布账号的昵称（QQ昵称、邮箱姓名） */
    nickname?: string,
    /** 头像 */
    avatar?: string,
    /** 文章内容（Markdown） */
    content: string,
    /** 消息ID，用于建立回复树 */
    id?: string,
    /** 回复的消息ID */
    replyId?: string,
}

export type IsekaiQuicklyPostBody = {
    /** 发布来源 */
    srcType: string,
    /** 文章标题 */
    title?: string,
    /** 消息列表 */
    messages: IsekaiQuicklyPostMessageData[],
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

        this.event.registerCommand({
            command: '绑定快速发布',
            name: '绑定快速发布账号',
        }, async (args, message, resolve) => {
            let groupId = message.sender.groupId;
            if (!groupId) return;

            let groupConfig = this.config.groups[groupId];
            if (!groupConfig) return;

            resolve();

            return this.bindAccount(args, message, groupConfig);
        });

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

    async bindAccount(args: CommandInputArgs, message: CommonReceivedMessage, groupConfig: IsekaiBBSQuicklyPostConfig) {
        message.markRead();

        let bindingCodeStr = args.param.trim();
        if (!bindingCodeStr) {
            await message.sendReply('请输入绑定码。', false);
            return;
        }

        try {
            const res = await got.post(groupConfig.api_endpoint + '/api/isekai-quicklypost/server-api/qq/verify-binding', {
                json: {
                    account: message.sender?.userId,
                    binding_code: bindingCodeStr,
                },
                headers: {
                    authorization: `Bearer ${groupConfig.token}`,
                },
            }).json<any>();

            if (res.error) {
                if (res.error === 'BINDING_CODE_INVALID') {
                    await message.sendReply(`验证码错误或验证码已过期`, AddReplyMode.IGNORE_PRIVATE);
                    return;
                }
                throw new Error(res.message);
            }
        } catch (err: any) {
            this.app.logger.error("绑定BBS账号失败：" + err.message, err);
            console.error(err);
            
            await message.sendReply(`绑定账号失败：${err.message}`, false);
        }
    }

    async messageToMarkdown(message: CommonReceivedMessage) {
        let markdownBuilder: string[] = [];
        message.content.forEach(messageChunk => {
            if (messageChunk.type.includes('text')) {
                markdownBuilder.push(messageChunk.text ?? '');
            } else if (messageChunk.type.includes('image')) {
                markdownBuilder.push(`![${messageChunk.data?.alt ?? ''}](${messageChunk.data?.url ?? ''})`);
            } else if (messageChunk.type.includes('emoji')) {
                markdownBuilder.push(messageChunk.text ?? '🫥');
            } else if (messageChunk.type.includes('record')) {
                markdownBuilder.push('[语音消息]');
            } else if (messageChunk.type.includes('mention')) {
                if (messageChunk.data?.text) {
                    markdownBuilder.push(`**&#64;${messageChunk.data.text}**`);
                }
            }
        });
        return markdownBuilder.join('');
    }

    async postNewThread(refMessage: CommonReceivedMessage, groupConfig: IsekaiBBSQuicklyPostConfig) {
        if (refMessage.receiver.type !== 'qq') {
            // TODO: support other platform
            return;
        }
        let attachmentMsg = refMessage.content[0] as QQForwardingMessage;
        let resId = attachmentMsg.data.res_id;
        let robot = refMessage.receiver as Robot<QQRobot>;
        let referenceSender = refMessage.sender as GroupSender;

        refMessage.markRead()

        this.app.logger.info(`[群号：${refMessage.sender.groupId}] 收到合并转发消息 ${resId}，正在发送到BBS。`);

        let messageList = await robot.adapter.getReferencedMessages(resId);

        if (!messageList || messageList.length === 0) {
            this.app.logger.info(`[群号：${refMessage.sender.groupId}] 合并转发消息内容为空或无法获取。`);
            return;
        }
        
        try {
            let markdownBuilder: string[] = [];
            for (let message of messageList) {
                const sender = message.sender as GroupSender;
                const content = await this.messageToMarkdown(message);

                markdownBuilder.push('**' + (sender.displayName ?? sender.userName ?? sender.userId) + ':** ');
                markdownBuilder.push(content);
                markdownBuilder.push('\n');
            }

            let postData = {
                srcType: 'qq',
                messages: [{
                    account: referenceSender.userId,
                    nickname: referenceSender.displayName,
                    avatar: robot.adapter.infoProvider.getUserImage(referenceSender.userId),
                    content: markdownBuilder.join('\n'),
                }],
            } as IsekaiQuicklyPostBody;

            const res = await got.post(groupConfig.api_endpoint + '/api/isekai-quicklypost/server-api/post', {
                json: postData,
                headers: {
                    authorization: `Bearer ${groupConfig.token}`,
                }
            }).json<any>();

            if (res.error) {
                throw new Error(res.message);
            }

            // 保存threadId到消息
            refMessage.extra['isekai_bbs_quicklypost'] = {
                threadId: res.tid,
            };
        } catch(err: any) {
            this.app.logger.error("转发消息到BBS失败：" + err.message, err);
            console.error(err);

            let msg = this.messageGroup.error.nextMessage({
                error: err.message,
            });
            await refMessage.sendReply(msg ?? `转发失败：${err.message}`, false);
        }
    }
}