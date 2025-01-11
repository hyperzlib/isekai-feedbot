import { NotFoundError } from "#ibot-api/error/errors";
import App from "#ibot/App";
import { ChatIdentity } from "#ibot/message/Sender";
import { SubscribeTargetInfo } from "#ibot/SubscribeManager";

export class SystemManagerFramework {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    public adminSetPluginEnabled(chatIdentity: ChatIdentity, pluginAndScope: string, enabled: boolean): boolean {
        let targetInfo: SubscribeTargetInfo = {
            robot: chatIdentity.robot.robotId,
            channel: chatIdentity.channelId,
            group: chatIdentity.groupId,
            rootGroup: chatIdentity.rootGroupId,
        };

        const subscribedItems = this.app.subscribe.getSubscribeItems(targetInfo, false);

        let pluginId = pluginAndScope;
        let scope = '*';
        if (pluginAndScope.includes('/')) {
            [pluginId, scope] = pluginAndScope.split('/', 2);
        }

        console.log(subscribedItems);
        let item = subscribedItems.find((item) =>
            item.id === pluginId && item.scope === scope);

        if (!item) {
            throw new NotFoundError('未找到订阅项');
        }

        if (item.enabled === enabled) {
            return true;
        }

        item.enabled = enabled;
        this.app.subscribe.updateSubscribe(targetInfo, item, true);

        return true;
    }
}