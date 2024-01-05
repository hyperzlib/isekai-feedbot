import fs from 'fs';
import path from 'path';

import App from './App';
import { ServiceConfig } from './Config';

export interface Service {
    initialize(): Promise<void>;
    destory(): Promise<void>;
}

export class ServiceNotExistsError extends Error {
    public serviceName: string;

    constructor(message: string, serviceName: string) {
        super(message);
        this.serviceName = serviceName;
    }
}

export class ServiceManager {
    private app: App;
    private config: ServiceConfig;

    public serviceClasses: { [key: string]: any };
    public services: { [key: string]: Service };

    constructor(app: App, config: ServiceConfig) {
        this.app = app;
        this.config = config;

        this.serviceClasses = {};
        this.services = {};
    }

    public async initialize() {
        const SERVICE_PATH = path.join(this.app.srcPath, "service");

        for (let file of fs.readdirSync(SERVICE_PATH)) {
            let serviceFile = `${SERVICE_PATH}/${file}`;
            if (serviceFile.match(/\.(js|mjs)$/)) {
                // 加载js文件
                let serviceName = path.basename(serviceFile).replace(/Service\.(js|mjs)$/gi, "").toLocaleLowerCase();
                try {
                    let serviceClass = await import(serviceFile);
                    if (!serviceClass || !serviceClass.default) {
                        throw new Error("service is empty");
                    }
                    this.serviceClasses[serviceName] = serviceClass.default;
                } catch(err) {
                    this.app.logger.error(`无法加载Service: ${serviceName}`, err);
                }
            }
        }

        for (let serviceName in this.config) {
            let serviceConfig = this.config[serviceName];
            let serviceType: string = serviceConfig.type;
            if (!serviceType) {
                console.error(`无法加载 ${serviceName} Service: 配置文件中未定义 'type'`);
                continue;
            }
            serviceType = serviceType.toLocaleLowerCase();
            if (serviceType in this.serviceClasses) {
                let serviceClass = this.serviceClasses[serviceType];
                try {
                    let serviceObject: Service = new serviceClass(this.app, serviceConfig);
                    await serviceObject.initialize();
                    this.services[serviceName] = serviceObject;
                    this.app.logger.info(`已加载Service: ${serviceName}`);
                } catch(err) {
                    console.error(`无法加载 ${serviceName} Service: `, err);
                }
            } else {
                console.error(`无法加载 ${serviceName} Service: Service 不存在`);
            }
        }
    }

    public get<T extends Service>(name: string): T {
        if (name in this.services) {
            return this.services[name] as T;
        } else {
            throw new ServiceNotExistsError(`Service ${name} not exists`, name);
        }
    }
}
