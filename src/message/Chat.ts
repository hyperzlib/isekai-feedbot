import App from "../App";
import { Robot } from "../RobotManager";

export class ChatThread {
    private app: App;
    private robot: Robot;

    public type: string;
    public targetId: string;

    constructor(app: App, robot: Robot, type: string, targetId: string) {
        this.app = app;
        this.robot = robot;
        this.type = type;
        this.targetId = targetId;
    }

    async sendTyping(isTyping: boolean): Promise<boolean> {
        return false;
    }

    async deleteMessage(messageId: string): Promise<boolean> {
        return false;
    }
}