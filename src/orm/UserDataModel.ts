import { Schema } from "mongoose";
import { ObjectId } from "mongodb";

export const UserDataModel = new Schema({
    id: ObjectId,
    uid: String,
    userName: String,
    nickName: String,
    image: String,
    extra: Object,
});