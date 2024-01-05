import mongoose, { Schema, Types } from "mongoose";
import { RootGroupInfoType } from "../message/Sender";

export type RootGroupInfoSchemaType = RootGroupInfoType;

export type RootGroupInfoModelType = mongoose.Model<RootGroupInfoSchemaType>;

export const RootGroupInfoSchema = (robotId: string) => new Schema<RootGroupInfoSchemaType>({
    rootGroupId: {
        type: String,
        required: true,
        index: true,
    },
    name: {
        type: String,
        index: true,
    },
    image: String,
    extra: {
        type: Object,
        default: {},
    }
});