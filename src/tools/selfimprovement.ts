/**
 * Phase 7a self-improvement tools — coverage(), suggestLinks(), reportGap().
 *
 * coverage(): snapshot KB state across categories + recent gaps.
 * suggestLinks(): heuristic missing-edge suggestions (Phase 7a Task 4).
 * reportGap(): agent-facing gap recording (Phase 7a Task 5).
 */

import { getFalkor, getQdrant, getAnalytics } from "../context.ts";
import type { CoverageOutput, SuggestLinksOutput, ReportGapOutput } from "../schemas/tool-outputs.ts";

export async function coverage(): Promise<{ structured: CoverageOutput; text: string }> {
  const f = await getFalkor();
  const qd = await getQdrant();
  const an = getAnalytics();

  // FalkorDB dimensions
  const techCatRes = await f.roQuery(
    `MATCH (t:Technique) RETURN t.category AS category, count(*) AS count ORDER BY count DESC`
  );
  const pitCatRes = await f.roQuery(
    `MATCH (p:Pitfall) RETURN p.category AS category, count(*) AS count ORDER BY count DESC`
  );
  const recToolRes = await f.roQuery(
    `MATCH (r:Recipe) RETURN r.toolchain AS toolchain, count(*) AS count ORDER BY count DESC`
  );
  const kernalRes = await f.roQuery(
    `MATCH (k:KernalRoutine)
     OPTIONAL MATCH (k)-[:PAIRS_WITH]->(:KernalRoutine)
     WITH k, count(*) AS pairs
     RETURN count(k) AS total,
            sum(CASE WHEN pairs > 0 THEN 1 ELSE 0 END) AS withPairs`
  );
  const nodesRes = await f.roQuery(`MATCH (n) RETURN count(n) AS c`);
  const edgesRes = await f.roQuery(`MATCH ()-[r]->() RETURN count(r) AS c`);

  // Qdrant total via getStats()
  let qdrantChunks = 0;
  try {
    const stats = await qd.getStats();
    qdrantChunks = stats.total_points;
  } catch {
    qdrantChunks = 0;
  }

  // Analytics gaps
  const gaps = an.getRecentGaps(10);

  const structured: CoverageOutput = {
    dimensions: {
      technique_categories: (techCatRes.data ?? []) as Array<{ category: string; count: number }>,
      pitfall_categories: (pitCatRes.data ?? []) as Array<{ category: string; count: number }>,
      recipe_toolchains: (recToolRes.data ?? []) as Array<{ toolchain: string; count: number }>,
      kernal_coverage: {
        total_routines: (kernalRes.data?.[0] as any)?.total ?? 0,
        with_doc_chunks: (kernalRes.data?.[0] as any)?.total ?? 0,
        with_pairs_with_edge: (kernalRes.data?.[0] as any)?.withPairs ?? 0,
      },
    },
    totals: {
      qdrant_chunks: qdrantChunks,
      falkor_nodes: (nodesRes.data?.[0] as any)?.c ?? 0,
      falkor_edges: (edgesRes.data?.[0] as any)?.c ?? 0,
    },
    recent_gaps: gaps.map(g => ({
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
    ...c.dimensions.technique_categories.map(t => `- ${t.category}: ${t.count}`),
    ``,
    `## Pitfall categories`,
    ...c.dimensions.pitfall_categories.map(p => `- ${p.category}: ${p.count}`),
    ``,
    `## Recipe toolchains`,
    ...c.dimensions.recipe_toolchains.map(r => `- ${r.toolchain}: ${r.count}`),
    ``,
    `## KERNAL coverage`,
    `- Total routines: ${c.dimensions.kernal_coverage.total_routines}`,
    `- With PAIRS_WITH edge: ${c.dimensions.kernal_coverage.with_pairs_with_edge}`,
    ``,
    `## Recent gaps (top ${c.recent_gaps.length})`,
    ...c.recent_gaps.map(g =>
      `- "${g.query}" via ${g.tool} (hit ${g.hit_count}x, last ${g.last_seen})${g.user_reported ? " [user-reported]" : ""}`
    ),
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// suggestLinks — heuristic missing-edge detector (Phase 7a Task 4)
// ---------------------------------------------------------------------------


export interface SuggestLinksOptions {
  kind?: "technique-register" | "recipe-technique" | "pitfall-technique" | "all";
  limit?: number;
}

export async function suggestLinks(
  opts: SuggestLinksOptions = {}
): Promise<{ structured: SuggestLinksOutput; text: string }> {
  const kind = opts.kind ?? "all";
  const limit = opts.limit ?? 20;
  const f = await getFalkor();
  const qd = await getQdrant();

  const suggestions: SuggestLinksOutput["suggestions"] = [];

  if (kind === "all" || kind === "technique-register") {
    await collectTechniqueRegisterSuggestions(f, qd, suggestions, limit);
  }
  if ((kind === "all" || kind === "recipe-technique") && suggestions.length < limit) {
    await collectRecipeTechniqueSuggestions(f, qd, suggestions, limit);
  }
  if ((kind === "all" || kind === "pitfall-technique") && suggestions.length < limit) {
    await collectPitfallTechniqueSuggestions(f, qd, suggestions, limit);
  }

  const structured: SuggestLinksOutput = {
    suggestions: suggestions.slice(0, limit),
    generated_at: new Date().toISOString(),
  };

  const text = formatSuggestLinksText(structured);
  const an = getAnalytics();
  an.logQuery({
    tool: "c64_suggest_links",
    query: `kind=${kind} limit=${limit}`,
    resultCount: structured.suggestions.length,
  });
  return { structured, text };
}

/**
 * Derive a source doc path for a Technique from its category.
 * e.g. category "raster" → "techniques/raster.md"
 * Falls back to a per-name mapping for split-file categories.
 */
function techSourceDoc(category: string): string {
  // All technique category files are named after their category.
  return `techniques/${category}.md`;
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

async function collectTechniqueRegisterSuggestions(
  f: any,
  qd: any,
  suggestions: SuggestLinksOutput["suggestions"],
  limit: number
): Promise<void> {
  // Gather Register canonical names + their aliases so the heuristic
  // treats D011 and SCROLY as the same register (P5-15 dedup workaround).
  const regRes = await f.roQuery(
    `MATCH (r:Register) RETURN DISTINCT r.name AS name, r.aliases AS aliases`
  );
  const regRows = regRes.data as Array<{ name: string; aliases: string[] | null }>;
  if (regRows.length === 0) return;

  // Build an equivalence map: every alias maps to the same canonical key (the
  // sorted-and-joined set of all forms). This way, `D011` and `SCROLY` collapse
  // to the same key, and a technique with a USES edge to either form counts
  // as already-edged for both.
  const aliasGroupKey = new Map<string, string>();
  for (const row of regRows) {
    const forms = [row.name, ...(row.aliases ?? [])];
    const key = [...forms].sort().join("|");
    for (const f of forms) aliasGroupKey.set(f, key);
  }

  const techRes = await f.roQuery(
    `MATCH (t:Technique)
     OPTIONAL MATCH (t)-[:USES]->(reg:Register)
     RETURN t.name AS name, t.title AS title, t.category AS category, collect(reg.name) AS uses`
  );
  const techs = techRes.data as Array<{ name: string; title: string; category: string; uses: string[] }>;

  // Dedup key = `${tech.name}::${registerGroupKey}` so each unique missing-edge
  // surfaces once regardless of how many chunks evidence it.
  const seen = new Set<string>();

  for (const tech of techs) {
    if (suggestions.length >= limit) return;
    // Treat existing USES edges as covering the entire alias group.
    const usesGroups = new Set(
      tech.uses
        .filter((u): u is string => Boolean(u))
        .map(u => aliasGroupKey.get(u) ?? u)
    );

    const chunks = await fetchTechniqueChunks(qd, tech.name, tech.category);
    for (const ch of chunks) {
      if (suggestions.length >= limit) return;
      const text = (ch.text as string | undefined) ?? "";
      for (const row of regRows) {
        const groupKey = aliasGroupKey.get(row.name) ?? row.name;
        if (usesGroups.has(groupKey)) continue;
        const dedupKey = `${tech.name}::${groupKey}`;
        if (seen.has(dedupKey)) continue;
        // Look for any form (canonical or alias) in the chunk text.
        const forms = [row.name, ...(row.aliases ?? [])];
        const matched = forms.find(f => text.includes(f));
        if (matched) {
          const section = ((ch.section as string | undefined) ?? "").toLowerCase();
          const confidence: "high" | "medium" | "low" =
            section.includes("uses") || section.includes("registers") ? "high"
            : section.includes("technique") ? "medium" : "low";
          suggestions.push({
            kind: "technique_uses_register",
            from: { kind: "Technique", name: tech.name },
            to: { kind: "Register", name: row.name },
            evidence: text.slice(0, 150).trim(),
            confidence,
          });
          seen.add(dedupKey);
          break; // one suggestion per chunk
        }
      }
    }
  }
}

async function collectRecipeTechniqueSuggestions(
  f: any,
  qd: any,
  suggestions: SuggestLinksOutput["suggestions"],
  limit: number
): Promise<void> {
  const allTechRes = await f.roQuery(`MATCH (t:Technique) RETURN DISTINCT t.name AS name`);
  const allTechNames = (allTechRes.data as Array<{ name: string }>).map(t => t.name);
  if (allTechNames.length === 0) return;

  const recipesRes = await f.roQuery(
    `MATCH (r:Recipe)
     OPTIONAL MATCH (r)-[:IMPLEMENTS]->(t:Technique)
     RETURN r.name AS name, r.source_doc AS source_doc, collect(t.name) AS implements`
  );
  const recipes = recipesRes.data as Array<{ name: string; source_doc: string; implements: string[] }>;
  const seen = new Set<string>();

  for (const recipe of recipes) {
    if (suggestions.length >= limit) return;
    const chunks = await fetchRecipeChunks(qd, recipe.source_doc ?? "");
    for (const ch of chunks) {
      if (suggestions.length >= limit) return;
      const text = (ch.text as string | undefined) ?? "";
      for (const techName of allTechNames) {
        if (recipe.implements.includes(techName)) continue;
        const dedupKey = `${recipe.name}::${techName}`;
        if (seen.has(dedupKey)) continue;
        if (text.includes(techName)) {
          const section = ((ch.section as string | undefined) ?? "").toLowerCase();
          const confidence: "high" | "medium" | "low" =
            section.includes("implements") || section.includes("techniques") ? "high"
            : section.includes("recipe") ? "medium" : "low";
          suggestions.push({
            kind: "recipe_implements_technique",
            from: { kind: "Recipe", name: recipe.name },
            to: { kind: "Technique", name: techName },
            evidence: text.slice(0, 150).trim(),
            confidence,
          });
          seen.add(dedupKey);
          break;
        }
      }
    }
  }
}

async function collectPitfallTechniqueSuggestions(
  f: any,
  qd: any,
  suggestions: SuggestLinksOutput["suggestions"],
  limit: number
): Promise<void> {
  const allTechRes = await f.roQuery(`MATCH (t:Technique) RETURN DISTINCT t.name AS name`);
  const allTechNames = (allTechRes.data as Array<{ name: string }>).map(t => t.name);
  if (allTechNames.length === 0) return;

  const pitfallsRes = await f.roQuery(
    `MATCH (p:Pitfall)
     OPTIONAL MATCH (p)-[:TRIGGERED_BY]->(t:Technique)
     WITH p, collect(DISTINCT t.name) AS triggered_by
     OPTIONAL MATCH (p)-[:MITIGATED_BY]->(m:Technique)
     RETURN p.name AS name, p.category AS category, triggered_by, collect(DISTINCT m.name) AS mitigated_by`
  );
  const pitfalls = pitfallsRes.data as Array<{ name: string; category: string; triggered_by: string[]; mitigated_by: string[] }>;
  const seen = new Set<string>();

  for (const pitfall of pitfalls) {
    if (suggestions.length >= limit) return;
    const chunks = await fetchPitfallChunks(qd, pitfall.name, pitfall.category);
    for (const ch of chunks) {
      if (suggestions.length >= limit) return;
      const text = (ch.text as string | undefined) ?? "";
      const section = ((ch.section as string | undefined) ?? "").toLowerCase();
      // The chunker's heading path ends in the H3 ("... > name — title > Fix").
      // A technique named in the Fix is evidence for MITIGATED_BY, not for
      // TRIGGERED_BY: the two relations were conflated here until schema 19.
      const h3 = (section.split(">").pop() ?? "").trim();
      const isFix = h3.startsWith("fix");
      const kind = isFix ? "pitfall_mitigated_by_technique" : "pitfall_triggered_by_technique";
      const existing = isFix ? (pitfall.mitigated_by ?? []) : (pitfall.triggered_by ?? []);
      for (const techName of allTechNames) {
        if (existing.includes(techName)) continue;
        const dedupKey = `${pitfall.name}::${techName}::${kind}`;
        if (seen.has(dedupKey)) continue;
        if (text.includes(techName)) {
          const confidence: "high" | "medium" | "low" = isFix
            ? "medium"
            : section.includes("triggered") || section.includes("techniques") ? "high"
            : section.includes("pitfall") ? "medium" : "low";
          suggestions.push({
            kind,
            from: { kind: "Pitfall", name: pitfall.name },
            to: { kind: "Technique", name: techName },
            evidence: text.slice(0, 150).trim(),
            confidence,
          });
          seen.add(dedupKey);
          break;
        }
      }
    }
  }
}

/**
 * Fetch up to 5 Qdrant chunks for a technique.
 *
 * Strategy: use exact source-match scroll on `techniques/${category}.md`,
 * then client-side filter to chunks whose section mentions the tech name.
 * Falls back to all chunks from that source if none match by section.
 */
async function fetchTechniqueChunks(qd: any, techName: string, category: string): Promise<any[]> {
  try {
    const source = techSourceDoc(category);
    // scrollBySource does exact keyword-index match — fast and correct
    const all: any[] = await qd.scrollBySource(source, 50);
    // Prefer chunks whose section header contains the technique name
    const nameKey = techName.toLowerCase().replace(/_/g, "");
    const matched = all.filter((ch: any) => {
      const sec = ((ch.section as string | undefined) ?? "").toLowerCase().replace(/[\s_-]/g, "");
      return sec.includes(nameKey);
    });
    // Return up to 5; fall back to first chunks from the file if nothing specific
    return matched.length > 0 ? matched.slice(0, 5) : all.slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Fetch up to 5 Qdrant chunks for a recipe using its source_doc path.
 */
async function fetchRecipeChunks(qd: any, sourceDoc: string): Promise<any[]> {
  if (!sourceDoc) return [];
  try {
    return await qd.scrollBySource(sourceDoc, 5);
  } catch {
    return [];
  }
}

/**
 * Fetch up to 5 Qdrant chunks for a pitfall.
 *
 * Strategy: exact source-match on `pitfalls/${category-mapped-file}.md`,
 * then client-side filter to chunks mentioning the pitfall name.
 */
async function fetchPitfallChunks(qd: any, pitfallName: string, category: string): Promise<any[]> {
  try {
    const source = pitfallSourceDoc(category);
    const all: any[] = await qd.scrollBySource(source, 50);
    // Filter to chunks whose section matches the pitfall name
    const nameKey = pitfallName.toLowerCase().replace(/_/g, "");
    const matched = all.filter((ch: any) => {
      const sec = ((ch.section as string | undefined) ?? "").toLowerCase().replace(/[\s_-]/g, "");
      return sec.includes(nameKey);
    });
    return matched.length > 0 ? matched.slice(0, 5) : all.slice(0, 5);
  } catch {
    return [];
  }
}

function formatSuggestLinksText(s: SuggestLinksOutput): string {
  if (s.suggestions.length === 0) {
    return `# c64-kb Link Suggestions\n\nGenerated: ${s.generated_at}\n\nNo link suggestions surfaced. The graph may be well-connected, or the heuristics didn't fire.`;
  }
  const lines = [
    `# c64-kb Link Suggestions`,
    ``,
    `Generated: ${s.generated_at}`,
    ``,
  ];
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
  tool_called?: string;
  notes?: string;
}

export async function reportGap(
  opts: ReportGapOptions
): Promise<{ structured: ReportGapOutput; text: string }> {
  const an = getAnalytics();
  const result = an.reportGap(
    opts.query,
    opts.tool_called ?? "unknown",
    opts.notes
  );

  const structured: ReportGapOutput = {
    gap_id: result.gap_id,
    hit_count: result.hit_count,
    status: result.status,
    message: result.status === "new"
      ? `Gap recorded as id=${result.gap_id}. Hit count: ${result.hit_count}.`
      : `Existing gap ${result.gap_id} incremented to hit_count=${result.hit_count}.`,
  };

  return { structured, text: structured.message };
}
