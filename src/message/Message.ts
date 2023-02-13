import { Robot } from "../RobotManager";
import { BaseSender, GroupSender, UserSender } from "./Sender";

export interface MessageChunk {
    type: string;
    baseType?: string;
    data: any;
}

export interface TextMessage extends MessageChunk {
    type: 'text';
    data: {
        text: string;
    };
}

export interface ImageMessage extends MessageChunk {
    type: 'image';
    data: {
        url: string;
        alt?: string;
    };
}

export interface VoiceMessage extends MessageChunk {
    type: 'voice';
    data: {
        url: string;
        text?: string;
    };
}

export interface AttachmentMessage extends MessageChunk {
    type: 'attachment';
    data: {
        url: string;
        fileName: string;
    };
}

export interface MentionMessage extends MessageChunk {
    type: 'mention';
    data: {
        uid: string;
        text?: string;
    };
}

export type CommonMessageType = "text" | "combine" | "image" | "media" | "toast";
export type CommonMessageOrigin = "private" | "group" | "channel";

/** 基本消息 */
export class CommonMessage {
    /** 消息ID */
    id?: string;
    /** 消息内容 */
    content: MessageChunk[] = [];
    /** 主类型 */
    type: string | CommonMessageType = "text";
    origin: string | CommonMessageOrigin = "private";
    /** 回复的消息ID */
    replyId?: string;
    /** 提到的人 */
    mentions?: { uid: string, text?: string }[];

    /**
     * 提到某人
     * @param uid 用户ID
     * @param text 显示的文本（部分接口支持）
     * @returns 
     */
    public mention(uid: string, text?: string) {
        // 私聊消息不支持
        if (this.origin === 'private') {
            return false;
        }

        if (typeof this.mentions === 'undefined') {
            this.mentions = [];
        } else if (this.mentions!.find((u) => u.uid === uid)) {
            return true;
        }

        this.mentions.push({ uid, text });
        this.content.unshift({
            type: 'mention',
            data: { uid, text }
        });
        return true;
    }

    /**
     * 取消提到某人
     * @param uid 用户ID
     * @returns 
     */
    public removeMention(uid: string) {
        // 私聊消息不支持
        if (this.origin === 'private') {
            return false;
        }

        if (typeof this.mentions === 'undefined') {
            return true;
        } else {
            this.mentions = this.mentions.filter((u) => u.uid !== uid);
            if (this.mentions.length === 0) {
                delete this.mentions;
            }

            this.content = this.content.filter((msg) => msg.type !== 'mention' || msg.data?.uid !== uid);

            return true;
        }
    }
}

/** 基本发送的消息 */
export class CommonSendMessage extends CommonMessage {
    sender: Robot;
    targetId: string;

    constructor(sender: Robot, targetType: string, targetId: string, content?: MessageChunk[]) {
        super();
        this.sender = sender;
        this.type = targetType;
        this.targetId = targetId;
        if (Array.isArray(content)) this.content = content;
    }
}

export class CommonReceivedMessage extends CommonMessage {
    // 接收时间
    time: Date = new Date();
    // 接收者
    receiver: Robot;
    // 发送者
    sender: any;

    constructor(receiver: Robot, messageId?: string) {
        super();

        this.receiver = receiver;
        this.id = messageId;
    }

    public async sendReply(message: string | MessageChunk[], addReply: boolean = false): Promise<CommonSendMessage | null> {
        const sender = this.sender as BaseSender;
        let newMessage = new CommonSendMessage(this.receiver!, sender.type, sender.targetId);
        if (typeof message === 'string') {
            let msgContent: MessageChunk[] = [{
                type: 'text',
                data: { text: message }
            }];
            newMessage.content = msgContent;
        } else if (Array.isArray(message)) {
            newMessage.content = message;
        } else {
            return null;
        }

        newMessage = await this.receiver.sendMessage(newMessage);

        return newMessage;
    }
}

export class CommonPrivateMessage<US extends UserSender> extends CommonReceivedMessage {
    sender: US;

    constructor(sender: US, receiver: Robot, messageId?: string) {
        super(receiver, messageId);
        this.sender = sender;
    }
}

export class CommonGroupMessage<GS extends GroupSender = GroupSender> extends CommonReceivedMessage {
    sender: GS;

    constructor(sender: GS, receiver: Robot, messageId?: string) {
        super(receiver, messageId);
        this.sender = sender;
    }
}