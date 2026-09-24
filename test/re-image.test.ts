import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { directoryOf, resolveImage, type Resolved } from "../src/re/image.ts";
import { findC1541 } from "../scripts/lib/toolchains.ts";

// Task 2 of docs/superpowers/plans/2026-09-24-re-step2-commando.md: a third-party
// image never lives in the repo, only its sha1 and a local manifest entry
// pointing at the maintainer's own copy on disk do. resolveImage hashes that
// copy, refuses a mismatch, and for a D64 extracts one named file with c1541.
const c1541 = findC1541();
const sha1 = (file: string) => createHash("sha1").update(readFileSync(file)).digest("hex");

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()?.();
});

/** A tiny, syntactically valid PRG: load address $0801, then a couple of bytes. */
function writePrg(path: string): void {
  writeFileSync(path, Buffer.from([0x01, 0x08, 0xa9, 0x00, 0x60]));
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
    const dir = mkdtempSync(join(tmpdir(), "re-image-"));
    const r = await resolveImage({ sha1: "a".repeat(40) }, join(dir, "no-such-manifest.json"));
    expect(r).toMatchObject({ ok: false, reason: "no-manifest" });
  });

  it("refuses a sha1 with no manifest entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-image-"));
    const prg = join(dir, "game.prg");
    writePrg(prg);
    const manifest = writeManifest(dir, { [sha1(prg)]: { path: prg, title: "Game" } });
    const r = await resolveImage({ sha1: "b".repeat(40) }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "unknown-sha1" });
  });

  it("refuses when the manifest's file no longer hashes to its key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-image-"));
    const prg = join(dir, "game.prg");
    writePrg(prg);
    const claimedSha1 = sha1(prg);
    // Change the file after the manifest was written for it.
    writeFileSync(prg, Buffer.from([0x01, 0x08, 0xa9, 0x01, 0x60]));
    const manifest = writeManifest(dir, { [claimedSha1]: { path: prg, title: "Game" } });
    const r = await resolveImage({ sha1: claimedSha1 }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "image-changed" });
  });

  it("refuses an image that is neither a .d64 nor a .prg", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-image-"));
    const seq = join(dir, "game.seq");
    writeFileSync(seq, Buffer.from([1, 2, 3]));
    const manifest = writeManifest(dir, { [sha1(seq)]: { path: seq, title: "Game" } });
    const r = await resolveImage({ sha1: sha1(seq) }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "not-prg" });
  });
});

describe("resolveImage: PRG image", () => {
  it("resolves a plain PRG, copying it, never the caller's own file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-image-"));
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

describe.skipIf(!c1541)("resolveImage: D64 image", () => {
  function fixtureDisk(dir: string): string {
    const disk = join(dir, "game.d64");
    const prg = join(dir, "prog.prg");
    writePrg(prg);
    const fmt = spawnSync(c1541 ?? "c1541", ["-format", "test,01", "d64", disk, "-write", prg, "prog"]);
    expect(fmt.status).toBe(0);
    return disk;
  }

  it("extracts a named file, copying the disk first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-image-"));
    const disk = fixtureDisk(dir);
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
    // The extracted PRG hashes differently from the D64 that held it.
    expect(r.image.fileSha1).toBe(sha1(r.prg));
    expect(r.image.fileSha1).not.toBe(imageSha1);
    // The caller's own disk is untouched.
    expect(readFileSync(disk).equals(before)).toBe(true);
  });

  it("refuses a file name not on the disk, listing what is there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-image-"));
    const disk = fixtureDisk(dir);
    const imageSha1 = sha1(disk);
    const manifest = writeManifest(dir, { [imageSha1]: { path: disk, title: "Game" } });
    const r = await resolveImage({ sha1: imageSha1, file: "nosuchfile" }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "no-file" });
    if (r.ok) return;
    expect(r.error).toMatch(/prog/);
  });

  it("refuses a D64 image with no file name given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-image-"));
    const disk = fixtureDisk(dir);
    const imageSha1 = sha1(disk);
    const manifest = writeManifest(dir, { [imageSha1]: { path: disk, title: "Game" } });
    const r = await resolveImage({ sha1: imageSha1 }, manifest);
    expect(r).toMatchObject({ ok: false, reason: "no-file" });
  });
});
