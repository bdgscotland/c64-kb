/**
 * The windowless x64sc's -monlog trace, read one hit at a time.
 *
 *   #1 (Trace store 00fb)   41/$029,  62/$3e
 *   .C:0819  86 FB       STX $FB        - A:FF X:12 Y:00 SP:f6 ..-..I..    3049325
 *
 * Head: checkpoint kind and address, then raster line and cycle within the
 * line (measured on a KickAssembler PRG in the windowless x64sc 3.10: a
 * handler armed for line 100 logs entries on lines 100 and 101,
 * test/re-tools.test.ts). Second line: the instruction with the
 * registers after it and the CPU clock. A store hit does not log the byte
 * written; storedValue recovers it for STA, STX, STY and SAX only.
 * Moved from scripts/lib/claims-trace.ts, which discarded line and cycle.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface Hit {
  kind: "store" | "exec" | "load";
  addr: number;
  pc: number;
  mnemonic: string;
  operand: string;
  a: number;
  x: number;
  y: number;
  sp: number;
  /** Flags after the instruction, as VICE prints them: `N.-..IZC`. */
  flags: string;
  clock: number;
  /** Raster line when the checkpoint fired. */
  line: number;
  /** Cycle within that line. */
  cycle: number;
}

const HEAD =
  /^#\d+ \(Trace\s+(store|exec|load)\s+([0-9a-f]{4})\)(?:\s+(\d+)\/\$[0-9a-f]+,\s+(\d+)\/\$[0-9a-f]+)?/;
const INSN =
  /^\.C:([0-9a-f]{4})\s+(?:[0-9A-F]{2} )+\s*([A-Z]{3})\s*(.*?)\s*- A:([0-9A-F]{2}) X:([0-9A-F]{2}) Y:([0-9A-F]{2}) SP:([0-9a-f]{2})\s+(\S+)\s+(\d+)/;

/** Parse one hit from its two lines; null for anything else. */
export function parseHit(head: string, insn: string): Hit | null {
  const h = HEAD.exec(head);
  const i = INSN.exec(insn);
  if (!h || !i) return null;
  const n = (k: number, radix = 16) => parseInt(i[k] ?? "", radix);
  return {
    kind: h[1] as Hit["kind"],
    addr: parseInt(h[2] ?? "", 16),
    line: h[3] !== undefined ? parseInt(h[3], 10) : -1,
    cycle: h[4] !== undefined ? parseInt(h[4], 10) : -1,
    pc: n(1),
    mnemonic: i[2] ?? "",
    operand: i[3] ?? "",
    a: n(4),
    x: n(5),
    y: n(6),
    sp: n(7),
    flags: i[8] ?? "",
    clock: n(9, 10),
  };
}

/** The byte a store wrote, when the instruction says: STA/STX/STY/SAX. */
export function storedValue(hit: Hit): number | null {
  switch (hit.mnemonic) {
    case "STA":
      return hit.a;
    case "STX":
      return hit.x;
    case "STY":
      return hit.y;
    case "SAX":
      return hit.a & hit.x;
    default:
      return null;
  }
}

/** Every hit in a log, in order. A head line waits for its instruction line. */
export async function* readHits(logPath: string): AsyncGenerator<Hit> {
  const rl = createInterface({ input: createReadStream(logPath), crlfDelay: Infinity });
  let head: string | null = null;
  for await (const line of rl) {
    if (head !== null) {
      const hit = parseHit(head, line);
      head = null;
      if (hit) {
        yield hit;
        continue;
      }
    }
    if (line.startsWith("#")) head = line;
  }
}
