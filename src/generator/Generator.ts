import App from "../App";
import { MultipleMessage } from "../base/provider/BaseProvider";
import { GeneratorConfig } from "../Config";
import { JsonFilter } from "./JsonFilter";
import { RegexFilter } from "./RegexFilter";
import { TemplateFilter } from "./TemplateFilter";

export interface MessageFilter {
    initialize(): Promise<void>;
    destory(): Promise<void>;
    parse(data: any): Promise<MultipleMessage | null>;
}

/**
 * 用于给推送生成文本内容
 */
export class Generator {
    private app: App;
    private config: GeneratorConfig;
    private filters: MessageFilter[];

    constructor(app: App, config: GeneratorConfig) {
        this.app = app;
        this.config = config;
        this.filters = [];
    }

    async initialize() {
        let filter: MessageFilter;
        // 解析下载的json
        if ('json' in this.config && this.config.json) {
            filter = new JsonFilter(this.app, this.config.json);
            await filter.initialize();
            this.filters.push(filter);
        }
        // 正则匹配内容，用于提取字符串内容
        if ('match' in this.config) {
            filter = new RegexFilter(this.app, this.config.match);
            await filter.initialize();
            this.filters.push(filter);
        }
        // 通过模板生成最终文本
        if ('tpl' in this.config) {
            filter = new TemplateFilter(this.app, this.config.tpl);
            await filter.initialize();
            this.filters.push(filter);
        }
    }

    async destory() {
        for (let i = 0; i < this.filters.length; i ++) {
            let filter = this.filters[i];
            try {
                await filter.destory();
                delete this.filters[i];
            } catch(e) {
                console.error(e);
            }
        }
    }

    /**
     * 生成模板
     */
    async generate(data: any): Promise<MultipleMessage> {
        let retData = data;
        for (let filter of this.filters) {
            let newData = await filter.parse(retData);
            if (newData) {
                retData = newData;
            }
        }
        return retData;
    }
}
