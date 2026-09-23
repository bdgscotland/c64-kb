/**
 * Pitfall and failure-diagnosis query tools — Phase 5.
 *
 * pitfallsFor(topic): resolves a Register, KernalRoutine, or Technique topic
 *   to Pitfall nodes via TRIGGERED_BY traversal — and, for a Technique, via
 *   MITIGATED_BY as well, so a technique that is the Fix for a pitfall answers
 *   from the graph with the relation named. Falls back to "search" when no
 *   direct graph match is found.
 *
 * failureDiagnose(symptom): keyword-overlap scoring against all CrashPattern
 *   nodes, returns top 5 matches with CAUSED_BY enrichment.
 *
 * The graph reads live in src/tools/pitfalls/graph.ts, the text in
 * format.ts, the BM25 vocabulary in bm25.ts.
 */

import { z } from "zod";
import { getFalkor, getQdrant, getAnalytics } from "../context.ts";
import { embed } from "../services/embeddings.ts";
import type { PitfallsForOutput, FailureDiagnoseOutput } from "../schemas/tool-outputs.ts";
import { encodeSparse } from "./pitfalls/bm25.ts";
import {
  directPitfalls,
  edgeTargets,
  enrichPitfall,
  normalizeKey,
  withPitfallsViaUses,
  type EntityKind,
} from "./pitfalls/graph.ts";
import {
  formatFailureDiagnoseText,
  formatPitfallsText,
  formatSearchFallbackText,
} from "./pitfalls/format.ts";

export type PitfallsForResult = { structured: PitfallsForOutput; text: string };
export type FailureDiagnoseResult = { structured: FailureDiagnoseOutput; text: string };

// Tried in this order; the first kind with any pitfall answers.
const KINDS: EntityKind[] = ["Register", "KernalRoutine", "Technique"];

async function pitfallsForKind(topic: string, kind: EntityKind): Promise<PitfallsForOutput["pitfalls"]> {
  const f = await getFalkor();
  const key = normalizeKey(kind, topic);
  const direct = await directPitfalls(f, kind, key);
  const { rows, viaOf } =
    kind === "Technique" ? await withPitfallsViaUses(f, key, direct) : { rows: direct, viaOf: undefined };
  // Enrich each with its full triggered_by and mitigated_by lists.
  return Promise.all(rows.map((row) => enrichPitfall(f, row, viaOf?.get(row.name))));
}

/**
 * No direct match: semantic search over the pitfall pages. hybridSearch's
 * filterSource is an exact match, not a prefix, so it runs unfiltered with
 * a wider limit and keeps the pitfalls/ hits client-side.
 */
async function searchFallback(topic: string): Promise<PitfallsForResult> {
  const qdrant = await getQdrant();
  const vec = await embed(topic);
  const raw = vec
    ? await qdrant.hybridSearch(vec, encodeSparse(topic), 20)
    : await qdrant.searchByText(topic, 20);
  const pitfallHits = raw.filter((r) => r.source.startsWith("pitfalls/")).slice(0, 5);
  const search_results = pitfallHits.map((r) => ({
    source: r.source,
    section: r.section,
    text: r.text,
    score: r.score,
  }));

  getAnalytics().logQuery({ tool: "c64_pitfalls_for", query: topic, resultCount: search_results.length });
  return {
    structured: { topic, topic_kind: "search", pitfalls: [], search_results },
    text:
      search_results.length > 0
        ? formatSearchFallbackText(topic, pitfallHits)
        : `No direct match for "${topic}" and no pitfall docs matched semantically. Try a register name (D012, $D012), KERNAL routine name, or technique name (stable_raster_irq). Use c64_search for fuzzy topic queries.`,
  };
}

export async function pitfallsFor(topic: string): Promise<PitfallsForResult> {
  for (const kind of KINDS) {
    const pitfalls = await pitfallsForKind(topic, kind);
    if (pitfalls.length === 0) continue;
    getAnalytics().logQuery({ tool: "c64_pitfalls_for", query: topic, resultCount: pitfalls.length });
    return {
      structured: { topic, topic_kind: kind, pitfalls },
      text: formatPitfallsText(topic, kind, pitfalls),
    };
  }
  return searchFallback(topic);
}

const CrashPatternRow = z.object({
  symptom: z.string().nullish(),
  description: z.string().nullish(),
  likely_causes: z.string().nullish(),
  diagnosis_steps: z.string().nullish(),
});

/** likely_causes is stored as a JSON string of an array (FalkorService.addCrashPattern). */
function parseLikelyCauses(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) return [];
    throw err;
  }
  const causes = z.array(z.string()).safeParse(parsed);
  return causes.success ? causes.data : [];
}

export async function failureDiagnose(symptom: string): Promise<FailureDiagnoseResult> {
  const f = await getFalkor();
  const all = await f.roQuery(
    `MATCH (c:CrashPattern)
     RETURN c.symptom AS symptom, c.description AS description,
            c.likely_causes AS likely_causes, c.diagnosis_steps AS diagnosis_steps`,
  );
  const queryTokens = symptom
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((t) => t.length >= 3);

  const scored = z
    .array(CrashPatternRow)
    .parse(all.data)
    .map((row) => {
      const haystack =
        `${row.symptom ?? ""} ${row.description ?? ""} ${row.likely_causes ?? ""}`.toLowerCase();
      const hits = queryTokens.filter((t) => haystack.includes(t)).length;
      return {
        symptom: row.symptom ?? "",
        description: row.description ?? "",
        likely_causes_raw: row.likely_causes ?? "[]",
        diagnosis_steps: row.diagnosis_steps ?? "",
        score: hits / Math.max(queryTokens.length, 1),
      };
    });

  const ranked = scored
    .filter((s) => s.score > 0)
    // Score desc, alphabetical tiebreak so equal-relevance matches sort
    // identically across runs.
    .sort((a, b) => b.score - a.score || a.symptom.localeCompare(b.symptom));

  const matches = await Promise.all(
    ranked.slice(0, 5).map(async (m) => ({
      symptom: m.symptom,
      description: m.description,
      likely_causes: parseLikelyCauses(m.likely_causes_raw),
      diagnosis_steps: m.diagnosis_steps,
      caused_by: await edgeTargets(
        f,
        `MATCH (c:CrashPattern {symptom: $sym})-[:CAUSED_BY]->(t)
       RETURN t.name AS tname, labels(t)[0] AS tkind`,
        { sym: m.symptom },
      ),
      relevance: m.score,
    })),
  );

  getAnalytics().logQuery({ tool: "c64_failure_diagnose", query: symptom, resultCount: matches.length });
  return {
    structured: { query: symptom, matches },
    text: formatFailureDiagnoseText(symptom, matches),
  };
}
