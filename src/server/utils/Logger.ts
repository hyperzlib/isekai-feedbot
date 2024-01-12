import winston from "winston";

export class Logger {
    private _logger: winston.Logger;
    private tag: string;

    constructor(baseLogger: winston.Logger, tag: string) {
        this._logger = baseLogger;
        this.tag = tag;
    }

    public debug(message: string, ...meta: any[]) {
        this._logger.debug(message, { tag: this.tag }, ...meta);
    }

    public warn(message: string, ...meta: any[]) {
        this._logger.warn(message, { tag: this.tag }, ...meta);
    }

    public info(message: string, ...meta: any[]) {
        this._logger.info(message, { tag: this.tag }, ...meta);
    }

    public error(message: string, error?: Error, ...meta: any[]): void
    public error(error?: Error | unknown, ...meta: any[]): void
    public error(...args: any[]): void {
        if (args.length === 0) return;
        let message = 'Error';
        let error: Error | undefined;
        let metaOffset = 1;

        if (args[0] instanceof Error) {
            message = 'Error: ' + args[0].message;
            error = args[0];
        } else if (typeof args[0] === 'string') {
            message = args[0];
        }

        if (args[1] instanceof Error) {
            error = args[1];
            metaOffset = 2;
        }

        let meta = args.slice(metaOffset);

        this._logger.error(message, { tag: this.tag, stack: error?.stack }, ...meta);
        if (error) {
            this._logger.error(error);
        }
    }
}