import fs from 'fs';

export class Utils {
    static dictJoin(dict: { [key: string]: any }, d1: string = ": ", d2: string = "\n"): string {
        let lines: string[] = [];
        for(var key in dict){
            let value = dict[key];
            lines.push(key + d1 + value);
        }
        return lines.join(d2);
    }

    static getCurrentDate(): string {
        let date = new Date();
        return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
    }

    static count(dict: { [key: string]: any }): number {
        try {
            return Object.keys(dict).length;
        } catch(e) {
            return 0;
        }
    }

    static sleep(time: number): Promise<void> {
        return new Promise((resolve) => {
            let tid = setTimeout(() => {
                resolve();
                clearTimeout(tid);
            }, time);
        });
    }

    static excerpt(text: string, maxLength: number, ellipsis: string = '……'): string {
        if (text.length > maxLength) {
            return text.substring(0, maxLength) + ellipsis;
        } else {
            return text;
        }
    }

    static compare(a: any, b: any, depth: number = 5): boolean {
        if (depth <= 0) return true;

        if (a === b) return true;
        if (a === null || b === null) return false;
        if (typeof a !== typeof b) return false;
        if (typeof a === 'object') {
            if (Array.isArray(a) && Array.isArray(b)) {
                if (a.length !== b.length) return false;
                for (let i = 0; i < a.length; i++) {
                    if (!this.compare(a[i], b[i], depth - 1)) return false;
                }
                return true;
            } else {
                let keys = Object.keys(a);
                if (keys.length !== Object.keys(b).length) return false;
                for (let i = 0; i < keys.length; i++) {
                    if (!this.compare(a[keys[i]], b[keys[i]], depth - 1)) return false;
                }
                return true;
            }
        } else {
            return false;
        }
    }

    static prepareDir(path: string): void {
        if (!fs.existsSync(path)) {
            fs.mkdirSync(path, { recursive: true });
        }
    }

    static isLatinChar(char: string | number): boolean {
        const charCodeMap = {
            a: 'a'.charCodeAt(0),
            z: 'z'.charCodeAt(0),
            A: 'A'.charCodeAt(0),
            Z: 'Z'.charCodeAt(0),
            0: '0'.charCodeAt(0),
            9: '9'.charCodeAt(0),
        };

        if (typeof char === 'string') {
            char = char.charCodeAt(0);
        }

        return (char >= charCodeMap.a && char <= charCodeMap.z) ||
            (char >= charCodeMap.A && char <= charCodeMap.Z) ||
            (char >= charCodeMap['0'] && char <= charCodeMap['9']);
    } 

    /**
     * 计算字符串中的汉字和单词数量
     */
    static countWord(text: string): number {
        text = text.trim();

        if (text === '') {
            return 0;
        }

        let wordCount = 0;
        let charCode: number = 0;
        let prevCharCode: number = 0;
        for (let i = 0; i < text.length; i++) {
            charCode = text.charCodeAt(i);
            if (i !== 0) {
                prevCharCode = text.charCodeAt(i - 1);
            }
            if (charCode > 255) {
                wordCount ++;
            } else {
                if (Utils.isLatinChar(charCode) && !Utils.isLatinChar(prevCharCode)) {
                    wordCount ++;
                }
            }
        }
        
        return wordCount + 1;
    }

    static escapeHtml(text: string) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    static unescapeHtml(text: string) {
        return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    static escapeMarkdown(text: string) {
        return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
    }
}
