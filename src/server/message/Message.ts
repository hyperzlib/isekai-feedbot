import { CacheStore } from "../CacheManager";
import { MessageDataType, chatIdentityToDB } from "../odm/Message";
import { BaseSender, ChatIdentity, GroupSender, IMessageSender, UserSender } from "./Sender";
import { LiteralUnion } from "../types/misc";
import { Robot } from "#ibot/robot/Robot";
import { Reactive, reactive } from "#ibot/utils/reactive";
import { escapeHtml } from "#ibot/utils";
import { CommandInputArgs } from "#ibot/types/event";

export enum MessageDirection {
    RECEIVE = 1,
    SEND = 2,
}

export type MessageChunkType = LiteralUnion<"text" | "image" | "emoji" | "record" | "attachment" | "mention" | "raw">;

export const BASE_MESSAGE_CHUNK_TYPES = ["text", "image", "emoji", "record", "attachment", "mention", "raw"];

export interface MessageChunk {
    type: MessageChunkType[];
    text: string | null;
    data: any;
}

export interface TextMessage extends MessageChunk {
    text: string;
}

export interface ImageMessage extends MessageChunk {
    data: {
        url: string;
        alt?: string;
        blob?: Blob;
    };
}

export interface EmojiMessage extends MessageChunk {
    data: {
        emoji: string,
        url?: string,
    }
}

export interface RecordMessage extends MessageChunk {
    data: {
        url: string;
        speech_to_text?: string;
    };
}

export interface VideoMessage extends MessageChunk {
    data: {
        url: string;
        fileName?: string;
        size?: number;
    }
}

export interface AttachmentMessage extends MessageChunk {
    data: {
        url: string;
        fileName: string;
        size?: number;
    };
}

export interface MentionMessage extends MessageChunk {
    data: {
        userId?: string;
        name?: string;
        everyone: boolean;
    };
}

export type CommonMessageType = LiteralUnion<"text" | "reference" | "image" | "record" | "media" | "toast">;
export type CommonMessageChatType = LiteralUnion<"private" | "group" | "channel">;

export type MessageMetaDataType = Partial<{
    command: CommandInputArgs;
    /** 处理这条消息的插件，需要由插件自行添加标记 */
    handler: string;
    /** 消息的request类型，和handler绑定 */
    reqType: string;
}>;

export type MessageExtraType = MessageMetaDataType & Record<string, any>;

export enum AddReplyMode {
    /** 不回复私聊 */
    IGNORE_PRIVATE = 1,
    /** 不回复没有被打断的对话 */
    IGNORE_NO_INTERRUPTION = 2
};

/** 基本消息 */
export class CommonMessage {
    /** 消息ID */
    id?: string;
    /** 消息内容 */
    content: MessageChunk[] = [];
    /** 主类型 */
    type: CommonMessageType = "text";
    /** 私聊/群聊 */
    chatType: CommonMessageChatType = "private";
    /** 消息方向 */
    direction: MessageDirection = MessageDirection.RECEIVE;
    /** 回复的消息ID */
    repliedId?: string;
    /** 提到的人 */
    mentions?: { userId: string, name?: string }[];
    /** 已撤回 */
    deleted: boolean = false;

    /** 附加信息 */
    extra: MessageExtraType = reactive({});

    /** 临时上下文信息，不会保存到数据库 */
    _context: any = {};

    private _contentText?: string;

    public get contentText() {
        if (typeof this._contentText === 'undefined') {
            this._contentText = this.content.map((chunk) => {
                if (chunk.text !== null) {
                    return chunk.text;
                } else if (chunk.data) {
                    return '<json>' + escapeHtml(JSON.stringify(chunk.data)) + '</json>';
                } else {
                    return '';
                }
            }).join('').trim();
        }
        return this._contentText;
    }

    /**
     * 提到某人
     * @param userId 用户ID
     * @param name 显示的文本（部分接口支持）
     * @returns 
     */
    public mention(userId: string, name?: string) {
        // 私聊消息不支持
        if (this.chatType === 'private') {
            return false;
        }

        if (typeof this.mentions === 'undefined') {
            this.mentions = [];
        } else if (this.mentions!.find((u) => u.userId === userId)) {
            return true;
        }

        this.mentions.push({ userId, name });
        this.content.unshift({
            type: ['mention'],
            text: name ? `[@${name}]` : `[@${userId}]`,
            data: { userId, name }
        });
        return true;
    }

    /**
     * 取消提到某人
     * @param userId 用户ID
     * @returns 
     */
    public removeMention(userId: string) {
        // 私聊消息不支持
        if (this.chatType === 'private') {
            return false;
        }

        if (typeof this.mentions === 'undefined') {
            return true;
        } else {
            this.mentions = this.mentions.filter((u) => u.userId !== userId);
            if (this.mentions.length === 0) {
                delete this.mentions;
            }

            this.content = this.content.filter((msg) => !msg.type.includes('mention') || msg.data?.userId !== userId);

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
            if (chunk.type.includes('text')) {
                if (!lastText) {
                    lastText = chunk.text ?? '';
                } else {
                    lastText += chunk.text ?? '';
                }
            } else {
                if (lastText) {
                    newContent.push({
                        type: ['text'],
                        text: lastText,
                        data: {},
                    });
                    lastText = undefined;
                }
                newContent.push(chunk);
            }
        });

        if (lastText) {
            newContent.push({
                type: ['text'],
                text: lastText,
                data: {}
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
            if (chunk.type.includes('text')) {
                let newText: string = chunk.text ?? '';
                let offset = [0, 0];
                if (index === 0) {
                    offset[0] = 1;
                    newText = "\t" + newText;
                } else if (index === content.length - 1) {
                    offset[1] = 1;
                    newText += "\t";
                }
                newText = newText.replace(searchValue, replaceValue);
                chunk.text = newText.substring(offset[0], newText.length - offset[1]);
            }
            return chunk;
        });
    }

    public toDBObject(): MessageDataType {
        throw new Error("Not implemented.");
    }
}

/** 基本发送的消息 */
export class CommonSendMessage extends CommonMessage {
    direction: MessageDirection = MessageDirection.SEND;
    /** 发送者 */
    sender: Robot;
    /** 接收者 */
    receiver: ChatIdentity;

    /** 回复的消息 */
    repliedMessage?: CommonSendMessage | CommonReceivedMessage;

    /** 附加操作的ID */
    interactionId?: string;

    /** 发送时间 */
    time: Date = new Date();

    constructor(sender: Robot, chatType: string, receiver: ChatIdentity, content?: MessageChunk[]) {
        super();
        this.sender = sender;
        this.chatType = chatType;
        this.receiver = receiver;
        if (Array.isArray(content)) this.content = content;
        this.time = new Date();
    }

    public async send(): Promise<void> {
        await this.sender.sendMessage(this);
    }

    public toDBObject(): MessageDataType {
        return {
            messageId: this.id!,
            type: this.type,
            direction: MessageDirection.SEND,
            chatType: this.chatType,
            chatIdentity: chatIdentityToDB(this.receiver),
            repliedMessageId: this.repliedId,
            mentionedUserIds: this.mentions?.map((item) => item.userId) ?? [],
            contentText: this.contentText,
            content: this.content,
            time: this.time,
            extra: this.extra,
        };
    }

    public async getRepliedMessage(): Promise<CommonSendMessage | CommonReceivedMessage | null> {
        return this.repliedMessage ?? null;
    }
}

export type SessionStoreGroup = {
    global: CacheStore;
    robot: CacheStore;
    user: CacheStore;
    rootGroup: CacheStore;
    group: CacheStore;
    chat: CacheStore;
};

export class CommonReceivedMessage extends CommonMessage {
    direction: MessageDirection = MessageDirection.RECEIVE;

    /** 接收时间 */
    time: Date = new Date();
    /** 接收者 */
    receiver: Robot;
    /** 发送者 */
    sender: any;
    /** 接收者是否被提到 */
    mentionedReceiver: boolean = false;
    /** Session存储 */
    session: SessionStoreGroup = new Proxy({} as any, {
        get: (target, p) => {
            if (p.toString().startsWith('_')) {
                return undefined;
            }

            if (!target[p]) {
                try {
                    target[p] = this.getSession(p as string);
                } catch (err: any) {
                    const errMsg = err?.message ?? '';
                    if (errMsg.startsWith('Unknown sender') || errMsg.startsWith('Unknown session type')) {
                        return undefined;
                    }

                    console.error(err);
                    return undefined;
                }
            }
            return target[p];
        },
    }) as any;

    /** 回复的消息 */
    private _repliedMessage?: CommonSendMessage | CommonReceivedMessage | null;

    constructor(receiver: Robot, sender: IMessageSender, messageId?: string) {
        super();

        this.receiver = receiver;
        this.sender = sender;
        this.id = messageId;
    }

    public createReplyMessage(message?: string | MessageChunk[], addReply: boolean = false) {
        const sender = this.sender as BaseSender;
        let newMessage = new CommonSendMessage(this.receiver!, this.chatType, sender.identity);
        if (typeof message === 'string') {
            let msgContent: MessageChunk[] = [{
                type: ['text'],
                text: message,
                data: {},
            }];
            newMessage.content = msgContent;
        } else if (Array.isArray(message)) {
            newMessage.content = message;
        }

        if (addReply) {
            newMessage.repliedMessage = this;
            newMessage.repliedId = this.id;
        }

        return newMessage;
    }

    public async sendReply(message: string | MessageChunk[], addReply: boolean | AddReplyMode = false, extra: any = {}): Promise<CommonSendMessage | null> {
        // 检测是否添加回复和@
        if (addReply === true) {
            addReply = AddReplyMode.IGNORE_PRIVATE;
        }

        let shouldReply = false;
        if (typeof addReply === 'number') {
            shouldReply = true;
            if (addReply & AddReplyMode.IGNORE_PRIVATE) {
                // 忽略私聊
                if (this.sender?.identity?.type === 'private') {
                    shouldReply = false;
                }
            }
        }

        // 发送回复消息
        let newMessage = this.createReplyMessage(message, shouldReply);
        if (newMessage.content.length === 0) return null;

        newMessage.extra = reactive({
            ...newMessage.extra,
            ...extra,
        });

        newMessage = await this.receiver.sendMessage(newMessage);

        return newMessage;
    }

    public async markRead() {
        return await this.receiver.markRead?.(this);
    }

    public getSession(type: string) {
        return this.receiver.getSession(this.sender.identity, type);
    }

    public async getRepliedMessage(): Promise<CommonSendMessage | CommonReceivedMessage | null> {
        if (this._repliedMessage === undefined) {
            if (this.repliedId && this.receiver.storages) {
                this._repliedMessage = await this.receiver.storages.message.get<CommonSendMessage | CommonReceivedMessage>(this.repliedId);

                if (!this._repliedMessage) {
                    // 尝试从远程消息记录中获取
                    this._repliedMessage = await this.receiver.getMessageFromRecord(this.repliedId);
                }
            } else {
                this._repliedMessage = null;
            }
        }

        return this._repliedMessage;
    }

    public toDBObject(): MessageDataType {
        const chatIdentity = this.sender.identity;
        return {
            messageId: this.id!,
            type: this.type,
            direction: MessageDirection.RECEIVE,
            chatType: this.chatType,
            chatIdentity: chatIdentityToDB(chatIdentity),
            repliedMessageId: this.repliedId,
            mentionedUserIds: this.mentions?.map((item) => item.userId) ?? [],
            contentText: this.contentText,
            content: this.content,
            time: this.time,
            extra: this.extra,
        };
    }
}

export class CommonPrivateMessage<US extends UserSender> extends CommonReceivedMessage {
    public sender: US;
    public chatType = 'private';

    constructor(sender: US, receiver: Robot, messageId?: string) {
        super(receiver, sender, messageId);
        this.sender = sender;
    }
}

export class CommonGroupMessage<GS extends GroupSender = GroupSender> extends CommonReceivedMessage {
    sender: GS;
    public chatType = 'group';

    constructor(sender: GS, receiver: Robot, messageId?: string) {
        super(receiver, sender, messageId);
        this.sender = sender;
    }
}