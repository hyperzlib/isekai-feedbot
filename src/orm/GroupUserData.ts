import mongoose, { Schema, Types } from "mongoose";
import { ObjectId } from "mongodb";

export type GroupUserDataSchemaType = {
    id: Types.ObjectId,
    groupId: string,
    userId: string,
    userName: string,
    nickName: string,
    title: string,
    role: string,
    image: string,
    extra: any,
};

export const GroupUserDataSchema = new Schema<GroupUserDataSchemaType>({
    id: ObjectId,
    groupId: String,
    userId: String,
    userName: String,
    nickName: String,
    title: String,
    role: String,
    image: String,
    extra: Object,
});

export const GroupUserDataModel = mongoose.model<GroupUserDataSchemaType>('GroupUserData', GroupUserDataSchema);