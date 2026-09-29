import mammoth from "mammoth";
import type { DocumentSegment } from "./types.js";

const MAX_SEGMENT_CHARS = 8000;

export async function extractDocxSegments(
    data: Buffer
): Promise<{ segments: DocumentSegment[]; messages: string[] }> {
    const result = await mammoth.extractRawText({ buffer: data });
    const paragraphs = result.value.split(/\n{2,}/);

    const chunks: string[] = [];
    let current = "";
    for (const paragraph of paragraphs) {
        if (current && current.length + paragraph.length > MAX_SEGMENT_CHARS) {
            chunks.push(current);
            current = "";
        }
        current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
    if (current) chunks.push(current);

    return {
        segments: chunks.map((text, index) => ({ index, page: null, text })),
        messages: result.messages.map((m) => `${m.type}: ${m.message}`)
    };
}
