import { z } from "zod";
import type { ExtractedDocument } from "../ingestion/index.js";
import { RequirementIdAllocator } from "./ids.js";
import { computeStats } from "./pipeline.js";
import { RequirementsDocumentSchema, type RequirementsDocument } from "./schema.js";
import { SourceIndex } from "./sourceIndex.js";

export interface ValidationIssue {
    level: "error" | "warning";
    message: string;
}

export interface ValidationResult<T> {
    value: T | null;
    issues: ValidationIssue[];
}

export function hasErrors(issues: ValidationIssue[]): boolean {
    return issues.some((issue) => issue.level === "error");
}

/**
 * Validates requirements.json against the Zod schema and, when the source
 * text is available, re-checks it against the document: sha256, quote
 * verification flags, deterministic IDs, ordinals and stats. Catches manual
 * edits that bypassed `requirements:build`.
 */
export function validateRequirements(
    raw: unknown,
    source: ExtractedDocument | null
): ValidationResult<RequirementsDocument> {
    const parsed = RequirementsDocumentSchema.safeParse(raw);
    if (!parsed.success) {
        return { value: null, issues: [{ level: "error", message: z.prettifyError(parsed.error) }] };
    }

    const doc = parsed.data;
    const issues: ValidationIssue[] = [];
    const error = (message: string) => issues.push({ level: "error", message });
    const warn = (message: string) => issues.push({ level: "warning", message });

    const idCounts = new Map<string, number>();
    for (const r of doc.requirements) idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
    for (const [id, n] of idCounts) if (n > 1) error(`Duplicate requirement id ${id} (${n}x)`);

    doc.requirements.forEach((r, i) => {
        if (r.ordinal !== i + 1) error(`${r.id}: ordinal ${r.ordinal}, expected ${i + 1}`);
        if (r.source.document !== doc.document.fileName) {
            error(`${r.id}: source.document "${r.source.document}" != "${doc.document.fileName}"`);
        }
    });

    const ids = new RequirementIdAllocator();
    for (const r of doc.requirements) {
        const expected = ids.allocate(r.source.section, r.source.quote);
        if (expected !== r.id) error(`${r.id}: id does not match its section+quote (expected ${expected}); rebuild instead of editing ids`);
    }

    const stats = computeStats(doc.requirements);
    if (JSON.stringify(stats) !== JSON.stringify(doc.stats)) {
        error(`stats are stale: expected ${JSON.stringify(stats)}`);
    }

    if (source) {
        if (source.sha256 !== doc.document.sha256) {
            error(`document sha256 ${doc.document.sha256} does not match source text ${source.sha256}`);
        } else {
            const index = new SourceIndex(source.segments);
            for (const r of doc.requirements) {
                const found = index.locateAnywhere(r.source.quote) !== null;
                if (found !== r.source.quoteVerified) {
                    error(`${r.id}: quoteVerified=${r.source.quoteVerified} but quote ${found ? "is" : "is not"} in the source`);
                }
            }
        }
    } else {
        warn("Source text not available; quote verification and sha256 checks skipped");
    }

    for (const r of doc.requirements) {
        if (!r.source.quoteVerified) warn(`${r.id} "${r.title}": quote not verified against source`);
    }

    return { value: doc, issues };
}
