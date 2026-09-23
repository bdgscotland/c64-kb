/**
 * Phase 7a self-improvement tools — coverage(), suggestLinks(), reportGap().
 *
 * coverage(): snapshot KB state across categories + recent gaps.
 * suggestLinks(): heuristic missing-edge suggestions (Phase 7a Task 4).
 * reportGap(): agent-facing gap recording (Phase 7a Task 5).
 */

import { z } from "zod";
import { getFalkor, getQdrant, getAnalytics } from "../context.ts";
import type { FalkorService } from "../services/falkor.ts";
import type { ChunkPayload, QdrantService } from "../services/qdrant.ts";
import type { CoverageOutput, SuggestLinksOutput, ReportGapOutput } from "../schemas/tool-outputs.ts";

// ---------------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------------

const CategoryCount = z.object({ category: z.string(), count: z.number() });
const ToolchainCount = z.object({ toolchain: z.string(), count: z.number() });
// An aggregate over no rows can come back null; the old reads defaulted it to 0.
const KernalTotals = z.object({ total: z.number().nullish(), withPairs: z.number().nullish() });
const Count = z.object({ c: z.number().nullish() });

/** The first row of a one-row aggregate, validated; undefined when there is none. */
async function one<S extends z.ZodType>(
  f: FalkorService,
  cypher: string,
  schema: S,
): Promise<z.output<S> | undefined> {
  return (await f.roQuery(cypher, undefined, schema)).data[0];
}

/** Qdrant's point count. A failure leaves the snapshot's other figures standing, reported as 0. */
async function qdrantPoints(qd: QdrantService): Promise<number> {
  try {
    return (await qd.getStats()).total_points;
  } catch (err) {
    console.error(`[coverage] Qdrant stats unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

async function graphDimensions(f: FalkorService): Promise<CoverageOutput["dimensions"]> {
  const techniques = await f.roQuery(
    `MATCH (t:Technique) RETURN t.category AS category, count(*) AS count ORDER BY count DESC`,
    undefined,
    CategoryCount,
  );
  const pitfalls = await f.roQuery(
    `MATCH (p:Pitfall) RETURN p.category AS category, count(*) AS count ORDER BY count DESC`,
    undefined,
    CategoryCount,
  );
  const recipes = await f.roQuery(
    `MATCH (r:Recipe) RETURN r.toolchain AS toolchain, count(*) AS count ORDER BY count DESC`,
    undefined,
    ToolchainCount,
  );
  const kernal = await one(
    f,
    `MATCH (k:KernalRoutine)
     OPTIONAL MATCH (k)-[:PAIRS_WITH]->(:KernalRoutine)
     WITH k, count(*) AS pairs
     RETURN count(k) AS total,
            sum(CASE WHEN pairs > 0 THEN 1 ELSE 0 END) AS withPairs`,
    KernalTotals,
  );
  return {
    technique_categories: techniques.data,
    pitfall_categories: pitfalls.data,
    recipe_toolchains: recipes.data,
    kernal_coverage: {
      total_routines: kernal?.total ?? 0,
      with_doc_chunks: kernal?.total ?? 0,
      with_pairs_with_edge: kernal?.withPairs ?? 0,
    },
  };
}

export async function coverage(): Promise<{ structured: CoverageOutput; text: string }> {
  const f = await getFalkor();
  const qd = await getQdrant();
  const an = getAnalytics();

  const dimensions = await graphDimensions(f);
  const nodes = await one(f, `MATCH (n) RETURN count(n) AS c`, Count);
  const edges = await one(f, `MATCH ()-[r]->() RETURN count(r) AS c`, Count);

  const structured: CoverageOutput = {
    dimensions,
    totals: {
      qdrant_chunks: await qdrantPoints(qd),
      falkor_nodes: nodes?.c ?? 0,
      falkor_edges: edges?.c ?? 0,
    },
    recent_gaps: an.getRecentGaps(10).map((g) => ({
      query: g.query,
      tool: g.tool,
      hit_count: g.hit_count,
      last_seen: g.last_seen,
      user_reported: g.user_reported,
    })),
    generated_at: new Date().toISOString(),
  };

  const text = formatCoverageText(structured);
  an.logQuery({ tool: "c64_coverage", query: "snapshot", resultCount: 1 });
  return { structured, text };
}

function formatCoverageText(c: CoverageOutput): string {
  const lines = [
    `# c64-kb Coverage Snapshot`,
    ``,
    `Generated: ${c.generated_at}`,
    ``,
    `## Totals`,
    `- Qdrant chunks: ${c.totals.qdrant_chunks}`,
    `- FalkorDB nodes: ${c.totals.falkor_nodes}`,
    `- FalkorDB edges: ${c.totals.falkor_edges}`,
    ``,
    `## Technique categories`,
    ...c.dimensions.technique_categories.map((t) => `- ${t.category}: ${t.count}`),
    ``,
    `## Pitfall categories`,
    ...c.dimensions.pitfall_categories.map((p) => `- ${p.category}: ${p.count}`),
    ``,
    `## Recipe toolchains`,
    ...c.dimensions.recipe_toolchains.map((r) => `- ${r.toolchain}: ${r.count}`),
    ``,
    `## KERNAL coverage`,
    `- Total routines: ${c.dimensions.kernal_coverage.total_routines}`,
    `- With PAIRS_WITH edge: ${c.dimensions.kernal_coverage.with_pairs_with_edge}`,
    ``,
    `## Recent gaps (top ${c.recent_gaps.length})`,
    ...c.recent_gaps.map(
      (g) =>
        `- "${g.query}" via ${g.tool} (hit ${g.hit_count}x, last ${g.last_seen})${g.user_reported ? " [user-reported]" : ""}`,
    ),
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// suggestLinks — heuristic missing-edge detector (Phase 7a Task 4)
// ---------------------------------------------------------------------------

export interface SuggestLinksOptions {
  kind?: "technique-register" | "recipe-technique" | "pitfall-technique" | "all" | undefined;
  limit?: number | undefined;
}

type Suggestion = SuggestLinksOutput["suggestions"][number];
type Confidence = Suggestion["confidence"];

/** A node a chunk may mention. `key` identifies it for exclusion and dedup; `forms` are the strings to look for. */
interface Target {
  name: string;
  key: string;
  forms: readonly string[];
}

/** What one chunk of an entity's doc implies: the edge kind, the targets already linked, the confidence. */
interface ChunkContext {
  kind: Suggestion["kind"];
  exclude: ReadonlySet<string>;
  confidence: Confidence;
  /** Appended to the dedup key, so one pair can surface once per edge kind. */
  tag: string;
}

/**
 * One heuristic: for each entity, read its doc chunks and suggest an edge to
 * the first target a chunk names that the graph does not already link.
 */
interface LinkHeuristic<E extends { name: string }> {
  fromKind: string;
  toKind: string;
  entities: readonly E[];
  targets: readonly Target[];
  chunks: (e: E) => Promise<ChunkPayload[]>;
  context: (e: E, section: string) => ChunkContext;
}

/** The first new edge this chunk evidences, if any (one suggestion per chunk). */
function suggestFromChunk<E extends { name: string }>(
  h: LinkHeuristic<E>,
  e: E,
  ch: ChunkPayload,
  seen: Set<string>,
): Suggestion | null {
  const ctx = h.context(e, ch.section.toLowerCase());
  for (const t of h.targets) {
    if (ctx.exclude.has(t.key)) continue;
    const dedupKey = `${e.name}::${t.key}${ctx.tag}`;
    if (seen.has(dedupKey)) continue;
    if (!t.forms.some((form) => ch.text.includes(form))) continue;
    seen.add(dedupKey);
    return {
      kind: ctx.kind,
      from: { kind: h.fromKind, name: e.name },
      to: { kind: h.toKind, name: t.name },
      evidence: ch.text.slice(0, 150).trim(),
      confidence: ctx.confidence,
    };
  }
  return null;
}

async function runHeuristic<E extends { name: string }>(
  h: LinkHeuristic<E>,
  out: Suggestion[],
  limit: number,
): Promise<void> {
  // Each unique missing edge surfaces once however many chunks evidence it.
  const seen = new Set<string>();
  for (const e of h.entities) {
    if (out.length >= limit) return;
    for (const ch of await h.chunks(e)) {
      if (out.length >= limit) return;
      const s = suggestFromChunk(h, e, ch, seen);
      if (s) out.push(s);
    }
  }
}

/** "high" when the section names one of `high`, "medium" when it names `medium`, else "low". */
function sectionConfidence(section: string, high: readonly string[], medium: string): Confidence {
  if (high.some((w) => section.includes(w))) return "high";
  return section.includes(medium) ? "medium" : "low";
}

/**
 * Up to `n` chunks of one source doc. With `nameHint`, chunks whose section
 * names the entity come first; without a match, the file's first chunks.
 * A failed scroll is reported on stderr and gives no chunks.
 */
async function docChunks(
  qd: QdrantService,
  source: string,
  opts: { n: number; nameHint?: string },
): Promise<ChunkPayload[]> {
  let all: ChunkPayload[];
  try {
    // scrollBySource does exact keyword-index match — fast and correct
    all = await qd.scrollBySource(source, opts.nameHint ? 50 : opts.n);
  } catch (err) {
    console.error(
      `[suggest-links] cannot read chunks of ${source}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
  if (!opts.nameHint) return all;
  const nameKey = opts.nameHint.toLowerCase().replace(/_/g, "");
  const matched = all.filter((ch) =>
    ch.section
      .toLowerCase()
      .replace(/[\s_-]/g, "")
      .includes(nameKey),
  );
  return (matched.length > 0 ? matched : all).slice(0, opts.n);
}

/**
 * Derive a source doc path for a Pitfall from its category.
 * The pitfalls/ directory uses different naming conventions for some files.
 */
function pitfallSourceDoc(category: string): string {
  const PITFALL_FILE_MAP: Record<string, string> = {
    raster: "raster-and-badline.md",
    kernal: "kernal-and-io.md",
    region: "region-timing.md",
  };
  const file = PITFALL_FILE_MAP[category] ?? `${category}.md`;
  return `pitfalls/${file}`;
}

const RegisterRow = z.object({ name: z.string(), aliases: z.array(z.string()).nullable() });
const TechniqueUsesRow = z.object({
  name: z.string(),
  category: z.string(),
  uses: z.array(z.string().nullable()),
});
const NameRow = z.object({ name: z.string() });
const RecipeRow = z.object({
  name: z.string(),
  source_doc: z.string().nullable(),
  implements: z.array(z.string()),
});
const PitfallRow = z.object({
  name: z.string(),
  category: z.string(),
  triggered_by: z.array(z.string()),
  mitigated_by: z.array(z.string()),
});

async function techniqueTargets(f: FalkorService): Promise<Target[]> {
  const rows = await f.roQuery(`MATCH (t:Technique) RETURN DISTINCT t.name AS name`, undefined, NameRow);
  return rows.data.map(({ name }) => ({ name, key: name, forms: [name] }));
}

/**
 * TECHNIQUE USES REGISTER. Registers are grouped with their aliases, so D011
 * and SCROLY are one target and a USES edge to either covers both (P5-15
 * dedup workaround).
 */
async function techniqueRegisterHeuristic(
  f: FalkorService,
  qd: QdrantService,
): Promise<LinkHeuristic<{ name: string; category: string; usesGroups: Set<string> }>> {
  const regs = await f.roQuery(
    `MATCH (r:Register) RETURN DISTINCT r.name AS name, r.aliases AS aliases`,
    undefined,
    RegisterRow,
  );
  // Every form maps to one key: the sorted, joined set of all the register's forms.
  const groupOf = new Map<string, string>();
  const targets = regs.data.map((r) => {
    const forms = [r.name, ...(r.aliases ?? [])];
    const key = [...forms].sort().join("|");
    for (const form of forms) groupOf.set(form, key);
    return { name: r.name, key, forms };
  });
  // Re-key after all groups are known: a later row can claim an earlier row's form.
  for (const t of targets) t.key = groupOf.get(t.name) ?? t.name;

  const techs = await f.roQuery(
    `MATCH (t:Technique)
     OPTIONAL MATCH (t)-[:USES]->(reg:Register)
     RETURN t.name AS name, t.title AS title, t.category AS category, collect(reg.name) AS uses`,
    undefined,
    TechniqueUsesRow,
  );
  const entities = techs.data.map((t) => ({
    name: t.name,
    category: t.category,
    usesGroups: new Set(t.uses.filter((u): u is string => Boolean(u)).map((u) => groupOf.get(u) ?? u)),
  }));
  return {
    fromKind: "Technique",
    toKind: "Register",
    entities: targets.length === 0 ? [] : entities,
    targets,
    chunks: (t) => docChunks(qd, `techniques/${t.category}.md`, { n: 5, nameHint: t.name }),
    context: (t, section) => ({
      kind: "technique_uses_register",
      exclude: t.usesGroups,
      confidence: sectionConfidence(section, ["uses", "registers"], "technique"),
      tag: "",
    }),
  };
}

/** RECIPE IMPLEMENTS TECHNIQUE: a technique name in the recipe's own page. */
async function recipeTechniqueHeuristic(
  f: FalkorService,
  qd: QdrantService,
): Promise<LinkHeuristic<{ name: string; sourceDoc: string; implemented: Set<string> }>> {
  const targets = await techniqueTargets(f);
  const recipes = await f.roQuery(
    `MATCH (r:Recipe)
     OPTIONAL MATCH (r)-[:IMPLEMENTS]->(t:Technique)
     RETURN r.name AS name, r.source_doc AS source_doc, collect(t.name) AS implements`,
    undefined,
    RecipeRow,
  );
  return {
    fromKind: "Recipe",
    toKind: "Technique",
    entities:
      targets.length === 0
        ? []
        : recipes.data.map((r) => ({
            name: r.name,
            sourceDoc: r.source_doc ?? "",
            implemented: new Set(r.implements),
          })),
    targets,
    chunks: (r) => (r.sourceDoc ? docChunks(qd, r.sourceDoc, { n: 5 }) : Promise.resolve([])),
    context: (r, section) => ({
      kind: "recipe_implements_technique",
      exclude: r.implemented,
      confidence: sectionConfidence(section, ["implements", "techniques"], "recipe"),
      tag: "",
    }),
  };
}

/**
 * PITFALL TRIGGERED_BY / MITIGATED_BY TECHNIQUE. The chunker's heading path
 * ends in the H3 ("... > name — title > Fix"). A technique named in the Fix
 * is evidence for MITIGATED_BY, not for TRIGGERED_BY: the two relations were
 * conflated here until schema 19.
 */
async function pitfallTechniqueHeuristic(
  f: FalkorService,
  qd: QdrantService,
): Promise<
  LinkHeuristic<{ name: string; category: string; triggeredBy: Set<string>; mitigatedBy: Set<string> }>
> {
  const targets = await techniqueTargets(f);
  const pitfalls = await f.roQuery(
    `MATCH (p:Pitfall)
     OPTIONAL MATCH (p)-[:TRIGGERED_BY]->(t:Technique)
     WITH p, collect(DISTINCT t.name) AS triggered_by
     OPTIONAL MATCH (p)-[:MITIGATED_BY]->(m:Technique)
     RETURN p.name AS name, p.category AS category, triggered_by, collect(DISTINCT m.name) AS mitigated_by`,
    undefined,
    PitfallRow,
  );
  return {
    fromKind: "Pitfall",
    toKind: "Technique",
    entities:
      targets.length === 0
        ? []
        : pitfalls.data.map((p) => ({
            name: p.name,
            category: p.category,
            triggeredBy: new Set(p.triggered_by),
            mitigatedBy: new Set(p.mitigated_by),
          })),
    targets,
    chunks: (p) => docChunks(qd, pitfallSourceDoc(p.category), { n: 5, nameHint: p.name }),
    context: (p, section) => {
      const isFix = (section.split(">").pop() ?? "").trim().startsWith("fix");
      const kind = isFix ? "pitfall_mitigated_by_technique" : "pitfall_triggered_by_technique";
      return {
        kind,
        exclude: isFix ? p.mitigatedBy : p.triggeredBy,
        confidence: isFix ? "medium" : sectionConfidence(section, ["triggered", "techniques"], "pitfall"),
        tag: `::${kind}`,
      };
    },
  };
}

export async function suggestLinks(
  opts: SuggestLinksOptions = {},
): Promise<{ structured: SuggestLinksOutput; text: string }> {
  const kind = opts.kind ?? "all";
  const limit = opts.limit ?? 20;
  const f = await getFalkor();
  const qd = await getQdrant();

  const suggestions: Suggestion[] = [];
  if (kind === "all" || kind === "technique-register") {
    await runHeuristic(await techniqueRegisterHeuristic(f, qd), suggestions, limit);
  }
  if ((kind === "all" || kind === "recipe-technique") && suggestions.length < limit) {
    await runHeuristic(await recipeTechniqueHeuristic(f, qd), suggestions, limit);
  }
  if ((kind === "all" || kind === "pitfall-technique") && suggestions.length < limit) {
    await runHeuristic(await pitfallTechniqueHeuristic(f, qd), suggestions, limit);
  }

  const structured: SuggestLinksOutput = {
    suggestions: suggestions.slice(0, limit),
    generated_at: new Date().toISOString(),
  };

  const text = formatSuggestLinksText(structured);
  getAnalytics().logQuery({
    tool: "c64_suggest_links",
    query: `kind=${kind} limit=${limit}`,
    resultCount: structured.suggestions.length,
  });
  return { structured, text };
}

function formatSuggestLinksText(s: SuggestLinksOutput): string {
  if (s.suggestions.length === 0) {
    return `# c64-kb Link Suggestions\n\nGenerated: ${s.generated_at}\n\nNo link suggestions surfaced. The graph may be well-connected, or the heuristics didn't fire.`;
  }
  const lines = [`# c64-kb Link Suggestions`, ``, `Generated: ${s.generated_at}`, ``];
  for (const sug of s.suggestions) {
    lines.push(`## ${sug.kind} (${sug.confidence})`);
    lines.push(`- ${sug.from.kind} \`${sug.from.name}\` → ${sug.to.kind} \`${sug.to.name}\``);
    lines.push(`- Evidence: "${sug.evidence}"`);
    lines.push(``);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// reportGap — agent-facing gap recorder (Phase 7a Task 5)
// ---------------------------------------------------------------------------

export interface ReportGapOptions {
  query: string;
  tool_called?: string | undefined;
  notes?: string | undefined;
}

export function reportGap(opts: ReportGapOptions): Promise<{ structured: ReportGapOutput; text: string }> {
  const result = getAnalytics().reportGap(opts.query, opts.tool_called ?? "unknown", opts.notes);

  const structured: ReportGapOutput = {
    gap_id: result.gap_id,
    hit_count: result.hit_count,
    status: result.status,
    message:
      result.status === "new"
        ? `Gap recorded as id=${result.gap_id}. Hit count: ${result.hit_count}.`
        : `Existing gap ${result.gap_id} incremented to hit_count=${result.hit_count}.`,
  };

  return Promise.resolve({ structured, text: structured.message });
}
