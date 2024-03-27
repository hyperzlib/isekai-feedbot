import { FSWatcher, watch } from "chokidar";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import Yaml from "yaml";

export class ReactiveConfig<T extends {}> {
    public _value?: T;
    public _default: T;

    private saving: boolean = false;

    private fileName: string;
    private eventEmitter: EventEmitter;
    private fileWatcher?: FSWatcher;

    private lazySaveTimer?: NodeJS.Timeout;

    constructor(fileName: string, defaultVal: T) {
        this._default = defaultVal;
        this.fileName = fileName;
        this.eventEmitter = new EventEmitter();
    }

    public get value(): T {
        return this._value ?? this._default;
    }

    public set value(newVal: T | undefined) {
        this._value = newVal;
    }

    public on(eventName: 'load', listener: () => void): void
    public on(eventName: 'change', listener: (newValue: T, oldValue: T) => void): void
    public on(eventName: 'saved', listener: (value: T) => void): void
    public on(eventName: string, listener: (...args: any[]) => void) {
        this.eventEmitter.on(eventName, listener);
    }

    public async destory() {
        this.fileWatcher?.close();
    }

    public initWatcher() {
        this.fileWatcher = watch(this.fileName, {
            ignoreInitial: true,
            ignorePermissionErrors: true,
            persistent: true,
        });

        this.fileWatcher.on('change', () => {
            if (!this.saving) {
                this.load();
            } else {
                this.saving = false;
            }
        });
    }

    /**
     * 
     * @returns 
     */
    public async load() {
        if (!this.fileWatcher) {
            this.initWatcher();
        }

        let oldValue = this.value;
        if (existsSync(this.fileName)) {
            let content = await readFile(this.fileName, { encoding: 'utf-8' });
            this._value = Yaml.parse(content);

            if (oldValue) {
                this.eventEmitter.emit('change', this._value, oldValue);
            } else {
                this.eventEmitter.emit('load');
            }
            return true;
        } else {
            return false;
        }
    }

    public async save() {
        if (this._value) {
            this.saving = true;
            await writeFile(this.fileName, Yaml.stringify(this._value));
            this.eventEmitter.emit('saved', this._value);
            return true;
        }
        return false;
    }

    public lazySave() {
        if (this._value) {
            if (!this.lazySaveTimer) {
                this.lazySaveTimer = setTimeout(() => {
                    this.save();
                    this.lazySaveTimer = undefined;
                }, 1000);
            }
        }
    }
}