import App from "#ibot/App";
import { CommonReceivedMessage } from "#ibot/message/Message";
import { fetchEventSource, FetchEventSourceInit } from "@waylaidwanderer/fetch-event-source";
import ChatGPTController, { ChatCompleteApiConfig, ChatGPTApiMessage, ChatGPTMessageInfo } from "../PluginController";
import { ProxyAgent } from "undici"; 
import { encode as gptEncode } from 'gpt-3-encoder';
import { asleep, Logger, MessageTypingSimulator } from "#ibot/utils";
import got, { OptionsOfTextResponseBody } from "got";
import { HttpsProxyAgent } from "hpagent";
import { randomInt } from "crypto";
import { LLMFunctionContainer } from "./LLMFunction";

export type ChatGPTApiResponse = {
    messageList: ChatGPTMessageInfo[],
    outputMessage: string,
    totalTokens: number,
};

export type RequestChatCompleteOptions = {
    receivedMessage?: CommonReceivedMessage
    llmFunctions?: LLMFunctionContainer,
    onMessage?: (chunk: string) => any,
};

export const defaultRequestChatCompleteOptions = {
    functionCall: true,
};

export class ChatGPTAPIError extends Error {
    public code: string;

    constructor(message: string, code: string, public json?: any) {
        super(message);
        this.name = 'ChatGPTAPIError';
        this.code = code;
    }
}

export class ChatCompleteApi {
    public app: App;
    public mainController: ChatGPTController;
    private logger: Logger;

    public constructor(app: App, mainController: ChatGPTController) {
        this.app = app;
        this.mainController = mainController;
        this.logger = mainController.logger;
    }

    private toApiMessageList(messageList: ChatGPTApiMessage[]) {
        return messageList.map((message) => {
            let newMessage: any = { ...message }
            delete newMessage.token;
            return newMessage;
        });
    }

    private getChatCompleteApiUrl(apiConf: ChatCompleteApiConfig): string {
        switch (apiConf.type) {
            case 'openai':
                return `${apiConf.endpoint}/v1/chat/completions`;
            case 'azure':
                return `${apiConf.endpoint}/openai/deployments/${apiConf.deployment}/chat/completions?api-version=2023-05-15`;
        }

        throw new Error('Unknown API type: ' + apiConf.type);
    }

    public async doApiRequest(messageList: any[], apiConf?: ChatCompleteApiConfig, options: RequestChatCompleteOptions = {}): Promise<ChatGPTApiResponse> {
        if (!apiConf) {
            let characterConf = this.mainController.getCharacterConfig(this.mainController.DEFAULT_CHARACTER);
            apiConf = this.mainController.getApiConfigById(characterConf.api);
        }

        options = {
            ...defaultRequestChatCompleteOptions,
            ...options
        };

        switch (apiConf.type) {
            case 'openai':
            case 'azure':
                return await this.doOpenAILikeApiRequest(messageList, apiConf, options);
        }

        throw new Error('Unknown API type: ' + apiConf.type);
    }

    private async internalOpenAILikeStreamApiRequest(modelOpts: any, messageList: ChatGPTMessageInfo[], apiConf: ChatCompleteApiConfig,
        options: RequestChatCompleteOptions): Promise<ChatGPTApiResponse> {
        
        // Stream API 暂且不支持function call
        let opts: FetchEventSourceInit = {
            method: 'POST',
            body: JSON.stringify({
                ...modelOpts,
                messages: this.toApiMessageList(messageList),
                stream: true,
            }),
        };

        if (apiConf.type === 'openai') {
            opts.headers = {
                Authorization: `Bearer ${apiConf.token}`,
                'Content-Type': 'application/json',
            };
        } else if (apiConf.type === 'azure') {
            opts.headers = {
                "api-key": apiConf.token,
                "content-type": 'application/json',
            }
        }

        const proxyConfig = apiConf.proxy ?? this.mainController.config.proxy;
        if (proxyConfig) {
            (opts as any).dispatcher = new ProxyAgent(proxyConfig);
        }

        let abortController = new AbortController();

        let timeoutTimer = setTimeout(() => {
            abortController.abort();
        }, 30000);

        let buffer: string = '';
        let messageChunk: string[] = [];
        let isStarted = false;
        let isDone = false;
        let prevEvent: any = null;

        let messageTyping = new MessageTypingSimulator();

        messageTyping.on('message', (message: string) => {
            options.onMessage?.(message);
        });

        const flush = (force = false) => {
            if (force) {
                let message = buffer.trim();
                messageChunk.push(message);
                messageTyping.pushMessage(message);
            } else {
                if (buffer.indexOf('\n\n') !== -1 && buffer.length > apiConf.buffer_size) {
                    let splitPos = buffer.indexOf('\n\n');
                    let message = buffer.slice(0, splitPos);
                    messageChunk.push(message);
                    messageTyping.pushMessage(message);
                    buffer = buffer.slice(splitPos + 2);
                }
            }
        }

        const onClose = () => {
            abortController.abort();
            clearTimeout(timeoutTimer);
        }

        const apiUrl = this.getChatCompleteApiUrl(apiConf);
        this.app.logger.debug(`ChatGPT API 请求地址：${apiUrl}`);

        let unfinished = false;

        await fetchEventSource(apiUrl, {
            ...opts,
            signal: abortController.signal,
            onopen: async (openResponse) => {
                if (openResponse.status === 200) {
                    return;
                }
                if (this.app.debug) {
                    console.debug(openResponse);
                }
                let error;
                try {
                    let body = await openResponse.text();
                    if (body.length > 0 && body[0] === '{') {
                        body = JSON.parse(body);
                    }
                    error = new ChatGPTAPIError(`Failed to send message. HTTP ${openResponse.status}`,
                        openResponse.status.toString(), body);
                } catch {
                    error = error || new Error(`Failed to send message. HTTP ${openResponse.status}`);
                }
                throw error;
            },
            onclose: () => {
                if (this.app.debug) {
                    this.app.logger.debug('Server closed the connection unexpectedly, returning...');
                }
                if (!isDone) {
                    if (!prevEvent) {
                        throw new Error('Server closed the connection unexpectedly. Please make sure you are using a valid access token.');
                    }
                    if (buffer.length > 0) {
                        flush(true);
                    }
                }
            },
            onerror: (err) => {
                // rethrow to stop the operation
                throw err;
            },
            onmessage: (eventMessage) => {
                if (!eventMessage.data || eventMessage.event === 'ping') {
                    return;
                }

                if (eventMessage.data === '[DONE]') {
                    flush(true);
                    onClose();
                    isDone = true;
                    return;
                }

                try {
                    const data = JSON.parse(eventMessage.data);
                    if ("choices" in data && data.choices.length > 0) {
                        const choice = data.choices[0];
                        
                        var delta_content = choice.delta;
                        if (delta_content.content) {
                            var deltaMessage = delta_content.content;

                            // 跳过输出前的空行
                            if (!isStarted) {
                                if (deltaMessage.replace("\n", "") == "") {
                                    return;
                                } else {
                                    isStarted = true;
                                }
                            }

                            buffer += deltaMessage;
                            flush();
                        }
                    }
                    prevEvent = data;
                } catch (err) {
                    console.debug(eventMessage.data);
                    console.error(err);
                }
            }
        });

        let message = messageChunk.join('');
        let tokens = gptEncode(message).length;

        messageList = [
            ...messageList,
            {
                role: 'assistant',
                content: message,
                tokens: tokens,
            }
        ];

        if (!unfinished) {
            return {
                messageList: messageList,
                outputMessage: message,
                totalTokens: tokens,
            };
        }

        throw new ChatGPTAPIError('API请求失败', 'api_request_failed');
    }

    private async internalOpenAILikeApiRequest(modelOpts: any, messageList: ChatGPTMessageInfo[], apiConf: ChatCompleteApiConfig,
        options: RequestChatCompleteOptions): Promise<ChatGPTApiResponse> {
        
        let maxRounds = 1;

        let functionFilter: string[] | undefined = undefined;
        if (Array.isArray(options.llmFunctions)) {
            functionFilter = options.llmFunctions;
        }
        
        if (options.llmFunctions) {
            let toolList = options.llmFunctions.getOpenAPIToolDefinition(apiConf.type);
            if (toolList.length > 0) {
                modelOpts.tools = toolList;
                maxRounds = 5; // 最多5轮对话
            }
        }

        for (let i = 0; i < maxRounds; i++) {
            let opts: OptionsOfTextResponseBody = {
                json: {
                    ...modelOpts,
                    messages: this.toApiMessageList(messageList),
                },

                timeout: 30000,
            };

            if (apiConf.type === 'openai') {
                opts.headers = {
                    Authorization: `Bearer ${apiConf.token}`,
                };
            } else if (apiConf.type === 'azure') {
                opts.headers = {
                    "api-key": apiConf.token,
                }
            }

            const proxyConfig = apiConf.proxy ?? this.mainController.config.proxy;
            if (proxyConfig) {
                opts.agent = {
                    https: new HttpsProxyAgent({
                        keepAlive: true,
                        keepAliveMsecs: 1000,
                        maxSockets: 256,
                        maxFreeSockets: 256,
                        scheduling: 'lifo',
                        proxy: proxyConfig,
                    }) as any,
                }
            }

            const apiUrl = this.getChatCompleteApiUrl(apiConf);
            this.app.logger.debug(`ChatGPT API 请求地址：${apiUrl}`);

            const res = await got.post(apiUrl, opts).json<any>();

            if (res.error) {
                throw new ChatGPTAPIError(res.message, res.type);
            }
            if (res.choices && Array.isArray(res.choices) && res.choices.length > 0) {
                const firstChoice = res.choices[0];
                this.logger.debug('ChatGPT 返回：' + JSON.stringify(firstChoice, null, 2));

                if (firstChoice.finish_reason === 'function_call') {
                    if (firstChoice.message?.content) { // 输出调用前的提示
                        options.onMessage?.(firstChoice.message.content);
                    }
                    
                    if (firstChoice.message?.function_call) {
                        let completion_tokens = res.usage?.completion_tokens ?? gptEncode(firstChoice.message.content).length;

                        const funcName = firstChoice.message.function_call.name;
                        const funcParams = firstChoice.message.function_call.arguments;

                        this.logger.debug(`开始函数调用：${funcName}(${funcParams})`);
                        const funcResponse = await options.llmFunctions?.call(funcName, funcParams, options.receivedMessage) ?? {
                            message: '函数未实现',
                        };
                        let funcResponseTokens = gptEncode(funcResponse.message).length;
                        this.logger.debug(`函数调用结果：${funcResponse.message}`);

                        messageList.push(
                            {
                                ...firstChoice.message,
                                tokens: completion_tokens,
                            },
                            {
                                role: 'function',
                                content: funcResponse.message,
                                tokens: funcResponseTokens,
                            }
                        );

                        // 开始下一轮对话
                    }
                } else if (firstChoice.finish_reason === 'tool_calls') { // 新版API
                    let completion_tokens = res.usage?.completion_tokens ?? 0;

                    if (firstChoice.message?.content) { // 输出调用前的提示
                        options.onMessage?.(firstChoice.message.content);
                    }

                    if (firstChoice.message?.tool_calls) {
                        messageList.push({
                            ...firstChoice.message,
                            content: firstChoice.message.content ?? '',
                            tokens: completion_tokens
                        });

                        for (let toolCall of firstChoice.message.tool_calls) {
                            if (toolCall.type === 'function') {
                                const functionName = toolCall.function.name;
                                const functionParams = toolCall.function.arguments;

                                this.logger.debug(`开始函数调用：${functionName}(${functionParams})`);
                                const funcResponse = await options.llmFunctions?.call(functionName, functionParams, options.receivedMessage) ?? {
                                    message: '函数未实现',
                                };
                                this.logger.debug(`函数调用结果：${funcResponse.message}`);

                                let funcResponseTokens = gptEncode(funcResponse.message).length;

                                let toolResult: ChatGPTMessageInfo = {
                                    role: 'tool',
                                    name: functionName,
                                    content: funcResponse.message,
                                    tokens: funcResponseTokens,
                                };

                                if (toolCall.id) {
                                    toolResult.tool_call_id = toolCall.id;
                                }

                                messageList.push(toolResult);
                            }
                        }
                    }
                } else if (typeof firstChoice.message?.content === 'string') {
                    let completions: string = firstChoice.message.content;
                    let completion_tokens: number = res.usage?.completion_tokens ?? gptEncode(completions).length;

                    completions = completions.replace(/(^\n+|\n+$)/g, '');

                    if (options.onMessage) {
                        // 模拟流式输出
                        let buffer = '';

                        function flush() {
                            buffer = buffer.replace(/(^\n+|\n+$)/g, '');
                            if (buffer.length > 0) {
                                options.onMessage!(buffer);
                            }
                        }

                        for (const line of completions.split('\n\n')) {
                            buffer += line + '\n';
                            if (buffer.length > 100) {
                                flush();

                                await asleep(randomInt(1500, 2500));

                                buffer = '';
                            }
                        }

                        flush();
                    }

                    messageList = [
                        ...messageList,
                        {
                            role: 'assistant',
                            content: completions,
                            tokens: completion_tokens,
                        }
                    ];

                    return {
                        messageList: messageList,
                        outputMessage: completions,
                        totalTokens: completion_tokens,
                    };
                }
            }
        }
        throw new ChatGPTAPIError('API请求失败或对话轮数超出限制。', 'api_request_failed');
    }

    public async doOpenAILikeApiRequest(messageList: any[], apiConf: ChatCompleteApiConfig, options: RequestChatCompleteOptions): Promise<ChatGPTApiResponse> {
        let modelOpts = Object.fromEntries(Object.entries({
            model: apiConf.model_options.model,
            temperature: apiConf.model_options.temperature,
            top_p: apiConf.model_options.top_p,
            max_tokens: apiConf.model_options.max_output_tokens,
            presence_penalty: apiConf.model_options.presence_penalty,
            frequency_penalty: apiConf.model_options.frequency_penalty,
        }).filter((data) => data[1]));

        if (options.onMessage && !apiConf.disable_stream) { // 流式输出
            return await this.internalOpenAILikeStreamApiRequest(modelOpts, messageList, apiConf, options);
        } else {
            return await this.internalOpenAILikeApiRequest(modelOpts, messageList, apiConf, options);
        }
    }
}