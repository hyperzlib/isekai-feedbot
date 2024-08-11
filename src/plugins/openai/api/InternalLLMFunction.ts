import App from "#ibot/App";
import got from "got";
import ChatGPTController from "../PluginController";
import { CommonReceivedMessage } from "#ibot/message/Message";
import { LLMFunctionContainer } from "./LLMFunction";
import { DashScopeMultiModelMessageItem } from "./ChatCompleteApi";
import { readFile } from "fs/promises";
import { detectImageType } from "#ibot/utils/file";

export class InternalLLMFunction {
    public app: App;
    public mainController: ChatGPTController;

    public constructor(app: App, mainController: ChatGPTController) {
        this.app = app;
        this.mainController = mainController;
    }

    public async getLLMFunctions(functionContainer: LLMFunctionContainer) {
        functionContainer.register('get_date_time', {
            displayName: '获取当前时间',
            description: '当你想获取当前的日期和时间时非常有用。',
            params: [],
            callback: this.getDateTime.bind(this),
        });

        functionContainer.register('search_on_web', {
            displayName: '在线搜索',
            description: '当你想搜索一个事物或人物的具体信息时非常有用。如果用户询问一个事物的含义，请先在网上进行搜索。',
            params: [
                {
                    name: "keywords",
                    description: "需要搜索的关键词。",
                    required: true,
                    schema: { "type": "string" },
                },
            ],
            callback: this.searchOnWeb.bind(this),
        });
        
        functionContainer.register('recognize_image', {
            displayName: '识别图片',
            description: '当你想识别图片中的内容时非常有用。',
            params: [
                {
                    name: "image_url",
                    description: "图片的URL地址或者文件地址。",
                    required: true,
                    schema: { "type": "string" },
                },
                // {
                //     name: "question",
                //     description: "对图片提出的问题。",
                //     required: true,
                //     schema: { "type": "string" },
                // }
            ],
            callback: this.recognizeImage.bind(this),
        })
    }

    public async destroy() {

    }

    private async getDateTime(params: any): Promise<string> {
        const date = new Date();
        let dateTimeString = date.toLocaleString('zh-CN', {
            dateStyle: 'full',
            timeStyle: 'long',
            timeZone: 'Asia/Shanghai',
        });
        return `${dateTimeString}`;
    }

    private async searchOnWeb(params: any, message?: CommonReceivedMessage): Promise<string> {
        const MAX_RESULTS = 3;
        let keywords = params.keywords ?? '';
        const bingSearchConfig = this.mainController.config.bing_search;
        try {
            await message?.sendReply('让我查查', true);

            let res = await got.get('https://api.bing.microsoft.com/v7.0/search', {
                headers: {
                    "Ocp-Apim-Subscription-Key": bingSearchConfig.key,
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

                if (bingSearchConfig.preferred_site_domain?.length) {
                    const preferredSiteDomain = bingSearchConfig.preferred_site_domain;
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

    public async recognizeImage(params: any, message?: CommonReceivedMessage): Promise<string> {
        if (!params.image_url) {
            return '请提供图片的URL地址。';
        }

        let imageUrl: string = params.image_url;
        let question = params.question ?? '详细描述图片上的内容，并提取图片上的文字。';

        let apiConf = this.mainController.getApiConfigById('image_recognition');
        if (!apiConf) {
            return '未配置图片识别API';
        }

        try {
            await message?.sendReply('让我康康', true);

            if (imageUrl.startsWith('file://')) {
                let imagePath = imageUrl.replace('file://', '');
                let imageBuffer = await readFile(imagePath);
                let imageType = detectImageType(imageBuffer) ?? 'image/png';

                imageUrl = await this.mainController
                    .chatCompleteApi!.uploadDashScopeFile(imageBuffer, imageType, apiConf);
            }

            let res = await this.mainController.doApiRequest([
                {
                    role: 'system',
                    content: [
                        { text: 'You are a helpful assistant.' }
                    ]
                },
                {
                    role: 'user',
                    content: [
                        { image: imageUrl },
                        { text: question }
                    ],
                }
            ] as DashScopeMultiModelMessageItem[], apiConf);

            this.mainController.logger.debug(`识图结果：${res.outputMessage}`);

            return res.outputMessage;
        } catch (err: any) {
            this.mainController.logger.error(`图片识别失败: ${err.message}`);
            console.error(err);

            if (err.name === 'HTTPError' && err.response) {
                console.error('Error Response: ', err.response?.body);
            }

            return `图片识别失败: ${err.message}`;
        }
    }
}