import App from "./App";

export type RoleConfig = {
    name: string,
    roleBinding: string[],
    accessLevel: number,
}

export class RoleManager {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }
}