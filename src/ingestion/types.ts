export type DocumentFormat = "pdf" | "docx";

/**
 * A unit of extracted text. For PDFs a segment is exactly one physical page.
 * DOCX files have no fixed pagination, so their segments are paragraph-aligned
 * chunks with `page: null`.
 */
export interface DocumentSegment {
    index: number;
    page: number | null;
    text: string;
}

export interface ExtractedDocument {
    fileName: string;
    format: DocumentFormat;
    sha256: string;
    pageCount: number | null;
    segments: DocumentSegment[];
    /** Non-fatal notices from the underlying parser. */
    messages: string[];
}
