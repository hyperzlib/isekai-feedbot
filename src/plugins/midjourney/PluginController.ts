import { PluginController } from "#ibot-api/PluginController";
import { CommonReceivedMessage, CommonSendMessage } from "#ibot/message/Message";
import got from "got/dist/source";
import ChatGPTController from "../openai/PluginController";
import { UserCancelledError, UserRequestError } from "#ibot-api/error/errors";
import { chatIdentityToString, ItemLimitedList, splitPrefix } from "#ibot/utils";
import { MidjourneyApiController, MJModel } from "./api/MidjourneyApiController";
import { BaseSender } from "#ibot/message/Sender";
import { CommandInputArgs } from "#ibot/types/event";

export type ApiConfig = {
    id: string,
    salai_token: string,
    bot_id?: string,
    server_id: string,
    channel_id: string,
    main?: boolean,
    proxy?: string,
    trigger_words?: string[],
    subject_types?: string[],
    banned_words?: string[],
    _banned_words_matcher?: RegExp[],
};

export type SizeConfig = {
    id: string,
    ratio: string,
    default?: boolean,
    trigger_words?: string[],
};

export type Text2ImgRuntimeOptions = {
    useTranslate?: boolean,
    model?: MJModel,
    noErrorReply?: boolean,
};

const LLM_PROMPT: string = "Please generate the Midjourney prompt according to the following requirements. The output format is:\n" +
    '```{"prompt": "[prompt content]", "size": "Must be one of (portrait|landscape|avatar)", "subject": "Must be one of (boy|girl|item|landscape|animal)"}```.\n' +
    'The prompt should in simple English. You just need to output json. You need to describe the scene in detail. here are some formula for a Midjourney image prompt:' +
    ' - For characters: An image of [adjective] [subject] with [clothing, earring and accessories] [doing action]\n' +
    ' - For landscapes and items: An image of [subject] with [some creative details]\n' +
    '\n' +
    '请根据以下要求生成：\n' +
    '{{{prompt}}}';

const defaultConfig = {
    api: [] as ApiConfig[],
    size: [] as SizeConfig[],
    banned_words: [] as string[],
    queue_max_size: 4,
    rate_limit: 1,
    rate_limit_minutes: 2,
    translate_caiyunai: {
        key: ""
    },
    prompt_gen_llm_id: undefined as string | undefined,
    sponsored_users: [] as string[],
}

export default class MidjourneyController extends PluginController<typeof defaultConfig> {
    private SESSION_KEY_GENERATE_COUNT = 'midjourney_generateCount';

    public chatGPTClient: any;
    private mjApi!: MidjourneyApiController;

    private mainApi!: ApiConfig;
    private defaultSize!: SizeConfig;

    private cancelledMessageIds = new ItemLimitedList<string>(100);

    private running = true;

    private apiMatcher: RegExp[][] = [];
    private sizeMatcher: RegExp[][] = [];
    private bannedWordsMatcher: RegExp[] = [];

    async getDefaultConfig() {
        return;
    }

    async initialize(config: any) {
        this.mjApi = new MidjourneyApiController(this.app, this);

        this.event.registerCommand({
            command: 'midjourney',
            name: '使用Midjourney生成绘画',
            alias: ['mj', 'imagine']
        }, (args, message, resolve) => {
            resolve();

            return this.text2img(args, message, {
                useTranslate: true
            });
        });

        this.event.registerCommand({
            command: 'niji',
            name: '使用Nji生成绘画',
            alias: ['nj']
        }, (args, message, resolve) => {
            resolve();

            return this.text2img(args, message, {
                useTranslate: true,
                model: MJModel.Niji
            });
        });

        this.event.registerCommand({
            command: '获取图片',
            name: '从Midjourney生成的图片中获取一张',
        }, async (args, message, resolve) => {
            if (!message.repliedId) {
                return;
            }

            const repliedMessage = await message.getRepliedMessage();
            if (!repliedMessage?.extra.isMidjourneyResult && repliedMessage?.extra.mjType !== 'imagine') {
                return;
            }

            resolve();

            return this.upscaleImage(args, message, repliedMessage as CommonSendMessage);
        });

        this.event.registerCommand({
            command: '以图生图',
            name: '以Midjourney生成的图片中的一张为基础，生成新的图片。',
            alias: ['variant', '图生图']
        }, async (args, message, resolve) => {
            if (!message.repliedId) {
                return;
            }

            const repliedMessage = await message.getRepliedMessage();
            if (!repliedMessage?.extra.isMidjourneyResult && repliedMessage?.extra.mjType !== 'imagine') {
                return;
            }

            resolve();

            return this.variantImage(args, message, repliedMessage as CommonSendMessage);
        });

        this.event.on('deleteMessage', async (message, resolved) => {
            if (message.extra.handler === this.pluginInfo.id && message.extra.reqType === 'text2img') {
                resolved();
                
                message.extra.cancelled = true;
                if (message.id) {
                    this.mjApi.cancelImagineTask(message.id);
                    this.cancelledMessageIds.push(message.id);
                }
            }
        });
    }

    async destroy() {
        this.running = false;
    }

    async setConfig(config: any) {
        let mainApi = this.config.api.find(api => api.main);
        if (!mainApi) {
            throw new Error('No main API found in stablediffusion config.');
        }
        this.mainApi = mainApi;

        let defaultSize = this.config.size.find(size => size.default);
        if (!defaultSize) {
            defaultSize = {
                id: "default",
                ratio: '1:1'
            };
        }
        this.defaultSize = defaultSize;

        this.apiMatcher = [];
        this.config.api.forEach((apiConf) => {
            let matcher: RegExp[] = [];
            apiConf.trigger_words?.forEach((word) => {
                matcher.push(this.makeWordMatcher(word));
            });
            this.apiMatcher.push(matcher);

            apiConf.banned_words ??= [];
            apiConf._banned_words_matcher = apiConf.banned_words.map((word) => this.makeWordMatcher(word));
        });

        this.sizeMatcher = [];
        this.config.size.forEach((sizeConf) => {
            let matcher: RegExp[] = [];
            sizeConf.trigger_words?.forEach((word) => {
                matcher.push(this.makeWordMatcher(word));
            });
            this.sizeMatcher.push(matcher);
        });

        this.bannedWordsMatcher = [];
        this.config.banned_words.forEach((word) => {
            this.bannedWordsMatcher.push(this.makeWordMatcher(word));
        });
    }

    private async llmGenerateImage(params: any, message?: CommonReceivedMessage): Promise<string> {
        if (message) {
            const userRules = await this.app.role.getUserRules(message.sender);
            console.log('userRules', userRules);

            if (!userRules.has('stablediffusion/main')) {
                return "抱歉，该功能未启用。";
            }
        }

        if (!params.content) {
            return "请提供需要生成的图片内容。";
        }

        if (!message) {
            return "此功能只能在聊天中使用。";
        }

        try {
            await message.sendReply('请稍等，我正在为你生成图片。', true);

            let res = await this.text2img(params.content, message, {
                useTranslate: true
            });

            if (!res) {
                return "生成图片失败。";
            }

            let resPrompt = await res.promise;

            return `图片生成成功。图片内容：${resPrompt}。图片已发送给用户。`;
        } catch (e: any) {
            if (!(e instanceof UserRequestError)) {
                this.logger.error(`生成图片失败：${e.message}`);
                console.error(e);
            }

            return `生成图片失败：${e.message}`;
        }
    }

    public async checkSponsoredAndRateLimit(message: CommonReceivedMessage) {
        const chatIdentity = (message.sender as BaseSender).identity;

        let userIdentityStr = chatIdentityToString({
            type:'private',
            robot: chatIdentity.robot,
            userId: chatIdentity.userId,
            userRoles: chatIdentity.userRoles,
        });

        let isSponsored = false;
        if (this.config.sponsored_users.includes(userIdentityStr)) {
            isSponsored = true;
        }

        if (!isSponsored) {
            // 使用频率限制
            const userSessionStore = message.session.user;
            let rateLimitExpires = await userSessionStore.getRateLimit(this.SESSION_KEY_GENERATE_COUNT, this.config.rate_limit, this.config.rate_limit_minutes * 60);
            if (rateLimitExpires) {
                let minutesLeft = Math.ceil(rateLimitExpires / 60);
                throw new UserRequestError(`才刚画过呢，${minutesLeft}分钟后再来吧。`);
            }

            if (this.mjApi.isRelaxQueueBusy) {
                throw new UserRequestError('太多人在画了，等一下再来吧。');
            }
        } else {
            if (this.mjApi.isFastQueueBusy) {
                throw new UserRequestError('太多人在画了，等一下再来吧。');
            }
        }

        return isSponsored;
    }

    public async text2img(input: string | CommandInputArgs, message: CommonReceivedMessage, options: Text2ImgRuntimeOptions = {}) {
        try {
            message.extra.handler = this.pluginInfo.id;
            message.extra.reqType = 'text2img';

            let isSponsored = await this.checkSponsoredAndRateLimit(message);

            let prompt = '';
            let refImage: string | undefined = undefined;

            if (typeof input === 'string') {
                prompt = input;
            } else { // 解析message
                if (message.repliedId) {
                    // 获取回复的消息
                    let repliedMessage = await message.getRepliedMessage();

                    for (const chunk of repliedMessage?.content ?? []) {
                        if (chunk.type.includes('image') && chunk.data.url) {
                            refImage = chunk.data.url;
                        }
                    }
                }

                for (const [i, chunk] of message.content.entries()) {
                    if (chunk.type.includes('text') && chunk.text) {
                        if (i === 0) {
                            prompt = chunk.text ?? '';
                            // 移除命令
                            let parts = splitPrefix(prompt ?? '', input.command);
                            if (parts.length === 2) {
                                prompt = parts[1].trimStart();
                            }
                        } else {
                            prompt += chunk.text;
                        }
                    } else if (chunk.type.includes('image')) {
                        refImage = chunk.data.url;
                    }
                }
            }

            prompt = prompt.trim();

            if (!prompt && !refImage) {
                throw new UserRequestError('请输入绘图内容或提供参考图片。');
            }

            this.logger.debug("收到绘图请求: " + prompt);
            if (refImage) {
                this.logger.debug("参考图片: " + refImage);
            }

            let paintSize: string | undefined;
            let subjectType: string | undefined;
            let isRaw = false;

            let llmApi = this.app.getPlugin<ChatGPTController>('openai');

            if (prompt.includes('--raw')) {
                // 使用原prompt
                prompt = prompt.replace(/--raw ?/g, '').trim();
                subjectType = 'raw';
                isRaw = true;
            } else if (llmApi) {
                // 使用ChatGPT生成Prompt
                let messageList: any[] = [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: LLM_PROMPT.replace(/\{\{\{prompt\}\}\}/g, prompt) }
                ];

                let apiConf = llmApi.getApiConfigById(this.config.prompt_gen_llm_id ?? '');
                let llmFunctions = await llmApi.getLLMFunctions();

                let replyRes = await llmApi.doApiRequest(messageList, apiConf, {
                    llmFunctions,
                });
                if (replyRes.outputMessage) {
                    let reply = replyRes.outputMessage;
                    this.logger.debug(`ChatGPT返回: ${reply}`);
                    let matchedJson = reply.match(/\{[\s\S]*\}/);
                    if (matchedJson) {
                        let promptRes = JSON.parse(matchedJson[0]);
                        if (promptRes) {
                            prompt = promptRes.prompt;
                            paintSize = promptRes.size;
                            subjectType = promptRes.subject;
                            this.logger.debug(`ChatGPT生成Prompt结果: ${prompt}, 画幅: ${paintSize}, 类型: ${subjectType}`);
                        }
                    } else {
                        throw new UserRequestError(`生成Prompt失败: ${reply}`);
                    }
                } else {
                    throw new UserRequestError(`生成Prompt失败: Prompt生成器返回为空`);
                }
            } else if (options.useTranslate) {
                if (prompt.match(/[\u4e00-\u9fa5]/)) {
                    prompt = await this.translateCaiyunAI(prompt);
                    this.logger.debug("Prompt翻译结果: " + prompt);
                    if (!prompt) {
                        throw new UserRequestError('尝试翻译出错，过会儿再试试吧。');
                    }
                } else {
                    this.logger.debug("Prompt不需要翻译");
                }
            }

            let api = this.getMostMatchedApi(prompt, subjectType);
            // 检查是否有禁用词
            for (let matcher of this.bannedWordsMatcher) {
                if (prompt.match(matcher)) {
                    throw new UserRequestError(`生成图片失败：关键词中包含禁止的内容。`);
                }
            }
            for (let matcher of api._banned_words_matcher!) {
                if (prompt.match(matcher)) {
                    throw new UserRequestError(`生成图片失败：关键词中包含禁止的内容。`);
                }
            }

            let mjModel = options.model ?? MJModel.MJ;

            if (message.extra.cancelled || this.cancelledMessageIds.includes(message.id!)) {
                this.logger.debug('用户取消生成图片');
                throw new UserCancelledError();
            }

            // 增加请求计数
            const userSessionStore = message.session.user;
            await userSessionStore.addRequestCount(this.SESSION_KEY_GENERATE_COUNT, this.config.rate_limit_minutes * 60);

            message.sendReply('安排了', true);

            const promise = this.mjApi.imagine({
                message,
                prompt,
                noErrorReply: !!options.noErrorReply,
                subjectType,
                paintSize,
                isRaw,
                model: mjModel,
                relax: !isSponsored,
                refUrl: refImage,
            });

            return {
                prompt,
                paintSize,
                subjectType,
                promise,
            };
        } catch (err: any) {
            if (err.name === 'UserRequestError') {
                if (!options.noErrorReply) {
                    await message.sendReply(err.message, true);
                } else {
                    throw err;
                }
                return;
            } else if (err.name === 'UserCancelledError') {
                return;
            }

            this.logger.error("ChatGPT生成Prompt失败", err);
            console.error(err);

            if (err.name === 'HTTPError' && err.response) {
                switch (err.response.statusCode) {
                    case 429:
                        if (options.noErrorReply) {
                            throw new UserRequestError('API调用过于频繁，请稍后再试');
                        } else {
                            await message.sendReply('太频繁了，过会儿再试试呗。', true);
                            return;
                        }
                    default:
                        console.error(err.response.body);
                        break;
                }
            } else if (err.name === 'RequestError') {
                if (options.noErrorReply) {
                    throw new UserRequestError(`连接失败: ${err.message}`);
                } else {
                    await message.sendReply(`连接失败: ${err.message}，过会儿再试试呗。`, true);
                    return;
                }
            } else if (err.name === 'ChatGPTAPIError') {
                if (err.json) {
                    if (err.json.error?.code === 'content_filter') {
                        if (options.noErrorReply) {
                            throw new UserRequestError('生成图片失败: 请不要发送不适当的内容。');
                        } else {
                            await message.sendReply('逆天', true);
                            return;
                        }
                    }
                }
            }

            if (options.noErrorReply) {
                throw new UserRequestError(`生成图片失败: ${err.message}`);
            } else {
                await message.sendReply(`生成图片失败: ${err.message}`, true);
            }
        }
    }

    public async upscaleImage(args: CommandInputArgs, message: CommonReceivedMessage, repliedMessage: CommonSendMessage) {
        try {
            let pickIndex = parseInt(args.param);
            if (isNaN(pickIndex) && pickIndex < 0 && pickIndex > 4) {
                await message.sendReply('请在1-4之间选择一个图片序号。', true);
            }

            const promise = this.mjApi.upscaleImage({
                message,
                pickIndex,
                apiId: repliedMessage.extra.mjApi,
                msgId: repliedMessage.extra.mjMsgId,
                hash: repliedMessage.extra.mjHash,
                flags: repliedMessage.extra.mjFlags,
                noErrorReply: false,
            });

            return {
                promise,
            };
        } catch (err: any) {
            if (err instanceof UserRequestError) {
                await message.sendReply(err.message, true);
                return;
            }

            this.logger.error("Upscale图片失败", err);
            console.error(err);

            if (err.name === 'HTTPError' && err.response) {
                switch (err.response.statusCode) {
                    case 429:
                        await message.sendReply('太频繁了，过会儿再试试呗。', true);
                        return;
                }
            } else if (err.name === 'RequestError') {
                await message.sendReply(`连接失败: ${err.message}，过会儿再试试呗。`, true);
                return;
            }

            await message.sendReply(`Upscale图片失败: ${err.message}`, true);
        }
    }

    public async variantImage(args: CommandInputArgs, message: CommonReceivedMessage, repliedMessage: CommonSendMessage) {
        try {
            let pickIndex = parseInt(args.param);
            if (isNaN(pickIndex) && pickIndex < 0 && pickIndex > 4) {
                await message.sendReply('请在1-4之间选择一个图片序号。', true);
            }

            let isSponsored = await this.checkSponsoredAndRateLimit(message);

            // 增加请求计数
            const userSessionStore = message.session.user;
            await userSessionStore.addRequestCount(this.SESSION_KEY_GENERATE_COUNT, this.config.rate_limit_minutes * 60);
            
            message.sendReply('安排了', true);

            const promise = this.mjApi.variantImage({
                message,
                pickIndex,
                apiId: repliedMessage.extra.mjApi,
                msgId: repliedMessage.extra.mjMsgId,
                hash: repliedMessage.extra.mjHash,
                flags: repliedMessage.extra.mjFlags,
                relax: !isSponsored,
                noErrorReply: false,
            });

            return {
                promise,
            };
        } catch (err: any) {
            if (err instanceof UserRequestError) {
                await message.sendReply(err.message, true);
                return;
            }

            this.logger.error("Variant图片失败", err);
            console.error(err);

            if (err.name === 'HTTPError' && err.response) {
                switch (err.response.statusCode) {
                    case 429:
                        await message.sendReply('太频繁了，过会儿再试试呗。', true);
                        return;
                }
            } else if (err.name === 'RequestError') {
                await message.sendReply(`连接失败: ${err.message}，过会儿再试试呗。`, true);
                return;
            }

            await message.sendReply(`Upscale图片失败: ${err.message}`, true);
        }
    }

    private makeWordMatcher(word: string) {
        return new RegExp(`([^a-z]|^)${word}([^a-z]|$)`, 'gi');
    }

    private async translateCaiyunAI(text: string) {
        try {
            let res = await got.post('https://api.interpreter.caiyunai.com/v1/translator', {
                json: {
                    source: [text],
                    trans_type: "auto2en",
                    request_id: "sd",
                    media: "text",
                    detect: true,
                    replaced: true
                },
                headers: {
                    'content-type': 'application/json',
                    'x-authorization': `token ${this.config.translate_caiyunai.key}`
                }
            }).json<any>();
            if (res.target && res.target.length > 0) {
                return res.target[0];
            }
        } catch (e) {
            this.logger.error("无法翻译", e);
            console.error(e);
        }
        return null;
    }

    public getMostMatchedIndex(prompt: string, matchers: RegExp[][]) {
        let matchCount = matchers.map(() => 0);
        for (let i = 0; i < matchers.length; i++) {
            matchers[i].forEach((matcher) => {
                let matched = prompt.matchAll(matcher);
                matchCount[i] += Array.from(matched).length;
            });
        }
        let maxMatchCount = Math.max(...matchCount);
        if (maxMatchCount > 0) {
            return matchCount.indexOf(maxMatchCount);
        }
        return -1;
    }

    public getMostMatchedApi(prompt: string, subjectType?: string) {
        if (subjectType) {
            for (let api of this.config.api) {
                if (api.subject_types?.includes(subjectType)) {
                    return api;
                }
            }
            this.logger.warn("未找到匹配类型 " + subjectType + " 的API");
        }

        let mostMatchedApiIndex = this.getMostMatchedIndex(prompt, this.apiMatcher);
        if (mostMatchedApiIndex >= 0) {
            return this.config.api[mostMatchedApiIndex];
        } else {
            return this.mainApi;
        }
    }

    public getMostMatchedSize(prompt: string, paintSize?: string) {
        if (paintSize) {
            let size = this.config.size.find(size => size.id === paintSize);
            if (size) {
                return size;
            } else {
                this.logger.warn("未找到匹配尺寸 " + paintSize);
            }
        }

        let mostMatchedSizeIndex = this.getMostMatchedIndex(prompt, this.sizeMatcher);
        if (mostMatchedSizeIndex >= 0) {
            return this.config.size[mostMatchedSizeIndex];
        } else {
            return this.defaultSize;
        }
    }
}