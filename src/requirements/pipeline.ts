import { hasMeaningfulText, type ExtractedDocument } from "../ingestion/index.js";
import { RequirementIdAllocator } from "./ids.js";
import {
    RequirementsDocumentSchema,
    RequirementTypeSchema,
    type DraftRequirement,
    type ExtractionWarning,
    type Requirement,
    type RequirementsDocument,
    type RequirementsDraft,
    type RequirementType
} from "./schema.js";
import { SourceIndex } from "./sourceIndex.js";
import { normalizeForMatch } from "./text.js";

/** Bump when the authoring rules in CLAUDE.md change in a way that affects output. */
export const INSTRUCTIONS_VERSION = "requirements-authoring/v2";

interface SegmentResult {
    segmentIndex: number;
    requirements: DraftRequirement[];
}

/**
 * Turns a hand-authored draft into the persisted requirements document:
 * checks it belongs to the extracted document, verifies quotes, assigns
 * stable IDs and computes stats. Fully deterministic apart from `builtAt`.
 */
export function buildRequirements(document: ExtractedDocument, draft: RequirementsDraft): RequirementsDocument {
    if (draft.documentSha256 !== document.sha256) {
        throw new Error(
            `Draft was written for document sha256 ${draft.documentSha256}, ` +
                `but the source text is for ${document.sha256} (${document.fileName}). Re-extract or fix the draft.`
        );
    }

    const warnings: ExtractionWarning[] = document.messages.map((message) => ({
        code: "INGESTION_MESSAGE",
        message,
        page: null
    }));

    for (const segment of document.segments) {
        if (hasMeaningfulText(segment.text)) continue;
        warnings.push({
            code: "PAGE_WITHOUT_TEXT",
            message:
                "No extractable text (likely image-only content such as mockups or scans). " +
                "Requirements on this page, if any, need manual review of the original document.",
            page: segment.page
        });
    }

    const perSegment: SegmentResult[] = [];
    for (const entry of draft.segments) {
        if (!document.segments[entry.segmentIndex]) {
            warnings.push({
                code: "UNKNOWN_SEGMENT",
                message: `Draft references segmentIndex ${entry.segmentIndex}, which does not exist; its ${entry.requirements.length} requirement(s) were dropped.`,
                page: null
            });
            continue;
        }
        perSegment.push(entry);
    }

    const requirements = toDomainRequirements(document, perSegment, warnings);

    return RequirementsDocumentSchema.parse({
        schemaVersion: 1,
        document: {
            fileName: document.fileName,
            format: document.format,
            sha256: document.sha256,
            pageCount: document.pageCount
        },
        extraction: {
            author: draft.author,
            instructionsVersion: INSTRUCTIONS_VERSION,
            builtAt: new Date().toISOString()
        },
        stats: computeStats(requirements),
        warnings,
        requirements
    });
}

export function computeStats(requirements: Requirement[]): RequirementsDocument["stats"] {
    const byType = Object.fromEntries(
        RequirementTypeSchema.options.map((type) => [type, requirements.filter((r) => r.type === type).length])
    ) as Record<RequirementType, number>;
    return {
        total: requirements.length,
        byType,
        optional: requirements.filter((r) => r.priority === "optional").length,
        unverifiedQuotes: requirements.filter((r) => !r.source.quoteVerified).length
    };
}

/**
 * Turns draft items into domain requirements: verifies every quote against
 * the extracted text, corrects page/section provenance, drops exact
 * duplicates and assigns stable IDs in document order.
 */
export function toDomainRequirements(
    document: ExtractedDocument,
    perSegment: SegmentResult[],
    warnings: ExtractionWarning[]
): Requirement[] {
    const index = new SourceIndex(document.segments);
    const ids = new RequirementIdAllocator();
    const seen = new Set<string>();
    const result: Requirement[] = [];

    const ordered = [...perSegment].sort((a, b) => a.segmentIndex - b.segmentIndex);
    for (const { segmentIndex, requirements } of ordered) {
        const segment = document.segments[segmentIndex];
        if (!segment) continue;

        for (const item of requirements) {
            const dedupeKey = `${normalizeForMatch(item.sourceQuote)}|${normalizeForMatch(item.title)}`;
            if (seen.has(dedupeKey)) {
                warnings.push({
                    code: "DUPLICATE_REQUIREMENT_DROPPED",
                    message: `Exact duplicate dropped: "${item.title}"`,
                    page: segment.page
                });
                continue;
            }
            seen.add(dedupeKey);

            let location = index.locateInSegment(segmentIndex, item.sourceQuote);
            if (!location) {
                location = index.locateAnywhere(item.sourceQuote);
                if (location) {
                    warnings.push({
                        code: "QUOTE_FOUND_ON_OTHER_PAGE",
                        message: `"${item.title}" was drafted for page ${segment.page ?? "?"} but its quote is on page ${location.segment.page ?? "?"}; page corrected.`,
                        page: location.segment.page
                    });
                } else {
                    warnings.push({
                        code: "QUOTE_NOT_FOUND",
                        message: `Quote for "${item.title}" not found verbatim in the document; verify manually: "${item.sourceQuote}"`,
                        page: segment.page
                    });
                }
            }

            const section = location ? location.section : (item.section ?? index.sectionAtStart(segmentIndex));
            result.push({
                id: ids.allocate(section, item.sourceQuote),
                ordinal: result.length + 1,
                title: item.title.trim(),
                description: item.description.trim(),
                type: item.type,
                area: item.area,
                priority: item.priority,
                platforms: [...new Set(item.platforms)],
                visualVerification: item.visualVerification,
                conditions: item.conditions?.trim() || null,
                source: {
                    document: document.fileName,
                    page: (location?.segment ?? segment).page,
                    section,
                    quote: item.sourceQuote,
                    quoteVerified: location !== null
                }
            });
        }
    }
    return result;
}
