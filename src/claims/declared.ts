/**
 * What a program declares it may write: units from its techniques' Claims
 * lines and from explicit claims, its own RAM ranges, the harness it runs
 * under, and the KERNAL routines it calls (whose may-sets bound what the
 * ROM may write to zero page on its behalf).
 */
import { parseClaims, zeroPageRangesFromCanonical, type Claim, type ClaimMode } from "../graph/claims.ts";
import { hex2, parseRanges, rangeHolding, rangeText, type NamedRange } from "./units.ts";

export interface UnitClaim {
  modes: Set<ClaimMode>;
  /** Who claimed it: a technique id, "--claim", a recipe path. */
  from: Set<string>;
}

export type UnitVerdict = "harness" | "claimed" | "reads_only" | "undeclared";

export class Declared {
  readonly units = new Map<string, UnitClaim>();
  /** Zero-page bytes claimed, each range named after the claimant. */
  readonly zeroPage: NamedRange[] = [];
  /** The program's own RAM: code, data, BSS, screen, colour RAM, charset, sprites. */
  readonly ranges: NamedRange[] = [];
  readonly harnessUnits = new Set<string>();
  readonly harnessRanges: NamedRange[] = [];
  /** Zero-page byte -> the KERNAL routines (or services) whose may-set holds it. */
  readonly kernalMay = new Map<number, string[]>();
  readonly kernalRoutines: string[] = [];

  addClaims(claims: readonly Claim[], from: string): void {
    for (const c of claims) {
      if (c.unit === "zero_page") {
        for (const [first, last] of zeroPageRangesFromCanonical(c.ranges ?? ""))
          this.zeroPage.push({ name: from, first, last });
        continue;
      }
      const u = this.units.get(c.unit) ?? { modes: new Set<ClaimMode>(), from: new Set<string>() };
      u.modes.add(c.mode);
      u.from.add(from);
      this.units.set(c.unit, u);
    }
  }

  /** A --claim value in the Claims-line grammar. */
  addClaimText(raw: string, from: string): string | null {
    const parsed = parseClaims(raw);
    if ("error" in parsed) return parsed.error;
    this.addClaims(parsed, from);
    return null;
  }

  /** A --harness value: unit names, unit ranges (sprite_0-7), `zero_page $XX-$YY`, or address ranges. */
  addHarness(raw: string): string | null {
    for (const item of raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      const err =
        /^[a-z]/.test(item) && !item.includes("=") ? this.harnessUnit(item) : this.harnessRange(item);
      if (err) return err;
    }
    return null;
  }

  private harnessUnit(item: string): string | null {
    const parsed = parseClaims(item);
    if ("error" in parsed) return parsed.error;
    for (const c of parsed) {
      if (c.unit !== "zero_page") this.harnessUnits.add(c.unit);
      for (const [first, last] of zeroPageRangesFromCanonical(c.ranges ?? ""))
        this.harnessRanges.push({ name: "harness", first, last });
    }
    return null;
  }

  private harnessRange(item: string): string | null {
    const r = parseRanges(item);
    if ("error" in r) return r.error;
    this.harnessRanges.push(...r);
    return null;
  }

  /**
   * A recipe's `ram:` value: its own RAM outside the PRG's load span, as
   * --range ranges. Zero page is refused: it is a unit, claimed in `claims:`
   * as `zero_page $XX-$YY`, so the compatibility check can see it.
   */
  addRam(raw: string): string | null {
    const r = parseRanges(raw);
    if ("error" in r) return r.error;
    const zp = r.find((x) => x.first < 0x100);
    if (zp) return `${rangeText(zp.first, zp.last)} is zero page: claim it as zero_page in claims:`;
    this.ranges.push(...r);
    return null;
  }

  addKernal(routine: string, bytes: readonly [number, number][]): void {
    this.kernalRoutines.push(routine);
    for (const [first, last] of bytes)
      for (let b = first; b <= last; b++) this.kernalMay.set(b, [...(this.kernalMay.get(b) ?? []), routine]);
  }

  /** May the program write this unit? Harness first, then claims; `reads` alone forbids a store. */
  unitVerdict(unit: string): UnitVerdict {
    if (this.harnessUnits.has(unit)) return "harness";
    const c = this.units.get(unit);
    if (!c) return "undeclared";
    return [...c.modes].some((m) => m !== "reads") ? "claimed" : "reads_only";
  }

  /** May the program write this RAM byte (zero page included)? */
  ramVerdict(addr: number): { verdict: "harness" | "claimed" | "undeclared"; by?: string } {
    const h = rangeHolding(this.harnessRanges, addr);
    if (h) return { verdict: "harness", by: h.name };
    const z = addr < 0x100 ? rangeHolding(this.zeroPage, addr) : undefined;
    if (z) return { verdict: "claimed", by: `zero_page (${z.name})` };
    const r = rangeHolding(this.ranges, addr);
    if (r) return { verdict: "claimed", by: r.name };
    return { verdict: "undeclared" };
  }

  /** One line per claim, for the report's header. */
  describe(): string[] {
    const out: string[] = [];
    for (const [unit, c] of [...this.units].sort((a, b) => a[0].localeCompare(b[0])))
      out.push(`${unit} (${[...c.modes].join(", ")}) from ${[...c.from].join(", ")}`);
    for (const z of this.zeroPage)
      out.push(
        `zero_page ${z.first === z.last ? hex2(z.first) : `${hex2(z.first)}-${hex2(z.last)}`} from ${z.name}`,
      );
    for (const r of this.ranges) out.push(`RAM ${r.name} ${rangeText(r.first, r.last)}`);
    for (const u of this.harnessUnits) out.push(`harness ${u}`);
    for (const r of this.harnessRanges) out.push(`harness ${rangeText(r.first, r.last)}`);
    return out;
  }
}
