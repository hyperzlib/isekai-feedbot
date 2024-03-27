import mongoose, { Schema, Types } from "mongoose";
import { GroupUserInfoType } from "../message/Sender";

export type GroupUserInfoSchemaType = GroupUserInfoType;

export type GroupUserInfoModelType = mongoose.Model<GroupUserInfoSchemaType>;

export const GroupUserInfoSchema = (robotId: string) => new Schema<GroupUserInfoSchemaType>({
    rootGroupId: {
        type: String,
        index: true,
    },
    groupId: {
        type: String,
        required: true,
        index: true,
    },
    userId: {
        type: String,
        required: true,
        index: true,
    },
    userName: {
        type: String,
        index: true,
    },
    nickName: String,
    title: String,
    roles: [String],
    image: String,
    extra: {
        type: Object,
        default: {},
    },
});