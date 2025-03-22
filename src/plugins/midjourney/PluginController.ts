import { PluginController } from "#ibot-api/PluginController";
import { CommonReceivedMessage, CommonSendMessage } from "#ibot/message/Message";
import Handlebars from "handlebars";
import * as fs from 'fs';
import got from "got/dist/source";
import ChatGPTController from "../openai/PluginController";
import { UserCancelledError, UserRequestError } from "#ibot-api/error/errors";
import { chatIdentityToString, ItemLimitedList, splitPrefix } from "#ibot/utils";
import { MidjourneyApiController, MJModel } from "./api/MidjourneyApiController";
import { BaseSender } from "#ibot/message/Sender";
import { CommandInputArgs } from "#ibot/types/event";
import { loadMessageImage } from "#ibot/utils/file";
import { DashScopeMultiModelMessageItem } from "../openai/api/ChatCompleteApi";

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
    refPrompt?: string,
};

export class MidjourneyContentFilterError extends UserRequestError {
    constructor(message: string) {
        super(message);
        this.name = 'MidjourneyContentFilterError';
    }
}

export type ImageRefScope = 'character' | 'full_scene' | 'style' | 'prompt_only';

const LLM_PROMPT = `Please generate the Midjourney prompt according to the following requirements.

# Output Format:
Output should be a JSON object with the following fields:

## prompt:
The prompt should in simple English, describe the scene in as much detail as possible. You just need to output json. You need to describe the scene in detail.

** Guidelines for creating the prompt: **
 - **Characters**: an image of [adjective] [subject] with [clothing, earring and accessories] [doing action]
 - **Landscapes, items, and animals**: an image of [subject] with [some creative details]
 - For multiple entities in the scene, separate each entity with ".". Example: "an image of [adjective] [subject] with [clothing, earring and accessories] [doing action]. [adjective] [subject] with [clothing, earring and accessories] [doing action]. [some scene]"

## size:
 - portrait: A portrait image. For example, vertical screen pictures taken by mobile phone.
 - landscape: A horizontal picture.
 - avatar: A square image, usually used as a profile picture.

## subject: 
 - character: Image mainly showing characters.
 - item: Image mainly showing items.
 - landscape: Image mainly showing landscapes.
 - animal: Image mainly showing animals or fantasy creatures.
{{#if image_prompt}}

## reference_scope:
 - character: Generate an image that contains main character of the reference image. Usually use this option. If User just wants to modify something on the reference image, don't use this option.
 - full_scene: Generate an image that is compositionally similar to a reference image. Only used when there are no characters in the reference image, or user wants to modify something.
 - style: Generate an image that has same style as the reference image.
{{/if}}

# Output example:
{{#if image_prompt}}
\`\`\`{"prompt": "an image of ...", "size": "landscape", "subject": "character", "reference_scope": "main_part"}\`\`\`.
{{else}}
\`\`\`{"prompt": "an image of ...", "size": "landscape", "subject": "character"}\`\`\`.
{{/if}}

## Error output format:
If the user prompt contains content related to real-world politics or pornography, stop generating it and return a error message.
However, fictional political plots that not related with real politicians are allowed. (e.g. fantasy medieval, DND, science fiction)

Format: \`\`\`{"error": {"code": "content_filter", "message": "The prompt contains inappropriate content."}}\`\`\`.

{{#if image_prompt}}
# User provided reference image:
{{#if old_prompt}}
prompt used when generating reference image: {{{old_prompt}}}
{{/if}}
Recognized image content: {{{image_prompt}}}
{{/if}}

# User input:
{{{prompt}}}`;

const buildLLMPrompt = Handlebars.compile(LLM_PROMPT);

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
    fast_queue_timeout_minutes: 5,
    relax_queue_timeout_minutes: 12,
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
            if (!repliedMessage) {
                await message.sendReply('未找到原始图片信息，请回复由Midjourney生成的四格图消息。', true);
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
            if (!repliedMessage) {
                await message.sendReply('未找到原始图片信息，请回复由Midjourney生成的四格图消息。', true);
                this.logger.debug('未找到原始图片信息：' + message.repliedId);
                return;
            }

            resolve();

            return this.variantImage(args, message, repliedMessage as CommonSendMessage);
        });

        this.event.on('deleteMessage', async (message, resolved) => {
            if (message.extra.handler === this.pluginInfo.id && message.extra.reqType === 'text2img') {
                resolved();

                console.log('typeof message.id: ', typeof message.id);

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
            type: 'private',
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

            return await this.generateImageFromPrompt(message, prompt, refImage, !isSponsored, options);
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
                    await message.sendReply(`绘图失败: ${err.message}，过会儿再试试呗。`, true);
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
            } else if (err instanceof MidjourneyContentFilterError) {
                if (options.noErrorReply) {
                    throw new UserRequestError(err.message);
                } else {
                    await message.sendReply('逆天', true);
                    return;
                }
            }

            if (options.noErrorReply) {
                throw new UserRequestError(`生成图片失败: ${err.message}`);
            } else {
                await message.sendReply(`生成图片失败: ${err.message}`, true);
            }
        }
    }

    public async generateImageFromPrompt(message: CommonReceivedMessage, prompt: string, refImage: string = '', relaxMode = false, options: Text2ImgRuntimeOptions = {}) {
        this.logger.debug("收到绘图请求: " + prompt);
        if (refImage) {
            this.logger.debug("参考图片: " + refImage);
        }

        let paintSize: string | undefined;
        let subjectType: string | undefined;
        let refScope: ImageRefScope | undefined;
        let isRaw = false;

        let llmApi = this.app.getPlugin<ChatGPTController>('openai');

        if (prompt.includes('--raw')) {
            // 使用原prompt
            prompt = prompt.replace(/--raw ?/g, '').trim();
            subjectType = 'raw';
            isRaw = true;
        } else if (llmApi) {
            // 使用ChatGPT生成Prompt
            let refImagePrompt = '';
            try {
                if (refImage) {
                    // 提取参考图上的内容
                    let vlApiConf = llmApi.getApiConfigById('image_recognition');
                    if (!vlApiConf) {
                        throw new Error('未配置图片识别API');
                    }

                    const imageData = await loadMessageImage(refImage);
                    if (!imageData) {
                        throw new Error('获取图片内容失败');
                    }

                    let llmImageUrl = await llmApi
                        .chatCompleteApi!.uploadDashScopeFile(imageData.content, imageData.type, vlApiConf);

                    let res = await llmApi.doApiRequest([
                        {
                            role: 'system',
                            content: [
                                { text: 'You are a helpful assistant.' }
                            ]
                        },
                        {
                            role: 'user',
                            content: [
                                { image: llmImageUrl },
                                { text: "请详细描述图片上的场景。如果图片中有人物，请详细描写他的发型、发色、眼睛颜色、肤色、服饰、动作。" }
                            ],
                        }
                    ] as DashScopeMultiModelMessageItem[], vlApiConf);

                    refImagePrompt = res.outputMessage;
                }
            } catch (err: any) {
                this.logger.error("提取参考图内容失败", err);
                console.error(err);
            }
            
            let llmPromptArgs: any = {
                prompt,
                image_prompt: refImagePrompt,
                old_prompt: options.refPrompt ?? '',
            };

            let finalPrompt = buildLLMPrompt(llmPromptArgs);

            this.logger.debug('Generate image prompt via LLM:\n' + finalPrompt);

            let messageList: any[] = [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: finalPrompt }
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
                    if (!promptRes) {
                        throw new UserRequestError(`生成Prompt失败: ${reply}`);
                    }

                    if (promptRes.error) {
                        if (promptRes.error.code === 'content_filter') {
                            throw new MidjourneyContentFilterError('包含不适当的内容。');
                        } else {
                            throw new UserRequestError(`生成Prompt失败: ${promptRes.error.message}`);
                        }
                    }

                    prompt = promptRes.prompt;
                    paintSize = promptRes.size;
                    subjectType = promptRes.subject;
                    refScope = promptRes.reference_scope;

                    this.logger.debug(`ChatGPT生成Prompt结果: ${prompt}, 画幅: ${paintSize}, 类型: ${subjectType}`);
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
                throw new MidjourneyContentFilterError(`生成图片失败：关键词中包含禁止的内容。`);
            }
        }
        for (let matcher of api._banned_words_matcher!) {
            if (prompt.match(matcher)) {
                throw new MidjourneyContentFilterError(`生成图片失败：关键词中包含禁止的内容。`);
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
            relax: relaxMode,
            refUrl: refImage,
            refScope,
        });

        return {
            prompt,
            paintSize,
            subjectType,
            promise,
        };
    }

    public async upscaleImage(args: CommandInputArgs, message: CommonReceivedMessage, repliedMessage: CommonSendMessage) {
        try {
            let matches = args.param.trim().match(/(\d+)$/);
            if (!matches) {
                await message.sendReply('参考用法：“获取图片 1”', true);
                return;
            }

            let pickIndex = parseInt(matches[1]);
            if (isNaN(pickIndex) && pickIndex < 0 && pickIndex > 4) {
                await message.sendReply('请在1-4之间选择一个图片序号。', true);
                return;
            }

            if (!repliedMessage.extra.isMidjourneyResult) {
                await message.sendReply('未找到原始图片信息，请回复由Midjourney生成的四格图消息。', true);
                return;
            }

            let mjModel = repliedMessage.extra.mjModel;
            const promise = this.mjApi.upscaleImage({
                message,
                pickIndex,
                oldPrompt: repliedMessage.extra.prompt,
                apiId: repliedMessage.extra.mjApi,
                msgId: repliedMessage.extra.mjMsgId,
                hash: repliedMessage.extra.mjHash,
                flags: repliedMessage.extra.mjFlags,
                model: mjModel,
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
            this.logger.info('Variant msg: ' + JSON.stringify(repliedMessage.content));
            console.log(repliedMessage.extra);

            let matches = args.param.trim().match(/(?<idx>\d+)(?<prompt>.*?)$/);
            if (!matches) {
                await message.sendReply('参考用法：“以图生图 1”', true);
                return;
            }

            let pickIndex = parseInt(matches.groups?.idx ?? '');
            if (isNaN(pickIndex) && pickIndex < 0 && pickIndex > 4) {
                await message.sendReply('请在1-4之间选择一个图片序号。', true);
            }

            if (!repliedMessage.extra.isMidjourneyResult) {
                await message.sendReply('未找到原始图片信息，请回复由Midjourney生成的四格图消息。', true);
                return;
            }

            let appendPrompt = matches.groups?.prompt ?? '';

            let isSponsored = await this.checkSponsoredAndRateLimit(message);

            // 增加请求计数
            const userSessionStore = message.session.user;
            await userSessionStore.addRequestCount(this.SESSION_KEY_GENERATE_COUNT, this.config.rate_limit_minutes * 60);

            let promise: Promise<void>;

            if (!appendPrompt) {
                // 简单模式
                message.sendReply('安排了', true);
                let mjModel = repliedMessage.extra.mjModel;
                promise = this.mjApi.variantImage({
                    message,
                    pickIndex,
                    oldPrompt: repliedMessage.extra.prompt,
                    apiId: repliedMessage.extra.mjApi,
                    msgId: repliedMessage.extra.mjMsgId,
                    hash: repliedMessage.extra.mjHash,
                    flags: repliedMessage.extra.mjFlags,
                    model: mjModel,
                    relax: !isSponsored,
                    noErrorReply: false,
                });
            } else {
                // 补充prompt模式
                appendPrompt = appendPrompt.replace(/^( |，|。|,|\.|!|！)+/, '');
                let mjModel = repliedMessage.extra.mjModel;
                let generatedImageUrl: string = '';
                for (const chunk of repliedMessage.content) {
                    if (chunk.type.includes('image')) {
                        generatedImageUrl = chunk.data.url;
                        break;
                    }
                }

                let generatedImageData = await loadMessageImage(generatedImageUrl);
                if (!generatedImageData) {
                    throw new Error('加载生成的图片文件出错');
                }

                // 切分四格图片
                let imageData = await this.mjApi.extractFromCombinedImage(generatedImageData.content, pickIndex);

                let tmpImageFile = await this.app.createTempCachePath('jpg');
                await fs.promises.writeFile(tmpImageFile, new Uint8Array(imageData));
                let imageUrl = 'file://' + tmpImageFile;

                const result = await this.generateImageFromPrompt(message, appendPrompt, imageUrl, !isSponsored, {
                    noErrorReply: false,
                    model: mjModel,
                    refPrompt: repliedMessage.extra.prompt ?? '',
                });

                promise = result.promise;
            }

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