/**
 * Cycles between two markers in a running program, once per occurrence:
 * the region a game's own timer brackets, or two PCs. A marker is a store
 * of a given value (timer_start's `STA $DC0F` with $11) or an executed PC.
 * The figure is the CPU clock difference between the two hits, badline and
 * sprite stalls included, which is what a CIA timer across the same region
 * counts, give or take the few cycles of the timer writes themselves.
 */
import type { Obs } from "./irq-chain.ts";
import { storedValue, type Hit } from "./monlog.ts";

export type Marker = { store: number; value: number } | { pc: number };
export interface Region {
  start: Marker;
  stop: Marker;
}
interface Sample extends Obs {
  cycles: number;
  start_clock: number;
  frame: number;
}
export interface Profile {
  samples: Sample[];
  worst: number | null;
  typical: number | null;
  count: number;
  unpaired: number;
  over_frame: number;
  /** What the run could not know, such as the entry of a PRG with no SYS line. */
  unknowns: string[];
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

function command(m: Marker): string {
  return "store" in m
    ? `trace store ${hex4(m.store)} ${hex4(m.store)}`
    : `trace exec ${hex4(m.pc)} ${hex4(m.pc)}`;
}

export function regionCommands(region: Region): string {
  return [...new Set([command(region.start), command(region.stop)])].join("\n") + "\n";
}

function matches(h: Hit, m: Marker): boolean {
  if ("store" in m) return h.kind === "store" && h.addr === m.store && storedValue(h) === m.value;
  return h.kind === "exec" && h.addr === m.pc;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? null;
}

/** The largest value, by loop: a spread into Math.max overflows the stack past ~100,000 samples. */
function largest(xs: number[]): number | null {
  let m: number | null = null;
  for (const x of xs) if (m === null || x > m) m = x;
  return m;
}

/**
 * A start while another is open replaces it; the replaced start counts in
 * `unpaired`, as does a start still open when the run ends.
 */
export function analyseRegion(
  hits: Iterable<Hit>,
  region: Region,
  frameCycles: number,
  startClock: number,
): Profile {
  const samples: Sample[] = [];
  let open: number | null = null;
  let overwritten = 0;
  for (const h of hits) {
    if (matches(h, region.start)) {
      if (open !== null) overwritten++;
      open = h.clock;
    } else if (open !== null && matches(h, region.stop)) {
      samples.push({
        id: `s${samples.length}`,
        basis: "measured-vice",
        rung: 1,
        cycles: h.clock - open,
        start_clock: open,
        frame: Math.floor((open - startClock) / frameCycles),
      });
      open = null;
    }
  }
  const cycles = samples.map((s) => s.cycles);
  return {
    samples,
    worst: largest(cycles),
    typical: median(cycles),
    count: samples.length,
    unpaired: overwritten + (open === null ? 0 : 1),
    over_frame: cycles.filter((c) => c > frameCycles).length,
    unknowns: [],
  };
}
