import { PluginController } from "#ibot-api/PluginController";
import App from "#ibot/App";
import { PluginEvent } from "#ibot/PluginManager";
import { WikiMisc } from "../wiki-misc/WikiMisc";

export default class SfsettingsController extends PluginController {
    public static id = 'sfsettings';
    public static pluginName = '科幻设定百科';
    public static description = '科幻设定百科的相关功能';

    public async initialize(): Promise<void> {
        const wikiMisc = new WikiMisc(this.app, 'https://www.sfsettings.com/w139/api.php');

        this.event.registerCommand({
            command: '百科',
            name: '在百科上搜索',
            alias: ['搜索', '查找', '词条'],
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