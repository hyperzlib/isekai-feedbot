import { PluginController } from "#ibot-api/PluginController";
import { CommonReceivedMessage, ImageMessage } from "#ibot/message/Message";
import got from "got/dist/source";
import ChatGPTController from "../openai/PluginController";
import { UserRequestError } from "#ibot-api/error/errors";
import { OpenAIGetLLMFunctions } from "../openai/types/events";

export type QueueData = {
    message: CommonReceivedMessage,
    prompt: string,
    noErrorReply: boolean,
    subjectType?: string,
    paintSize?: string,
    resolve: (extractedPrompt: string) => void,
    reject: (reason: any) => void,
};

export type ApiConfig = {
    endpoint: string,
    main?: boolean,
    sampler_name?: string,
    steps?: number,
    trigger_words?: string[],
    subject_types?: string[],
    append_prompt?: string,
    negative_prompt?: string,
    banned_words?: string[],
    api_params?: Record<string, any>,
    _banned_words_matcher?: RegExp[],
};

export type SizeConfig = {
    id: string,
    width: number,
    height: number,
    default?: boolean,
    trigger_words?: string[],
};

export type Text2ImgRuntimeOptions = {
    useTranslate?: boolean,
    noErrorReply?: boolean,
};

export type GPUInfoResponse = {
    name: string,
    memory_total: number,
    memory_used: number,
    memory_free: number,
    load: number,
    temperature: number,
}

const LLM_PROMPT: string = "Please generate the Stable Diffusion prompt according to the following requirements. The output format is:\n" +
'```{"prompt": "[prompt content]", "size": "(portrait|landscape|avatar)", "subject": "(boy|girl|item|landscape|animal)"}```.\n' +
'The prompt should in simple English. You need to describe the scene in detail. here are some formula for a Stable Diffusion image prompt:' +
' - For characters: An image of [adjective] [subject] with [clothing, earring and accessories] [doing action], [1boy, 1girl, 2boys and then]\n' +
' - For landscapes and items: An image of [subject] with [some creative details]\n' +
'\n' +
'请根据以下要求生成：\n' +
'画{{{prompt}}}';

const defaultConfig = {
    api: [] as ApiConfig[],
    size: [] as SizeConfig[],
    banned_words: [] as string[],
    banned_output_words: [] as string[],
    queue_max_size: 4,
    rate_limit: 1,
    rate_limit_minutes: 2,
    safe_temperature: null as number | null,
    translate_caiyunai: {
        key: ""
    },
}

export default class StableDiffusionController extends PluginController<typeof defaultConfig> {
    private SESSION_KEY_GENERATE_COUNT = 'stablediffusion_generateCount';
    
    public chatGPTClient: any;

    private mainApi!: ApiConfig;
    private defaultSize!: SizeConfig;
    
    private queue: QueueData[] = [];
    private running = true;

    private apiMatcher: RegExp[][] = [];
    private sizeMatcher: RegExp[][] = [];
    private bannedWordsMatcher: RegExp[] = [];

    async getDefaultConfig() {
        return ;
    }

    async initialize(config: any) {
        this.event.registerCommand({
            command: 'paint',
            name: '使用英语短句或关键词生成绘画',
            alias: ['draw'],
        }, (args, message, resolve) => {
            resolve();

            return this.text2img(args.param, message);
        });
        
        this.event.registerCommand({
            command: '画',
            name: '使用中文关键词生成绘画',
        }, (args, message, resolve) => {
            resolve();

            return this.text2img(args.param, message, {
                useTranslate: true
            });
        });

        this.event.registerCommand({
            command: '生成图片信息',
            name: '获取生成的图片信息',
        }, async (args, message, resolve) => {
            if (!message.repliedId) {
                return;
            }

            const repliedMessage = await message.getRepliedMessage();
            if (!repliedMessage?.extra.isStableDiffusionResult) {
                return;
            }

            resolve();

            return message.sendReply(`图片信息：\n` +
                `Prompt: ${repliedMessage.extra.prompt}\n\n` +
                `Negative Prompt: ${repliedMessage.extra.negativePrompt}\n`);
        });

        this.event.on<OpenAIGetLLMFunctions>('openai/get_llm_functions', (_, functios) => {
            functios.register('generate_image', {
                displayName: '生成图片',
                description: '当你想生成图片或者绘画时非常有用。',
                params: [
                    {
                        name: "content",
                        description: "描述需要生成的图片内容。",
                        required: true,
                        schema: { "type": "string" },
                    },
                ],
                callback: this.llmGenerateImage.bind(this),
            });
        });

        const runQueue = async () => {
            await this.runQueue();
            if (this.running) {
                setTimeout(() => {
                    runQueue();
                }, 100);
            }
        }
        runQueue();
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
                width: 512,
                height: 512
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

            if (this.queue.length >= this.config.queue_max_size) {
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

            if (api.append_prompt) {
                prompt += ', ' + api.append_prompt;
            }

            const promise = new Promise<string>((resolve, reject) => {
                this.queue.push({
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

    public async getGPUInfo(): Promise<GPUInfoResponse | null> {
        try {
            let res = await got.get(this.mainApi.endpoint + '/sdapi/v1/gpu-info').json<any>();
            if (res) {
                return res;
            }
        } catch (e) {
            this.logger.error("无法读取GPU信息", e);
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

    public async runQueue() {
        if (!this.running) {
            return;
        }
        if (this.queue.length === 0) {
            return;
        }

        // Wait for GPU to be ready
        let gpuInfo = await this.getGPUInfo();
        if (!gpuInfo) {
            return;
        }
        if (this.config.safe_temperature && gpuInfo.temperature > this.config.safe_temperature) {
            // Wait for GPU to cool down
            return;
        }
        
        // Start generating
        const currentTask = this.queue.shift()!;

        this.logger.debug("开始生成图片: " + currentTask.prompt);

        let api = this.getMostMatchedApi(currentTask.prompt, currentTask.subjectType);
        this.logger.debug("使用API: " + api.endpoint);

        let size = this.getMostMatchedSize(currentTask.prompt, currentTask.paintSize);
        this.logger.debug("使用尺寸: " + size.width + "x" + size.height);

        let extraApiParams = api.api_params ?? {};

        try {
            let txt2imgRes = await got.post(api.endpoint + '/sdapi/v1/txt2img', {
                json: {
                    do_not_save_samples: false,
                    do_not_save_grid: false,
                    ...extraApiParams,
                    prompt: currentTask.prompt,
                    width: size.width,
                    height: size.height,
                    sampler_name: api.sampler_name ?? "Euler a",
                    negative_prompt: api.negative_prompt ?? "",
                    steps: api.steps ?? 28,
                }
            }).json<any>();
            if (Array.isArray(txt2imgRes.images) && txt2imgRes.images.length > 0) {
                this.logger.debug("生成图片成功，开始检查图片内容");

                let image = txt2imgRes.images[0];

                // Check banned words
                let interrogateRes = await got.post(this.mainApi.endpoint + '/sdapi/v1/interrogate', {
                    json: {
                        model: "deepdanbooru",
                        image: image,
                    },
                }).json<any>();

                let caption: string = currentTask.prompt;
                if (interrogateRes.caption) {
                    caption = interrogateRes.caption;
                    this.logger.debug("DeepDanbooru导出关键字：" + caption);

                    let keywords = caption.split(',').map((keyword: string) => keyword.trim());
                    let bannedKeywords = this.config.banned_words;
                    let bannedOutputKeywords = this.config.banned_output_words;
                    let bannedKeyword = bannedKeywords.find((keyword) => keywords.includes(keyword)) ||
                        bannedOutputKeywords.find((keyword) => keywords.includes(keyword)) ||
                        api.banned_words?.find((keyword) => keywords.includes(keyword));

                    if (bannedKeyword) {
                        currentTask.reject(new UserRequestError(`图片中包含禁用的 ${bannedKeyword} 内容。`));
                        
                        if (!currentTask.noErrorReply) {
                            await currentTask.message.sendReply(`生成图片失败：图片中包含禁用的 ${bannedKeyword} 内容。`, true);
                        }
                        return;
                    }
                }
                
                await currentTask.message.sendReply([
                    {
                        type: ['image'],
                        text: '[图片]',
                        data: {
                            url: "base64://" + image,
                        }
                    } as ImageMessage
                ], false, {
                    isStableDiffusionResult: true,
                    prompt: currentTask.prompt,
                    negativePrompt: api.negative_prompt,
                });

                currentTask.resolve(caption);
            }
        } catch (e: any) {
            if (e instanceof UserRequestError) {
                if (!currentTask.noErrorReply) {
                    await currentTask.message.sendReply(e.message, true);
                }
                currentTask.reject(e.message);
            } else {
                this.logger.error("生成图片失败：" + e.message);
                console.error(e);
                if (!currentTask.noErrorReply) {
                    await currentTask.message.sendReply('生成图片失败：' + e.message, true);
                }
                currentTask.reject(e.message);
            }
        }
    }
}