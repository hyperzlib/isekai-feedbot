import App from "../App";
import { CommonReceivedMessage } from "../message/Message";
import { MessagePriority, PluginController, PluginEvent } from "../PluginManager";
import { ChatGPTBrowserClient, ChatGPTClient } from '@waylaidwanderer/chatgpt-api';

export default class ChatGPTController implements PluginController {
    private SESSION_KEY_CHAT_SESSION = 'openai_chatSession';
    private SESSION_KEY_API_CHAT_SESSION = 'openai_apiChatSession';

    private DEFAULT_PROMPT = '';
    
    private config: any = {};

    public event!: PluginEvent;
    public app: App;
    public chatGPTClient: any;
    public chatGPTApiClient: any;

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
                model_options: {
                    model: 'gpt-3.5-turbo',
                    max_tokens: 1000,
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
            message.session.chat.del(this.SESSION_KEY_API_CHAT_SESSION);
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

        const apiClientOptions = {
            promptPrefix: config.openai_api.system_prompt,
            chatGptLabel: config.openai_api.bot_name,
            proxy: config.proxy,
            modelOptions: config.openai_api.model_options ? {
                model: config.openai_api.model_options.model,
                max_tokens: config.openai_api.model_options.max_tokens,
            } : undefined,
        }
        this.chatGPTApiClient = new ChatGPTClient(config.openai_api.token, apiClientOptions);

        this.DEFAULT_PROMPT = config.browser_api.prefix_prompt;
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
            console.log(response);
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

    private async handleChatGPTAPIChat(content: string, message: CommonReceivedMessage) {
        if (content.trim() === '') {
            message.sendReply('说点什么啊', true);
            return;
        }

        let response: any;

        let isFirstMessage = false;
        let chatSession = await message.session.chat.get<any>(this.SESSION_KEY_API_CHAT_SESSION);
        if (!chatSession) {
            isFirstMessage = true;
            chatSession = {};
        }

        this.app.logger.debug('ChatGPT chatSession', chatSession);

        try {
            if (!chatSession.conversationId) {
                response = await this.chatGPTApiClient.sendMessage(content);
            } else {
                response = await this.chatGPTApiClient.sendMessage(content, chatSession);
            }
        } catch (err: any) {
            this.app.logger.error('ChatGPT error', err);
            console.error(err);
            if (err?.json?.detail) {
                if (err.json.detail === 'Conversation not found') {
                    message.sendReply('对话已失效，请重新开始', true);
                    await message.session.chat.del(this.SESSION_KEY_CHAT_SESSION);
                    return;
                }
            }

            message.sendReply('生成对话失败: ' + err.toString(), true);
            return;
        }

        if (this.app.debug) {
            this.app.logger.debug('ChatGPT response', JSON.stringify(response));
            console.log(response);
        }
        
        if (response.response) {
            let reply: string = response.response ?? '';

            chatSession.conversationId = response.conversationId;
            chatSession.parentMessageId = response.messageId;

            await message.session.chat.set(this.SESSION_KEY_API_CHAT_SESSION, chatSession, 3600);

            message.sendReply(reply, true);
        }
    }
}