/**
 * A third-party game image, resolved by sha1 through a local manifest
 * (data/games/manifest.json, gitignored; never committed). The RE tools
 * only ever took a .prg inside this repo or the OS temp directory
 * (src/tools/re.ts allowedPrg); on the Commando dogfood run a D64 had to be
 * unpacked by hand with c1541 first. resolveImage does that unpacking, and
 * copies the source file before touching it, so a caller's own D64 or PRG
 * is never opened for write and never modified.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findC1541 } from "../services/c1541-bin.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ImageRef {
  sha1: string;
  /** The name of a file on a D64, e.g. "commando". Unused for a plain PRG image. */
  file?: string;
}

interface ManifestEntry {
  path: string;
  title: string;
}

export type Resolved =
  | {
      ok: true;
      prg: string;
      work: string;
      dispose(): void;
      image: { sha1: string; kind: "prg" | "d64"; file?: string; fileSha1: string };
    }
  | {
      ok: false;
      reason: "no-manifest" | "unknown-sha1" | "image-changed" | "no-file" | "not-prg";
      error: string;
    };

const sha1Of = (file: string): string => createHash("sha1").update(readFileSync(file)).digest("hex");

function readManifest(manifestPath: string): Record<string, ManifestEntry> | null {
  const abs = path.isAbsolute(manifestPath) ? manifestPath : path.join(repoRoot, manifestPath);
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, "utf8")) as Record<string, ManifestEntry>;
  } catch {
    return null;
  }
}

/**
 * The file names a `c1541 -list` directory printout reports, in order. The
 * first quoted string is always the disk name header, not a file, so it is
 * dropped.
 */
export function directoryOf(text: string): string[] {
  const names = [...text.matchAll(/^\s*\d+\s+"([^"]*)"/gm)].map((m) => (m[1] ?? "").trimEnd());
  return names.slice(1);
}

function finish(
  prg: string,
  work: string,
  meta: { kind: "prg" | "d64"; imageSha1: string; file?: string },
): Resolved {
  const { kind, imageSha1, file } = meta;
  return {
    ok: true,
    prg,
    work,
    dispose: () => {
      rmSync(work, { recursive: true, force: true });
    },
    image: { sha1: imageSha1, kind, ...(file !== undefined ? { file } : {}), fileSha1: sha1Of(prg) },
  };
}

/** Extracts `file` from the D64 copy at `copy` into `work`/p.prg with c1541. */
function extractFromD64(copy: string, file: string, work: string, imageSha1: string): Resolved {
  const c1541 = findC1541();
  if (!c1541)
    return { ok: false, reason: "no-file", error: "c1541 not found (C1541, PATH, .tools/vice-headless)" };
  const outPrg = path.join(work, "p.prg");
  // c1541 prints "OPENCBM: opening dynamic library libopencbm.dylib failed!"
  // on this machine (no real IEC hardware attached); harmless, not a failure.
  spawnSync(c1541, ["-attach", copy, "-read", file, outPrg], { encoding: "utf8" });
  if (existsSync(outPrg)) return finish(outPrg, work, { kind: "d64", imageSha1, file });
  const list = spawnSync(c1541, ["-attach", copy, "-list"], { encoding: "utf8" });
  const dir = directoryOf(list.stdout + list.stderr);
  return {
    ok: false,
    reason: "no-file",
    error: `"${file}" is not on the disk; it has: ${dir.join(", ") || "(nothing)"}`,
  };
}

function classify(imagePath: string): "prg" | "d64" | null {
  const ext = path.extname(imagePath).toLowerCase();
  return ext === ".prg" ? "prg" : ext === ".d64" ? "d64" : null;
}

/**
 * Synchronous core (c1541 and the hashing are both synchronous already);
 * resolveImage below wraps it in a Promise so callers can treat every image
 * source, prg and d64 alike, the same way.
 */
function resolveImageSync(ref: ImageRef, manifestPath: string): Resolved {
  const manifest = readManifest(manifestPath);
  if (!manifest) return { ok: false, reason: "no-manifest", error: `no manifest at ${manifestPath}` };
  const entry = manifest[ref.sha1];
  if (!entry) return { ok: false, reason: "unknown-sha1", error: `no manifest entry for sha1 ${ref.sha1}` };
  if (!existsSync(entry.path))
    return { ok: false, reason: "image-changed", error: `manifest image missing: ${entry.path}` };
  const actual = sha1Of(entry.path);
  if (actual !== ref.sha1)
    return {
      ok: false,
      reason: "image-changed",
      error: `${entry.path} is now sha1 ${actual}, manifest says ${ref.sha1}`,
    };
  const kind = classify(entry.path);
  if (!kind) return { ok: false, reason: "not-prg", error: `${entry.path} is neither a .d64 nor a .prg` };

  const work = mkdtempSync(path.join(tmpdir(), "re-image-"));
  const copy = path.join(work, "image" + path.extname(entry.path).toLowerCase());
  copyFileSync(entry.path, copy);

  if (kind === "prg") return finish(copy, work, { kind: "prg", imageSha1: ref.sha1 });

  if (!ref.file) {
    rmSync(work, { recursive: true, force: true });
    return { ok: false, reason: "no-file", error: "a D64 image needs image.file (a program name)" };
  }
  const r = extractFromD64(copy, ref.file, work, ref.sha1);
  if (!r.ok) rmSync(work, { recursive: true, force: true });
  return r;
}

export function resolveImage(ref: ImageRef, manifestPath = "data/games/manifest.json"): Promise<Resolved> {
  return Promise.resolve(resolveImageSync(ref, manifestPath));
}
