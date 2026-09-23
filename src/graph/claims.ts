// Resource claims (schema 25): the HardwareUnit seeds and the grammar of a
// technique's **Claims:** line (docs/CONVENTIONS-techniques.md). extract.ts
// re-exports all of it; the extractor reads the line, the ingest seeds the
// units, check_compatibility sets two claims on one unit against each other.

export type HardwareUnitKind =
  | "sid_voice"
  | "sid_shared"
  | "sprite"
  | "timer"
  | "tod"
  | "port"
  | "bus"
  | "irq_source"
  | "vector"
  | "io_page"
  | "zero_page";
export type HardwareUnit = { name: string; kind: HardwareUnitKind; addresses: string; chip?: string };

const spriteUnit = (n: number): HardwareUnit => ({
  name: `sprite_${n}`,
  kind: "sprite",
  addresses: `$${(0xd000 + 2 * n).toString(16).toUpperCase()}-$${(0xd001 + 2 * n).toString(16).toUpperCase()}, $${(0xd027 + n).toString(16).toUpperCase()}, bit ${n} of $D010/$D015/$D017/$D01B-$D01D, pointer at screen+$${(0x3f8 + n).toString(16).toUpperCase()}`,
  chip: "VIC-II",
});

// The seed. Addresses from docs/hardware/c64-registers-reference.md and
// docs/techniques/input.md (CIA1 ports). Keep in step with docs/ONTOLOGY.md.
export const HARDWARE_UNITS: readonly HardwareUnit[] = [
  { name: "sid_voice_1", kind: "sid_voice", addresses: "$D400-$D406", chip: "SID" },
  { name: "sid_voice_2", kind: "sid_voice", addresses: "$D407-$D40D", chip: "SID" },
  { name: "sid_voice_3", kind: "sid_voice", addresses: "$D40E-$D414", chip: "SID" },
  { name: "sid_filter_volume", kind: "sid_shared", addresses: "$D415-$D418", chip: "SID" },
  { name: "sid_voice_3_readback", kind: "sid_shared", addresses: "$D41B-$D41C", chip: "SID" },
  { name: "sid_pots", kind: "port", addresses: "$D419-$D41A", chip: "SID" },
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(spriteUnit),
  { name: "cia1_timer_a", kind: "timer", addresses: "$DC04-$DC05, $DC0E", chip: "CIA1" },
  { name: "cia1_timer_b", kind: "timer", addresses: "$DC06-$DC07, $DC0F", chip: "CIA1" },
  { name: "cia2_timer_a", kind: "timer", addresses: "$DD04-$DD05, $DD0E", chip: "CIA2" },
  { name: "cia2_timer_b", kind: "timer", addresses: "$DD06-$DD07, $DD0F", chip: "CIA2" },
  { name: "cia1_tod", kind: "tod", addresses: "$DC08-$DC0B", chip: "CIA1" },
  { name: "cia2_tod", kind: "tod", addresses: "$DD08-$DD0B", chip: "CIA2" },
  {
    name: "cia1_port_a",
    kind: "port",
    addresses: "$DC00 (keyboard column drive, control port 2, POT select)",
    chip: "CIA1",
  },
  { name: "cia1_port_b", kind: "port", addresses: "$DC01 (keyboard rows, control port 1)", chip: "CIA1" },
  { name: "cia2_vic_bank", kind: "port", addresses: "$DD00 bits 0-1", chip: "CIA2" },
  { name: "serial_bus", kind: "bus", addresses: "$DD00 bits 3-7 and the drive", chip: "CIA2" },
  { name: "user_port", kind: "port", addresses: "$DD01", chip: "CIA2" },
  {
    name: "vic_raster_irq",
    kind: "irq_source",
    addresses: "$D012, $D011 bit 7, $D019/$D01A bit 0",
    chip: "VIC-II",
  },
  { name: "irq_vector_0314", kind: "vector", addresses: "$0314-$0315", chip: "6510" },
  { name: "irq_vector_fffe", kind: "vector", addresses: "$FFFE-$FFFF", chip: "6510" },
  { name: "nmi_vector_0318", kind: "vector", addresses: "$0318-$0319", chip: "6510" },
  { name: "nmi_vector_fffa", kind: "vector", addresses: "$FFFA-$FFFB", chip: "6510" },
  { name: "expansion_io1", kind: "io_page", addresses: "$DE00-$DEFF" },
  { name: "expansion_io2", kind: "io_page", addresses: "$DF00-$DFFF" },
  { name: "zero_page", kind: "zero_page", addresses: "$02-$FF", chip: "6510" },
];
const HARDWARE_UNIT_NAMES: ReadonlySet<string> = new Set(HARDWARE_UNITS.map((u) => u.name));

export const CLAIM_MODES = ["owns", "shares", "reads", "init"] as const;
export type ClaimMode = (typeof CLAIM_MODES)[number];
export const CLAIMS_BASIS_WORDS = ["measured-vice", "derived-listing", "estimated"] as const;
export type ClaimsBasis = (typeof CLAIMS_BASIS_WORDS)[number];

export type Claim = { unit: string; mode: ClaimMode; ranges?: string; relocatable?: boolean };

/** Parse zero-page byte ranges written `$02-$0D+$24-$2F` into merged [first, last] pairs. */
export function parseZeroPageRanges(raw: string): [number, number][] | { error: string } {
  const out: [number, number][] = [];
  for (const part of raw.split("+").map((s) => s.trim())) {
    const m = /^\$([0-9A-Fa-f]{2})(?:\s*-\s*\$([0-9A-Fa-f]{2}))?$/.exec(part);
    if (!m) return { error: `"${part}" is not a zero-page byte $XX or range $XX-$YY` };
    const first = parseInt(m[1], 16);
    const last = m[2] ? parseInt(m[2], 16) : first;
    if (first > last) return { error: `range ${part} runs backwards` };
    if (first < 0x02) return { error: `${part} includes $00-$01, the 6510 port, which is not zero-page RAM` };
    out.push([first, last]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const prev = merged.at(-1);
    if (prev && r[0] <= prev[1] + 1) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, "0");
/** Canonical form stored on a CLAIMS edge: "02-0D,24-2F", a single byte as "B7". */
export function formatZeroPageRanges(ranges: [number, number][]): string {
  return ranges.map(([a, b]) => (a === b ? hex2(a) : `${hex2(a)}-${hex2(b)}`)).join(",");
}
/** Inverse of formatZeroPageRanges; returns [] for anything malformed. */
export function zeroPageRangesFromCanonical(canonical: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of canonical.split(",").filter((s) => s !== "")) {
    const m = /^([0-9A-F]{2})(?:-([0-9A-F]{2}))?$/i.exec(part);
    if (!m) return [];
    out.push([parseInt(m[1], 16), parseInt(m[2] || m[1], 16)]);
  }
  return out;
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

type ClaimItem = { units: string[]; addr: string | undefined; mode: ClaimMode; relocatable: boolean };

/** The words inside an item's parentheses: one mode at most, and "relocatable". */
function parseModifiers(
  item: string,
  mods: string,
): { mode: ClaimMode; relocatable: boolean } | { error: string } {
  let mode: ClaimMode | undefined;
  let relocatable = false;
  const words = mods
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w !== "");
  for (const word of words) {
    if (word === "relocatable") {
      relocatable = true;
      continue;
    }
    if (!(CLAIM_MODES as readonly string[]).includes(word))
      return { error: `"${word}" in "${item}" is not a mode (${CLAIM_MODES.join(", ")}) or "relocatable"` };
    if (mode !== undefined) return { error: `"${item}" names two modes` };
    mode = word as ClaimMode;
  }
  return { mode: mode ?? "owns", relocatable };
}

/** A unit word, or a numbered run of units (sprite_0-7, sid_voice_1-3), checked against the seeds. */
function expandUnits(unitWord: string): string[] | { error: string } {
  let units = [unitWord];
  const range = /^(.*_)(\d+)-(\d+)$/.exec(unitWord);
  if (range) {
    const first = Number(range[2]);
    const last = Number(range[3]);
    if (first > last) return { error: `unit range "${unitWord}" runs backwards` };
    units = [];
    for (let n = first; n <= last; n++) units.push(`${range[1]}${n}`);
  }
  const bad = units.find((u) => !HARDWARE_UNIT_NAMES.has(u));
  if (bad) return { error: `"${bad}" is not a hardware unit (see docs/ONTOLOGY.md, HardwareUnit)` };
  return units;
}

function parseItem(item: string): ClaimItem | { error: string } {
  if (item.toLowerCase() === "none") return { error: `"none" must stand alone` };
  const m = /^([a-z][a-z0-9_]*(?:-\d+)?)(?:\s+(\$[^()]*?))?\s*(?:\(([^()]*)\))?$/.exec(item);
  if (!m) return { error: `"${item}" is not <unit>[ (<mode>)]` };
  const [, unitWord, addr, mods] = m as unknown as [string, string, string | undefined, string | undefined];
  const modifiers = parseModifiers(item, mods ?? "");
  if ("error" in modifiers) return modifiers;
  const units = expandUnits(unitWord);
  if ("error" in units) return units;
  return { units, addr, ...modifiers };
}

/** Zero page carries its bytes; it is the only unit that takes addresses or can be relocatable. */
function zeroPageClaim(item: ClaimItem): Claim | { error: string } {
  if (!item.addr) return { error: `zero_page needs its bytes, e.g. "zero_page $FB-$FE"` };
  const zp = parseZeroPageRanges(item.addr);
  if ("error" in zp) return zp;
  return {
    unit: "zero_page",
    mode: item.mode,
    ranges: formatZeroPageRanges(zp),
    ...(item.relocatable ? { relocatable: true } : {}),
  };
}

function itemClaims(raw: string, item: ClaimItem, seen: Set<string>): Claim[] | { error: string } {
  if (item.units.includes("zero_page")) {
    if (seen.has("zero_page")) return { error: `zero_page is claimed twice; join the ranges with "+"` };
    seen.add("zero_page");
    const zp = zeroPageClaim(item);
    return "error" in zp ? zp : [zp];
  }
  if (item.addr) return { error: `"${raw}": only zero_page takes addresses` };
  if (item.relocatable) return { error: `"${raw}": only zero_page can be relocatable` };
  const out: Claim[] = [];
  for (const u of item.units) {
    if (seen.has(u)) return { error: `${u} is claimed twice` };
    seen.add(u);
    out.push({ unit: u, mode: item.mode });
  }
  return out;
}

/**
 * Parse the value of a **Claims:** line. `none` alone returns an empty list
 * (claims no unit). Anything outside the grammar returns an error and the
 * whole line is refused: a partial claim set would read as a complete one.
 */
export function parseClaims(raw: string): Claim[] | { error: string } {
  const items = splitTopLevel(raw.replace(/`/g, "").trim());
  if (items.length === 0) return { error: "empty Claims line" };
  if (items.length === 1 && items[0].toLowerCase() === "none") return [];
  const claims: Claim[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const item = parseItem(raw);
    if ("error" in item) return item;
    const got = itemClaims(raw, item, seen);
    if ("error" in got) return got;
    claims.push(...got);
  }
  return claims;
}
