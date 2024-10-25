export type ReactiveOptions = {
    maxDepth?: number;
    nestedObjects?: any[];
    ignoreNestedKeys?: string[];
};

export type ReactiveChangeListenner = (key: string | null, value: any) => void;

export type Reactive<T extends Object = any> = T & {
    _onChangeListeners: ReactiveChangeListenner[];
    _isReactive: true;
    _ignoreReactive: boolean;
    _value: T;
    updated: () => void;
};

export function reactive<T extends Object>(obj: T, opts: ReactiveOptions = {}): Reactive<T> {
    let maxDepth = opts.maxDepth ?? 10;
    let nestedObjects = opts.nestedObjects ?? [];
    let ignoreNestedKeys = opts.ignoreNestedKeys ?? [];

    let onChangeListeners: ReactiveChangeListenner[] = [];

    // 防止嵌套
    if ((obj as Reactive<T>)._isReactive) {
        return obj as Reactive<T>;
    }

    const onUpdate = (key: string | null, value: any) => {
        for (let listener of onChangeListeners) {
            try {
                listener(key, value);
            } catch (e) {
                console.error('Error in watch: ', e);
            }
        }
    };

    const buildChildOnUpdate = (childKey: string) => {
        return (key: string | null, value: any) => {
            onUpdate(childKey + '/' + key, value);
        };
    }

    const onChildChange = (key: string | null, value: any) => {
        onUpdate(key, value);
    };

    // 递归监听子对象
    for (let key of Object.getOwnPropertyNames(obj)) {
        if (key.startsWith('_')) continue;

        let value = obj[key as keyof T];
        if (value && value.constructor === Object) {
            if (ignoreNestedKeys.includes(key) || nestedObjects.includes(value)) {
                continue;
            }

            const valueTest = value as unknown as Reactive<{}>;
            if (!valueTest._isReactive && !valueTest._ignoreReactive) {
                value = reactive(value as object, {
                    maxDepth: maxDepth - 1,
                    nestedObjects,
                }) as unknown as T[keyof T];
                obj[key as keyof T] = value;
            }

            const valueRef = value as Reactive<{}>;
            valueRef._onChangeListeners.push(buildChildOnUpdate(key));
        }
    }

    return new Proxy(obj, {
        set: (target, key, value) => {
            if (!key.toString().startsWith('_') && value && value.constructor === Object) {
                if (!ignoreNestedKeys.includes(key as string) && !nestedObjects.includes(value)) {
                    // 递归监听子对象
                    if (!value._isReactive && !value._ignoreReactive) {
                        value = reactive(value, {
                            maxDepth: maxDepth - 1,
                            nestedObjects,
                        });
                    }
                    
                    value._onChangeListeners.push(buildChildOnUpdate(key as string));
                }
            }

            target[key as keyof T] = value;
            onUpdate(key as string, value);
            return true;
        },
        get: (target, key): any => {
            switch (key) {
                case '_onChangeListeners':
                    return onChangeListeners;
                case '_isReactive':
                    return true;
                case '_value':
                    return target;
                case 'updated':
                    return () => {
                        onChildChange(null, target);
                    };
                default:
                    return target[key as keyof T];
            }
        }
    }) as unknown as Reactive<T>;
}

export function observe<T extends Object>(reactive: Reactive<T>, listener: ReactiveChangeListenner) {
    reactive._onChangeListeners.push(listener);

    return {
        close: () => {
            reactive._onChangeListeners = reactive._onChangeListeners.filter((l) => l !== listener);
        },
    };
}

export function unobserveAll(reactive: Reactive) {
    reactive._onChangeListeners = [];
}