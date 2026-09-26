import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Hit } from "../src/re/monlog.ts";
import { REGION_TIMING } from "../src/domain/timing.ts";
import { allowedPrg, fromEntry, parseMarker, reFrameProfile, reIrqChain } from "../src/tools/re.ts";
import { reFrameMode } from "../src/tools/re-frame.ts";
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

// Ported from bdgscotland/re-irq-dispatch f561ac8 and fa2f00f.
describe.skipIf(!canRun)("c64_re_irq_chain through a JMP (pointer) handler", () => {
  it("names the three parts behind a $0314 handler that is JMP ($033C)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-jmpind-"));
    // Assembled from a copy: KickAssembler writes a .sym beside its source.
    copyFileSync(join(import.meta.dirname, "fixtures", "re", "jmp-indirect.asm"), join(dir, "t.asm"));
    expect(
      spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], { cwd: dir })
        .status,
    ).toBe(0);
    const r = await reIrqChain({ prg_path: join(dir, "t.prg"), model: "pal", cycles: 4_000_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.handlers).toHaveLength(1);
    const h = r.result.handlers[0];
    expect(h?.pointer).toBe(0x033c);
    expect(h?.dispatch.map((d) => [d.target, d.entry_lines, d.armed_before])).toEqual([
      [0x0846, [50], [50]],
      [0x085d, [120], [120]],
      [0x0874, [200], [200]],
    ]);
  }, 120_000);
});

/** Assembles KickAssembler source in a fresh temp directory; returns the PRG path. */
function assemble(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "re-frame-"));
  writeFileSync(join(dir, "t.asm"), source);
  expect(
    spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], { cwd: dir })
      .status,
  ).toBe(0);
  return join(dir, "t.prg");
}

const PAL_FRAME = REGION_TIMING.PAL.cycles_per_frame;

describe("frame mode inputs", () => {
  it("refuses a region run without markers and a bad wait_pc, before any run", async () => {
    expect(await reFrameProfile({ prg_path: "/etc/hosts" })).toMatchObject({ ok: false, reason: "marker" });
    expect(await reFrameMode({ prg_path: "/etc/hosts", wait_pc: "$4O2A" })).toMatchObject({
      ok: false,
      reason: "input",
    });
  });
});

describe.skipIf(!canRun)("c64_re_frame_profile frame mode in VICE", () => {
  it("irq-chain recipe: three slots of one $0314 handler a frame, their sum per frame, main plus idle the rest", async () => {
    const md = readFileSync(
      join(import.meta.dirname, "..", "docs", "recipes", "kickassembler", "irq-chain.md"),
      "utf8",
    );
    const listing = /```asm\n([\s\S]*?)```/.exec(md)?.[1] ?? "";
    const r = await reFrameMode({ prg_path: assemble(listing), model: "pal", cycles: 8_000_000 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const b = r.result;
    expect(b.parts.map((p) => [p.slot, p.entry_lines])).toEqual([
      [0, [40]],
      [1, [130]],
      [2, [260]],
    ]);
    expect(new Set(b.parts.map((p) => p.handler)).size).toBe(1);
    // Measured: slot 0 and 1 are fixed; slot 2 prints the frame number and varies.
    expect(b.parts.map((p) => p.cost.typical).slice(0, 2)).toEqual([159, 202]);
    // 7 cycles of interrupt sequence and the KERNAL's $FF48 stub, 29.
    expect(b.parts.every((p) => p.dispatch.typical === 36)).toBe(true);
    expect(b.unreturned).toBe(0);
    expect(b.frames.length).toBeGreaterThan(200);
    const least = b.parts.reduce((n, p) => n + (p.cost.least ?? 0), 0);
    for (const f of b.frames) {
      expect(f.handlers).toBeGreaterThanOrEqual(least);
      expect(f.rest).toBe(PAL_FRAME - f.handlers);
    }
  }, 120_000);

  it("a main loop that waits on a frame counter: idle is the wait, main the work", async () => {
    const prg = assemble(
      [
        "BasicUpstart2(start)",
        "start: sei",
        "    lda #$7f",
        "    sta $dc0d",
        "    lda $dc0d",
        "    lda #<irq",
        "    sta $0314",
        "    lda #>irq",
        "    sta $0315",
        "    lda #$1b",
        "    sta $d011",
        "    lda #250",
        "    sta $d012",
        "    lda #1",
        "    sta $d01a",
        "    sta $d019",
        "    cli",
        "main: lda count",
        "wait: cmp count",
        "    beq wait",
        "    ldx #200",
        "work: dex",
        "    bne work",
        "    jmp main",
        "irq: inc count",
        "    lda #1",
        "    sta $d019",
        "    jmp $ea81",
        "count: .byte 0",
      ].join("\n"),
    );
    const r = await reFrameMode({ prg_path: prg, model: "pal", cycles: 4_000_000, wait_pc: "$0834" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const b = r.result;
    expect(b.wait).toEqual({ pc: 0x0834, exit: 0x083c });
    // The work loop: LDX 2 + 199 x 5 + 4, JMP 3, LDA 4, and the exit's BEQ not taken: about 1,010 cycles.
    expect(b.per_frame.main?.typical).toBeGreaterThan(990);
    expect(b.per_frame.main?.typical).toBeLessThan(1_100);
    for (const f of b.frames) expect((f.main ?? 0) + (f.idle ?? 0) + f.handlers).toBe(PAL_FRAME);
    expect(b.measured_frame).toMatch(/^play pal worst=\d+ typical=\d+$/);
  }, 120_000);
});
