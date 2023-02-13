export type BaseSenderType = "user" | "group" | "channel";

export interface BaseSender {
    readonly type: string | BaseSenderType;
    readonly targetId: string;
}

export class UserSender implements BaseSender {
    public readonly type = "user";
    public uid: string;
    public userName?: string;
    public nickName?: string;

    constructor(uid: string) {
        this.uid = uid;
    }

    static newAnonymous() {
        return new UserSender('');
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

    public groupId: string;
    public groupName?: string;

    public uid: string;
    public userName?: string;
    public globalNickName?: string;
    public nickName?: string;

    constructor(groupId: string, uid: string) {
        this.groupId = groupId;
        this.uid = uid;
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
        let sender = new UserSender(this.uid);
        sender.userName = this.userName;
        sender.nickName = this.globalNickName;
        
        return sender;
    }
}