/**
 * A third-party game image, resolved by sha1 through a local manifest
 * (data/games/manifest.json, gitignored; never committed). The RE tools
 * only ever took a .prg inside this repo or the OS temp directory
 * (src/tools/re.ts allowedPrg); on the Commando dogfood run a D64 had to be
 * unpacked by hand with c1541 first. resolveImage does that unpacking.
 *
 * Every resolution copies the manifest's file into a fresh work directory
 * first, then hashes and reads *that copy*, never the original: hashing the
 * original before copying it would leave a window in which the source
 * changes between the check and the copy, so a caller's own D64 or PRG is
 * never opened for write, and a passing hash always describes the bytes the
 * run actually used. c1541's subprocess results (a failure to launch, its
 * exit status, and its stderr) are all checked; a run that neither produced
 * the requested file nor cleanly reported it missing, or that wrote
 * anything unexpected to stderr, is refused as "c1541-failed", never
 * silently accepted because a (possibly partial) file happened to exist,
 * and never misreported as "no-file" when the disk's own directory listing
 * cannot be trusted (measured: a listing with no `0 "<disk name>" <id>`
 * header row is not trustworthy, even when it has file-shaped rows).
 *
 * Measured directly here (VICE 3.10 c1541, node:child_process spawnSync,
 * stdout and stderr captured separately) on a successful -format, -read and
 * -list: stderr is always "" — the OPENCBM notice and every other narrative
 * line ("D64 disk image recognised: …", "Unit 8 drive 0: … attached/
 * detached…") go to stdout, not stderr, on this machine. Only that one
 * notice line is treated as benign if it ever does appear on stderr (a
 * different c1541 build might route it there); anything else on stderr is
 * refused. See test/re-image.test.ts for the captured transcripts.
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
      reason: "no-manifest" | "unknown-sha1" | "image-changed" | "no-file" | "not-prg" | "c1541-failed";
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

/** A `c1541 -list` row: a leading number (block count, or 0 for the disk-name header), a quoted name, then whatever trails it. */
const ROW = /^\s*(\d+)\s+"([^"]*)"(.*)$/gm;

/**
 * The file names a `c1541 -list` directory printout reports, in order. The
 * first row is always the disk-name header, not a file, so it is dropped —
 * call only after `hasDirectoryHeader` has confirmed that first row really
 * is one.
 */
export function directoryOf(text: string): string[] {
  return [...text.matchAll(ROW)].slice(1).map((m) => (m[2] ?? "").trimEnd());
}

// A file row's own trailing field is its file type, optionally locked (<)
// or a splat/error (*) — never the header's. block count 0 does not by
// itself mean "header": a DEL entry is also 0 blocks (measured on
// Commando.d64: `0    "----------------" del `), and its 16-dash name even
// fills the same 16-character field width as a real disk name.
const FILE_TYPE = /\b(prg|seq|usr|rel|del)[<*]?\s*$/i;
// The header's own two trailing fields, exactly: a bare 2-character disk ID
// then a 2-character DOS type, nothing else (measured: `0 "www.c64hq.com   " 00 2a`
// on Commando.d64; `0 "test            " 01 2a` on a c1541 -format fixture).
const HEADER_TAIL = /^\s+\S{2}\s+\S{2}\s*$/;

/**
 * True only when the first `c1541 -list` row is the disk-name header
 * itself, matched by shape, not merely a leading "0": a 16-character quoted
 * name (the D64 BAM's fixed disk-name width — a file's own name is never
 * padded to 16, only the header's is) followed by a bare 2-character disk
 * ID and a 2-character DOS type, and never a row ending in a file type. A
 * listing whose first row is a file, or a DEL entry, or is empty or
 * unparseable, is not trustworthy: `directoryOf` would otherwise silently
 * drop that row as if it were the header.
 */
export function hasDirectoryHeader(text: string): boolean {
  const first = [...text.matchAll(ROW)][0];
  if (!first) return false;
  const [, blocks, name, tail = ""] = first;
  if (blocks !== "0") return false;
  if ((name ?? "").length !== 16) return false;
  if (FILE_TYPE.test(tail)) return false;
  return HEADER_TAIL.test(tail);
}

function classify(imagePath: string): "prg" | "d64" | null {
  const ext = path.extname(imagePath).toLowerCase();
  return ext === ".prg" ? "prg" : ext === ".d64" ? "d64" : null;
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

// --- c1541 process handling -------------------------------------------------

interface ProcResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function runC1541(c1541: string, args: string[]): ProcResult {
  const r = spawnSync(c1541, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ...(r.error ? { error: r.error } : {}) };
}

// c1541 prints "OPENCBM: opening dynamic library libopencbm.dylib failed!"
// on this machine (no real IEC hardware attached); harmless, stripped from
// diagnostics rather than treated as a sign of failure.
const ANSI = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");
const BENIGN_LINE = "OPENCBM: opening dynamic library libopencbm.dylib failed!";

function cleanLines(text: string): string {
  return text
    .replace(ANSI, "")
    .split("\n")
    .filter((l) => l.trim() && l.trim() !== BENIGN_LINE)
    .join(" | ");
}

/** c1541's own narrative output, ANSI and the one known-benign line stripped, for a refusal's `error`. */
function diagnostics(r: ProcResult): string {
  const parts = [cleanLines(r.stdout), cleanLines(r.stderr)].filter(Boolean);
  return parts.join(" || ") || `c1541 exited ${String(r.status)}`;
}

/**
 * Measured here (VICE 3.10 c1541): a successful -format/-read/-list writes
 * nothing at all to stderr. Only the one known-benign notice is tolerated
 * there (in case a different c1541 build routes it to stderr instead of
 * stdout); anything else means the run is not trustworthy even if it
 * otherwise looks like it succeeded.
 */
export function stderrIsClean(stderr: string): boolean {
  return cleanLines(stderr) === "";
}

/**
 * `-read` neither produced the file nor exited 0: consult the disk's own
 * directory (ground truth) rather than guess a reason from c1541's text.
 */
function diagnoseMissingRead(c1541: string, copy: string, file: string, read: ProcResult): Resolved {
  const list = runC1541(c1541, ["-attach", copy, "-list"]);
  if (list.error)
    return { ok: false, reason: "c1541-failed", error: `c1541 -list did not run: ${list.error.message}` };
  if (list.status !== 0 || !hasDirectoryHeader(list.stdout) || !stderrIsClean(list.stderr))
    return { ok: false, reason: "c1541-failed", error: `c1541 could not list ${copy}: ${diagnostics(list)}` };
  const dir = directoryOf(list.stdout);
  if (dir.includes(file))
    return {
      ok: false,
      reason: "c1541-failed",
      error: `"${file}" is on the disk but c1541 could not read it: ${diagnostics(read)}`,
    };
  return {
    ok: false,
    reason: "no-file",
    error: `"${file}" is not on the disk; it has: ${dir.join(", ") || "(nothing)"}`,
  };
}

/** Extracts `file` from the D64 copy at `copy` into `work`/p.prg with c1541. */
function extractFromD64(copy: string, file: string, work: string, imageSha1: string): Resolved {
  const c1541 = findC1541();
  if (!c1541)
    return {
      ok: false,
      reason: "c1541-failed",
      error: "c1541 not found (C1541, PATH, .tools/vice-headless)",
    };
  const outPrg = path.join(work, "p.prg");
  const read = runC1541(c1541, ["-attach", copy, "-read", file, outPrg]);
  if (read.error)
    return { ok: false, reason: "c1541-failed", error: `c1541 -read did not run: ${read.error.message}` };
  // Only a clean exit, the file actually landing, and no unexpected stderr
  // counts as success: a nonzero exit that still left bytes at outPrg (a
  // partial read) is not accepted just because the file exists, and a
  // "successful" exit that still wrote something to stderr is not trusted
  // either (measured: a real success writes nothing there at all).
  if (read.status === 0 && existsSync(outPrg)) {
    if (!stderrIsClean(read.stderr))
      return {
        ok: false,
        reason: "c1541-failed",
        error: `c1541 -read exited 0 but wrote unexpected stderr: ${diagnostics(read)}`,
      };
    return finish(outPrg, work, { kind: "d64", imageSha1, file });
  }
  return diagnoseMissingRead(c1541, copy, file, read);
}

// --- resolution --------------------------------------------------------------

function resolveInWorkDir(ref: ImageRef, entry: ManifestEntry, kind: "prg" | "d64", work: string): Resolved {
  const copy = path.join(work, "image" + path.extname(entry.path).toLowerCase());
  try {
    copyFileSync(entry.path, copy);
  } catch (e) {
    return {
      ok: false,
      reason: "image-changed",
      error: `could not copy ${entry.path}: ${(e as Error).message}`,
    };
  }
  // Hash the copy, not entry.path: this is the run's own bytes from here on,
  // immune to whatever happens to the original after the copy completed.
  const actual = sha1Of(copy);
  if (actual !== ref.sha1)
    return {
      ok: false,
      reason: "image-changed",
      error: `${entry.path} is now sha1 ${actual}, manifest says ${ref.sha1}`,
    };
  if (kind === "prg") return finish(copy, work, { kind: "prg", imageSha1: ref.sha1 });
  if (!ref.file)
    return { ok: false, reason: "no-file", error: "a D64 image needs image.file (a program name)" };
  return extractFromD64(copy, ref.file, work, ref.sha1);
}

function resolveImageSync(ref: ImageRef, manifestPath: string): Resolved {
  const manifest = readManifest(manifestPath);
  if (!manifest) return { ok: false, reason: "no-manifest", error: `no manifest at ${manifestPath}` };
  const entry = manifest[ref.sha1];
  if (!entry) return { ok: false, reason: "unknown-sha1", error: `no manifest entry for sha1 ${ref.sha1}` };
  const kind = classify(entry.path);
  if (!kind) return { ok: false, reason: "not-prg", error: `${entry.path} is neither a .d64 nor a .prg` };

  const work = mkdtempSync(path.join(tmpdir(), "re-image-"));
  try {
    const result = resolveInWorkDir(ref, entry, kind, work);
    if (!result.ok) rmSync(work, { recursive: true, force: true });
    return result;
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Deferred to a microtask (never runs resolveImageSync in the caller's own
 * stack frame) so a filesystem error the caller did not anticipate becomes
 * a rejected promise, never a synchronous throw out of an async-contracted
 * function.
 */
export function resolveImage(ref: ImageRef, manifestPath = "data/games/manifest.json"): Promise<Resolved> {
  return Promise.resolve().then(() => resolveImageSync(ref, manifestPath));
}
