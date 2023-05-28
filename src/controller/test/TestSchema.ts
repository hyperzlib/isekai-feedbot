import mongoose, { Schema, Types } from "mongoose";
import { ChatIdentityEntity, ChatIdentityEntityType } from "../../orm/Message";

export type TestSchemaType = {
    id: Types.ObjectId,
    chatIdentity: ChatIdentityEntityType,
    data: string,
};

export const TestSchema = new Schema<TestSchemaType>({
    id: Object,
    chatIdentity: ChatIdentityEntity,
    data: String
});

export const TestModel = mongoose.model<TestSchemaType>('Test', TestSchema);