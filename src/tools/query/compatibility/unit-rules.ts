// Unit-claim rules for check_compatibility (schema 25). Pure: the caller
// reads the CLAIMS edges and the REQUIRES relation from the graph and passes
// them in, so the rules can be tested without a graph.
//
// Two claims on one HardwareUnit are set against each other by mode:
//   owns × owns       unit_contention (hard); zero page: zero_page_overlap,
//                     soft when a side is relocatable
//   owns × shares     unit_shared (soft), the sharer follows the owner
//   shares × shares   unit_shared (soft), both follow an owner
//   owns × reads      unit_read_while_driven (soft)
//   init × owns/shares init_order (info)
// A technique and its own prerequisite hold units together by design, so
// between them the ownership rules do not run, and neither does unit_shared
// when the one that requires the other is the owner (fli_image runs the
// stable raster IRQ it requires inside its own handler). unit_shared still
// runs when the sharer requires the owner: sfx_engine_beside_music requires
// the player and must still be told to write after it.

import { parseRasterBand, rasterBandsOverlap } from "../../../graph/extract.ts";
import {
  zeroPageRangesFromCanonical,
  formatZeroPageRanges,
  type Claim,
  type ClaimMode,
} from "../../../graph/claims.ts";

type UnitRuleKind =
  "unit_contention" | "zero_page_overlap" | "unit_shared" | "unit_read_while_driven" | "init_order";
type Severity = "hard" | "soft" | "info";

export interface UnitHit {
  kind: UnitRuleKind;
  severity: Severity;
  shared: string[];
  rationale: string;
  resolution: string;
}

export interface ClaimSide {
  name: string;
  claims: readonly Claim[];
  /** The raster band, stated or placed (#90); read for the raster compare only. */
  band?: string | null;
}

/** Which of the pair, if either, names the other on its REQUIRES chain. */
export interface PairRelation {
  aRequiresB: boolean;
  bRequiresA: boolean;
  /** The check's set holds the chain host (irq_chain_table), inputs or prerequisites. */
  chainHosted?: boolean;
}

// The technique that hosts other raster effects as entries in its table.
export const CHAIN_HOST = "irq_chain_table";

type Chained = "host" | "bands" | null;

/**
 * Why two owners of the raster compare can share it, or null when nothing
 * says they can. "host": the chain host is in the set, programs $D012 and
 * each owner's handler becomes one of its entries, which is the resolution
 * the hard hit gives; reported soft, so following that resolution does not
 * make the verdict worse (#41: adding irq_chain_table to raster_bars +
 * raster_split_modes turned one hard conflict into three). "bands": both
 * run on stated or placed line bands that share no line (#90), so one
 * compare serves both as a chain in which each handler arms the next one's
 * line; kickassembler-one-part-demo and kickassembler-fli-music-scroller
 * run their owners so. A band that is absent or movable says nothing.
 */
function chainedRasterIrq(a: ClaimSide, b: ClaimSide, rel: PairRelation, unit: string): Chained {
  if (unit !== "vic_raster_irq") return null;
  if (a.name === CHAIN_HOST || b.name === CHAIN_HOST || (rel.chainHosted ?? false)) return "host";
  return disjointLines(a.band, b.band) ? "bands" : null;
}

function lineRanges(band: string | null | undefined): [number, number][] | null {
  const p = parseRasterBand(band ?? "");
  return "error" in p || p.kind !== "lines" ? null : p.ranges;
}

function disjointLines(a: string | null | undefined, b: string | null | undefined): boolean {
  const ra = lineRanges(a);
  const rb = lineRanges(b);
  return ra !== null && rb !== null && !rasterBandsOverlap(ra, rb);
}

interface Entry {
  kind: UnitRuleKind;
  severity: Severity;
  /** unit_contention on the raster compare only: why it is soft. */
  chained?: Chained;
  first: ClaimSide;
  second: ClaimSide;
  units: string[];
  relocatable: string[];
  bothShare: boolean;
}

type Match = Omit<Entry, "units" | "relocatable"> & { unit: string; relocatable?: string[] };

/** Bytes two canonical zero-page range strings ("02-0D,24-2F") share. */
function zeroPageOverlap(a: string, b: string): [number, number][] {
  const rb = zeroPageRangesFromCanonical(b);
  const out: [number, number][] = [];
  for (const [a0, a1] of zeroPageRangesFromCanonical(a)) {
    for (const [b0, b1] of rb) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (lo <= hi) out.push([lo, hi]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** sprite_0, sprite_1, ... sprite_7 -> sprite_0-7, for the conflict text. */
export function compressUnits(units: string[]): string[] {
  const out: string[] = [];
  const sorted = [...new Set(units)].sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
  for (let i = 0; i < sorted.length; i++) {
    const name = sorted[i] ?? "";
    const m = /^(.*_)(\d+)$/.exec(name);
    if (!m) {
      out.push(name);
      continue;
    }
    const [, stem = "", num = "0"] = m;
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === `${stem}${Number(num) + (j + 1 - i)}`) j++;
    out.push(j > i ? `${name}-${Number(num) + (j - i)}` : name);
    i = j;
  }
  return out;
}

/** One claim from each side on the same unit, and how the two sides relate. */
interface Pair {
  ca: Claim;
  cb: Claim;
  a: ClaimSide;
  b: ClaimSide;
  rel: PairRelation;
  // The unit as the text names it; for zero page, the bytes both sides use.
  unit: string;
}

/** The unit two claims meet on, or null when they do not (different units, disjoint zero-page bytes). */
function meetingUnit(ca: Claim, cb: Claim): string | null {
  if (ca.unit !== cb.unit) return null;
  if (ca.unit !== "zero_page") return ca.unit;
  const bytes = zeroPageOverlap(ca.ranges ?? "", cb.ranges ?? "");
  if (bytes.length === 0) return null;
  return `zero_page $${formatZeroPageRanges(bytes).replace(/,/g, ",$").replace(/-/g, "-$")}`;
}

/** Two owners of the same zero-page bytes: hard, soft when a side can be relocated. */
function matchZeroPage({ ca, cb, a, b, unit }: Pair): Match {
  const relocatable = [ca.relocatable ? a.name : null, cb.relocatable ? b.name : null].filter(
    (x): x is string => x !== null,
  );
  return {
    kind: "zero_page_overlap",
    severity: relocatable.length > 0 ? "soft" : "hard",
    first: a,
    second: b,
    unit,
    relocatable,
    bothShare: false,
  };
}

/** Two owners of one unit; nothing between a technique and its own prerequisite. */
function matchOwners(p: Pair): Match | null {
  const { a, b, rel, unit } = p;
  if (rel.aRequiresB || rel.bRequiresA) return null;
  if (p.ca.unit === "zero_page") return matchZeroPage(p);
  const chained = chainedRasterIrq(a, b, rel, unit);
  const severity = chained ? "soft" : "hard";
  const how = chained ? { chained } : {};
  return { unit, bothShare: false, kind: "unit_contention", severity, first: a, second: b, ...how };
}

/** The rule two modes on one unit fire, with the pair ordered as its text reads. */
function matchModes(p: Pair): Match | null {
  const { ca, cb, a, b, rel, unit } = p;
  const related = rel.aRequiresB || rel.bRequiresA;
  const is = (x: ClaimMode, y: ClaimMode) => ca.mode === x && cb.mode === y;
  const has = (x: ClaimMode, y: ClaimMode) => is(x, y) || is(y, x);
  // [first, second]: the side holding firstMode first.
  const order = (firstMode: ClaimMode) =>
    ca.mode === firstMode ? { first: a, second: b } : { first: b, second: a };
  const base = { unit, bothShare: false };
  if (has("owns", "owns")) return matchOwners(p);
  if (has("owns", "shares")) {
    const o = order("owns");
    const ownerRequiresSharer = o.first === a ? rel.aRequiresB : rel.bRequiresA;
    if (ownerRequiresSharer) return null;
    return { ...base, kind: "unit_shared", severity: "soft", ...o };
  }
  if (has("shares", "shares")) {
    if (related) return null;
    return { ...base, kind: "unit_shared", severity: "soft", first: a, second: b, bothShare: true };
  }
  if (has("owns", "reads"))
    return { ...base, kind: "unit_read_while_driven", severity: "soft", ...order("owns") };
  if (has("init", "owns") || has("init", "shares"))
    return { ...base, kind: "init_order", severity: "info", ...order("init") };
  return null;
}

/** File a match under its rule and ordered pair, so one hit lists every unit it covers. */
function addMatch(byKey: Map<string, Entry>, m: Match): void {
  const key = `${m.kind}|${m.severity}|${m.first.name}|${m.second.name}|${m.bothShare}|${m.chained ?? ""}`;
  let e = byKey.get(key);
  if (!e) {
    e = { ...m, units: [], relocatable: [] };
    byKey.set(key, e);
  }
  e.units.push(m.unit);
  for (const r of m.relocatable ?? []) if (!e.relocatable.includes(r)) e.relocatable.push(r);
}

function collect(a: ClaimSide, b: ClaimSide, rel: PairRelation): Entry[] {
  const byKey = new Map<string, Entry>();
  for (const ca of a.claims) {
    for (const cb of b.claims) {
      const unit = meetingUnit(ca, cb);
      const m = unit === null ? null : matchModes({ ca, cb, a, b, rel, unit });
      if (m) addMatch(byKey, m);
    }
  }
  return [...byKey.values()];
}

function contentionText(e: Entry, list: string): Pick<UnitHit, "rationale" | "resolution"> {
  const { first, second } = e;
  const rationale = `Both ${first.name} and ${second.name} own ${list}: each writes or holds it every frame and expects no one else to.`;
  const others = e.units.length > 1;
  if (e.units.includes("vic_raster_irq")) {
    const host = [first.name, second.name].find((n) => n === CHAIN_HOST);
    const guest = host === first.name ? second.name : first.name;
    const rest = others ? "; for the other units, give one technique different ones" : "";
    // Soft only when the chain host is in the set or the bands are disjoint (chainedRasterIrq).
    if (e.chained === "bands")
      return {
        rationale: `Both ${first.name} and ${second.name} own ${list}: each arms the one raster compare for its own lines.`,
        resolution: bandChainResolution(e, rest),
      };
    const hostedPair = !host && e.chained === "host";
    let resolution = `There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it${others ? "; for the other units, give one technique different ones (another sprite range, another voice)" : ""}.`;
    if (host)
      resolution = `${host} is the host: rewrite ${guest}'s raster handler(s) as entries in ${host}'s table, so the table alone programs $D012 and ${guest} runs inside it${rest}.`;
    else if (hostedPair)
      resolution = `${CHAIN_HOST} is in the set: rewrite both raster handlers as entries in its table, so the table alone programs $D012.`;
    return { rationale, resolution };
  }
  if (e.units.some((u) => VIC_FIELDS.has(u))) return { rationale, resolution: vicFieldResolution(e) };
  return {
    rationale,
    resolution: `Give one of them other units (another sprite range, another SID voice), or rewrite one to share the unit under the other's protocol.`,
  };
}

function bandChainResolution(e: Entry, rest: string): string {
  const { first, second } = e;
  return `Their lines do not meet (${first.name} ${first.band ?? ""}, ${second.name} ${second.band ?? ""}), so one raster compare serves both: chain the handlers, each arming the next one's line (a ring of handlers, or ${CHAIN_HOST}'s table), so that one setup programs $D012. A handler that runs past the next one's line delays that interrupt${rest}.`;
}

// The VIC scroll and pointer fields (#71): one of each, so no technique can
// be given "another" one.
const VIC_FIELDS: ReadonlySet<string> = new Set([
  "vic_yscroll",
  "vic_xscroll",
  "vic_matrix_base",
  "vic_char_base",
]);

function vicFieldResolution(e: Entry): string {
  const { first, second } = e;
  const others = e.units.some((u) => !VIC_FIELDS.has(u))
    ? " For the other units, give one technique different ones."
    : "";
  return `The VIC has one of each field. Keep one owner: ${first.name} or ${second.name} sets the field for the frame, and the other writes it only on its own lines, from the owner's value, and restores it after (as scroll_panel_split does below a scrolling playfield). Two techniques that both set it on the same lines cannot run together.${others}`;
}

function zeroPageText(e: Entry, list: string): Pick<UnitHit, "rationale" | "resolution"> {
  const reloc = e.relocatable;
  return {
    rationale: `${e.first.name} and ${e.second.name} both own ${list}.${reloc.length > 0 ? ` ${reloc.join(" and ")} can be relocated, so this is soft.` : ""}`,
    resolution:
      reloc.length > 0
        ? `Rebuild ${reloc[0]} with its zero-page base moved off these bytes (its page names the build option).`
        : `Move one side's zero-page variables to bytes the other does not use.`,
  };
}

function sharedText(e: Entry, list: string): Pick<UnitHit, "rationale" | "resolution"> {
  const first = e.first.name;
  const second = e.second.name;
  if (e.bothShare) {
    return e.units.includes("vic_raster_irq")
      ? {
          rationale: `${first} and ${second} both run on the one raster compare, as entries in a handler chain someone else owns.`,
          resolution: `Put both in one interrupt chain, in the order its owner sets. With no raster effect in the set, the program's own chain is that owner.`,
        }
      : {
          rationale: `${first} and ${second} both write ${list} under an owner's protocol.`,
          resolution: `Both must follow the owner's protocol, and in an order the owner sets: one after the other in the frame, or as successive entries in one interrupt chain.`,
        };
  }
  // $DD00 holds the VIC bank bits and the serial lines. A resident loader
  // that owns the bus rewrites the bank bits with the value it was given;
  // a raw $DD00 write while it is armed corrupts its bus lock.
  const loader =
    e.units.includes("cia2_vic_bank") &&
    e.second.claims.some((c) => c.unit === "serial_bus" && c.mode === "owns");
  if (loader) {
    return {
      rationale: `${first} sets the VIC bank bits in $DD00; ${second} drives the serial lines in the same register while it is resident and rewrites the bank bits with the value it was given.`,
      resolution: `${first} must not write $DD00 while ${second} is resident: pass the bank through the loader's API (Krill: SET_VIC_BANK, or its bus lock), or install the loader only around loads and set the bank again after uninstalling it.`,
    };
  }
  if (e.units.includes("vic_raster_irq")) {
    return {
      rationale: `${first} owns the raster compare; ${second} runs inside ${first}'s raster interrupt and does not arm $D012 on its own.`,
      resolution: `Run ${second} as the entry of ${first}'s handler or as one more entry in ${first}'s chain, not as a second interrupt setup.`,
    };
  }
  return {
    rationale: `${first} owns ${list}; ${second} writes it under ${first}'s protocol.`,
    resolution: `${second} must follow ${first}'s protocol: write after ${first}'s write in the frame, or run inside ${first}'s interrupt chain.`,
  };
}

function render(e: Entry): UnitHit {
  const shared = compressUnits(e.units);
  const list = shared.join(", ");
  const first = e.first.name;
  const second = e.second.name;
  let text: Pick<UnitHit, "rationale" | "resolution">;
  switch (e.kind) {
    case "unit_contention":
      text = contentionText(e, list);
      break;
    case "zero_page_overlap":
      text = zeroPageText(e, list);
      break;
    case "unit_shared":
      text = sharedText(e, list);
      break;
    case "unit_read_while_driven":
      text = {
        rationale: `${second} reads ${list}, which ${first} drives; what ${second} reads depends on ${first}'s writes.`,
        resolution: e.units.includes("cia1_port_a")
          ? `Read where ${first} has left the port in a known state: after a keyboard scan, restore $DC00 before reading the joystick.`
          : `Read at a point in the frame where ${first} has left the unit in a known state.`,
      };
      break;
    case "init_order":
      text = {
        rationale: `${first} uses ${list} once at start-up; ${second} then uses it every frame.`,
        resolution: `Run ${first}'s use before ${second} starts.`,
      };
      break;
  }
  return { kind: e.kind, severity: e.severity, shared, ...text };
}

/** The unit rules between two techniques' claim sets. */
export function unitRules(a: ClaimSide, b: ClaimSide, rel: PairRelation): UnitHit[] {
  return collect(a, b, rel).map(render);
}

/**
 * A prerequisite reached from an input technique, seen from that input: its
 * claims on units the input itself owns or shares are dropped, because it
 * uses them inside the input (fli_image's stable raster IRQ is fli_image's
 * handler). The input's own pair with the other technique reports the unit.
 */
export function absorbInto(implied: ClaimSide, input: ClaimSide): ClaimSide {
  const held = new Set(
    input.claims.filter((c) => c.mode === "owns" || c.mode === "shares").map((c) => c.unit),
  );
  // Zero page is kept: bytes are checked one by one, not as a whole unit.
  return {
    name: implied.name,
    band: implied.band ?? null,
    claims: implied.claims.filter((c) => c.unit === "zero_page" || !held.has(c.unit)),
  };
}
