/**
 * check-pitfall-coverage: list the documented registers and KERNAL routines
 * that no pitfall names on a `**Triggered by registers:**` or
 * `**Triggered by kernal:**` line (#19), so a writer can triage which of
 * them really bite. Each row carries what a triage needs: access and the
 * side-effect words its reference section uses for a register, the
 * calling convention and Affects line for a routine, and how many
 * techniques use it.
 *
 * The register and routine lists come from the extractor over the pages,
 * so this runs without FalkorDB, as check-pitfall-anchors does. A register
 * is matched by name, hex alias or address, as the graph matches it.
 *
 *   node scripts/check-pitfall-coverage.ts     # report; exit 1 only if a trigger names nothing documented
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractGraphEntities, type GraphEntity } from "../src/graph/extract.ts";
import { splitH3Sections } from "../src/graph/extract/common.ts";
import { findMarkdown } from "../src/ingest/files.ts";

const docs = join(import.meta.dirname, "..", "docs");

type Reg = Extract<GraphEntity, { type: "register" }>;
type Kernal = Extract<GraphEntity, { type: "kernal_routine" }>;

// Phrases that mark a register access with a side effect beyond the value.
const SIDE_EFFECT =
  /write (?:a )?1 to clear|write to clear|writ\w+ (?:a )?1 (?:to|acknowledges)|acknowledg\w*|read(?:ing)? clears|clear(?:s|ed)? (?:on|when|by) (?:a )?read|strobe\w*|latch\w*|write-only|read-only|one-shot|starts? the timer/gi;

const registers: Reg[] = [];
const kernal: Kernal[] = [];
const triggers: Extract<GraphEntity, { type: "triggered_by" }>[] = [];
const uses = new Map<string, number>();
const sideEffects = new Map<string, Set<string>>();

for (const file of findMarkdown(docs)) {
  const text = readFileSync(join(docs, file), "utf8");
  for (const e of extractGraphEntities(text, file)) {
    if (e.type === "register") registers.push(e);
    else if (e.type === "kernal_routine") kernal.push(e);
    else if (e.type === "triggered_by" && e.targetKind !== "Technique") triggers.push(e);
    else if (e.type === "technique_uses_register") uses.set(e.register, (uses.get(e.register) ?? 0) + 1);
    else if (e.type === "technique_uses_kernal") uses.set(e.kernal, (uses.get(e.kernal) ?? 0) + 1);
  }
  if (!text.includes("<!-- doc-type: hardware-reference -->")) continue;
  for (const { heading, body } of splitH3Sections(text)) {
    const addr = /^###\s+(\$[0-9A-F]{4})\s/.exec(heading)?.[1];
    if (!addr) continue;
    const words = new Set([...body.matchAll(SIDE_EFFECT)].map((m) => m[0].toLowerCase()));
    if (words.size > 0) sideEffects.set(addr, words);
  }
}

/** The register a name, hex alias or $address resolves to, as the graph's matchEnd does. */
const registerOf = (target: string): Reg | undefined =>
  registers.find((r) => r.name === target || r.address === `$${target}` || r.aliases.includes(target));
const usesOf = (...names: string[]) => names.reduce((n, x) => n + (uses.get(x) ?? 0), 0);

const namedRegs = new Set<string>();
const namedKernal = new Set<string>();
const dangling: string[] = [];
for (const t of triggers) {
  if (t.targetKind === "Register") {
    const r = registerOf(t.target);
    if (r) namedRegs.add(r.name);
    else dangling.push(`${t.pitfall}: register ${t.target}`);
  } else if (kernal.some((k) => k.name === t.target)) namedKernal.add(t.target);
  else dangling.push(`${t.pitfall}: kernal ${t.target}`);
}

/** A field cut to one screen line: the section has the rest. */
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const byAddress = (a: { address: string }, b: { address: string }) => a.address.localeCompare(b.address);
const bareRegs = registers.filter((r) => !namedRegs.has(r.name)).sort(byAddress);
const bareKernal = kernal.filter((k) => !namedKernal.has(k.name)).sort(byAddress);

console.log(
  `${registers.length} registers documented; ${registers.length - bareRegs.length} named by a pitfall; ${bareRegs.length} not`,
);
console.log(`  address  name       chip    rw  techniques  side effects in its section`);
for (const r of bareRegs) {
  const effects = [...(sideEffects.get(r.address) ?? [])].join(", ") || "-";
  const n = usesOf(r.name, ...r.aliases);
  console.log(
    `  ${r.address}    ${r.name.padEnd(10)} ${r.chip.padEnd(7)} ${r.rw.padEnd(3)} ${String(n).padStart(10)}  ${effects}`,
  );
}

console.log(
  `\n${kernal.length} KERNAL routines documented; ${kernal.length - bareKernal.length} named by a pitfall; ${bareKernal.length} not`,
);
console.log(`  address  name     techniques  input / output / affects`);
for (const k of bareKernal) {
  const conv = [k.input, k.output, k.affects].map((x) => clip(x ?? "-")).join(" / ");
  console.log(`  ${k.address}    ${k.name.padEnd(8)} ${String(usesOf(k.name)).padStart(10)}  ${conv}`);
}

if (dangling.length > 0) {
  console.error(`\n${dangling.length} trigger(s) name nothing documented:`);
  for (const d of dangling) console.error(`  ${d}`);
  process.exit(1);
}
