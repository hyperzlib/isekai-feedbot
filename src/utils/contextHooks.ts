import winston from "winston";
import App from "../App";

export function useApp(): App {
    return (import.meta as any)._isekaiFeedbotApp;
}

export function useLogger(): winston.Logger {
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