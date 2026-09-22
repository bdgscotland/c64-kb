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
 *   npx tsx scripts/check-pitfall-anchors.ts            # report, exit 0 unless a name is dangling
 *   npx tsx scripts/check-pitfall-anchors.ts --max 40   # also fail if more than 40 techniques lack an anchor
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const techDir = join(root, "docs", "techniques");
const pitDir = join(root, "docs", "pitfalls");

const H2 = /^## ([a-z0-9_]+) — /gm;
const CATEGORY = /^category:\s*(\w+)/m;
const ANCHOR = /^\*\*(?:Triggered|Mitigated) by techniques:\*\*\s*(.+)$/gm;

const techniques = new Map<string, { category: string; file: string }>();
for (const f of readdirSync(techDir).filter((n) => n.endsWith(".md"))) {
  const text = readFileSync(join(techDir, f), "utf8");
  const category = text.match(CATEGORY)?.[1] ?? "?";
  for (const m of text.matchAll(H2)) techniques.set(m[1], { category, file: f });
}

const anchored = new Map<string, Set<string>>();
const dangling: { name: string; file: string }[] = [];
for (const f of readdirSync(pitDir).filter((n) => n.endsWith(".md"))) {
  const text = readFileSync(join(pitDir, f), "utf8");
  for (const m of text.matchAll(ANCHOR)) {
    for (const raw of m[1].split(/[,\s`]+/)) {
      const name = raw.trim();
      if (!name) continue;
      if (!techniques.has(name)) dangling.push({ name, file: f });
      else (anchored.get(name) ?? anchored.set(name, new Set()).get(name)!).add(f);
    }
  }
}

const missing = [...techniques.entries()]
  .filter(([name]) => !anchored.has(name))
  .sort(([a, ta], [b, tb]) => ta.category.localeCompare(tb.category) || a.localeCompare(b));

const maxArg = process.argv.indexOf("--max");
const max = maxArg >= 0 ? Number(process.argv[maxArg + 1]) : Infinity;

console.log(`${techniques.size} techniques; ${anchored.size} anchored by a pitfall; ${missing.length} with no anchor`);
for (const [name, t] of missing) console.log(`  ${t.category.padEnd(9)} ${name.padEnd(34)} ${t.file}`);
if (dangling.length) {
  console.error(`\n${dangling.length} anchor(s) name no technique:`);
  for (const d of dangling) console.error(`  ${d.name} in ${d.file}`);
}
if (dangling.length) process.exit(1);
if (missing.length > max) {
  console.error(`\n${missing.length} techniques lack an anchor; --max ${max} allows fewer.`);
  process.exit(1);
}
