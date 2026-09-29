import type { DocumentSegment } from "./types.js";

/**
 * Removes running headers/footers: short lines that repeat on most pages.
 * Only applied when there are enough pages for the repetition to be meaningful.
 */
export function stripRepeatedLines(segments: DocumentSegment[]): DocumentSegment[] {
    if (segments.length < 3) return segments;

    const counts = new Map<string, number>();
    for (const segment of segments) {
        const unique = new Set(lines(segment.text).map(normalizeLine).filter(Boolean));
        for (const line of unique) counts.set(line, (counts.get(line) ?? 0) + 1);
    }

    const threshold = Math.max(3, Math.ceil(segments.length * 0.6));
    const repeated = new Set(
        [...counts].filter(([line, n]) => n >= threshold && line.length <= 120).map(([line]) => line)
    );
    if (repeated.size === 0) return segments;

    return segments.map((segment) => ({
        ...segment,
        text: lines(segment.text)
            .filter((line) => !repeated.has(normalizeLine(line)))
            .join("\n")
            .trim()
    }));
}

export function hasMeaningfulText(text: string): boolean {
    return text.replace(/\s+/g, "").length >= 20;
}

function lines(text: string): string[] {
    return text.split(/\r?\n/);
}

function normalizeLine(line: string): string {
    return line.replace(/\s+/g, " ").trim();
}
