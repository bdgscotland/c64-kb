import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedPrg, parseMarker, reIrqChain } from "../src/tools/re.ts";
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

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

describe.skipIf(!canRun)("c64_re_irq_chain in VICE", () => {
  it("finds a $FFFE handler armed at line 100 and entered on it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-tools-"));
    writeFileSync(
      join(dir, "t.asm"),
      [
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
      ].join("\n"),
    );
    expect(
      spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], { cwd: dir })
        .status,
    ).toBe(0);
    const r = await reIrqChain({ prg_path: join(dir, "t.prg"), model: "pal", cycles: 4_000_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.result.handlers.find((x) => x.via.includes("irq_fffe"));
    expect(h?.armed_before).toEqual([100]);
    expect(h?.entry_lines.every((l) => l === 100 || l === 101)).toBe(true);
    expect(h?.entries).toBeGreaterThan(10);
  }, 120_000);
});
