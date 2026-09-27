import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  directoryOf,
  hasDirectoryHeader,
  resolveImage,
  stderrIsClean,
  type Resolved,
} from "../src/re/image.ts";
import { findC1541, findToolchains } from "../scripts/lib/toolchains.ts";
import type * as FsModule from "node:fs";

// resolveImage's own copyFileSync/mkdtempSync calls are wrapped so specific
// tests can override one call; every other call (here and inside image.ts)
// keeps its real, passthrough behaviour.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>();
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync), mkdtempSync: vi.fn(actual.mkdtempSync) };
});

// Task 2 of docs/superpowers/plans/2026-09-24-re-step2-commando.md, and its
// fix round 1 (.superpowers/sdd/2026-09-24-re-step2-commando/task-2-review.md):
// resolveImage hashes the copy it makes, not the source, before extracting
// from it; checks c1541's own subprocess results rather than trusting a
// file's mere existence; and never throws synchronously nor leaks its work
// directory.
const c1541 = findC1541();
const tools = findToolchains();
const canBuildD64 = c1541 !== null && tools.kickass !== null && tools.java !== null;
const sha1 = (file: string) => createHash("sha1").update(readFileSync(file)).digest("hex");

const disposers: (() => void)[] = [];
const fixtureDirs: string[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  while (fixtureDirs.length) {
    const d = fixtureDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

/** A fixture-building temp dir (manifest, source files); tracked for cleanup, distinct from resolveImage's own "re-image-" work dirs. */
function fixtureDir(): string {
  const d = mkdtempSync(join(tmpdir(), "img-fixture-"));
  fixtureDirs.push(d);
  return d;
}

/** A tiny, syntactically valid PRG: load address $0801, then a couple of bytes. Never run, only copied and hashed. */
function writePrg(path: string): void {
  writeFileSync(path, Buffer.from([0x01, 0x08, 0xa9, 0x00, 0x60]));
}

/** A minimal KickAssembler-built PRG, for the D64 fixtures the brief asks for. */
function buildPrg(dir: string): string {
  writeFileSync(join(dir, "t.asm"), "BasicUpstart2(start)\nstart: rts\n");
  const r = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
    cwd: dir,
  });
  expect(r.status).toBe(0);
  return join(dir, "t.prg");
}

function writeManifest(dir: string, entries: Record<string, { path: string; title: string }>): string {
  const p = join(dir, "manifest.json");
  writeFileSync(p, JSON.stringify(entries));
  return p;
}

function keep(r: Resolved): Resolved {
  if (r.ok)
    disposers.push(() => {
      r.dispose();
    });
  return r;
}

/** resolveImage's own "re-image-*" work directories on disk right now, to check none leak past a refusal. */
function workDirs(): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((f) => f.startsWith("re-image-")));
}

/** A fake c1541 (a Node script) so a test controls its exit status and output precisely, no real disk needed. */
function fakeC1541(dir: string, script: string): string {
  const p = join(dir, "fake-c1541.cjs");
  writeFileSync(p, `#!/usr/bin/env node\n${script}`);
  chmodSync(p, 0o755);
  return p;
}

// resolveImage defers its work to a microtask (fix round 1, item 3), so the
// env var must stay set until that deferred work has actually run, not just
// until resolveImage(...) has returned a (still-pending) Promise.
async function withC1541Env<T>(path: string, run: () => Promise<T>): Promise<T> {
  const prev = process.env.C1541;
  process.env.C1541 = path;
  try {
    return await run();
  } finally {
    if (prev === undefined) delete process.env.C1541;
    else process.env.C1541 = prev;
  }
}

describe("directoryOf", () => {
  // Real c1541 -list output (measured on this machine, VICE 3.10): the
  // header line quotes the disk name, not a file, and is dropped.
  const LISTING = [
    "OPENCBM: opening dynamic library libopencbm.dylib failed!",
    "D64 disk image recognised: x.d64, 35 tracks.",
    "Unit 8 drive 0: D64 disk image attached: x.d64.",
    '0 "test            " 01 2a',
    '1    "prog"             prg ',
    '1    "prog2"            prg ',
    "662 blocks free.",
    "Unit 8 drive 0: D64 disk image detached: x.d64.",
  ].join("\n");

  it("lists file names, dropping the disk-name header", () => {
    expect(directoryOf(LISTING)).toEqual(["prog", "prog2"]);
  });

  it("returns an empty list for an empty disk", () => {
    const empty = LISTING.split("\n")
      .filter((l) => !l.includes('"prog'))
      .join("\n");
    expect(directoryOf(empty)).toEqual([]);
  });
});

// Fix round 2 (.superpowers/sdd/2026-09-24-re-step2-commando/task-2-rereview.md):
// stdout and stderr, captured separately with node:child_process spawnSync
// (the same call image.ts makes), measured here directly against a real
// c1541 3.10 (VICE) on a fixture disk built the same way test/re-image.test.ts
// builds one (`c1541 -format test,01 d64 x.d64 -write prog.prg prog`).
//
//   read = spawnSync(c1541, ["-attach", "x.d64", "-read", "prog", "out.prg"], { encoding: "utf8" })
//   read.status === 0, read.stdout === MEASURED_READ_STDOUT, read.stderr === ""
//
//   list = spawnSync(c1541, ["-attach", "x.d64", "-list"], { encoding: "utf8" })
//   list.status === 0, list.stdout === MEASURED_LIST_STDOUT, list.stderr === ""
//
// A successful -format, -read and -list all wrote nothing at all to
// stderr: the OPENCBM notice and every other narrative line are on stdout.
const MEASURED_READ_STDOUT = [
  "\u001b[97;40mOPENCBM\u001b[0m: opening dynamic library libopencbm.dylib failed!",
  "D64 disk image recognised: /private/tmp/c1541-measure/x.d64, 35 tracks.",
  "Unit 8 drive 0: D64 disk image attached: /private/tmp/c1541-measure/x.d64.",
  "reading file `prog' from unit 8",
  "Unit 8 drive 0: D64 disk image detached: /private/tmp/c1541-measure/x.d64.",
  "",
].join("\n");
const MEASURED_READ_STDERR = "";
const MEASURED_LIST_STDOUT = [
  "\u001b[97;40mOPENCBM\u001b[0m: opening dynamic library libopencbm.dylib failed!",
  "D64 disk image recognised: /private/tmp/c1541-measure/x.d64, 35 tracks.",
  "Unit 8 drive 0: D64 disk image attached: /private/tmp/c1541-measure/x.d64.",
  '0 "test            " 01 2a',
  '1    "prog"             prg ',
  "663 blocks free.",
  "Unit 8 drive 0: D64 disk image detached: /private/tmp/c1541-measure/x.d64.",
  "",
].join("\n");
// Measured on a `-read` of a file not on the disk (round 1's probe): the one
// case where c1541 does write to stderr.
const MEASURED_MISSING_FILE_STDERR = "cannot read `nope' on unit 8\ninvalid filename\n";

// Fix round 3 (.superpowers/sdd/2026-09-24-re-step2-commando/task-2-rereview.md):
// `-list` on the maintainer's own Commando.d64 (data/games/manifest.json;
// copied first, per resolveImage's own rule, never the original), measured
// the same way as the fixtures above. Every scratched file on this disk
// shows as a DEL row with 0 blocks, the same leading digit as the header:
// `0    "----------------" del `. Its 16-dash name even fills the header's
// own 16-character field width, so neither "block count 0" nor "name is 16
// characters" alone tells a DEL row from the header — only the header's
// bare-2-char-ID/2-char-type tail versus a DEL row's file-type tail does.
const MEASURED_COMMANDO_LIST_STDOUT = [
  "\u001b[97;40mOPENCBM\u001b[0m: opening dynamic library libopencbm.dylib failed!",
  "D64 disk image recognised: /tmp/commando-measure/copy.d64, 35 tracks.",
  "Unit 8 drive 0: D64 disk image attached: /tmp/commando-measure/copy.d64.",
  '0 "www.c64hq.com   " 00 2a',
  '0    "----------------" del ',
  '120  "commando+5hi/rem" prg ',
  '1    "commando hi /rem" prg ',
  '0    "----------------" del ',
  '117  "commando +   /dr" prg ',
  '0    "----------------" del ',
  '170  "commando"         prg ',
  '0    "----------------" del ',
  '183  "commando ii"      prg ',
  '0    "----------------" del ',
  "73 blocks free.",
  "Unit 8 drive 0: D64 disk image detached: /tmp/commando-measure/copy.d64.",
  "",
].join("\n");

describe("hasDirectoryHeader", () => {
  it("is true for a real listing's own header row", () => {
    expect(hasDirectoryHeader(MEASURED_LIST_STDOUT)).toBe(true);
  });

  it("is false for a real -read transcript's stdout (narrative text, no directory rows at all)", () => {
    expect(hasDirectoryHeader(MEASURED_READ_STDOUT)).toBe(false);
  });

  it("is false for a listing whose first row is a file, not the disk-name header (no header at all)", () => {
    // The exact construction from the re-review: a file-shaped row with no
    // "0 ..." header before it. The old check (`/^\s*\d+\s+"/m`, any digit)
    // accepted this; directoryOf would then silently drop "prog" as if it
    // were the header, and the caller would wrongly conclude "no-file".
    const headerless = '1    "prog"             prg \n663 blocks free.\n';
    expect(hasDirectoryHeader(headerless)).toBe(false);
  });

  it("is false for empty or unparseable text", () => {
    expect(hasDirectoryHeader("")).toBe(false);
    expect(hasDirectoryHeader("Error - Cannot read image header.\n")).toBe(false);
  });

  // Fix round 3: block count 0 alone does not mean "header" — a DEL entry
  // is also 0 blocks, and a short, unpadded quoted name is not a header
  // either (a real header's name is always the full 16-character field).
  it('is false for a 0-block file row shaped like a header but with a file-type tail (0 "prog" prg)', () => {
    expect(hasDirectoryHeader('0 "prog" prg\n663 blocks free.\n')).toBe(false);
  });

  it('is false for a 0-block row with a quoted name and nothing else (0 "prog")', () => {
    expect(hasDirectoryHeader('0 "prog"\n663 blocks free.\n')).toBe(false);
  });

  it("is true for the real header measured on the maintainer's own Commando.d64", () => {
    expect(hasDirectoryHeader(MEASURED_COMMANDO_LIST_STDOUT)).toBe(true);
  });

  it("keeps a DEL row (0 blocks, a 16-dash name filling the header's own field width) out of being read as the header", () => {
    // The true header is still row 0; every DEL row's file-shaped tail
    // ("del", not two bare 2-character fields) rules each one out, whether
    // it is scanned or not — hasDirectoryHeader only looks at the first
    // row, which here correctly is the real header, not a DEL row.
    expect(hasDirectoryHeader(MEASURED_COMMANDO_LIST_STDOUT)).toBe(true);
    expect(directoryOf(MEASURED_COMMANDO_LIST_STDOUT)).toEqual([
      "----------------",
      "commando+5hi/rem",
      "commando hi /rem",
      "----------------",
      "commando +   /dr",
      "----------------",
      "commando",
      "----------------",
      "commando ii",
      "----------------",
    ]);
  });

  it("is false when a DEL row is the only, first row (no real header at all)", () => {
    // The exact class of bug the re-review reported, via the other case
    // that also has a leading 0: a listing whose first row is a DEL entry,
    // not the disk-name header.
    const headerless = '0    "----------------" del \n663 blocks free.\n';
    expect(hasDirectoryHeader(headerless)).toBe(false);
  });
});

describe("stderrIsClean", () => {
  it("is true for a real successful run's stderr (measured: always empty)", () => {
    expect(stderrIsClean(MEASURED_READ_STDERR)).toBe(true);
  });

  it("is true when stderr holds only the one known-benign notice (defensive: a different c1541 build might route it there)", () => {
    expect(stderrIsClean("OPENCBM: opening dynamic library libopencbm.dylib failed!\n")).toBe(true);
  });

  it("is false for a real failure's stderr", () => {
    expect(stderrIsClean(MEASURED_MISSING_FILE_STDERR)).toBe(false);
  });

  it("is false for any other unexpected content", () => {
    expect(stderrIsClean("Segmentation fault\n")).toBe(false);
  });
});

describe("resolveImage: manifest and hash checks", () => {
  it("refuses when the manifest file does not exist", async () => {
    const dir = fixtureDir();
    const r = await resolveImage({ sha1: "a".repeat(40) }, join(dir, "no-such-manifest.json"));
    expect(r).toMatchObject({ ok: false, reason: "no-manifest" });
  });

  it("refuses a sha1 with no manifest entry", async () => {
    const dir = fixtureDir();
    const prg = join(dir, "game.prg");
    writePrg(prg);
    const manifest = writeManifest(dir, { [sha1(prg)]: { path: prg, title: "Game" } });
    const r = await resolveImage({ sha1: "b".repeat(40) }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "unknown-sha1" });
  });

  it("refuses when the manifest's file no longer hashes to its key", async () => {
    const dir = fixtureDir();
    const prg = join(dir, "game.prg");
    writePrg(prg);
    const claimedSha1 = sha1(prg);
    // Change the file after the manifest was written for it.
    writeFileSync(prg, Buffer.from([0x01, 0x08, 0xa9, 0x01, 0x60]));
    const manifest = writeManifest(dir, { [claimedSha1]: { path: prg, title: "Game" } });
    const r = await resolveImage({ sha1: claimedSha1 }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "image-changed" });
  });

  it("refuses image-changed, not a throw, when the manifest's file has vanished", async () => {
    const dir = fixtureDir();
    const prg = join(dir, "game.prg");
    writePrg(prg);
    const claimedSha1 = sha1(prg);
    const manifest = writeManifest(dir, { [claimedSha1]: { path: prg, title: "Game" } });
    rmSync(prg);
    const before = workDirs();
    const r = await resolveImage({ sha1: claimedSha1 }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "image-changed" });
    expect(workDirs()).toEqual(before);
  });

  it("refuses an image that is neither a .d64 nor a .prg", async () => {
    const dir = fixtureDir();
    const seq = join(dir, "game.seq");
    writeFileSync(seq, Buffer.from([1, 2, 3]));
    const manifest = writeManifest(dir, { [sha1(seq)]: { path: seq, title: "Game" } });
    const r = await resolveImage({ sha1: sha1(seq) }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "not-prg" });
  });
});

// Fix round 1, item 1: the resolver used to hash entry.path (the source)
// before copying it, so a copy whose bytes end up different from what was
// checked (a race, a symlink swap, a flaky filesystem) still passed. It must
// hash the copy it is about to use instead.
describe("resolveImage: hashes the copy it makes, not the source", () => {
  it("refuses image-changed when the copy's own bytes do not match, even though the source on disk still does", async () => {
    const dir = fixtureDir();
    const prg = join(dir, "game.prg");
    writePrg(prg);
    const imageSha1 = sha1(prg);
    const manifest = writeManifest(dir, { [imageSha1]: { path: prg, title: "Game" } });

    const fsMod = await import("node:fs");
    // Simulate the copy operation capturing different bytes than a pre-copy
    // hash of entry.path would have already validated (the source is left
    // untouched here, matching imageSha1 throughout: only the copy differs).
    vi.mocked(fsMod.copyFileSync).mockImplementationOnce((_src, dest) => {
      writeFileSync(dest, Buffer.from([0x01, 0x08, 0xa9, 0xff, 0x60]));
    });

    const r = await resolveImage({ sha1: imageSha1 }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "image-changed" });
    // Proof the source itself was never the problem.
    expect(sha1(prg)).toBe(imageSha1);
  });
});

describe("resolveImage: PRG image", () => {
  it("resolves a plain PRG, copying it, never the caller's own file", async () => {
    const dir = fixtureDir();
    const prg = join(dir, "game.prg");
    writePrg(prg);
    const imageSha1 = sha1(prg);
    const manifest = writeManifest(dir, { [imageSha1]: { path: prg, title: "Game" } });
    const r = keep(await resolveImage({ sha1: imageSha1 }, manifest));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prg).not.toBe(prg);
    expect(existsSync(r.prg)).toBe(true);
    expect(r.image).toEqual({ sha1: imageSha1, kind: "prg", fileSha1: imageSha1 });
    r.dispose();
    expect(existsSync(r.prg)).toBe(false);
    // The caller's own file is untouched.
    expect(existsSync(prg)).toBe(true);
  });
});

// Fix round 1, item 3: resolveImage must not throw synchronously (the
// Promise it returns wraps every failure, expected or not), and must not
// leave its work directory behind on any unsuccessful exit.
describe("resolveImage: never throws synchronously; always cleans up on failure", () => {
  it("returns a Promise without throwing, and that Promise rejects, for a failure the resolver did not anticipate", async () => {
    const dir = fixtureDir();
    const prg = join(dir, "game.prg");
    writePrg(prg);
    const imageSha1 = sha1(prg);
    const manifest = writeManifest(dir, { [imageSha1]: { path: prg, title: "Game" } });

    const fsMod = await import("node:fs");
    vi.mocked(fsMod.mkdtempSync).mockImplementationOnce(() => {
      throw new Error("simulated: disk full");
    });

    let promise!: Promise<Resolved>;
    expect(() => {
      promise = resolveImage({ sha1: imageSha1 }, manifest);
    }).not.toThrow();
    await expect(promise).rejects.toThrow(/simulated: disk full/);
  });
});

// Fix round 1, item 2: extractFromD64 used to accept whatever `-read` left
// on disk purely because the target file existed, and never looked at
// c1541's own exit status or a launch failure. These fakes give exact,
// deterministic control over c1541's subprocess results without a real disk.
describe("resolveImage: checks c1541's own subprocess results", () => {
  function d64Manifest(dir: string): { manifest: string; sha1: string } {
    const disk = join(dir, "game.d64");
    writeFileSync(disk, Buffer.from([1, 2, 3, 4])); // never actually parsed by these fakes
    const imageSha1 = sha1(disk);
    return { manifest: writeManifest(dir, { [imageSha1]: { path: disk, title: "Game" } }), sha1: imageSha1 };
  }

  it("refuses c1541-failed when c1541 cannot even be launched", async () => {
    const dir = fixtureDir();
    const { manifest, sha1: imageSha1 } = d64Manifest(dir);
    const notExecutable = join(dir, "not-c1541");
    writeFileSync(notExecutable, "not a real binary\n");
    chmodSync(notExecutable, 0o644);

    const r = await withC1541Env(notExecutable, () =>
      resolveImage({ sha1: imageSha1, file: "prog" }, manifest),
    );
    expect(r).toMatchObject({ ok: false, reason: "c1541-failed" });
    if (!r.ok) expect(r.error).toMatch(/did not run/);
  });

  it("refuses c1541-failed, not no-file, when the fallback directory listing is itself unreadable", async () => {
    const dir = fixtureDir();
    const { manifest, sha1: imageSha1 } = d64Manifest(dir);
    const bin = fakeC1541(
      dir,
      [
        "const args = process.argv.slice(2);",
        'if (args.includes("-read")) process.exit(1);',
        'if (args.includes("-list")) { process.stdout.write("garbage, no header\\n"); process.exit(0); }',
        "process.exit(1);",
      ].join("\n"),
    );
    const r = await withC1541Env(bin, () => resolveImage({ sha1: imageSha1, file: "prog" }, manifest));
    expect(r).toMatchObject({ ok: false, reason: "c1541-failed" });
  });

  it("refuses c1541-failed, not no-file, when the disk's own listing shows the file is there but unreadable", async () => {
    const dir = fixtureDir();
    const { manifest, sha1: imageSha1 } = d64Manifest(dir);
    const bin = fakeC1541(
      dir,
      [
        "const args = process.argv.slice(2);",
        'if (args.includes("-read")) process.exit(1);',
        'if (args.includes("-list")) { process.stdout.write(\'0 "test            " 01 2a\\n1    "prog"             prg \\n663 blocks free.\\n\'); process.exit(0); }',
        "process.exit(1);",
      ].join("\n"),
    );
    const r = await withC1541Env(bin, () => resolveImage({ sha1: imageSha1, file: "prog" }, manifest));
    expect(r).toMatchObject({ ok: false, reason: "c1541-failed" });
    if (!r.ok) expect(r.error).toMatch(/could not read it/);
  });

  it("never accepts a partial file left by a failed read merely because it exists", async () => {
    const dir = fixtureDir();
    const { manifest, sha1: imageSha1 } = d64Manifest(dir);
    const bin = fakeC1541(
      dir,
      [
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        'if (args.includes("-read")) {',
        "  const out = args[args.length - 1];",
        "  fs.writeFileSync(out, Buffer.from([0xde, 0xad])); // a partial write, exit nonzero anyway",
        "  process.exit(1);",
        "}",
        'if (args.includes("-list")) { process.stdout.write(\'0 "test            " 01 2a\\n663 blocks free.\\n\'); process.exit(0); }',
        "process.exit(1);",
      ].join("\n"),
    );
    const before = workDirs();
    const r = await withC1541Env(bin, () => resolveImage({ sha1: imageSha1, file: "prog" }, manifest));
    expect(r).toMatchObject({ ok: false, reason: "no-file" });
    expect(workDirs()).toEqual(before);
  });

  // Fix round 2, item 1: a status-0 "-read" that still wrote something
  // unexpected to stderr used to be accepted outright (existsSync(outPrg)
  // was the only check). Measured here: a real success never writes to
  // stderr at all, so any content there means the run cannot be trusted.
  it("refuses c1541-failed when a status-0 read still wrote unexpected stderr", async () => {
    const dir = fixtureDir();
    const { manifest, sha1: imageSha1 } = d64Manifest(dir);
    const bin = fakeC1541(
      dir,
      [
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        'if (args.includes("-read")) {',
        "  const out = args[args.length - 1];",
        "  fs.writeFileSync(out, Buffer.from([0x01, 0x08, 0xa9, 0x00, 0x60]));",
        '  process.stderr.write("unexpected: disk error on track 18\\n");',
        "  process.exit(0); // looks successful: file written, exit 0",
        "}",
        "process.exit(1);",
      ].join("\n"),
    );
    const before = workDirs();
    const r = await withC1541Env(bin, () => resolveImage({ sha1: imageSha1, file: "prog" }, manifest));
    expect(r).toMatchObject({ ok: false, reason: "c1541-failed" });
    if (!r.ok) expect(r.error).toMatch(/unexpected stderr/);
    expect(workDirs()).toEqual(before);
  });

  it("still accepts a status-0 read whose only stderr is the one known-benign notice", async () => {
    const dir = fixtureDir();
    const { manifest, sha1: imageSha1 } = d64Manifest(dir);
    const bin = fakeC1541(
      dir,
      [
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        'if (args.includes("-read")) {',
        "  const out = args[args.length - 1];",
        "  fs.writeFileSync(out, Buffer.from([0x01, 0x08, 0xa9, 0x00, 0x60]));",
        '  process.stderr.write("OPENCBM: opening dynamic library libopencbm.dylib failed!\\n");',
        "  process.exit(0);",
        "}",
        "process.exit(1);",
      ].join("\n"),
    );
    const r = keep(await withC1541Env(bin, () => resolveImage({ sha1: imageSha1, file: "prog" }, manifest)));
    expect(r).toMatchObject({ ok: true });
  });

  // Fix round 2, item 2: a listing whose first row is a file, not the
  // disk's own "0 ..." header (a truncated or corrupted listing), used to
  // pass hasDirectoryHeader (any digit-prefixed row matched) and then have
  // that file silently dropped by directoryOf as if it were the header —
  // exactly the construction the re-review reported.
  it("refuses c1541-failed, not no-file, when the fallback listing has a file row but no disk-name header at all", async () => {
    const dir = fixtureDir();
    const { manifest, sha1: imageSha1 } = d64Manifest(dir);
    const bin = fakeC1541(
      dir,
      [
        "const args = process.argv.slice(2);",
        'if (args.includes("-read")) process.exit(1);',
        'if (args.includes("-list")) { process.stdout.write(\'1    "prog"             prg \\n663 blocks free.\\n\'); process.exit(0); }',
        "process.exit(1);",
      ].join("\n"),
    );
    const before = workDirs();
    const r = await withC1541Env(bin, () => resolveImage({ sha1: imageSha1, file: "prog" }, manifest));
    expect(r).toMatchObject({ ok: false, reason: "c1541-failed" });
    if (!r.ok) expect(r.error).not.toMatch(/is not on the disk/);
    expect(workDirs()).toEqual(before);
  });
});

describe.skipIf(!canBuildD64)("resolveImage: D64 image", () => {
  function fixtureDisk(dir: string): { disk: string; prgBytes: Buffer } {
    const prg = buildPrg(dir);
    const prgBytes = readFileSync(prg);
    const disk = join(dir, "game.d64");
    const fmt = spawnSync(c1541 ?? "c1541", ["-format", "test,01", "d64", disk, "-write", prg, "prog"]);
    expect(fmt.status).toBe(0);
    return { disk, prgBytes };
  }

  it("extracts a named file, copying the disk first, with the fixture's own bytes", async () => {
    const dir = fixtureDir();
    const { disk, prgBytes } = fixtureDisk(dir);
    const before = readFileSync(disk);
    const imageSha1 = sha1(disk);
    const manifest = writeManifest(dir, { [imageSha1]: { path: disk, title: "Game" } });
    const r = keep(await resolveImage({ sha1: imageSha1, file: "prog" }, manifest));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(existsSync(r.prg)).toBe(true);
    expect(r.image.kind).toBe("d64");
    expect(r.image.file).toBe("prog");
    expect(r.image.sha1).toBe(imageSha1);
    // Not just "hashes match" (tautological against the file's own bytes):
    // the extracted bytes are byte-for-byte the fixture PRG that was written
    // onto the disk.
    expect(readFileSync(r.prg).equals(prgBytes)).toBe(true);
    expect(r.image.fileSha1).toBe(sha1(r.prg));
    expect(r.image.fileSha1).not.toBe(imageSha1);
    // The caller's own disk is untouched.
    expect(readFileSync(disk).equals(before)).toBe(true);
  });

  it("refuses a file name not on the disk, listing what is there", async () => {
    const dir = fixtureDir();
    const { disk } = fixtureDisk(dir);
    const imageSha1 = sha1(disk);
    const manifest = writeManifest(dir, { [imageSha1]: { path: disk, title: "Game" } });
    const r = await resolveImage({ sha1: imageSha1, file: "nosuchfile" }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "no-file" });
    if (r.ok) return;
    expect(r.error).toMatch(/prog/);
  });

  it("refuses a D64 image with no file name given, and cleans up its work directory", async () => {
    const dir = fixtureDir();
    const { disk } = fixtureDisk(dir);
    const imageSha1 = sha1(disk);
    const manifest = writeManifest(dir, { [imageSha1]: { path: disk, title: "Game" } });
    const before = workDirs();
    const r = await resolveImage({ sha1: imageSha1 }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "no-file" });
    expect(workDirs()).toEqual(before);
  });
});
