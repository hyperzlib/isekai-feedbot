import Handlebars from "handlebars";

import App from "../App";
import { MultipleMessage } from "../base/provider/BaseProvider";
import { ConfigCheckError } from "../error/ConfigCheckError";
import { Utils } from "../Utils";

export type TemplateFilterConfig = { [key: string]: string };

export class TemplateFilter {
    private app: App;
    private config: TemplateFilterConfig;
    private renderFunctionList: { [target: string]: HandlebarsTemplateDelegate<any> };

    constructor(app: App, config: TemplateFilterConfig) {
        this.app = app;
        this.config = config;
        this.renderFunctionList = {};

        this.checkConfig();
    }

    async initialize() {
        this.initHandlebars();
        for (let key in this.config) {
            let template = this.config[key];
            if (key === "default") {
                key = "base";
            }
            if (typeof template === "string") {
                this.renderFunctionList[key] = Handlebars.compile(template);
            }
        }
    }

    async destory() {
        for (let key in this.renderFunctionList){
            delete this.renderFunctionList[key];
        }
    }

    initHandlebars() {
        Handlebars.registerHelper('excerpt', (...args) => {
            if (args.length > 2) {
                let text: any = args[0];
                let maxLength: any = parseInt(args[1]);
                let ellipsis: any = undefined;
                if (args.length > 3) {
                    return Utils.excerpt(text, parseInt(maxLength), ellipsis);
                }
            }
            return args[0];
        });

        Handlebars.registerHelper('currentDate', Utils.getCurrentDate);
    }

    checkConfig() {
        if (!('base' in this.config) && !('default' in this.config)) {
            throw new ConfigCheckError('Unset template.base or template.default');
        }
    }

    async parse(data: any): Promise<MultipleMessage | null> {
        let result: MultipleMessage = {};
        for (let target in this.renderFunctionList) {
            let renderFunction = this.renderFunctionList[target];
            result[target] = renderFunction(data);
        }
        return result;
    }
}
