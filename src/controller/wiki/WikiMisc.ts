import request from "request-promise";
import App from "../../App";
import { CommonReceivedMessage } from "../../message/Message";
import { PluginEvent } from "../../PluginManager";

export class WikiMisc {
    public event!: PluginEvent;
    public app: App;

    private apiEndpoint: string;

    public id = 'sfsettings';
    public name = '科幻设定百科';
    public description = '科幻设定百科的相关功能';

    constructor(app: App, apiEndpoint: string) {
        this.app = app;
        this.apiEndpoint = apiEndpoint;
    }

    public async handleSearch(args: string, message: CommonReceivedMessage) {
        try {
            let res = await request({
                uri: this.apiEndpoint,
                method: 'GET',
                qs: {
                    action: 'opensearch',
                    search: args,
                    limit: 10,
                    namespace: 0,
                    format: 'json',
                    formatversion: 2,
                },
                json: true,
            });

            if (res.error) {
                message.sendReply('获取词条列表失败: ' + res.error.info, true);
            }

            let titles = res[1];
            if (titles.length === 0) {
                message.sendReply('未找到相关词条', true);
                return;
            }

            // Get page info
            res = await request({
                uri: this.apiEndpoint,
                method: 'GET',
                qs: {
                    action: 'query',
                    prop: 'info|extracts',
                    inprop: 'url',
                    exintro: true,
                    explaintext: true,
                    exsentences: 3,
                    exlimit: 1,
                    redirects: true,
                    format: 'json',
                    formatversion: 2,
                    titles: titles[0],
                },
                json: true,
            });

            if (res.error) {
                message.sendReply('获取词条详情失败: ' + res.error.info, true);
                return;
            }

            let pages = res.query.pages;
            let page = pages[0];
            if (page.missing) {
                message.sendReply('未找到相关词条', true);
                return;
            }

            let reply = '找到的词条：' + titles.join('、') + '\n';
            reply += '《' + page.title + '》\n';
            reply += page.extract;

            message.sendReply(reply, true);
        } catch (err: any) {
            message.sendReply('获取词条详情失败: ' + err.message, true);
            console.error(err);
        }
    }

    public async handleRandomPage(args: string, message: CommonReceivedMessage) {
        try {
            let res = await request({
                uri: this.apiEndpoint,
                method: 'GET',
                qs: {
                    action: 'query',
                    prop: 'info|extracts',
                    inprop: 'url',
                    exintro: true,
                    explaintext: true,
                    exsentences: 3,
                    exlimit: 1,
                    list: 'random',
                    rnnamespace: 0,
                    rnlimit: 1,
                    format: 'json',
                    formatversion: 2,
                },
                json: true,
            });

            if (res.error) {
                message.sendReply('获取随机页面失败: ' + res.error.info, true);
                return;
            }

            if (this.app.debug) {
                console.log(res);
            }

            let pageTitle = res.query.random?.[0]?.title;
            if (!pageTitle) {
                message.sendReply('未找到随机页面', true);
                return;
            }
            // Get page info 
            res = await request({
                uri: this.apiEndpoint,
                method: 'GET',
                qs: {
                    action: 'query',
                    prop: 'info|extracts',
                    inprop: 'url',
                    exintro: true,
                    explaintext: true,
                    exsentences: 3,
                    exlimit: 1,
                    redirects: true,
                    format: 'json',
                    formatversion: 2,
                    titles: pageTitle,
                },
                json: true,
            });

            if (res.error) {
                message.sendReply('获取随机页面失败: ' + res.error.info, true);
                return;
            }

            let pages = res.query.pages;
            let page = pages[0];
            if (!page || page.missing) {
                message.sendReply('获取随机页面失败：页面丢失', true);
                return;
            }

            let reply = '《' + page.title + '》\n';
            reply += page.extract + '\n';
            reply += page.canonicalurl;

            message.sendReply(reply, true);
        } catch (err: any) {
            message.sendReply('获取随机页面失败: ' + err.message, true);
            console.error(err);
        }
    }
}