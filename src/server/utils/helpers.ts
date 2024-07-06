import { ChatIdentity } from '#ibot/message/Sender';
import * as fs from 'fs';
import * as crypto from 'crypto';

export function compareProps(a: any, b: any, props: string[], depth: number = 5): boolean {
    if (depth <= 0) return true;

    for (let prop of props) {
        let propPath = prop.split('.');

        if (propPath.length === 1) {
            // 优化单层性能
            if (typeof a !== 'object' || typeof b !== 'object' || a[prop] !== b[prop]) {
                return false;
            }
        } else {
            let curA = a;
            let curB = b;

            for (let p of propPath) {
                if (typeof curA !== 'object' || !(p in curA)) {
                    curA = undefined;
                } else {
                    curA = curA[p];
                }
                
                if (typeof curB !== 'object' || !(p in curB)) {
                    curB = undefined;
                } else {
                    curB = curB[p];
                }

                if (curA === undefined || curB === undefined) {
                    break;
                }
            }

            if (curA !== curB) {
                return false;
            }
        }
    }

    return true;
}

export function dictJoin(dict: { [key: string]: any }, d1: string = ": ", d2: string = "\n"): string {
    let lines: string[] = [];
    for(var key in dict){
        let value = dict[key];
        lines.push(key + d1 + value);
    }
    return lines.join(d2);
}

export function getCurrentDate(): string {
    let date = new Date();
    return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

export function count(dict: { [key: string]: any }): number {
    try {
        return Object.keys(dict).length;
    } catch(e) {
        return 0;
    }
}

export function asleep(time: number): Promise<void> {
    return new Promise((resolve) => {
        let tid = setTimeout(() => {
            resolve();
            clearTimeout(tid);
        }, time);
    });
}

export function excerpt(text: string, maxLength: number, ellipsis: string = '……'): string {
    if (text.length > maxLength) {
        return text.substring(0, maxLength) + ellipsis;
    } else {
        return text;
    }
}

export function compareObject(a: any, b: any, depth: number = 5): boolean {
    if (depth <= 0) return true;

    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a === 'object') {
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!compareObject(a[i], b[i], depth - 1)) return false;
            }
            return true;
        } else {
            let keys = Object.keys(a);
            if (keys.length !== Object.keys(b).length) return false;
            for (let i = 0; i < keys.length; i++) {
                if (!compareObject(a[keys[i]], b[keys[i]], depth - 1)) return false;
            }
            return true;
        }
    } else {
        return false;
    }
}

export function prepareDir(path: string): void {
    if (!fs.existsSync(path)) {
        fs.mkdirSync(path, { recursive: true });
    }
}

export function isLatinChar(char: string | number): boolean {
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
export function countWord(text: string): number {
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
            if (isLatinChar(charCode) && !isLatinChar(prevCharCode)) {
                wordCount ++;
            }
        }
    }
    
    return wordCount + 1;
}

export function escapeHtml(text: string) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function unescapeHtml(text: string) {
    return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export function escapeMarkdown(text: string) {
    return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
}

export function chatIdentityToString(chatIdentity: ChatIdentity) {
    if (chatIdentity.userId && chatIdentity.groupId && chatIdentity.rootGroupId) {
        return `${chatIdentity.robot.robotId}:${chatIdentity.userId}@${chatIdentity.rootGroupId}:${chatIdentity.groupId}`;
    } else if (chatIdentity.userId && chatIdentity.groupId) {
        return `${chatIdentity.robot.robotId}:${chatIdentity.userId}@${chatIdentity.groupId}`;
    } else if (chatIdentity.userId) {
        return `${chatIdentity.robot.robotId}:${chatIdentity.userId}`;
    }

    return '';
}

export function chatIdentityToCacheKey(chatIdentity: ChatIdentity) {
    if (chatIdentity.userId && chatIdentity.groupId && chatIdentity.rootGroupId) {
        return `${chatIdentity.robot.robotId}:${chatIdentity.userId}:${chatIdentity.rootGroupId}:${chatIdentity.groupId}`;
    } else if (chatIdentity.userId && chatIdentity.groupId) {
        return `${chatIdentity.robot.robotId}:${chatIdentity.userId}:${chatIdentity.groupId}`;
    } else if (chatIdentity.userId) {
        return `${chatIdentity.robot.robotId}:${chatIdentity.userId}`;
    }

    return '';
}

export function splitPrefix(text: string, separator: string): [string, string] {
    let index = text.indexOf(separator);
    if (index === -1) {
        return [text, ''];
    } else {
        return [text.substring(0, index), text.substring(index + separator.length)];
    }
}

export function arrayDiff<T>(a: T[], b: T[]): { added: T[], removed: T[] } {
    let added: T[] = [];
    let removed: T[] = [];

    for (let item of a) {
        if (!b.includes(item)) {
            removed.push(item);
        }
    }

    for (let item of b) {
        if (!a.includes(item)) {
            added.push(item);
        }
    }

    return { added, removed };
}

export function setDiff<T>(a: Set<T>, b: Set<T>): { added: Set<T>, removed: Set<T> } {
    let added = new Set<T>();
    let removed = new Set<T>();

    for (let item of a) {
        if (!b.has(item)) {
            removed.add(item);
        }
    }

    for (let item of b) {
        if (!a.has(item)) {
            added.add(item);
        }
    }

    return { added, removed };
}

export function hashMd5(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
}

export function hyphenToCamelCase(text: string): string {
    return text.replace(/-([a-z])/g, (match, p1) => p1.toUpperCase());
}

export function camelCaseToHyphen(text: string): string {
    return text.replace(/([A-Z])/g, (match) => '-' + match.toLowerCase());
}