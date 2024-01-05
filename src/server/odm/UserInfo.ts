import { Model, Schema, Types } from "mongoose";
import { UserInfoType } from "../message/Sender";

export type UserInfoSchemaType = UserInfoType;

export type UserInfoModelType = Model<UserInfoSchemaType>;

export const UserInfoSchema = (robotId: string) => new Schema<UserInfoSchemaType, UserInfoModelType>({
    userId: {
        type: String,
        required: true,
        index: true,
    },
    userName: {
        type: String,
        index: true,
    },
    nickName: {
        type: String,
        index: true,
    },
    image: String,
    extra: {
        type: Object,
        default: {},
    }
});