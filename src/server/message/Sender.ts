import { Robot } from "#ibot/robot/Robot";
import { LiteralUnion } from "#ibot/types/misc";
import { any } from "micromatch";

export type BaseSenderType = "user" | "group" | "channel";

export interface BaseSender {
    readonly type: string | BaseSenderType;
    readonly targetId: string;
    readonly userId: string;
    readonly identity: ChatIdentity;
}

export type IMessageSender = BaseSender & Record<string, any>;

export class UserSender implements BaseSender {
    public robot: Robot;

    public readonly type = "user";
    public userId: string;
    public userName?: string;
    public nickName?: string;

    public accessGroup: string[] = [];

    constructor(robot: Robot, userId: string) {
        this.robot = robot;
        this.userId = userId;
    }

    static newAnonymous(robot: Robot) {
        return new UserSender(robot, '');
    }

    get identity(): ChatIdentity {
        let chatIdentity: ChatIdentity = {
            type: 'private',
            robot: this.robot,
            userId: this.userId,
        };

        return chatIdentity;
    }

    get targetId() {
        return this.userId;
    }

    get displayName() {
        return this.nickName ?? this.userName ?? this.userId;
    }
}

export class GroupSender {
    public readonly type = "group";

    public robot: Robot;

    public groupId: string;
    public groupName?: string;

    public rootGroupId?: string;
    public rootGroupName?: string;

    public userId: string;
    public userName?: string;
    public globalNickName?: string;
    public nickName?: string;

    constructor(robot: Robot, groupId: string, userId: string) {
        this.robot = robot;
        this.groupId = groupId;
        this.userId = userId;
    }

    get identity(): ChatIdentity {
        let chatIdentity: ChatIdentity = {
            type: 'group',
            robot: this.robot,
            groupId: this.groupId,
            userId: this.userId,
        };

        if (this.rootGroupId) {
            chatIdentity.rootGroupId = this.rootGroupId;
        }

        return chatIdentity;
    }

    get targetId() {
        return this.groupId;
    }

    get groupDisplayName() {
        return this.groupName || this.groupId;
    }

    get displayName() {
        return this.nickName || this.globalNickName || this.userName || this.userId;
    }

    get userSender() {
        let sender = new UserSender(this.robot, this.userId);
        sender.userName = this.userName;
        sender.nickName = this.globalNickName;
        
        return sender;
    }
}

export interface ChatIdentity {
    type: LiteralUnion<'private' | 'group' | 'channel' | 'raw'>;
    robot: Robot;
    rootGroupId?: string;
    groupId?: string;
    userId?: string;
    channelId?: string;
}

export interface UserInfoType {
    userId: string;
    userName?: string;
    nickName?: string;
    image?: string;
    extra: any;
}

export interface GroupInfoType {
    groupId: string;
    rootGroupId?: string;
    name: string;
    image?: string;
    extra: any;
}

export interface RootGroupInfoType {
    rootGroupId: string;
    name: string;
    image?: string;
    extra: any;
}

export interface GroupUserInfoType {
    groupId: string;
    rootGroupId?: string;
    userId: string;
    userName?: string;
    nickName?: string;
    title?: string;
    role?: string;
    image?: string;
    extra: any;
}

export interface ChannelInfoType {
    channelId: string;
    name: string;
    image: string;
    extra: any;
}