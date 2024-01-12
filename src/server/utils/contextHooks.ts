import App from "../App";
import  { Logger } from './Logger';

export function useApp(): App {
    return (import.meta as any)._isekaiFeedbotApp;
}

export function useLogger(): Logger {
    return useApp().logger;
}

export function useEvent() {
    return useApp().event;
}

export function useCache() {
    return useApp().cache;
}

export function useStorage() {
    return useApp().storage;
}

export function useRobot() {
    return useApp().robot;
}

export function useRestfulApi() {
    return useApp().restfulApi;
}

export function useDB() {
    return useApp().database;
}