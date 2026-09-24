/**
 * Interrupt dispatches in a monitor trace of stores to $0100-$01FF.
 *
 * An interrupt pushes PC high, PC low and P. The windowless x64sc 3.10 logs
 * the three stores at one clock, against the interrupted instruction, with
 * the SP after all three pushes (measured on kickassembler/raster-bars: a
 * `JMP $0926` logged $01F6, $01F5, $01F4 with SP:F3 at clock 3089468). So
 * the push at $0100 + SP + 3 is an interrupt's PC high byte. A JSR, PHA or
 * PHP alone reaches only SP + 2; one taken straight before an interrupt
 * logs its own bytes at SP + 4 and SP + 5 (scripts/lib/claims-trace.ts,
 * isPush). BRK pushes the same three bytes; it is a software break, not a
 * dispatch the hardware raised, so it is left out.
 *
 * Which handler an interrupt runs depends on the vectors at that moment:
 * $FFFE (or $FFFA for an NMI) when RAM holds a handler there, and the
 * KERNAL's $0314 (or $0318) when the KERNAL is mapped and dispatches
 * through $FF48 (or $FE43). The trace does not know the banking, so both
 * are candidates, and the entry is the first candidate executed within
 * DISPATCH_WINDOW cycles of the push.
 */
import type { Hit } from "./monlog.ts";

export const VECTORS = { irq_0314: 0x0314, nmi_0318: 0x0318, nmi_fffa: 0xfffa, irq_fffe: 0xfffe } as const;
export type VectorName = keyof typeof VECTORS;

/** The KERNAL ROM's own hardware vector targets: its IRQ and NMI entry points. */
const KERNAL_TARGET: Partial<Record<VectorName, number>> = { irq_fffe: 0xff48, nmi_fffa: 0xfe43 };

/**
 * Cycles from an interrupt's push to its handler's first instruction, at most.
 * The KERNAL's $FF48 dispatch takes 29 (measured on raster-bars: push at
 * clock 3089468, $0B00 at 3089497); one raster line (63 PAL, 65 NTSC) is
 * added for cycles the VIC-II steals on a badline or for sprites, which
 * the dispatch can straddle (arithmetic, rung 3).
 */
export const DISPATCH_WINDOW = 29 + 65;

export function isInterruptPush(h: Hit): boolean {
  return h.kind === "store" && h.mnemonic !== "BRK" && h.addr === (0x100 | ((h.sp + 3) & 0xff));
}

/** One place an interrupt could go: the handler address and the vector that holds it. */
export interface Candidate {
  handler: number;
  vector: VectorName;
}

/**
 * The handlers an interrupt could enter, given each vector's current value
 * (null when a byte is unknown or never written). A hardware vector never
 * written by the program is read from ROM, so only the KERNAL's RAM vector
 * counts; one that holds the KERNAL's own entry point likewise.
 */
export function candidates(value: (v: VectorName) => number | null): Candidate[] {
  const out: Candidate[] = [];
  for (const [hw, soft] of [
    ["irq_fffe", "irq_0314"],
    ["nmi_fffa", "nmi_0318"],
  ] as const) {
    const h = value(hw);
    if (h !== null && h !== KERNAL_TARGET[hw]) out.push({ handler: h, vector: hw });
    const s = value(soft);
    if (s !== null) out.push({ handler: s, vector: soft });
  }
  return out;
}
