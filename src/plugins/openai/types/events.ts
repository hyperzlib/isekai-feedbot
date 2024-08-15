import { LLMFunctionContainer } from "../api/LLMFunction";

export type OpenAIGetLLMFunctions = { 'openai/get_llm_functions': (functionContainer: LLMFunctionContainer) => any };
export type OpenAIGetGlobalLLMFunctions = { 'openai/get_global_llm_functions': (functionContainer: LLMFunctionContainer) => any };