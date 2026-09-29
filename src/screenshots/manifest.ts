import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { z } from "zod";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export const ScreenshotPlatformSchema = z.enum(["desktop", "mobile", "unknown"]);

export const ScreenshotSchema = z.strictObject({
    /** Content-derived, so it survives renames and re-scans. */
    id: z.string().regex(/^SCR-[0-9A-F]{8}(-\d+)?$/),
    /** Project-relative POSIX path. */
    path: z.string(),
    platform: ScreenshotPlatformSchema,
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable()
});

export const ScreenshotManifestSchema = z.strictObject({
    manifestVersion: z.literal(1),
    root: z.string(),
    generatedAt: z.string(),
    screenshots: z.array(ScreenshotSchema)
});

export type Screenshot = z.infer<typeof ScreenshotSchema>;
export type ScreenshotManifest = z.infer<typeof ScreenshotManifestSchema>;

/**
 * Scans a folder of screenshots and builds a manifest. Platform is taken from
 * the nearest path segment named "desktop" or "mobile" (case-insensitive).
 * Files are listed in path order so the output is stable.
 */
export async function buildScreenshotManifest(rootDir: string, projectDir: string): Promise<ScreenshotManifest> {
    const files = (await listFiles(rootDir))
        .filter((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()))
        .sort();

    const used = new Map<string, number>();
    const screenshots: Screenshot[] = [];
    for (const file of files) {
        const data = await readFile(file);
        const sha256 = createHash("sha256").update(data).digest("hex");
        const base = `SCR-${sha256.slice(0, 8).toUpperCase()}`;
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);

        const path = toPosix(relative(projectDir, file));
        const size = readImageSize(data);
        screenshots.push({
            id: seen === 0 ? base : `${base}-${seen + 1}`,
            path,
            platform: detectPlatform(toPosix(relative(rootDir, file))),
            bytes: data.length,
            sha256,
            width: size?.width ?? null,
            height: size?.height ?? null
        });
    }

    return {
        manifestVersion: 1,
        root: toPosix(relative(projectDir, rootDir)),
        generatedAt: new Date().toISOString(),
        screenshots
    };
}

async function listFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map((entry) => {
            const full = join(dir, entry.name);
            return entry.isDirectory() ? listFiles(full) : Promise.resolve(entry.isFile() ? [full] : []);
        })
    );
    return nested.flat();
}

function detectPlatform(relativePath: string): Screenshot["platform"] {
    const parts = relativePath.toLowerCase().split("/").slice(0, -1).reverse();
    for (const part of parts) {
        if (part === "desktop") return "desktop";
        if (part === "mobile") return "mobile";
    }
    return "unknown";
}

function toPosix(path: string): string {
    return path.split(sep).join("/");
}

/** Reads width/height from PNG and JPEG headers; null for other formats. */
export function readImageSize(data: Buffer): { width: number; height: number } | null {
    if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47) {
        return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
        let offset = 2;
        while (offset + 9 < data.length) {
            if (data[offset] !== 0xff) return null;
            const marker = data[offset + 1] ?? 0;
            const length = data.readUInt16BE(offset + 2);
            const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
            if (isSof) return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
            offset += 2 + length;
        }
    }
    return null;
}
