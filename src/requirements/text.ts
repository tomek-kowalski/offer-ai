/** Normalization used for quote matching and ID derivation. */
export function normalizeForMatch(text: string): string {
    return text
        .normalize("NFKC")
        .replace(/[-•▪●­]/g, " ") // bullets, private-use glyphs, soft hyphens
        .replace(/[‘’‚‛′`]/g, "'")
        .replace(/[“”„‟«»]/g, '"')
        .replace(/[‐-―−]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

export function compact(normalized: string): string {
    return normalized.replace(/[\s"'.,;:!?()-]/g, "");
}

const NUMBERED_HEADING = /^\d+(?:\.\d+)*\.\s+\p{Lu}/u;

export function isNumberedHeading(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.length <= 100 && NUMBERED_HEADING.test(trimmed);
}

/** Short lines written mostly in capitals, e.g. "CZĘŚĆ B — WERSJA MOBILNA". */
export function isCapsHeading(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length < 6 || trimmed.length > 80) return false;
    const letters = [...trimmed].filter((c) => /\p{L}/u.test(c));
    if (letters.length < 5) return false;
    const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase());
    return upper.length / letters.length >= 0.9;
}

export function isHeading(line: string): boolean {
    return isNumberedHeading(line) || isCapsHeading(line);
}
