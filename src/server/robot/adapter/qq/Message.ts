import { Robot } from "#ibot/robot/Robot";
import {
    AttachmentMessage,
    CommonGroupMessage,
    CommonPrivateMessage,
    CommonReceivedMessage,
    CommonSendMessage,
    EmojiMessage,
    ImageMessage,
    MentionMessage,
    MessageChunk,
    TextMessage,
    RecordMessage
} from "../../../message/Message";
import { GroupSender, UserSender } from "../../../message/Sender";
import QQRobot, { QQGroupInfo } from "../QQRobot";
import { qqFaceToEmoji } from "./emojiMap";

export interface QQFaceMessage extends EmojiMessage {
    type: ['emoji', 'qqface'];
    data: {
        id: string,
        emoji: string,
        url?: string,
    };
}

export interface QQImageMessage extends ImageMessage {
    type: ['image', 'qqimage'];
    data: {
        url: string;
        alt?: string;
        file?: string;
        subType?: string;
    };
}

export interface QQRecordMessage extends RecordMessage {
    type: ['record', 'qqrecord'];
    data: {
        url: string;
    };
}

export interface QQUrlMessage extends TextMessage {
    type: ['text', 'qqurl'];
    data: {
        url: string;
        title: string;
    };
}

export interface QQAttachmentMessage extends AttachmentMessage {
    type: ['attachement', 'qqattachment'];
    data: {
        sender_type: string;
        sender_id: string;
        url: string;
        fileName: string;
        size?: number;
        file_id?: string;
        busid?: number;
    }
}

export interface QQForwardingMessage extends MessageChunk {
    type: ['reference', 'qqforwarding'];
    data: {
        res_id: string;
    }
}

export class QQUserSender extends UserSender {
    constructor(robot: Robot<QQRobot>, userId: string) {
        super(robot, userId);
        this.userName = userId;
    }
}

export class QQGroupSender extends GroupSender {
    public role: "owner" | "admin" | "member" = 'member';
    public level?: string;
    public title?: string;
    public groupInfo?: QQGroupInfo;

    constructor(robot: Robot<QQRobot>, groupId: string, userId: string) {
        super(robot, groupId, userId);
        this.userName = userId;
    }

    get userSender() {
        let sender = new QQUserSender(this.robot as any, this.userId);
        sender.userName = this.userName;
        sender.nickName = this.globalNickName;

        return sender;
    }
}

/**
 * 解析消息数组到消息对象
 * @param messageData 
 * @param message 
 * @returns 
 */
export async function parseQQMessageChunk(bot: QQRobot, messageData: any[], message: CommonReceivedMessage): Promise<CommonReceivedMessage> {
    let willIgnoreMention = false;
    messageData.forEach((chunkData) => {
        if (chunkData.type) {
            switch (chunkData.type) {
                case 'text':
                    message.content.push({
                        type: ['text'],
                        text: chunkData.data?.text ?? '',
                        data: {}
                    } as TextMessage);
                    break;
                case 'image':
                    message.content.push({
                        type: ['image', 'qqimage'],
                        text: '[图片]',
                        data: {
                            url: chunkData.data?.url ?? '',
                            alt: chunkData.data?.file,
                            subType: chunkData.data?.subType
                        }
                    } as QQImageMessage);
                    break;
                case 'record':
                    message.content.push({
                        type: ['record', 'qqrecord'],
                        text: '[语音]',
                        data: {
                            url: chunkData.data?.url ?? '',
                        }
                    } as QQRecordMessage);
                    break;
                case 'face':
                    if (chunkData.data?.id) {
                        let emojiChar = qqFaceToEmoji(parseInt(chunkData.data.id));
                        message.content.push({
                            type: ['emoji', 'qqface'],
                            text: emojiChar,
                            data: {
                                id: chunkData.data?.id ?? '',
                                emoji: emojiChar,
                            }
                        } as QQFaceMessage);
                    } else {
                        message.content.push({
                            type: ['text'],
                            text: '[表情]',
                            data: { }
                        } as TextMessage);
                    }
                    break;
                case 'at':
                    if (chunkData.data?.qq) {
                        if (!willIgnoreMention) {
                            if (chunkData.data.qq == bot.userId) { // 如果是@机器人
                                message.mentionedReceiver = true;
                            } else { // @其他人的情况
                                message.mention(chunkData.data.qq);
                                message.content.push({
                                    type: ['mention'],
                                    text: `[@${chunkData.data.qq}]`,
                                    data: {
                                        userId: chunkData.data.qq,
                                    }
                                } as MentionMessage);
                            }
                        } else {
                            willIgnoreMention = false;
                        }
                    }
                    break;
                case 'reply':
                    if (chunkData.data?.id) {
                        message.repliedId = chunkData.data.id;
                        willIgnoreMention = true; // 忽略下一个“@”
                    }
                    break;
                case 'json':
                    if (typeof chunkData.data?.data === 'string' && chunkData.data.data.length < 2048) {
                        try {
                            let jsonData = JSON.parse(chunkData.data.data);
                            switch (jsonData.app) {
                                case 'com.tencent.multimsg':
                                    if (jsonData.meta?.detail?.resid) {
                                        message.content.push({
                                            type: ['reference', 'qqforwarding'],
                                            text: '[合并转发消息]',
                                            data: {
                                                res_id: jsonData.meta.detail.resid
                                            }
                                        } as QQForwardingMessage);
                                    }
                                    break;
                                case 'com.tencent.miniapp_01':
                                    if (jsonData.meta?.detail_1?.qqdocurl) {
                                        message.content.push({
                                            type: ['text', 'qqurl'],
                                            text: jsonData.meta.detail_1.qqdocurl,
                                            data: {
                                                url: jsonData.meta.detail_1.qqdocurl,
                                                title: jsonData.meta.detail_1.desc,
                                            }
                                        } as QQUrlMessage);
                                    } else if (jsonData.meta?.detail_1?.url) {
                                        message.content.push({
                                            type: ['text', 'qqurl'],
                                            text: jsonData.meta.detail_1.url,
                                            data: {
                                                url: jsonData.meta.detail_1.url,
                                                title: jsonData.meta.detail_1.desc,
                                            }
                                        } as QQUrlMessage);
                                    }
                                    break;
                                case 'com.tencent.structmsg':
                                    if (jsonData.meta) {
                                        for (let item of Object.values<any>(jsonData.meta)) {
                                            if (item?.jumpUrl || item?.url) {
                                                message.content.push({
                                                    type: ['text', 'qqurl'],
                                                    text: item.jumpUrl ?? item.url,
                                                    data: {
                                                        url: item.jumpUrl ?? item.url,
                                                        title: item.title ?? item.desc,
                                                    }
                                                } as QQUrlMessage);
                                                break;
                                            }
                                        }
                                    }
                                    break;
                                default:
                                    console.log('unknown message', chunkData);
                            }
                        } catch (_) { }
                    }
                    break;
                default:
                    console.log('unknown message', chunkData);
            }
        }
    });

    if (message.content.length === 1) {
        // 检查单一消息的类型
        const firstChunk = message.content[0];
        if (firstChunk.type.includes('qqimage')) {
            message.type = 'image';
        } else if (firstChunk.type.includes('qqrecord')) {
            message.type = 'record';
        } else if (firstChunk.type.includes('qqforwarding')) {
            message.type = 'reference';
        }
    }

    return message;
}

export async function convertMessageToQQChunk(message: CommonSendMessage) {
    let msgChunk: any[] = [];

    message.content.forEach((rawChunk) => {
        let chunk = rawChunk;

        if (chunk.type.includes('text')) {
            msgChunk.push({
                type: 'text',
                data: {
                    text: chunk.text
                }
            });
        } else if (chunk.type.includes('qqface')) {
            msgChunk.push({
                type: 'face',
                data: { id: chunk.data.id }
            });
        } else if (chunk.type.includes('image')) {
            msgChunk.push({
                type: 'image',
                data: {
                    file: chunk.data.url,
                    subType: chunk.data.subType ?? 0
                }
            });
        } else if (chunk.type.includes('record')) {
            msgChunk.push({
                type: 'record',
                data: {
                    file: chunk.data.url
                }
            });
        } else if (chunk.type.includes('mention')) {
            msgChunk.push({
                type: 'at',
                data: { qq: chunk.data.userId }
            });
        } else if (chunk.type.includes('qqforwarding')) {
            // ignore
        } else if (chunk.text !== null) {
            msgChunk.push({
                type: 'text',
                data: {
                    text: chunk.text
                }
            });
        }
    });

    if (message.repliedId) {
        if (message.chatType === 'group' && message.repliedMessage?.sender.userId) {
            // go-cqhttp需要连续发送两个@才能显示出来
            // msgChunk.unshift({
            //     type: 'text',
            //     data: { text: ' ' }
            // });
            msgChunk.unshift({
                type: 'at',
                data: { qq: message.repliedMessage.sender.userId }
            });
            // msgChunk.unshift({
            //     type: 'text',
            //     data: { text: ' ' }
            // });
            msgChunk.unshift({
                type: 'at',
                data: { qq: message.repliedMessage.sender.userId }
            });
        }
        msgChunk.unshift({
            type: 'reply',
            data: { id: message.repliedId }
        });
    }

    return msgChunk;
}

export class QQPrivateMessage extends CommonPrivateMessage<QQUserSender> {

}

export class QQGroupMessage extends CommonGroupMessage<QQGroupSender> {

}