import { CommonReceivedMessage } from "#ibot/message/Message";
import App from "#ibot/App";
import { CommandInputArgs, PluginEvent } from "#ibot/PluginManager";
import { PluginController } from "#ibot-api/PluginController";
import { label } from "#ibot-api/dataWrapper";

export const defaultConfig = {
    messages: {
        diceFormatError: [
            '骰子格式错误：{{{error}}}',
            '输入错误：{{{error}}}',
            '错误的骰子格式：{{{error}}}',
        ]
    }
};

export default class DiceController extends PluginController<typeof defaultConfig> {
    async getDefaultConfig() {
        return defaultConfig;
    }

    public async initialize(config: any): Promise<void> {
        this.event.registerCommand({
            command: 'roll',
            name: 'DND骰子',
            alias: ['r'],
            help: '格式：|骰子数量|d|面数|(+|加成|)，示例：1d20、1d6+3'
        }, (args, message, resolved) => {
            if (message.mentionedReceiver) { // 不使用@触发
                return;
            }

            resolved();
            
            this.rollDice(args, message);
        });

        this.event.registerCommand({
            command: 'random',
            name: '随机数',
            alias: ['rand'],
            help: '格式：“最大值”或“最小值 最大值”，示例：1 100'
        }, (args, message, resolved) => {
            resolved();
            
            this.randomNumber(args, message);
        });
    }

    private async rollDice(args: CommandInputArgs, message: CommonReceivedMessage) {
        await message.markRead();

        let matches = args.param.trim().match(/^(?<diceNum>\d+)d(?<diceType>\d+)(\+(?<bonus>\d+))?/);
        if (!matches) {
            await message.sendReply('骰子格式错误');
            return;
        }

        let diceNum = parseInt(matches.groups!.diceNum);
        let diceType = parseInt(matches.groups!.diceType);
        let bonus = parseInt(matches.groups!.bonus ?? '0');

        if (diceNum > 20) {
            await message.sendReply('骰子数量不能超过20');
            return;
        }

        let results: number[] = [];
        for (let i = 0; i < diceNum; i++) {
            let roll = Math.floor(Math.random() * diceType) + 1;
            results.push(roll);
        }

        let total = results.reduce((a, b) => a + b) + bonus;
        let replyMsg = '骰子结果：'
        replyMsg += results.join('、') + '\n';
        if (bonus > 0) {
            replyMsg += `加成：${bonus}\n`;
        }
        if (results.length >= 2) {
            replyMsg += `总计：${total}`;
        }

        await message.sendReply(replyMsg);
    }

    private async randomNumber(args: CommandInputArgs, message: CommonReceivedMessage) {
        await message.markRead();
        let argv = args.param.trim().split(' ');
        if (argv.length == 0) {
            await message.sendReply('参数错误，请提供最大值或者最大值和最小值');
            return;
        }

        let maxNum = 0;
        let minNum = 0;
        if (argv.length == 1) {
            maxNum = parseInt(argv[0]);
        } else if (argv.length == 2) {
            minNum = parseInt(argv[0]);
            maxNum = parseInt(argv[1]);
        }

        if (isNaN(maxNum) || isNaN(minNum)) {
            await message.sendReply('参数错误，请提供正确的数字');
            return;
        }

        let result = Math.floor(Math.random() * (maxNum - minNum + 1)) + minNum;
        await message.sendReply(`随机数：${result}`);
    }
}