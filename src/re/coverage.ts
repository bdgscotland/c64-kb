/**
 * Coverage map: what the CPU executed, read, or wrote during a game pass.
 * Uses VICE's memmapzap (at the in-play or SYS-entry PC) and memmapshow
 * (after N writes to $D019, the raster-IRQ acknowledge register, from the
 * same starting point).
 *
 * For a session, the D019 writes that happen before play (during the title
 * and KERNAL boot) are counted in a first pass so the second pass's ignore
 * count places the show N writes into game play. For a PRG, the ignore
 * count is applied from the start of the run (a small fixed-count of writes
 * happens during KERNAL boot and setup before the first IRQ write).
 *
 * The memmapshow section in the monitor log has one row per address touched
 * since the last memmapzap. Each row lists access flags for the I/O, ROM,
 * and RAM banks. Only the RAM column is classified here (code = executed,
 * data = read but not executed, written_only = written but not read or
 * executed). Addresses with no access do not appear; they are untouched
 * (unknown, not "data").
 */
import { readFileSync } from "node:fs";

interface CoverageRange {
  start: number;
  end: number;
  /** The access kinds that apply to this range (subset of "x", "r", "w"). */
  kinds: ("x" | "r" | "w")[];
}

export interface Coverage {
  /** Ranges with at least one exec access. */
  code: CoverageRange[];
  /** Ranges read but never executed. */
  data: CoverageRange[];
  /** Ranges written but neither read nor executed. */
  written_only: CoverageRange[];
  unknowns: string[];
}

interface MemmapRow {
  addr: number;
  io: string;
  rom: string;
  ram: string;
}

const HEADER_RE = /^addr:\s+IO\s+ROM\s+RAM/;
const ROW_RE = /^([0-9a-f]{4}):\s+([-xrw]{3})\s+([-xrw]{3})\s+([-xrw]{3})/i;

/**
 * Parses the memmapshow section from a VICE monitor log. Returns one row
 * per address touched; addresses with no access flags don't appear in the
 * section and are not returned. The section begins with the header line
 * `addr: IO  ROM RAM` and ends at the first non-matching line.
 * Measured on VICE x64sc 3.10 (PAL, windowless, -default): each row is
 * `addr: IO ROM RAM` where flags are `r`, `w`, `x` or `-`; an optional
 * `(uninitialized read)` or `(uninitialized exec)` suffix means the CPU
 * accessed the byte before any CPU write (PRG bytes injected by
 * -autostartprgmode 1 carry it).
 */
export function parseMemmapLog(text: string): MemmapRow[] {
  const rows: MemmapRow[] = [];
  let inSection = false;
  for (const line of text.split("\n")) {
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

/** Read the memmapshow section from a VICE monitor log file. */
export function parseMemmapFile(logPath: string): MemmapRow[] {
  return parseMemmapLog(readFileSync(logPath, "utf8"));
}

/** The access kinds in a 3-char flag string ("---", "r-x", "rw-", etc.). */
function kindsOf(flags: string): ("x" | "r" | "w")[] {
  const k: ("x" | "r" | "w")[] = [];
  if (flags.startsWith("r")) k.push("r");
  if (flags[1] === "w") k.push("w");
  if (flags[2] === "x") k.push("x");
  return k;
}

/** Groups consecutive addresses that have identical kinds into ranges. */
function groupRanges(rows: MemmapRow[]): CoverageRange[] {
  const out: CoverageRange[] = [];
  let cur: CoverageRange | undefined;
  for (const row of rows) {
    const kinds = kindsOf(row.ram);
    if (kinds.length === 0) continue;
    const key = kinds.join("");
    if (cur?.end === row.addr - 1 && cur.kinds.join("") === key) {
      cur.end = row.addr;
    } else {
      cur = { start: row.addr, end: row.addr, kinds };
      out.push(cur);
    }
  }
  return out;
}

/**
 * Classifies coverage ranges from parsed memmapshow rows. Only the RAM
 * bank column is classified (I/O and ROM accesses are not returned here).
 * Addresses never accessed (not in the rows) are untouched; we call them
 * unknown, never "data".
 */
export function classifyCoverage(rows: MemmapRow[]): Omit<Coverage, "unknowns"> {
  const ranges = groupRanges(rows);
  return {
    code: ranges.filter((r) => r.kinds.includes("x")),
    data: ranges.filter((r) => r.kinds.includes("r") && !r.kinds.includes("x")),
    written_only: ranges.filter(
      (r) => r.kinds.includes("w") && !r.kinds.includes("r") && !r.kinds.includes("x"),
    ),
  };
}

/**
 * The monitor commands for a PRG-path coverage run. Checkpoint 1 fires at
 * the SYS entry PC and zaps the map; checkpoint 2 fires on the
 * (frames)-th store to $D019 and shows it. Both disable themselves.
 * Checkpoints are numbered 1 and 2 (the session's own checkpoints are
 * absent for a plain PRG run).
 *
 * frames is the total number of $D019 writes from the start of the run
 * before the show fires. A small fixed count of writes occurs during KERNAL
 * boot and setup before the first IRQ handler write; the default 3 skips
 * those for the irq-chain recipe PRG (KERNAL: 1, setup: 1, first IRQ: 3rd).
 */
export function coverageCommandsPrg(sysAddr: string, frames: number): string {
  const hex4 = (n: number) => n.toString(16).padStart(4, "0");
  const addr = hex4(parseInt(sysAddr.startsWith("$") ? sysAddr.slice(1) : sysAddr, 16));
  const ignoreHex = (frames - 1).toString(16);
  const lines = [
    `trace exec ${addr} ${addr}`,
    `command 1 "memmapzap; disable 1"`,
    `trace store d019 d019`,
    ...(frames > 1 ? [`ignore 2 ${ignoreHex}`] : []),
    `command 2 "memmapshow; disable 2"`,
  ];
  return lines.map((l) => l + "\n").join("");
}

/**
 * The monitor commands for the show half of a session coverage run. The
 * checkpoint is built here (outside MonitorScript) and needs to be inserted
 * after the session's own checkpoints and the zap checkpoint, so it gets
 * the right number. Returns the raw lines to pass to MonitorScript.add
 * after m.checkpoint() numbers the show line.
 *
 * totalIgnore = (D019 writes before play_clock in the first pass) + frames - 1.
 * A zero ignore is valid (fire on the next hit).
 */
export function coverageShowIgnore(prePlayD019Count: number, frames: number): number {
  return prePlayD019Count + frames - 1;
}

/** A D019 store hit (kind === "store", addr === 0xd019) before play_clock. */
export function countPrePlayD019(
  hits: { kind: string; addr: number; clock: number }[],
  playClock: number,
): number {
  return hits.filter((h) => h.kind === "store" && h.addr === 0xd019 && h.clock < playClock).length;
}
