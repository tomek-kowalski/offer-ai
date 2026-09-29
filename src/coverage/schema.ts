import { z } from "zod";

// ---------------------------------------------------------------------------
// coverage.json: how well the supplied screenshots cover each requirement.
// Written by the analyst (Claude Code); validated by `npm run coverage:validate`.
// ---------------------------------------------------------------------------

export const CoverageStatusSchema = z.enum([
    /** Screenshots show the requirement fully satisfied. */
    "covered",
    /** Screenshots show it, but something is missing or differs. */
    "partial",
    /** Could be verified visually, but no screenshot shows it. */
    "missing",
    /** Cannot be judged from screenshots (backend, SEO, integration, process). */
    "not_verifiable",
    /**
     * Visually assessable, but the client supplied no design for the requirement's
     * platform (e.g. mobile): the design is to be conceptualised from the other
     * platform's designs and the inquiry.
     */
    "design_not_provided"
]);

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

export const CoverageEvidenceSchema = z.strictObject({
    /** `screenshots[].id` from screenshots.json. */
    screenshotId: z.string().regex(/^SCR-[0-9A-F]{8}(-\d+)?$/),
    /** What in this screenshot supports the assessment (element, region, label). */
    note: z.string().min(1)
});

export const CoverageAssessmentSchema = z.strictObject({
    requirementId: z.string().regex(/^REQ-[0-9A-F]{8}(-\d+)?$/),
    status: CoverageStatusSchema,
    confidence: ConfidenceSchema,
    evidence: z.array(CoverageEvidenceSchema),
    /** What is missing or different. Required for "partial" and "missing". */
    gaps: z.string().min(1).nullable(),
    notes: z.string().nullable()
});

export const CoverageDocumentSchema = z.strictObject({
    schemaVersion: z.literal(1),
    /** `document.sha256` from requirements.json the assessment was made against. */
    documentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    author: z.string().min(1),
    assessedAt: z.string(),
    assessments: z.array(CoverageAssessmentSchema)
});

export type CoverageStatus = z.infer<typeof CoverageStatusSchema>;
export type CoverageAssessment = z.infer<typeof CoverageAssessmentSchema>;
export type CoverageDocument = z.infer<typeof CoverageDocumentSchema>;
