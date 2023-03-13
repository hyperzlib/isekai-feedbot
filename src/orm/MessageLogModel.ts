import { Schema } from "mongoose";
import { ObjectId } from "mongodb";

export const MessageLogModel = new Schema({
    id: ObjectId,
    messageId: String,
    type: String,
    origin: String,
    chatIdentity: {
        robotId: String,
        uid: String,
        groupId: String,
        rootGroupId: String,
        channelId: String,
    },
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