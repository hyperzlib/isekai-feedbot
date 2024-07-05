import { BASE_MESSAGE_CHUNK_TYPES, MessageChunk } from "../message/Message";
import { JSDOM } from "jsdom";

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
                    switch (typeof value) { // 根据数据类型，在属性名前添加前缀
                        case 'boolean':
                            elNode.setAttribute(`!${key}`, value ? 'true' : 'false');
                            break;
                        case 'number':
                            elNode.setAttribute(`#${key}`, value.toString());
                            break;
                        case 'object':
                            elNode.setAttribute(`@${key}`, JSON.stringify(value));
                            break;
                        default:
                            elNode.setAttribute(key, value);
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
export function parseMessageChunksFromXml(xml: string): MessageChunk[] {
    let dom = new JSDOM(xml);
    let document = dom.window.document;
    let chunks: MessageChunk[] = [];

    for (let node of document.body.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            chunks.push({
                type: ['text'],
                text: node.textContent,
                data: {},
            });
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            let type = el.tagName;
            let variantType = el.getAttribute('type')?.split(' ') ?? [];
            let fullType: string[] = [type, ...variantType];

            let text = el.textContent;
            let data: Record<string, any> = {};
            for (let attr of el.attributes) {
                let key = attr.name;
                let value = attr.value;
                if (key.startsWith('!')) {
                    data[key.slice(1)] = value === 'true';
                } else if (key.startsWith('#')) {
                    data[key.slice(1)] = Number(value);
                } else if (key.startsWith('@')) {
                    data[key.slice(1)] = JSON.parse(value);
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
    }

    return chunks;
}