/**
 * timingBudget: the per-line cycle budget for a technique on PAL or NTSC.
 */

import { z } from "zod";
import { getFalkor, getAnalytics } from "../../context.ts";
import type { TimingBudgetOutput } from "../../schemas/tool-outputs.ts";
import {
  BADLINE_CYCLES_LOST,
  DEFAULT_IRQ_OVERHEAD,
  REGION_TIMING,
  SPRITE_BA_LEAD_IN,
  SPRITE_CYCLES_EACH,
  spriteDmaCycles,
  videoRegion,
} from "../../domain/timing.ts";
import { parseRows } from "./shared.ts";
import type { TimingBudgetResult } from "./types.ts";

export interface TimingBudgetOptions {
  technique: string;
  region: string;
  sprites_per_line?: number | undefined;
}

type SpritesSource = TimingBudgetOutput["sprites_source"];

const SpritesRow = z.object({ n: z.unknown() });

/**
 * Sprites on the line: the caller's figure wins; otherwise the technique's
 * own **Cost:** sprites_per_line; otherwise none, and the notes say so.
 */
async function spritesOnLine(opts: TimingBudgetOptions): Promise<{ sprites: number; source: SpritesSource }> {
  if (opts.sprites_per_line !== undefined && Number.isFinite(opts.sprites_per_line)) {
    return { sprites: Math.max(0, Math.min(8, Math.trunc(opts.sprites_per_line))), source: "input" };
  }
  const f = await getFalkor();
  const row = parseRows(
    SpritesRow,
    await f.roQuery(`MATCH (t:Technique {name: $name}) RETURN t.cost_sprites_per_line AS n`, {
      name: opts.technique,
    }),
  ).at(0);
  return typeof row?.n === "number" ? { sprites: row.n, source: "technique" } : { sprites: 0, source: "none" };
}

type Budget = Omit<TimingBudgetOutput, "notes">;

function spriteNote(t: Budget): string {
  if (t.sprites_per_line > 0) {
    const from = t.sprites_source === "input" ? "from the request" : `from ${t.technique}'s Cost line`;
    return `Sprite DMA: ${t.sprites_per_line} sprite(s) on the line (${from}) take ${SPRITE_BA_LEAD_IN} + ${SPRITE_CYCLES_EACH} × ${t.sprites_per_line} = ${t.sprite_dma_cycles} cycles, measured in VICE x64sc for sprites numbered without gaps (5 for one, 19 for eight). This is the minimum for that many sprites: each gap in the numbering adds up to ${SPRITE_BA_LEAD_IN} more (sprites 0 and 7 measured 10). The BA lead-in cycles are usable by writes only.`;
  }
  return t.sprites_source === "none"
    ? `Sprite DMA: not counted. ${t.technique} states no sprites_per_line; pass sprites_per_line to count it (3 + 2 per sprite, 19 for eight, measured in VICE x64sc).`
    : `Sprite DMA: none (0 sprites on the line).`;
}

function budgetNotes(t: Budget, lines_per_frame: number): string[] {
  const dma = t.sprite_dma_cycles > 0 ? ` - ${t.sprite_dma_cycles}` : "";
  const notes = [
    `${t.region}: ${t.cycles_per_line} cycles/line × ${lines_per_frame} lines = ${t.cycles_per_frame} cycles/frame.`,
    `Badline: the VIC takes the bus on cycles 15-54 and drops BA on cycle 12, so ${BADLINE_CYCLES_LOST} cycles are lost to code that is not writing on 12-14 (40 to code that is). No read cycle is possible between 12 and 54.`,
    `IRQ overhead: ${t.irq_overhead_cycles} cycles before the handler's first instruction (7 interrupt sequence + 29 KERNAL dispatcher at $FF48 via $0314; 7 via $FFFE with the KERNAL out), plus 0-6 cycles of jitter unless a double IRQ is used.`,
    spriteNote(t),
    `User cycles/line normal: ${t.cycles_per_line} - ${t.irq_overhead_cycles}${dma} = ${t.user_cycles_per_line_normal}.`,
    `User cycles/line badline: ${t.cycles_per_line} - ${t.irq_overhead_cycles} - ${BADLINE_CYCLES_LOST}${dma} = ${t.user_cycles_per_line_badline}.`,
  ];
  if (t.sprites_per_line > 0) {
    notes.push(
      `Without the IRQ entry, a line with ${t.sprites_per_line} sprite(s) leaves ${Math.max(0, t.cycles_per_line - t.sprite_dma_cycles)} cycles, a badline ${Math.max(0, t.cycles_per_line - BADLINE_CYCLES_LOST - t.sprite_dma_cycles)} (arithmetic; for eight sprites on a PAL badline cpu-cycle-tricks.md measures 4 including the 3 write-only cycles, which is the 1 this gives plus those 3).`,
    );
  }
  if (t.user_cycles_per_line_badline <= 0) {
    notes.push(`WARNING: badline leaves no user cycles — tight handler required.`);
  }
  return notes;
}

function renderBudget(t: TimingBudgetOutput): string {
  const spritesFrom = t.sprites_source === "none" ? " (not stated)" : ` (${t.sprites_source})`;
  let out = `# Timing budget: ${t.technique} (${t.region})\n\n`;
  out += `| Property | Value |\n|----------|-------|\n`;
  out += `| Region | ${t.region} |\n`;
  out += `| Cycles/line | ${t.cycles_per_line} |\n`;
  out += `| Cycles/frame | ${t.cycles_per_frame} |\n`;
  out += `| Badline cycles lost | ${t.badline_cycles_lost} |\n`;
  out += `| IRQ overhead | ${t.irq_overhead_cycles} |\n`;
  out += `| Sprites on the line | ${t.sprites_per_line}${spritesFrom} |\n`;
  out += `| Sprite DMA cycles | ${t.sprite_dma_cycles} |\n`;
  out += `| User cycles/line (normal) | ${t.user_cycles_per_line_normal} |\n`;
  out += `| User cycles/line (badline) | ${t.user_cycles_per_line_badline} |\n`;
  out += `\n## Notes\n\n`;
  for (const note of t.notes) out += `- ${note}\n`;
  return out;
}

export async function timingBudget(opts: TimingBudgetOptions): Promise<TimingBudgetResult> {
  const { sprites, source } = await spritesOnLine(opts);
  const sprite_dma_cycles = spriteDmaCycles(sprites);
  const region = videoRegion(opts.region);
  const rc = REGION_TIMING[region];

  // The IRQ overhead is the KERNAL-vector constant. An earlier version read
  // t.irq_overhead here, a property no extractor or ingest ever wrote, so the
  // read always fell through to the default; the dead read was removed in
  // tools 1.25.0 rather than given a writer, because the per-technique cost
  // line (cost_cycles_per_line and friends) is the model that carries a
  // technique's own figures, and the graph connection went with it.
  const irq = DEFAULT_IRQ_OVERHEAD;

  const budget: Budget = {
    technique: opts.technique,
    region,
    cycles_per_line: rc.cycles_per_line,
    cycles_per_frame: rc.cycles_per_frame,
    badline_cycles_lost: BADLINE_CYCLES_LOST,
    irq_overhead_cycles: irq,
    sprites_per_line: sprites,
    sprites_source: source,
    sprite_dma_cycles,
    user_cycles_per_line_normal: Math.max(0, rc.cycles_per_line - irq - sprite_dma_cycles),
    // A handler entered on a badline through the KERNAL vector has nothing
    // left on that line (63 - 43 - 36 < 0); report 0, and the notes say
    // to put splits on non-badlines.
    user_cycles_per_line_badline: Math.max(0, rc.cycles_per_line - irq - BADLINE_CYCLES_LOST - sprite_dma_cycles),
  };
  const structured: TimingBudgetOutput = { ...budget, notes: budgetNotes(budget, rc.lines_per_frame) };

  getAnalytics().logQuery({ tool: "c64_timing_budget", query: `${opts.technique}:${region}`, resultCount: 1 });

  return { structured, text: renderBudget(structured) };
}
