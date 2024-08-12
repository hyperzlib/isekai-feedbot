import { readFile } from "fs/promises";
import got from "got";

export function detectImageType(data: Buffer, defaultType: string = 'application/octet-stream'): string {
    if (data.length < 4) {
        return defaultType;
    }

    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
        return 'image/jpeg';
    } else if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
        return 'image/png';
    } else if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
        return 'image/gif';
    } else if (data[0] === 0x42 && data[1] === 0x4d) {
        return 'image/bmp';
    } else if (data[0] === 0x57 && data[1] === 0x45 && data[2] === 0x42 && data[3] === 0x50) {
        return 'image/webp';
    }

    return defaultType;
}

export async function loadMessageImage(url: string, loadFormNetwork: boolean = false): Promise<{ content: Buffer, type: string } | null> {
    if (url.startsWith('file://')) {
        let imagePath = url.replace('file://', '');
        let imageBuffer = await readFile(imagePath);
        let imageType = detectImageType(imageBuffer) ?? 'application/octet-stream';
        return { content: imageBuffer, type: imageType };
    } else if (url.startsWith('base64://')) {
        let base64Data = url.replace('base64://', '');
        let base64Buffer = Buffer.from(base64Data, 'base64');
        let imageType = detectImageType(base64Buffer) ?? 'application/octet-stream';
        return { content: base64Buffer, type: imageType };
    } else if (loadFormNetwork && url.match(/^(http|https):\/\//)) {
        let res = await got.get(url).buffer();
        
        let imageType = detectImageType(res) ?? 'application/octet-stream';

        return { content: res, type: imageType };
    }

    return null;
}