/**
 * Decodes VIC-II bank, screen, char/bitmap base and the eight sprite data
 * pointers from a VICE monitor `save` dump: `$DD00` (CIA2 port A, bits 0-1
 * select the bank, inverted), `$D018` (screen/char pointer within the
 * bank) and the screen matrix's own `+$3F8..+$3FF` (the sprite pointers,
 * in both text and bitmap mode). Also decodes the CPU port ($00/$01) from
 * its own dump: a `bank ram` dump of $0000/$0001 reads 0/0 on this
 * machine (VICE 3.10) — those two addresses are the 6510's I/O port
 * latches, not backed by the static RAM chip `bank ram` shows, so the
 * caller must dump them separately with `bank cpu` (c64_re_snapshot does;
 * see src/tools/re.ts).
 *
 * Every value here is read straight from a measured byte: a dump always
 * has a concrete byte at every address, so there is no "unknown" case,
 * unlike a trace's partial visibility (irq-chain.ts).
 *
 * Bit layout, measured on the irq-chain recipe PRG's default boot state
 * (VICE 3.10, `bank io` dump of $D000-$DFFF at the handler's first entry):
 * $DD00 = $97 (bits 0-1 = 3 -> bank 0, base $0000), $D018 = $15 (screen
 * pointer bits 7-4 = 1 -> offset $0400, so screen $0400; char pointer bits
 * 3-1 = 2 -> offset $1000). Bank = 3 - ($DD00 & 3); base = bank * $4000.
 * Screen = base + (($D018 >> 4) & $0F) * $400. Charset = base + (($D018 >>
 * 1) & 7) * $800. Bitmap = base + (($D018 >> 3) & 1) * $2000. Sprite
 * pointer k = base + ram[screen + $3F8 + k] * $40.
 */

export interface VicState {
  /** 0-3, from $DD00 bits 0-1 inverted (0 -> bank 3, $C000; 3 -> bank 0, $0000). */
  bank: number;
  screen: number;
  charset: number;
  /** Only meaningful in bitmap mode ($D011 bit 5); decoded unconditionally, like the others. */
  bitmap: number;
  /** The eight sprite data pointers, screen+$3F8..+$3FF each times $40, in the same bank. */
  sprite_pointers: number[];
  d011: number;
  d016: number;
  d018: number;
}

export interface CpuPortBytes {
  "00": number;
  "01": number;
}

export interface Snapshot {
  vic: VicState;
  cpu_port: CpuPortBytes;
}

/** A VICE `save 0 <start> <end>` dump: its own load address, then the bytes. */
function dump(buf: Buffer): { load: number; bytes: Buffer } {
  if (buf.length < 2) throw new Error(`too short to be a VICE save dump: ${buf.length} bytes`);
  return { load: buf.readUInt16LE(0), bytes: buf.subarray(2) };
}

/** The byte VICE saved for `addr`; throws if `addr` falls outside the dumped range. */
function byteAt(d: { load: number; bytes: Buffer }, addr: number): number {
  const i = addr - d.load;
  const b = d.bytes[i];
  if (b === undefined)
    throw new Error(
      `$${addr.toString(16)} is outside the dump (load $${d.load.toString(16)}, ${d.bytes.length} bytes)`,
    );
  return b;
}

/**
 * `ram` is a `bank ram` dump covering at least the screen matrix and its
 * +$3F8..+$3FF; `io` is a `bank io` dump covering $D011, $D016, $D018 and
 * $DD00 (a `save 0 d000 dfff` dump holds all four).
 */
export function decodeVicState(ram: Buffer, io: Buffer): VicState {
  const r = dump(ram);
  const i = dump(io);
  const dd00 = byteAt(i, 0xdd00);
  const d011 = byteAt(i, 0xd011);
  const d016 = byteAt(i, 0xd016);
  const d018 = byteAt(i, 0xd018);
  const bank = 3 - (dd00 & 0x03);
  const base = bank * 0x4000;
  const screen = base + ((d018 >> 4) & 0x0f) * 0x400;
  const charset = base + ((d018 >> 1) & 0x07) * 0x800;
  const bitmap = base + ((d018 >> 3) & 0x01) * 0x2000;
  const sprite_pointers = Array.from({ length: 8 }, (_, k) => base + byteAt(r, screen + 0x3f8 + k) * 0x40);
  return { bank, screen, charset, bitmap, sprite_pointers, d011, d016, d018 };
}

/** `cpu` is a `bank cpu` dump of $0000/$0001 (`save 0 0000 0001`): the real port latches. */
export function decodeCpuPort(cpu: Buffer): CpuPortBytes {
  const c = dump(cpu);
  return { "00": byteAt(c, 0x0000), "01": byteAt(c, 0x0001) };
}

export function decodeSnapshot(ram: Buffer, io: Buffer, cpu: Buffer): Snapshot {
  return { vic: decodeVicState(ram, io), cpu_port: decodeCpuPort(cpu) };
}
