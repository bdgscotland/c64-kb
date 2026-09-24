/**
 * Read a VICE monitor store trace and sort every store into what the
 * program declared, what it did not, and what the ROM wrote for it.
 *
 * The windowless x64sc (-monlog) writes each hit as two lines:
 *
 *   #1 (Trace store 00fb)   41/$029,  62/$3e
 *   .C:0819  86 FB       STX $FB        - A:FF X:12 Y:00 SP:f6 ..-..I..    3049325
 *
 * raster line and cycle, then the instruction with the registers as they
 * are after it (measured: a PHA showing SP:f5 stored $01F6). The hit does
 * not log the byte written. So a store's value is A, X or Y for STA, STX,
 * STY; a read-modify-write logs one hit (measured: DEC $01 twice, two hits)
 * and is valued only on the 6510 port, from the port's last value; a push
 * lands at $0100 + SP + 1..3. An interrupt's pushes show the interrupted
 * instruction.
 */
import type { Declared } from "./claims-declared.ts";
import { CpuPort, sourceOf, type ScreenBytes, type Source, type UnitMap } from "./claims-units.ts";
import { parseHit, storedValue, type Hit } from "../../src/re/monlog.ts";

export { parseHit, storedValue, type Hit };

/**
 * The byte a read-modify-write left on the 6510 port ($00 or $01), from the
 * byte it read there. ROR's new bit 7 is the carry it shifted in, which the
 * N flag after it shows; ROL's new bit 0 is that carry too, known only when
 * Z says the result is 0. The illegal DCP, ISB, SLO, SRE write what DEC,
 * INC, ASL, LSR would. Null when the byte cannot be known.
 */
export function portRmwValue(hit: Hit, read: number | null): number | null {
  if (read === null) return null;
  const flag = (f: string) => hit.flags.includes(f);
  switch (hit.mnemonic) {
    case "INC":
    case "ISB":
      return (read + 1) & 0xff;
    case "DEC":
    case "DCP":
      return (read - 1) & 0xff;
    case "ASL":
    case "SLO":
      return (read << 1) & 0xff;
    case "LSR":
    case "SRE":
      return read >> 1;
    case "ROR":
      return (read >> 1) | (flag("N") ? 0x80 : 0);
    case "ROL":
      return flag("Z") ? 0 : null;
    default:
      return null;
  }
}

/** Bytes an instruction itself pushes: JSR two, PHA and PHP one. */
const OWN_PUSHES: Record<string, number> = { JSR: 2, PHA: 1, PHP: 1 };

/**
 * A push (JSR, PHA, PHP, an interrupt) lands at $0100 + SP + 1..3, SP read
 * after the instruction. When an interrupt is taken straight after a JSR,
 * PHA or PHP, VICE logs the instruction's own pushes with the SP after the
 * interrupt's three as well (measured: a JSR at line 212 before the raster
 * IRQ logged $01EE-$01EA, all with SP:E9), so they sit up to three bytes
 * higher. An earlier version accepted SP + 1..3 only and counted those two
 * JSR bytes as program stores to page 1.
 */
export function isPush(hit: Hit): boolean {
  const reach = 3 + (OWN_PUSHES[hit.mnemonic] ?? 0);
  return hit.addr >> 8 === 1 && (((hit.addr & 0xff) - hit.sp - 1) & 0xff) < reach;
}

/** What one store was, once sorted. */
export type Verdict =
  | "unattributed"
  | "claimed"
  | "harness"
  | "undeclared"
  | "reads_only"
  | "unowned_io"
  | "cpu_port"
  | "kernal_in_may"
  | "kernal_outside_may"
  | "rom_other";

export interface Finding {
  verdict: Verdict;
  source: Source;
  /** A unit name, or "zero page", "RAM", "I/O". */
  target: string;
  /** The range or claimant that allowed it, when one did. */
  by?: string;
}

/** Tally of one (verdict, source, target) group. */
export interface Tally {
  finding: Finding;
  count: number;
  addrs: Map<number, number>;
  pcs: Map<number, number>;
  first: { clock: number; pc: number; insn: string };
}

/**
 * BASIC's READY entry: LDA #$76, LDY #$A3, JSR $AB1E (print "READY."),
 * JSR $FF90 (SETMSG), JMP ($0302); read from basic-901226-01.bin. A
 * program that returns to BASIC comes here, and what BASIC and the KERNAL
 * do next is not the program's: READY's SETMSG call wrote $9D, outside
 * every declared may-set. The program's own code can still run after it
 * (its IRQ, its NMI), so its stores are judged to the end of the run. The
 * address counts as READY only with BASIC ROM mapped in; otherwise it is
 * RAM, and code there is the program's.
 */
export const BASIC_READY = 0xa474;

export interface WatchOptions {
  units: UnitMap;
  screen: ScreenBytes;
  /** Screen RAM base for the sprite pointers, when given. */
  screenBase?: number;
  declared: Declared;
  /** The program's entry; stores before it runs are boot noise. */
  start?: number;
}

/** The units a store to an I/O register touches: bits it changed, or all its unit bits when the value is unknown. */
export function touchedUnits(
  units: UnitMap,
  addr: number,
  value: number | null,
  shadow: number | undefined,
): string[] {
  const owners = units.get(addr) ?? [];
  let changed: number;
  if (value === null) changed = 0xff;
  // $D019: a 1 bit acknowledges that source; the value is the touch.
  else if (addr === 0xd019) changed = value;
  // CIA ICR: bits 0-4 name the sources whose mask bit the write sets
  // (bit 7 = 1) or clears (bit 7 = 0); either way those units are touched.
  else if (addr === 0xdc0d || addr === 0xdd0d) changed = value & 0x1f;
  else if (shadow === undefined) changed = 0xff;
  else changed = value ^ shadow;
  return owners.filter((o) => o.mask === 0xff || (o.mask & changed) !== 0).map((o) => o.unit);
}

/** $D000-$DFFF: I/O when the port banks it in, RAM to a store otherwise. */
const isIoAddr = (addr: number): boolean => addr >= 0xd000 && addr <= 0xdfff;

export class ClaimsWatch {
  readonly port = new CpuPort();
  readonly tallies = new Map<string, Tally>();
  /**
   * Last value written per I/O register, from every store seen (boot
   * included) while I/O was banked in. A store to $D000-$DFFF with I/O
   * banked out goes to RAM and leaves the register alone. An earlier version
   * shadowed it anyway: ifli-image's RAM fill of $DC00-$DFFF under $01 = $34
   * made its next $DD00 store read as a serial_bus change (#79).
   */
  readonly shadow = new Map<number, number>();
  started = false;
  startClock: number | null = null;
  /** When the program returned to BASIC's READY; ROM stores after it are not judged, the program's are. */
  endClock: number | null = null;
  afterExit = 0;
  unknownBanking = 0;
  pushes = 0;
  bootStores = 0;

  private readonly opt: WatchOptions;

  constructor(opt: WatchOptions) {
    this.opt = opt;
  }

  feed(hit: Hit): void {
    if (hit.kind === "exec") {
      this.exec(hit);
      return;
    }
    const value = this.valueOf(hit);
    const source = sourceOf(hit.pc, this.port);
    if (this.endClock !== null && (source === "kernal" || source === "basic")) {
      this.afterExit++;
      this.remember(hit.addr, value);
      return;
    }
    if (!this.started && this.opt.start === undefined && source === "program") this.begin(hit.clock);
    if (!this.started) {
      this.bootStores++;
      this.remember(hit.addr, value);
      return;
    }
    if (isPush(hit)) {
      this.pushes++;
      return;
    }
    if (this.port.bits === null) this.unknownBanking++;
    for (const f of this.classify(hit, source, value)) this.tally(f, hit);
    this.remember(hit.addr, value);
  }

  private exec(hit: Hit): void {
    if (hit.addr === this.opt.start && !this.started) this.begin(hit.clock);
    else if (hit.addr === BASIC_READY && this.started && this.basicMapped()) this.endClock ??= hit.clock;
  }

  /** The byte stored, when the log lets it be known. */
  private valueOf(hit: Hit): number | null {
    const v = storedValue(hit);
    if (v !== null || hit.addr > 1) return v;
    return portRmwValue(hit, this.port.read(hit.addr));
  }

  /** BASIC ROM at $A000: the banking is known and has LORAM and HIRAM set. */
  private basicMapped(): boolean {
    const b = this.port.bits;
    return b !== null && (b & 3) === 3;
  }

  private begin(clock: number): void {
    this.started = true;
    this.startClock = clock;
  }

  private remember(addr: number, value: number | null): void {
    if (addr <= 1) this.port.store(addr, value);
    if (isIoAddr(addr) && !this.port.io) return;
    if (value === null) this.shadow.delete(addr);
    else this.shadow.set(addr, value);
  }

  /** The findings for one store: one per unit touched, or one for the byte. */
  classify(hit: Hit, source: Source, value: number | null): Finding[] {
    // Code in a ROM window with $01 unknown: ROM or the program, the trace cannot say.
    if (source === "unknown")
      return this.classify(hit, "program", value).map((f) => ({
        verdict: "unattributed",
        source,
        target: f.target,
      }));
    const { addr } = hit;
    if (addr <= 1) return [{ verdict: "cpu_port", source, target: "6510 port" }];
    const units = this.unitsAt(addr, value);
    if (units === "io_unowned") return [{ verdict: "unowned_io", source, target: "I/O" }];
    if (units.length > 0) return units.map((u) => this.unitFinding(u, source));
    return [this.ramFinding(addr, source)];
  }

  /** Units at this address; "io_unowned" for an I/O store that touches no unit's bits. */
  private unitsAt(addr: number, value: number | null): string[] | "io_unowned" {
    const io = isIoAddr(addr) && this.port.io;
    // Colour RAM is the program's own memory: judged by --range, like screen RAM.
    if (io && addr >= 0xd800 && addr <= 0xdbff) return [];
    if (io) {
      const got = touchedUnits(this.opt.units, addr, value, this.shadow.get(addr));
      return got.length > 0 ? got : "io_unowned";
    }
    if (isIoAddr(addr)) return [];
    const base = this.opt.screenBase;
    if (base !== undefined) {
      const hit = this.opt.screen.find((s) => base + s.offset === addr);
      if (hit) return [hit.unit];
    }
    return (this.opt.units.get(addr) ?? []).map((o) => o.unit);
  }

  private unitFinding(unit: string, source: Source): Finding {
    if (source !== "program") return { verdict: "rom_other", source, target: unit };
    const verdict = this.opt.declared.unitVerdict(unit);
    if (verdict !== "claimed") return { verdict, source, target: unit };
    const from = [...(this.opt.declared.units.get(unit)?.from ?? [])].join(", ");
    return { verdict, source, target: unit, by: from };
  }

  private ramFinding(addr: number, source: Source): Finding {
    // $D800-$DBFF is colour RAM only with I/O banked in; an earlier version labelled it so always (#79).
    const colour = addr >= 0xd800 && addr <= 0xdbff && this.port.io;
    const target = addr < 0x100 ? "zero page" : colour ? "colour RAM" : "RAM";
    if (source === "kernal" && addr < 0x100) {
      const by = this.opt.declared.kernalMay.get(addr);
      return by
        ? { verdict: "kernal_in_may", source, target, by: by.join(", ") }
        : { verdict: "kernal_outside_may", source, target };
    }
    if (source !== "program") return { verdict: "rom_other", source, target };
    const r = this.opt.declared.ramVerdict(addr);
    return { verdict: r.verdict, source, target, ...(r.by ? { by: r.by } : {}) };
  }

  private tally(f: Finding, hit: Hit): void {
    const key = `${f.verdict}|${f.source}|${f.target}|${f.by ?? ""}`;
    let t = this.tallies.get(key);
    if (!t) {
      t = {
        finding: f,
        count: 0,
        addrs: new Map(),
        pcs: new Map(),
        first: { clock: hit.clock, pc: hit.pc, insn: `${hit.mnemonic} ${hit.operand}`.trim() },
      };
      this.tallies.set(key, t);
    }
    t.count++;
    t.addrs.set(hit.addr, (t.addrs.get(hit.addr) ?? 0) + 1);
    t.pcs.set(hit.pc, (t.pcs.get(hit.pc) ?? 0) + 1);
  }

  /**
   * Violations fail the run: program stores outside the claims, KERNAL
   * zero-page stores outside the may-sets, and stores from a ROM window
   * while $01 is unknown.
   */
  violations(): Tally[] {
    return [...this.tallies.values()].filter((t) =>
      ["undeclared", "reads_only", "kernal_outside_may", "unattributed"].includes(t.finding.verdict),
    );
  }
}

/** Feed one log line; returns the pending head line. A hit is two lines: the head, then the instruction. */
export function feedHit(watch: ClaimsWatch, head: string | null, line: string): string | null {
  if (head !== null) {
    const hit = parseHit(head, line);
    if (hit) watch.feed(hit);
  }
  return line.startsWith("#") ? line : null;
}

/** Feed a whole log. */
export function feedLog(watch: ClaimsWatch, lines: Iterable<string>): void {
  let head: string | null = null;
  for (const line of lines) head = feedHit(watch, head, line);
}

export const pcList = (pcs: Map<number, number>, label: (pc: number) => string, max = 4): string =>
  [...pcs]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([pc, n]) => `${label(pc)}×${n}`)
    .join(" ") + (pcs.size > max ? ` +${pcs.size - max} more` : "");
