import App from "./App";
import Koa from 'koa';
import { RestfulApiConfig } from "./Config";
import Router from "koa-router";
import { makeRoutes } from "./restful/routes";

export interface RestfulContext {
    app: App
}

export type FullRestfulContext = RestfulContext & Koa.BaseContext;

export class RestfulApiManager {
    private app: App;
    private config: RestfulApiConfig;
    
    private koa: Koa;
    private router: Router<any, RestfulContext>;

    constructor(app: App, config: Pick<RestfulApiConfig, any>) {
        this.app = app;
        
        this.config = {
            host: '0.0.0.0',
            port: 8082,
            ...config
        } as any;

        this.koa = new Koa();
        this.router = new Router<any, RestfulContext>();
    }

    public initialize(): Promise<void> {
        makeRoutes(this.router, this, this.app);

        this.koa.use(this.globalMiddleware);

        return new Promise((resolve) => {
            this.koa.use(this.router.routes());
            this.koa.listen(this.config.port, () => {
                console.log(`Restful API 启动于：${this.config.port}`);
                resolve();
            });
        });
    }

    /**
     * 全局变量中间件
     * @param ctx 
     * @param next 
     */
    public globalMiddleware = async (ctx: FullRestfulContext, next: () => Promise<any>) => {
        ctx.app = this.app; // 注入全局app
        await next();
    }

    /**
     * 构造token检测中间件
     * @param tokenType 
     * @returns 
     */
    public tokenMiddlewareFactory(tokenType: string | string[]) {
        if (typeof tokenType === "string") {
            tokenType = [tokenType];
        }
        tokenType.push('root'); // 永远允许Root Token

        let allowedTokens = [];
        tokenType.forEach((tokenName) => {
            let token = this.config.tokens[tokenName];
            if (token) {
                allowedTokens.push(token);
            }
        });
        if (allowedTokens.length === 0) { // 无Token校验
            return async (ctx: FullRestfulContext, next: Koa.Next) => {

            };
        } else {
            return async (ctx: FullRestfulContext, next: Koa.Next) => {
                await next();
            };
        }
    }

    /**
     * 检测请求token
     * @param token
     * @param tokenType 允许的Token类型
     */
    public verifyToken(token: string, tokenType: string | string[]) {
        if (typeof tokenType === "string") {
            tokenType = [tokenType];
        }
        tokenType.push('root'); // 永远允许Root Token

        let allowedTokens = [];
        tokenType.forEach((tokenName) => {
            let token = this.config.tokens[tokenName];
            if (token) {
                allowedTokens.push(token);
            }
        });
    }

    public verifyTokenByTokenList(ctx: FullRestfulContext, tokenList: string[]): boolean
    public verifyTokenByTokenList(token: string, tokenList: string[]): boolean
    public verifyTokenByTokenList(ctx: FullRestfulContext | string, tokenList: string[]): boolean {
        let verifyType: "token" | "token-hash" = "token";
        let token: string | undefined;
        if (typeof ctx === "string") {
            token = ctx;
        } else {
            let authHeader = ctx.headers.authorization;
            if (!authHeader) {
                return false;
            }
            let [authMode, authInfo] = authHeader.split(" ");
            switch (authMode.toLowerCase()) {
                case "token":
                    token = authInfo;
                    break;
                case "token-hash":
                    verifyType = "token-hash";
                    token = authInfo;
                    break;
                default:
                    return false;
            }
        }
        if (verifyType === "token") {
            return tokenList.includes(token);
        } else if (verifyType === "token-hash") {

        }
        return false;
    }
}