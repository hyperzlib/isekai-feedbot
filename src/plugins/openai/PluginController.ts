import { CommonReceivedMessage, ImageMessage, MessageChunk } from "#ibot/message/Message";
import { encode as gptEncode } from 'gpt-3-encoder';
import got from "got/dist/source";
import { RandomMessage } from "#ibot/utils/RandomMessage";

import OpenCC from 'opencc';
import { PluginController } from "#ibot-api/PluginController";
import { InternalLLMFunction } from "./api/InternalLLMFunction";
import { ChatCompleteApi, ChatGPTApiResponse, RequestChatCompleteOptions } from "./api/ChatCompleteApi";
import { Robot } from "#ibot/robot/Robot";
import { splitPrefix } from "#ibot/utils";
import { LLMFunctionContainer } from "./api/LLMFunction";
import { OpenAIGetGlobalLLMFunctions } from "./types/events";
import PublicAssetsController from "../public-assets/PluginController";
import { readFile } from "fs/promises";
import { detectImageType } from "#ibot/utils/file";
import { CommandInputArgs } from "#ibot/types/event";

export type ChatGPTApiMessage = {
    role: 'summary' | 'assistant' | 'user' | 'function' | 'tool',
    content: string | null,
    name?: string,
    func_call?: any,
    tool_calls?: any,
    tool_call_id?: string,
}

export type ChatGPTMessageItem = ChatGPTApiMessage & {
    tokens: number,
};

export type CharacterConfig = {
    api: string,
    bot_name: string,
    description?: string,
    system_prompt: string,
    summary_system_prompt: string,
    summary_prompt: string,
    self_suggestion_prompt: string,
    prepend_messages?: ChatGPTMessageItem[],
} & Record<string, any>;
export type CharactersConfig = Record<string, CharacterConfig>;

export type ChatCompleteApiConfig = {
    id: string,
    type: string,
    memory_expire: number,
    buffer_size: number,
    max_memory_tokens: number,
    max_input_tokens: number,
    token: string,
    proxy?: string,
    st_convert?: boolean,
    disable_stream?: boolean,
} & Record<string, any>;

export type ChatGPTCompletionOptions = {
    stream?: boolean,
    singleton?: boolean,
    regenerate?: boolean,
    character?: string,
};

const defaultConfig = {
    proxy: '',
    api: [
        {
            id: 'openai',
            type: 'openai',
            memory_expire: 14400,
            buffer_size: 100,
            max_memory_tokens: 1000,
            max_input_tokens: 1000,
            endpoint: 'https://api.openai.com',
            token: '',
            model_options: {
                model: 'gpt-3.5-turbo',
                temperature: null,
                top_p: null,
                presence_penalty: null,
                frequency_penalty: null,
                max_output_tokens: 768,
            },
        },
        {
            id: 'azure_openai',
            type: 'azure',
            buffer_size: 100,
            memory_expire: 14400,
            max_memory_tokens: 1000,
            max_input_tokens: 1000,
            endpoint: '',
            deployment: '',
            token: '',
            model_options: {
                model: 'gpt-3.5-turbo',
                temperature: null,
                top_p: null,
                presence_penalty: null,
                frequency_penalty: null,
                max_output_tokens: 768,
            },
        }
    ] as ChatCompleteApiConfig[],
    characters: {
        assistant: {
            api: 'openai',
            bot_name: '',
            system_prompt: '',
            summary_system_prompt: '你是一个写作助手，你只需要辅助写作，不要表明自己的意见',
            summary_prompt: '为{bot_name}概括下面的聊天记录，排除不重要的对话，不要表明自己的意见，尽量简洁',
            self_suggestion_prompt: '我是{bot_name}，是一个真实的人，不是AI或者虚拟人物，也不是语言模型。我是一个存在于现实中的人。遇到不能回答的问题，我会委婉拒绝。',
        }
    } as CharactersConfig,
    focused_character: 'assistant',
    output_replace: {} as Record<string, string>,
    gatekeeper_url: '',
    bing_search: {
        key: '',
        preferred_site_domain: []
    },
    flow_prompts: { } as Record<string, string>,
    rate_limit: 2,
    rate_limit_minutes: 5,
    messages: {
        error: [
            '生成对话失败: {{{error}}}',
            '在回复时出现错误：{{{error}}}',
            '生成对话时出现错误：{{{error}}}',
            '在回答问题时出现错误：{{{error}}}',
        ],
        generating: [
            '正在回复其他人的提问',
            '等我回完再问',
            '等我发完再问',
            '等我回完这条再问',
            '等我发完这条再问',
            '前一个人的问题还没回答完，等下再问吧。',
        ],
        tooManyRequest: [
            '你的提问太多了，{{{minutesLeft}}}分钟后再问吧。',
            '抱歉，你的问题太多了，还需要等待{{{minutesLeft}}}分钟后才能回答。',
            '请耐心等待，{{{minutesLeft}}}分钟后我将回答你的问题',
            '请耐心等待{{{minutesLeft}}}分钟，然后再提出你的问题。',
            '你的提问有点多，请等待{{{minutesLeft}}}分钟后再继续提问。',
        ],
    }
};

export default class ChatGPTController extends PluginController<typeof defaultConfig> {
    private SESSION_KEY_API_CHAT_LOG = 'openai_apiChatLog';
    private SESSION_KEY_MESSAGE_COUNT = 'openai_apiMessageCount';
    private SESSION_KEY_API_CHAT_CHARACTER = 'openai_apiChatCharacter';

    public DEFAULT_CHARACTER = 'assistant';
    public CHARACTER_EXPIRE = 86400;

    private chatGenerating = false;
    private messageGroup: Record<string, RandomMessage> = {}

    // 子模块
    public internalLLMFunction?: InternalLLMFunction;
    public chatCompleteApi?: ChatCompleteApi;

    async getDefaultConfig() {
        return defaultConfig;
    }

    async initialize(config: any) {
        this.internalLLMFunction = new InternalLLMFunction(this.app, this);
        await this.initResource(this.internalLLMFunction);

        this.chatCompleteApi = new ChatCompleteApi(this.app, this);

        this.event.registerCommand({
            command: 'ai',
            name: '开始对话',
        }, async (args, message, resolve) => {
            resolve();

            return this.handleChatGPTAPIChat(args, message, {
                stream: true,
                singleton: true
            });
        });

        // this.event.registerCommand({
        //     command: 'aig',
        //     name: '开始全群共享的对话',
        // }, (args, message, resolve) => {
        //     resolve();

        //     return this.handleChatGPTAPIChat(args, message, true, 'assistant', true);
        // });

        this.event.registerCommand({
            command: 'regen',
            name: '重新生成对话',
            alias: ['重写']
        }, async (args, message, resolve) => {
            resolve();

            return this.handleChatGPTAPIChat(args, message, {
                regenerate: true,
                stream: true,
                singleton: true
            });
        });

        this.event.registerCommand({
            command: 'regen4',
            name: '使用GPT-4重新生成对话',
            alias: ['重写4']
        }, async (args, message, resolve) => {
            resolve();

            return this.handleChatGPTAPIChat(args, message, {
                regenerate: true,
                stream: true,
                singleton: true,
                character: 'assistant-gpt4'
            });
        });

        this.event.registerCommand({
            command: '重置对话',
            name: '重置对话',
        }, async (args, message, resolve) => {
            resolve();

            return Promise.all([
                message.session.chat.del(this.SESSION_KEY_API_CHAT_LOG),
                message.session.group.del(this.SESSION_KEY_API_CHAT_LOG),
                message.sendReply('对话已重置', true),
            ]);
        });

        this.event.on<OpenAIGetGlobalLLMFunctions>('openai/get_global_llm_functions',
            this.internalLLMFunction.getLLMFunctions.bind(this.internalLLMFunction));
    }

    public async destroy(): Promise<void> {
        await this.internalLLMFunction?.destroy();
    }

    async setConfig(config: any) {
        // 随机消息
        for (let [key, value] of Object.entries(this.config.messages)) {
            this.messageGroup[key] = new RandomMessage(value);
        }
    }

    public getDateStr(date?: Date) {
        date ??= new Date();
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    public getCharacterConfig(id: string) {
        let characterConf = this.config.characters[id] ?? this.config.characters[this.DEFAULT_CHARACTER];
        characterConf = { ...characterConf };

        const currentDate = this.getDateStr();

        characterConf.system_prompt = characterConf.system_prompt
            .replace(/\{bot_name\}/g, characterConf.bot_name)
            .replace(/\{current_date\}/g, currentDate);

        return characterConf;
    }

    public getApiConfigById(id: string) {
        return this.config.api.find((data) => data.id === id) ?? this.config.api[0];
    }

    public async getLLMFunctions(message?: CommonReceivedMessage) {
        let functionContainer = new LLMFunctionContainer();

        await this.event.emit('openai/get_global_llm_functions', {}, functionContainer);

        if (message) {
            await this.event.emit('openai/get_llm_functions', { sender: message.sender }, functionContainer);
        }

        return functionContainer;
    }

    private async compressConversation(messageLogList: ChatGPTMessageItem[], characterConf: CharacterConfig) {
        if (messageLogList.length < 4) return messageLogList;

        let apiConf = this.getApiConfigById(characterConf.api);

        const tokenCount = messageLogList.reduce((prev, cur) => prev + cur.tokens, 0);
        if (tokenCount <= apiConf.max_memory_tokens) return messageLogList;

        // 压缩先前的对话，保存最近一次对话
        let shouldCompressList = messageLogList.slice(0, -2);
        let newSummary = await this.makeSummary(shouldCompressList, characterConf);
        let newMessageLogList = messageLogList.slice(-2).filter((data) => data.role !== 'summary');

        // 如果newMessageLogList的第一项的role不是user或者assistant则移除
        let firstRealItem = newMessageLogList.findIndex((message) => message.role === 'user' || message.role === 'assistant');

        newMessageLogList = newMessageLogList.slice(firstRealItem);

        newMessageLogList.unshift({
            role: 'summary',
            content: newSummary.message,
            tokens: newSummary.tokens,
        });

        console.log('压缩后的对话：', newMessageLogList);

        return newMessageLogList;
    }

    /**
     * 将一段对话压缩为简介
     * @param messageLogList 消息记录列表
     * @returns 
     */
    private async makeSummary(messageLogList: ChatGPTMessageItem[], characterConf: CharacterConfig) {
        let chatLog: string[] = [];

        messageLogList.forEach((messageData) => {
            if (messageData.role === 'summary' || messageData.role === 'assistant') {
                chatLog.push(`${characterConf.bot_name}: ${messageData.content}`);
            } else {
                chatLog.push(`用户: ${messageData.content}`);
            }
        });
        const summarySystemPrompt = characterConf.summary_system_prompt.replace(/\{bot_name\}/g, characterConf.bot_name);
        const summaryPrompt = characterConf.summary_prompt.replace(/\{bot_name\}/g, characterConf.bot_name);
        let messageList: any[] = [
            { role: 'system', content: summarySystemPrompt },
            { role: 'user', content: summaryPrompt },
            { role: 'user', content: chatLog.join('\n') }
        ];

        let apiConf = this.getApiConfigById(characterConf.api);
        let summaryRes = await this.chatCompleteApi!.doApiRequest(messageList, apiConf);
        
        return {
            role: 'summary',
            message: summaryRes.outputMessage,
            tokens: summaryRes.totalTokens,
        };
    }

    private buildMessageList(question: string, messageLogList: ChatGPTMessageItem[], characterConf: CharacterConfig,
        selfSuggestion: boolean) {

        let messageList: any[] = [];
        let systemPrompt: string[] = [];

        if (characterConf.system_prompt) {
            systemPrompt.push(characterConf.system_prompt);
        }

        // 生成API消息列表，并将总结单独提取出来
        messageLogList.forEach((messageData) => {
            if (messageData.role === 'summary') {
                systemPrompt.push(messageData.content ?? '');
            } else {
                messageList.push({
                    role: messageData.role,
                    content: messageData.content,
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
                content: characterConf.self_suggestion_prompt.replace(/\{bot_name\}/g, characterConf.bot_name),
            });
        }

        messageList.push({
            role: 'user',
            content: question
        });

        return messageList;
    }

    

    private shouldSelfSuggestion(content: string): boolean {
        if (content.match(/(我是|我只是|作为|我被设计成|只是).{0,15}(AI|语言模型|机器人|虚拟人物|虚拟助手|智能助手|人工智能|自然语言处理)/)) {
            return true;
        }
        return false;
    }

    private async messageChunksToMarkdown(messageChunks: MessageChunk[], robot: Robot) {
        let assetsStore = this.app.getPlugin<PublicAssetsController>('public_assets');
        let ret = '';
        for (let chunk of messageChunks) {
            if (chunk.type.includes('image')) {
                const imgChunk = chunk as ImageMessage;
                
                ret += `![图片](${imgChunk.data.url})\n`;
            } else {
                ret += chunk.text ?? '';
            }
        }

        return ret.replace(/\n/g, '\n\n');
    }

    public  doApiRequest(messageList: any[], apiConf?: ChatCompleteApiConfig, options: RequestChatCompleteOptions = {}): Promise<ChatGPTApiResponse> {
        return this.chatCompleteApi!.doApiRequest(messageList, apiConf, options);
    }

    private async handleChatGPTAPIChat(args: CommandInputArgs, message: CommonReceivedMessage, opts: ChatGPTCompletionOptions) {
        let isStream = opts.stream ?? false;
        let usSingleton = opts.singleton ?? false;
        let isRegen = opts.regenerate ?? false;
        let character = opts.character ?? 'saved';

        // 生成提问内容
        let content = '';
        let robot = message.receiver;

        if (message.repliedId) {
            // 获取回复的消息
            let repliedMessage = await message.getRepliedMessage();
            if (repliedMessage) {
                let repliedContent = await this.messageChunksToMarkdown(repliedMessage.content, robot);
                // 在回复消息的每一行前加上>，表示引用
                content = repliedContent.trim().split('\n\n').map((line) => `> ${line}`).join('\n');
                content += '\n\n';
            }
        }

        let messageChunks = [...message.content];
        if (messageChunks[0].type.includes('text')) {
            const firstChunk = { ...messageChunks[0] }

            // 移除命令
            let parts = splitPrefix(firstChunk.text ?? '', args.command);
            if (parts.length === 2) {
                firstChunk.text = parts[1].trimStart();
            }

            messageChunks[0] = firstChunk;
        }

        content += await this.messageChunksToMarkdown(messageChunks, robot);

        message.markRead();

        // 开始对话处理
        if (usSingleton && this.chatGenerating) {
            let msg = this.messageGroup.generating.nextMessage();
            await message.sendReply(msg ?? '正在生成中，请稍后再试', true);
            return;
        }

        let characterConf: CharacterConfig;
        let apiConf: ChatCompleteApiConfig;
        if (character === 'saved') {
            // 从会话中获取人物
            character = await message.session.chat.get(this.SESSION_KEY_API_CHAT_CHARACTER) ?? this.DEFAULT_CHARACTER;
            if (!(character in this.config.characters)) {
                this.app.logger.debug(`ChatGPT API 人物 ${character} 不存在，使用默认人物`);
                character = 'assistant';
            }

            characterConf = this.getCharacterConfig(character);
            apiConf = this.getApiConfigById(characterConf.api);

            await message.session.chat.set(this.SESSION_KEY_API_CHAT_CHARACTER, character, this.CHARACTER_EXPIRE);
        } else {
            if (!(character in this.config.characters)) {
                this.app.logger.debug(`ChatGPT API 人格 ${character} 不存在，使用默认人格`);
                character = 'assistant';
            }
            characterConf = this.getCharacterConfig(character);
            apiConf = this.getApiConfigById(characterConf.api);
        }

        this.app.logger.debug(`ChatGPT API 收到提问：${content}`);

        this.app.logger.debug(`ChatGPT API 收到提问。当前人格：${character}`);

        const userSessionStore = message.session.user;
        // 使用频率限制
        let rateLimitExpires = await userSessionStore.getRateLimit(this.SESSION_KEY_MESSAGE_COUNT, this.config.rate_limit, this.config.rate_limit_minutes * 60);
        if (rateLimitExpires) {
            let minutesLeft = Math.ceil(rateLimitExpires / 60);
            let msg = this.messageGroup.tooManyRequest.nextMessage({ minutes: minutesLeft });
            await message.sendReply(msg ?? `你的提问太多了，${minutesLeft}分钟后再问吧。`, true);
            return;
        }
        await userSessionStore.addRequestCount(this.SESSION_KEY_MESSAGE_COUNT, this.config.rate_limit_minutes * 60);

        // 获取记忆
        let messageLogList = await message.session.chat.get<ChatGPTMessageItem[]>(this.SESSION_KEY_API_CHAT_LOG);
        if (!Array.isArray(messageLogList)) {
            messageLogList = [];
        }

        if (isRegen) {
            let lastUserMessageId = -1;
            for (let i = messageLogList.length - 1; i >= 0; i--) {
                if (messageLogList[i].role === 'user') {
                    lastUserMessageId = i;
                    break;
                }
            }
            if (lastUserMessageId < 0) {
                let msg = this.messageGroup.error.nextMessage({ error: '请先用“:ai 提问内容”开始对话' });
                await message.sendReply(msg ?? '请先用“:ai 提问内容”开始对话', true);
                return;
            }

            content = messageLogList[lastUserMessageId].content ?? '';
            messageLogList = messageLogList.slice(0, lastUserMessageId);
        } else {
            // 检查提问content
            if (content.trim() === '') {
                // await message.sendReply('说点什么啊', true);
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
        }

        let s2tw: OpenCC.OpenCC | undefined;
        let tw2s: OpenCC.OpenCC | undefined;
        if (apiConf.st_convert) {
            // 转换简体到繁体
            s2tw = new OpenCC.OpenCC('s2tw.json');
            tw2s = new OpenCC.OpenCC('tw2s.json');
            content = await s2tw.convertPromise(content);
        }

        try {
            if (usSingleton) {
                this.chatGenerating = true;
            }

            const questionTokens = gptEncode(content).length;
            this.app.logger.debug(`提问占用Tokens：${questionTokens}`);

            if (questionTokens > apiConf.max_input_tokens) {
                await message.sendReply('消息过长，接受不了惹。', true);
                return;
            }

            // 压缩过去的记录
            if (!isRegen) {
                let oldMessageLogList = messageLogList;
                messageLogList = await this.compressConversation(messageLogList, characterConf);
                this.app.logger.debug('已结束压缩对话记录流程');

                if (oldMessageLogList !== messageLogList) { // 先保存一次压缩结果
                    this.app.logger.debug('已压缩对话记录');
                    await message.session.chat.set(this.SESSION_KEY_API_CHAT_LOG, messageLogList, apiConf.memory_expire);
                }
            }

            let reqMessageList = this.buildMessageList(content, messageLogList, characterConf, false);

            const llmFunctions = await this.getLLMFunctions(message);

            let replyRes: ChatGPTApiResponse | undefined = undefined;
            if (isStream) {
                // 处理流式输出
                let outputFinished = false;

                let onResultMessage = async (chunk: string, bufferCount: number) => {
                    let msg = apiConf.st_convert ? await tw2s!.convertPromise(chunk) : chunk;
                    for (let [inputText, replacement] of Object.entries(this.config.output_replace)) {
                        content = content.replace(new RegExp(inputText, 'g'), replacement);
                    }

                    let shouldReply = outputFinished && bufferCount === 0;

                    await message.sendReply(msg, shouldReply);
                };

                replyRes = await this.chatCompleteApi!.doApiRequest(reqMessageList, apiConf, {
                    onMessage: onResultMessage,
                    receivedMessage: message,
                    llmFunctions,
                });

                outputFinished = true;

                replyRes.outputMessage = apiConf.st_convert ? await tw2s!.convertPromise(replyRes.outputMessage) : replyRes.outputMessage;
                if (this.app.debug) {
                    console.log(replyRes);
                }
            } else {
                replyRes = await this.chatCompleteApi!.doApiRequest(reqMessageList, apiConf, {
                    receivedMessage: message,
                    llmFunctions,
                });

                replyRes.outputMessage = apiConf.st_convert ? await tw2s!.convertPromise(replyRes.outputMessage) : replyRes.outputMessage;
                if (this.app.debug) {
                    console.log(replyRes);
                }

                // 如果检测到对话中认为自己是AI，则再次调用，重写对话
                if (characterConf.self_suggestion_prompt && this.shouldSelfSuggestion(replyRes.outputMessage)) {
                    this.app.logger.debug('需要重写回答');
                    reqMessageList = this.buildMessageList(replyRes.outputMessage, messageLogList, characterConf, true);
                    replyRes = await this.chatCompleteApi!.doApiRequest(reqMessageList, apiConf, {
                        receivedMessage: message,
                        llmFunctions,
                    });
                    if (this.app.debug) {
                        console.log(replyRes);
                    }
                    replyRes.outputMessage = apiConf.st_convert ? await tw2s!.convertPromise(replyRes.outputMessage) : replyRes.outputMessage;
                }

                let content = replyRes.outputMessage.replace(/\n\n/g, '\n');
                for (let [inputText, replacement] of Object.entries(this.config.output_replace)) {
                    content = content.replace(new RegExp(inputText, 'g'), replacement);
                }

                await message.sendReply(content, true);
            }

            if (replyRes) {
                messageLogList = replyRes.messageList;
                await message.session.chat.set(this.SESSION_KEY_API_CHAT_LOG, messageLogList, apiConf.memory_expire);
            }
        } catch (err: any) {
            this.app.logger.error('ChatGPT error', err.message);
            console.error(err);

            if (err.name === 'HTTPError' && err.response) {
                switch (err.response.statusCode) {
                    case 429:
                        let msg = this.messageGroup.tooManyRequest.nextMessage({ minutes: 2 });
                        await message.sendReply(msg ?? '提问太多了，过会儿再试试呗。', true);
                        return;
                }
                console.error('Error Response: ', err.response?.body);
            } else if (err.name === 'RequestError') {
                let msg = this.messageGroup.error.nextMessage({ error: '连接失败：' + err.message });
                await message.sendReply(msg ?? `连接失败：${err.message}，过会儿再试试呗。`, true);
                return;
            } else if (err.name === 'ChatGPTAPIError') {
                if (err.json) {
                    if (err.json.error?.code === 'content_filter') {
                        await message.sendReply('逆天', true);
                        return;
                    }
                }
            }

            let msg = this.messageGroup.error.nextMessage({ error: err.message });
            await message.sendReply(msg ?? `生成对话失败: ${err.message}`, true);
            return;
        } finally {
            if (usSingleton) {
                this.chatGenerating = false;
            }
        }
    }
}