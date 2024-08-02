import { PluginController } from "#ibot-api/PluginController";
import { CacheStore } from "#ibot/CacheManager";
import { RestfulContext } from "#ibot/RestfulApiManager";
import { randomUUID } from "crypto";
import { Next } from "koa";

const defaultConfig = {};

export type FileMetaData = {
    mimeType: string,
    createdTime?: number,
}

export default class PublicAssetsController extends PluginController<typeof defaultConfig> {
    private fileStorage!: CacheStore;

    public async initialize(config: any): Promise<void> {
        this.fileStorage = this.app.cache.getStore(['public-assets']);

        this.app.restfulApi.router.get('/public/assets/:fileId', this.apiGetAsset.bind(this));
    }

    public async apiGetAsset(ctx: RestfulContext, next: Next) {
        let fileId = ctx.params.fileId;
        // 删除后缀名
        fileId = fileId.replace(/\.\w+$/, '');
        
        let fileContentData = await this.fileStorage.get<{ type: string, data: number[] }>(fileId);
        if (!fileContentData) {
            ctx.status = 404;
            ctx.body = {
                status: 0,
                message: 'File not found',
            };
            await next();
            return;
        }

        let fileContent = Buffer.from(new Uint8Array(fileContentData.data));

        let fileMeta = await this.fileStorage.get<FileMetaData>(`${fileId}:meta`);

        if (fileMeta) {
            ctx.type = fileMeta.mimeType;
            ctx.lastModified = new Date(fileMeta.createdTime!);
            ctx.etag = fileId;
        } else {
            ctx.type = 'application/octet-stream';
        }

        ctx.body = fileContent;

        await next();
    }

    /**
     * 创建临时资源
     * @param fileContent 文件内容
     * @param fileMetaData 文件Meta信息
     * @param expireTime 过期时间
     * @returns 
     */
    public async createAsset(fileContent: Buffer, fileMetaData?: FileMetaData, expireTime: number = 5 * 60): Promise<{ fileId: string, url: string }> {
        const fileId = randomUUID();
        
        fileMetaData ??= {
            mimeType: 'application/octet-stream',
        }

        fileMetaData.createdTime = Date.now();

        await this.fileStorage.set(fileId, fileContent, expireTime);
        await this.fileStorage.set(`${fileId}:meta`, fileMetaData, expireTime);

        // 返回URL
        let publicAddress = this.app.restfulApi.publicAddress.replace(/\/$/, '') + '/public/assets/' + fileId;

        return {
            fileId,
            url: publicAddress,
        };
    }
}