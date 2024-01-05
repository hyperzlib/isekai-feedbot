import App from "../App";
import { StorageConfig } from "../Config";
import { ModelRegistry } from "../DatabaseManager";
import { ItemLimitedList } from "../utils/ItemLimitedList";
import { CommonMessage, CommonSendMessage } from "../message/Message";
import { RobotStorage } from "./RobotStorage";
import { Reactive, reactive } from "../utils/reactive";
import { debounce } from "throttle-debounce";

export class MessageStorage {
    private app: App;
    private config: StorageConfig;
    private storages: RobotStorage;
    private models?: ModelRegistry;
    private cacheTTL: number;

    private cache: ItemLimitedList<CommonMessage | undefined>;

    public constructor(app: App, config: StorageConfig, storages: RobotStorage) {
        this.app = app;
        this.config = config;
        this.cacheTTL = config.cache_ttl ?? 86400;
        this.storages = storages;

        let itemLimit = config.message?.lru_limit ?? 1000;

        this.cache = new ItemLimitedList<CommonMessage | undefined>(itemLimit);
    }

    public async initialize() {
        this.models = this.storages.models;
    }

    public async get<T extends CommonMessage = CommonMessage>(messageId: string): Promise<T | null> {
        // from cache
        let messageObj: T | null = this.cache.find((msg) => msg && msg.id === messageId) as any;
        if (messageObj) {
            return messageObj;
        }

        // from database
        if (this.models) {
            let doc = await this.models.message.findOne({
                messageId
            });

            if (doc) {
                const robot = this.storages.robot;
                if (robot) {
                    messageObj = await robot.parseDBMessage?.(doc) as any;
                    return messageObj;
                } else {
                    this.app.logger.error(`无法找到机器人配置：${this.storages.robotId}`);
                }
            }
        } else {
            this.app.logger.warn('未配置 Database');
        }

        return null;
    }
    
    /**
     * 添加或更新消息
     * @param messageId 
     * @param message 
     */
    public async set(message: CommonMessage): Promise<void> {
        let messageData = message.toDBObject();

        if (this.models) {
            await this.models.message.updateOne({
                messageId: message.id!,
            }, messageData, {
                upsert: true,
                setDefaultsOnInsert: true,
            });
        }

        this.cache.push(message);
    }

    /**
     * 将消息转换为Reactive对象（自动更新数据库）
     * @param message 
     */
    public reactive<T extends CommonMessage>(message: T): Reactive<T> {
        const messageRef = reactive(message);

        // debounce
        const onDataChanged = debounce(this.cacheTTL * 1000, async () => {
            this.app.logger.debug(`Reactive 更新消息: ${message.id}`);
            this.set(message).catch((err) => {
                this.app.logger.error(`更新消息 ${message.id} 失败：${err.message}`, err);
                console.error(err);
            });
        });

        messageRef._on('change', (key: string, val: Reactive<T>) => {
            onDataChanged();
        });

        return messageRef;
    }

    public async remove(messageId: string): Promise<void> {
        if (this.models) {
            await this.models.userInfo.deleteOne({
                messageId,
            });
        }

        let listIndex = this.cache.findIndex((msg) => msg && msg.id === messageId);
        this.cache[listIndex] = undefined;
    }

    /**
     * 标记消息为已撤回
     * @param messageId 
     */
    public async markDeleted(messageId: string): Promise<void> {
        if (this.models) {
            await this.models.message.updateOne({
                messageId,
            }, {
                deleted: true,
            });
        }

        let messageObj = this.cache.find((msg) => msg && msg.id === messageId);
        if (messageObj) {
            messageObj.deleted = true;
        }   
    }
}