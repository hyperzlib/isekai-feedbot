import { ShuffleRandom } from "./ShuffleRandom";
import Handlebars from "handlebars";
import { Pair } from "../types/misc";

export class RandomMessage extends ShuffleRandom<Pair<string, HandlebarsTemplateDelegate<any>>> {
    constructor(messageList: string[] = []) {
        let itemList: Pair<string, HandlebarsTemplateDelegate<any>>[] = messageList
            .map((message) => [message, Handlebars.compile(message)]);

        super(itemList);
    }

    public get messageList(): string[] {
        return this._itemList.map((item) => item[0]);
    }

    public set messageList(messageList: string[]) {
        // Remove message that not in messageList
        this._itemList = this._itemList.filter((item) => !messageList.includes(item[0]));

        // Add message that not in itemList
        for (let message of messageList) {
            if (!this._itemList.some((item) => item[0] === message)) {
                this._itemList.push([message, Handlebars.compile(message)]);
            }
        }

        this.shuffle();
    }

    public nextMessage(data: any = {}): string | null {
        let message = super.next();
        if (message === null) {
            return null;
        }
        let generator = message[1];
        return generator(data);
    }
}