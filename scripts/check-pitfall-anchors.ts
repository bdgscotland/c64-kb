/**
 * check-pitfall-anchors: report which Technique H2s no pitfall names on a
 * `**Triggered by techniques:**` or `**Mitigated by techniques:**` line, and
 * fail if any such line names a technique that does not exist.
 *
 * A technique with no anchor can still surface pitfalls through the
 * semantic supplement in c64_pitfalls_for, but the graph edge is the path
 * an agent can rely on. This is a report over the pages, not the graph, so
 * it runs without FalkorDB.
 *
 * A technique the triage judged to need no pitfall is listed in EXEMPT with
 * its reason (maintainer decision on #117); any other unanchored technique
 * fails the check.
 *
 *   node scripts/check-pitfall-anchors.ts   # exit 1 on a dangling name or an unanchored, non-exempt technique
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { group } from "./lib/markdown.ts";

const root = join(import.meta.dirname, "..");
const techDir = join(root, "docs", "techniques");
const pitDir = join(root, "docs", "pitfalls");

const H2 = /^## ([a-z0-9_]+) — /gm;

// Judged NONE by the #19 triage (2026-09-23): no pitfall fits, and the
// technique's own entry already carries what a pitfall would.
const EXEMPT = new Map<string, string>([
  ["dig_and_refill", "its rule faults are stated and model-checked in the entry"],
  ["world_state_bits", "its rule faults are stated and model-checked in the entry"],
  ["wcf_packer", "a legacy note with no binary to measure"],
  ["runtime_relocation", "its section carries its own measured list of what cannot be relocated"],
]);
const CATEGORY = /^category:\s*(\w+)/m;
const ANCHOR = /^\*\*(?:Triggered|Mitigated) by techniques:\*\*\s*(.+)$/gm;

const techniques = new Map<string, { category: string; file: string }>();
for (const f of readdirSync(techDir).filter((n) => n.endsWith(".md"))) {
  const text = readFileSync(join(techDir, f), "utf8");
  const category = CATEGORY.exec(text)?.[1] ?? "?";
  for (const m of text.matchAll(H2)) techniques.set(group(m, 1), { category, file: f });
}

const anchored = new Map<string, Set<string>>();
const dangling: { name: string; file: string }[] = [];
for (const f of readdirSync(pitDir).filter((n) => n.endsWith(".md"))) {
  const text = readFileSync(join(pitDir, f), "utf8");
  for (const m of text.matchAll(ANCHOR)) {
    for (const raw of group(m, 1).split(/[,\s`]+/)) {
      const name = raw.trim();
      if (!name) continue;
      if (!techniques.has(name)) {
        dangling.push({ name, file: f });
        continue;
      }
      const files = anchored.get(name) ?? new Set<string>();
      files.add(f);
      anchored.set(name, files);
    }
  }
}

const unanchored = [...techniques.entries()]
  .filter(([name]) => !anchored.has(name))
  .sort(([a, ta], [b, tb]) => ta.category.localeCompare(tb.category) || a.localeCompare(b));
const exempt = unanchored.filter(([name]) => EXEMPT.has(name));
const missing = unanchored.filter(([name]) => !EXEMPT.has(name));
const staleExempt = [...EXEMPT.keys()].filter((name) => !techniques.has(name) || anchored.has(name));

console.log(
  `${techniques.size} techniques; ${anchored.size} anchored by a pitfall; ${exempt.length} exempt; ${missing.length} with no anchor`,
);
for (const [name] of exempt) console.log(`  exempt    ${name.padEnd(34)} ${EXEMPT.get(name) ?? ""}`);
for (const [name, t] of missing) console.log(`  ${t.category.padEnd(9)} ${name.padEnd(34)} ${t.file}`);
if (dangling.length) {
  console.error(`\n${dangling.length} anchor(s) name no technique:`);
  for (const d of dangling) console.error(`  ${d.name} in ${d.file}`);
}
if (staleExempt.length)
  console.error(`\nEXEMPT names a technique that is gone or now anchored: ${staleExempt.join(", ")}`);
if (missing.length) console.error(`\n${missing.length} technique(s) lack an anchor and are not exempt.`);
if (dangling.length || missing.length || staleExempt.length) process.exit(1);
