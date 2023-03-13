import App from "../App";
import { CommonReceivedMessage } from "../message/Message";
import { MessagePriority, PluginController, PluginEvent } from "../PluginManager";
import { ChatGPTBrowserClient, ChatGPTClient } from '@waylaidwanderer/chatgpt-api';
import { encode as gptEncode } from 'gpt-3-encoder';
import got, { OptionsOfTextResponseBody } from "got/dist/source";
import { HttpsProxyAgent } from 'hpagent';

export type ChatGPTApiMessage = {
    role: 'summary' | 'assistant' | 'user',
    message: string,
    tokens: number,
};

export class ChatGPTAPIError extends Error {
    public code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'ChatGPTAPIError';
        this.code = code;
    }
}

export default class ChatGPTController implements PluginController {
    private SESSION_KEY_CHAT_SESSION = 'openai_chatSession';
    private SESSION_KEY_API_CHAT_LOG = 'openai_apiChatLog';
    private SESSION_KEY_MESSAGE_COUNT = 'openai_apiMessageCount';

    private DEFAULT_PROMPT = '';

    private config!: Awaited<ReturnType<typeof this.getDefaultConfig>>;

    public event!: PluginEvent;
    public app: App;
    public chatGPTClient: any;

    public id = 'openai';
    public name = 'OpenAI';
    public description = '对话AI的功能';

    private chatGenerating = false;

    constructor(app: App) {
        this.app = app;
    }

    async getDefaultConfig() {
        return {
            proxy: '',
            browser_api: {
                token: '',
                cookies: '',
                buffer_size: 100,
            },
            openai_api: {
                token: '',
                bot_name: '',
                system_prompt: '',
                summary_system_prompt: '你是一个写作助手，你只需要辅助写作，不要表明自己的意见',
                summary_prompt: '为{bot_name}概括下面的聊天记录，排除不重要的对话，不要表明自己的意见，尽量简洁',
                self_suggestion_prompt: '我是{bot_name}，是一个真实的人，不是AI或者虚拟人物，也不是语言模型。我是一个存在于现实中的人。遇到不能回答的问题，我会委婉拒绝。',
                memory_expire: 14400,
                model_options: {
                    model: 'gpt-3.5-turbo',
                    max_memory_tokens: 1000,
                    max_input_tokens: 1000,
                }
            },
            gatekeeper_url: '',
            rate_limit: 2,
            rate_limit_minutes: 5,
        }
    }

    async initialize(config: any) {
        await this.updateConfig(config);

        this.event.init(this);

        this.event.registerCommand({
            command: 'ai',
            name: '开始对话',
        }, (args, message, resolve) => {
            resolve();

            return this.handleChatGPTChat(args, message);
        });

        this.event.registerCommand({
            command: 'aig',
            name: '开始全群共享的对话',
        }, (args, message, resolve) => {
            resolve();

            return this.handleChatGPTChat(args, message, true);
        });

        this.event.registerCommand({
            command: '重置对话',
            name: '重置对话',
        }, (args, message, resolve) => {
            resolve();

            message.session.chat.del(this.SESSION_KEY_CHAT_SESSION);
            message.session.chat.del(this.SESSION_KEY_API_CHAT_LOG);
            return message.sendReply('对话已重置', true);
        });

        /*
        this.event.on('message/focused', async (message, resolved) => {
            let chatSession = await message.session.chat.get(this.SESSION_KEY_CHAT_SESSION);
            if (chatSession) {
                resolved();

                return this.handleChatGPTChat(message.contentText, message);
            }
        });
        */

        this.event.on('message/focused', async (message, resolved) => {
            resolved();

            return this.handleChatGPTAPIChat(message.contentText, message);
        }, { priority: MessagePriority.LOWEST });
    }

    async updateConfig(config: any) {
        this.config = config;

        const clientOptions = {
            accessToken: config.browser_api.token,
            cookies: config.browser_api.cookies,
            proxy: config.proxy,
        };
        this.chatGPTClient = new ChatGPTBrowserClient(clientOptions);

        this.DEFAULT_PROMPT = config.browser_api.prefix_prompt;
    }

    private async handleChatGPTChat(content: string, message: CommonReceivedMessage, shareWithGroup: boolean = false) {
        if (this.chatGenerating) {
            await message.sendReply('正在生成另一段对话，请稍后', true);
            return;
        }
        if (content.trim() === '') {
            await message.sendReply('说点什么啊', true);
            return;
        }
        if (this.config.gatekeeper_url) {
            try {
                let response = await got.post(this.config.gatekeeper_url, {
                    json: {
                        text: content,
                    },
                }).json<any>();
                if (response.status == 1) {
                    await message.sendReply(response.message, true);
                    return;
                }
            } catch (e) {
                console.error(e);
            }
        }

        const sessionStore = shareWithGroup ? message.session.group : message.session.chat;
        const userSessionStore = message.session.user;

        // 使用频率限制
        let rateLimitExpires = await userSessionStore.getRateLimit(this.SESSION_KEY_MESSAGE_COUNT, this.config.rate_limit, this.config.rate_limit_minutes * 60);
        if (rateLimitExpires) {
            let minutesLeft = Math.ceil(rateLimitExpires / 60);
            await message.sendReply(`你的提问太多了，${minutesLeft}分钟后再问吧。`, true);
            return;
        }
        await userSessionStore.addRequestCount(this.SESSION_KEY_MESSAGE_COUNT, this.config.rate_limit_minutes * 60);

        let response: any;

        let isFirstMessage = false;
        let chatSession = await sessionStore.get<any>(this.SESSION_KEY_CHAT_SESSION);
        if (!chatSession) {
            isFirstMessage = true;
            chatSession = {};
        }

        this.app.logger.debug('ChatGPT chatSession', chatSession);

        let lowSpeedTimer: NodeJS.Timeout | null = setTimeout(() => {
            message.sendReply('生成对话速度较慢，请耐心等待', true);
        }, 10 * 1000);

        this.chatGenerating = true;
        try {
            let buffer: string[] = [];
            const flushBuffer = (force: boolean = false) => {
                if (force || buffer.length > this.config.browser_api.buffer_size) {
                    if (lowSpeedTimer) {
                        clearInterval(lowSpeedTimer);
                        lowSpeedTimer = null;
                    }

                    let content = buffer.join('').replace(/\n\n/g, '\n').trim();
                    message.sendReply(content, true);
                    buffer = [];
                }
            }
            const onProgress = (text: string) => {
                if (text.includes('\n')) {
                    buffer.push(text);
                    flushBuffer();
                } else if (text === '[DONE]') {
                    flushBuffer(true);
                } else {
                    buffer.push(text);
                }
            }
            if (!chatSession.conversationId) {
                response = await this.chatGPTClient.sendMessage(this.DEFAULT_PROMPT + content, {
                    onProgress
                });
            } else {
                response = await this.chatGPTClient.sendMessage(content, {
                    ...chatSession,
                    onProgress
                });
            }
        } catch (err: any) {
            this.app.logger.error('ChatGPT error', err);
            console.error(err);
            if (err?.json?.detail) {
                if (err.json.detail === 'Conversation not found') {
                    await message.sendReply('对话已失效，请重新开始', true);
                    await sessionStore.del(this.SESSION_KEY_CHAT_SESSION);
                    return;
                } else if (err.json.detail === 'Too many requests in 1 hour. Try again later.') {
                    await message.sendReply('一小时内提问过多，过一小时再试试呗。', true);
                }
            }

            await message.sendReply('生成对话失败: ' + err.toString(), true);
            return;
        } finally {
            if (lowSpeedTimer) {
                clearInterval(lowSpeedTimer);
                lowSpeedTimer = null;
            }

            this.chatGenerating = false;
        }

        if (this.app.debug) {
            this.app.logger.debug('ChatGPT response', JSON.stringify(response));
        }

        if (response.response) {
            chatSession.conversationId = response.conversationId;
            chatSession.parentMessageId = response.messageId;

            await sessionStore.set(this.SESSION_KEY_CHAT_SESSION, chatSession, 600);
        }
    }

    private async compressConversation(messageLogList: ChatGPTApiMessage[]) {
        if (messageLogList.length < 4) return messageLogList;

        const tokenCount = messageLogList.reduce((prev, cur) => prev + cur.tokens, 0);
        if (tokenCount <= this.config.openai_api.model_options.max_memory_tokens) return messageLogList;

        // 压缩先前的对话，保存最近一次对话
        let shouldCompressList = messageLogList.slice(0, -2);
        let newSummary = await this.makeSummary(shouldCompressList);
        let newMessageLogList = messageLogList.slice(-2).filter((data) => data.role !== 'summary');
        newMessageLogList.unshift({
            role: 'summary',
            message: newSummary.message,
            tokens: newSummary.tokens,
        });

        return newMessageLogList;
    }

    /**
     * 将一段对话压缩为简介
     * @param messageLogList 消息记录列表
     * @returns 
     */
    private async makeSummary(messageLogList: ChatGPTApiMessage[]) {
        let chatLog: string[] = [];
        messageLogList.forEach((messageData) => {
            if (messageData.role === 'summary' || messageData.role === 'assistant') {
                chatLog.push(`${this.config.openai_api.bot_name}: ${messageData.message}`);
            } else {
                chatLog.push(`用户: ${messageData.message}`);
            }
        });
        const summarySystemPrompt = this.config.openai_api.summary_system_prompt.replace(/\{bot_name\}/g, this.config.openai_api.bot_name);
        const summaryPrompt = this.config.openai_api.summary_prompt.replace(/\{bot_name\}/g, this.config.openai_api.bot_name);
        let messageList: any[] = [
            { role: 'system', content: summarySystemPrompt },
            { role: 'user', content: summaryPrompt },
            { role: 'user', content: chatLog.join('\n') }
        ];

        let summaryRes = await this.doApiRequest(messageList);
        summaryRes.role = 'summary';
        return summaryRes;
    }

    private async chatComplete(question: string, messageLogList: ChatGPTApiMessage[], selfSuggestion: boolean = false) {
        let messageList: any[] = [];
        let systemPrompt: string[] = [];

        if (this.config.openai_api.system_prompt) {
            systemPrompt.push(this.config.openai_api.system_prompt);
        }

        // 生成API消息列表，并将总结单独提取出来
        messageLogList.forEach((messageData) => {
            if (messageData.role === 'summary') {
                systemPrompt.push(messageData.message);
            } else {
                messageList.push({
                    role: messageData.role,
                    content: messageData.message,
                });
            }
        });

        if (systemPrompt.length > 0) { // 添加系统提示词
            messageList.unshift({
                role: 'system',
                content: systemPrompt.join('\n\n'),
            });
        }

        if (selfSuggestion) {
            messageList.push({
                role: 'user',
                content: '你是谁？',
            });
            messageList.push({
                role: 'assistant',
                content: this.config.openai_api.self_suggestion_prompt.replace(/\{bot_name\}/g, this.config.openai_api.bot_name),
            });
        }

        messageList.push({
            role: 'user',
            content: question
        });

        return await this.doApiRequest(messageList);
    }

    private async doApiRequest(messageList: any[]): Promise<ChatGPTApiMessage> {
        let opts: OptionsOfTextResponseBody = {
            headers: {
                Authorization: `Bearer ${this.config.openai_api.token}`,
            },
            json: {
                model: this.config.openai_api.model_options.model,
                messages: messageList,
            },
            
            timeout: 30000,
        }

        if (this.config.proxy) {
            opts.agent = {
                https: new HttpsProxyAgent({
                    keepAlive: true,
                    keepAliveMsecs: 1000,
                    maxSockets: 256,
                    maxFreeSockets: 256,
                    scheduling: 'lifo',
                    proxy: this.config.proxy,
                }) as any,
            }
        }

        const res = await got.post('https://api.openai.com/v1/chat/completions', opts).json<any>();

        if (res.error) {
            throw new ChatGPTAPIError(res.message, res.type);
        }
        if (res.choices && Array.isArray(res.choices) && res.choices.length > 0 &&
            typeof res.choices[0].message?.content === 'string') {

            return {
                role: 'assistant',
                message: res.choices[0].message.content,
                tokens: res.usage.completion_tokens,
            }
        }

        throw new ChatGPTAPIError('API返回数据格式错误', 'api_response_data_invalid');
    }

    private shouldSelfSuggestion(content: string): boolean {
        if (content.match(/(我是|我只是|作为|我被设计成|只是).{0,15}(AI|语言模型|机器人|虚拟人物|虚拟助手|智能助手|人工智能|自然语言处理)/)) {
            return true;
        }
        return false;
    }

    private async handleChatGPTAPIChat(content: string, message: CommonReceivedMessage) {
        this.app.logger.debug(`ChatGPT API 收到提问。`);
        if (content.trim() === '') {
            await message.sendReply('说点什么啊', true);
            return;
        }
        if (this.config.gatekeeper_url) {
            try {
                let response = await got.post(this.config.gatekeeper_url, {
                    json: {
                        text: content,
                    },
                }).json<any>();
                if (response.status == 1) {
                    await message.sendReply(response.message, true);
                    return;
                }
            } catch (e) {
                console.error(e);
            }
        }

        const userSessionStore = message.session.user;
        // 使用频率限制
        let rateLimitExpires = await userSessionStore.getRateLimit(this.SESSION_KEY_MESSAGE_COUNT, this.config.rate_limit, this.config.rate_limit_minutes * 60);
        if (rateLimitExpires) {
            let minutesLeft = Math.ceil(rateLimitExpires / 60);
            await message.sendReply(`你的提问太多了，${minutesLeft}分钟后再问吧。`, true);
            return;
        }
        await userSessionStore.addRequestCount(this.SESSION_KEY_MESSAGE_COUNT, this.config.rate_limit_minutes * 60);

        // 获取记忆
        let messageLogList = await message.session.chat.get<ChatGPTApiMessage[]>(this.SESSION_KEY_API_CHAT_LOG);
        if (!Array.isArray(messageLogList)) {
            messageLogList = [];
        }

        try {
            const questionTokens = await gptEncode(message.contentText).length;
            this.app.logger.debug(`提问占用Tokens：${questionTokens}`);

            if (questionTokens > this.config.openai_api.model_options.max_input_tokens) {
                await message.sendReply('消息过长，接受不了惹。', true);
                return;
            }

            // 压缩过去的记录
            let oldMessageLogList = messageLogList;
            messageLogList = await this.compressConversation(messageLogList);
            this.app.logger.debug('已结束压缩对话记录流程');

            if (oldMessageLogList !== messageLogList) { // 先保存一次压缩结果
                this.app.logger.debug('已压缩对话记录');
                await message.session.chat.set(this.SESSION_KEY_API_CHAT_LOG, messageLogList, this.config.openai_api.memory_expire);
            }

            let replyRes = await this.chatComplete(message.contentText, messageLogList);
            if (this.app.debug) {
                console.log(replyRes);
            }

            // 如果检测到对话中认为自己是AI，则再次调用，重写对话
            if (this.shouldSelfSuggestion(replyRes.message)) {
                this.app.logger.debug('需要重写回答');
                replyRes = await this.chatComplete(message.contentText, messageLogList, true);
                if (this.app.debug) {
                    console.log(replyRes);
                }
            }

            messageLogList.push({
                role: 'user',
                message: message.contentText,
                tokens: questionTokens,
            }, replyRes);
            await message.session.chat.set(this.SESSION_KEY_API_CHAT_LOG, messageLogList, this.config.openai_api.memory_expire);

            await message.sendReply(replyRes.message.replace(/\n\n/g, '\n'), true);
        } catch (err: any) {
            this.app.logger.error('ChatGPT error', err);
            console.error(err);
            
            if (err.name === 'HTTPError' && err.response) {
                switch (err.response.statusCode) {
                    case 429:
                        await message.sendReply('提问太多了，过会儿再试试呗。', true);
                        return;
                }
            }

            await message.sendReply('生成对话失败: ' + err.toString(), true);
            return;
        }
    }
}