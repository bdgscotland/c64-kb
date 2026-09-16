import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePsidHeader, parseStilTxt, parseSongLengths } from "../catalog.js";

const FIXTURES = join(__dirname, "fixtures");

describe("parsePsidHeader", () => {
  it("parses a PSID v2 header into structured fields", () => {
    const raw = readFileSync(join(FIXTURES, "psid-v2-header.bin"));
    const h = parsePsidHeader(raw);
    expect(h.magic).toBe("PSID");
    expect(h.version).toBe(2);
    expect(h.loadAddress).toBe(0x1000);
    expect(h.initAddress).toBe(0x1000);
    expect(h.playAddress).toBe(0x1003);
    expect(h.subtuneCount).toBe(1);
  });

  it("rejects a buffer that is too short", () => {
    expect(() => parsePsidHeader(Buffer.from([0, 1, 2]))).toThrow(/short/i);
  });

  it("rejects a buffer with bad magic", () => {
    const bad = Buffer.alloc(124);
    bad.write("XXXX", 0, "ascii");
    expect(() => parsePsidHeader(bad)).toThrow(/magic/i);
  });
});

describe("parseStilTxt", () => {
  it("returns one entry per tune path with its comments", () => {
    const raw = readFileSync(join(FIXTURES, "stil-sample.txt"), "utf8");
    const entries = parseStilTxt(raw);
    expect(entries.size).toBe(3);
    const commando = entries.get("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
    expect(commando).toBeDefined();
    expect(commando!.comments.length).toBeGreaterThanOrEqual(2);
    expect(commando!.comments[0]).toMatch(/iconic/);
    expect(commando!.artist).toBe("Rob Hubbard");
  });

  it("parses COVER: as a separate field linking tune paths", () => {
    const raw = readFileSync(join(FIXTURES, "stil-sample.txt"), "utf8");
    const entries = parseStilTxt(raw);
    const wizball = entries.get("/MUSICIANS/G/Galway_Martin/Wizball.sid")!;
    expect(wizball.covers.length).toBe(1);
    expect(wizball.covers[0]).toMatch(/Some_Other_Tune\.sid/);
  });
});

describe("parseSongLengths", () => {
  it("returns md5 -> array of subtune-length seconds", () => {
    const raw = readFileSync(join(FIXTURES, "songlengths-sample.md5"), "utf8");
    const map = parseSongLengths(raw);
    expect(map.size).toBe(3);
    expect(map.get("abc123def456abc123def456abc123de")).toEqual([95]);
    expect(map.get("fed987cba654fed987cba654fed987cb")).toEqual([135, 222, 45]);
  });
});
