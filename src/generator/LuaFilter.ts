import App from "../App";
import { MultipleMessage } from "../base/provider/BaseProvider";
import { MessageFilter } from "./Generator";

export type LuaFilterConfig = {
    
}

/**
 * 使用Lua过滤信息
 */
export class LuaFilter implements MessageFilter {
    private app: App;
    private config: LuaFilterConfig;

    constructor(app: App, config: LuaFilterConfig) {
        this.app = app;
        this.config = config;
    }

    async initialize() {
        
    }

    async destory() {

    }

    async parse(data: any): Promise<MultipleMessage | null> {
        return null;
    }
}
