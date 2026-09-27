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
 *
 * The reader is a generator over 1 MiB chunks of the file: one hit at a
 * time, never the whole log (issue #134: the Pirates! session's pass-A log
 * is 1,696,126,422 bytes, 27,839,066 lines and 13,895,239 hits; an array
 * of those hits is what ran a 4 GB heap out). An analysis that scans more
 * than once takes an `Iterable<Hit>` and gets `hitsOf(logPath)`, which
 * re-reads the file on every scan; a `Hit[]` still works, and is what the
 * tests pass.
 */
import { closeSync, openSync, readSync } from "node:fs";

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
  /** The checkpoint that logged the hit (`#N` in the head); lets a run drop hits of checkpoints it did not ask for. */
  checkpoint?: number;
}

const HEAD =
  /^#(\d+) \(Trace\s+(store|exec|load)\s+([0-9a-f]{4})\)(?:\s+(\d+)\/\$[0-9a-f]+,\s+(\d+)\/\$[0-9a-f]+)?/;
const INSN =
  /^\.C:([0-9a-f]{4})\s+(?:[0-9A-F]{2} )+\s*([A-Z]{3})\s*(.*?)\s*- A:([0-9A-F]{2}) X:([0-9A-F]{2}) Y:([0-9A-F]{2}) SP:([0-9a-f]{2})\s+(\S+)\s+(\d+)/;

/** Parse one hit from its two lines; null for anything else. */
export function parseHit(head: string, insn: string): Hit | null {
  const h = HEAD.exec(head);
  const i = INSN.exec(insn);
  if (!h || !i) return null;
  const n = (k: number, radix = 16) => parseInt(i[k] ?? "", radix);
  return {
    checkpoint: parseInt(h[1] ?? "", 10),
    kind: h[2] as Hit["kind"],
    addr: parseInt(h[3] ?? "", 16),
    line: h[4] !== undefined ? parseInt(h[4], 10) : -1,
    cycle: h[5] !== undefined ? parseInt(h[5], 10) : -1,
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

/** The log's lines, one at a time, from 1 MiB chunks of the file. A CRLF line's `\r` is dropped. */
export function* readLines(logPath: string): Generator<string> {
  const fd = openSync(logPath, "r");
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    let rest = Buffer.alloc(0);
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n <= 0) break;
      rest = Buffer.concat([rest, chunk.subarray(0, n)]);
      for (;;) {
        const at = rest.indexOf(0x0a);
        if (at < 0) break;
        yield rest.toString("utf8", 0, at).replace(/\r$/, "");
        rest = rest.subarray(at + 1);
      }
    }
    if (rest.length) yield rest.toString("utf8").replace(/\r$/, "");
  } finally {
    closeSync(fd);
  }
}

/** Every hit in a log, in order. A head line waits for its instruction line. */
export function* readHits(logPath: string): Generator<Hit> {
  let head: string | null = null;
  for (const line of readLines(logPath)) {
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

/**
 * A log's hits as an `Iterable` that can be scanned again and again: every
 * scan re-reads the file, so the analysis holds observations, not hits.
 */
export function hitsOf(logPath: string): Iterable<Hit> {
  return { [Symbol.iterator]: () => readHits(logPath) };
}

/** The hits `keep` accepts, lazily; re-iterable when `hits` is. */
export function filterHits(hits: Iterable<Hit>, keep: (h: Hit) => boolean): Iterable<Hit> {
  return {
    *[Symbol.iterator]() {
      for (const h of hits) if (keep(h)) yield h;
    },
  };
}

/** The first hit `keep` accepts, scanning once; null when none does. */
export function findHit(hits: Iterable<Hit>, keep: (h: Hit) => boolean): Hit | null {
  for (const h of hits) if (keep(h)) return h;
  return null;
}

/** How many hits `keep` accepts, scanning once. */
export function countHits(hits: Iterable<Hit>, keep: (h: Hit) => boolean): number {
  let n = 0;
  for (const h of hits) if (keep(h)) n++;
  return n;
}
