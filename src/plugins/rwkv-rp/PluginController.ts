import { CommonReceivedMessage } from "#ibot/message/Message";
import { MessagePriority } from "#ibot/PluginManager";
import { encode as gptEncode } from 'gpt-3-encoder';
import got, { OptionsOfTextResponseBody } from "got/dist/source";
import { HttpsProxyAgent } from 'hpagent';
import { RandomMessage } from "#ibot/utils/RandomMessage";
import { ChatIdentity } from "#ibot/message/Sender";
import { PluginController } from "#ibot-api/PluginController";
import { CommandInputArgs } from "#ibot/types/event";

export type CharacterConfig = {
    api_id: string,
    rwkv_character: string,
    bot_name: string,
    description?: string,
} & Record<string, any>;
export type CharactersConfig = Record<string, CharacterConfig>;

export type DefaultCharacterConfig = {
    id: string,
    robot?: string,
    group?: string,
};

export type ChatCompleteApiConfig = {
    id: string,
    buffer_size: number,
    max_input_tokens: number,
    api_token: string,
    endpoint: string,
} & Record<string, any>;

export type FunctionCallingExtras = {
    apiConf: ChatCompleteApiConfig,
    characterConf: CharacterConfig,
    apiUserName: string,
    userToken: string,
}

export type FunctionCallingResponse = {
    result_message?: string,
    result_prompt?: string,
};

export class RWKVAPIError extends Error {
    public code: string;

    constructor(message: string, code: string, public json?: any) {
        super(message);
        this.name = 'RWKVAPIError';
        this.code = code;
    }
}

const defaultConfig = {
    proxy: '',
    api: [
        {
            id: 'default',
            buffer_size: 100,
            max_input_tokens: 1000,
            endpoint: 'http://127.0.0.1:8888',
            api_token: '',
            model_options: {
                min_len: 0,
                temperature: 2,
                top_p: 0.65,
                presence_penalty: 0.2,
                frequency_penalty: 0.2,
            },
        },
    ] as ChatCompleteApiConfig[],
    characters: {
        default: {
            api_id: 'default',
            rwkv_character: '',
            bot_name: '',
        }
    } as CharactersConfig,
    default_characters: [
        {
            id: 'default'
        }
    ] as DefaultCharacterConfig[],
    output_replace: {} as Record<string, string>,
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

export default class RWKVRolePlayingController extends PluginController<typeof defaultConfig> {
    private SESSION_KEY_MESSAGE_COUNT = 'rwkv_rp_apiMessageCount';
    private SESSION_KEY_API_CHAT_CHARACTER = 'rwkv_rp_apiChatCharacter';
    private SESSION_KEY_API_RESET_LOCK = 'rwkv_rp_apiResetLock';
    private SESSION_KEY_USER_TOKEN = 'rwkv_rp_userToken';
    private SESSION_KEY_BAN_USER = 'rwkv_rp_banUser';
    private CHARACTER_EXPIRE = 86400;
    private BAN_EXPIRE = 600;

    private globalDefaultCharacter: string = '';

    private chatGenerating = false;
    private messageGroup: Record<string, RandomMessage> = {};

    public llmFunctions: Record<string, CallableFunction> = {};

    async getDefaultConfig() {
        return defaultConfig;
    }

    async initialize() {
        this.event.registerCommand({
            command: '重开',
            alias: ['重置聊天', 'remake'],
            name: '重置聊天',
        }, async (args, message, resolve) => {
            resolve();

            return this.handleResetCurrentCharacter(args, message);
        });

        this.event.registerCommand({
            command: '切换人物',
            name: '切换人物',
        }, async (args, message, resolve) => {
            resolve();

            return this.handleChangeCharacter(args, message);
        });

        this.event.on('message/focused', async (message, resolve) => {
            if (message.repliedId && message.id) {
                let repliedMessage = await message.getRepliedMessage();
                if (repliedMessage) {
                    if (!repliedMessage.extra?.isRWKVReply) {
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

            return this.handleChatCompleteRequest(message.contentText, message, 'saved', false);
        }, {
            priority: MessagePriority.LOW
        });

        // 内置LLM函数
        this.llmFunctions.ban_user = this.funcBanUser.bind(this);
    }

    getJWTPayload(jwtToken: string) {
        const chunks = jwtToken.split('.');
        if (chunks.length !== 3) {
            throw new Error('Invalid JWT');
        }
        const payload = chunks[1];
        return JSON.parse(Buffer.from(payload, 'base64').toString());
    }

    async setConfig(config: any) {
        // 随机消息
        for (let [key, value] of Object.entries(this.config.messages)) {
            this.messageGroup[key] = new RandomMessage(value);
        }

        // 全局默认用户
        this.globalDefaultCharacter = this.config.default_characters.find((data) => !data.robot && !data.group)?.id ?? '';
    }

    private async funcBanUser(params: any, message: CommonReceivedMessage, result_message: string, extras: FunctionCallingExtras) {
        this.logger.info(`RWKV 模型已提出封禁用户：${message.sender.userId}`)
        await message.session.user.set(this.SESSION_KEY_BAN_USER, '1', this.BAN_EXPIRE);
        // 同时重置人格
        try {
            await this.apiChatReset(extras.userToken, extras.apiConf, extras.characterConf);
        } catch (err: any) {
            this.app.logger.error('RWKV Reset character error', err);
            console.error(err);
        }
    }

    private getDefaultCharacter(message: CommonReceivedMessage): string {
        let senderIdentity: ChatIdentity | undefined = message.sender?.identity;
        if (!senderIdentity || senderIdentity.type === 'private') {
            return this.globalDefaultCharacter;
        }

        let robotId = senderIdentity.robot.robotId;
        let groupId = senderIdentity.groupId;

        if (robotId && groupId) {
            return this.config.default_characters.find((data) => data.robot === robotId && data.group === groupId)?.id ??
                this.globalDefaultCharacter;
        } else {
            return this.globalDefaultCharacter;
        }
    }

    private async handleChangeCharacter(args: CommandInputArgs, message: CommonReceivedMessage) {
        message.markRead();

        let character = args.param.trim();
        if (character === '') {
            // 列出所有人物
            let characterList = Object.entries(this.config.characters);
            let currentCharacter = await message.session.chat.get<string>(this.SESSION_KEY_API_CHAT_CHARACTER) ?? this.getDefaultCharacter(message);
            let currentCharacterInfo = this.config.characters[currentCharacter] ?? this.config.characters[this.getDefaultCharacter(message)];
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

        await message.session.user.set(this.SESSION_KEY_API_CHAT_CHARACTER, character, this.CHARACTER_EXPIRE);

        let characterInfo = this.config.characters[character];

        return message.sendReply(`已切换人物为 ${characterInfo.bot_name}`, true);
    }

    private async handleResetCurrentCharacter(args: CommandInputArgs, message: CommonReceivedMessage) {
        // 从会话中获取人物
        let character = await message.session.chat.get<string>(this.SESSION_KEY_API_CHAT_CHARACTER) ?? this.getDefaultCharacter(message);
        if (!(character in this.config.characters)) {
            this.app.logger.debug(`RWKV API 人物 ${character} 不存在，使用默认人物`);
            character = 'assistant';
        }

        let characterConf = this.config.characters[character];
        let apiConf = this.getApiConfigById(characterConf.api_id);

        try {
            const apiUserName = this.getApiUserName(message);
            let userToken = await message.session.user.get<string>(this.SESSION_KEY_USER_TOKEN);
            if (!userToken) {
                userToken = await this.userLogin(apiUserName, apiConf, message);
            }

            await this.apiChatReset(userToken, apiConf, characterConf);

            await message.sendReply('我重开了', true);
        } catch (err: any) {
            this.app.logger.error('RWKV chat reset error', err);
            console.error(err);
            await message.sendReply(`重开失败: ${err.message}`, true);
        }
    }

    private getApiConfigById(id: string) {
        return this.config.api.find((data) => data.id === id) ?? this.config.api[0];
    }

    private getApiUserName(message: CommonReceivedMessage) {
        return `${message.receiver.robotId}_${message.sender.userId}`;
    }

    private applyProxy(opts: OptionsOfTextResponseBody, apiConf: ChatCompleteApiConfig) {
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
    }

    private handleOutputReplace(content: string) {
        for (let [key, value] of Object.entries(this.config.output_replace)) {
            let regex = new RegExp(key, 'g');
            content = content.replace(regex, value);
        }
        return content;
    }

    private async userLogin(userName: string, apiConf: ChatCompleteApiConfig, message: CommonReceivedMessage): Promise<string> {
        let opts: OptionsOfTextResponseBody = {
            json: {
                user_name: userName,
                api_token: apiConf.api_token
            }
        };
        this.applyProxy(opts, apiConf);

        const apiUrl = `${apiConf.endpoint}/login`;
        try {
            const res = await got.post(apiUrl, opts).json<any>();


            const token = res.data?.token;

            if (!token) {
                throw new RWKVAPIError('API返回数据格式错误', 'api_response_data_invalid');
            }

            const payload = this.getJWTPayload(token);
            const expire = Math.round(payload.exp - (Date.now() / 1000)) - 1;

            await message.session.user.set(this.SESSION_KEY_USER_TOKEN, token, expire);

            return res.data?.token;
        } catch (err: any) {
            if (err.name === 'HTTPError' && err.response) {
                if (err.response.body) {
                    const body = JSON.parse(err.response.body);
                    if (body.error) {
                        throw new RWKVAPIError(body.message, body.code, body);
                    }
                }
            }
            throw err;
        }
    }

    private async apiChatReset(userToken: string, apiConf: ChatCompleteApiConfig, characterConf: CharacterConfig) {
        let opts: OptionsOfTextResponseBody = {
            json: {
                character_name: characterConf.rwkv_character,
            },
            timeout: 60000,
            headers: {
                Authorization: `Bearer ${userToken}`,
            }
        };
        this.applyProxy(opts, apiConf);

        const apiUrl = `${apiConf.endpoint}/chat/reset`;

        try {
            await got.post(apiUrl, opts).json<any>();
        } catch (err: any) {
            if (err.name === 'HTTPError' && err.response) {
                if (err.response.body) {
                    const body = JSON.parse(err.response.body);
                    if (body.error) {
                        throw new RWKVAPIError(body.message, body.code, body);
                    }
                }
            }
            throw err;
        }
    }

    private async apiChatComplete(userName: string, userToken: string, nickName: string, question: string, apiConf: ChatCompleteApiConfig,
        characterConf: CharacterConfig, receivedMessage: CommonReceivedMessage, tryLogin = true): Promise<string> {
        let modelOpts = Object.fromEntries(Object.entries({
            min_len: apiConf.model_options.min_len,
            temperature: apiConf.model_options.temperature,
            top_p: apiConf.model_options.top_p,
            presence_penalty: apiConf.model_options.presence_penalty,
            frequency_penalty: apiConf.model_options.frequency_penalty,
        }).filter((data) => data[1]));

        let opts: OptionsOfTextResponseBody = {
            json: {
                ...modelOpts,
                character_name: characterConf.rwkv_character,
                chat_user_name: nickName,
                prompt: question,
            },
            timeout: 60000,
            headers: {
                Authorization: `Bearer ${userToken}`,
            }
        };
        this.applyProxy(opts, apiConf);

        const apiUrl = `${apiConf.endpoint}/chat/complete`;
        this.app.logger.debug(`RWKV API 请求地址：${apiUrl}`);

        try {
            const res = await got.post(apiUrl, opts).json<any>();

            if (res.data?.reply) {
                return res.data.reply;
            }
        } catch (err: any) {
            if (err.name === 'HTTPError' && err.response) {
                switch (err.response.statusCode) {
                    case 401:
                        if (tryLogin) {
                            await this.userLogin(userName, apiConf, receivedMessage);
                            return await this.apiChatComplete(userName, userToken, nickName, question, apiConf, characterConf, receivedMessage, false);
                        }
                        break;
                    default:
                        if (err.response.body) {
                            const body = JSON.parse(err.response.body);
                            if (body.error) {
                                throw new RWKVAPIError(body.message, body.code, body);
                            }
                        }
                }
            }
            throw err;
        }

        throw new RWKVAPIError('API返回数据格式错误', 'api_response_data_invalid');
    }

    private async handleChatCompleteRequest(content: string, message: CommonReceivedMessage, character = 'assistant', singleMessage = false) {
        message.markRead();

        if (singleMessage && this.chatGenerating) {
            let msg = this.messageGroup.generating.nextMessage();
            await message.sendReply(msg ?? '正在生成中，请稍后再试', true);
            return;
        }

        // 检测用户是否被ban
        if (await message.session.user.get<string>(this.SESSION_KEY_BAN_USER)) {
            await message.sendReply('哼', true);
            return;
        }

        let characterConf: CharacterConfig;
        let apiConf: ChatCompleteApiConfig;
        if (character === 'saved') {
            // 从会话中获取人物
            character = await message.session.user.get<string>(this.SESSION_KEY_API_CHAT_CHARACTER) ?? this.getDefaultCharacter(message);
            if (!(character in this.config.characters)) {
                this.app.logger.debug(`RWKV API 人物 ${character} 不存在，使用默认人物`);
                character = this.globalDefaultCharacter;
            }

            characterConf = this.config.characters[character];
            apiConf = this.getApiConfigById(characterConf.api_id);

            await message.session.user.set(this.SESSION_KEY_API_CHAT_CHARACTER, character, this.CHARACTER_EXPIRE);
        } else {
            if (!(character in this.config.characters)) {
                this.app.logger.debug(`RWKV API 人格 ${character} 不存在，使用默认人格`);
                character = this.globalDefaultCharacter;
            }
            characterConf = this.config.characters[character];
            apiConf = this.getApiConfigById(characterConf.api_id);
        }

        this.app.logger.debug(`RWKV API 收到提问。当前人格：${character}`);
        if (content.trim() === '') {
            // await message.sendReply('说点什么啊', true);
            return;
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

        try {
            if (singleMessage) {
                this.chatGenerating = true;
            }

            const questionTokens = gptEncode(content).length;
            this.app.logger.debug(`提问占用Tokens：${questionTokens}`);

            if (questionTokens > apiConf.max_input_tokens) {
                await message.sendReply('消息过长，接受不了惹。', true);
                return;
            }

            const apiUserName = this.getApiUserName(message);
            let userToken = await userSessionStore.get<string>(this.SESSION_KEY_USER_TOKEN);
            if (!userToken) {
                userToken = await this.userLogin(apiUserName, apiConf, message);
            }

            // 自动重置对话
            let resetLock = await userSessionStore.get<string>(this.SESSION_KEY_API_RESET_LOCK);
            if (!resetLock) {
                try {
                    await this.apiChatReset(userToken, apiConf, characterConf);
                } catch (err: any) {
                    this.app.logger.error('RWKV Reset character error', err);
                    console.error(err);
                }
            }
            await userSessionStore.set(this.SESSION_KEY_API_RESET_LOCK, '1', this.CHARACTER_EXPIRE);

            let userNickName = message.sender.displayName ?? '用户';

            let replyRes: string | null = null;
            let funcCallExtras: FunctionCallingExtras = {
                characterConf,
                apiConf,
                apiUserName,
                userToken,
            };
            for (let i = 0; i < 3; i ++) {
                // 处理function calling
                replyRes = await this.apiChatComplete(apiUserName, userToken, userNickName,
                    content, apiConf, characterConf, message);
                if (this.app.debug) {
                    console.log(replyRes);
                }

                if (!replyRes) {
                    break;
                }

                let funcCallStr = replyRes.match(/````(\{.*?\})````/);
                let funcCallResult: FunctionCallingResponse | null = null;
                if (funcCallStr) {
                    this.logger.debug(`处理 RWKV 函数调用：${funcCallStr[1]}`)
                    let funcParams: any = {};
                    try {
                        funcParams = JSON.parse(funcCallStr[1]);
                    } catch(e) {
                        this.logger.warn('RWKV function calling parse error', e);
                        break;
                    }
                    if (funcParams.call) {
                        let funcName = funcParams.call;
                        if (funcName in this.llmFunctions) {
                            const func = this.llmFunctions[funcName];
                            funcCallResult = await func(funcParams, message, replyRes, funcCallExtras);
                        } else {
                            funcCallResult = {
                                result_message: '抱歉，此功能暂不可用'
                            };
                        }
                    }
                }

                if (!funcCallResult || !funcCallResult.result_prompt) {
                    // 如果没有返回结果，或者返回结果为空，则停止继续生成
                    let funcCallStrReplace = funcCallResult?.result_message ?? '';
                    replyRes = replyRes.replace(/````(\{.*?\})````/g, funcCallStrReplace);
                    break;
                }
            }

            if (replyRes) {
                // 输出替换
                replyRes = this.handleOutputReplace(replyRes.trim()).trim();
                console.log('RWKV: ', replyRes);

                let sentMessage = await message.sendReply(replyRes, true, {
                    isRWKVReply: true
                });
            }
        } catch (err: any) {
            this.app.logger.error('RWKV error', err);
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