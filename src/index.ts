import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { validateCoverage } from "./coverage/validate.js";
import { extractDocument, type ExtractedDocument } from "./ingestion/index.js";
import { buildRequirements } from "./requirements/pipeline.js";
import { RequirementsDraftSchema } from "./requirements/schema.js";
import { hasErrors, validateRequirements, type ValidationIssue } from "./requirements/validate.js";
import { buildScreenshotManifest, ScreenshotManifestSchema } from "./screenshots/manifest.js";

const PATHS = {
    input: "data/inquiry/fitme.pdf",
    sourceText: "data/output/requirements.source-text.json",
    sourceTextView: "data/output/requirements.source-text.txt",
    draft: "data/output/requirements.draft.json",
    requirements: "data/output/requirements.json",
    screenshotsDir: "data/screenshots",
    screenshots: "data/output/screenshots.json",
    coverage: "data/output/coverage.json"
};

const USAGE = `Usage: tsx src/index.ts <command> [options]

Commands:
  extract                 PDF/DOCX -> source text (.json + readable .txt)
      --input <file>        default ${PATHS.input}
      --out <file>          default ${PATHS.sourceText}
  requirements:build      draft + source text -> requirements.json (IDs, quote check, stats)
      --draft <file>        default ${PATHS.draft}
      --source <file>       default ${PATHS.sourceText}
      --out <file>          default ${PATHS.requirements}
  requirements:validate   validate requirements.json (schema + source cross-check)
      --requirements <file> default ${PATHS.requirements}
      --source <file>       default ${PATHS.sourceText} (skipped if missing)
  screenshots             scan screenshots folder -> screenshots.json
      --dir <dir>           default ${PATHS.screenshotsDir}
      --out <file>          default ${PATHS.screenshots}
  coverage:validate       validate coverage.json against requirements + screenshots
      --coverage <file>     default ${PATHS.coverage}
      --requirements <file> default ${PATHS.requirements}
      --screenshots <file>  default ${PATHS.screenshots}`;

type Options = Record<string, string | undefined>;

const COMMANDS: Record<string, (o: Options) => Promise<boolean>> = {
    extract: runExtract,
    "requirements:build": runRequirementsBuild,
    "requirements:validate": runRequirementsValidate,
    screenshots: runScreenshots,
    "coverage:validate": runCoverageValidate
};

async function main(): Promise<void> {
    const { positionals, values } = parseArgs({
        allowPositionals: true,
        options: Object.fromEntries(
            ["input", "out", "draft", "source", "requirements", "dir", "screenshots", "coverage"].map((k) => [
                k,
                { type: "string" as const }
            ])
        )
    });
    const command = COMMANDS[positionals[0] ?? ""];
    if (!command) {
        console.error(USAGE);
        process.exitCode = 2;
        return;
    }
    const ok = await command(values as Options);
    if (!ok) process.exitCode = 1;
}

async function runExtract(o: Options): Promise<boolean> {
    const inputPath = resolve(o.input ?? PATHS.input);
    const outPath = resolve(o.out ?? PATHS.sourceText);
    console.log(`Extracting text from ${inputPath}`);
    const document = await extractDocument(inputPath);
    console.log(`  ${document.format.toUpperCase()}, ${document.segments.length} segment(s), sha256 ${document.sha256}`);

    await writeJson(outPath, document);
    const viewPath = outPath.replace(/\.json$/i, "") + ".txt";
    await writeText(viewPath, renderSourceText(document));
    console.log(`  Saved ${outPath}\n  Saved ${viewPath}`);
    for (const message of document.messages) console.warn(`  [parser] ${message}`);
    return true;
}

async function runRequirementsBuild(o: Options): Promise<boolean> {
    const source = await readSource(resolve(o.source ?? PATHS.sourceText));
    const draftPath = resolve(o.draft ?? PATHS.draft);
    const parsed = RequirementsDraftSchema.safeParse(await readJson(draftPath));
    if (!parsed.success) {
        console.error(`Draft ${draftPath} is invalid:\n${z.prettifyError(parsed.error)}`);
        return false;
    }

    const result = buildRequirements(source, parsed.data);
    const outPath = resolve(o.out ?? PATHS.requirements);
    await writeJson(outPath, result);
    console.log(`Saved ${result.stats.total} requirements to ${outPath}`);
    console.log(`  by type: ${JSON.stringify(result.stats.byType)}`);
    console.log(`  optional: ${result.stats.optional}, unverified quotes: ${result.stats.unverifiedQuotes}`);
    for (const w of result.warnings) console.warn(`  [${w.code}]${w.page ? ` p.${w.page}` : ""} ${w.message}`);
    return true;
}

async function runRequirementsValidate(o: Options): Promise<boolean> {
    const path = resolve(o.requirements ?? PATHS.requirements);
    const sourcePath = resolve(o.source ?? PATHS.sourceText);
    const source = await readSource(sourcePath).catch(() => null);
    const { value, issues } = validateRequirements(await readJson(path), source);
    report(path, issues);
    if (value) console.log(`  ${value.stats.total} requirements, ${value.stats.unverifiedQuotes} unverified quote(s)`);
    return !hasErrors(issues);
}

async function runScreenshots(o: Options): Promise<boolean> {
    const dir = resolve(o.dir ?? PATHS.screenshotsDir);
    const outPath = resolve(o.out ?? PATHS.screenshots);
    await mkdir(dir, { recursive: true });
    const manifest = await buildScreenshotManifest(dir, process.cwd());
    await writeJson(outPath, manifest);
    const byPlatform = new Map<string, number>();
    for (const s of manifest.screenshots) byPlatform.set(s.platform, (byPlatform.get(s.platform) ?? 0) + 1);
    const counts = [...byPlatform].map(([p, n]) => `${p}: ${n}`).join(", ");
    console.log(`Saved ${manifest.screenshots.length} screenshot(s) to ${outPath}${counts ? ` (${counts})` : ""}`);
    const unknown = byPlatform.get("unknown") ?? 0;
    if (unknown > 0) console.warn(`  ${unknown} screenshot(s) have unknown platform; put them under desktop/ or mobile/ subfolders`);
    return true;
}

async function runCoverageValidate(o: Options): Promise<boolean> {
    const coveragePath = resolve(o.coverage ?? PATHS.coverage);
    const reqPath = resolve(o.requirements ?? PATHS.requirements);
    const reqResult = validateRequirements(await readJson(reqPath), null);
    if (!reqResult.value) {
        report(reqPath, reqResult.issues);
        return false;
    }
    const manifest = ScreenshotManifestSchema.parse(await readJson(resolve(o.screenshots ?? PATHS.screenshots)));

    const { issues, summary } = validateCoverage(await readJson(coveragePath), reqResult.value, manifest);
    for (const shot of manifest.screenshots) {
        const data = await readFile(resolve(shot.path)).catch(() => null);
        if (!data) issues.push({ level: "error", message: `${shot.id}: file ${shot.path} is missing; re-run screenshots` });
        else if (createHash("sha256").update(data).digest("hex") !== shot.sha256) {
            issues.push({ level: "error", message: `${shot.id}: ${shot.path} changed since the manifest was built; re-run screenshots` });
        }
    }

    report(coveragePath, issues);
    if (summary) {
        console.log(`  ${summary.total} assessment(s): ${JSON.stringify(summary.byStatus)}`);
        if (summary.requiredGaps.length) console.log(`  required with gaps: ${summary.requiredGaps.join(", ")}`);
    }
    return !hasErrors(issues);
}

function renderSourceText(document: ExtractedDocument): string {
    const header = `# ${document.fileName} (${document.format}, sha256 ${document.sha256})\n`;
    const body = document.segments.map((s) => {
        const label = s.page === null ? "" : ` | page ${s.page}`;
        return `\n===== segmentIndex ${s.index}${label} =====\n${s.text}\n`;
    });
    return header + body.join("");
}

function report(path: string, issues: ValidationIssue[]): void {
    const errors = issues.filter((i) => i.level === "error");
    const warnings = issues.filter((i) => i.level === "warning");
    console.log(`${errors.length ? "INVALID" : "OK"}: ${path} (${errors.length} error(s), ${warnings.length} warning(s))`);
    for (const i of errors) console.error(`  [error] ${i.message}`);
    for (const i of warnings) console.warn(`  [warning] ${i.message}`);
}

async function readSource(path: string): Promise<ExtractedDocument> {
    return (await readJson(path)) as ExtractedDocument;
}

async function readJson(path: string): Promise<unknown> {
    const text = await readFile(path, "utf8").catch(() => {
        throw new Error(`Cannot read ${path}`);
    });
    try {
        return JSON.parse(text.replace(/^﻿/, ""));
    } catch (error) {
        throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
    }
}

async function writeJson(path: string, value: unknown): Promise<void> {
    await writeText(path, JSON.stringify(value, null, 2) + "\n");
}

async function writeText(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf8");
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
