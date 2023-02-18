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
    repliedId?: string;
    /** 提到的人 */
    mentions?: { uid: string, text?: string }[];

    private _contentText?: string;

    public get contentText() {
        if (typeof this._contentText === 'undefined') {
            this._contentText = this.content.map((chunk) => {
                if (chunk.type === 'text') {
                    return chunk.data.text;
                } else if (chunk.type === 'mention') {
                    return '[@' + (chunk.data.text || chunk.data.uid) + ']';
                } else {
                    return JSON.stringify([chunk.type, chunk.data]);
                }
            }).join('').trim();
        }
        return this._contentText;
    }

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

    /** 
     * 合并文本消息
     * @returns
     */
    public combineText() {
        let newContent: MessageChunk[] = [];
        let lastText: string | undefined;

        this.content.forEach((chunk) => {
            if (chunk.type === 'text') {
                if (!lastText) {
                    lastText = chunk.data.text;
                } else {
                    lastText += chunk.data.text;
                }
            } else {
                if (lastText) {
                    newContent.push({
                        type: 'text',
                        data: { text: lastText }
                    });
                    lastText = undefined;
                }
                newContent.push(chunk);
            }
        });

        if (lastText) {
            newContent.push({
                type: 'text',
                data: { text: lastText }
            });
        }
        
        this.content = newContent;
    }

    /**
     * 替换消息内容
     * @param content 
     * @param searchValue 
     * @param replaceValue 
     * @returns 
     */
    public static replace(content: MessageChunk[], searchValue: RegExp, replaceValue: string) {
        return content.map((chunk, index) => {
            if (chunk.type === 'text') {
                let newText: string = chunk.data.text;
                let offset = [0, 0];
                if (index === 0) {
                    offset[0] = 1;
                    newText = "\t" + newText;
                } else if (index === content.length - 1) {
                    offset[1] = 1;
                    newText += "\t";
                }
                newText = newText.replace(searchValue, replaceValue);
                chunk.data.text = newText.substring(offset[0], newText.length - offset[1]);
            }
            return chunk;
        });
    }
}

/** 基本发送的消息 */
export class CommonSendMessage extends CommonMessage {
    /** 发送者 */
    sender: Robot;
    /** 接收方的ID */
    targetId: string;

    /** 回复的消息 */
    repliedMessage?: CommonReceivedMessage;

    constructor(sender: Robot, origin: string, targetId: string, content?: MessageChunk[]) {
        super();
        this.sender = sender;
        this.origin = origin;
        this.targetId = targetId;
        if (Array.isArray(content)) this.content = content;
    }
}

export class CommonReceivedMessage extends CommonMessage {
    /** 接收时间 */
    time: Date = new Date();
    /** 接收者 */
    receiver: Robot;
    /** 发送者 */
    sender: any;
    /** 接收者是否被提到 */
    mentionedReceiver: boolean = false;

    constructor(receiver: Robot, messageId?: string) {
        super();

        this.receiver = receiver;
        this.id = messageId;
    }

    public async sendReply(message: string | MessageChunk[], addReply: boolean = false): Promise<CommonSendMessage | null> {
        const sender = this.sender as BaseSender;
        let newMessage = new CommonSendMessage(this.receiver!, this.origin, sender.targetId);
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

        if (addReply) {
            newMessage.repliedId = this.id;
            newMessage.repliedMessage = this;
        }

        newMessage = await this.receiver.sendMessage(newMessage);

        return newMessage;
    }
}

export class CommonPrivateMessage<US extends UserSender> extends CommonReceivedMessage {
    public sender: US;
    public origin = 'private';

    constructor(sender: US, receiver: Robot, messageId?: string) {
        super(receiver, messageId);
        this.sender = sender;
    }
}

export class CommonGroupMessage<GS extends GroupSender = GroupSender> extends CommonReceivedMessage {
    sender: GS;
    public origin = 'group';

    constructor(sender: GS, receiver: Robot, messageId?: string) {
        super(receiver, messageId);
        this.sender = sender;
    }
}