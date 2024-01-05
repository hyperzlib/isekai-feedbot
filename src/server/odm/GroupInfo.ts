import mongoose, { Schema, Types } from "mongoose";
import { GroupInfoType } from "../message/Sender";

export type GroupInfoSchemaType = GroupInfoType;

export type GroupInfoModelType = mongoose.Model<GroupInfoSchemaType>;

export const GroupInfoSchema = (robotId: string) => new Schema<GroupInfoSchemaType>({
    groupId: {
        type: String,
        required: true,
        index: true,
    },
    rootGroupId: {
        type: String,
        index: true,
    },
    name: {
        type: String,
        required: true,
        default: '',
        index: true,
    },
    image: String,
    extra: {
        type: Object,
        default: {},
    },
});