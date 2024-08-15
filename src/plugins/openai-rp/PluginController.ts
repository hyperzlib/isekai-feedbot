import { CommonReceivedMessage } from "#ibot/message/Message";
import { MessagePriority } from "#ibot/PluginManager";
import { encode as gptEncode } from 'gpt-3-encoder';
import got, { OptionsOfTextResponseBody } from "got/dist/source";
import { HttpsProxyAgent } from 'hpagent';
import { RandomMessage } from "#ibot/utils/RandomMessage";

import { PluginController } from "#ibot-api/PluginController";
import { ChatIdentity } from "#ibot/message/Sender";
import { CommandInputArgs } from "#ibot/types/event";

export type OpenAILogMessage = {
    role: 'summary' | 'assistant' | 'user',
    message: string,
}

export type OpenAIApiMessage = OpenAILogMessage & {
    appendMessage?: string,
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
    prepend_messages?: OpenAIApiMessage[],
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

export type OpenAICompletionOptions = {
    singleton?: boolean,
    regenerate?: boolean,
    character?: string,
};

export class OpenAIAPIError extends Error {
    public code: string;

    constructor(message: string, code: string, public json?: any) {
        super(message);
        this.name = 'OpenAIAPIError';
        this.code = code;
    }
}

export type FunctionCallingResponse = {
    message: string,
    directOutput?: boolean,
};

export type FunctionCallingDefinition = {
    displayName?: string,
    description: string,
    params?: any[],
    callback?: (params: any, message: CommonReceivedMessage | null) => Promise<string | FunctionCallingResponse>,
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
        default: {
            api: 'openai',
            bot_name: '',
            system_prompt: '',
            summary_system_prompt: 'You are a helpful assistant.',
            summary_prompt: '为{bot_name}概括下面的聊天记录，排除不重要的对话，不要表明自己的意见，尽量简洁',
            self_suggestion_prompt: '我是{bot_name}，是一个真实的人，不是AI或者虚拟人物，也不是语言模型。我是一个存在于现实中的人。遇到不能回答的问题，我会委婉拒绝。',
        }
    } as CharactersConfig,
    output_replace: {} as Record<string, string>,
    gatekeeper_url: '',
    bing_search: {
        key: '',
        preferred_site_domain: []
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
};

export default class OpenAIRPController extends PluginController<typeof defaultConfig> {
    private SESSION_KEY_API_CHAT_LOG = 'openai_rp_chatLog';
    private SESSION_KEY_MESSAGE_COUNT = 'openai_rp_messageCount';
    private SESSION_KEY_API_CHAT_CHARACTER = 'openai_rp_chatCharacter';
    private DEFAULT_CHARACTER = 'default';
    private CHARACTER_EXPIRE = 86400;
    
    public chatGPTClient: any;

    private chatGenerating = false;
    private messageGroup: Record<string, RandomMessage> = {}

    public llmFunctions: Record<string, FunctionCallingDefinition> = {};
    
    async getDefaultConfig() {
        return defaultConfig;
    }

    async initialize(config: any) {
        this.event.registerCommand({
            command: '重开',
            alias: ['重置聊天', 'remake'],
            name: '重置聊天',
        }, async (args, message, resolve) => {
            resolve();

            return Promise.all([
                message.session.chat.del(this.SESSION_KEY_API_CHAT_LOG),
                message.sendReply('对话已重置', true),
            ]);
        });

        this.event.registerCommand({
            command: '切换人物',
            name: '切换人物',
        }, (args, message, resolve) => {
            resolve();

            return this.handleChangeCharacter(args, message);
        });

        this.event.on('message/focused', async (message, resolve) => {
            if (message.repliedId && message.id) {
                let repliedMessage = await message.getRepliedMessage();
                if (repliedMessage) {
                    if (!repliedMessage.extra?.isOpenAIRPRepleid) {
                        // 不回复其他控制器发出的消息
                        return;
                    }

                    if ((repliedMessage.receiver as ChatIdentity)?.userId !== message.sender.userId) {
                        // 不回复其他人的消息
                        return;
                    }
                }
            }

            resolve();

            return this.handleOpenAIAPIChat(message.contentText, message, {
                singleton: false,
            });
        }, {
            priority: MessagePriority.LOW
        });

        this.initLLMFuntions();
    }

    async setConfig(config: any) {
        // 随机消息
        for (let [key, value] of Object.entries(this.config.messages)) {
            this.messageGroup[key] = new RandomMessage(value);
        }
    }

    public initLLMFuntions() {
        this.llmFunctions.search = {
            displayName: '在线搜索',
            description: '使用此工具可以在互联网上搜索信息。使用JSON格式传递参数。',
            params: [
                {
                    "name": "keywords",
                    "description": "需要搜索的关键词。",
                    "required": true,
                    "schema": {"type": "string"},
                },
            ],
            callback: this.searchOnWeb.bind(this),
        };

        this.llmFunctions.ban_user = {
            displayName: '封禁用户',
            description: '在用户多次触犯道德准则时，使用此工具可以封禁用户。',
            params: [],
            callback: this.banUser.bind(this),
        }
    }

    private async handleChangeCharacter(args: CommandInputArgs, message: CommonReceivedMessage) {
        message.markRead();

        let character = args.param.trim();
        if (character === '') {
            // 列出所有人物
            let characterList = Object.entries(this.config.characters);
            let currentCharacter = await message.session.chat.get<string>(this.SESSION_KEY_API_CHAT_CHARACTER) ?? this.DEFAULT_CHARACTER;
            let currentCharacterInfo = this.getCharacterConfig(currentCharacter);
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

    private getDateStr(date?: Date) {
        date ??= new Date();
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private getCharacterConfig(id: string) {
        let characterConf = this.config.characters[id] ?? this.config.characters[this.DEFAULT_CHARACTER];
        characterConf = {...characterConf};

        const currentDate = this.getDateStr();

        characterConf.system_prompt = characterConf.system_prompt
            .replace(/\{bot_name\}/g, characterConf.bot_name)
            .replace(/\{current_date\}/g, currentDate);

        return characterConf;
    }

    private getApiConfigById(id: string) {
        return this.config.api.find((data) => data.id === id) ?? this.config.api[0];
    }

    private async banUser(params: any, message: CommonReceivedMessage | null) {
        return '已封禁用户';
    }

    private async searchOnWeb(params: any): Promise<string> {
        const MAX_RESULTS = 3;
        let keywords = params.keywords ?? '';
        try {
            let res = await got.get('https://api.bing.microsoft.com/v7.0/search', {
                headers: {
                    "Ocp-Apim-Subscription-Key": this.config.bing_search.key,
                },
                searchParams: {
                    q: keywords,
                    answerCount: 1,
                    safeSearch: 'Strict',
                    textFormat: 'Raw'
                },
            }).json<any>();

            if (res.webPages && res.webPages?.value.length > 0) {
                const allSearchResults: any[] = res.webPages.value;
                let searchResults: any[] = [];

                allSearchResults.sort((a, b) => {
                    return b.snippet.length - a.snippet.length;
                });

                if (this.config.bing_search.preferred_site_domain?.length) {
                    const preferredSiteDomain = this.config.bing_search.preferred_site_domain;
                    searchResults = allSearchResults.filter((data) => {
                        return preferredSiteDomain.some((domain) => data.url.includes(domain));
                    });

                    searchResults = searchResults.slice(0, MAX_RESULTS);
                }

                while (searchResults.length < MAX_RESULTS) {
                    let result = allSearchResults.shift();
                    if (!result) break;
                    searchResults.push(result);
                }

                let searchResultsText = searchResults.map((item, index) => {
                    return `  ${index + 1}. 【${item.name}】: ${item.snippet}`;
                });

                return '在互联网上搜索到以下内容：\n' + searchResultsText.join('\n');
            }

            return '未搜索到相关结果';
        } catch (e: any) {
            if (e.response?.body?.error) {
                return '无法访问网络搜索API，错误：' + e.response.body.error.message;
            } else if (e.message) {
                return '无法访问网络搜索API，错误：' + e.message;
            }
            return '无法访问网络搜索API';
        }
    }

    private async compressConversation(message: CommonReceivedMessage | null, messageLogList: OpenAIApiMessage[], characterConf: CharacterConfig) {
        if (messageLogList.length < 4) return messageLogList;

        let apiConf = this.getApiConfigById(characterConf.api);

        const tokenCount = messageLogList.reduce((prev, cur) => prev + cur.tokens, 0);
        if (tokenCount <= apiConf.max_memory_tokens) return messageLogList;

        // 压缩先前的对话，保存最近一次对话
        let shouldCompressList = messageLogList.slice(0, -2);
        let newSummary = await this.makeSummary(message, shouldCompressList, characterConf);
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
    private async makeSummary(message: CommonReceivedMessage | null, messageLogList: OpenAIApiMessage[], characterConf: CharacterConfig) {
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
        let [summaryRes, _] = await this.doApiRequest(message, messageList, false, apiConf);
        summaryRes.role = 'summary';
        return summaryRes;
    }

    private buildMessageList(question: string, messageLogList: OpenAIApiMessage[], characterConf: CharacterConfig,
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
            case 'qwen':
                return `${apiConf.endpoint}/v1/chat/completions`;
            case 'azure':
                return `${apiConf.endpoint}/openai/deployments/${apiConf.deployment}/chat/completions?api-version=2023-05-15`;
        }
        
        throw new Error('Unknown API type: ' + apiConf.type);
    }

    private getOpenAPIFunctionDefinition(apiType: string = 'openai') {
        return Object.entries(this.llmFunctions).map(([key, data]) => {
            let openaiFuncDef: any = {
                name: key,
                description: data.description,
                parameters: data.params,
            };

            if (apiType === 'qwen') {
                if (openaiFuncDef.displayName) {
                    openaiFuncDef.name_for_human = data.displayName;
                }
            }

            return openaiFuncDef;
        });
    }

    private async handleLLMFunctions(functionName: string, params: any, message: CommonReceivedMessage | null): Promise<FunctionCallingResponse> {
        let func = this.llmFunctions[functionName];
        if (!func) {
            return { message: '未找到对应的功能。' };
        }

        if (typeof params === 'string') {
            params = params.trim();
            if (params.startsWith('{') && params.endsWith('}')) {
                try {
                    params = JSON.parse(params);
                } catch (e) {
                    return { message: '参数格式错误。' };
                }
            }
        }

        if (func.callback) {
            const response = await func.callback(params, message);
            if (typeof response === 'string') {
                return {
                    message: response
                };
            } else {
                return response;
            }
        }

        return { message: '此功能暂未实现。' };
    }

    public async doApiRequest(message: CommonReceivedMessage | null, messageList: any[], functionCalling: boolean = true, apiConf?: ChatCompleteApiConfig,
            onMessage?: (content: string) => any): Promise<[OpenAIApiMessage, any[]]> {
        if (!apiConf) {
            let characterConf = this.getCharacterConfig(this.DEFAULT_CHARACTER);
            apiConf = this.getApiConfigById(characterConf.api);
        }

        switch (apiConf.type) {
            case 'openai':
            case 'azure':
            case 'qwen':
                return await this.doOpenAILikeApiRequest(message, messageList, functionCalling, apiConf, onMessage);
        }

        throw new Error('Unknown API type: ' + apiConf.type);
    }

    public async doOpenAILikeApiRequest(message: CommonReceivedMessage | null, messageList: any[], functionCalling: boolean = true, apiConf: ChatCompleteApiConfig,
            onMessage?: (content: string) => any): Promise<[OpenAIApiMessage, any[]]> {
        let modelOpts = Object.fromEntries(Object.entries({
            model: apiConf.model_options.model,
            temperature: apiConf.model_options.temperature,
            top_p: apiConf.model_options.top_p,
            max_tokens: apiConf.model_options.max_output_tokens,
            presence_penalty: apiConf.model_options.presence_penalty,
            frequency_penalty: apiConf.model_options.frequency_penalty,
        }).filter((data) => data[1]));

        if (functionCalling) {
            modelOpts.functions = this.getOpenAPIFunctionDefinition(apiConf.type);
        }

        messageList = [...messageList];

        let opts: OptionsOfTextResponseBody = {
            json: {
                ...modelOpts,
                messages: messageList,
            },

            timeout: 60000,
        };

        if (apiConf.type === 'openai') {
            opts.headers = {
                Authorization: `Bearer ${apiConf.token}`,
            };
        } else if (apiConf.type === 'azure') {
            opts.headers = {
                "api-key": apiConf.token,
            }
        } else if (apiConf.type === 'qwen') {
            if (apiConf.token) {
                let [qwenUser, qwenPass] = apiConf.token.split(':');
                opts.username = qwenUser;
                opts.password = qwenPass;
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

        let prevDirectOutput: string | null = null;
        const apiUrl = this.getChatCompleteApiUrl(apiConf);
        this.app.logger.debug(`OpenAI API 请求地址：${apiUrl}`);

        for (let i = 0; i < 4; i ++) {
            const res = await got.post(apiUrl, opts).json<any>();

            if (res.error) {
                throw new OpenAIAPIError(res.message, res.type);
            }
            if (res.choices && Array.isArray(res.choices) && res.choices.length > 0) {
                const firstChoice = res.choices[0];
                if (firstChoice.finish_reason === 'function_call') {
                    if (typeof firstChoice.message?.content === 'string') {
                        onMessage?.(firstChoice.message.content);
                    }

                    if (prevDirectOutput) {
                        onMessage?.(prevDirectOutput);
                        prevDirectOutput = null;
                    }

                    if (firstChoice.message?.function_call) {
                        const funcName = firstChoice.message.function_call.name;
                        const funcParams = firstChoice.message.function_call.arguments;

                        const funcResponse = await this.handleLLMFunctions(funcName, funcParams, message);

                        messageList.push({
                            role: 'assistant',
                            content: firstChoice.message.content,
                            func_call: firstChoice.message.function_call
                        }, {
                            role: 'function',
                            content: funcResponse.message,
                        });

                        if (funcResponse.directOutput) {
                            prevDirectOutput = funcResponse.message;
                        }
                    }
                } else if (typeof firstChoice.message?.content === 'string') {
                    let completions = res.choices[0].message.content;
                    let completion_tokens = res.usage?.completion_tokens ?? gptEncode(completions).length;

                    const completeRes: OpenAIApiMessage = {
                        role: 'assistant',
                        message: completions,
                        tokens: completion_tokens,
                    };
                    if (prevDirectOutput) {
                        completeRes.appendMessage = prevDirectOutput;
                    }

                    let newMessageList = messageList.splice(messageList.length);

                    return [completeRes, newMessageList];
                } else {
                    throw new OpenAIAPIError('API返回数据格式错误', 'api_response_data_invalid');
                }
            }
        }

        throw new OpenAIAPIError('API返回数据格式错误', 'api_response_data_invalid');
    }

    private shouldSelfSuggestion(content: string): boolean {
        if (content.match(/(我是|我只是|作为|我被设计成|只是).{0,15}(AI|语言模型|机器人|虚拟人物|虚拟助手|智能助手|人工智能|自然语言处理)/)) {
            return true;
        }
        return false;
    }

    private async handleOpenAIAPIChat(question: string, message: CommonReceivedMessage, opts: OpenAICompletionOptions) {
        let usSingleton = opts.singleton ?? false;
        let isRegen = opts.regenerate ?? false;
        let character = opts.character ?? 'saved';

        message.markRead();
        
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
                this.app.logger.debug(`OpenAI API 人物 ${character} 不存在，使用默认人物`);
                character = 'assistant';
            }
            
            characterConf = this.getCharacterConfig(character);
            apiConf = this.getApiConfigById(characterConf.api);

            await message.session.chat.set(this.SESSION_KEY_API_CHAT_CHARACTER, character, this.CHARACTER_EXPIRE);
        } else {
            if (!(character in this.config.characters)) {
                this.app.logger.debug(`OpenAI API 人格 ${character} 不存在，使用默认人格`);
                character = 'assistant';
            }
            characterConf = this.getCharacterConfig(character);
            apiConf = this.getApiConfigById(characterConf.api);
        }

        this.app.logger.debug(`OpenAI API 收到提问。当前人格：${character}`);

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
        let messageLogList = await message.session.chat.get<OpenAIApiMessage[]>(this.SESSION_KEY_API_CHAT_LOG);
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
                let msg = this.messageGroup.error.nextMessage({ error: '请先开始对话' });
                await message.sendReply(msg ?? '请先开始对话', true);
                return;
            }

            question = messageLogList[lastUserMessageId].message;
            messageLogList = messageLogList.slice(0, lastUserMessageId);
        } else {
            // 检查提问content
            if (question.trim() === '') {
                // await message.sendReply('说点什么啊', true);
                return;
            }

            if (this.config.gatekeeper_url) {
                try {
                    let response = await got.post(this.config.gatekeeper_url, {
                        json: {
                            text: question,
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
        
        try {
            if (usSingleton) {
                this.chatGenerating = true;
            }

            const questionTokens = gptEncode(question).length;
            this.app.logger.debug(`提问占用Tokens：${questionTokens}`);

            if (questionTokens > apiConf.max_input_tokens) {
                await message.sendReply('消息过长，接受不了惹。', true);
                return;
            }

            // 压缩过去的记录
            if (!isRegen) {
                let oldMessageLogList = messageLogList;
                messageLogList = await this.compressConversation(message, messageLogList, characterConf);
                this.app.logger.debug('已结束压缩对话记录流程');

                if (oldMessageLogList !== messageLogList) { // 先保存一次压缩结果
                    this.app.logger.debug('已压缩对话记录');
                    await message.session.chat.set(this.SESSION_KEY_API_CHAT_LOG, messageLogList, apiConf.memory_expire);
                }
            }

            let reqMessageList = this.buildMessageList(question, messageLogList, characterConf, false);

            let replyRes: OpenAIApiMessage | undefined = undefined;
            let resMessageList: any[] = messageLogList;
            [replyRes, resMessageList] = await this.doApiRequest(message, reqMessageList, true, apiConf);
            replyRes.message = replyRes.message;
            if (this.app.debug) {
                console.log(replyRes);
            }

            // 如果检测到对话中认为自己是AI，则再次调用，重写对话
            if (characterConf.self_suggestion_prompt && this.shouldSelfSuggestion(replyRes.message)) {
                this.app.logger.debug('需要重写回答');
                reqMessageList = this.buildMessageList(replyRes.message, messageLogList, characterConf, true);
                [replyRes, resMessageList] = await this.doApiRequest(message, reqMessageList, true, apiConf);
                if (this.app.debug) {
                    console.log(replyRes);
                }
                replyRes.message = replyRes.message;
            }

            let repliedContent = replyRes.message.replace(/\n\n/g, '\n');
            for (let [inputText, replacement] of Object.entries(this.config.output_replace)) {
                repliedContent = repliedContent.replace(new RegExp(inputText, 'g'), replacement);
            }

            let sentMessage = await message.sendReply(repliedContent, true, {
                isOpenAIRPRepleid: true,
            });

            if (replyRes) {
                messageLogList.push(
                    {
                        role: 'user',
                        message: question,
                        tokens: questionTokens,
                    },
                    ...resMessageList,
                    replyRes
                );
                await message.session.chat.set(this.SESSION_KEY_API_CHAT_LOG, messageLogList, apiConf.memory_expire);
            }
        } catch (err: any) {
            this.app.logger.error('OpenAI error', err.message);
            console.error(err, err.response);

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
            } else if (err.name === 'OpenAIAPIError') {
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