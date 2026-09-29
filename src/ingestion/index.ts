import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { stripRepeatedLines } from "./cleanup.js";
import { extractDocxSegments } from "./docx.js";
import { extractPdfPages } from "./pdf.js";
import type { DocumentFormat, ExtractedDocument } from "./types.js";

export type { DocumentSegment, ExtractedDocument, DocumentFormat } from "./types.js";
export { hasMeaningfulText } from "./cleanup.js";

export async function extractDocument(filePath: string): Promise<ExtractedDocument> {
    const format = detectFormat(filePath);
    const data = await readFile(filePath);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const fileName = basename(filePath);

    if (format === "pdf") {
        const pages = await extractPdfPages(data);
        return {
            fileName,
            format,
            sha256,
            pageCount: pages.length,
            segments: stripRepeatedLines(pages),
            messages: []
        };
    }

    const { segments, messages } = await extractDocxSegments(data);
    return { fileName, format, sha256, pageCount: null, segments, messages };
}

function detectFormat(filePath: string): DocumentFormat {
    const ext = extname(filePath).toLowerCase();
    if (ext === ".pdf") return "pdf";
    if (ext === ".docx") return "docx";
    throw new Error(`Unsupported document format "${ext}" (${filePath}). Supported: .pdf, .docx`);
}
