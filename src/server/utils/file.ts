export function detectImageType(data: Buffer) {
    if (data.length < 4) {
        return null;
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

    return null;
}