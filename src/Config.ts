import { JsonFilterConfig } from "./generator/JsonFilter";
import { RegexFilterConfig } from "./generator/RegexFilter";

export type Config = {
    channel_config_path: string;
    plugin_path: string;
    subscribe_config: string;
    debug: boolean;
    robot: { [key: string]: RobotConfig };
    service: { [key: string]: ServiceConfig };
    http_api: RestfulApiConfig;
};

export type RobotConfig = {
    type: string;
    baseId: string;
};

export type RestfulApiConfig = {
    host: string;
    port: number;
    tokens: { [type: string]: any };
};

export type ServiceConfig = { [name: string]: any };

export type ChannelConfig = any;

export type GeneratorConfig = {
    json: JsonFilterConfig;
    match: RegexFilterConfig;
    tpl: any;
};
