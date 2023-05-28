import winston from "winston";
import App from "../App";

export function useApp(): App {
    return (import.meta as any)._isekaiFeedbotApp;
}

export function useLogger(): winston.Logger {
    return useApp().logger;
}

export function useEventManager() {
    return useApp().event;
}

export function useSessionManager() {
    return useApp().session;
}

export function useRobotManager() {
    return useApp().robot;
}

export function useRestfulApiManager() {
    return useApp().restfulApi;
}

export function useDB() {
    return useApp().database;
}