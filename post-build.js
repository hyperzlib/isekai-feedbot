import * as fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve('./src');
const DST_DIR = path.resolve('./dist');

const pluginDir = path.resolve(SRC_DIR, 'plugins');
// 遍历plugin文件夹
const pluginPaths = fs.readdirSync(pluginDir);
for (let pluginPath of pluginPaths) {
    let pluginIndexFile = path.resolve(pluginDir, pluginPath, 'plugin.yaml');
    if (fs.existsSync(pluginIndexFile)) {
        // 将plugin.yaml复制到dist/plugin/pluginName/plugin.yaml
        let pluginIndexFileDist = path.resolve(DST_DIR, 'plugins', pluginPath, 'plugin.yaml');
        fs.copyFileSync(pluginIndexFile, pluginIndexFileDist);
    }
}