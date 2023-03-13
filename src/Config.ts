import { JsonFilterConfig } from "./generator/JsonFilter";
import { RegexFilterConfig } from "./generator/RegexFilter";

export type Config = {
    channel_config_path: string;
    plugin_config_path: string;
    plugin_path: string;
    subscribe_config: string;
    debug: boolean;
    robot: Record<string, RobotConfig>;
    service: Record<string, ServiceConfig>;
    session: SessionConfig;
    db?: DatabaseConfig;
    http_api: RestfulApiConfig;
    command_override?: CommandOverrideConfig;
    focused_as_command?: true;

    robot_description?: string;
};

export type RobotConfig = {
    type: string;
    baseId: string;

    description?: string;
};

export type RestfulApiConfig = {
    host: string;
    port: number;
    tokens: { [type: string]: any };
};

export type ServiceConfig = { [name: string]: any };

export type SessionConfig = {
    type?: 'memory' | 'redis',
    redis?: {
        host?: string,
        port?: number,
        password?: string,
        db?: number,
    }
    ttl?: number
};

export type DatabaseConfig = {
    url: string;
    user?: string;
    password?: string;
}

export type ChannelConfig = any;

export type GeneratorConfig = {
    json: JsonFilterConfig;
    match: RegexFilterConfig;
    tpl: any;
};

export type CommandOverrideConfig = {
    [command: string]: {
        name?: string;
        help?: string;
        alias?: string[];
    }
};