import koa from "koa";
import { FullRestfulContext } from "../../RestfulApiManager";

export class IndexController {
    public static async index(ctx: FullRestfulContext, next: koa.Next) {
        ctx.body = "Isekai Feedbot endpoint.";
    }
}