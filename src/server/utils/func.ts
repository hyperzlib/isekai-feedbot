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