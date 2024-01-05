import App from "#ibot/App";
import { CommonReceivedMessage } from "#ibot/message/Message";
import { CommandInputArgs, MessagePriority, PluginController, PluginEvent } from "#ibot/PluginManager";
import { encode as gptEncode } from 'gpt-3-encoder';
import got, { OptionsOfTextResponseBody } from "got/dist/source";
import { HttpsProxyAgent } from 'hpagent';
import { ProxyAgent } from 'undici';
import { FetchEventSourceInit, fetchEventSource } from '@waylaidwanderer/fetch-event-source';
import { RandomMessage } from "#ibot/utils/RandomMessage";
import { MessageTypingSimulator } from "#ibot/utils/MessageTypingSimulator";

import OpenCC from 'opencc';

export type ChatGPTLogMessage = {
    role: 'summary' | 'assistant' | 'user',
    message: string,
}

export type ChatGPTApiMessage = ChatGPTLogMessage & {
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
    prepend_messages?: ChatGPTApiMessage[],
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
} & Record<string, any>;

export class ChatGPTAPIError extends Error {
    public code: string;

    constructor(message: string, code: string, public json?: any) {
        super(message);
        this.name = 'ChatGPTAPIError';
        this.code = code;
    }
}

export default class ChatGPTController implements PluginController {
    private SESSION_KEY_API_CHAT_LOG = 'openai_apiChatLog';
    private SESSION_KEY_MESSAGE_COUNT = 'openai_apiMessageCount';
    private SESSION_KEY_API_CHAT_CHARACTER = 'openai_apiChatCharacter';
    private DEFAULT_CHARACTER = 'assistant';
    private CHARACTER_EXPIRE = 86400;

    private config!: Awaited<ReturnType<typeof this.getDefaultConfig>>;

    public event!: PluginEvent;
    public app: App;
    public chatGPTClient: any;

    public id = 'openai';
    public name = 'OpenAI';
    public description = '对话AI的功能';

    private chatGenerating = false;
    private messageGroup: Record<string, RandomMessage> = {}

    constructor(app: App) {
        this.app = app;
    }

    async getDefaultConfig() {
        return {
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
            google_custom_search: {
                cx: '',
                key: '',
                classifier_system_prompt: 'You are a classifier.',
                classifier_prompt: 'To judge whether the following questions are more suitable for searching with a search engine, you only need to answer "yes" or "no" in English.',
                yes: 'Yes',
                no: 'No',
            },
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
        }
    }

    async initialize(config: any) {
        await this.updateConfig(config);

        this.event.init(this);

        this.event.registerCommand({
            command: 'ai',
            name: '开始对话',
        }, async (args, message, resolve) => {
            resolve();

            return this.handleChatGPTAPIChat(args, message, true, 'saved', true);
        });

        // this.event.registerCommand({
        //     command: 'aig',
        //     name: '开始全群共享的对话',
        // }, (args, message, resolve) => {
        //     resolve();

        //     return this.handleChatGPTAPIChat(args, message, true, 'assistant', true);
        // });

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

        // this.event.registerCommand({
        //     command: '切换人物',
        //     name: '切换人物',
        // }, (args, message, resolve) => {
        //     resolve();

        //     return this.handleChangeCharacter(args, message);
        // });
    }

    async updateConfig(config: any) {
        this.config = config;

        // 随机消息
        for (let [key, value] of Object.entries(this.config.messages)) {
            this.messageGroup[key] = new RandomMessage(value);
        }
    }

    private async handleChangeCharacter(args: CommandInputArgs, message: CommonReceivedMessage) {
        message.markRead();

        let character = args.param.trim();
        if (character === '') {
            // 列出所有人物
            let characterList = Object.entries(this.config.characters);
            let currentCharacter = await message.session.chat.get<string>(this.SESSION_KEY_API_CHAT_CHARACTER) ?? this.DEFAULT_CHARACTER;
            let currentCharacterInfo = this.config.characters[currentCharacter] ?? this.config.characters[this.DEFAULT_CHARACTER];
            let msgBuilder = [
                `当前人物: ${currentCharacterInfo.bot_name}，使用方法: “:切换人物 人物ID”`,
                '人物列表：'
            ];
            for (let [name, character] of characterList) {
                if (character.description) {
                    msgBuilder.push(`${name}: ${character.bot_name}, ${character.description}`);
                } else {
                    msgBuilder.push(`${name}: ${character.bot_name}`);
                }
            }
            return message.sendReply(msgBuilder.join('\n'), true);
        }

        if (!(character in this.config.characters)) {
            let msg = this.messageGroup.error.nextMessage({ error: '人物不存在' });
            return message.sendReply(msg ?? '人物不存在', true);
        }

        await message.session.chat.set(this.SESSION_KEY_API_CHAT_CHARACTER, character, this.CHARACTER_EXPIRE);

        let characterInfo = this.config.characters[character];
        
        return message.sendReply(`已切换人物为 ${characterInfo.bot_name}`, true);
    }

    private getApiConfigById(id: string) {
        return this.config.api.find((data) => data.id === id) ?? this.config.api[0];
    }

    private async shouldSearch(question: string) {

    }

    private async googleCustomSearch(question: string) {
        let res = await got.get('https://www.googleapis.com/customsearch/v1', {
            searchParams: {
                key: this.config.google_custom_search.key,
                cx: this.config.google_custom_search.cx,
                q: question,
                num: 1,
                safe: 'on',
                fields: 'items(link)',
            },
        }).json<any>();

        if (res.body.items && res.body.items.length > 0) {

        }
    }

    private async compressConversation(messageLogList: ChatGPTApiMessage[], characterConf: CharacterConfig) {
        if (messageLogList.length < 4) return messageLogList;

        let apiConf = this.getApiConfigById(characterConf.api);

        const tokenCount = messageLogList.reduce((prev, cur) => prev + cur.tokens, 0);
        if (tokenCount <= apiConf.max_memory_tokens) return messageLogList;

        // 压缩先前的对话，保存最近一次对话
        let shouldCompressList = messageLogList.slice(0, -2);
        let newSummary = await this.makeSummary(shouldCompressList, characterConf);
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
    private async makeSummary(messageLogList: ChatGPTApiMessage[], characterConf: CharacterConfig) {
        let chatLog: string[] = [];
        messageLogList.forEach((messageData) => {
            if (messageData.role === 'summary' || messageData.role === 'assistant') {
                chatLog.push(`${characterConf.bot_name}: ${messageData.message}`);
            } else {
                chatLog.push(`用户: ${messageData.message}`);
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
        let summaryRes = await this.doApiRequest(messageList, apiConf);
        summaryRes.role = 'summary';
        return summaryRes;
    }

    private buildMessageList(question: string, messageLogList: ChatGPTApiMessage[], characterConf: CharacterConfig,
        selfSuggestion: boolean) {

        let messageList: any[] = [];
        let systemPrompt: string[] = [];

        if (characterConf.system_prompt) {
            systemPrompt.push(characterConf.system_prompt);
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
                content: characterConf.self_suggestion_prompt.replace(/\{bot_name\}/g, characterConf.bot_name),
            });
        }

        messageList.push({
            role: 'user',
            content: question
        });

        return messageList;
    }

    private getChatCompleteApiUrl(apiConf: ChatCompleteApiConfig): string {
        switch (apiConf.type) {
            case 'openai':
                return `${apiConf.endpoint}/v1/chat/completions`;
            case 'azure':
                return `${apiConf.endpoint}/openai/deployments/${apiConf.deployment}/chat/completions?api-version=2023-05-15`;
        }
        
        throw new Error('Unknown API type: ' + apiConf.type);
    }

    private async doApiRequest(messageList: any[], apiConf: ChatCompleteApiConfig, onMessage?: (chunk: string) => any): Promise<ChatGPTApiMessage> {
        switch (apiConf.type) {
            case 'openai':
            case 'azure':
                return await this.doOpenAILikeApiRequest(messageList, apiConf, onMessage);
        }

        throw new Error('Unknown API type: ' + apiConf.type);
    }

    private async doOpenAILikeApiRequest(messageList: any[], apiConf: ChatCompleteApiConfig, onMessage?: (chunk: string) => any): Promise<ChatGPTApiMessage> {
        let modelOpts = Object.fromEntries(Object.entries({
            model: apiConf.model_options.model,
            temperature: apiConf.model_options.temperature,
            top_p: apiConf.model_options.top_p,
            max_tokens: apiConf.model_options.max_output_tokens,
            presence_penalty: apiConf.model_options.presence_penalty,
            frequency_penalty: apiConf.model_options.frequency_penalty,
        }).filter((data) => data[1]));

        if (onMessage) {
            let opts: FetchEventSourceInit = {
                method: 'POST',
                body: JSON.stringify({
                    ...modelOpts,
                    messages: messageList,
                    stream: true,
                })
            };

            if (apiConf.type === 'openai') {
                opts.headers = {
                    Authorization: `Bearer ${apiConf.token}`,
                    'Content-Type': 'application/json',
                };
            } else if (apiConf.type === 'azure') {
                opts.headers = {
                    "api-key": apiConf.token,
                    "content-type": 'application/json',
                }
            }

            const proxyConfig = apiConf.proxy ?? this.config.proxy;
            if (proxyConfig) {
                (opts as any).dispatcher = new ProxyAgent(proxyConfig);
            }

            let abortController = new AbortController();

            let timeoutTimer = setTimeout(() => {
                abortController.abort();
            }, 30000);

            let buffer: string = '';
            let messageChunk: string[] = [];
            let isStarted = false;
            let isDone = false;
            let prevEvent: any = null;

            let messageTyping = new MessageTypingSimulator();

            messageTyping.on('message', (message: string) => {
                onMessage(message);
            });

            const flush = (force = false) => {
                if (force) {
                    let message = buffer.trim();
                    messageChunk.push(message);
                    messageTyping.pushMessage(message);
                } else {
                    if (buffer.indexOf('\n\n') !== -1 && buffer.length > apiConf.buffer_size) {
                        let splitPos = buffer.indexOf('\n\n');
                        let message = buffer.slice(0, splitPos);
                        messageChunk.push(message);
                        messageTyping.pushMessage(message);
                        buffer = buffer.slice(splitPos + 2);
                    }
                }
            }

            const onClose = () => {
                abortController.abort();
                clearTimeout(timeoutTimer);
            }

            const apiUrl = this.getChatCompleteApiUrl(apiConf);
            this.app.logger.debug(`ChatGPT API 请求地址：${apiUrl}`);

            await fetchEventSource(apiUrl, {
                ...opts,
                signal: abortController.signal,
                onopen: async (openResponse) => {
                    if (openResponse.status === 200) {
                        return;
                    }
                    if (this.app.debug) {
                        console.debug(openResponse);
                    }
                    let error;
                    try {
                        let body = await openResponse.text();
                        if (body.length > 0 && body[0] === '{') {
                            body = JSON.parse(body);
                        }
                        error = new ChatGPTAPIError(`Failed to send message. HTTP ${openResponse.status}`,
                            openResponse.status.toString(), body);
                    } catch {
                        error = error || new Error(`Failed to send message. HTTP ${openResponse.status}`);
                    }
                    throw error;
                },
                onclose: () => {
                    if (this.app.debug) {
                        this.app.logger.debug('Server closed the connection unexpectedly, returning...');
                    }
                    if (!isDone) {
                        if (!prevEvent) {
                            throw new Error('Server closed the connection unexpectedly. Please make sure you are using a valid access token.');
                        }
                        if (buffer.length > 0) {
                            flush(true);
                        }
                    }
                },
                onerror: (err) => {
                    // rethrow to stop the operation
                    throw err;
                },
                onmessage: (eventMessage) => {
                    if (!eventMessage.data || eventMessage.event === 'ping') {
                        return;
                    }

                    if (eventMessage.data === '[DONE]') {
                        flush(true);
                        onClose();
                        isDone = true;
                        return;
                    }

                    try {
                        const data = JSON.parse(eventMessage.data);
                        if ("choices" in data && data["choices"].length > 0) {
                            let choice = data["choices"][0];
                        
                            var delta_content = choice["delta"];
                            if (delta_content["content"]) {
                                var deltaMessage = delta_content["content"];
                        
                                // Skip empty lines before content
                                if (!isStarted) {
                                    if (deltaMessage.replace("\n", "") == "") {
                                        return;
                                    } else {
                                        isStarted = true;
                                    }
                                }
                        
                                buffer += deltaMessage;
                                flush();
                            }
                        }
                        prevEvent = data;
                    } catch (err) {
                        console.debug(eventMessage.data);
                        console.error(err);
                    }
                }
            });

            let message = messageChunk.join('');
            let tokens = gptEncode(message).length;

            return {
                role: 'assistant',
                message,
                tokens
            };
        } else {
            let opts: OptionsOfTextResponseBody = {
                json: {
                    ...modelOpts,
                    messages: messageList,
                },
    
                timeout: 30000,
            };

            if (apiConf.type === 'openai') {
                opts.headers = {
                    Authorization: `Bearer ${apiConf.token}`,
                };
            } else if (apiConf.type === 'azure') {
                opts.headers = {
                    "api-key": apiConf.token,
                }
            }

            const proxyConfig = apiConf.proxy ?? this.config.proxy;
            if (proxyConfig) {
                opts.agent = {
                    https: new HttpsProxyAgent({
                        keepAlive: true,
                        keepAliveMsecs: 1000,
                        maxSockets: 256,
                        maxFreeSockets: 256,
                        scheduling: 'lifo',
                        proxy: proxyConfig,
                    }) as any,
                }
            }

            const apiUrl = this.getChatCompleteApiUrl(apiConf);
            this.app.logger.debug(`ChatGPT API 请求地址：${apiUrl}`);

            const res = await got.post(apiUrl, opts).json<any>();

            if (res.error) {
                throw new ChatGPTAPIError(res.message, res.type);
            }
            if (res.choices && Array.isArray(res.choices) && res.choices.length > 0 &&
                typeof res.choices[0].message?.content === 'string') {
                let completions = res.choices[0].message.content;
                let completion_tokens = res.usage?.completion_tokens ?? gptEncode(completions).length;
                return {
                    role: 'assistant',
                    message: completions,
                    tokens: completion_tokens,
                };
            }

            throw new ChatGPTAPIError('API返回数据格式错误', 'api_response_data_invalid');
        }
    }

    private shouldSelfSuggestion(content: string): boolean {
        if (content.match(/(我是|我只是|作为|我被设计成|只是).{0,15}(AI|语言模型|机器人|虚拟人物|虚拟助手|智能助手|人工智能|自然语言处理)/)) {
            return true;
        }
        return false;
    }

    private async handleChatGPTAPIChat(args: CommandInputArgs, message: CommonReceivedMessage, isStream: boolean = false,
        character = 'assistant', singleMessage = false) {

        message.markRead();

        let content = args.param;
        
        if (singleMessage && this.chatGenerating) {
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
            
            characterConf = this.config.characters[character];
            apiConf = this.getApiConfigById(characterConf.api);

            await message.session.chat.set(this.SESSION_KEY_API_CHAT_CHARACTER, character, this.CHARACTER_EXPIRE);
        } else {
            if (!(character in this.config.characters)) {
                this.app.logger.debug(`ChatGPT API 人格 ${character} 不存在，使用默认人格`);
                character = 'assistant';
            }
            characterConf = this.config.characters[character];
            apiConf = this.getApiConfigById(characterConf.api);
        }

        this.app.logger.debug(`ChatGPT API 收到提问。当前人格：${character}`);
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

        let s2tw: OpenCC.OpenCC | undefined;
        let tw2s: OpenCC.OpenCC | undefined;
        if (apiConf.st_convert) {
            // 转换简体到繁体
            s2tw = new OpenCC.OpenCC('s2tw.json');
            tw2s = new OpenCC.OpenCC('tw2s.json');
            content = await s2tw.convertPromise(content);
        }

        // 获取记忆
        let messageLogList = await message.session.chat.get<ChatGPTApiMessage[]>(this.SESSION_KEY_API_CHAT_LOG);
        if (!Array.isArray(messageLogList)) {
            messageLogList = [];
        }

        try {
            if (singleMessage) {
                this.chatGenerating = true;
            }

            const questionTokens = await gptEncode(content).length;
            this.app.logger.debug(`提问占用Tokens：${questionTokens}`);

            if (questionTokens > apiConf.max_input_tokens) {
                await message.sendReply('消息过长，接受不了惹。', true);
                return;
            }

            // 压缩过去的记录
            let oldMessageLogList = messageLogList;
            messageLogList = await this.compressConversation(messageLogList, characterConf);
            this.app.logger.debug('已结束压缩对话记录流程');

            if (oldMessageLogList !== messageLogList) { // 先保存一次压缩结果
                this.app.logger.debug('已压缩对话记录');
                await message.session.chat.set(this.SESSION_KEY_API_CHAT_LOG, messageLogList, apiConf.memory_expire);
            }

            let reqMessageList = this.buildMessageList(content, messageLogList, characterConf, false);

            let replyRes: ChatGPTApiMessage | undefined = undefined;
            if (isStream) {
                // 处理流式输出
                let onResultMessage = async (chunk: string) => {
                    let msg = apiConf.st_convert ? await tw2s!.convertPromise(chunk) : chunk;
                    for (let [inputText, replacement] of Object.entries(this.config.output_replace)) {
                        content = content.replace(new RegExp(inputText, 'g'), replacement);
                    }
                    await message.sendReply(msg, true);
                };

                replyRes = await this.doApiRequest(reqMessageList, apiConf, onResultMessage);
                replyRes.message = apiConf.st_convert ? await tw2s!.convertPromise(replyRes.message) : replyRes.message;
                if (this.app.debug) {
                    console.log(replyRes);
                }
            } else {
                replyRes = await this.doApiRequest(reqMessageList, apiConf);
                replyRes.message = apiConf.st_convert ? await tw2s!.convertPromise(replyRes.message) : replyRes.message;
                if (this.app.debug) {
                    console.log(replyRes);
                }

                // 如果检测到对话中认为自己是AI，则再次调用，重写对话
                if (characterConf.self_suggestion_prompt && this.shouldSelfSuggestion(replyRes.message)) {
                    this.app.logger.debug('需要重写回答');
                    reqMessageList = this.buildMessageList(replyRes.message, messageLogList, characterConf, true);
                    replyRes = await this.doApiRequest(reqMessageList, apiConf);
                    if (this.app.debug) {
                        console.log(replyRes);
                    }
                    replyRes.message = apiConf.st_convert ? await tw2s!.convertPromise(replyRes.message) : replyRes.message;
                }

                let content = replyRes.message.replace(/\n\n/g, '\n');
                for (let [inputText, replacement] of Object.entries(this.config.output_replace)) {
                    content = content.replace(new RegExp(inputText, 'g'), replacement);
                }
    
                await message.sendReply(content, true);
            }

            if (replyRes) {
                messageLogList.push({
                    role: 'user',
                    message: content,
                    tokens: questionTokens,
                }, replyRes);
                await message.session.chat.set(this.SESSION_KEY_API_CHAT_LOG, messageLogList, apiConf.memory_expire);
            }
        } catch (err: any) {
            this.app.logger.error('ChatGPT error', err);
            console.error(err);

            if (err.name === 'HTTPError' && err.response) {
                switch (err.response.statusCode) {
                    case 429:
                        let msg = this.messageGroup.tooManyRequest.nextMessage({ minutes: 2 });
                        await message.sendReply(msg ?? '提问太多了，过会儿再试试呗。', true);
                        return;
                }
            } else if (err.name === 'RequestError') {
                let msg = this.messageGroup.error.nextMessage({ error: '连接失败：' + err.message });
                await message.sendReply(msg ?? `连接失败：${err.message}，过会儿再试试呗。`, true);
                return;
            }

            let msg = this.messageGroup.error.nextMessage({ error: err.message });
            await message.sendReply(msg ?? `生成对话失败: ${err.message}`, true);
            return;
        } finally {
            if (singleMessage) {
                this.chatGenerating = false;
            }
        }
    }
}