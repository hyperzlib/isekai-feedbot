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
}
