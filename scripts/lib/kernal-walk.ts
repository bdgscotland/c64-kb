/**
 * Static walk of the C64 KERNAL ROM (901227-03): from each jump-table entry,
 * follow every path the code can take and collect the zero-page bytes it may
 * write. scripts/kernal-zp-walk.ts prints, writes and checks the result
 * against the `**Clobbers zero page:**` lines of
 * docs/hardware/kernal-routines-reference.md.
 *
 * What is followed: fall-through, branches (both ways), JSR, JMP abs, and
 * JMP (vector) through the vector's power-on value: the RESTOR table at
 * $FD30 for $0314-$0333, and a `LDA #lo / STA v / LDA #hi / STA v+1` the ROM
 * itself executes for any other RAM vector ($028F, the keyboard-table
 * vector, set by CINT). A program that repoints a vector is not modelled;
 * the page line says the set is for the default vectors.
 *
 * What counts as a write: STA/STX/STY and INC/DEC/ASL/LSR/ROL/ROR to a
 * zero-page address, zp,X / zp,Y (the index range expanded, see
 * INDEX_BOUNDS) and abs,X / abs,Y with a base below $0100. A store through a
 * pointer, STA ($nn),Y, writes where the pointer points; $nn and $nn+1 are
 * read, not written, so it is reported as a pointer store and not counted.
 *
 * The walk is an upper bound ("may"): it counts every reachable store, error
 * paths included, whether or not a given call reaches it.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KERNAL_BASE = 0xe000;
/** SHA-256 of kernal-901227-03.bin, the ROM every page in this repo describes. */
const KERNAL_SHA256 = "83c60d47047d7beab8e5b7bf6f67f80daa088b7a6a27de0d7e016f6484042721";

type Mode =
  "imp" | "acc" | "imm" | "zp" | "zpx" | "zpy" | "izx" | "izy" | "abs" | "abx" | "aby" | "ind" | "rel";
const LENGTH: Record<Mode, number> = {
  imp: 1,
  acc: 1,
  imm: 2,
  zp: 2,
  zpx: 2,
  zpy: 2,
  izx: 2,
  izy: 2,
  abs: 3,
  abx: 3,
  aby: 3,
  ind: 3,
  rel: 2,
};

// The 151 documented NMOS 6502 opcodes. The KERNAL uses no others; the walk
// stops and reports any byte it would execute that is not in this table.
const OPCODE_TABLE = `
00 BRK imp|01 ORA izx|05 ORA zp|06 ASL zp|08 PHP imp|09 ORA imm|0A ASL acc|0D ORA abs|0E ASL abs
10 BPL rel|11 ORA izy|15 ORA zpx|16 ASL zpx|18 CLC imp|19 ORA aby|1D ORA abx|1E ASL abx
20 JSR abs|21 AND izx|24 BIT zp|25 AND zp|26 ROL zp|28 PLP imp|29 AND imm|2A ROL acc|2C BIT abs|2D AND abs|2E ROL abs
30 BMI rel|31 AND izy|35 AND zpx|36 ROL zpx|38 SEC imp|39 AND aby|3D AND abx|3E ROL abx
40 RTI imp|41 EOR izx|45 EOR zp|46 LSR zp|48 PHA imp|49 EOR imm|4A LSR acc|4C JMP abs|4D EOR abs|4E LSR abs
50 BVC rel|51 EOR izy|55 EOR zpx|56 LSR zpx|58 CLI imp|59 EOR aby|5D EOR abx|5E LSR abx
60 RTS imp|61 ADC izx|65 ADC zp|66 ROR zp|68 PLA imp|69 ADC imm|6A ROR acc|6C JMP ind|6D ADC abs|6E ROR abs
70 BVS rel|71 ADC izy|75 ADC zpx|76 ROR zpx|78 SEI imp|79 ADC aby|7D ADC abx|7E ROR abx
81 STA izx|84 STY zp|85 STA zp|86 STX zp|88 DEY imp|8A TXA imp|8C STY abs|8D STA abs|8E STX abs
90 BCC rel|91 STA izy|94 STY zpx|95 STA zpx|96 STX zpy|98 TYA imp|99 STA aby|9A TXS imp|9D STA abx
A0 LDY imm|A1 LDA izx|A2 LDX imm|A4 LDY zp|A5 LDA zp|A6 LDX zp|A8 TAY imp|A9 LDA imm|AA TAX imp|AC LDY abs|AD LDA abs|AE LDX abs
B0 BCS rel|B1 LDA izy|B4 LDY zpx|B5 LDA zpx|B6 LDX zpy|B8 CLV imp|B9 LDA aby|BA TSX imp|BC LDY abx|BD LDA abx|BE LDX aby
C0 CPY imm|C1 CMP izx|C4 CPY zp|C5 CMP zp|C6 DEC zp|C8 INY imp|C9 CMP imm|CA DEX imp|CC CPY abs|CD CMP abs|CE DEC abs
D0 BNE rel|D1 CMP izy|D5 CMP zpx|D6 DEC zpx|D8 CLD imp|D9 CMP aby|DD CMP abx|DE DEC abx
E0 CPX imm|E1 SBC izx|E4 CPX zp|E5 SBC zp|E6 INC zp|E8 INX imp|E9 SBC imm|EA NOP imp|EC CPX abs|ED SBC abs|EE INC abs
F0 BEQ rel|F1 SBC izy|F5 SBC zpx|F6 INC zpx|F8 SED imp|F9 SBC aby|FD SBC abx|FE INC abx`;

const OPCODES = new Map<number, { op: string; mode: Mode }>();
for (const entry of OPCODE_TABLE.split(/[|\n]/).filter((s) => s.trim() !== "")) {
  const [hex = "", op = "", mode = ""] = entry.trim().split(" ");
  OPCODES.set(parseInt(hex, 16), { op, mode: mode as Mode });
}

const WRITES = new Set(["STA", "STX", "STY", "INC", "DEC", "ASL", "LSR", "ROL", "ROR"]);
const INDEXED_ZP: ReadonlySet<Mode> = new Set(["zpx", "zpy"]);
const INDEXED_ABS: ReadonlySet<Mode> = new Set(["abx", "aby"]);

/**
 * Index ranges of the indexed zero-page stores the walk reaches, read off
 * the ROM at each site. A site not listed here is counted as writing all of
 * zero page (an index the walk cannot bound can be anything), and reported,
 * so a new site cannot shrink the set by being forgotten.
 */
const INDEX_BOUNDS: ReadonlyMap<number, { index: [number, number]; why: string }> = new Map([
  // The screen editor's line-link table $D9-$F2: one byte per screen row.
  [0xe54d, { index: [0, 25], why: "CINT: STY $D9,X for X = 0 to $19 (CPX #$1A)" }],
  [0xe55c, { index: [26, 26], why: "CINT: STA $D9,X after that loop, X = $1A, so $F3" }],
  [
    0xe6da,
    { index: [0, 24], why: "ASL $D9,X, X = cursor row $D6 (below $19 by the CPX at $E6CF) or row $02A5" },
  ],
  [0xe6dc, { index: [0, 24], why: "LSR $D9,X, the same X as $E6DA" }],
  [0xe6e3, { index: [1, 25], why: "STA $D9,X after INX, one row below $E6DA's" }],
  [0xe922, { index: [0, 23], why: "scroll up: LDX #0 at $E916, loop to CPX #$18" }],
  [0xe9ba, { index: [1, 23], why: "insert line: LDX #$17 at $E9A9, DEX to 1 (BNE)" }],
]);

// The IRQ entry's BRK branch. $FF48 tests the pushed B flag and takes
// JMP ($0316) only for a BRK instruction. The tape code enters at $FF43
// with B cleared to fake an IRQ, so a walk taking both branches there would
// run the BRK handler (the warm start: IOINIT, CINT, then BASIC) that never runs.
// The walk executes no BRK (it would report one), so this jump is skipped.
const BRK_DISPATCH = 0xff55;

/** Handlers a routine installs in the IRQ vector while it runs (tape): they run inside the call, so their writes count. */
const INSTALLED_IRQ_SITE = 0xfcbd;
// LDA $FD93,X / STA $0314 / LDA $FD94,X / STA $0315: X = 8, 10, 12 or 14
// selects one of the four words at $FD9B. The walk does not narrow which one
// a call site picks; all four count.
const INSTALLED_IRQ_BYTES = [0xbd, 0x93, 0xfd, 0x8d, 0x14, 0x03, 0xbd, 0x94, 0xfd, 0x8d, 0x15, 0x03];
const INSTALLED_IRQ_TABLE = 0xfd9b;
const INSTALLED_IRQ_COUNT = 4;

export interface Rom {
  bytes: Buffer;
  path: string;
}

const ROM_NAME = "kernal-901227-03.bin";

/** Where a KERNAL image may be: KERNAL_ROM, the repo's headless VICE build, a Homebrew or Linux VICE install. */
function romCandidates(repoRoot: string): string[] {
  return [
    process.env.KERNAL_ROM ?? "",
    join(repoRoot, ".tools", "vice-headless", "data", "C64", ROM_NAME),
    join("/opt/homebrew/opt/vice/share/vice/C64", ROM_NAME),
    join("/usr/local/share/vice/C64", ROM_NAME),
    join("/usr/share/vice/C64", ROM_NAME),
  ].filter((p) => p !== "");
}

/** The KERNAL image, or null when none is on this machine. Throws on a file that is not 901227-03. */
export function findKernal(repoRoot: string): Rom | null {
  for (const path of romCandidates(repoRoot)) {
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== 0x2000 || sha !== KERNAL_SHA256) {
      throw new Error(`${path} is not KERNAL 901227-03 (sha256 ${sha}, ${bytes.length} bytes)`);
    }
    return { bytes, path };
  }
  return null;
}

export const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

class Image {
  private readonly b: Buffer;
  constructor(b: Buffer) {
    this.b = b;
  }
  byte(a: number): number {
    const v = this.b[a - KERNAL_BASE];
    if (v === undefined) throw new Error(`$${hex4(a)} is outside the KERNAL image`);
    return v;
  }
  word(a: number): number {
    return this.byte(a) | (this.byte(a + 1) << 8);
  }
}

/** Power-on values of the RAM vectors the walk can follow, with where each came from. */
export function vectorDefaults(rom: Buffer): Map<number, { target: number; source: string }> {
  const img = new Image(rom);
  const out = new Map<number, { target: number; source: string }>();
  // RESTOR copies 16 words from $FD30 to $0314-$0333.
  for (let i = 0; i < 16; i++) {
    out.set(0x0314 + 2 * i, {
      target: img.word(0xfd30 + 2 * i),
      source: `RESTOR table $${hex4(0xfd30 + 2 * i)}`,
    });
  }
  // Any other RAM vector the ROM sets with LDA #lo / STA v / LDA #hi / STA v+1.
  for (let a = KERNAL_BASE; a + 10 <= 0x10000; a++) {
    if (
      img.byte(a) !== 0xa9 ||
      img.byte(a + 2) !== 0x8d ||
      img.byte(a + 5) !== 0xa9 ||
      img.byte(a + 7) !== 0x8d
    )
      continue;
    const v = img.word(a + 3);
    if (img.word(a + 8) !== v + 1 || v < 0x0200 || v >= 0x0400 || out.has(v)) continue;
    const target = img.byte(a + 1) | (img.byte(a + 6) << 8);
    if (target >= KERNAL_BASE) out.set(v, { target, source: `LDA/STA at $${hex4(a)}` });
  }
  return out;
}

export interface WalkResult {
  /** Entry point the walk started from (the jump-table slot). */
  entry: number;
  /** Zero-page bytes $00-$FF the code may write. */
  bytes: Set<number>;
  /** Pointer bytes of STA ($nn),Y / STA ($nn,X): the store lands where they point. */
  pointerStores: Set<number>;
  /** JMP (vector) the walk could not follow, by vector address. */
  unresolved: Set<number>;
  /** Vectors followed through their power-on value. */
  followed: Set<number>;
  /** JSR/JMP targets below $E000 (outside the KERNAL image). */
  outside: Set<number>;
  /** Indexed zero-page stores with no entry in INDEX_BOUNDS (counted as all of zero page). */
  unboundedIndex: Set<number>;
  /** Bytes the walk would execute that are not a documented opcode, or a BRK. */
  badOpcode: Set<number>;
  instructions: number;
}

function newResult(entry: number): WalkResult {
  return {
    entry,
    bytes: new Set(),
    pointerStores: new Set(),
    unresolved: new Set(),
    followed: new Set(),
    outside: new Set(),
    unboundedIndex: new Set(),
    badOpcode: new Set(),
    instructions: 0,
  };
}

function addRange(set: Set<number>, first: number, count: number, wrap: boolean): void {
  for (let i = 0; i < count; i++) {
    const a = first + i;
    if (wrap) set.add(a & 0xff);
    else if (a <= 0xff) set.add(a);
  }
}

/** Record the zero-page effect of one write instruction. */
function recordWrite(r: WalkResult, at: number, mode: Mode, operand: number): void {
  if (mode === "zp") r.bytes.add(operand);
  else if (INDEXED_ZP.has(mode)) {
    const b = INDEX_BOUNDS.get(at);
    if (b) addRange(r.bytes, operand + b.index[0], b.index[1] - b.index[0] + 1, true);
    else {
      r.unboundedIndex.add(at);
      addRange(r.bytes, 0, 256, true);
    }
  } else if (mode === "abs" && operand < 0x100) r.bytes.add(operand);
  else if (INDEXED_ABS.has(mode) && operand < 0x100) {
    // abs,X/abs,Y does not wrap: past $FF it writes the stack page.
    const b = INDEX_BOUNDS.get(at);
    addRange(r.bytes, operand + (b?.index[0] ?? 0), b ? b.index[1] - b.index[0] + 1 : 256, false);
  } else if (mode === "izy" || mode === "izx") r.pointerStores.add(operand);
}

export class KernalWalker {
  private readonly img: Image;
  private readonly vectors: Map<number, { target: number; source: string }>;
  constructor(rom: Buffer) {
    this.img = new Image(rom);
    this.vectors = vectorDefaults(rom);
    const got = INSTALLED_IRQ_BYTES.map((_, i) => this.img.byte(INSTALLED_IRQ_SITE + i));
    if (got.some((b, i) => b !== INSTALLED_IRQ_BYTES[i]))
      throw new Error(`$${hex4(INSTALLED_IRQ_SITE)} is not the tape IRQ installer this walk models`);
  }

  /** Handlers the tape code installs in $0314 (the four words at $FD9B). */
  installedIrqHandlers(): number[] {
    return Array.from({ length: INSTALLED_IRQ_COUNT }, (_, i) => this.img.word(INSTALLED_IRQ_TABLE + 2 * i));
  }

  /**
   * Execute one instruction symbolically: record its writes, queue the
   * paths it opens (JSR targets, branch targets, installed handlers), and
   * return where the current path goes next, or null where it ends.
   */
  private step(a: number, r: WalkResult, queue: number[]): number | null {
    if (a === INSTALLED_IRQ_SITE) queue.push(...this.installedIrqHandlers());
    const info = OPCODES.get(this.img.byte(a));
    if (!info || info.op === "BRK") {
      r.badOpcode.add(a);
      return null;
    }
    r.instructions++;
    const len = LENGTH[info.mode];
    const operand = len === 2 ? this.img.byte(a + 1) : len === 3 ? this.img.word(a + 1) : 0;
    if (WRITES.has(info.op)) recordWrite(r, a, info.mode, operand);
    if (info.op === "JSR") queue.push(operand);
    if (info.op === "JMP") return this.jump(a, info.mode, operand, r);
    if (info.op === "RTS" || info.op === "RTI") return null;
    if (info.mode === "rel") queue.push(a + 2 + (operand > 127 ? operand - 256 : operand));
    return a + len;
  }

  /** Where a JMP at `a` goes: its operand, a vector's power-on value, or nowhere the walk can follow. */
  private jump(a: number, mode: Mode, operand: number, r: WalkResult): number | null {
    if (mode === "abs") return operand;
    if (a === BRK_DISPATCH) return null;
    const v = this.vectors.get(operand);
    if (!v) {
      r.unresolved.add(operand);
      return null;
    }
    r.followed.add(operand);
    return v.target;
  }

  walk(entry: number): WalkResult {
    const r = newResult(entry);
    const seen = new Set<number>();
    const queue = [entry];
    while (queue.length > 0) {
      let a: number | null = queue.pop() ?? null;
      while (a !== null && !seen.has(a)) {
        if (a < KERNAL_BASE) {
          r.outside.add(a);
          break;
        }
        seen.add(a);
        a = this.step(a, r, queue);
      }
    }
    return r;
  }
}

/** Every jump-table slot, $FF81-$FFF3, 3 bytes apart. */
export const JUMP_TABLE_SLOTS: readonly number[] = Array.from(
  { length: (0xfff3 - 0xff81) / 3 + 1 },
  (_, i) => 0xff81 + 3 * i,
);

// Moved to src/claims/units.ts with the claims watch (#22 step 8).
export { toRanges } from "../../src/claims/units.ts";
