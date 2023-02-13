import { CommonGroupMessage, CommonReceivedMessage, CommonSendMessage } from "../message/Message";
import { GroupSender } from "../message/Sender";

export class EchoController {
    fliterBotGroupMessage(message: CommonGroupMessage) {
        let newMsg = message.content.map((chunk) => {
            if (chunk.type === 'text') {
                return {
                    type: 'text',
                    data: {
                        text: chunk.data.text.replace(/^[ ]*说[:：, ]*/, '').replace(/我/g, '你'),
                    }
                };
            } else {
                return chunk;
            }
        });

        message.sendReply(newMsg);
    }
}