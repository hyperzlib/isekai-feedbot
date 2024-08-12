import App from "#ibot/App";
import MidjourneyController, { ApiConfig } from "../PluginController";
import { Logger, withTimeout } from "#ibot/utils";
import { FetchFn, Midjourney, MJBot, MJConfigParam, MJMessage, NijiBot } from "midjourney";
import { HttpsProxyAgent } from "hpagent";
import WebSocket from "isomorphic-ws";
import { CommonReceivedMessage, ImageMessage } from "#ibot/message/Message";
import got, { OptionsOfTextResponseBody } from "got";
import { UserRequestError } from "#ibot-api/error/errors";
import { detectImageType } from "#ibot/utils/file";

export enum MJModel {
    MJ = 'mj',
    Niji = 'niji',
};

export type QueuedTask<N extends string, T> = T & {
    type: N,
    resolve: () => void,
    reject: (reason: any) => void,
};

export type ImagineTaskInfo = {
    message: CommonReceivedMessage,
    prompt: string,
    noErrorReply: boolean,
    isRaw?: boolean,
    subjectType?: string,
    paintSize?: string,
    refUrl?: string,
    model: MJModel,
    relax: boolean,
};

export type QueuedImagineTask = QueuedTask<'imagine', ImagineTaskInfo>;

export type UpscaleTaskInfo = {
    message: CommonReceivedMessage,
    pickIndex: number,
    apiId: string,
    msgId: string,
    hash: string,
    flags: number,
    noErrorReply: boolean,
};

export type QueuedUpscaleTask = QueuedTask<'upscale', UpscaleTaskInfo>;

export type VariantTaskInfo = {
    message: CommonReceivedMessage,
    pickIndex: number,
    apiId: string,
    msgId: string,
    hash: string,
    flags: number,
    relax: boolean,
    noErrorReply: boolean,
};

export type QueuedVariantTask = QueuedTask<'variant', VariantTaskInfo>;

export type QueuedMidjourneyTask = QueuedImagineTask | QueuedUpscaleTask | QueuedVariantTask;

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

export type CustomMidjourney = Midjourney & {
    runningTasks: number,
    lastTaskFinished: number,
}

enum MJQueueType {
    Relax = 'relax',
    Fast = 'fast',
}

const MAX_RELAX_QUEUE = 1;
const MAX_FAST_QUEUE = 3;

export class MidjourneyApiController {
    public app: App;
    public mainController: MidjourneyController;
    private logger: Logger;

    /** 高速队列，用于赞助用户和普通用户的图像放大 */
    private fastTasks: QueuedMidjourneyTask[] = [];

    /** 慢速队列，用于普通用户的图片生成 */
    private relaxTasks: QueuedMidjourneyTask[] = [];

    private queueCount = {
        relax: 0,
        fast: 0,
    }

    private clients: Record<string, CustomMidjourney> = {};

    public constructor(app: App, mainController: MidjourneyController) {
        this.app = app;
        this.mainController = mainController;
        this.logger = mainController.logger;
    }

    public get isFastQueueBusy() {
        return this.fastTasks.length > 10;
    }

    public get isRelaxQueueBusy() {
        return this.relaxTasks.length > 5;
    }

    private get config() {
        return this.mainController.config;
    }

    public async initialize() {

    }

    public async destroy() {
        for (let client of Object.values(this.clients)) {
            client.Close();
        }
    }

    private async getClient(apiConfig: ApiConfig) {
        const token = apiConfig.salai_token;
        if (!this.clients[token]) {
            let botId: any = MJBot;

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

            const client = new Midjourney(options) as CustomMidjourney;

            client.runningTasks = 0;
            client.lastTaskFinished = Date.now();

            this.clients[token] = client;
        }

        const client = this.clients[token];
        await client.Connect();

        return client;
    }

    private cleanupClients() {
        const currentTime = Date.now();
        for (let [token, client] of Object.entries(this.clients)) {
            if (client.runningTasks <= 0 && currentTime - client.lastTaskFinished > 30000) { // 关闭30秒未使用的客户端
                client.Close();
                delete this.clients[token];
            }
        }
    }

    public imagine(task: ImagineTaskInfo) {
        return new Promise<void>((resolve, reject) => {
            if (task.relax) {
                this.relaxTasks.push({
                    ...task,
                    type: 'imagine',
                    resolve,
                    reject,
                });

                setTimeout(() => {
                    this.onNewTask(MJQueueType.Relax);
                }, 500);
            } else {
                this.fastTasks.push({
                    ...task,
                    type: 'imagine',
                    resolve,
                    reject,
                });

                setTimeout(() => {
                    this.onNewTask(MJQueueType.Fast);
                }, 500);
            }
        });
    }

    public upscaleImage(task: UpscaleTaskInfo) {
        return new Promise<void>((resolve, reject) => {
            this.fastTasks.push({
                ...task,
                type: 'upscale',
                resolve,
                reject,
            });

            setTimeout(() => {
                this.onNewTask(MJQueueType.Fast);
            }, 500);
        });
    }

    public variantImage(task: VariantTaskInfo) {
        return new Promise<void>((resolve, reject) => {
            if (task.relax) {
                this.relaxTasks.push({
                    ...task,
                    type: 'variant',
                    resolve,
                    reject,
                });

                setTimeout(() => {
                    this.onNewTask(MJQueueType.Relax);
                }, 500);
            } else {
                this.fastTasks.push({
                    ...task,
                    type: 'variant',
                    resolve,
                    reject,
                });

                setTimeout(() => {
                    this.onNewTask(MJQueueType.Fast);
                }, 500);
            }
        });
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

    private async compressThumb(image: Buffer, maxSize: number = 1920) {
        try {
            const sharp = await import('sharp');
            let imgObj = sharp.default(image);

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
        } catch (err: any) {
            if (err.code === 'MODULE_NOT_FOUND') {
                this.logger.warn("未安装sharp模块，跳过压缩图片。");
                return image;
            }

            throw err;
        }
    }

    public async handleImagineTask(currentTask: QueuedImagineTask) {
        let client: CustomMidjourney | null = null;

        let api = this.mainController.getMostMatchedApi(currentTask.prompt, currentTask.subjectType);
        this.logger.debug("使用API: " + api.id);

        let prompt = currentTask.prompt;

        // 附加参数
        let params: string[] = []
        if (!currentTask.isRaw) {
            // 自动选择尺寸
            let size = this.mainController.getMostMatchedSize(currentTask.prompt, currentTask.paintSize);
            this.logger.debug("使用尺寸: " + size.ratio);
            params.push(`--ar ${size.ratio}`);
        }

        if (currentTask.model === MJModel.Niji) {
            params.push('--niji 5');
        }

        if (currentTask.relax) {
            params.push('--relax');
        }

        this.logger.debug("开始生成图片: " + currentTask.prompt);

        prompt += ' ' + params.join(' ');

        if (currentTask.refUrl) {
            prompt = currentTask.refUrl + ' ' + prompt;
        }

        try {
            client = await this.getClient(api);

            client.runningTasks++;

            let imagineRes: MJMessage | null = null;
            let noticeSent = false;

            try {
                currentTask.message.sendReply('安排了', true);

                let timeoutMinutes = currentTask.relax ? 12 : 6; // Relax任务12分钟，Fast任务5分钟

                imagineRes = await withTimeout(timeoutMinutes * 60 * 1000, client.Imagine(
                    prompt,
                    (uri: string, progress: string) => {
                        if (!noticeSent) {
                            currentTask.message.sendReply('在画了在画了', true).catch(console.error);
                            noticeSent = true;
                        }
                    }
                ));
            } catch (err: any) {
                client.runningTasks--;
                client.lastTaskFinished = Date.now();

                if (err.name === 'TimeoutError') {
                    await currentTask.message.sendReply('生成图片超时', true);
                    return;
                }

                throw err;
            }
            
            client.runningTasks--;
            client.lastTaskFinished = Date.now();

            if (!imagineRes) {
                await currentTask.message.sendReply('生成图片失败：Imagine对象为空', true);
                return;
            }

            let imageUrl = imagineRes.proxy_url ?? imagineRes.uri;
            let image = await this.loadImageFromUrl(imageUrl, api.proxy);

            image = await this.compressThumb(image);
            let imgType = detectImageType(image);

            await currentTask.message.sendReply([
                {
                    type: ['image'],
                    text: '[图片]',
                    data: {
                        url: 'blob:',
                        blob: new Blob([image], { type: imgType }),
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
        } catch (e: any) {
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
        }
    }

    public async handleUpscaleTask(currentTask: QueuedUpscaleTask) {
        let client: CustomMidjourney | null = null;

        this.logger.debug("开始放大图片: " + currentTask.msgId);

        let api = this.config.api.find(api => api.id === currentTask.apiId);
        if (!api) {
            await currentTask.message.sendReply('放大图片失败：未找到API', true);
            return;
        }

        try {
            client = await this.getClient(api);

            client.runningTasks++;

            let upscaleRes: MJMessage | null = null;

            try {
                upscaleRes = await withTimeout(1 * 60 * 1000, client!.Upscale({
                    index: currentTask.pickIndex as any,
                    msgId: currentTask.msgId,
                    hash: currentTask.hash,
                    flags: currentTask.flags,
                }));
                upscaleRes = upscaleRes ?? null;
            } catch (err: any) {
                client.runningTasks--;
                client.lastTaskFinished = Date.now();

                if (err.name === 'TimeoutError') {
                    await currentTask.message.sendReply('放大图片超时', true);

                    return;
                } else {
                    throw err;
                }
            }
            
            client.runningTasks--;
            client.lastTaskFinished = Date.now();

            if (!upscaleRes) {
                await currentTask.message.sendReply('放大图片失败：Upscale对象为空', true);
                return;
            }

            let imageUrl = upscaleRes.proxy_url ?? upscaleRes.uri;
            let image = await this.loadImageFromUrl(imageUrl, api.proxy);

            image = await this.compressThumb(image, 3840);
            let imgType = detectImageType(image);

            await currentTask.message.sendReply([
                {
                    type: ['image'],
                    text: '[图片]',
                    data: {
                        url: 'blob:',
                        blob: new Blob([image], { type: imgType }),
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
        } catch (e: any) {
            if (e instanceof UserRequestError) {
                await currentTask.message.sendReply(e.message, true);
            } else {
                this.logger.error("放大图片失败：" + e.message);
                console.error(e);
                await currentTask.message.sendReply('放大图片失败：' + e.message, true);
            }
        }
    }

    public async handleVariantTask(currentTask: QueuedVariantTask) {
        let client: CustomMidjourney | null = null;

        this.logger.debug("开始变基图片: " + currentTask.msgId);

        let api = this.config.api.find(api => api.id === currentTask.apiId);
        if (!api) {
            await currentTask.message.sendReply('变基图片失败：未找到API', true);
            return;
        }

        try {
            client = await this.getClient(api);

            client.runningTasks++;

            let res: MJMessage | null = null;

            try {
                currentTask.message.sendReply('安排了', true);

                let noticeSent = false;

                let timeoutMinutes = currentTask.relax ? 12 : 6; // Relax任务12分钟，Fast任务5分钟

                res = await withTimeout(timeoutMinutes * 60 * 1000, client!.Variation({
                    index: currentTask.pickIndex as any,
                    msgId: currentTask.msgId,
                    hash: currentTask.hash,
                    flags: currentTask.flags,
                    loading: (uri: string, progress: string) => {
                        if (!noticeSent) {
                            currentTask.message.sendReply('在画了在画了', true).catch(console.error);
                            noticeSent = true;
                        }
                    }
                }));
                res = res ?? null;
            } catch (err: any) {
                client.runningTasks--;
                client.lastTaskFinished = Date.now();

                if (err.name === 'TimeoutError') {
                    await currentTask.message.sendReply('变基图片超时', true);
                    client.Close();
                    return;
                } else {
                    throw err;
                }
            }

            client.runningTasks--;
            client.lastTaskFinished = Date.now();

            if (!res) {
                await currentTask.message.sendReply('变基图片失败：返回对象为空', true);
                return;
            }

            let imageUrl = res.proxy_url ?? res.uri;
            let image = await this.loadImageFromUrl(imageUrl, api.proxy);

            image = await this.compressThumb(image, 3840);
            let imgType = detectImageType(image);

            await currentTask.message.sendReply([
                {
                    type: ['image'],
                    text: '[图片]',
                    data: {
                        url: 'blob:',
                        blob: new Blob([image], { type: imgType }),
                    }
                } as ImageMessage
            ], false, {
                isMidjourneyResult: true,
                mjType: 'variant',
                mjApi: api.id,
                mjMsgId: res.id,
                mjHash: res.hash,
                mjFlags: res.flags,
            });

            currentTask.resolve();
        } catch (e: any) {
            if (e instanceof UserRequestError) {
                await currentTask.message.sendReply(e.message, true);
            } else {
                this.logger.error("变基图片失败：" + e.message);
                console.error(e);
                await currentTask.message.sendReply('变基图片失败：' + e.message, true);
            }
        }
    }

    /**
     * 在新任务到来时，检查是否需要开启新的任务队列
     * @param queueType 
     */
    public onNewTask(queueType: MJQueueType = MJQueueType.Relax) {
        switch (queueType) {
            case MJQueueType.Relax:
                if (this.queueCount.relax < MAX_RELAX_QUEUE) {
                    // 开启新的任务队列
                    this.runTask(MJQueueType.Relax);
                    this.logger.debug("已开启新的Relax任务队列");
                }
                break;
            case MJQueueType.Fast:
                if (this.queueCount.fast < MAX_FAST_QUEUE) {
                    // 开启新的任务队列
                    this.runTask(MJQueueType.Fast);
                    this.logger.debug("已开启新的Fast任务队列");
                }
                break;
        }
    }

    public async runTask(queueType: MJQueueType = MJQueueType.Relax) {
        let taskList: QueuedMidjourneyTask[] = [];
        switch (queueType) {
            case MJQueueType.Relax:
                taskList = this.relaxTasks;

                if (this.queueCount.relax >= MAX_RELAX_QUEUE) {
                    return;
                }

                this.queueCount.relax++;
                break;
            case MJQueueType.Fast:
                taskList = this.fastTasks;

                if (this.queueCount.fast >= MAX_FAST_QUEUE) {
                    return;
                }

                this.queueCount.fast++;
                break;
        }

        try {
            while (taskList.length > 0) {
                let currentTask = taskList.shift();
                if (!currentTask) {
                    break;
                }
                
                switch (currentTask.type) {
                    case 'imagine':
                        await this.handleImagineTask(currentTask);
                        break;
                    case 'upscale':
                        await this.handleUpscaleTask(currentTask);
                        break;
                    case 'variant':
                        await this.handleVariantTask(currentTask);
                        break;
                }
            }
        } catch (e: any) {
            this.logger.error("处理Midjourney任务时发生错误：" + e.message);
            console.error(e);
        }

        // 任务队列已空
        switch (queueType) {
            case MJQueueType.Relax:
                this.queueCount.relax = Math.max(0, this.queueCount.relax - 1);
                break;
            case MJQueueType.Fast:
                this.queueCount.fast = Math.max(0, this.queueCount.fast - 1);
                break;
        }
    }
}