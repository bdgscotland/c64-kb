/**
 * The recipe listing scan (#22 step 8): a static read of a recipe's code
 * fences for `sta`, `stx` and `sty` to an address that belongs to a
 * HardwareUnit, set against what the recipe declares. The ingest prints a
 * warning for each unit a listing stores to that no claim covers.
 *
 * It is a static read, so it sees less than the claims watch
 * (scripts/claims-watch.ts), which traces every store in VICE: it cannot
 * see a store through a pointer, a C assignment, or which bits a store
 * changed. It maps only addresses whose every bit belongs to a unit, and an
 * address shared by several units ($DC0D, $DD00, an indexed store) counts
 * as declared when any of them is. $D011, $D016, $D018 and $D019 are left
 * out: most stores to them set a mode bit or acknowledge a flag, which no
 * unit owns, and a static read cannot tell those from a scroll or a
 * raster compare. Zero page is left out too: a recipe's own bytes are its
 * business until two programs are combined, which is what the claims and
 * `c64_check_compatibility` are for.
 */

import { HARDWARE_UNITS, parseClaims, type Claim } from "./claims.ts";
import { parseFrontmatter } from "./extract/common.ts";

const SPRITES = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `sprite_${n}`);
const CIA1 = ["cia1_timer_a", "cia1_timer_b", "cia1_tod"];
const CIA2 = ["cia2_timer_a", "cia2_timer_b", "cia2_tod"];

type Span = { first: number; last: number; units: (addr: number) => string[] };
const one = (unit: string) => (): string[] => [unit];
const span = (first: number, last: number, units: (addr: number) => string[]): Span => ({
  first,
  last,
  units,
});

// Address -> the units a store there may change. Addresses from
// src/graph/claims.ts (the HardwareUnit seed) and c64-registers-reference.md.
const SPANS: readonly Span[] = [
  span(0x0314, 0x0315, one("irq_vector_0314")),
  span(0x0318, 0x0319, one("nmi_vector_0318")),
  span(0xd000, 0xd00f, (a) => [`sprite_${(a - 0xd000) >> 1}`]),
  span(0xd010, 0xd010, () => SPRITES),
  span(0xd012, 0xd012, one("vic_raster_irq")),
  span(0xd015, 0xd015, () => SPRITES),
  span(0xd017, 0xd017, () => SPRITES),
  span(0xd01a, 0xd01a, one("vic_raster_irq")),
  span(0xd01b, 0xd01d, () => SPRITES),
  span(0xd027, 0xd02e, (a) => [`sprite_${a - 0xd027}`]),
  span(0xd400, 0xd406, one("sid_voice_1")),
  span(0xd407, 0xd40d, one("sid_voice_2")),
  span(0xd40e, 0xd414, one("sid_voice_3")),
  span(0xd415, 0xd418, one("sid_filter_volume")),
  span(0xdc00, 0xdc00, one("cia1_port_a")),
  span(0xdc01, 0xdc01, one("cia1_port_b")),
  span(0xdc04, 0xdc05, one("cia1_timer_a")),
  span(0xdc06, 0xdc07, one("cia1_timer_b")),
  span(0xdc08, 0xdc0b, one("cia1_tod")),
  span(0xdc0d, 0xdc0d, () => CIA1),
  span(0xdc0e, 0xdc0e, one("cia1_timer_a")),
  span(0xdc0f, 0xdc0f, one("cia1_timer_b")),
  span(0xdd00, 0xdd00, () => ["cia2_vic_bank", "serial_bus"]),
  span(0xdd01, 0xdd01, one("user_port")),
  span(0xdd04, 0xdd05, one("cia2_timer_a")),
  span(0xdd06, 0xdd07, one("cia2_timer_b")),
  span(0xdd08, 0xdd0b, one("cia2_tod")),
  span(0xdd0d, 0xdd0d, () => CIA2),
  span(0xdd0e, 0xdd0e, one("cia2_timer_a")),
  span(0xdd0f, 0xdd0f, one("cia2_timer_b")),
  span(0xde00, 0xdeff, one("expansion_io1")),
  span(0xdf00, 0xdfff, one("expansion_io2")),
  span(0xfffa, 0xfffb, one("nmi_vector_fffa")),
  span(0xfffe, 0xffff, one("irq_vector_fffe")),
];

const KNOWN_UNITS = new Set(HARDWARE_UNITS.map((u) => u.name));

/** The units a store to `addr` may change; `indexed` widens it to addr..addr+255. */
export function unitsAt(addr: number, indexed = false): string[] {
  const last = indexed ? Math.min(addr + 0xff, 0xffff) : addr;
  const out = new Set<string>();
  for (const s of SPANS) {
    const lo = Math.max(s.first, addr);
    const hi = Math.min(s.last, last);
    for (let a = lo; a <= hi; a++) for (const u of s.units(a)) out.add(u);
  }
  return [...out].filter((u) => KNOWN_UNITS.has(u));
}

export interface ListingStore {
  /** 1-based line in the page. */
  line: number;
  text: string;
  addr: number;
  units: string[];
}

// A KickAssembler or ca65 constant: `.const NAME = $D418`, `.label NAME=$D012`, `NAME = $D418`.
const CONSTANT =
  /^\s*(?:\.(?:const|label|var|eqv?)\s+)?([A-Za-z_][\w]*)\s*=\s*\$([0-9A-Fa-f]{4})\s*(?:\/\/.*|;.*)?$/;
// `sta $d418`, `sta $d000,x`, `stx vic_raster`, `sty base+1,y`; a label before it, `!:` or `name:`.
const STORE =
  /^\s*(?<label>[\w.!]+:\s*)?st(?<reg>[axy])\s+(?<operand>\$[0-9A-Fa-f]{4}|[A-Za-z_]\w*)(?:\s*\+\s*(?<offset>\$?[0-9A-Fa-f]+|\d+))?(?<index>\s*,\s*[xy])?\s*(?:\/\/.*|;.*)?$/i;

/** Every line inside a code fence, with its 1-based line number. */
function fencedLines(content: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  let inside = false;
  content.split("\n").forEach((text, i) => {
    if (text.startsWith("```")) inside = !inside;
    else if (inside) out.push({ n: i + 1, text });
  });
  return out;
}

const parseOffset = (s: string | undefined): number => {
  if (s === undefined) return 0;
  return s.startsWith("$") ? parseInt(s.slice(1), 16) : parseInt(s, 10);
};

// `lda #$7f`, `ldx #0`: the value the next store of that register writes.
const IMMEDIATE = /^\s*(?:[\w.!]+:\s*)?ld([axy])\s+#\$?([0-9A-Fa-f]+)\b/i;
const COMMENT_OR_BLANK = /^\s*(?:\/\/.*|;.*)?$/;

/**
 * 0 to $D015, every sprite off. Not counted: the claims watch judges a
 * $D015 store by the bits it changed, and a static read cannot know the
 * bits before it. Two recipes whose claims the watch passes store it this
 * way (#22 step 8). A mask write to $DC0D or $DD0D is counted: the watch
 * counts it as touching each source in bits 0-4, whatever bit 7 says, and
 * the convention makes it `init` on those units.
 */
function switchesOff(addr: number, value: number | undefined): boolean {
  return addr === 0xd015 && value === 0;
}

/**
 * The units one store may change. An indexed store widens to the 256
 * bytes after its base, but only from a base some unit owns (`sta $d000,x`),
 * never from one that merely reaches a unit (`sta buffer+$3f00,x`). A store
 * to $FFFF that is indexed, or carries its own label (`dst: sta $ffff`), is
 * a self-modified placeholder, not the IRQ vector.
 */
function storeUnits(addr: number, store: { indexed: boolean; labelled: boolean }): string[] {
  if (addr === 0xffff && store.labelled) return [];
  if (!store.indexed) return unitsAt(addr);
  if (addr >= 0xff00 || unitsAt(addr).length === 0) return [];
  return unitsAt(addr, true);
}

/** KickAssembler and ca65 constants set to a 16-bit address. */
function constantsOf(lines: readonly { text: string }[]): Map<string, number> {
  const constants = new Map<string, number>();
  for (const { text } of lines) {
    const m = CONSTANT.exec(text);
    if (m?.[1] && m[2]) constants.set(m[1], parseInt(m[2], 16));
  }
  return constants;
}

type Loaded = { reg: string; value: number } | null;

/** One line's store to a unit, given the immediate the line before it loaded. */
function storeOn(
  text: string,
  constants: ReadonlyMap<string, number>,
  before: Loaded,
): Omit<ListingStore, "line"> | null {
  const g = STORE.exec(text)?.groups;
  if (!g?.operand || !g.reg) return null;
  const base = g.operand.startsWith("$") ? parseInt(g.operand.slice(1), 16) : constants.get(g.operand);
  if (base === undefined) return null;
  const addr = base + parseOffset(g.offset);
  const value = before?.reg === g.reg.toLowerCase() ? before.value : undefined;
  if (switchesOff(addr, value)) return null;
  const units = storeUnits(addr, { indexed: g.index !== undefined, labelled: g.label !== undefined });
  return units.length > 0 ? { text: text.trim(), addr, units } : null;
}

/** Stores in the page's code fences to an address some HardwareUnit owns. */
export function listingStores(content: string): ListingStore[] {
  const lines = fencedLines(content);
  const constants = constantsOf(lines);
  const out: ListingStore[] = [];
  let loaded: Loaded = null;
  for (const { n, text } of lines) {
    if (COMMENT_OR_BLANK.test(text)) continue;
    const store = storeOn(text, constants, loaded);
    if (store) out.push({ line: n, ...store });
    const imm = IMMEDIATE.exec(text);
    loaded = imm?.[1] && imm[2] ? { reg: imm[1].toLowerCase(), value: parseInt(imm[2], 16) } : null;
  }
  return out;
}

export interface Declared {
  /** Units a claim covers for a store: any mode but `reads`, which forbids one. */
  units: ReadonlySet<string>;
}

export interface TechniqueClaimSet {
  /** null: the page has no settled Claims line. */
  claims: readonly Pick<Claim, "unit" | "mode">[] | null;
  requires: readonly string[];
}

/** The unit words of a `harness:` value; address ranges in it are RAM, not units. */
export function harnessUnits(raw: string | undefined): string[] {
  const items = (raw ?? "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-z]/.test(s) && !s.includes("="));
  return items.flatMap((i) => {
    const c = parseClaims(i);
    return "error" in c ? [] : c.map((x) => x.unit);
  });
}

/**
 * What a recipe may store to: its own claims, its harness units, and the
 * claims of its techniques and every technique they REQUIRE. `unknown`
 * names the techniques in that closure with no Claims line.
 */
export function declaredFor(
  recipe: {
    techniques: readonly string[];
    claims: readonly Pick<Claim, "unit" | "mode">[];
    harness: readonly string[];
  },
  techniques: ReadonlyMap<string, TechniqueClaimSet>,
): Declared & { unknown: string[] } {
  const units = new Set<string>(recipe.harness);
  const add = (cs: readonly Pick<Claim, "unit" | "mode">[]) => {
    for (const c of cs) if (c.mode !== "reads") units.add(c.unit);
  };
  add(recipe.claims);
  const seen = new Set<string>();
  const unknown: string[] = [];
  const visit = (t: string) => {
    if (seen.has(t)) return;
    seen.add(t);
    const set = techniques.get(t);
    if (!set?.claims) unknown.push(t);
    else add(set.claims);
    for (const r of set?.requires ?? []) visit(r);
  };
  recipe.techniques.forEach(visit);
  return { units, unknown };
}

export interface UndeclaredStore {
  units: string[];
  lines: number[];
  first: string;
}

/** Stores no declared unit covers, grouped by their unit set, in line order. */
export function undeclaredStores(stores: readonly ListingStore[], declared: Declared): UndeclaredStore[] {
  const byUnits = new Map<string, UndeclaredStore>();
  for (const s of stores) {
    if (s.units.some((u) => declared.units.has(u))) continue;
    const key = s.units.join(",");
    const hit = byUnits.get(key) ?? { units: s.units, lines: [], first: s.text };
    hit.lines.push(s.line);
    byUnits.set(key, hit);
  }
  return [...byUnits.values()];
}

/** One warning line per undeclared unit set. */
function describeUndeclared(recipe: string, sourcePath: string, u: UndeclaredStore): string {
  const units = u.units.length > 3 ? `${u.units.slice(0, 3).join(", ")} or another` : u.units.join(" or ");
  const lines =
    u.lines.length > 4 ? `${u.lines.slice(0, 4).join(", ")} +${u.lines.length - 4}` : u.lines.join(", ");
  return `${sourcePath}: recipe ${recipe} stores to ${units} (line ${lines}: \`${u.first}\`), which neither its claims:, its harness: nor its techniques' Claims lines declare`;
}

const flowList = (v: string | undefined): string[] =>
  (v ?? "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

/**
 * The scan of one recipe page: its warning lines, empty when every store
 * to a unit is declared or the page is not a recipe. A `claims:` value the
 * extractor refuses counts as no claims here; the extractor warns about it.
 */
export function scanRecipePage(
  content: string,
  sourcePath: string,
  techniques: ReadonlyMap<string, TechniqueClaimSet>,
): string[] {
  const { fm } = parseFrontmatter(content);
  if (!fm.recipe || !fm.toolchain) return [];
  const stores = listingStores(content);
  if (stores.length === 0) return [];
  const raw = flowList(fm.claims).join(", ");
  const parsed = raw === "" ? [] : parseClaims(raw);
  const declared = declaredFor(
    {
      techniques: flowList(fm.techniques),
      claims: "error" in parsed ? [] : parsed,
      harness: harnessUnits(fm.harness),
    },
    techniques,
  );
  const tail = declared.unknown.length > 0 ? ` (no Claims line: ${declared.unknown.join(", ")})` : "";
  return undeclaredStores(stores, declared).map(
    (u) => describeUndeclared(`${fm.toolchain}-${fm.recipe}`, sourcePath, u) + tail,
  );
}
