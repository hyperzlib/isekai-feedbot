import { caching, Cache } from "cache-manager";
import { redisStore } from "cache-manager-ioredis-yet";

import App from "./App";
import { SessionConfig } from "./Config";
import { RateLimitError } from "./error/errors";

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

    /**
     * 判断是否超过限流
     * @param key 
     * @param limit 
     * @param ttl 
     * @returns seconds to wait or false
     */
    public async getRateLimit(key: string, limit: number, ttl: number): Promise<number | false> {
        const currentTime = Math.floor(new Date().getTime() / 1000);

        let requestCountData = await this.get<{ startTime: number, count: number }>(key);
        if (!requestCountData) {
            return false;
        }

        if (requestCountData.count >= limit) {
            return requestCountData.startTime + ttl - currentTime;
        }
        return false;
    }

    /**
     * 为限流记录请求时间
     * @param key 
     * @param ttl 
     */
    public async addRequestCount(key: string, ttl: number) {
        const currentTime = Math.floor(new Date().getTime() / 1000);
        
        let requestCountData = await this.get<{ startTime: number, count: number }>(key);
        if (!requestCountData) {
            requestCountData = {
                startTime: currentTime,
                count: 0
            };
        }
        requestCountData.count ++;

        await this.set(key, requestCountData, Math.max(1, requestCountData.startTime + ttl - currentTime));
    }

    /**
     * 限流，如果超过限制则抛出异常
     * @param key 
     * @param limit 
     * @param ttl 
     * @param readOnly 仅读取，不记录请求
     */
    public async rateLimit(key: string, limit: number, ttl: number, readOnly = false): Promise<void> {
        const waitTime = await this.getRateLimit(key, limit, ttl);
        if (waitTime) {
            throw new RateLimitError(waitTime);
        }
        await this.addRequestCount(key, ttl);
    }
}