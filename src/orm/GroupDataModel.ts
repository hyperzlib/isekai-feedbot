import { Schema } from "mongoose";
import { ObjectId } from "mongodb";

export const GroupDataModel = new Schema({
    id: ObjectId,
    groupId: String,
    parentId: ObjectId,
    name: String,
    image: String,
    extra: Object,
});