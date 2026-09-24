/**
 * search-recall: recall@k and MRR of c64_search over a fixed query set.
 *
 *   node scripts/search-recall.ts            # summary + the misses
 *   node scripts/search-recall.ts --json     # one row per query
 *
 * Reads test/fixtures/search-recall.json. A query is recalled when any of
 * its expected pages is among the top k sources; its reciprocal rank is
 * 1/rank of the first such hit, 0 when none. Queries the stores named by
 * QDRANT_COLLECTION and ANALYTICS_DB (the vocab file sits beside it), and
 * logs each query to that analytics database like any search.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { search } from "../src/tools/query/retrieval.ts";
import { closeAll } from "../src/context.ts";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../test/fixtures/search-recall.json",
);
const Fixture = z.object({
  k: z.number().int().min(1),
  queries: z.array(z.object({ query: z.string(), expected: z.array(z.string()).min(1) })).min(1),
});
const { k, queries } = Fixture.parse(JSON.parse(fs.readFileSync(FIXTURE, "utf-8")));

const rows = [];
for (const { query, expected } of queries) {
  const { structured } = await search(query, k);
  const sources = structured.hits.map((h) => h.source);
  const rank = sources.findIndex((s) => expected.includes(s)) + 1;
  rows.push({ query, expected, sources, rank });
}
await closeAll();

const recall = rows.filter((r) => r.rank > 0).length / rows.length;
const mrr = rows.reduce((sum, r) => sum + (r.rank > 0 ? 1 / r.rank : 0), 0) / rows.length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ k, recall, mrr, rows }, null, 2));
} else {
  console.log(`queries=${rows.length} recall@${k}=${recall.toFixed(3)} mrr=${mrr.toFixed(3)}`);
  for (const r of rows.filter((x) => x.rank !== 1)) {
    console.log(`  rank ${r.rank || "-"}  ${r.query}  → ${r.sources.join(", ")}`);
  }
}
