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
import { directoryOf, resolveImage, type Resolved } from "../src/re/image.ts";
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
