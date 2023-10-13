import { Model, Schema, Types } from "mongoose";
import { ChannelInfoType } from "../message/Sender";
import { ModelBase } from "../DatabaseManager";

export type ChannelInfoSchemaType = ChannelInfoType;

export type ChannelInfoModelType = Model<ChannelInfoSchemaType>;

export const ChannelInfoSchema = (robotId: string) => new Schema<ChannelInfoSchemaType>({
    channelId: {
        type: String,
        required: true,
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

export const GroupInfoModelBase: ModelBase = {
    table: 'channel_info',
    schema: ChannelInfoSchema,
};