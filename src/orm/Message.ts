import { Schema, Types } from "mongoose";
import { ObjectId } from "mongodb";
import { ChatIdentity } from "../message/Sender";

export type ChatIdentityEntityType = Partial<{
    robotId: string,
    rootGroupId: string,
    groupId: string,
    userId: string,
    channelId: string,
}>;

export const ChatIdentityEntity = {
    robotId: String,
    rootGroupId: String,
    groupId: String,
    userId: String,
    channelId: String,
};

export function toChatIdentityEntity(chatIdentity: ChatIdentity): ChatIdentityEntityType {
    return {
        robotId: chatIdentity.robot.robotId,
        rootGroupId: chatIdentity.rootGroupId,
        groupId: chatIdentity.groupId,
        userId: chatIdentity.userId,
        channelId: chatIdentity.channelId,
    }
}

export function buildChatIdentityQuery(chatIdentityEntity: ChatIdentityEntityType | ChatIdentity, prefix = 'chatIdentity') {
    const query: any = {};
    if ((chatIdentityEntity as any).robotId) {
        query[`${prefix}.robotId`] = (chatIdentityEntity as any).robotId;
    } else if ((chatIdentityEntity as any).robot && (chatIdentityEntity as any).robot.robotId) {
        query[`${prefix}.robotId`] = (chatIdentityEntity as any).robot.robotId;
    }
    if (chatIdentityEntity.rootGroupId) {
        query[`${prefix}.rootGroupId`] = chatIdentityEntity.rootGroupId;
    }
    if (chatIdentityEntity.groupId) {
        query[`${prefix}.groupId`] = chatIdentityEntity.groupId;
    }
    if (chatIdentityEntity.userId) {
        query[`${prefix}.userId`] = chatIdentityEntity.userId;
    }
    if (chatIdentityEntity.channelId) {
        query[`${prefix}.channelId`] = chatIdentityEntity.channelId;
    }
    return query;
}

export type MessageSchemaType = {
    id: Types.ObjectId,
    messageId: string,
    type: string,
    origin: string,
    chatIdentity: ChatIdentityEntityType,
    meta: {
        repliedId: Types.ObjectId,
        repliedMessageId: string,
        mentionedUsers: Types.ObjectId[],
        mentionedUids: string[],
    },
    isSend: boolean,
    contentText: string,
    content: any,
    time: Date,
    deleted: boolean,
    extra: any,
};

export const MessageSchema = new Schema<MessageSchemaType>({
    id: ObjectId,
    messageId: String,
    type: String,
    origin: String,
    chatIdentity: ChatIdentityEntity,
    meta: {
        repliedId: ObjectId,
        repliedMessageId: String,
        mentionedUsers: {
            type: [ObjectId],
            default: []
        },
        mentionedUids: {
            type: [String],
            default: []
        }
    },
    isSend: Boolean,
    contentText: String,
    content: Object,
    time: {
        type: Date,
        default: Date.now
    },
    deleted: {
        type: Boolean,
        default: false
    },
    extra: {
        type: Object,
        default: {},
    },
});