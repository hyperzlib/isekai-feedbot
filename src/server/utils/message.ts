import { BASE_MESSAGE_CHUNK_TYPES, MessageChunk } from "../message/Message";
import { JSDOM } from "jsdom";
import { camelCaseToHyphen, hyphenToCamelCase } from "./helpers";

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
    let dom = new JSDOM();
    let document = dom.window.document;
    for (let el of chunks) {
        if (el.type.includes('text')) {
            let text = document.createTextNode(el.text ?? '');
            document.body.appendChild(text);
        } else {
            let baseType = getMessageChunkBaseType(el);
            let elNode = document.createElement(baseType);

            if (el.type.length > 1) {
                // 添加type信息
                let variantType = el.type.filter((type) => type !== baseType);
                elNode.setAttribute('type', variantType.join(' '));
            }

            if (el.text) {
                elNode.textContent = el.text;
            }

            if (el.data) {
                for (let key in el.data) {
                    const value = el.data[key];
                    let attrKey = camelCaseToHyphen(key);
                    switch (typeof value) { // 根据数据类型，在属性名前添加前缀
                        case 'boolean':
                            elNode.setAttribute(`:${attrKey}`, value ? 'true' : 'false');
                            break;
                        case 'number':
                            elNode.setAttribute(`:${attrKey}`, value.toString());
                            break;
                        case 'object':
                            elNode.setAttribute(`:${attrKey}`, JSON.stringify(value));
                            break;
                        default:
                            elNode.setAttribute(attrKey, value);
                    }
                }
            }

            document.body.appendChild(elNode);
        }
    }

    return document.body.innerHTML;
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
    let dom = new JSDOM(xml);
    let document = dom.window.document;
    let chunksGroup: MessageChunk[][] = [];
    let chunks: MessageChunk[] = [];

    const stdHtmlElMap: Record<string, string> = {
        img: 'image',
    };

    let prevType = '';
    for (let node of document.body.childNodes) {
        if (node.nodeType === 3 /* Node.TEXT_NODE */) {
            let textContent = node.textContent ?? '';

            if (prevType === 'br') {
                // 如果之前是br，删除第一个换行
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
        } else if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
            const el = node as Element;
            let tagType = el.tagName.toLowerCase();
            tagType = stdHtmlElMap[tagType] ?? tagType;

            if (tagType === 'br') {
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
                let variantType = el.getAttribute('type')?.split(' ') ?? [];
                let fullType: string[] = [tagType, ...variantType];

                let text = el.textContent;
                let data: Record<string, any> = {};
                for (let attr of el.attributes) {
                    let key = hyphenToCamelCase(attr.name);
                    let value = attr.value;
                    if (key.startsWith(':')) {
                        // 特殊类型
                        try {
                            key = key.slice(1);
                            value = eval('return ' + value);
                            data[key] = value;
                        } catch (e) {
                            console.error('Failed to parse special type attribute:', e);
                        }
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