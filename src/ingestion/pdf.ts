import { PDFParse } from "pdf-parse";
import type { DocumentSegment } from "./types.js";

export async function extractPdfPages(data: Buffer): Promise<DocumentSegment[]> {
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
        const result = await parser.getText();
        return result.pages.map((page, index) => ({
            index,
            page: page.num,
            text: page.text
        }));
    } finally {
        await parser.destroy();
    }
}
