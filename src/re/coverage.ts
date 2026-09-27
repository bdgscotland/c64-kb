/**
 * Coverage map: what the CPU executed, read, or wrote during a game pass.
 * Uses VICE's memmapzap (at the in-play or SYS-entry PC) and memmapshow
 * (after N writes to a per-frame address from the in-play clock, using a
 * clock-computed ignore count from a first pass).
 *
 * The memmapshow section in the monitor log has one row per address touched
 * since the last memmapzap. Each row lists access flags for the I/O, ROM,
 * and RAM banks. Only the RAM column is classified here. Executed opcode
 * bytes are extended to cover the full instruction length using a RAM dump
 * saved at the show moment.
 *
 * Measured on VICE x64sc 3.10 (PAL, -default, windowless):
 *   addr: IO  ROM RAM
 *   0876: --- --- --x (uninitialized exec)
 * VICE marks `x` on the opcode byte only; operand bytes show as `r--` or
 * not at all. The `(uninitialized exec/read)` suffix means the CPU accessed
 * the byte before any CPU write (PRG bytes injected by -autostartprgmode 1
 * carry it). The `(dummy)` suffix marks the 6502's dummy reads during IRQ
 * stack pushes. Both suffixes are ignored.
 */
import { readLines } from "./monlog.ts";

interface CoverageRange {
  start: number;
  end: number;
  /** The access kinds that apply to this range (subset of "x", "r", "w"). */
  kinds: ("x" | "r" | "w")[];
}

export interface Coverage {
  /** Ranges where the CPU executed instructions (opcode + operands extended). */
  code: CoverageRange[];
  /** Ranges read but never executed (read-only data). */
  data: CoverageRange[];
  /** Ranges written but neither read nor executed. */
  written_only: CoverageRange[];
  /** Ranges in $0000-$FFFF not accessed at all (untouched RAM). */
  unknown: CoverageRange[];
  /** CPU clock of the memmapshow checkpoint; 0 if the show did not fire. */
  show_clock: number;
  /** Cycles from the in-play clock to show_clock. */
  span_cycles: number;
  /** Frames from the in-play clock to show_clock (PAL or NTSC). */
  span_frames: number;
  unknowns: string[];
}

export interface MemmapRow {
  addr: number;
  io: string;
  rom: string;
  ram: string;
}

const HEADER_RE = /^addr:\s+IO\s+ROM\s+RAM/;
const ROW_RE = /^([0-9a-f]{4}):\s+([-xrw]{3})\s+([-xrw]{3})\s+([-xrw]{3})/i;

/**
 * Parses the memmapshow section from the lines of a VICE monitor log. One
 * row per address touched; addresses with no access flags don't appear in
 * the section and are not returned. The section begins with the header
 * line `addr: IO  ROM RAM` and ends at the first non-matching line or EOF.
 */
function rowsOf(lines: Iterable<string>): MemmapRow[] {
  const rows: MemmapRow[] = [];
  let inSection = false;
  for (const line of lines) {
    if (HEADER_RE.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    const m = ROW_RE.exec(line);
    if (!m) {
      inSection = false;
      continue;
    }
    const [, addrHex, io, rom, ram] = m;
    if (!addrHex || !io || !rom || !ram) continue;
    rows.push({ addr: parseInt(addrHex, 16), io, rom, ram });
  }
  return rows;
}

/** Parses the memmapshow section from a VICE monitor log's text. */
export function parseMemmapLog(text: string): MemmapRow[] {
  return rowsOf(text.split("\n"));
}

/** Read the memmapshow section from a VICE monitor log file, one line at a time. */
export function parseMemmapFile(logPath: string): MemmapRow[] {
  return rowsOf(readLines(logPath));
}

// ---------------------------------------------------------------------------
// Instruction-length table: 6510 (= 6502 + I/O port at $00/$01).
// Default 1 for illegal opcodes. Source: 6502 datasheet.
// ---------------------------------------------------------------------------

const INSTR_LEN: Uint8Array = (() => {
  const t = new Uint8Array(256).fill(1);
  const two = [
    0x01, 0x05, 0x06, 0x09, 0x10, 0x11, 0x15, 0x16, 0x21, 0x24, 0x25, 0x26, 0x29, 0x30, 0x31, 0x35, 0x36,
    0x41, 0x45, 0x46, 0x49, 0x50, 0x51, 0x55, 0x56, 0x61, 0x65, 0x66, 0x69, 0x70, 0x71, 0x75, 0x76, 0x81,
    0x84, 0x85, 0x86, 0x90, 0x91, 0x94, 0x95, 0x96, 0xa0, 0xa1, 0xa2, 0xa4, 0xa5, 0xa6, 0xa9, 0xb0, 0xb1,
    0xb4, 0xb5, 0xb6, 0xc0, 0xc1, 0xc4, 0xc5, 0xc6, 0xc9, 0xd0, 0xd1, 0xd5, 0xd6, 0xe0, 0xe1, 0xe4, 0xe5,
    0xe6, 0xe9, 0xf0, 0xf1, 0xf5, 0xf6,
  ];
  const three = [
    0x0d, 0x0e, 0x19, 0x1d, 0x1e, 0x20, 0x2c, 0x2d, 0x2e, 0x39, 0x3d, 0x3e, 0x4c, 0x4d, 0x4e, 0x59, 0x5d,
    0x5e, 0x6c, 0x6d, 0x6e, 0x79, 0x7d, 0x7e, 0x8c, 0x8d, 0x8e, 0x99, 0x9d, 0xac, 0xad, 0xae, 0xb9, 0xbc,
    0xbd, 0xbe, 0xcc, 0xcd, 0xce, 0xd9, 0xdd, 0xde, 0xec, 0xed, 0xee, 0xf9, 0xfd, 0xfe,
  ];
  for (const op of two) t[op] = 2;
  for (const op of three) t[op] = 3;
  return t;
})();

/** Length of the 6510 instruction with the given opcode (1, 2, or 3 bytes). */
export function instrLenOf(opcode: number): number {
  return INSTR_LEN[opcode] ?? 1;
}

/**
 * Extends each executed address to cover the full instruction length using
 * opcode bytes from a RAM dump. The dump is a VICE `save` PRG file:
 * 2-byte load-address header ($0000 LE) followed by 49152 bytes for
 * `save "f" 0 0000 bfff`. Returns the union of opcode addresses and all
 * operand bytes within the dump's $0000-$BFFF range.
 *
 * For addresses above $BFFF (charset, screen, sprites under KERNAL ROM):
 * the dump does not cover them; those executed addresses contribute only
 * themselves (no extension). Illegal opcodes default to length 1.
 */
export function extendByInstrLen(execAddrs: number[], dump: Uint8Array): Set<number> {
  const DUMP_MAX = 0xbfff;
  const code = new Set<number>();
  for (const addr of execAddrs) {
    code.add(addr);
    if (addr <= DUMP_MAX) {
      const offset = addr + 2; // skip 2-byte PRG header
      const opcode = dump[offset] ?? 0;
      const len = instrLenOf(opcode);
      for (let i = 1; i < len; i++) code.add(addr + i);
    }
  }
  return code;
}

/** The access kinds in a 3-char flag string ("---", "r-x", "rw-", etc.). */
function kindsOf(flags: string): ("x" | "r" | "w")[] {
  const k: ("x" | "r" | "w")[] = [];
  if (flags.startsWith("r")) k.push("r");
  if (flags[1] === "w") k.push("w");
  if (flags[2] === "x") k.push("x");
  return k;
}

/** Groups a sorted, deduped list of addresses into consecutive ranges with kinds from addrKinds. */
function groupByAddr(
  addrs: Iterable<number>,
  addrKinds: (addr: number) => ("x" | "r" | "w")[],
): { start: number; end: number; kinds: ("x" | "r" | "w")[] }[] {
  const sorted = [...new Set<number>(addrs)].sort((a, b) => a - b);
  const out: { start: number; end: number; kinds: ("x" | "r" | "w")[] }[] = [];
  for (const addr of sorted) {
    const kinds = addrKinds(addr);
    const key = kinds.join("");
    const last = out[out.length - 1];
    if (last?.end === addr - 1 && last.kinds.join("") === key) {
      last.end = addr;
    } else {
      out.push({ start: addr, end: addr, kinds });
    }
  }
  return out;
}

/**
 * Classifies coverage ranges from parsed memmapshow rows and a set of
 * code addresses (opcode + operand bytes from extendByInstrLen).
 *
 * - code: any address in codeSet (executed opcode or extended operand)
 * - data: RAM read, not in codeSet
 * - written_only: RAM written, not read, not in codeSet
 * - unknown: $0000-$FFFF not in any of the above
 *
 * "unknown" means untouched RAM; it is never called "data".
 */
export function classifyCoverage(
  rows: MemmapRow[],
  codeSet: Set<number>,
): Omit<Coverage, "show_clock" | "span_cycles" | "span_frames" | "unknowns"> {
  const rowByAddr = new Map<number, MemmapRow>();
  for (const row of rows) rowByAddr.set(row.addr, row);

  const dataAddrs: number[] = [];
  const writtenAddrs: number[] = [];

  for (const row of rows) {
    if (codeSet.has(row.addr)) continue;
    const k = kindsOf(row.ram);
    if (k.includes("r")) dataAddrs.push(row.addr);
    else if (k.includes("w")) writtenAddrs.push(row.addr);
  }

  const codeKinds = (addr: number): ("x" | "r" | "w")[] => {
    const row = rowByAddr.get(addr);
    return row ? kindsOf(row.ram) : ["x"];
  };

  const code = groupByAddr(codeSet, codeKinds);
  const data = groupByAddr(dataAddrs, (addr) => kindsOf(rowByAddr.get(addr)?.ram ?? "---"));
  const written_only = groupByAddr(writtenAddrs, (addr) => kindsOf(rowByAddr.get(addr)?.ram ?? "---"));

  const touched = new Set<number>([...codeSet, ...dataAddrs, ...writtenAddrs]);
  const unknownAddrs: number[] = [];
  for (let addr = 0; addr <= 0xffff; addr++) {
    if (!touched.has(addr)) unknownAddrs.push(addr);
  }
  const unknown = groupByAddr(unknownAddrs, () => []);

  return { code, data, written_only, unknown };
}
