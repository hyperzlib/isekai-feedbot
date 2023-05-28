import mongoose, { Schema, Types } from "mongoose";
import { ObjectId } from "mongodb";

export type UserDataSchemaType = {
    id: Types.ObjectId,
    userId: string,
    userName: string,
    nickName: string,
    image: string,
    extra: any,
};

export const UserDataSchema = new Schema<UserDataSchemaType>({
    id: ObjectId,
    userId: String,
    userName: String,
    nickName: String,
    image: String,
    extra: Object,
});

export const UserDataModel = mongoose.model<UserDataSchemaType>('UserData', UserDataSchema);