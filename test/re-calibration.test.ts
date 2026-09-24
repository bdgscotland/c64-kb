import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { REGION_TIMING } from "../src/domain/timing.ts";
import { reFrameProfile, reIrqChain } from "../src/tools/re.ts";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findC1541, findToolchains } from "../scripts/lib/toolchains.ts";

// Pilot step 1 of docs/superpowers/specs/2026-09-23-reverse-engineering-design.md:
// the RE tools must reproduce figures this repo already measured before any
// third-party game is studied. Figures and their sources are in the plan's
// Task 6 table; the measured differences are in CHANGELOG.md.
const root = join(import.meta.dirname, "..");
const t = findToolchains();
const x64sc = resolveX64sc();
const c1541 = findC1541();
const canRun =
  x64sc !== null && !x64sc.windowed && t.kickass !== null && t.oscar64 !== null && c1541 !== null;
const TOLERANCE = 0.02;
const PAL_FRAME = REGION_TIMING.PAL.cycles_per_frame;

let keep = "";
const prg = (stem: string) => {
  const hit = readdirSync(keep, { recursive: true })
    .map(String)
    .find((f) => f.endsWith(".prg") && f.includes(stem));
  if (!hit) throw new Error(`no PRG for ${stem} under ${keep}`);
  return join(keep, hit);
};

describe.skipIf(!canRun)("RE tools reproduce committed measurements", () => {
  beforeAll(() => {
    keep = mkdtempSync(join(tmpdir(), "re-cal-"));
    for (const md of [
      "kickassembler/irq-chain.md",
      "oscar64/falling-blocks.md",
      "oscar64/platformer-scaffold.md",
    ]) {
      const r = spawnSync(
        process.execPath,
        [join(root, "scripts/verify-recipes.ts"), "--file", join(root, "docs/recipes", md), "--keep", keep],
        { encoding: "utf8" },
      );
      expect(r.status, r.stdout + r.stderr).toBe(0);
    }
  }, 600_000);

  it("irq-chain: armed lines are the listing's 40, 130, 260", async () => {
    const r = await reIrqChain({ prg_path: prg("irq-chain"), model: "pal", cycles: 8_000_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Not r.result.arms: the dispatcher writes $D012 (low byte) then $D011
    // (bit 7) in two instructions, so raw arm observations include the
    // composite of the OLD $D011 with the NEW $D012 for a few cycles (e.g.
    // line 260's low byte, 4, paired with the previous slot's still-clear
    // bit 7) before the second write settles it. Measured by hand: arms[]
    // held {4, 40, 130, 260, 296} where only {40, 130, 260} are lines a
    // handler ever actually entered on. handlers[].armed_before already
    // reports only the state at each handler's entry (test/re-tools.test.ts
    // uses the same field for this reason), so it is the right one here.
    const armed = new Set(r.result.handlers.flatMap((h) => h.armed_before));
    expect([...armed].sort((a, b) => a - b)).toEqual([40, 130, 260]);
    for (const h of r.result.handlers)
      for (const line of h.entry_lines)
        expect(h.armed_before.some((a) => line === a || line === a + 1)).toBe(true);
  }, 120_000);

  it("falling-blocks: worst frame within 2% of 6,276 (timer A)", async () => {
    const r = await reFrameProfile({
      prg_path: prg("falling-blocks"),
      model: "pal",
      cycles: 12_500_000,
      start: "store:$DC0E=$11",
      stop: "store:$DC0E=$00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // main() calls worst_subject() once (falling-blocks.md line 525) before
    // the scripted game's per-frame loop (line 552). worst_subject bounds
    // its own RULES and RENDER parts with the same $DC0E pair, so the first
    // two samples in the whole run are that constructed 20-row-stack case,
    // not a frame of this game: measured 5,718 and 9,312 against the
    // recipe's own RULES 5,717 / RENDER 9,311. r.result.worst (9,312) is
    // that RENDER sample, not the "dearest frame of the scripted game" the
    // design page's 6,276 names. Dropping those two (program order, not a
    // value match) gives the game's own worst: measured 6,277.
    const gameSamples = r.result.samples.slice(2);
    const worst = Math.max(...gameSamples.map((s) => s.cycles));
    expect(Math.abs(worst - 6276) / 6276).toBeLessThanOrEqual(TOLERANCE);
  }, 120_000);

  it("platformer-scaffold: worst in-frame sample within 2% of 8,693 (timer B)", async () => {
    const disk = join(keep, "cal.d64");
    expect(spawnSync(c1541 ?? "c1541", ["-format", "TEST,01", "d64", disk]).status).toBe(0);
    const before = readFileSync(disk);
    const r = await reFrameProfile({
      prg_path: prg("platformer-scaffold"),
      model: "pal",
      cycles: 40_000_000,
      disk_path: disk,
      start: "store:$DC0F=$11",
      stop: "store:$DC0F=$00",
    });
    expect(r.ok).toBe(true);
    // The game saves to drive 8; the tool attached a copy, so the disk passed in is unchanged.
    expect(readFileSync(disk).equals(before)).toBe(true);
    if (!r.ok) return;
    // The recipe discards frames in which the KERNAL used timer B for disk I/O (io_frame).
    const inFrame = r.result.samples.filter((s) => s.cycles <= PAL_FRAME).map((s) => s.cycles);
    expect(Math.abs(Math.max(...inFrame) - 8693) / 8693).toBeLessThanOrEqual(TOLERANCE);
  }, 300_000);
});
