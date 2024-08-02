import { randomUUID } from 'crypto';
import got from 'got';
import * as fs from 'fs';
import FormData from 'form-data';
import { Readable } from 'stream';

async function uploadDashScopeFile(fileContent, fileMimeType) {
    let getPolicyOpts = {
        searchParams: {
            action: 'getPolicy',
            model: 'qwen-vl-chat-v1'
        },
        headers: {
            Authorization: `Bearer sk-250f5ef0e692435ab3bfd8a71e46c7fe`,
        }
    };

    // 获取上传文件凭证
    let apiUrl = `https://dashscope.aliyuncs.com/api/v1/uploads`;
    console.log(`DashScope API 请求地址：${apiUrl}`);

    let getPolicyRes = await got.get(apiUrl, getPolicyOpts).json();
    
    // 上传文件到OSS
    let policy = getPolicyRes.data?.policy;
    let signature = getPolicyRes.data?.signature;
    let uploadDir = getPolicyRes.data?.upload_dir;
    let uploadHost = getPolicyRes.data?.upload_host;
    let ossAccessKeyId = getPolicyRes.data?.oss_access_key_id;
    let xOssObjectAcl = getPolicyRes.data?.x_oss_object_acl;
    let xOssForbidOverwrite = getPolicyRes.data?.x_oss_forbid_overwrite;

    let fileName = `${randomUUID()}.${fileMimeType.split('/')[1]}`;
    let filePath = uploadDir + '/' + fileName;

    console.log({
        OSSAccessKeyId: ossAccessKeyId,
        Signature: signature,
        policy: policy,
        'x-oss-object-acl': xOssObjectAcl,
        'x-oss-forbid-overwrite': xOssForbidOverwrite,
        key: filePath,
        success_action_status: '200',
    });

    let formData = new FormData();
    formData.append('OSSAccessKeyId', ossAccessKeyId);
    formData.append('Signature', signature);
    formData.append('policy', policy);
    formData.append('x-oss-object-acl', xOssObjectAcl);
    formData.append('x-oss-forbid-overwrite', xOssForbidOverwrite);
    formData.append('key', filePath);
    formData.append('success_action_status', '200');
    formData.append('file', fileContent, {
        contentType: fileMimeType
    });

    fs.writeFileSync('debug.multipart', formData.getBuffer());

    await got.post(uploadHost, {
        body: formData.getBuffer(),
        headers: formData.getHeaders(),
    });

    return 'oss://' + filePath;
}

(async () => {
    try {
        let filePath = 'cache/qq/3524768812/img/0/03/03c73433f5ea3c501b909570957b9fa3.jpg';
        let fileContent = await fs.promises.readFile(filePath);
        let fileType = 'image/jpeg';

        await uploadDashScopeFile(fileContent, fileType);
    } catch (err) {
        console.error(err);
        
        if (err.response) {
            console.log(err.response);
        }
    }
})();