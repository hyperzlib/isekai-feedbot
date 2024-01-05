import App from "../App";
import { MultipleMessage } from "../base/provider/BaseProvider";
import { MessageFilter } from "./Generator";

export type JsonFilterConfig = string[];

export class JsonFilter implements MessageFilter {
    private app: App;
    private config: JsonFilterConfig;
    private keys!: string[];

    constructor(app: App, config: JsonFilterConfig) {
        /** @type {App} */
        this.app = app;

        /** @type {string[]} */
        this.config = config;
    }

    async initialize() {
        this.keys = this.config;
    }

    async destory() {

    }

    async parse(data: any): Promise<MultipleMessage> {
        for (let key of this.keys) {
            if (key in data && typeof data[key] === "string"){
                data[key] = JSON.parse(data[key]);
            }
        }
        return data;
    }
}
