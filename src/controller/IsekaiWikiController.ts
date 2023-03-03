import App from "../App";
import { PluginController, PluginEvent } from "../PluginManager";
import { WikiMisc } from "./wiki/WikiMisc";

const API_ENDPOINT = 'https://www.isekai.cn/api.php';

export default class IsekaiWikiController implements PluginController {
    public event!: PluginEvent;
    public app: App;

    public apiEndpoint = 'https://www.isekai.cn/api.php';

    public id = 'isekaiwiki';
    public name = '异世界百科';
    public description = '异世界百科的相关功能';

    constructor(app: App) {
        this.app = app;
    }

    public async initialize(): Promise<void> {
        this.event.init(this);

        const wikiMisc = new WikiMisc(this.app, 'https://www.isekai.cn/api.php');

        this.event.registerCommand({
            command: '百科',
            name: '搜索异世界百科',
        }, (args, message, resolved) => {
            resolved();

            wikiMisc.handleSearch(args, message);
        });

        this.event.registerCommand({
            command: '随机',
            name: '获取随机的百科页面',
            alias: ['随机词条', '随机页面'],
        }, (args, message, resolved) => {
            resolved();

            wikiMisc.handleRandomPage(args, message);
        });
    }
}