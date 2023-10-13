export function retrieveOnce<Func extends ((...args: any) => Promise<any>)>(callback: Func): Func {
    type ValType = Awaited<ReturnType<Func>>;

    let data: any = undefined;
    let error: Error | undefined = undefined;
    let loaded = false;
    let loading = false;

    let callbacks: [(data: ValType) => any, (err: Error) => any][] = [];

    return ((...args: any): Promise<ValType> => {
        return new Promise((resolve, reject) => {
            if (loaded) {
                if (error) {
                    reject(error);
                } else {
                    resolve(data);
                }
                return;
            }

            callbacks.push([resolve, reject]);

            if (!loading) {
                loading = true;
                callback(...args).then((ret) => {
                    data = ret;
                    loaded = true;
                    loading = false;
                    callbacks.forEach((cb) => {
                        cb[0](ret);
                    });
                }).catch((err) => {
                    error = err;
                    loaded = true;
                    loading = false;
                    callbacks.forEach((cb) => {
                        cb[1](err);
                    });
                });
            }
        });
    }) as unknown as Func;
}