import { PluginController } from "#ibot-api/PluginController";
import App from "#ibot/App";
import { CommonReceivedMessage, ImageMessage } from "#ibot/message/Message";
import { MessagePriority, PluginEvent } from "#ibot/PluginManager";
import got from "got/dist/source";

export type QueueData = {
    message: CommonReceivedMessage,
    prompt: string,
};

export type ApiConfig = {
    endpoint: string,
    main?: boolean,
    sampler_name?: string,
    steps?: number,
    trigger_words?: string[],
    negative_prompt?: string,
    banned_words?: string[],
    api_params?: Record<string, any>,
    _banned_words_matcher?: RegExp[],
};

export type SizeConfig = {
    width: number,
    height: number,
    default?: boolean,
    trigger_words?: string[],
};

export type Text2ImgRuntimeOptions = {
    useTranslate?: boolean,
};

export type GPUInfoResponse = {
    name: string,
    memory_total: number,
    memory_used: number,
    memory_free: number,
    load: number,
    temperature: number,
}

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
    }
}

export default class StableDiffusionController extends PluginController<typeof defaultConfig> {
    private SESSION_KEY_GENERATE_COUNT = 'stablediffusion_generateCount';
    
    public chatGPTClient: any;

    public static id = 'stablediffusion';
    public static pluginName = 'Stable Diffusion';
    public static description = '绘画生成';

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
            command: 'draw',
            name: '使用英语短句或关键词生成绘画',
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
    
    public async text2img(prompt: string, message: CommonReceivedMessage, options: Text2ImgRuntimeOptions = {}) {
        const userSessionStore = message.session.user;

        // 使用频率限制
        let rateLimitExpires = await userSessionStore.getRateLimit(this.SESSION_KEY_GENERATE_COUNT, this.config.rate_limit, this.config.rate_limit_minutes * 60);
        if (rateLimitExpires) {
            let minutesLeft = Math.ceil(rateLimitExpires / 60);
            await message.sendReply(`才刚画过呢，${minutesLeft}分钟后再来吧。`, true);
            return;
        }
        await userSessionStore.addRequestCount(this.SESSION_KEY_GENERATE_COUNT, this.config.rate_limit_minutes * 60);

        if (this.queue.length >= this.config.queue_max_size) {
            await message.sendReply('太多人在画了，等一下再来吧。', true);
            return;
        }

        prompt = prompt.trim();
        this.app.logger.debug("收到绘图请求: " + prompt);

        if (options.useTranslate) {
            prompt = await this.translateCaiyunAI(prompt);
            this.app.logger.debug("Prompt翻译结果: " + prompt);
            if (!prompt) {
                await message.sendReply('尝试翻译出错，过会儿再试试吧。', true);
                return;
            }
        }

        let api = this.getMostMatchedApi(prompt);
        // 检查是否有禁用词
        for (let matcher of this.bannedWordsMatcher) {
            if (prompt.match(matcher)) {
                await message.sendReply(`生成图片失败：关键词中包含禁用的内容。`, true);
                return;
            }
        }
        for (let matcher of api._banned_words_matcher!) {
            if (prompt.match(matcher)) {
                await message.sendReply(`生成图片失败：关键词中包含禁用的内容。`, true);
                return;
            }
        }

        this.queue.push({
            message,
            prompt,
        });
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
            this.app.logger.error("无法翻译", e);
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
            this.app.logger.error("无法读取GPU信息", e);
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

    public getMostMatchedApi(prompt: string) {
        let mostMatchedApiIndex = this.getMostMatchedIndex(prompt, this.apiMatcher);
        if (mostMatchedApiIndex >= 0) {
            return this.config.api[mostMatchedApiIndex];
        } else {
            return this.mainApi;
        }
    }

    public getMostMatchedSize(prompt: string) {
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

        this.app.logger.debug("开始生成图片: " + currentTask.prompt);

        let api = this.getMostMatchedApi(currentTask.prompt);
        this.app.logger.debug("使用API: " + api.endpoint);

        let size = this.getMostMatchedSize(currentTask.prompt);
        this.app.logger.debug("使用尺寸: " + size.width + "x" + size.height);

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
                this.app.logger.debug("生成图片成功，开始检查图片内容");

                let image = txt2imgRes.images[0];

                // Check banned words
                let interrogateRes = await got.post(this.mainApi.endpoint + '/sdapi/v1/interrogate', {
                    json: {
                        model: "deepdanbooru",
                        image: image,
                    },
                }).json<any>();

                if (interrogateRes.caption) {
                    let caption = interrogateRes.caption;
                    this.app.logger.debug("DeepDanbooru导出关键字：" + caption);

                    let keywords = caption.split(',').map((keyword: string) => keyword.trim());
                    let bannedKeywords = this.config.banned_words;
                    let bannedOutputKeywords = this.config.banned_output_words;
                    let bannedKeyword = bannedKeywords.find((keyword) => keywords.includes(keyword)) ||
                        bannedOutputKeywords.find((keyword) => keywords.includes(keyword)) ||
                        api.banned_words?.find((keyword) => keywords.includes(keyword));

                    if (bannedKeyword) {
                        await currentTask.message.sendReply(`生成图片失败：图片中包含禁用的 ${bannedKeyword} 内容。`, true);
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
                ], false);
            }
        } catch (e: any) {
            this.app.logger.error("生成图片失败：" + e.message);
            console.error(e);
            await currentTask.message.sendReply('生成图片失败：' + e.message, true);
            return;
        }
    }
}