import { caching, Cache } from "cache-manager";
import { redisStore } from "cache-manager-redis-yet";

import App from "./App";
import { SessionConfig } from "./Config";

export class SessionManager {
    private app: App;
    private config: SessionConfig;

    private store!: Cache;

    constructor(app: App, config: SessionConfig) {
        this.app = app;
        this.config = config;
    }

    public async initialize() {
        if (this.config.type === 'redis') {
            let cacheOption = {
                socket: {
                    host: this.config.redis?.host ?? 'localhost',
                    port: this.config.redis?.port ?? 6379,
                },
                password: this.config.redis?.password,
                db: this.config.redis?.db ?? 0,
                ttl: (this.config.ttl ?? 600) * 1000
            };
            this.app.logger.debug('Redis Store 配置: ' + JSON.stringify(cacheOption));
            this.store = await caching(await redisStore(cacheOption));
            this.app.logger.info(`使用Redis作为SessionStore`);
        } else {
            let cacheOption = {
                ttl: (this.config.ttl ?? 600) * 1000
            };
            this.store = await caching('memory', cacheOption);
            this.app.logger.info(`使用内存数据库作为SessionStore`);
        }
    }

    /**
     * 获取命名的SessionStore
     * @param path 
     * @returns 
     */
    public getStore(path: string[]): SessionStore {
        return new SessionStore(this.store, path);
    }
}

export class SessionStore implements Cache {
    rootStore: Cache;
    prefix: string;

    constructor(rootStore: Cache, path: string[]) {
        this.rootStore = rootStore;
        if (path.length > 0) {
            this.prefix = path.join(':') + ':';
        } else {
            this.prefix = '';
        }
    }

    public set(key: string, value: unknown, ttl?: number | undefined) {
        if (typeof ttl === 'undefined') {
            return this.rootStore.set(this.prefix + key, value);
        } else {
            return this.rootStore.set(this.prefix + key, value, ttl * 1000);
        }
    }

    public get<T>(key: string) {
        return this.rootStore.get<T>(this.prefix + key);
    }

    public del(key: string) {
        return this.rootStore.del(this.prefix + key);
    }

    public reset() {
        return this.rootStore.store.del(this.prefix + '*');
    }

    wrap<T>(key: string, fn: () => Promise<T>, ttl?: number | undefined) {
        if (typeof ttl === 'undefined') {
            return this.rootStore.wrap(this.prefix + key, fn);
        } else {
            return this.rootStore.wrap(this.prefix + key, fn, ttl * 1000);
        }
    }

    get store() {
        return this.rootStore.store;
    }
}