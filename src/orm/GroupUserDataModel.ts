import { Schema } from "mongoose";
import { ObjectId } from "mongodb";

export const GroupUserDataModel = new Schema({
    id: ObjectId,
    groupId: String,
    uid: String,
    userName: String,
    nickName: String,
    title: String,
    role: String,
    image: String,
    extra: Object,
});