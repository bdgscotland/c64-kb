/**
 * Hard rules over DEMANDS, region and KERNAL use, evaluated for one pair
 * of techniques. Each rule is symmetric. Pure: the facts come in, the
 * hits come out, so the same rules serve the input pairs and the REQUIRES
 * closure.
 */

import { parseRasterBand, rasterBandsOverlap } from "../../../graph/extract.ts";
import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";
import type { TechniqueFacts } from "./facts.ts";

type ConflictKind = CompatibilityCheckOutput["conflicts"][number]["kind"];
export type BandSeparated = CompatibilityCheckOutput["band_separated"][number];

interface HardHit {
  kind: ConflictKind;
  shared: string[];
  rationale: string;
  resolution: string;
}

export interface Named {
  name: string;
  facts: TechniqueFacts;
}

export interface HardRuleResult {
  hits: HardHit[];
  /** Line rules that did not fire because both bands are stated and disjoint. */
  separated: BandSeparated | null;
}

// KERNAL routines that talk on the serial bus (serial_bus_exclusive rule).
// The routines are the KERNAL's serial-bus entries and the file calls built
// on them; CHRIN/CHROUT/GETIN are left out because they touch the bus only
// through a redirected channel, which CHKIN/CHKOUT already name.
const SERIAL_KERNAL: ReadonlySet<string> = new Set([
  "LOAD",
  "SAVE",
  "OPEN",
  "CLOSE",
  "CHKIN",
  "CHKOUT",
  "CLRCHN",
  "TALK",
  "LISTEN",
  "TKSA",
  "SECOND",
  "ACPTR",
  "CIOUT",
  "UNTLK",
  "UNLSN",
]);

// Raster bands (**Raster band:**, schema 24). The rules about sharing
// raster lines (cpu_exclusive; cpu_vs_irq through mid-frame IRQs or
// sprite-set changes; sprite_set) do not fire when both techniques state
// line bands and the bands share no line: the pair is reported under
// band_separated instead. A band that is absent or "movable" keeps the
// conflict, and the rationale says which side is unknown.
// continuous_interrupts and kernal_banked_out are not about lines and
// ignore bands.

function bandText(t: Named): string {
  const b = t.facts.band;
  if (!b) return `${t.name} states no raster band`;
  if (b === "movable") return `${t.name}'s lines are chosen by the program (movable)`;
  return `${t.name} holds lines ${b}`;
}

function lineRanges(band: string | null) {
  const p = parseRasterBand(band ?? "");
  return "error" in p || p.kind !== "lines" ? null : p.ranges;
}

function bandNote(a: Named, b: Named): string {
  const bothLines = lineRanges(a.facts.band) !== null && lineRanges(b.facts.band) !== null;
  return (
    ` Raster bands: ${bandText(a)}; ${bandText(b)}.` +
    (bothLines ? " The bands overlap." : " Only two stated, disjoint line bands clear this rule.")
  );
}

/** Both bands stated as line ranges that share no line: the two bands, else null. */
function disjointBands(a: TechniqueFacts, b: TechniqueFacts): [string, string] | null {
  if (!a.band || !b.band) return null;
  const ra = lineRanges(a.band);
  const rb = lineRanges(b.band);
  if (!ra || !rb || rasterBandsOverlap(ra, rb)) return null;
  return [a.band, b.band];
}

/** Collects hits; line rules become separations when the bands are disjoint. */
class HitSink {
  readonly hits: HardHit[] = [];
  readonly cleared: string[] = [];
  private readonly a: Named;
  private readonly b: Named;
  private readonly disjoint: boolean;
  constructor(a: Named, b: Named, disjoint: boolean) {
    this.a = a;
    this.b = b;
    this.disjoint = disjoint;
  }
  hard(kind: ConflictKind, shared: string[], rationale: string, resolution: string): void {
    this.hits.push({ kind, shared, rationale, resolution });
  }
  // A rule about sharing raster lines: noted, not fired, on disjoint
  // bands; otherwise fired with the band facts added to its rationale.
  line(kind: ConflictKind, shared: string[], rationale: string, resolution: string): void {
    if (this.disjoint) {
      if (!this.cleared.includes(kind)) this.cleared.push(kind);
    } else {
      this.hard(kind, shared, rationale + bandNote(this.a, this.b), resolution);
    }
  }
}

function regionRule(sink: HitSink, a: Named, b: Named): void {
  const ar = a.facts.region;
  const br = b.facts.region;
  if (ar && br && ar !== br) {
    sink.hard(
      "region_mismatch",
      [ar, br],
      `${a.name} requires ${ar} but ${b.name} requires ${br}.`,
      `Detect the machine at start and ship both variants, or drop one.`,
    );
  }
}

function cpuExclusiveRule(sink: HitSink, a: Named, b: Named): void {
  // Both need every CPU cycle on their lines.
  if (a.facts.demands.has("cpu_every_line") && b.facts.demands.has("cpu_every_line")) {
    sink.line(
      "cpu_exclusive",
      ["cpu_every_line"],
      `Both need every CPU cycle on every raster line they cover; they cannot share a raster line.`,
      `Give each its own band of lines and switch between them in the border.`,
    );
  }
}

/** One needs every CPU cycle (x); the other (y) interrupts mid-frame. */
function cpuVsIrqRule(sink: HitSink, x: Named, y: Named): void {
  const X = x.facts.demands;
  const Y = y.facts.demands;
  if (!X.has("cpu_every_line")) return;
  if (Y.has("midframe_raster_irqs")) {
    sink.line(
      "cpu_vs_irq",
      ["cpu_every_line", "midframe_raster_irqs"],
      `${x.name} needs every CPU cycle on its lines; a raster interrupt from ${y.name} inside that region breaks its cycle count.`,
      `Keep ${y.name}'s interrupts on lines outside ${x.name}'s region (the borders, or a separate band).`,
    );
  }
  if (Y.has("continuous_interrupts")) {
    sink.hard(
      "cpu_vs_irq",
      ["cpu_every_line", "continuous_interrupts"],
      `${x.name} needs every CPU cycle on its lines; ${y.name} takes interrupts every few raster lines throughout the frame.`,
      `Pause ${y.name} while ${x.name}'s region is being drawn, or do not combine them.`,
    );
  }
  if (Y.has("changes_sprite_set") && !X.has("constant_sprite_set")) {
    sink.line(
      "cpu_vs_irq",
      ["cpu_every_line", "changes_sprite_set"],
      `${y.name} rewrites sprite registers from interrupts during the frame; inside ${x.name}'s region that breaks its cycle count.`,
      `Multiplex only outside ${x.name}'s region.`,
    );
  }
}

/** One (x) needs the same sprites active on every line; the other (y) changes them. */
function spriteSetRule(sink: HitSink, x: Named, y: Named): void {
  if (x.facts.demands.has("constant_sprite_set") && y.facts.demands.has("changes_sprite_set")) {
    sink.line(
      "sprite_set",
      ["constant_sprite_set", "changes_sprite_set"],
      `${x.name}'s per-line timing depends on the same sprites being active on every line of its region; ${y.name} changes the active set during the frame.`,
      `Multiplex only outside ${x.name}'s region, or keep the sprite set fixed while ${x.name}'s lines are drawn.`,
    );
  }
}

/** One (x) owns the drive's serial bus while resident; the other (y) does KERNAL disk I/O. */
function serialBusRule(sink: HitSink, x: Named, y: Named): void {
  if (!x.facts.demands.has("serial_bus_exclusive")) return;
  const serial = y.facts.kernal.filter((k) => SERIAL_KERNAL.has(k)).sort();
  if (serial.length === 0) return;
  sink.hard(
    "serial_bus_busy",
    serial,
    `${x.name} owns the drive's serial bus while it is resident; ${y.name} calls KERNAL serial I/O (${serial.join(", ")}), which stalls on that drive until the loader is uninstalled.`,
    `Do the KERNAL I/O before installing ${x.name} or after uninstalling it (Krill: UNINSTALL_API), or use the loader's own entries (Krill: save, fileexists) instead.`,
  );
}

/** One (x) runs with the KERNAL ROM out; the other (y) calls KERNAL routines. */
function kernalBankedOutRule(sink: HitSink, x: Named, y: Named): void {
  if (x.facts.demands.has("kernal_rom_out") && y.facts.kernal.length > 0) {
    sink.hard(
      "kernal_banked_out",
      [...y.facts.kernal],
      `${x.name} runs with the KERNAL ROM banked out; ${y.name} calls KERNAL routine(s) ${y.facts.kernal.join(", ")}, which are not there.`,
      `Bank the KERNAL in ($01 bit 1) around the calls, or replace them with RAM-resident code.`,
    );
  }
}

// Directed rules run a→b then b→a, each rule family in turn.
const DIRECTED_RULES = [cpuVsIrqRule, spriteSetRule, serialBusRule, kernalBankedOutRule];

export function hardRules(a: Named, b: Named): HardRuleResult {
  const bands = disjointBands(a.facts, b.facts);
  const sink = new HitSink(a, b, bands !== null);
  regionRule(sink, a, b);
  cpuExclusiveRule(sink, a, b);
  for (const rule of DIRECTED_RULES) {
    rule(sink, a, b);
    rule(sink, b, a);
  }
  const separated =
    bands && sink.cleared.length > 0
      ? { a: a.name, b: b.name, a_band: bands[0], b_band: bands[1], rules: sink.cleared }
      : null;
  return { hits: sink.hits, separated };
}
