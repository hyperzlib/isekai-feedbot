export type AnyFunction = (...args: any) => any;

export type Pair<T1, T2> = [T1, T2];

export type LiteralUnion<T extends U, U = string> = T | (U & { zz_IGNORE_ME?: never })