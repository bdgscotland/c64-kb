import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHit, readHits, storedValue } from "../src/re/monlog.ts";
import { readPrg } from "../src/re/prg.ts";

const STORE = [
  "#1 (Trace store 00fb)   41/$029,  62/$3e",
  ".C:0819  86 FB       STX $FB        - A:FF X:12 Y:00 SP:f6 ..-..I..    3049325",
] as const;
const EXEC = [
  "#4 (Trace  exec 080e)  208/$0d0,  52/$34",
  ".C:080e  A9 FF       LDA #$FF       - A:00 X:00 Y:00 SP:f6 ..-.....    3169590",
] as const;

describe("monitor log parser", () => {
  it("keeps the raster line and cycle of a store", () => {
    expect(parseHit(...STORE)).toMatchObject({
      kind: "store",
      addr: 0xfb,
      pc: 0x819,
      line: 41,
      cycle: 62,
      clock: 3049325,
    });
  });
  it("reads an exec hit logged with two spaces", () => {
    expect(parseHit(...EXEC)).toMatchObject({ kind: "exec", addr: 0x80e, line: 208, cycle: 52 });
  });
  it("values STX from X and leaves INC unknown", () => {
    const h = parseHit(...STORE);
    expect(h && storedValue(h)).toBe(0x12);
    expect(h && storedValue({ ...h, mnemonic: "INC" })).toBeNull();
  });
  it("streams every hit from a log file and skips other lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "monlog-"));
    const log = join(dir, "t.log");
    writeFileSync(log, ["noise", ...STORE, "more noise", ...EXEC, ""].join("\n"));
    const hits = [];
    for await (const h of readHits(log)) hits.push(h.addr);
    expect(hits).toEqual([0xfb, 0x80e]);
  });
  it("reads a PRG's load address and SYS target", () => {
    // $0801: 10 SYS 2061 -> $080D
    const bytes = Uint8Array.from([
      0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0, 0x60,
    ]);
    expect(readPrg(bytes)).toMatchObject({ load: 0x801, sys: 0x80d });
  });
});
