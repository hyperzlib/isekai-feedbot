import App from "../App";
import { MultipleMessage } from "../base/provider/BaseProvider";
import { ConfigCheckError } from "../error/ConfigCheckError";

// 请勿删除这些没有使用的导入，模板中会用到
const { Utils } = require('../Utils');

export type TemplateFilterConfig = { [key: string]: string };
export type TemplateRenderFunction = (data: any) => string;

export class TemplateFilter {
    private app: App;
    private config: TemplateFilterConfig;
    private renderFunctionList: { [target: string]: TemplateRenderFunction };

    constructor(app: App, config: TemplateFilterConfig) {
        this.app = app;
        this.config = config;
        this.renderFunctionList = {};

        this.checkConfig();
    }

    async initialize() {
        for (let key in this.config) {
            let template = this.config[key];
            if (key === "default") {
                key = "base";
            }
            if (typeof template === "string") {
                this.renderFunctionList[key] = this.buildTemplateCallback(template);
            }
        }
    }

    async destory() {
        for (let key in this.renderFunctionList){
            delete this.renderFunctionList[key];
        }
    }

    checkConfig() {
        if (!('base' in this.config) && !('default' in this.config)) {
            throw new ConfigCheckError('Unset template.base or template.default');
        }
    }

    /**
     * 解析模板
     */
    parseTemplate(template: string): string {
        template = template.replace(/\\/g, "\\\\").replace(/\r\n/g, "\n").replace(/\n/g, "\\n").replace(/'/g, "\\'");
        template = template.replace(/\{\{(.*?)\}\}/g, (str, token) => {
            if (token) {
                return "' + (" + (token.replace(/\\'/g, "'")) + ") + '";
            } else {
                return str;
            }
        });
        
        if(template.indexOf("' + (") == 0){ //开头是{{
            template = template.substr(4);
        } else {
            template = "'" + template;
        }
        
        if(template.lastIndexOf(") + '") == template.length - 5){ //结尾是}}
            template = template.substr(0, template.length - 4);
        } else {
            template = template + "'";
        }
        
        return template;
    }

    /**
     * 构建callback
     * @param {string} template 
     * @returns {Function}
     */
    buildTemplateCallback(template: string): TemplateRenderFunction {
        const renderTpl = eval('(function(){ return ' + this.parseTemplate(template) + '; })')
        return (data: any): string => {
            let overridedKeys: string[] = [];
            for (let key in data) {
                if (!(key in global)) {
                    overridedKeys.push(key);
                    (global as any)[key] = data[key];
                }
            }
            let result = renderTpl();
            for (let key of overridedKeys) {
                delete (global as any)[key];
            }
            return result;
        };
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
