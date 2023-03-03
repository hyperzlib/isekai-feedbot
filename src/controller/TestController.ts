import App from "../App";
import { PluginController, PluginEvent } from "../PluginManager";

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

        this.event.registerCommand({
            command: '写入全局',
            name: '写入全局Session',
        }, (args, message, resolve) => {
            resolve();

            message.session.global.set('_test', args);
        });

        this.event.registerCommand({
            command: '写入群组',
            name: '写入群组Session',
        }, (args, message, resolve) => {
            resolve();

            message.session.group.set('_test', args);
        });

        this.event.registerCommand({
            command: '写入对话',
            name: '写入对话Session',
        }, (args, message, resolve) => {
            resolve();

            message.session.chat.set('_test', args);
        });

        this.event.registerCommand({
            command: '读取',
            name: '读取Session',
        }, async (args, message, resolve) => {
            resolve();

            let globalSession = await message.session.global.get('_test');
            let groupSession = await message.session.group.get('_test');
            let chatSession = await message.session.chat.get('_test');
            
            message.sendReply(`全局Session: ${globalSession}\n群组Session: ${groupSession}\n对话Session: ${chatSession}`);
        });
    }
}