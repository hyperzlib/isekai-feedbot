import App from "../App";
import { buildChatIdentityQuery, toChatIdentityEntity } from "../orm/Message";
import { PluginController, PluginEvent } from "../PluginManager";
import { TestSchema } from "./test/TestSchema";

export default class TestController implements PluginController {
    public event!: PluginEvent;
    public app: App;

    public id = 'test';
    public name = '测试功能';
    public description = '测试功能控制器';

    constructor(app: App) {
        this.app = app;
    }

    async initialize() {
        this.event.init(this);

        const dbi = this.app.database;
        if (!dbi) return;

        const TestModel = dbi.getModel('Test', TestSchema);

        this.event.registerCommand({
            command: '写入',
            name: '写入数据库',
        }, (args, message, resolve) => {
            resolve();
            
            return (async () => {
                let obj = new TestModel({
                    chatIdentity: toChatIdentityEntity(message.sender.identity),
                    data: args,
                });

                await obj.save();
            })();
        });

        this.event.registerCommand({
            command: '读取',
            name: '读取数据库',
        }, async (args, message, resolve) => {
            resolve();

            let obj = await TestModel.findOne(buildChatIdentityQuery(message.sender.identity));
        });
    }
}