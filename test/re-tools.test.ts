import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Hit } from "../src/re/monlog.ts";
import { allowedPrg, fromEntry, parseMarker, reIrqChain } from "../src/tools/re.ts";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

describe("inputs", () => {
  it("refuses a path outside the repo and temp, a missing file, a non-PRG", () => {
    expect(allowedPrg("/etc/hosts")).toBeNull();
    expect(allowedPrg(join(tmpdir(), "missing.prg"))).toBeNull();
    expect(allowedPrg(join(import.meta.dirname, "..", "package.json"))).toBeNull();
  });
  it("parses store and pc markers", () => {
    expect(parseMarker("store:$DC0F=$11")).toEqual({ store: 0xdc0f, value: 0x11 });
    expect(parseMarker("pc:$2000")).toEqual({ pc: 0x2000 });
    expect(parseMarker("store:$DC0F")).toBeNull();
  });
  it("returns a refusal, not a throw, and launches nothing for a bad path", async () => {
    const r = await reIrqChain({ prg_path: "/etc/hosts", model: "pal", cycles: 1000 });
    expect(r).toMatchObject({ ok: false, reason: "path" });
  });
});

const hit = (kind: Hit["kind"], addr: number, clock: number): Hit => ({
  kind,
  addr,
  pc: addr,
  mnemonic: "STA",
  operand: "",
  a: 0,
  x: 0,
  y: 0,
  sp: 0xf6,
  flags: "",
  clock,
  line: 0,
  cycle: 0,
});

describe("entry clock", () => {
  const trace = [
    hit("store", 0xd012, 5),
    hit("exec", 0x080d, 10),
    hit("exec", 0x080d, 90),
    hit("store", 0xd012, 20),
  ];
  it("starts at the first exec of the SYS target and drops the tool's own entry hits", () => {
    const r = fromEntry(trace, 0x080d, true);
    expect(r?.start).toBe(10);
    expect(r?.hits.map((h) => h.clock)).toEqual([5, 20]);
  });
  it("keeps entry hits when the caller traced that PC itself (a marker at the SYS address)", () => {
    expect(fromEntry(trace, 0x080d, false)?.hits).toHaveLength(4);
  });
  it("gives null when the SYS target never ran, never clock 0", () => {
    expect(fromEntry([hit("store", 0xd012, 5)], 0x080d, true)).toBeNull();
  });
  it("starts at clock 0 when the PRG has no SYS target", () => {
    expect(fromEntry(trace, null, false)).toEqual({ start: 0, hits: trace });
  });
});

const SOURCE = [
  "BasicUpstart2(start)",
  "start: sei",
  "    lda #$35",
  "    sta $01",
  "    lda #$7f",
  "    sta $dc0d",
  "    lda $dc0d",
  "    lda #<irq",
  "    sta $fffe",
  "    lda #>irq",
  "    sta $ffff",
  "    lda #$1b",
  "    sta $d011",
  "    lda #100",
  "    sta $d012",
  "    lda #$ff",
  "    sta $d019",
  "    lda #1",
  "    sta $d01a",
  "    cli",
  "    jmp *",
  "irq: pha",
  "    lda #1",
  "    sta $d019",
  "    pla",
  "    rti",
];

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

describe.skipIf(!canRun)("c64_re_irq_chain in VICE", () => {
  const build = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "re-tools-"));
    writeFileSync(join(dir, "t.asm"), SOURCE.join("\n"));
    expect(
      spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], { cwd: dir })
        .status,
    ).toBe(0);
    return join(dir, "t.prg");
  };

  it("refuses with no-entry when the run ends before the SYS target runs", async () => {
    const r = await reIrqChain({ prg_path: build(), model: "pal", cycles: 200_000 });
    expect(r).toMatchObject({ ok: false, reason: "no-entry" });
    if (!r.ok) expect(r.error).toMatch(/^entry \$[0-9A-F]{4} not reached in 200000 cycles; raise cycles$/);
  }, 120_000);

  it("finds a $FFFE handler armed at line 100 and entered on it", async () => {
    const r = await reIrqChain({ prg_path: build(), model: "pal", cycles: 4_000_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.result.handlers.find((x) => x.via.includes("irq_fffe"));
    expect(h?.armed_before).toEqual([100]);
    expect(h?.entry_lines.every((l) => l === 100 || l === 101)).toBe(true);
    expect(h?.entries).toBeGreaterThan(10);
  }, 120_000);
});
