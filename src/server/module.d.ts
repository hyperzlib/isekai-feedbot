declare module 'yaml' {
    export function parse(str: string): any;
    export function stringify(obj: any): string;
}

declare module '@waylaidwanderer/chatgpt-api';