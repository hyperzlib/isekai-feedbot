// import { JsonFilterConfig } from "./generator/JsonFilter";
// import { RegexFilterConfig } from "./generator/RegexFilter";

export type Config = {
    plugin_config_path: string;
    plugin_data_path: string;
    plugin_path: string;

    cache_path: string;

    channel_config_path: string;
    subscribe_config: string;
    role_config_path: string;

    debug: boolean;
    robot: Record<string, RobotConfig>;
    service: Record<string, ServiceConfig>;
    cache: CacheConfig;
    storage: StorageConfig;
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
    public_address?: string;
    tokens: { [type: string]: any };
};

export type ServiceConfig = { [name: string]: any };

export type CacheConfig = {
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
};

export type StorageConfig = {
    cache_ttl?: number;
    message?: {
        lru_limit?: number;
        cleanup_expired_days?: number;
    };
};

export type ChannelConfig = any;

export type GeneratorConfig = {
    // json: JsonFilterConfig;
    // match: RegexFilterConfig;
    tpl: any;
};

export type CommandOverrideConfig = {
    [command: string]: {
        name?: string;
        help?: string;
        alias?: string[];
    }
};