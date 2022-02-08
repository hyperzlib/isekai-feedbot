import { JsonFilterConfig } from "./generator/JsonFilter";
import { RegexFilterConfig } from "./generator/RegexFilter";

export type Config = {
    channel_config_path: string;
    subscribe_config: string;
    debug: boolean;
    robot: { [key: string]: RobotConfig };
    service: { [key: string]: ServiceConfig };
};

export type RobotConfig = {
    type: string;
    baseId: string;
};

export type ServiceConfig = { [name: string]: any };

export type ChannelConfig = any;

export type GeneratorConfig = {
    json: JsonFilterConfig;
    match: RegexFilterConfig;
    tpl: any;
};
