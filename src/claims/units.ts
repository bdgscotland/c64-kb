/**
 * The address side of the claims watch: which HardwareUnit a store lands
 * on, which RAM ranges a program declared, and what the 6510 port says is
 * mapped in. The unit table is read from the HARDWARE_UNITS seed in
 * src/graph/claims.ts, parsed from its `addresses` strings, so a change to
 * the seed changes the watch with it.
 */
import { HARDWARE_UNITS, type HardwareUnit } from "../graph/claims.ts";

/** A unit's share of one register: the bits it owns (0xFF for the whole byte). */
interface UnitBits {
  unit: string;
  mask: number;
}

/** Register address -> the units that own bits of it. */
export type UnitMap = Map<number, UnitBits[]>;

/** Offsets from screen RAM that belong to a unit: the sprite pointers, screen+$3F8+n. */
export type ScreenBytes = { unit: string; offset: number }[];

const ADDR = /\$([0-9A-Fa-f]{4})(?:-\$([0-9A-Fa-f]{4}))?/g;

/** `$D010/$D015/$D01B-$D01D` -> every address named. */
function addressList(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(ADDR)) {
    const first = parseInt(m[1] ?? "", 16);
    const last = m[2] ? parseInt(m[2], 16) : first;
    for (let a = first; a <= last; a++) out.push(a);
  }
  return out;
}

const bitMask = (first: number, last: number): number => {
  let m = 0;
  for (let b = first; b <= last; b++) m |= 1 << b;
  return m;
};

/** One comma-separated part of an `addresses` string -> [address, mask] pairs. */
function partRegisters(part: string): [number, number][] {
  const bitOf = /^bit (\d) of (.+)$/.exec(part);
  if (bitOf) return addressList(bitOf[2] ?? "").map((a) => [a, 1 << Number(bitOf[1])]);
  const bits = /\bbits? (\d)(?:-(\d))?/.exec(part);
  const mask = bits ? bitMask(Number(bits[1]), Number(bits[2] ?? bits[1])) : 0xff;
  return addressList(part).map((a) => [a, mask]);
}

/**
 * Parse the seed. Zero page is left out (its bytes ride the claim, not the
 * unit), and so are the words a unit's addresses carry that name no
 * register ("and the drive"); a sprite pointer, screen+$3F8+n, depends on
 * where the screen is and is returned apart.
 */
export function buildUnitMap(units: readonly HardwareUnit[] = HARDWARE_UNITS): {
  map: UnitMap;
  screen: ScreenBytes;
} {
  const map: UnitMap = new Map();
  const screen: ScreenBytes = [];
  for (const u of units) {
    if (u.kind === "zero_page") continue;
    const text = u.addresses.replace(/\([^)]*\)/g, "");
    for (const part of text.split(",").map((p) => p.trim())) {
      const ptr = /^pointer at screen\+\$([0-9A-Fa-f]+)$/.exec(part);
      if (ptr) {
        screen.push({ unit: u.name, offset: parseInt(ptr[1] ?? "", 16) });
        continue;
      }
      for (const [addr, mask] of partRegisters(part)) {
        const list = map.get(addr) ?? [];
        list.push({ unit: u.name, mask });
        map.set(addr, list);
      }
    }
  }
  return { map, screen };
}

/** A named address range, both ends inclusive. */
export interface NamedRange {
  name: string;
  first: number;
  last: number;
}

/**
 * `[name=]$XXXX[-$YYYY]`, comma-separated; `$` optional. A bare range is
 * named after itself.
 */
export function parseRanges(raw: string): NamedRange[] | { error: string } {
  const out: NamedRange[] = [];
  for (const part of raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")) {
    const m = /^(?:([A-Za-z_][\w.-]*)=)?\$?([0-9A-Fa-f]{1,4})(?:-\$?([0-9A-Fa-f]{1,4}))?$/.exec(part);
    if (!m) return { error: `"${part}" is not [name=]$XXXX[-$YYYY]` };
    const first = parseInt(m[2] ?? "", 16);
    const last = m[3] ? parseInt(m[3], 16) : first;
    if (last < first) return { error: `range ${part} runs backwards` };
    out.push({ name: m[1] ?? rangeText(first, last), first, last });
  }
  return out;
}

export const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;
export const hex2 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(2, "0")}`;
export const rangeText = (first: number, last: number): string =>
  first === last ? hex4(first) : `${hex4(first)}-${hex4(last)}`;

export const rangeHolding = (ranges: readonly NamedRange[], addr: number): NamedRange | undefined =>
  ranges.find((r) => addr >= r.first && addr <= r.last);

/**
 * The 6510 port. $00 is the data direction register, $01 the port; an
 * input bit reads as 1 (pulled up). LORAM, HIRAM, CHAREN are bits 0-2.
 * `null` means a store the trace could not value (ROL $01 with Z clear:
 * the carry it shifted into LORAM is not logged). From then on code in a
 * ROM window cannot be attributed (sourceOf says "unknown") until $00 and
 * $01 are stored with known values again.
 */
export class CpuPort {
  ddr: number | null = 0x2f;
  port: number | null = 0x37;

  store(addr: number, value: number | null): void {
    if (addr === 0) this.ddr = value;
    else if (addr === 1) this.port = value;
  }

  /**
   * What a read of $00 or $01 returns: the DDR, or the port with input bits
   * 0-5 read as 1 and bits 6-7 (no pin) as 0, so a stock C64 reads $37.
   * Only bits 0-2 steer the watch, and they are outputs after boot.
   */
  read(addr: number): number | null {
    if (addr === 0) return this.ddr;
    if (this.ddr === null || this.port === null) return null;
    return (this.port & this.ddr) | (~this.ddr & 0x3f);
  }

  /** The three banking bits as the PLA sees them, or null when unknown. */
  get bits(): number | null {
    if (this.ddr === null || this.port === null) return null;
    return ((this.port & this.ddr) | (~this.ddr & 0xff)) & 0x07;
  }

  /** KERNAL ROM at $E000: HIRAM set (no cartridge). Unknown reads as mapped. */
  get kernal(): boolean {
    const b = this.bits;
    return b === null || (b & 2) !== 0;
  }

  /** BASIC ROM at $A000: LORAM and HIRAM set. */
  get basic(): boolean {
    const b = this.bits;
    return b === null || (b & 3) === 3;
  }

  /** I/O at $D000: CHAREN set and LORAM or HIRAM set. A store elsewhere in $D000-$DFFF goes to RAM. */
  get io(): boolean {
    const b = this.bits;
    return b === null || ((b & 4) !== 0 && (b & 3) !== 0);
  }
}

/** Who ran the store, by PC and the banking at that moment; "unknown" for a ROM window while $01 is unknown. */
export type Source = "program" | "kernal" | "basic" | "unknown";

/**
 * BASIC's code runs on past $BFFF into the KERNAL ROM: the floating-point
 * routines FSQR, EXP, SIN and their helpers sit at $E000-$E4B6, and
 * $E4B7-$E4D2 is $AA filler (read from kernal-901227-03.bin). Stores from
 * there are BASIC's, not the KERNAL's. An earlier version called them
 * KERNAL stores outside every may-set (basic-float-calls, #84).
 */
const BASIC_IN_KERNAL_END = 0xe4b6;

export function sourceOf(pc: number, port: CpuPort): Source {
  if (port.bits === null && (pc >= 0xe000 || (pc >= 0xa000 && pc <= 0xbfff))) return "unknown";
  if (pc >= 0xe000 && port.kernal) return pc <= BASIC_IN_KERNAL_END ? "basic" : "kernal";
  if (pc >= 0xa000 && pc <= 0xbfff && port.basic) return "basic";
  return "program";
}

/** Sorted bytes as merged ranges: [[0x90, 0x9A], [0xB7, 0xB7]]. */
export function toRanges(bytes: Iterable<number>): [number, number][] {
  const sorted = [...new Set(bytes)].sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (const b of sorted) {
    const last = out.at(-1);
    if (last && b === last[1] + 1) last[1] = b;
    else out.push([b, b]);
  }
  return out;
}
