import App from "../../../App";
import { compareProps } from "../../../utils/helpers";
import { QQGroupSender, QQUserSender } from "./Message";
import { GroupInfoType, GroupUserInfoType, UserInfoType } from "../../../message/Sender";
import { CommonMessage } from "../../../message/Message";
import { RobotStorage } from "../../../storage/RobotStorage";
import { Reactive, reactive } from "../../../utils/reactive";
import QQRobot, { QQRobotConfig } from "../QQRobot";

export type QQGroupInfo = {
    groupId: string,
    groupName?: string,
    memberCount?: number,
    memberLimit?: number
};

export class QQInfoProvider {
    private app: App;
    private robot: QQRobot;
    private config: QQRobotConfig;
    private storages?: RobotStorage;

    private infoLoaderTimer: NodeJS.Timer | null = null;
    
    public groupList: QQGroupInfo[] = [];
    public userSenderList: Record<string, QQUserSender> = {};
    public groupSenderList: Record<string, Record<string, QQGroupSender>> = {};

    constructor(app: App, robot: QQRobot, config: QQRobotConfig) {
        this.app = app;
        this.robot = robot;
        this.config = config;
    }

    async initialize() {
        this.storages = await this.app.storage.getStorages(this.robot.robotId);

        this.refreshRobotInfo();

        // 每30分钟刷新一次信息
        this.infoLoaderTimer = setInterval(() => {
            this.refreshRobotInfo();
        }, 30 * 60 * 1000);
    }

    async destroy() {
        if (this.infoLoaderTimer) {
            clearInterval(this.infoLoaderTimer);
            this.infoLoaderTimer = null;
        }
    }

    async refreshRobotInfo() {
        // 刷新群信息
        try {
            let remoteGroupList = await this.getGroupList();
            remoteGroupList.forEach((data) => {
                if (data.group_id) {
                    let oldGroupIndex = this.groupList.findIndex((info) => info.groupId === data.group_id);

                    const groupInfo: QQGroupInfo = {
                        groupId: data.group_id,
                        groupName: data.group_name,
                        memberCount: data.member_count,
                        memberLimit: data.max_member_count
                    }
                    
                    if (oldGroupIndex !== -1) {
                        const oldGroupInfo = this.groupList[oldGroupIndex];
                        if (compareProps(oldGroupInfo, groupInfo, ['groupName', 'memberCount', 'memberLimit'])) {
                            return;
                        }

                        this.groupList[oldGroupIndex] = groupInfo;
                    } else {
                        this.groupList.push(groupInfo);
                    }

                    this.updateGroupInfo(groupInfo);
                }
            });
        } catch (err: any) {
            this.app.logger.error(`获取群列表失败: ${err.message}`);
            console.error(err);
        }
    }

    public saveMessage<T extends CommonMessage>(message: T): Reactive<T> {
        if (this.storages) {
            this.storages.message.set(message).catch((err: any) => {
                this.app.logger.error(`将消息保存到数据库出错: ${err.message}`);
                console.error(err);
            });

            return this.storages.message.reactive(message);
        } else {
            return reactive(message);
        }
    }

    async getGroupList(): Promise<any[]> {
        const res = await this.robot.callRobotApi('get_group_list', {});
        if (res && res.status === 'ok') {
            return res.data;
        } else {
            return [];
        }
    }

    async getUsersInfo(userIds: string[]): Promise<(UserInfoType | null)[]> {
        let userInfoList: (UserInfoType | null)[] = [];

        for (let userId of userIds) {
            if (userId in this.userSenderList) {
                let userSender = this.userSenderList[userId];
                userInfoList.push(this.userSenderToUserInfo(userSender));
            } else {
                userInfoList.push(null);
            }
        }

        return userInfoList;
    }

    async getGroupInfo(groupId: string, rootGroupId?: string): Promise<GroupInfoType | null> {
        let localGroupInfo = this.groupList.find((info) => info.groupId === groupId);

        if (localGroupInfo) {
            return {
                groupId,
                name: localGroupInfo.groupName ?? groupId,
                image: this.getGroupImage(groupId),
                extra: {
                    memberCount: localGroupInfo.memberCount,
                    memberLimit: localGroupInfo.memberLimit,
                },
            };
        }

        return null;
    }
    
    async getGroupUsersInfo(userIds: string[], groupId: string, rootGroupId?: string): Promise<(GroupUserInfoType | null)[]> {
        let groupUserInfoList: (GroupUserInfoType | null)[] = [];

        const localList = this.groupSenderList[groupId];

        if (!localList) {
            return new Array<null>(userIds.length).fill(null);
        }

        for (let userId of userIds) {
            if (userId in localList) {
                let groupSender = localList[userId];
                groupUserInfoList.push(this.groupSenderToGroupUserInfo(groupSender));
            }
        }

        return groupUserInfoList;
    }

    /**
     * 获取用户头像
     * @param userId 
     * @returns 
     */
    public getUserImage(userId: string) {
        return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`;
    }

    /**
     * 获取群头像
     * @param groupId 
     * @returns 
     */
    public getGroupImage(groupId: string) {
        return `https://p.qlogo.cn/gh/${groupId}/${groupId}/100`
    }

    /**
     * 更新群用户信息
     * @param groupSender 
     * @returns 
     */
    public async updateGroupSender(groupSender: QQGroupSender) {
        let savedGroupSender = this.groupSenderList[groupSender.groupId]?.[groupSender.userId];
        if (savedGroupSender) {
            if (compareProps(savedGroupSender, groupSender, ['globalNickName', 'nickName', 'role', 'level', 'title'])) {
                return;
            }
        }

        if (!this.groupSenderList[groupSender.groupId]) {
            this.groupSenderList[groupSender.groupId] = {};
        }

        this.groupSenderList[groupSender.groupId][groupSender.userId] = groupSender;

        const storages = await this.app.storage.getStorages(this.robot.robotId);

        await storages.userInfo.set(this.userSenderToUserInfo(groupSender.userSender));
        await storages.groupUserInfo.set(
            this.groupSenderToGroupUserInfo(groupSender),
            groupSender.userId,
            groupSender.groupId
        );
    }

    /**
     * 更新用户信息
     * @param userSender 
     * @returns 
     */
    public async updateUserSender(userSender: QQUserSender) {
        let savedUserSender = this.userSenderList[userSender.userId];
        if (savedUserSender) {
            if (compareProps(savedUserSender, userSender, ['nickName'])) {
                return;
            }
        }

        this.userSenderList[userSender.userId] = userSender;

        const storages = await this.app.storage.getStorages(this.robot.robotId);

        this.app.logger.debug(`更新用户信息: ${userSender.userId}`);
        
        await storages.userInfo.set(this.userSenderToUserInfo(userSender));
    }

    public async updateGroupInfo(groupInfo: QQGroupInfo) {
        const storages = await this.app.storage.getStorages(this.robot.robotId);

        await storages.groupInfo.set(this.groupInfoToStorageGroupInfo(groupInfo));

        this.app.logger.debug(`更新群组信息: ${groupInfo.groupId}`);
    }

    private groupSenderToGroupUserInfo(groupSender: QQGroupSender): GroupUserInfoType {
        return {
            groupId: groupSender.groupId,
            userId: groupSender.userId,
            userName: groupSender.userName,
            nickName: groupSender.nickName || groupSender.globalNickName,
            title: groupSender.title,
            role: groupSender.role,
            image: this.getUserImage(groupSender.userId),
            extra: {},
        };
    }

    private userSenderToUserInfo(userSender: QQUserSender): UserInfoType {
        return {
            userId: userSender.userId,
            userName: userSender.userName,
            nickName: userSender.nickName,
            image: this.getUserImage(userSender.userId),
            extra: {},
        };
    }

    private groupInfoToStorageGroupInfo(groupInfo: QQGroupInfo): GroupInfoType {
        return {
            groupId: groupInfo.groupId,
            name: groupInfo.groupName ?? groupInfo.groupId,
            image: this.getGroupImage(groupInfo.groupId),
            extra: {
                memberCount: groupInfo.memberCount,
                memberLimit: groupInfo.memberLimit,
            },
        };
    }
}