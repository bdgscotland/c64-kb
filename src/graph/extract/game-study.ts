/**
 * The lines only a studied game design carries (schema 40, frontmatter
 * `kind: studied`, docs/CONVENTIONS-game-designs.md "Studied designs"):
 * where the study came from, the interrupt chain and the memory map the RE
 * tools measured, and how the game departs from its archetype. Each parser
 * returns the value or why the line is refused; a line is refused whole,
 * because part of it would read as the whole observation.
 */

import { group } from "./common.ts";
import { TECHNIQUE_NAME } from "./technique-entities.ts";
import { MEASURED_FRAME_BASIS_WORDS, isMeasuredFrameBasis, type MeasuredFrameBasis } from "./vocabulary.ts";

export interface StudiedFrom {
  title: string;
  year: number;
  authors: string[];
  image_sha1: string;
  session: string;
}

/** One `<phase> <pal|ntsc>: $pc @ line N[/M], …` group of an **IRQ chain:** line. */
export interface IrqChain {
  phase: string;
  region: "PAL" | "NTSC";
  handlers: { pc: string; lines: number[] }[];
  basis: MeasuredFrameBasis;
  source: string;
}

/** One entry of a **Memory map:** line: `screen $0400`, `VIC bank 0`, `$01=$35 in play`. */
interface MemoryMapEntry {
  label: string;
  value: string;
  when?: string;
}

export interface MemoryMap {
  entries: MemoryMapEntry[];
  basis: MeasuredFrameBasis;
  source: string;
}

export interface Divergence {
  technique: string;
  direction: "extra" | "missing";
}

type Parsed<T> = T | { error: string };

// `Commando (1985, Chris Butler, Elite); image sha1=<40 hex>; session <path>`
const STUDIED_FROM =
  /^(.+?)\s+\((\d{4})\s*,\s*([^()]+)\)\s*;\s*image\s+sha1=([0-9a-f]{40})\s*;\s*session\s+(\S+)$/i;
const IRQ_GROUP = /^([a-z]+)\s+(pal|ntsc)\s*:\s*(.+)$/i;
const IRQ_HANDLER = /^\$([0-9a-f]{4})\s*@\s*line\s+(\d{1,3}(?:\/\d{1,3})*)$/i;
const HEX = String.raw`\$[0-9a-f]{2,4}`;
const MAP_PORT = new RegExp(String.raw`^(\$0[01])\s*=\s*(\$[0-9a-f]{2})$`, "i");
const MAP_VALUE = new RegExp(String.raw`^([a-z][a-z0-9 ]*?)\s+(${HEX}(?:-${HEX})?|\d+)$`, "i");
const MAP_WHEN = /^(.*?)\s+in\s+([a-z][a-z ]*)$/i;
const DIVERGE_GROUP = /^(extra|missing)\s*:\s*(.+)$/;

/** `<body> (basis, source)`: the parenthetical every measured line ends with. */
function basisTail(line: string): Parsed<{ body: string; basis: MeasuredFrameBasis; source: string }> {
  const m = /^(.*?)\(\s*([a-z-]+)\s*,\s*(.+)\)\s*$/.exec(line.trim());
  if (!m) return { error: `no "(basis, source)" at the end` };
  const basis = group(m, 2);
  if (!isMeasuredFrameBasis(basis))
    return { error: `basis "${basis}" is not one of ${MEASURED_FRAME_BASIS_WORDS.join(", ")}` };
  return { body: group(m, 1).trim(), basis, source: group(m, 3).trim() };
}

function parts(text: string, sep: string): string[] {
  return text
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function parseStudiedFrom(line: string): Parsed<StudiedFrom> {
  const m = STUDIED_FROM.exec(line.trim());
  if (!m)
    return {
      error: `"${line.trim()}" is not "Title (year, author[, …]); image sha1=<40 hex digits>; session <path>"`,
    };
  return {
    title: group(m, 1).trim().replace(/`/g, ""),
    year: Number(group(m, 2)),
    authors: parts(group(m, 3), ","),
    image_sha1: group(m, 4).toLowerCase(),
    session: group(m, 5),
  };
}

function irqGroup(text: string): Parsed<Omit<IrqChain, "basis" | "source">> {
  const g = IRQ_GROUP.exec(text);
  if (!g) return { error: `"${text}" is not "<phase> <pal|ntsc>: $pc @ line N, …"` };
  const handlers: IrqChain["handlers"] = [];
  for (const h of parts(group(g, 3), ",")) {
    const m = IRQ_HANDLER.exec(h);
    if (!m) return { error: `"${h}" is not "$pc @ line N" or "$pc @ line N/M"` };
    handlers.push({ pc: `$${group(m, 1).toUpperCase()}`, lines: group(m, 2).split("/").map(Number) });
  }
  if (handlers.some((h) => h.lines.some((l) => l > 311))) return { error: `a line above 311 in "${text}"` };
  const region = group(g, 2).toUpperCase() === "PAL" ? "PAL" : "NTSC";
  return { phase: group(g, 1).toLowerCase(), region, handlers };
}

/** `play pal: $41C5 @ line 30, $4284 @ line 50/52; play ntsc: … (measured-vice, obs …)`. */
export function parseIrqChain(line: string): Parsed<IrqChain[]> {
  const tail = basisTail(line);
  if ("error" in tail) return tail;
  const out: IrqChain[] = [];
  for (const text of parts(tail.body, ";")) {
    const g = irqGroup(text);
    if ("error" in g) return g;
    out.push({ ...g, basis: tail.basis, source: tail.source });
  }
  if (out.length === 0) return { error: "no handlers" };
  return out;
}

function mapEntry(text: string): Parsed<MemoryMapEntry> {
  const w = MAP_WHEN.exec(text);
  const core = w ? group(w, 1).trim() : text;
  const when = w ? { when: group(w, 2).trim().toLowerCase() } : {};
  const port = MAP_PORT.exec(core);
  if (port) return { label: group(port, 1), value: group(port, 2).toUpperCase(), ...when };
  const v = MAP_VALUE.exec(core);
  if (!v) return { error: `"${text}" is not "<what> $addr[-$addr]", "<what> N" or "$01=$nn" [in <phase>]` };
  return { label: group(v, 1).trim(), value: group(v, 2).toUpperCase(), ...when };
}

/** `VIC bank 0; screen $0400; charset $2000; $01=$35 in play (measured-vice, obs …)`. */
export function parseMemoryMap(line: string): Parsed<MemoryMap> {
  const tail = basisTail(line);
  if ("error" in tail) return tail;
  const entries: MemoryMapEntry[] = [];
  for (const text of parts(tail.body, ";")) {
    const e = mapEntry(text);
    if ("error" in e) return e;
    entries.push(e);
  }
  if (entries.length === 0) return { error: "no entries" };
  return { entries, basis: tail.basis, source: tail.source };
}

/** `extra: a, b; missing: c`. A technique named twice, or in both groups, is refused. */
export function parseDivergence(line: string): Parsed<Divergence[]> {
  const out: Divergence[] = [];
  for (const text of parts(line, ";")) {
    const g = DIVERGE_GROUP.exec(text);
    if (!g) return { error: `"${text}" is not "extra: technique, …" or "missing: technique, …"` };
    const direction = group(g, 1) === "extra" ? "extra" : "missing";
    for (const name of parts(group(g, 2).replace(/`/g, ""), ",")) {
      if (!TECHNIQUE_NAME.test(name)) return { error: `"${name}" is not a technique name` };
      if (out.some((d) => d.technique === name)) return { error: `${name} is named twice` };
      out.push({ technique: name, direction });
    }
  }
  if (out.length === 0) return { error: "no techniques" };
  return out;
}
