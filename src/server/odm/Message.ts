import { Model, Schema, Types } from "mongoose";
import { ChatIdentity } from "../message/Sender";
import { MessageChunk, MessageDirection } from "../message/Message";

export function chatIdentityToDB(chatIdentity: ChatIdentity): ChatIdentityEntityType {
    return {
        rootGroupId: chatIdentity.rootGroupId,
        groupId: chatIdentity.groupId,
        userId: chatIdentity.userId,
        channelId: chatIdentity.channelId,
    }
}

export type ChatIdentityEntityType = Partial<{
    rootGroupId: string,
    groupId: string,
    userId: string,
    channelId: string,
}>;

export type MessageDataType = {
    /** 消息ID */
    messageId: string,
    /** 消息类型 */
    type: string,
    /** 消息收发（消息方向） */
    direction: MessageDirection,
    /** 聊天类型（私聊、群聊） */
    chatType: string,
    /** 聊天目标的ID */
    chatIdentity: ChatIdentityEntityType,
    /** 回复的消息ID */
    repliedMessageId?: string,
    /** 提到的用户ID */
    mentionedUserIds?: string[],
    /** 纯文本消息内容 */
    contentText: string,
    /** 消息内容 */
    content: MessageChunk[],
    /** 时间 */
    time: Date,
    /** 消息是否被删除 */
    deleted?: boolean,
    /** 附加信息 */
    extra: any,
};

export type MessageSchemaType = MessageDataType;

export type MessageModelMethods = {

}

export type MessageModelType = Model<MessageSchemaType, {}, MessageModelMethods>;

export const MessageSchema = (robotId: string) => new Schema<MessageSchemaType, MessageModelType>({
    messageId: {
        type: String,
        required: true,
        index: true,
    },
    type: {
        type: String,
        required: true,
        index: true,
    },
    direction: {
        type: Number,
        required: true,
        index: true,
    },
    chatType: {
        type: String,
        required: true,
        index: true,
    },
    chatIdentity: {
        type: {
            rootGroupId: {
                type: String,
                index: true,
            },
            groupId: {
                type: String,
                index: true,
            },
            userId: {
                type: String,
                index: true,
            },
            channelId: {
                type: String,
                index: true,
            },
        }
    },
    repliedMessageId: {
        type: String,
        index: true,
    },
    mentionedUserIds: {
        type: [
            {
                type: String,
                index: true,
            },
        ],
        default: [],
    },
    contentText: {
        type: String,
        default: '',
    },
    content: [Object],
    time: {
        type: Date,
        default: Date.now,
        index: true,
    },
    deleted: {
        type: Boolean,
        default: false,
        index: true,
    },
    extra: {
        type: Object,
        default: {},
    },
});
