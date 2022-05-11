import Router from "koa-router";
import App from "../App";
import { RestfulApiManager, RestfulContext } from "../RestfulApiManager";
import { SubscribeController } from "./controller/SubscribeController";

export function makeRoutes(routes: Router<any, RestfulContext>, manager: RestfulApiManager, app: App) {
    // 订阅管理
    routes.all('/subscribe', manager.tokenMiddlewareFactory(['subscribe'])); // 权限检测
    routes.get('/subscribe', SubscribeController.getTargetList); // 获取订阅目标列表
    routes.get('/subscribe/:robot/:targetType/:targetId', SubscribeController.getTargetSubscribeList); // 获取订阅列表

    // 推送消息
    routes.all('/push', manager.tokenMiddlewareFactory(['push'])); // 权限检测
}
