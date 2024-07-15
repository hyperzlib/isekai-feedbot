import { CommonReceivedMessage } from "#ibot/message/Message";

export type FunctionCallingResponse = {
    message: string,
    directOutput?: boolean,
};

export type FunctionCallingParams = {
    name: string,
    description: string,
    required?: boolean,
    schema?: any,
};

export type FunctionCallingDefinition = {
    displayName?: string,
    description: string,
    params?: FunctionCallingParams[],
    callback?: (params: any, message?: CommonReceivedMessage) => Promise<string | FunctionCallingResponse>,
};

export class LLMFunctionContainer {
    public functions: { [name: string]: FunctionCallingDefinition } = {};

    public constructor() { }

    public register(name: string, definition: FunctionCallingDefinition) {
        this.functions[name] = definition;
    }

    public filter(callback: (name: string, definition: FunctionCallingDefinition) => boolean) {
        for (let [name, definition] of Object.entries(this.functions)) {
            if (!callback(name, definition)) {
                delete this.functions[name];
            }
        }
    }

    public async call(name: string, params: any, message?: CommonReceivedMessage): Promise<FunctionCallingResponse> {
        const func = this.functions[name];
        if (!func) {
            return {
                message: '函数不存在',
            };
        }

        if (typeof params === 'string') {
            params = params.trim();
            if (params.startsWith('{') && params.endsWith('}')) {
                try {
                    params = JSON.parse(params);
                } catch (e) {
                    return { message: '参数格式错误。' };
                }
            }
        }

        let res = await func.callback?.(params, message);

        if (typeof res === 'string') {
            return {
                message: res,
            };
        } else if (res) {
            return res;
        } else {
            return {
                message: '函数未实现',
            };
        }
    }

    public getOpenAPIToolDefinition(apiType: string = 'openai') {
        let toolList = Object.entries(this.functions).map(([key, data]) => {
            if (apiType === 'qwen') {
                let openaiFuncDef: any = {
                    name: key,
                    description: data.description,
                    parameters: data.params,
                };

                if (openaiFuncDef.displayName) {
                    openaiFuncDef.name_for_human = data.displayName;
                }

                return openaiFuncDef;
            } else { // OpenAI 格式
                let requiredParams = [];
                let paramsSchema: Record<string, any> = {};

                for (let param of data.params ?? []) {
                    const paramName = param.name;
                    paramsSchema[paramName] = {
                        description: param.description,
                        type: param.schema?.type ?? 'string',
                    };

                    if (param.required) {
                        requiredParams.push(paramName);
                    }
                }

                return {
                    type: 'function',
                    function: {
                        name: key,
                        description: data.description,
                        parameters: {
                            type: 'object',
                            properties: paramsSchema
                        },
                        required: requiredParams,
                    },
                };
            }
        });

        return toolList;
    }
}