import { FSWatcher, watch } from "chokidar";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import Yaml from "yaml";

export class ReactiveConfig<T extends {}> {
    public _value?: T;
    public _default: T;

    private parserType: string;

    private _loaded: boolean = false;

    private saving: boolean = false;

    private fileName: string;
    private eventEmitter: EventEmitter;
    private fileWatcher?: FSWatcher;

    private lazySaveTimer?: NodeJS.Timeout;

    constructor(fileName: string, defaultVal: T) {
        this._default = defaultVal;
        this.fileName = fileName;
        this.eventEmitter = new EventEmitter();

        if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
            this.parserType = 'yaml';
        } else {
            this.parserType = 'json';
        }
    }

    public get value(): T {
        return this._value ?? this._default;
    }

    public set value(newVal: T | undefined) {
        this._value = newVal;
    }

    public get loaded() {
        return this._loaded;
    }

    public on(eventName: 'load', listener: () => void): void
    public on(eventName: 'change', listener: (newValue: T, oldValue: T) => void): void
    public on(eventName: 'saved', listener: (value: T) => void): void
    public on(eventName: string, listener: (...args: any[]) => void) {
        this.eventEmitter.on(eventName, listener);
    }

    public async initialize(autoCreate: boolean = true) {
        let isSuccess = await this.load();
        if (!isSuccess && autoCreate) {
            this._value = this._default;
            await this.save();
        }
        this._loaded = true;
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
     * Load the config file
     * @returns 
     */
    public async load() {
        if (!this.fileWatcher) {
            this.initWatcher();
        }

        let oldValue = this.value;
        if (existsSync(this.fileName)) {
            let content = await readFile(this.fileName, { encoding: 'utf-8' });
            if (this.parserType === 'json') {
                this._value = JSON.parse(content);
            } else {
                this._value = Yaml.parse(content);
            }

            if (oldValue) {
                this.eventEmitter.emit('change', this._value, oldValue);
            } else {
                this.eventEmitter.emit('load');
            }
            this._loaded = true;
            return true;
        } else {
            return false;
        }
    }

    public async save() {
        if (this._value) {
            this.saving = true;

            let content: string;
            if (this.parserType === 'json') {
                content = JSON.stringify(this._value, null, 4);
            } else {
                content = Yaml.stringify(this._value);
            }

            await writeFile(this.fileName, content);
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