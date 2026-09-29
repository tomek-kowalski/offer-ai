import { z } from "zod";
import type { ValidationIssue, ValidationResult } from "../requirements/validate.js";
import type { RequirementsDocument } from "../requirements/schema.js";
import type { ScreenshotManifest } from "../screenshots/manifest.js";
import { CoverageDocumentSchema, CoverageStatusSchema, type CoverageDocument, type CoverageStatus } from "./schema.js";

export interface CoverageSummary {
    total: number;
    byStatus: Record<CoverageStatus, number>;
    /** Required (non-optional) requirements that are "missing" or "partial". */
    requiredGaps: string[];
}

/**
 * Validates coverage.json against its schema and cross-checks it with
 * requirements.json and the screenshot manifest.
 */
export function validateCoverage(
    raw: unknown,
    requirements: RequirementsDocument,
    manifest: ScreenshotManifest
): ValidationResult<CoverageDocument> & { summary: CoverageSummary | null } {
    const parsed = CoverageDocumentSchema.safeParse(raw);
    if (!parsed.success) {
        return { value: null, summary: null, issues: [{ level: "error", message: z.prettifyError(parsed.error) }] };
    }

    const coverage = parsed.data;
    const issues: ValidationIssue[] = [];
    const error = (message: string) => issues.push({ level: "error", message });
    const warn = (message: string) => issues.push({ level: "warning", message });

    if (coverage.documentSha256 !== requirements.document.sha256) {
        error(`documentSha256 does not match requirements.json (${requirements.document.sha256})`);
    }

    const requirementsById = new Map(requirements.requirements.map((r) => [r.id, r]));
    const screenshotsById = new Map(manifest.screenshots.map((s) => [s.id, s]));
    const assessed = new Map<string, number>();

    for (const a of coverage.assessments) {
        assessed.set(a.requirementId, (assessed.get(a.requirementId) ?? 0) + 1);
        const req = requirementsById.get(a.requirementId);
        if (!req) {
            error(`${a.requirementId}: not in requirements.json`);
            continue;
        }

        if ((a.status === "covered" || a.status === "partial") && a.evidence.length === 0) {
            error(`${a.requirementId}: status "${a.status}" needs at least one evidence screenshot`);
        }
        if ((a.status === "partial" || a.status === "missing") && !a.gaps) {
            error(`${a.requirementId}: status "${a.status}" needs "gaps" describing what is missing`);
        }
        if (req.visualVerification === "impossible" && a.status !== "not_verifiable") {
            error(`${a.requirementId}: visualVerification is "impossible", so status must be "not_verifiable"`);
        }
        const wanted = req.platforms.filter((p) => p !== "all");
        // No screenshots for the requirement's platform means the client supplied no design
        // for it: visually assessable requirements are "design_not_provided", and only
        // inherently non-visual ones ("impossible") stay "not_verifiable".
        const noShotsForPlatform =
            wanted.length > 0 && !manifest.screenshots.some((s) => s.platform === "unknown" || (wanted as string[]).includes(s.platform));
        if (a.status === "design_not_provided" && !noShotsForPlatform) {
            error(`${a.requirementId}: "design_not_provided" is only for requirements whose platform has no screenshots at all`);
        }
        if (a.status === "design_not_provided" && a.evidence.length > 0) {
            error(`${a.requirementId}: "design_not_provided" takes no evidence; cite other platforms' screenshots in "notes" as context`);
        }
        if (noShotsForPlatform && req.visualVerification !== "impossible" && a.status !== "design_not_provided") {
            error(`${a.requirementId}: no ${wanted.join("/")} design was supplied; use "design_not_provided", not "${a.status}"`);
        }
        if (req.visualVerification === "possible" && a.status === "not_verifiable" && !noShotsForPlatform) {
            warn(`${a.requirementId}: marked not_verifiable although visualVerification is "possible"; prefer "missing"`);
        }

        const platforms = new Set<string>();
        for (const e of a.evidence) {
            const shot = screenshotsById.get(e.screenshotId);
            if (!shot) error(`${a.requirementId}: evidence references unknown screenshot ${e.screenshotId}`);
            else platforms.add(shot.platform);
        }
        if (a.status === "covered" && wanted.length > 0 && platforms.size > 0 && !platforms.has("unknown")) {
            if (!wanted.some((p) => platforms.has(p))) {
                warn(`${a.requirementId}: requirement is for ${wanted.join("/")} but evidence is only ${[...platforms].join("/")}`);
            }
        }
    }

    for (const [id, n] of assessed) if (n > 1) error(`${id}: assessed ${n} times`);
    for (const r of requirements.requirements) {
        if (!assessed.has(r.id)) error(`${r.id} "${r.title}": no assessment`);
    }

    const byStatus = Object.fromEntries(
        CoverageStatusSchema.options.map((s) => [s, coverage.assessments.filter((a) => a.status === s).length])
    ) as Record<CoverageStatus, number>;
    const requiredGaps = coverage.assessments
        .filter((a) => (a.status === "missing" || a.status === "partial") && requirementsById.get(a.requirementId)?.priority === "required")
        .map((a) => a.requirementId);

    return { value: coverage, issues, summary: { total: coverage.assessments.length, byStatus, requiredGaps } };
}
