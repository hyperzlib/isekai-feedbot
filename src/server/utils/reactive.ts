import EventEmitter from "events";

export type Reactive<T extends Object = any> = T & {
    _on: EventEmitter['on'];
    _once: EventEmitter['once'];
    _off: EventEmitter['off'];
    _isReactive: true;
    _value: T;
    updated: () => void;
};

export function reactive<T extends Object>(obj: T): Reactive<T> {
    const eventEmitter = new EventEmitter();

    // 防止嵌套
    if ((obj as Reactive<T>)._isReactive) {
        return obj as Reactive<T>;
    }

    // 递归监听子对象
    for (let key of Object.getOwnPropertyNames(obj)) {
        if (key.startsWith('_')) continue;

        const value = obj[key as keyof T];
        if (typeof value === 'object' && (value as Reactive<{}>)._isReactive) {
            (value as Reactive<{}>)._on('change', (childKey: string, newValue: any) => {
                eventEmitter.emit('change', key, value);
                eventEmitter.emit(`change:${key}`, value);
            });
        }
    }

    return new Proxy(obj, {
        set: (target, key, value) => {
            if (!key.toString().startsWith('_') && typeof value === 'object') {
                // 递归监听子对象
                if (!value._isReactive) {
                    value = reactive(value);
                }

                value._on('change', (childKey: string, newValue: any) => {
                    eventEmitter.emit('change', key, value);
                    eventEmitter.emit(`change:${key.toString()}`, value);
                });
            }
            target[key as keyof T] = value;
            return true;
        },
        get: (target, key): any => {
            switch (key) {
                case '_on':
                    return eventEmitter.on.bind(eventEmitter);
                case '_once':
                    return eventEmitter.once.bind(eventEmitter);
                case '_off':
                    return eventEmitter.off.bind(eventEmitter);
                case '_isReactive':
                    return true;
                case '_value':
                    return target;
                case 'updated':
                    return () => {
                        eventEmitter.emit('change', null, null);
                    };
                default:
                    return target[key as keyof T];
            }
        }
    }) as unknown as Reactive<T>;
}