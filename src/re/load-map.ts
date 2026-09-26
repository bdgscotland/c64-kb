/**
 * A packed program's load map from a full-memory store trace: who wrote
 * where. A cracked game's depacker writes its output in bulk, often from
 * code in the stack page ($0100-$01FF) or zero page, and those stores land
 * on every address in their path, vectors included. Commando's stage-2
 * depacker (put-byte at $018C, in the stack page) writes backward from
 * $FFFF, so $FFFA-$FFFF are written with no handler install; the game's own
 * init at $3EB1-$3EB9 clears $FFC0-$FFFF later (a blank sprite, not a
 * copy). c64_re_irq_chain has no way to tell those apart from an install;
 * this module groups the raw stores by who wrote them.
 *
 * A writer is a set of store instructions whose PCs sit within 256 bytes of
 * each other and whose code was written at about the same time. The second
 * rule splits code generations: Commando runs two depack stages from the
 * same $00FF-$01A0 range, the second copied over the first at clock ~8.92M,
 * and BASIC's CHRGET at $0073 was written at boot. Each store hit's code
 * stamp is the clock of the last store to its own PC's byte, or "ROM" when
 * $01 maps BASIC or KERNAL ROM over that PC, or "never written" (a loaded
 * or injected program). Stores to $0001 (STA/STX/STY/SAX, INC, DEC) are
 * followed through the same trace to know $01, which also tells whether a
 * store to $D000-$DFFF reached I/O or the RAM under it (ram_under_io).
 *
 * Grouping streams: one small aggregate per (PC, code stamp), a count, a
 * clock range and a 64K bit-per-address map (8 KB), never every hit. Groups
 * are formed in finish().
 */
import type { Hit } from "./monlog.ts";
import type { IrqChain } from "./irq-chain.ts";

interface Range {
  start: number;
  end: number;
}

export interface Writer {
  pc_range: Range;
  dest_ranges: Range[];
  stores: number;
  first_clock: number;
  last_clock: number;
  /** True when pc_range overlaps $0100-$01FF: the writer's own code runs from the stack page. */
  in_stack_page: boolean;
  /** Parts of dest_ranges in $D000-$DFFF written while $01 banked I/O out: they reached RAM, not the chips. */
  ram_under_io: Range[];
}

export interface Stub {
  addr: number;
  sys: number;
  text: string;
  /** The BASIC line number, when the line's header is readable; null when it is not. */
  line: number | null;
}

const PC_GROUP_GAP = 0x100;
/** Code stamps closer than this are one generation: a 256-byte copy loop takes a few thousand cycles, two depack stages millions apart. */
const GENERATION_WINDOW = 100_000;
const ADDR_SPACE = 0x10000;
const BITMAP_BYTES = ADDR_SPACE / 8;
const STACK_PAGE: Range = { start: 0x0100, end: 0x01ff };
/** More aggregates than this (8 KB each) stops the feed like the hit cap does. */
const MAX_AGGREGATES = 4096;
/** Code stamps that are not clocks. */
const NEVER_WRITTEN = -1;
const IN_ROM = -2;

function touch(touched: Uint8Array, addr: number): void {
  const i = addr >> 3;
  touched[i] = (touched[i] ?? 0) | (1 << (addr & 7));
}

function isTouched(touched: Uint8Array, addr: number): boolean {
  return ((touched[addr >> 3] ?? 0) & (1 << (addr & 7))) !== 0;
}

/** Runs of set bits in a 64K bitmap within [from, to], as inclusive address ranges, ascending. */
function rangesOf(touched: Uint8Array, from = 0, to = ADDR_SPACE - 1): Range[] {
  const out: Range[] = [];
  let start = -1;
  for (let addr = from; addr <= to; addr++) {
    if (isTouched(touched, addr)) {
      if (start === -1) start = addr;
    } else if (start !== -1) {
      out.push({ start, end: addr - 1 });
      start = -1;
    }
  }
  if (start !== -1) out.push({ start, end: to });
  return out;
}

const overlapsStackPage = (r: Range): boolean => r.start <= STACK_PAGE.end && r.end >= STACK_PAGE.start;

/** The CPU port's low three bits (LORAM, HIRAM, CHAREN) after reset: BASIC, KERNAL and I/O in. */
const PORT_AFTER_RESET = 0x37;

const ioVisible = (port: number): boolean => (port & 4) !== 0 && (port & 3) !== 0;

/** Is pc mapped to ROM under this $01? BASIC needs LORAM and HIRAM; the KERNAL needs HIRAM. */
function romAt(pc: number, port: number): boolean {
  if (pc >= 0xa000 && pc <= 0xbfff) return (port & 3) === 3;
  if (pc >= 0xe000) return (port & 2) !== 0;
  return false;
}

/** $01 after a store hit to it, or null when the instruction does not say (ROL, LSR and the like). */
function portAfter(h: Hit, port: number): number | null {
  switch (h.mnemonic) {
    case "STA":
      return h.a;
    case "STX":
      return h.x;
    case "STY":
      return h.y;
    case "SAX":
      return h.a & h.x;
    case "INC":
      return (port + 1) & 0xff;
    case "DEC":
      return (port - 1) & 0xff;
    default:
      return null;
  }
}

interface PcAgg {
  pc: number;
  stamp: number;
  count: number;
  first: number;
  last: number;
  touched: Uint8Array;
  ramUnderIo: Uint8Array | null;
}

const sameGeneration = (a: number, b: number): boolean =>
  a < 0 || b < 0 ? a === b : Math.abs(a - b) <= GENERATION_WINDOW;

/** Union-find over aggregate indices. */
function find(parent: number[], i: number): number {
  let r = i;
  while (parent[r] !== r) r = parent[r] ?? r;
  parent[i] = r;
  return r;
}

/** Aggregates linked when their PCs are within PC_GROUP_GAP and their code stamps are one generation. */
function clusters(aggs: PcAgg[]): PcAgg[][] {
  const sorted = [...aggs].sort((a, b) => a.pc - b.pc);
  const parent = sorted.map((_, i) => i);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; a && j < sorted.length; j++) {
      const b = sorted[j];
      if (!b || b.pc - a.pc > PC_GROUP_GAP) break;
      if (sameGeneration(a.stamp, b.stamp)) parent[find(parent, j)] = find(parent, i);
    }
  }
  const byRoot = new Map<number, PcAgg[]>();
  sorted.forEach((a, i) => {
    const r = find(parent, i);
    byRoot.set(r, [...(byRoot.get(r) ?? []), a]);
  });
  return [...byRoot.values()];
}

function orInto(dst: Uint8Array, src: Uint8Array | null): void {
  if (!src) return;
  for (let i = 0; i < src.length; i++) dst[i] = (dst[i] ?? 0) | (src[i] ?? 0);
}

function writerOf(g: PcAgg[]): Writer {
  const touched = new Uint8Array(BITMAP_BYTES);
  const underIo = new Uint8Array(BITMAP_BYTES);
  let stores = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const a of g) {
    stores += a.count;
    first = Math.min(first, a.first);
    last = Math.max(last, a.last);
    orInto(touched, a.touched);
    orInto(underIo, a.ramUnderIo);
  }
  const pcs = g.map((a) => a.pc);
  const pc_range: Range = { start: Math.min(...pcs), end: Math.max(...pcs) };
  return {
    pc_range,
    dest_ranges: rangesOf(touched),
    stores,
    first_clock: first,
    last_clock: last,
    in_stack_page: overlapsStackPage(pc_range),
    ram_under_io: rangesOf(underIo, 0xd000, 0xdfff),
  };
}

/**
 * Feeds store hits one at a time (never holds the whole trace), in clock
 * order. A cap on the number of hits, or on distinct aggregates, stops the
 * stream early (capped becomes the hit count at that point); the caller
 * decides what that means for its own unknowns.
 */
export class WriterAggregator {
  private readonly byKey = new Map<string, PcAgg>();
  private readonly capHits: number | undefined;
  private readonly lastStore = new Float64Array(ADDR_SPACE).fill(NEVER_WRITTEN);
  private port: number | null = PORT_AFTER_RESET;
  private portLost = false;
  private lastPortHit = "";
  private hitsSeen = 0;
  private cappedAt: number | null = null;

  constructor(capHits?: number) {
    this.capHits = capHits;
  }

  /** Feeds one store hit; false once a cap is reached (the caller should stop feeding). */
  add(h: Hit): boolean {
    if (this.cappedAt !== null) return false;
    if (this.capHits !== undefined && this.hitsSeen >= this.capHits) {
      this.cappedAt = this.hitsSeen;
      return false;
    }
    const agg = this.aggFor(h);
    if (!agg) {
      this.cappedAt = this.hitsSeen;
      return false;
    }
    this.hitsSeen++;
    agg.count++;
    agg.first = Math.min(agg.first, h.clock);
    agg.last = Math.max(agg.last, h.clock);
    touch(agg.touched, h.addr);
    this.effect(h, agg);
    return true;
  }

  /** The aggregate for this hit's (PC, code stamp); null when a new one would pass MAX_AGGREGATES. */
  private aggFor(h: Hit): PcAgg | null {
    const port = this.port ?? PORT_AFTER_RESET;
    const stamp = romAt(h.pc, port) ? IN_ROM : (this.lastStore[h.pc] ?? NEVER_WRITTEN);
    const key = `${h.pc}:${stamp}`;
    let agg = this.byKey.get(key);
    if (!agg) {
      if (this.byKey.size >= MAX_AGGREGATES) return null;
      agg = {
        pc: h.pc,
        stamp,
        count: 0,
        first: h.clock,
        last: h.clock,
        touched: new Uint8Array(BITMAP_BYTES),
        ramUnderIo: null,
      };
      this.byKey.set(key, agg);
    }
    return agg;
  }

  /** What the store did to memory: $01, the RAM under I/O, or a RAM byte's code stamp. */
  private effect(h: Hit, agg: PcAgg): void {
    if (h.addr === 0x0001) {
      // A read-modify-write can log twice at one clock; count it once.
      const id = `${h.pc}:${h.clock}`;
      if (id === this.lastPortHit) return;
      this.lastPortHit = id;
      this.port = this.port === null ? null : portAfter(h, this.port);
      if (this.port === null) this.portLost = true;
      return;
    }
    if (h.addr >= 0xd000 && h.addr <= 0xdfff) {
      if (this.port === null || ioVisible(this.port)) return;
      agg.ramUnderIo ??= new Uint8Array(BITMAP_BYTES);
      touch(agg.ramUnderIo, h.addr);
    }
    this.lastStore[h.addr] = h.clock;
  }

  /** The hit count at which a cap stopped the feed, or null when every hit given was taken. */
  get capped(): number | null {
    return this.cappedAt;
  }

  get total(): number {
    return this.hitsSeen;
  }

  /** True once a store to $01 did not say its value: ROM and I/O mapping after it is not known. */
  get portUnknown(): boolean {
    return this.portLost;
  }

  /** Writers in order of their first store. */
  finish(): Writer[] {
    return clusters([...this.byKey.values()])
      .map(writerOf)
      .sort((a, b) => a.first_clock - b.first_clock || a.pc_range.start - b.pc_range.start);
  }
}

/** Store hits (any Hit.kind other than "store" is ignored) into writer groups; a pure, sync convenience over WriterAggregator. */
export function groupWriters(
  hits: Iterable<Hit>,
  capHits?: number,
): { writers: Writer[]; capped: number | null; hits: number } {
  const agg = new WriterAggregator(capHits);
  for (const h of hits) {
    if (h.kind !== "store") continue;
    if (!agg.add(h)) break;
  }
  return { writers: agg.finish(), capped: agg.capped, hits: agg.total };
}

// --- stubs: $9E (the SYS token) + digits + text -----------------------------

/** A file offset (2 bytes in: the PRG's own load-address header) to the C64 memory address it loads at. */
const addrOf = (load: number, fileOffset: number): number => load + fileOffset - 2;

const STUB_PATTERN = /\x9e[ ]?(\d{2,5})([\x20-\x7e]*)/;
const STUB_SCAN = new RegExp(STUB_PATTERN, "g");

/** A $9E+digits+text stub within bytes[from,to); sys and text only (addr and line are the caller's to decide). */
function stubIn(bytes: Uint8Array, from: number, to: number): { sys: number; text: string } | null {
  const text = Buffer.from(bytes.subarray(from, to)).toString("latin1");
  const m = STUB_PATTERN.exec(text);
  return m ? { sys: Number(m[1]), text: (m[2] ?? "").trim() } : null;
}

const word = (bytes: Uint8Array, off: number): number => (bytes[off] ?? 0) | ((bytes[off + 1] ?? 0) << 8);

/** One program's BASIC lines, walked by their own link bytes (not by scanning for $00): file offsets of the line itself and of its tokens. */
function basicLines(
  bytes: Uint8Array,
  load: number,
): { lineStart: number; tokensStart: number; tokensEnd: number }[] {
  const out: { lineStart: number; tokensStart: number; tokensEnd: number }[] = [];
  const seen = new Set<number>();
  let off = 2;
  while (off + 4 <= bytes.length && !seen.has(off)) {
    seen.add(off);
    const link = word(bytes, off);
    if (link === 0) break;
    const tokensStart = off + 4;
    const nextOff = link - load + 2;
    if (nextOff <= tokensStart || nextOff > bytes.length) break;
    out.push({ lineStart: off, tokensStart, tokensEnd: nextOff - 1 });
    off = nextOff;
  }
  return out;
}

/**
 * Stubs on the program's own linked BASIC lines (only meaningful when it
 * loads at $0801, BASIC's own start), and the file-offset [start,end) each
 * line's tokens span (so a raw scan does not re-report the same $9E byte).
 * addr is the line's own start: Commando's "SYS 2217 COMPUTERBRAINS" is at
 * $0801, line 2049.
 */
function linkedStubs(bytes: Uint8Array, load: number): { stubs: Stub[]; covered: Range[] } {
  if (load !== 0x0801) return { stubs: [], covered: [] };
  const lines = basicLines(bytes, load);
  const stubs = lines.flatMap((l) => {
    const s = stubIn(bytes, l.tokensStart, l.tokensEnd);
    return s ? [{ addr: addrOf(load, l.lineStart), ...s, line: word(bytes, l.lineStart + 2) }] : [];
  });
  const covered = lines.map((l) => ({ start: l.tokensStart, end: l.tokensEnd }));
  return { stubs, covered };
}

const inAny = (ranges: Range[], offset: number): boolean =>
  ranges.some((r) => offset >= r.start && offset < r.end);

/**
 * The line header in the 4 bytes before a scanned $9E, when its link says
 * the line runs at $0801 (link = $0801 + header + tokens + the $00 end):
 * Commando's inner stub has link $0812 and line 65535. Bytes that fail the
 * check are packed data, not a header.
 */
function headerBefore(bytes: Uint8Array, sysOff: number, matchLen: number): number | null {
  if (sysOff < 6 || bytes[sysOff + matchLen] !== 0) return null;
  const lineStart = sysOff - 4;
  const lineLen = 4 + matchLen + 1;
  return word(bytes, lineStart) === 0x0801 + lineLen ? lineStart : null;
}

/** Every $9E+digits+text anywhere in the image, outside the ranges a linked BASIC line's tokens already cover: a second stub buried in packed data (Commando's inner "SYS 2066 C.C.S."). */
function scannedStubs(bytes: Uint8Array, load: number, covered: Range[]): Stub[] {
  const text = Buffer.from(bytes).toString("latin1");
  return [...text.matchAll(STUB_SCAN)]
    .filter((m) => !inAny(covered, m.index))
    .map((m) => {
      const lineStart = headerBefore(bytes, m.index, m[0].length);
      return {
        addr: addrOf(load, lineStart ?? m.index),
        sys: Number(m[1]),
        text: (m[2] ?? "").trim(),
        line: lineStart === null ? null : word(bytes, lineStart + 2),
      };
    });
}

/** The program's own BASIC-line stub(s) first, then any other $9E+digits+text found in the image, sorted by address. */
export function findStubs(bytes: Uint8Array, load: number): Stub[] {
  const linked = linkedStubs(bytes, load);
  return [...linked.stubs, ...scannedStubs(bytes, load, linked.covered)].sort((a, b) => a.addr - b.addr);
}

// --- first program dispatch: reuses irq-chain's own entries, not re-derived --

/** KERNAL ROM starts here: a handler still there is still the KERNAL's own default, not one the program installed. */
const KERNAL_ROM = 0xe000;

/**
 * The clock of the first entry into a handler the program itself installed
 * (a RAM address, below KERNAL ROM), from entries irq-chain's own
 * analyseIrqChain found (run from power-on, not re-derived here). The
 * KERNAL's default IRQ handler ($EA31, ROM) fires from soon after reset
 * until the program overrides it or masks interrupts, so the first entry
 * overall is almost never the program's own; the first one below $E000 is.
 */
export function firstProgramDispatch(entries: IrqChain["entries"]): number | null {
  return entries.find((e) => e.handler < KERNAL_ROM)?.clock ?? null;
}
