import { ChatIdentity } from "#ibot/message/Sender"

export type OnSubscribeChannelParams = {
    /** Channel type */
    channelType: string,
    /** Channel ID */
    channelId: string,
    /** Subscribe count */
    count: number,
    /** Subscribe issuer */
    target: ChatIdentity,
};
export type OnSubscribeChannel = (params: OnSubscribeChannelParams) => Promise<void>;

export type OnUnsubscribeChannelParams = {
    /** Channel type */
    channelType: string,
    /** Channel ID */
    channelId: string,
    /** Subscribe count */
    count: number,
    /** Unsubscribe issuer */
    target: ChatIdentity,
};
export type OnUnsubscribeChannel = (params: OnUnsubscribeChannelParams) => Promise<void>;