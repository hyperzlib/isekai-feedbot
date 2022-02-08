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
        return date.getFullYear() + '年' + date.getMonth() + '月' + date.getDate() + '日';
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
}
