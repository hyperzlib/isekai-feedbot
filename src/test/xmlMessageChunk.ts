import { messageChunksToXml, parseMessageChunksFromXml } from "#ibot/utils";

let messageChunk = parseMessageChunksFromXml(`<mention userId="0"/> {{nickname}}开播了！

《{{title}}》<newmsg>

<image url="https://isekai-images.oss-accelerate.aliyuncs.com/2024/07/06/6688ec610fe39.jpg" alt="53675e91f130370903ef06c29242b7a2" :subType="1"/>`, true);
console.log('parsed: ', messageChunk);

// let xml = messageChunksToXml(messageChunk);
// console.log('rebuild xml:', xml);