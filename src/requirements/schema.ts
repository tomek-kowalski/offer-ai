import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const RequirementTypeSchema = z.enum([
    "visual",
    "functional",
    "technical",
    "integration",
    "content",
    "performance"
]);

export const RequirementAreaSchema = z.enum([
    "global",
    "header",
    "navigation",
    "homepage",
    "category",
    "product",
    "cart",
    "checkout",
    "search",
    "reviews",
    "content",
    "cms",
    "mobile",
    "performance",
    "accessibility",
    "seo",
    "integration",
    "process",
    "other"
]);

export const PrioritySchema = z.enum(["required", "optional"]);

export const PlatformSchema = z.enum(["desktop", "mobile", "all"]);

export const VisualVerificationSchema = z.enum([
    "possible",
    "partial",
    "impossible"
]);

// ---------------------------------------------------------------------------
// Draft contract (requirements.draft.json)
//
// This is what the analyst (Claude Code, operating the project) writes after
// reading the extracted source text. It deliberately has no IDs, ordinals,
// verified pages or stats: those are derived deterministically by
// `npm run requirements:build`, never written by hand.
// ---------------------------------------------------------------------------

export const DraftRequirementSchema = z.strictObject({
    title: z.string().min(1),
    description: z.string().min(1),
    type: RequirementTypeSchema,
    area: RequirementAreaSchema,
    priority: PrioritySchema,
    platforms: z.array(PlatformSchema).min(1),
    visualVerification: VisualVerificationSchema,
    conditions: z.string().nullable(),
    section: z.string().nullable(),
    sourceQuote: z.string().min(1)
});

export const DraftSegmentSchema = z.strictObject({
    /** `segments[].index` from the source-text file. */
    segmentIndex: z.number().int().nonnegative(),
    requirements: z.array(DraftRequirementSchema)
});

export const RequirementsDraftSchema = z.strictObject({
    draftVersion: z.literal(1),
    /** sha256 of the source document, copied from the source-text file. */
    documentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Free-form note on who/what prepared the draft, e.g. "claude-code". */
    author: z.string().min(1),
    segments: z.array(DraftSegmentSchema)
});

export type DraftRequirement = z.infer<typeof DraftRequirementSchema>;
export type DraftSegment = z.infer<typeof DraftSegmentSchema>;
export type RequirementsDraft = z.infer<typeof RequirementsDraftSchema>;

// ---------------------------------------------------------------------------
// Domain model (what is persisted to requirements.json)
// ---------------------------------------------------------------------------

export const RequirementSourceSchema = z.strictObject({
    document: z.string(),
    page: z.number().int().positive().nullable(),
    section: z.string().nullable(),
    quote: z.string(),
    /** True when `quote` was found verbatim (whitespace-insensitive) in the extracted text. */
    quoteVerified: z.boolean()
});

export const RequirementSchema = z.strictObject({
    id: z.string().regex(/^REQ-[0-9A-F]{8}(-\d+)?$/),
    ordinal: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string().min(1),
    type: RequirementTypeSchema,
    area: RequirementAreaSchema,
    priority: PrioritySchema,
    platforms: z.array(PlatformSchema).min(1),
    visualVerification: VisualVerificationSchema,
    conditions: z.string().nullable(),
    source: RequirementSourceSchema
});

export const RequirementsSchema = z.array(RequirementSchema);

export const ExtractionWarningSchema = z.strictObject({
    code: z.enum([
        "PAGE_WITHOUT_TEXT",
        "QUOTE_NOT_FOUND",
        "QUOTE_FOUND_ON_OTHER_PAGE",
        "DUPLICATE_REQUIREMENT_DROPPED",
        "INGESTION_MESSAGE",
        "UNKNOWN_SEGMENT"
    ]),
    message: z.string(),
    page: z.number().int().positive().nullable()
});

export const RequirementsDocumentSchema = z.strictObject({
    schemaVersion: z.literal(1),
    document: z.strictObject({
        fileName: z.string(),
        format: z.enum(["pdf", "docx"]),
        sha256: z.string(),
        pageCount: z.number().int().nonnegative().nullable()
    }),
    extraction: z.strictObject({
        author: z.string(),
        instructionsVersion: z.string(),
        builtAt: z.string()
    }),
    stats: z.strictObject({
        total: z.number().int().nonnegative(),
        byType: z.record(RequirementTypeSchema, z.number().int().nonnegative()),
        optional: z.number().int().nonnegative(),
        unverifiedQuotes: z.number().int().nonnegative()
    }),
    warnings: z.array(ExtractionWarningSchema),
    requirements: RequirementsSchema
});

export type RequirementType = z.infer<typeof RequirementTypeSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type ExtractionWarning = z.infer<typeof ExtractionWarningSchema>;
export type RequirementsDocument = z.infer<typeof RequirementsDocumentSchema>;
