import App from "../App";
import { PluginController, PluginEvent } from "../PluginManager";
import { WikiMisc } from "./wiki/WikiMisc";

export default class SfsettingsController implements PluginController {
    public event!: PluginEvent;
    public app: App;

    public id = 'sfsettings';
    public name = '科幻设定百科';
    public description = '科幻设定百科的相关功能';

    constructor(app: App) {
        this.app = app;
    }

    public async initialize(): Promise<void> {
        this.event.init(this);

        const wikiMisc = new WikiMisc(this.app, 'https://www.sfsettings.com/w139/api.php');

        this.event.registerCommand({
            command: '百科',
            name: '在百科上搜索',
            alias: ['搜索', '查找', '词条'],
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