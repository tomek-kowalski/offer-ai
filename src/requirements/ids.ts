import { createHash } from "node:crypto";
import { normalizeForMatch } from "./text.js";

/**
 * Stable requirement IDs.
 *
 * The ID is a hash of verbatim document text (the section heading and the
 * source quote), never of model-written prose. Re-running extraction on the
 * same document therefore yields the same ID for the same requirement as long
 * as the model anchors it to the same source fragment. When several atomic
 * requirements share the same anchor, a numeric suffix is appended in
 * document order.
 */
export class RequirementIdAllocator {
    private readonly used = new Map<string, number>();

    allocate(section: string | null, quote: string): string {
        const key = `${normalizeForMatch(section ?? "")}|${normalizeForMatch(quote)}`;
        const base = `REQ-${createHash("sha256").update(key).digest("hex").slice(0, 8).toUpperCase()}`;
        const seen = this.used.get(base) ?? 0;
        this.used.set(base, seen + 1);
        return seen === 0 ? base : `${base}-${seen + 1}`;
    }
}
