/**
 * Pitfall and failure-diagnosis query tools — Phase 5.
 *
 * pitfallsFor(topic): resolves a Register, KernalRoutine, or Technique topic
 *   to Pitfall nodes via TRIGGERED_BY traversal. Falls back to "search"
 *   placeholder when no direct graph match is found.
 *
 * failureDiagnose(symptom): keyword-overlap scoring against all CrashPattern
 *   nodes, returns top 5 matches with CAUSED_BY enrichment.
 */

import { getFalkor, getQdrant, getAnalytics } from "../context.js";
import { embed } from "../services/embeddings.js";
import { BM25Encoder, type SparseVector } from "../services/bm25.js";
import type { ChunkPayload } from "../services/qdrant.js";
import { config } from "../config.js";
import fs from "fs";
import path from "path";
import type { PitfallsForOutput, FailureDiagnoseOutput } from "../schemas/tool-outputs.js";

const VOCAB_FILE = path.resolve(config.analytics.dbPath, "../bm25-vocab.json");
let bm25Cache: BM25Encoder | null | undefined;

function getBM25(): BM25Encoder | null {
  if (bm25Cache !== undefined) return bm25Cache;
  try {
    if (!fs.existsSync(VOCAB_FILE)) { bm25Cache = null; return null; }
    const data = JSON.parse(fs.readFileSync(VOCAB_FILE, "utf-8"));
    bm25Cache = BM25Encoder.fromJSON(data);
    return bm25Cache;
  } catch { bm25Cache = null; return null; }
}

function encodeSparse(text: string): SparseVector {
  const enc = getBM25();
  return enc ? enc.encode(text) : { indices: [], values: [] };
}

export type PitfallsForResult = { structured: PitfallsForOutput; text: string };
export type FailureDiagnoseResult = { structured: FailureDiagnoseOutput; text: string };

type EntityKind = "Register" | "KernalRoutine" | "Technique";

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

/**
 * Strip the leading "${section}\n\n" prefix from a chunk's stored
 * text so it isn't rendered twice (once in the formatter heading,
 * once at the top of the body). Mirrors the pattern in query.ts.
 */
function stripSectionPrefix(section: string, text: string): string {
  const prefix = `${section}\n\n`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

// Normalizers for each entity kind
function normalizeKey(kind: EntityKind, topic: string): string {
  if (kind === "Register") return topic.replace(/^\$/, "").toUpperCase();
  if (kind === "KernalRoutine") return topic.toUpperCase();
  return topic.toLowerCase().replace(/[- ]/g, "_");
}

export async function pitfallsFor(topic: string): Promise<PitfallsForResult> {
  const f = await getFalkor();
  const severityCase = `CASE p.severity ${SEVERITY_ORDER.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} ELSE ${SEVERITY_ORDER.length} END`;

  // Try Register → KernalRoutine → Technique in that order.
  const KINDS: EntityKind[] = ["Register", "KernalRoutine", "Technique"];

  for (const kind of KINDS) {
    const matchKey = normalizeKey(kind, topic);

    // For Register, also match by address or alias (mirrors lookupRegister logic)
    let matchClause: string;
    if (kind === "Register") {
      matchClause = `(t:Register) WHERE t.name = $key OR t.address = $addr OR $key IN t.aliases`;
    } else {
      matchClause = `(t:${kind} {name: $key})`;
    }

    const r = await f.roQuery(
      `MATCH (p:Pitfall)-[:TRIGGERED_BY]->${matchClause}
       RETURN p.name AS name, p.title AS title, p.severity AS severity,
              p.region AS region, p.category AS category
       ORDER BY
         ${severityCase},
         p.name`,
      { key: matchKey, addr: `$${matchKey}` }
    );

    if ((r.data as unknown[]).length > 0) {
      // Found pitfalls — enrich each with its full triggered_by list
      const pitfalls = await Promise.all((r.data as Array<{
        name: string;
        title: string;
        severity: string;
        region: string;
        category: string;
      }>).map(async (row) => {
        const edges = await f.roQuery(
          `MATCH (p:Pitfall {name: $name})-[:TRIGGERED_BY]->(t)
           RETURN t.name AS tname, labels(t)[0] AS tkind`,
          { name: row.name }
        );
        const triggered_by = (edges.data as Array<{ tname: string; tkind: string }>)
          .filter(e => e.tname && e.tkind)
          .map(e => ({ name: e.tname, kind: e.tkind as EntityKind }));

        return {
          name: row.name ?? "",
          title: row.title ?? "",
          severity: (row.severity ?? "low") as PitfallsForOutput["pitfalls"][0]["severity"],
          region: (row.region ?? "both") as PitfallsForOutput["pitfalls"][0]["region"],
          category: row.category ?? "",
          triggered_by,
        };
      }));

      const text = formatPitfallsText(topic, kind, pitfalls);
      const a = getAnalytics();
      a.logQuery({ tool: "c64_pitfalls_for", query: topic, resultCount: pitfalls.length });
      return {
        structured: { topic, topic_kind: kind, pitfalls },
        text,
      };
    }
  }

  // No direct match found — fall back to Qdrant semantic search filtered to pitfalls/ docs.
  // We use hybridSearch with a broader limit and filter client-side to source.startsWith("pitfalls/")
  // because QdrantService.hybridSearch filterSource does an exact match, not a prefix match.
  const qdrant = await getQdrant();
  const vec = await embed(topic);
  const raw = vec
    ? await qdrant.hybridSearch(vec, encodeSparse(topic), 20)
    : await qdrant.searchByText(topic, 20);

  const pitfallHits = raw
    .filter((r) => r.source.startsWith("pitfalls/"))
    .slice(0, 5);

  const search_results = pitfallHits.map((r) => ({
    source: r.source,
    section: r.section,
    text: r.text,
    score: r.score,
  }));

  const a = getAnalytics();
  a.logQuery({ tool: "c64_pitfalls_for", query: topic, resultCount: search_results.length });
  return {
    structured: { topic, topic_kind: "search", pitfalls: [], search_results },
    text: search_results.length > 0
      ? formatSearchFallbackText(topic, pitfallHits)
      : `No direct match for "${topic}" and no pitfall docs matched semantically. Try a register name (D012, $D012), KERNAL routine name, or technique name (stable_raster_irq). Use c64_search for fuzzy topic queries.`,
  };
}

export async function failureDiagnose(symptom: string): Promise<FailureDiagnoseResult> {
  const f = await getFalkor();

  const all = await f.roQuery(
    `MATCH (c:CrashPattern)
     RETURN c.symptom AS symptom, c.description AS description,
            c.likely_causes AS likely_causes, c.diagnosis_steps AS diagnosis_steps`
  );

  const queryTokens = symptom.toLowerCase().split(/[\s_-]+/).filter(t => t.length >= 3);

  const scored = (all.data as Array<{
    symptom: string;
    description: string;
    likely_causes: string;
    diagnosis_steps: string;
  }>).map(row => {
    const haystack = `${row.symptom} ${row.description} ${row.likely_causes}`.toLowerCase();
    const hits = queryTokens.filter(t => haystack.includes(t)).length;
    return {
      symptom: row.symptom ?? "",
      description: row.description ?? "",
      likely_causes_raw: row.likely_causes ?? "[]",
      diagnosis_steps: row.diagnosis_steps ?? "",
      score: hits / Math.max(queryTokens.length, 1),
    };
  });

  const ranked = scored
    .filter(s => s.score > 0)
    // Score desc, alphabetical tiebreak so equal-relevance matches sort
    // identically across runs.
    .sort((a, b) => b.score - a.score || a.symptom.localeCompare(b.symptom));

  const matches = await Promise.all(ranked.slice(0, 5).map(async (m) => {
    const edges = await f.roQuery(
      `MATCH (c:CrashPattern {symptom: $sym})-[:CAUSED_BY]->(t)
       RETURN t.name AS tname, labels(t)[0] AS tkind`,
      { sym: m.symptom }
    );
    const caused_by = (edges.data as Array<{ tname: string; tkind: string }>)
      .filter(e => e.tname && e.tkind)
      .map(e => ({ name: e.tname, kind: e.tkind as EntityKind }));

    let likely_causes: string[];
    try {
      likely_causes = JSON.parse(m.likely_causes_raw);
    } catch {
      likely_causes = [];
    }

    return {
      symptom: m.symptom,
      description: m.description,
      likely_causes,
      diagnosis_steps: m.diagnosis_steps,
      caused_by,
      relevance: m.score,
    };
  }));

  const a = getAnalytics();
  a.logQuery({ tool: "c64_failure_diagnose", query: symptom, resultCount: matches.length });
  return {
    structured: { query: symptom, matches },
    text: formatFailureDiagnoseText(symptom, matches),
  };
}

function formatSearchFallbackText(
  topic: string,
  results: Array<ChunkPayload & { score: number }>
): string {
  const lines = [`No direct entity match for "${topic}". Top pitfall-doc matches:`, ""];
  for (const r of results) {
    lines.push(`### ${r.source} — ${r.section} (score: ${r.score.toFixed(3)})`);
    lines.push(stripSectionPrefix(r.section, r.text).slice(0, 240).trim());
    lines.push("");
  }
  return lines.join("\n");
}

function formatPitfallsText(
  topic: string,
  kind: EntityKind,
  pitfalls: PitfallsForOutput["pitfalls"]
): string {
  if (pitfalls.length === 0) {
    return `No pitfalls found for ${kind} "${topic}".`;
  }
  const header = `Found ${pitfalls.length} pitfall(s) for ${kind} "${topic}":\n\n`;
  const rows = pitfalls.map(p => {
    const triggers = p.triggered_by.map(t => `${t.name} (${t.kind})`).join(", ");
    return (
      `### ${p.name} [${p.severity}, ${p.region}]\n` +
      `**${p.title}**\n` +
      `**Category:** ${p.category}\n` +
      (triggers ? `**Triggered by:** ${triggers}\n` : "")
    );
  });
  return header + rows.join("\n");
}

function formatFailureDiagnoseText(
  query: string,
  matches: FailureDiagnoseOutput["matches"]
): string {
  if (matches.length === 0) {
    return `No failure patterns matched "${query}". Try c64_search for broader lookup.`;
  }
  const header = `# Failure diagnosis: "${query}"\n\nTop ${matches.length} match(es):\n\n`;
  const rows = matches.map(m => {
    const causedBy = m.caused_by.map(c => `${c.name} (${c.kind})`).join(", ");
    return (
      `## ${m.symptom} (relevance: ${m.relevance.toFixed(2)})\n` +
      `${m.description}\n\n` +
      `**Likely causes:** ${m.likely_causes.join(", ")}\n\n` +
      `**Diagnosis:** ${m.diagnosis_steps}\n` +
      (causedBy ? `**Caused by:** ${causedBy}\n` : "")
    );
  });
  return header + rows.join("\n---\n\n");
}
