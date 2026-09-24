/**
 * A .prg's load address and its BASIC SYS target, when it has one. Moved
 * from scripts/lib/claims-sources.ts so src/ (which scripts/ may not be
 * imported by, per tsconfig.build.json) can read PRGs too. `bytes` is the
 * PRG the caller passed in, kept so a later reader can disassemble from it
 * without loading the file twice.
 */
export interface Prg {
  load: number;
  end: number;
  /** The SYS address in a BASIC stub at $0801, when there is one. */
  sys?: number;
  bytes: Uint8Array;
}

export function readPrg(bytes: Uint8Array): Prg {
  const load = (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
  const prg: Prg = { load, end: load + bytes.length - 3, bytes };
  if (load !== 0x0801) return prg;
  // 10 SYS nnnn: link(2) line(2) $9E digits $00.
  const line = bytes.subarray(2, 40);
  const at = line.indexOf(0x9e);
  if (at < 4) return prg;
  const digits = /^\s*\(?\s*(\d{3,5})/.exec(Buffer.from(line.subarray(at + 1)).toString("latin1"));
  if (digits) prg.sys = Number(digits[1]);
  return prg;
}
