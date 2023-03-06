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

            this.handleChatGPTChat(args, message).catch(console.error);
        });

        this.event.registerCommand({
            command: 'aig',
            name: '开始全群共享的对话',
        }, (args, message, resolve) => {
            resolve();

            this.handleChatGPTChat(args, message, true).catch(console.error);
        });

        this.event.registerCommand({
            command: '重置对话',
            name: '重置对话',
        }, (args, message, resolve) => {
            resolve();

            message.session.chat.del(this.SESSION_KEY_CHAT_SESSION);
            message.session.chat.del(this.SESSION_KEY_API_CHAT_LOG);
            message.sendReply('对话已重置', true);
        });

        /*
        this.event.on('message/focused', async (message, resolved) => {
            let chatSession = await message.session.chat.get(this.SESSION_KEY_CHAT_SESSION);
            if (chatSession) {
                resolved();

                this.handleChatGPTChat(message.contentText, message).catch(console.error);
            }
        });
        */

        this.event.on('message/focused', async (message, resolved) => {
            resolved();

            this.handleChatGPTAPIChat(message.contentText, message).catch(console.error);
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

    private async handleChatGPTChat(content: string, message: CommonReceivedMessage, shareWithGroup: boolean = false) {
        if (this.chatGenerating) {
            message.sendReply('正在生成另一段对话，请稍后', true);
            return;
        }
        if (content.trim() === '') {
            message.sendReply('说点什么啊', true);
            return;
        }

        const sessionStore = shareWithGroup ? message.session.group : message.session.chat;
        let response: any;

        let isFirstMessage = false;
        let chatSession = await sessionStore.get<any>(this.SESSION_KEY_CHAT_SESSION);
        if (!chatSession) {
            isFirstMessage = true;
            chatSession = {};
        }

        this.app.logger.debug('ChatGPT chatSession', chatSession);

        const lowSpeedTimer = setTimeout(() => {
            message.sendReply('生成对话速度较慢，请耐心等待', true);
        }, 10 * 1000);

        this.chatGenerating = true;
        try {
            if (!chatSession.conversationId) {
                response = await this.chatGPTClient.sendMessage(this.DEFAULT_PROMPT + content);
            } else {
                response = await this.chatGPTClient.sendMessage(content, chatSession);
            }
        } catch (err: any) {
            this.app.logger.error('ChatGPT error', err);
            console.error(err);
            if (err?.json?.detail) {
                if (err.json.detail === 'Conversation not found') {
                    message.sendReply('对话已失效，请重新开始', true);
                    await sessionStore.del(this.SESSION_KEY_CHAT_SESSION);
                    return;
                } else if (err.json.detail === 'Too many requests in 1 hour. Try again later.') {
                    message.sendReply('一小时内提问过多，过一小时再试试呗。', true);
                }
            }

            message.sendReply('生成对话失败: ' + err.toString(), true);
            return;
        } finally {
            clearTimeout(lowSpeedTimer);
            this.chatGenerating = false;
        }

        if (this.app.debug) {
            this.app.logger.debug('ChatGPT response', JSON.stringify(response));
        }

        if (response.response) {
            let reply: string = response.response ?? '';
            reply = reply.replace(/\n\n/g, '\n');
            /*
            if (isFirstMessage) {
                reply += '\n\n接下来的对话可以直接回复我。';
            }
            */

            chatSession.conversationId = response.conversationId;
            chatSession.parentMessageId = response.messageId;

            await sessionStore.set(this.SESSION_KEY_CHAT_SESSION, chatSession, 600);

            message.sendReply(reply, true);
        }
    }

    private shouldSelfSuggestion(content: string): boolean {
        if (content.match(/(我是|我只是|作为|我被设计成|只是).{0,15}(AI|语言模型|机器人|虚拟人物|虚拟助手|智能助手|人工智能|自然语言处理程序)/)) {
            return true;
        }
        return false;
    }

    private async handleChatGPTAPIChat(content: string, message: CommonReceivedMessage) {
        this.app.logger.debug(`ChatGPT API 收到提问。`);
        if (content.trim() === '') {
            message.sendReply('说点什么啊', true);
            return;
        }

        let messageLogList = await message.session.chat.get<ChatGPTApiMessage[]>(this.SESSION_KEY_API_CHAT_LOG);
        if (!Array.isArray(messageLogList)) {
            messageLogList = [];
        }

        try {
            const questionTokens = await gptEncode(message.contentText).length;
            this.app.logger.debug(`提问占用Tokens：${questionTokens}`);

            if (questionTokens > this.config.openai_api.model_options.max_input_tokens) {
                message.sendReply('消息过长，接受不了惹。', true);
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

            message.sendReply(replyRes.message.replace(/\n\n/g, '\n'), true);
        } catch (err: any) {
            this.app.logger.error('ChatGPT error', err);
            console.error(err);
            
            if (err.name === 'HTTPError' && err.response) {
                switch (err.response.statusCode) {
                    case 429:
                        message.sendReply('提问太多了，过会儿再试试呗。', true);
                        return;
                }
            }

            message.sendReply('生成对话失败: ' + err.toString(), true);
            return;
        }
    }
}