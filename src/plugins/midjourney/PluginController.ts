import { PluginController } from "#ibot-api/PluginController";
import { CommonReceivedMessage, CommonSendMessage, ImageMessage } from "#ibot/message/Message";
import got, { OptionsOfTextResponseBody } from "got/dist/source";
import ChatGPTController from "../openai/PluginController";
import { UserRequestError } from "#ibot-api/error/errors";
import { FetchFn, Midjourney, MJBot, MJConfigParam, MJMessage, NijiBot } from "midjourney";
import { HttpsProxyAgent } from "hpagent";
import WebSocket from "isomorphic-ws";
import { asleep } from "#ibot/utils";
import { CommandInputArgs } from "#ibot/PluginManager";

export type ImagineTaskInfo = {
    message: CommonReceivedMessage,
    prompt: string,
    noErrorReply: boolean,
    subjectType?: string,
    paintSize?: string,
    resolve: () => void,
    reject: (reason: any) => void,
};

export type UpscaleTaskInfo = {
    message: CommonReceivedMessage,
    pickIndex: number,
    apiId: string,
    msgId: string,
    hash: string,
    flags: number,
    noErrorReply: boolean,
    resolve: () => void,
    reject: (reason: any) => void,
};

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
    noErrorReply?: boolean,
};

const LLM_PROMPT: string = "Please generate the Midjourney prompt according to the following requirements. The output format is:\n" +
    '```{"prompt": "[prompt content]", "size": "(portrait|landscape|avatar)", "subject": "(boy|girl|item|landscape|animal)"}```.\n' +
    'The prompt should in simple English. You need to describe the scene in detail. here are some formula for a Midjourney image prompt:' +
    ' - For characters: An image of [adjective] [subject] with [clothing, earring and accessories] [doing action]\n' +
    ' - For landscapes and items: An image of [subject] with [some creative details]\n' +
    '\n' +
    '请根据以下要求生成：\n' +
    '{{{prompt}}}';

const createProxyFetch = (proxyUrl: string): FetchFn => {
    return async (input, init): Promise<Response> => {
        const agent = new HttpsProxyAgent({
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 256,
            maxFreeSockets: 256,
            scheduling: "lifo",
            proxy: proxyUrl,
        });
        if (!init) init = {};
        // @ts-ignore
        init.agent = agent;
        // @ts-ignore
        return fetch(input, init);
    }
}

const createProxyWebSocket = (proxyUrl: string): any => {
    return class WebSocketProxy extends WebSocket {
        constructor(address: any, options: any) {
            const agent = new HttpsProxyAgent({
                keepAlive: true,
                keepAliveMsecs: 1000,
                maxSockets: 256,
                maxFreeSockets: 256,
                scheduling: "lifo",
                proxy: proxyUrl,
            });

            if (!options) options = {};
            options.agent = agent;
            super(address, options);
        }
    }
}

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
}

export default class MidjourneyController extends PluginController<typeof defaultConfig> {
    private SESSION_KEY_GENERATE_COUNT = 'midjourney_generateCount';

    public chatGPTClient: any;

    private mainApi!: ApiConfig;
    private defaultSize!: SizeConfig;

    private clients: Record<string, Midjourney> = {};

    private imagineQueue: ImagineTaskInfo[] = [];
    private upscaleQueue: UpscaleTaskInfo[] = [];
    private running = true;

    private apiMatcher: RegExp[][] = [];
    private sizeMatcher: RegExp[][] = [];
    private bannedWordsMatcher: RegExp[] = [];

    async getDefaultConfig() {
        return;
    }

    async initialize(config: any) {
        this.event.registerCommand({
            command: 'midjourney',
            name: '使用Midjourney生成绘画',
            alias: ['mj', 'imagine']
        }, (args, message, resolve) => {
            resolve();

            return this.text2img(args.param, message, {
                useTranslate: true
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

        const runQueue = async () => {
            while(this.running) {
                await this.runQueue();
                await asleep(100);
            }
        }
        runQueue().catch((e) => console.error(e));
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

    private async getClient(apiConfig: ApiConfig) {
        const token = apiConfig.salai_token;
        if (!this.clients[token]) {
            let botId: any = MJBot;
            // switch (apiConfig.bot_id) {
            //     case 'mj':
            //     case 'midjourney':
            //         botId = MJBot;
            //         break;
            //     case 'nj':
            //     case 'niji':
            //         botId = NijiBot;
            //         break;
            // }

            let options: MJConfigParam = {
                SalaiToken: apiConfig.salai_token,
                BotId: botId,
                ServerId: apiConfig.server_id,
                ChannelId: apiConfig.channel_id,
                Ws: true,
                // Debug: this.app.debug,
            };

            if (apiConfig.proxy) {
                options.fetch = createProxyFetch(apiConfig.proxy);
                options.WebSocket = createProxyWebSocket(apiConfig.proxy);
            }

            const client = new Midjourney(options);

            this.clients[token] = client;
        }

        const client = this.clients[token];
        await client.Connect();

        return client;
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

    public async text2img(prompt: string, message: CommonReceivedMessage, options: Text2ImgRuntimeOptions = {}) {
        try {
            const userSessionStore = message.session.user;

            // 使用频率限制
            let rateLimitExpires = await userSessionStore.getRateLimit(this.SESSION_KEY_GENERATE_COUNT, this.config.rate_limit, this.config.rate_limit_minutes * 60);
            if (rateLimitExpires) {
                let minutesLeft = Math.ceil(rateLimitExpires / 60);
                throw new UserRequestError(`才刚画过呢，${minutesLeft}分钟后再来吧。`);
            }
            await userSessionStore.addRequestCount(this.SESSION_KEY_GENERATE_COUNT, this.config.rate_limit_minutes * 60);

            if (this.imagineQueue.length >= this.config.queue_max_size) {
                throw new UserRequestError('太多人在画了，等一下再来吧。');
            }

            prompt = prompt.trim();
            this.logger.debug("收到绘图请求: " + prompt);

            let paintSize: string | undefined;
            let subjectType: string | undefined;

            let llmApi = this.app.getPlugin<ChatGPTController>('openai');
            if (llmApi) {
                // 使用ChatGPT生成Prompt
                let messageList: any[] = [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: LLM_PROMPT.replace(/\{\{\{prompt\}\}\}/g, prompt) }
                ];

                let replyRes = await llmApi.doApiRequest(messageList);
                if (replyRes.outputMessage) {
                    let reply = replyRes.outputMessage;
                    this.logger.debug(`ChatGPT返回: ${reply}`);
                    let matchedJson = reply.match(/\{.*\}/);
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

            const promise = new Promise<void>((resolve, reject) => {
                this.imagineQueue.push({
                    message,
                    prompt,
                    noErrorReply: !!options.noErrorReply,
                    subjectType,
                    paintSize,
                    resolve,
                    reject,
                });
            });

            return {
                prompt,
                paintSize,
                subjectType,
                promise,
            };
        } catch (err: any) {
            if (err instanceof UserRequestError) {
                if (!options.noErrorReply) {
                    await message.sendReply(err.message, true);
                } else {
                    throw err;
                }
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

            const promise = new Promise<void>((resolve, reject) => {
                this.upscaleQueue.push({
                    message,
                    pickIndex,
                    apiId: repliedMessage.extra.mjApi,
                    msgId: repliedMessage.extra.mjMsgId,
                    hash: repliedMessage.extra.mjHash,
                    flags: repliedMessage.extra.mjFlags,
                    noErrorReply: false,
                    resolve,
                    reject,
                });
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

    private async loadImageFromUrl(url: string, proxy?: string) {
        let options: OptionsOfTextResponseBody = {};
        if (proxy) {
            options.headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
            };
            
            options.agent = {
                https: new HttpsProxyAgent({
                    keepAlive: true,
                    keepAliveMsecs: 1000,
                    maxSockets: 256,
                    maxFreeSockets: 256,
                    scheduling: "lifo",
                    proxy: proxy,
                }),
            }
        }

        let resImage = await got(url, options).buffer();
        
        return resImage;
    }

    private async compressThumb(image: Buffer) {
        try {
            const sharp = await import('sharp');
            let imgObj = sharp.default(image);
            
            const maxSize = 1920;

            let metadata = await imgObj.metadata();
            let imgWidth = metadata.width ?? 2048;
            let imgHeight = metadata.height ?? 2048;

            let targetWidth = 0;
            let targetHeight = 0;

            if (imgWidth > imgHeight) {
                targetWidth = Math.min(imgWidth, maxSize);
                targetHeight = Math.round(targetWidth * imgHeight / imgWidth);
            } else {
                targetHeight = Math.min(imgHeight, maxSize);
                targetWidth = Math.round(targetHeight * imgWidth / imgHeight);
            }

            const thumb = await imgObj.resize(targetWidth, targetHeight).jpeg({ quality: 80 }).toBuffer();

            return thumb;
        } catch(err: any) {
            if (err.code === 'MODULE_NOT_FOUND') {
                this.logger.warn("未安装sharp模块，跳过压缩图片。");
                return image;
            }

            throw err;
        }
    }

    public async runQueue() {
        if (!this.running) {
            return;
        }
        if (this.imagineQueue.length === 0 && this.upscaleQueue.length === 0) {
            return;
        }

        if (this.upscaleQueue.length > 0) {
            // 优先处理放大请求
            const currentTask = this.upscaleQueue.shift()!;

            this.logger.debug("开始放大图片: " + currentTask.msgId);

            let api = this.config.api.find(api => api.id === currentTask.apiId);
            if (!api) {
                await currentTask.message.sendReply('放大图片失败：未找到API', true);
                return;
            }

            try {
                const client = await this.getClient(api);

                let upscaleRes: MJMessage | null = null;
                try {
                    upscaleRes = await client.Upscale({
                        index: currentTask.pickIndex as any,
                        msgId: currentTask.msgId,
                        hash: currentTask.hash,
                        flags: currentTask.flags,
                    });
                } catch (err) {
                    throw err;
                }

                if (!upscaleRes) {
                    await currentTask.message.sendReply('放大图片失败：Upscale对象为空', true);
                    return;
                }

                let imageUrl = upscaleRes.proxy_url ?? upscaleRes.uri;
                let image = await this.loadImageFromUrl(imageUrl, api.proxy);

                await currentTask.message.sendReply([
                    {
                        type: ['image'],
                        text: '[图片]',
                        data: {
                            url: "base64://" + image,
                        }
                    } as ImageMessage
                ], false, {
                    isMidjourneyResult: true,
                    mjType: 'upscale',
                    mjApi: api.id,
                    mjMsgId: upscaleRes.id,
                    mjHash: upscaleRes.hash,
                    mjFlags: upscaleRes.flags,
                });

                currentTask.resolve();
            } catch(e: any) {
                if (e instanceof UserRequestError) {
                    await currentTask.message.sendReply(e.message, true);
                } else {
                    this.logger.error("放大图片失败：" + e.message);
                    console.error(e);
                    await currentTask.message.sendReply('放大图片失败：' + e.message, true);
                }
            }
        } else {
            // Start generating
            const currentTask = this.imagineQueue.shift()!;

            this.logger.debug("开始生成图片: " + currentTask.prompt);

            let api = this.getMostMatchedApi(currentTask.prompt, currentTask.subjectType);
            this.logger.debug("使用API: " + api.id);

            let size = this.getMostMatchedSize(currentTask.prompt, currentTask.paintSize);
            this.logger.debug("使用尺寸: " + size.ratio);

            const prompt = `${currentTask.prompt} --ar ${size.ratio}`;

            try {
                const client = await this.getClient(api);

                let imagineRes: MJMessage | null = null;
                let noticeSent = false;
                try {
                    imagineRes = await client.Imagine(
                        prompt,
                        (uri: string, progress: string) => {
                            if (!noticeSent) {
                                currentTask.message.sendReply('正在生成图片，请稍等。', true).catch(console.error);
                                noticeSent = true;
                            }
                        }
                    );
                } catch (err) {
                    throw err;
                }

                if (!imagineRes) {
                    await currentTask.message.sendReply('生成图片失败：Imagine对象为空', true);
                    return;
                }

                let imageUrl = imagineRes.proxy_url ?? imagineRes.uri;
                let image = await this.loadImageFromUrl(imageUrl, api.proxy);

                image = await this.compressThumb(image);

                await currentTask.message.sendReply([
                    {
                        type: ['image'],
                        text: '[图片]',
                        data: {
                            url: "base64://" + image.toString('base64'),
                        }
                    } as ImageMessage
                ], false, {
                    isMidjourneyResult: true,
                    prompt: currentTask.prompt,
                    mjType: 'imagine',
                    mjApi: api.id,
                    mjMsgId: imagineRes.id,
                    mjHash: imagineRes.hash,
                    mjFlags: imagineRes.flags,
                });

                currentTask.resolve();
            } catch(e: any) {
                if (e instanceof UserRequestError) {
                    if (!currentTask.noErrorReply) {
                        await currentTask.message.sendReply(e.message, true);
                    }
                    // currentTask.reject(e.message);
                } else {
                    this.logger.error("生成图片失败：" + e.message);
                    console.error(e);
                    if (!currentTask.noErrorReply) {
                        await currentTask.message.sendReply('生成图片失败：' + e.message, true);
                    }
                    // currentTask.reject(e.message);
                }
            } finally {
                
            }
        }
    }
}