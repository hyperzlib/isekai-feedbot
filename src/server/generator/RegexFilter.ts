import App from "../App";
import { MultipleMessage } from "../base/provider/BaseProvider";
import { MessageFilter } from "./Generator";

export type RegexFilterConfig = { [key: string]: string | string[] };

export class RegexFilter implements MessageFilter {
    private app: App;
    private config: RegexFilterConfig;
    private regexList: { [key: string]: RegExp[] };

    constructor(app: App, config: RegexFilterConfig) {
        this.app = app;
        this.config = config;
        this.regexList = {};
    }

    async initialize() {
        for (let key in this.config) {
            let patternList = this.config[key];
            if (typeof patternList === "string") {
                patternList = [patternList];
            }
            let regexList: RegExp[] = [];
            patternList.forEach((one) => {
                regexList.push(new RegExp(one));
            });
            this.regexList[key] = regexList;
        }
    }

    async destory() {

    }

    async parse(data: any): Promise<MultipleMessage> {
        for (let key in this.regexList) {
            if (typeof data[key] !== "string") continue;
            let str: string = data[key];
            let matchedGroup: { [key: string]: string } = {};
            let regexList = this.regexList[key];
            for (let regex of regexList) {
                let matches = str.match(regex);
                if (matches?.groups) {
                    matchedGroup = { ...matchedGroup, ...matches.groups };
                }
            }
            data[key] = matchedGroup;
        }
        return data;
    }
}
