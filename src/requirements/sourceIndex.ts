import type { DocumentSegment } from "../ingestion/index.js";
import { compact, isNumberedHeading, normalizeForMatch } from "./text.js";

interface IndexedLine {
    start: number;
    section: string | null;
}

interface SearchableText {
    text: string;
    lines: IndexedLine[];
}

interface IndexedSegment {
    segment: DocumentSegment;
    normal: SearchableText;
    compact: SearchableText;
}

export interface QuoteLocation {
    segment: DocumentSegment;
    section: string | null;
}

/**
 * Searchable view of the extracted document. Locates model-provided quotes in
 * the original text and resolves the numbered section they fall under, so that
 * provenance does not depend on what the model claims.
 */
export class SourceIndex {
    private readonly segments: IndexedSegment[];

    constructor(segments: DocumentSegment[]) {
        let section: string | null = null;
        this.segments = segments.map((segment) => {
            const normalParts: string[] = [];
            const compactParts: string[] = [];
            const normalLines: IndexedLine[] = [];
            const compactLines: IndexedLine[] = [];
            let normalLength = 0;
            let compactLength = 0;

            for (const rawLine of segment.text.split(/\r?\n/)) {
                if (isNumberedHeading(rawLine)) section = rawLine.replace(/\s+/g, " ").trim();
                const normal = normalizeForMatch(rawLine);
                if (!normal) continue;
                const packed = compact(normal);

                normalLines.push({ start: normalLength, section });
                normalParts.push(normal);
                normalLength += normal.length + 1;

                compactLines.push({ start: compactLength, section });
                compactParts.push(packed);
                compactLength += packed.length;
            }

            return {
                segment,
                normal: { text: normalParts.join(" "), lines: normalLines },
                compact: { text: compactParts.join(""), lines: compactLines }
            };
        });
    }

    /** Section in effect at the start of the given segment. */
    sectionAtStart(segmentIndex: number): string | null {
        const indexed = this.segments[segmentIndex];
        return indexed?.normal.lines[0]?.section ?? null;
    }

    locateInSegment(segmentIndex: number, quote: string): QuoteLocation | null {
        const indexed = this.segments[segmentIndex];
        return indexed ? locate(indexed, quote) : null;
    }

    locateAnywhere(quote: string): QuoteLocation | null {
        for (const indexed of this.segments) {
            const found = locate(indexed, quote);
            if (found) return found;
        }
        return null;
    }
}

function locate(indexed: IndexedSegment, quote: string): QuoteLocation | null {
    const normalQuote = normalizeForMatch(quote);
    if (!normalQuote) return null;

    const byNormal = findSection(indexed.normal, normalQuote);
    if (byNormal !== undefined) return { segment: indexed.segment, section: byNormal };

    const packed = compact(normalQuote);
    if (packed.length < 8) return null;
    const byCompact = findSection(indexed.compact, packed);
    if (byCompact !== undefined) return { segment: indexed.segment, section: byCompact };

    return null;
}

function findSection(searchable: SearchableText, needle: string): string | null | undefined {
    const position = searchable.text.indexOf(needle);
    if (position < 0) return undefined;
    let section: string | null = null;
    for (const line of searchable.lines) {
        if (line.start > position) break;
        section = line.section;
    }
    return section;
}
