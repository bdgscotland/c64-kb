/**
 * Where the claims watch reads its declarations from: the technique pages'
 * Claims lines (through the extractor, no graph), a recipe's frontmatter,
 * the KERNAL page's may-sets, the PRG header and a label file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { extractGraphEntities, type GraphEntity } from "../../src/graph/extract.ts";
import { parseClobbers } from "../../src/graph/kernal-clobbers.ts";
import { zeroPageRangesFromCanonical, type Claim } from "../../src/graph/claims.ts";
import { KERNAL_PAGE } from "./kernal-zp-page.ts";

export interface TechniqueClaims {
  /** null: the page has no settled Claims line, so its claims are unknown. */
  claims: Claim[] | null;
  requires: string[];
}

function markdownUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => join(d.parentPath, d.name));
}

/** Fold one extracted entity into the table. */
function absorb(out: Map<string, TechniqueClaims>, e: GraphEntity): void {
  const get = (id: string): TechniqueClaims => {
    const t = out.get(id) ?? { claims: null, requires: [] };
    out.set(id, t);
    return t;
  };
  if (e.type === "technique") {
    const t = get(e.name);
    if (e.claims_stated !== undefined) t.claims ??= [];
  } else if (e.type === "claims") {
    const { unit, mode, ranges, relocatable } = e;
    const t = get(e.owner);
    t.claims = [
      ...(t.claims ?? []),
      { unit, mode, ...(ranges ? { ranges } : {}), ...(relocatable ? { relocatable } : {}) },
    ];
  } else if (e.type === "technique_requires") get(e.technique).requires.push(e.requires);
}

/** Every technique id -> its Claims (as the extractor settles them) and its REQUIRES. */
export function loadTechniqueClaims(root: string): Map<string, TechniqueClaims> {
  const docs = join(root, "docs");
  const out = new Map<string, TechniqueClaims>();
  const warn = console.warn;
  console.warn = () => undefined; // the extractor's page warnings belong to the ingest, not here
  try {
    for (const abs of markdownUnder(join(docs, "techniques")))
      for (const e of extractGraphEntities(readFileSync(abs, "utf8"), relative(docs, abs))) absorb(out, e);
  } finally {
    console.warn = warn;
  }
  return out;
}

/** The technique ids and every prerequisite they REQUIRE, transitively, in the order met. */
export function withPrerequisites(ids: readonly string[], all: Map<string, TechniqueClaims>): string[] {
  const seen: string[] = [];
  const visit = (id: string) => {
    if (seen.includes(id)) return;
    seen.push(id);
    for (const r of all.get(id)?.requires ?? []) visit(r);
  };
  ids.forEach(visit);
  return seen;
}

export interface RecipeFrontmatter {
  techniques: string[];
  usesKernal: string[];
  /** The raw `claims:` value, when the recipe carries one. */
  claims?: string;
}

const flowArray = (fm: string, key: string): string[] | undefined => {
  const m = new RegExp(`^${key}:\\s*\\[(.*)\\]\\s*$`, "m").exec(fm);
  return m
    ? (m[1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
    : undefined;
};

export function recipeFrontmatter(text: string): RecipeFrontmatter {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const claims = /^claims:\s*\[(.*)\]\s*$/m.exec(fm)?.[1];
  return {
    techniques: flowArray(fm, "techniques") ?? [],
    usesKernal: flowArray(fm, "uses_kernal") ?? [],
    ...(claims !== undefined ? { claims } : {}),
  };
}

/**
 * Routine name -> its may-set, from the `(may; ROM walk ...)` lines of the
 * KERNAL page, plus `IRQ` and `NMI` from the page's services table.
 */
export function kernalMaySets(root: string): Map<string, [number, number][]> {
  const text = readFileSync(join(root, KERNAL_PAGE), "utf8");
  const out = new Map<string, [number, number][]>();
  for (const e of extractGraphEntities(text, relative(join(root, "docs"), join(root, KERNAL_PAGE))))
    if (e.type === "kernal_clobbers_zp" && e.bound === "may")
      out.set(e.routine, zeroPageRangesFromCanonical(e.ranges));
  for (const m of text.matchAll(/^\| (IRQ|NMI) `\$[0-9A-F]{4}`[^|]*\| (.+?) \|$/gm)) {
    const c = parseClobbers(m[2] ?? "");
    if (!("error" in c)) out.set(m[1] ?? "", c.ranges);
  }
  return out;
}

export interface Prg {
  load: number;
  end: number;
  /** The SYS address in a BASIC stub at $0801, when there is one. */
  sys?: number;
}

export function readPrg(bytes: Uint8Array): Prg {
  const load = (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
  const prg: Prg = { load, end: load + bytes.length - 3 };
  if (load !== 0x0801) return prg;
  // 10 SYS nnnn: link(2) line(2) $9E digits $00.
  const line = bytes.subarray(2, 40);
  const at = line.indexOf(0x9e);
  if (at < 4) return prg;
  const digits = /^\s*\(?\s*(\d{3,5})/.exec(Buffer.from(line.subarray(at + 1)).toString("latin1"));
  if (digits) prg.sys = Number(digits[1]);
  return prg;
}

/**
 * Labels from a KickAssembler .sym (`.label name=$0812`) or a VICE label
 * file (`al C:0812 .name`, which Oscar64, cc65 -Ln and KickAssembler
 * -vicesymbols write). Address -> name, the first name kept.
 */
export function readLabels(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split("\n")) {
    const kick = /^\s*\.label\s+([\w.]+)\s*=\s*\$([0-9a-fA-F]{1,4})\b/.exec(line);
    const vice = /^al\s+(?:C:)?([0-9a-fA-F]{1,4})\s+\.?(\S+)/.exec(line);
    const [addr, name] = kick ? [kick[2], kick[1]] : vice ? [vice[1], vice[2]] : [undefined, undefined];
    if (addr === undefined || name === undefined) continue;
    const a = parseInt(addr, 16);
    if (!out.has(a)) out.set(a, name);
  }
  return out;
}

/** `$0823 (irq+3)` from the nearest label at or below, within 256 bytes. */
export function labeller(labels: Map<number, string>): (pc: number) => string {
  const sorted = [...labels].sort((a, b) => a[0] - b[0]);
  return (pc) => {
    const hex = `$${pc.toString(16).toUpperCase().padStart(4, "0")}`;
    let best: [number, string] | undefined;
    for (const l of sorted) if (l[0] <= pc) best = l;
    if (!best || pc - best[0] > 0xff) return hex;
    return pc === best[0] ? `${hex} (${best[1]})` : `${hex} (${best[1]}+${pc - best[0]})`;
  };
}
