import { PluginController } from "#ibot-api/PluginController";
import { WikiMisc } from "../wiki-misc/WikiMisc";

const API_ENDPOINT = 'https://www.isekai.cn/api.php';

export default class IsekaiWikiController extends PluginController {
    public apiEndpoint = API_ENDPOINT;

    public static id = 'isekaiwiki';
    public static pluginName = '异世界百科';
    public static description = '异世界百科的相关功能';

    public async initialize(config: any): Promise<void> {
        const wikiMisc = new WikiMisc(this.app, 'https://www.isekai.cn/api.php');

        this.event.registerCommand({
            command: '百科',
            name: '搜索异世界百科',
        }, (args, message, resolved) => {
            resolved();

            wikiMisc.handleSearch(args.param, message);
        });

        this.event.registerCommand({
            command: '随机页面',
            name: '获取随机的百科页面',
            alias: ['随机词条', '随机页面'],
        }, (args, message, resolved) => {
            resolved();

            wikiMisc.handleRandomPage(args.param, message);
        });
    }
}