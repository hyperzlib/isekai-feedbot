import mongoose, { Schema, Types } from "mongoose";
import { ObjectId } from "mongodb";

export type GroupDataSchemaType = {
    id: Types.ObjectId,
    groupId: string,
    parentId: Types.ObjectId,
    name: string,
    image: string,
    extra: any,
};

export const GroupDataSchema = new Schema<GroupDataSchemaType>({
    id: ObjectId,
    groupId: String,
    parentId: ObjectId,
    name: String,
    image: String,
    extra: Object,
});

export const GroupDataModel = mongoose.model<GroupDataSchemaType>('GroupData', GroupDataSchema);