import EventEmitter from "events";
import { asleep } from "./helpers";

export class MessageTypingSimulator extends EventEmitter {
    public chineseCPM = 1500;
    public latinCPM = this.chineseCPM * 4;
    public randomDelay = [0, 3000];

    private messageBuffer: string[] = [];
    private messageCount = 0;
    private inTyping = false;
    private running = true;

    constructor() {
        super();
    }

    public pushMessage(message: string) {
        this.messageBuffer.push(message);
        if (!this.inTyping) {
            this.startTyping();
        }
    }

    public stop() {
        this.running = false;
        this.removeAllListeners();
    }

    public async startTyping() {
        if (this.inTyping) {
            return;
        }

        this.inTyping = true;
        try {
            while (this.messageBuffer.length > 0 && this.running) {
                const message = this.messageBuffer.shift();
                if (!message) {
                    continue;
                }

                const typingTime = this.getTypingTime(message);
                await asleep(typingTime);

                if (this.running) {
                    this.emit('message', message, this.messageCount, this.messageBuffer.length);
                    this.messageCount++;
                }
            }
        } catch (e) {
            this.inTyping = false;
            console.error(e);
        }
        this.inTyping = false;
    }

    private getTypingTime(message: string) {
        let latinChars = 0;
        for (let i = 0; i < message.length; i++) {
            if (message.charCodeAt(i) < 128) {
                latinChars++;
            }
        }
        let chineseChars = message.length - latinChars;
        let typingTime = chineseChars * 60000 / this.chineseCPM + latinChars * 60000 / this.latinCPM;
        typingTime += Math.random() * (this.randomDelay[1] - this.randomDelay[0]) + this.randomDelay[0];

        return typingTime;
    }
}