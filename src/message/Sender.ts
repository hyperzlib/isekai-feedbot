import { Robot } from "../RobotManager";

export type BaseSenderType = "user" | "group" | "channel";

export interface BaseSender {
    readonly type: string | BaseSenderType;
    readonly targetId: string;
}

export class UserSender implements BaseSender {
    public robot: Robot;

    public readonly type = "user";
    public uid: string;
    public userName?: string;
    public nickName?: string;

    constructor(robot: Robot, uid: string) {
        this.robot = robot;
        this.uid = uid;
    }

    static newAnonymous(robot: Robot) {
        return new UserSender(robot, '');
    }


    get identity(): SenderIdentity {
        let senderIdentity: SenderIdentity = {
            type: 'private',
            robot: this.robot,
            userId: this.uid,
        };

        return senderIdentity;
    }

    get targetId() {
        return this.uid;
    }

    get displayName() {
        return this.nickName ?? this.userName ?? this.uid;
    }
}

export class GroupSender {
    public readonly type = "group";

    public robot: Robot;

    public groupId: string;
    public groupName?: string;

    public rootGroupId?: string;
    public rootGroupName?: string;

    public uid: string;
    public userName?: string;
    public globalNickName?: string;
    public nickName?: string;

    constructor(robot: Robot, groupId: string, uid: string) {
        this.robot = robot;
        this.groupId = groupId;
        this.uid = uid;
    }

    get identity(): SenderIdentity {
        let senderIdentity: SenderIdentity = {
            type: 'group',
            robot: this.robot,
            groupId: this.groupId,
            userId: this.uid,
        };

        if (this.rootGroupId) {
            senderIdentity.rootGroupId = this.rootGroupId;
        }

        return senderIdentity;
    }

    get targetId() {
        return this.groupId;
    }

    get groupDisplayName() {
        return this.groupName ?? this.groupId;
    }

    get displayName() {
        return this.nickName ?? this.globalNickName ?? this.userName ?? this.uid;
    }

    get userSender() {
        let sender = new UserSender(this.robot, this.uid);
        sender.userName = this.userName;
        sender.nickName = this.globalNickName;
        
        return sender;
    }
}

export type SenderIdentity = {
    type: 'private' | 'group' | 'channel' | 'raw' | string,
    robot: Robot,
    rootGroupId?: string,
    groupId?: string,
    userId?: string,
    channelId?: string,
}