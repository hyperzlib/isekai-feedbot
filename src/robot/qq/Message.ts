import { CommonGroupMessage, CommonPrivateMessage, CommonReceivedMessage, CommonSendMessage, MentionMessage, MessageChunk, TextMessage } from "../../message/Message";
import { GroupSender, UserSender } from "../../message/Sender";
import QQRobot, { QQGroupInfo } from "../QQRobot";

export interface QQFaceMessage extends MessageChunk {
    type: 'qqface';
    data: {
        id: string
    };
}

export interface QQImageMessage extends MessageChunk {
    type: 'qqimage';
    data: {
        file?: string;
        url?: string;
        alt?: string;
        subType?: string;
    };
}

export interface QQVoiceMessage extends MessageChunk {
    type: 'qqvoice';
    data: {
        url: string;
    };
}

export interface QQUrlMessage extends MessageChunk {
    type: 'qqurl';
    data: {
        url: string;
        title: string;
    };
}

export class QQUserSender extends UserSender {
    constructor(robot: QQRobot, uid: string) {
        super(robot, uid);
        this.userName = uid;
    }
}

export class QQGroupSender extends GroupSender {
    public role: "owner" | "admin" | "member" = 'member';
    public level?: string;
    public title?: string;
    public groupInfo?: QQGroupInfo;

    constructor(robot: QQRobot, groupId: string, uid: string) {
        super(robot, groupId, uid);
        this.userName = uid;
    }

    get userSender() {
        let sender = new QQUserSender(this.robot as any, this.uid);
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
                        type: 'text',
                        data: {
                            text: chunkData.data?.text ?? ''
                        }
                    } as TextMessage);
                    break;
                case 'image':
                    message.content.push({
                        type: 'qqimage',
                        baseType: 'image',
                        data: {
                            url: chunkData.data?.url ?? '',
                            alt: chunkData.data?.file,
                            subType: chunkData.data?.subType
                        }
                    } as QQImageMessage);
                    break;
                case 'record':
                    message.content.push({
                        type: 'qqvoice',
                        baseType: 'voice',
                        data: {
                            url: chunkData.data?.url ?? '',
                        }
                    } as QQVoiceMessage);
                    break;
                case 'face':
                    message.content.push({
                        type: 'qqface',
                        data: {
                            id: chunkData.data?.id ?? '',
                        }
                    } as QQFaceMessage);
                    break;
                case 'at':
                    if (chunkData.data?.qq) {
                        if (!willIgnoreMention) {
                            if (chunkData.data.qq == bot.uid) { // 如果是@机器人
                                message.mentionedReceiver = true;
                            } else { // @其他人的情况
                                message.mention(chunkData.data.qq);
                                message.content.push({
                                    type: 'mention',
                                    data: {
                                        uid: chunkData.data.qq
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
            }
        }
    });

    if (message.content.length === 1) {
        // 检查单一消息的类型
        switch (message.content[0].type) {
            case 'qqimage':
                message.type = 'image';
                break;
            case 'qqvoice':
                message.type = 'voice';
                break;
        }
    }

    return message;
}

export async function convertMessageToQQChunk(message: CommonSendMessage) {
    let msgChunk: any[] = [];

    message.content.forEach((rawChunk) => {
        let chunk = rawChunk;
        if (rawChunk.baseType && !rawChunk.type.startsWith('qq')) {
            chunk = {
                ...rawChunk,
                type: rawChunk.baseType,
            };
        }

        switch (chunk.type) {
            case 'text':
                msgChunk.push({
                    type: 'text',
                    data: {
                        text: chunk.data.text
                    }
                });
                break;
            case 'qqface':
                msgChunk.push({
                    type: 'face',
                    data: { id: chunk.data.id }
                });
                break;
            case 'image':
            case 'qqimage':
                msgChunk.push({
                    type: 'image',
                    data: {
                        file: chunk.data.url,
                        subType: chunk.data.subType ?? 0
                    }
                });
                break;
            case 'voice':
            case 'qqvoice':
                msgChunk.push({
                    type: 'record',
                    data: {
                        file: chunk.data.url
                    }
                });
                break;
            case 'mention':
                msgChunk.push({
                    type: 'at',
                    data: {
                        qq: chunk.data.uid
                    }
                });
                break;
        }
    })

    if (message.repliedId) {
        if (message.origin === 'group' && message.repliedMessage?.sender.uid) {
            // 目前不知道为何，@不能正常传递
            /*
            msgChunk.unshift({
                type: 'text',
                data: { text: ' ' }
            });
            msgChunk.unshift({
                type: 'at',
                data: { qq: message.repliedMessage.sender.uid }
            });
            msgChunk.unshift({
                type: 'text',
                data: { text: ' ' }
            });
            */
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