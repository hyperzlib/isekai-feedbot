import { CommonReceivedMessage } from "../message/Message";
import { PluginController } from "../PluginManager";

export default class EchoController extends PluginController {
    public id = 'echo';
    public name = '复读机';
    public description = '友好地复读消息';
    
    public autoSubscribe = true;

    public async initialize(): Promise<void> {
        this.on("message/focused", this.handleEcho);
    }

    private async handleEcho(message: CommonReceivedMessage, resolved: CallableFunction) {
        if (message.contentText.match(/^说(，|：| )/)) {
            resolved();

            let repliedMessage = message.contentText.replace(/^说(，|：| )/, "");
            if (repliedMessage.match(/我/g)) {
                message.sendReply("您说" + repliedMessage.replace(/我/g, "您"), true);
            } else {
                message.sendReply(repliedMessage, true);
            }
        }
    }
}