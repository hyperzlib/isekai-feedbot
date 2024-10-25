import { BASE_MESSAGE_CHUNK_TYPES, MessageChunk } from "../message/Message";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { camelCaseToHyphen } from "./helpers";

export function getMessageChunkBaseType(chunk: MessageChunk): string {
    for (let type of chunk.type) {
        if (BASE_MESSAGE_CHUNK_TYPES.includes(type)) {
            return type;
        }
    }

    return 'raw';
}

/**
 * Convert message chunks to XML string (for template system)
 * @param chunks 
 * @returns 
 */
export function messageChunksToXml(chunks: MessageChunk[]): string {
    let root: any[] = [];
    for (let el of chunks) {
        if (el.type.includes('text')) {
            let node = {
                '#text': el.text,
            };
            root.push(node);
        } else {
            let baseType = getMessageChunkBaseType(el);
            let node: any = {};
            node[baseType] = [];

            let attrs: Record<string, string> = {};

            if (el.type.length > 1) {
                // 添加type信息
                let variantType = el.type.filter((type) => type !== baseType);
                attrs.type = variantType.join(' ');
            }

            if (el.text) {
                node['#text'] = el.text;
            }

            if (el.data) {
                for (let key in el.data) {
                    const value = el.data[key];
                    if (typeof value === 'string') {
                        attrs[key] = value;
                    } else {
                        attrs[`:${key}`] = JSON.stringify(value);
                    }
                }
            }

            if (Object.keys(attrs).length > 0) {
                node[':@'] = attrs;
            }

            root.push(node);
        }
    }

    let builder = new XMLBuilder({
        preserveOrder: true,
        ignoreAttributes: false,
        suppressEmptyNode: true,
        attributeNamePrefix: '',
        unpairedTags: ['newmsg'],
    });

    let wrappedXml = builder.build([
        {
            "message": root
        }
    ]);

    let xml = wrappedXml.replace(/^<message>|<\/message>$/g, '');

    return xml;
}

function getFxpNodeName(node: any): string {
    for (let key of Object.keys(node)) {
        if (key !== ':@') {
            return key as string;
        }
    }
    return '';
}

/**
 * Parse message chunks from XML string (for template system)
 * @param xml 
 * @returns 
 */
export function parseMessageChunksFromXml(xml: string): MessageChunk[]
export function parseMessageChunksFromXml(xml: string, multiMessage: false): MessageChunk[]
export function parseMessageChunksFromXml(xml: string, multiMessage: true): MessageChunk[][]
export function parseMessageChunksFromXml(xml: string, multiMessage: boolean = false): MessageChunk[] | MessageChunk[][] {
    let parser = new XMLParser({
        preserveOrder: true,
        trimValues: false,
        ignoreAttributes: false,
        attributeNamePrefix: '',
        removeNSPrefix: false,
        unpairedTags: ['newmsg'],
    });
    let chunksGroup: MessageChunk[][] = [];
    let chunks: MessageChunk[] = [];

    let wrappedXml = `<message>${xml}</message>`;

    let prevType = '';
    let parsedXml = parser.parse(wrappedXml);
    let root = parsedXml[0]?.message;
    if (!root) {
        return [];
    }

    for (let node of root) {
        if ('#text' in node) { // 文本内容
            let textContent = node['#text'] ?? '';

            if (prevType === 'newmsg') {
                // 如果之前是newmsg，删除第一个换行
                textContent = textContent.replace(/^\n/, '');
            }

            if (textContent === '') { // 跳过空文本
                continue;
            }

            if (prevType === 'text') {
                // 合并相邻的文本节点
                let lastChunk = chunks[chunks.length - 1];
                lastChunk.text! += textContent;
            } else {
                chunks.push({
                    type: ['text'],
                    text: textContent,
                    data: {},
                });
                prevType = 'text';
            }
        } else { // 元素节点
            let tagType = getFxpNodeName(node);
            if (!tagType) {
                continue;
            }

            if (tagType === 'newmsg') {
                // 切分消息或换行
                if (multiMessage) { // 多消息模式，切分消息
                    if (chunks.length) {
                        chunksGroup.push(chunks);
                        chunks = [];
                    }
                } else { // 单消息模式，换行
                    if (chunks.length) {
                        chunks.push({
                            type: ['text'],
                            text: '\n',
                            data: {},
                        });
                    }
                }
            } else {
                let attrs = node[':@'] ?? {};
                let variantType = attrs.type ?? [];
                let fullType: string[] = [tagType, ...variantType];

                let text = node['#text'] ?? '';
                let data: Record<string, any> = {};
                for (let key in attrs) {
                    let value = attrs[key];
                    if (key.startsWith(':')) {
                        // 特殊类型
                        try {
                            key = key.slice(1);
                            value = JSON.parse(value);
                            data[key] = value;
                        } catch (e) {
                            console.error('Failed to parse special type attribute:', e);
                        }
                    } else {
                        data[key] = value;
                    }
                }

                chunks.push({
                    type: fullType,
                    text: text,
                    data: data
                });
            }

            prevType = tagType;
        }
    }

    // 去除消息开头和结尾的换行
    for (const item of chunksGroup) {
        if (item.length > 0) {
            if (item[0].type.includes('text')) {
                const firstItem = item[0];
                firstItem.text = firstItem.text!.replace(/^\n+/, '');
            }
            if (item[item.length - 1].type.includes('text')) {
                const lastItem = item[item.length - 1];
                lastItem.text = lastItem.text!.replace(/\n+$/, '');
            }
        }
    }

    if (multiMessage) {
        if (chunks.length) {
            chunksGroup.push(chunks);
            chunks = [];
        }

        // 过滤空消息
        chunksGroup = chunksGroup.filter((chunks) => {
            if (chunks.length === 0) { // 空节点
                return false;
            }

            if (chunks[0].type.includes('text') && chunks[0].text!.trim() === '') { // 仅有空白文本
                return false;
            }

            return true;
        });

        return chunksGroup;
    } else {
        return chunks;
    }
}