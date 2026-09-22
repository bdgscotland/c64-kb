/**
 * Briefing tools — Phase 5 anchor tools.
 *
 * demoBriefing(description): one-shot structured demo plan — orchestrates
 *   search → techniqueLookup → checkCompatibility → pitfallsFor → build order.
 *
 * gameBriefing(description, archetype?): same but game-framed. The archetype
 *   is looked up as an Archetype node (docs/game-design/c64-game-archetypes.md,
 *   docs/CONVENTIONS-archetypes.md): its FEATURES targets are forced into the
 *   proposal, its RISKS targets into the pitfalls, and its title into the
 *   search. A name the graph does not have is reported as archetype_not_found
 *   with the known names. A graph with no Archetype nodes at all (the test
 *   fixtures) falls back to a small built-in table.
 *
 * These replace the manual 9-tool composition that a consuming agent had to
 * perform when using the c64_demo_brief / c64_game_brief MCP Prompts. One
 * tool call returns the full structured plan.
 */

import { search, techniqueLookup, checkCompatibility } from "./query.js";
import { pitfallsFor } from "./pitfalls.js";
import { getFalkor, getAnalytics } from "../context.js";
import type { BriefingOutput } from "../schemas/tool-outputs.js";

export type BriefingResult = { structured: BriefingOutput; text: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Given a Qdrant chunk section string like
 *   "Raster Techniques > stable_raster_irq — Stable raster IRQ"
 * extract the snake_case technique name ("stable_raster_irq").
 *
 * The technique-doc H2 format is: `## snake_name — Title`
 * After chunking, section becomes: `{H1} > {H2}` or just `{H2}`.
 */
function extractTechniqueNameFromSection(section: string): string | null {
  // Split on " > " and take the last segment (the H2 part)
  const parts = section.split(" > ");
  const leaf = parts[parts.length - 1].trim();
  // The leaf should be: "snake_name — Title" or "snake_name — Title ..."
  // Snake_case names use underscores and no spaces before " — "
  const dashIdx = leaf.indexOf(" — ");
  if (dashIdx === -1) return null;
  const candidate = leaf.slice(0, dashIdx).trim();
  // Validate: must be lowercase with underscores only (technique snake_case)
  if (/^[a-z][a-z0-9_]*$/.test(candidate)) return candidate;
  return null;
}

// Scene-tier signal words: when the brief explicitly mentions one of these,
// don't penalize high / scene-tier techniques (the user wants the exotic stuff).
const SCENE_TIER_KEYWORDS = [
  "sideborder", "open border", "open the border", "fli", "vsp", "dycp",
  "interlace", "twister", "rotozoom", "8580 vs", "6581 vs",
  "cycle-exact", "cycle exact", "scene tier", "advanced effect",
];

// Per-complexity penalty applied unless scene-tier signals appear.
// Reason: hybrid search ranks rare/scene-tier techniques higher (fewer chunks
// = less score dilution), so foundations like stable_raster_irq lose to
// exotic siblings like topbottom_border_open. The penalty rebalances.
const COMPLEXITY_PENALTY_NORMAL: Record<string, number> = {
  low: 0,
  medium: 0,
  high: 1.0,
  "scene-tier": 2.0,
};

/**
 * Query FalkorDB for all techniques and score them by keyword overlap
 * with the description PLUS implementation-evidence (recipe count) and
 * complexity. This is the primary technique-discovery source.
 *
 * Scoring (sum):
 *   - hits          : token overlap with name/title/category
 *   - categoryBonus : +0.5 if a token equals or substrings the category
 *   - nameBonus     : +0.5 if a token substrings the snake_case name
 *   - recipeBonus   : +1.5 if 2+ recipes implement; +0.75 if exactly 1
 *   - complexityPen : -1.0 (high), -2.0 (scene-tier) unless the brief
 *                     explicitly asks for scene-tier work
 *
 * The recipe bonus encodes "this technique is idiomatic enough that the KB
 * has multiple worked examples for it"; the complexity penalty counters the
 * vector-search bias toward rare-but-dense exotic technique pages.
 */
async function findTechniquesByKeyword(description: string): Promise<string[]> {
  const f = await getFalkor();
  const rows = await f.roQuery(
    `MATCH (t:Technique)
     OPTIONAL MATCH (r:Recipe)-[:IMPLEMENTS]->(t)
     RETURN t.name AS name, t.title AS title, t.category AS category,
            t.complexity AS complexity, count(r) AS recipe_count`
  );
  // Tokenize and also add stemmed variants (strip common suffixes like -ing, -er, -ers)
  const rawTokens = description.toLowerCase().split(/[\s_,+\-()]+/).filter(t => t.length >= 3);
  const tokens = Array.from(new Set([
    ...rawTokens,
    ...rawTokens.map(t => t.endsWith("ing") && t.length > 5 ? t.slice(0, -3) : t),
    ...rawTokens.map(t => t.endsWith("ers") && t.length > 5 ? t.slice(0, -3) : t),
    ...rawTokens.map(t => t.endsWith("er") && t.length > 5 ? t.slice(0, -2) : t),
    ...rawTokens.map(t => t.endsWith("s") && t.length > 4 ? t.slice(0, -1) : t),
  ])).filter(t => t.length >= 3);

  const descLower = description.toLowerCase();
  const wantsSceneTier = SCENE_TIER_KEYWORDS.some(k => descLower.includes(k));
  const complexityPenalty = wantsSceneTier
    ? { low: 0, medium: 0, high: 0, "scene-tier": 0 }
    : COMPLEXITY_PENALTY_NORMAL;

  // Score each technique
  const scored = (rows.data ?? []).map(row => {
    const r = row as {
      name: string;
      title: string;
      category: string;
      complexity: string;
      recipe_count: number | string;
    };
    const name = r.name.toLowerCase();
    const title = (r.title ?? "").toLowerCase();
    const category = (r.category ?? "").toLowerCase();
    const complexity = (r.complexity ?? "medium").toLowerCase();
    const haystack = `${name} ${title} ${category}`;
    const hits = tokens.filter(t => haystack.includes(t)).length;

    // Bonus: if a token directly matches the technique category
    const categoryBonus = tokens.some(t => category === t || category.includes(t)) ? 0.5 : 0;
    // Bonus: if a token is a substring of the technique name itself (strong match)
    const nameBonus = tokens.some(t => name.includes(t)) ? 0.5 : 0;

    // Recipe-evidence bonus: techniques with implementing recipes are more
    // idiomatic and should outrank exotic siblings with no worked example.
    const recipeCount = Number(r.recipe_count ?? 0);
    const recipeBonus = recipeCount >= 2 ? 1.5 : recipeCount >= 1 ? 0.75 : 0;

    // Complexity penalty: rebalance against vector-search's rare-page bias.
    const penalty = complexityPenalty[complexity] ?? 0;

    return { name: r.name, score: hits + categoryBonus + nameBonus + recipeBonus - penalty };
  });

  return scored
    .filter(s => s.score > 0)
    // Score descending; alphabetical tiebreak so equal-score ranks are
    // stable across runs (Array.sort is now stable in V8 but the input
    // order from the graph query is not guaranteed).
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 12)  // take top 12 from keyword to give merging more to work with
    .map(s => s.name);
}

/**
 * Resolve technique names from keyword scoring (primary) + vector search
 * (supplementary). Returns up to `limit` unique technique names ordered
 * by relevance.
 *
 * Strategy: keyword scoring includes recipe-count and complexity signals
 * (see findTechniquesByKeyword), so it picks idiomatic foundations over
 * exotic siblings — exactly the bias we want. Vector search fills in
 * semantically-related techniques the keyword scorer might miss.
 *
 * Prior to 2026-05-18 the order was reversed (vector-first, keyword-fills),
 * which produced briefings dominated by rare/scene-tier techniques because
 * vector similarity scores higher for rare technique pages.
 */
async function resolveProposedTechniques(
  description: string,
  limit: number = 8
): Promise<string[]> {
  // Run both sources in parallel for speed
  const [searchResult, fromKeyword] = await Promise.all([
    search(description, 20),
    findTechniquesByKeyword(description),
  ]);

  // 1. Collect technique names from vector search (technique-doc chunks only)
  const fromSearch: string[] = [];
  for (const hit of searchResult.structured.hits) {
    if (!hit.source.startsWith("techniques/")) continue;
    const name = extractTechniqueNameFromSection(hit.section);
    if (name && !fromSearch.includes(name)) {
      fromSearch.push(name);
    }
  }

  // 2. Merge: keyword names first (recipe + complexity weighted), then
  // vector names that aren't already included as a semantic supplement.
  const merged: string[] = [...fromKeyword];
  for (const name of fromSearch) {
    if (!merged.includes(name)) merged.push(name);
  }

  return merged.slice(0, limit);
}

/**
 * Determine a human-readable "why proposed" string for a technique
 * given the original description.
 */
export function whyProposed(techniqueName: string, category: string, description: string): string {
  const desc = description.toLowerCase();
  const name = techniqueName.toLowerCase();

  // Heuristics for common cases
  if (category === "music") {
    return "SID music / audio requested in brief";
  }
  if (category === "input") {
    return "Player input (joystick / keyboard) the brief's controls need";
  }
  if (category === "maths") {
    return "Arithmetic or lookup-table support the brief's mechanics need";
  }
  if (category === "logic") {
    return "Frame loop / game-state structure the brief needs";
  }
  if (category === "text") {
    return "Text, font or number display mentioned or implied in brief";
  }
  if (category === "io") {
    return "Disk load / save or persistence mentioned in brief";
  }
  if ((name.includes("scroll") || name.includes("soft_scroll")) &&
      (desc.includes("scroll") || desc.includes("scroller"))) {
    return "Scroller effect mentioned in brief";
  }
  if ((name.includes("sprite") || name.includes("multiplex")) &&
      (desc.includes("sprite") || desc.includes("24") || desc.includes("multiplexer") || desc.includes("enemy"))) {
    return "Sprite/multiplexer technique required for brief";
  }
  if ((name.includes("raster") || name.includes("bar") || name.includes("double_irq") || name.includes("stable_raster")) &&
      (desc.includes("raster") || desc.includes("bar") || desc.includes("color"))) {
    return "Raster color effect mentioned in brief";
  }
  if (name.includes("bitmap") && desc.includes("bitmap")) {
    return "Bitmap mode mentioned in brief";
  }
  if (name.includes("stable_raster")) {
    return "Prerequisite: all raster timing work needs stable IRQ foundation";
  }
  if (name.includes("effect") || name.includes("plasma") || name.includes("tunnel") || name.includes("starfield")) {
    return "Visual effect mentioned or implied in brief";
  }
  if (name.includes("loader") || name.includes("exomizer") || name.includes("krill")) {
    return "Loading / compression needed for multi-part work";
  }
  if (name === "text_mode_overlay_render") {
    return "Text-mode playfield + moving overlay is the foundation for any falling-piece / board / Tetris-like game";
  }
  return `Relevant to the brief: "${description.slice(0, 60)}"`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Archetype resolution against the graph. ---------------------------------

type ArchetypeRow = { name: string; title: string; kind: string };
type ArchetypeResolution =
  | { mode: "graph"; archetype: ArchetypeRow; features: string[]; risks: string[] }
  | { mode: "not_found"; requested: string; known: string[] }
  | { mode: "fallback" };

/** "Vertical Shmup" / "vertical-shmup" / "Vertical_Shmup" all read as vertical_shmup. */
export function normaliseArchetypeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Look the archetype up. When the graph holds no Archetype nodes at all
 * (fixture graphs, a store ingested before schema 21) the result is
 * "fallback" and the caller uses the built-in tables; a graph with
 * archetypes never falls back, so an unknown name is reported, not guessed.
 */
async function resolveArchetype(raw: string): Promise<ArchetypeResolution> {
  const fk = await getFalkor();
  const all = await fk.roQuery(
    `MATCH (a:Archetype) RETURN a.name AS name, a.title AS title, a.kind AS kind ORDER BY name`
  );
  const rows = ((all.data ?? []) as ArchetypeRow[]).filter(r => r.name);
  if (rows.length === 0) return { mode: "fallback" };
  const wanted = normaliseArchetypeName(raw);
  const hit = rows.find(r => r.name === wanted);
  if (!hit) return { mode: "not_found", requested: raw, known: rows.map(r => r.name) };
  const f = await fk.roQuery(
    `MATCH (a:Archetype {name: $name})-[:FEATURES]->(t:Technique) RETURN t.name AS name ORDER BY name`,
    { name: hit.name }
  );
  const r = await fk.roQuery(
    `MATCH (a:Archetype {name: $name})-[:RISKS]->(p:Pitfall) RETURN p.name AS name ORDER BY name`,
    { name: hit.name }
  );
  return {
    mode: "graph",
    archetype: { name: hit.name, title: hit.title ?? hit.name, kind: hit.kind ?? "game" },
    features: ((f.data ?? []) as Array<{ name: string }>).map(x => x.name),
    risks: ((r.data ?? []) as Array<{ name: string }>).map(x => x.name),
  };
}

// Built-in tables, used ONLY when the graph has no Archetype nodes. With the
// archetype page ingested (schema 21) the page is the source of truth and
// these are never read.
const FALLBACK_ARCHETYPE_TERMS: Record<string, string> = {
  shmup: "sprite multiplex scroll raster SID music shoot enemy",
  platformer: "sprite scroll character collision SID music jump",
  puzzle: "text mode overlay render playfield piece field character SID music logic",
  adventure: "text mode overlay render character scroll SID music KERNAL",
};
const FALLBACK_FORCED_TECHNIQUES: Record<string, string[]> = {
  puzzle: ["text_mode_overlay_render"],
  adventure: ["text_mode_overlay_render"],
};

export async function demoBriefing(description: string): Promise<BriefingResult> {
  return buildBriefing(description, undefined);
}

export async function gameBriefing(
  description: string,
  archetype?: string
): Promise<BriefingResult> {
  return buildBriefing(description, archetype);
}

async function buildBriefing(
  description: string,
  archetype: string | undefined
): Promise<BriefingResult> {
  const isGame = archetype !== undefined;

  // -------------------------------------------------------------------------
  // Step 1: Resolve proposed techniques
  // -------------------------------------------------------------------------
  // For game briefs the archetype comes from the graph: its title widens the
  // search, its FEATURES are forced into the proposal (they survive the
  // per-category cap below: the page authored them, the keyword scorer did
  // not guess them), its RISKS join the pitfalls. Only a graph with no
  // Archetype nodes reads the built-in tables.
  const resolved: ArchetypeResolution | undefined = archetype !== undefined
    ? await resolveArchetype(archetype)
    : undefined;
  let searchDescription = description;
  const forced: string[] = [];
  if (resolved?.mode === "graph") {
    searchDescription = `${description} ${resolved.archetype.title}`;
    forced.push(...resolved.features);
  } else if (resolved?.mode === "fallback" && archetype) {
    const key = archetype.toLowerCase();
    if (FALLBACK_ARCHETYPE_TERMS[key]) searchDescription = `${description} ${FALLBACK_ARCHETYPE_TERMS[key]}`;
    forced.push(...(FALLBACK_FORCED_TECHNIQUES[key] ?? []));
  }
  const archetypeForced = new Set(resolved?.mode === "graph" ? resolved.features : []);
  // Description-level signals that force specific techniques regardless of
  // archetype (e.g. a demo brief mentioning "text-mode playfield" should
  // still get the rendering pitfall surfaced).
  const FORCED_BY_DESCRIPTION_PATTERN: Array<{ pattern: RegExp; techniques: string[] }> = [
    {
      pattern: /\b(text[- ]mode|petscii|playfield|tetris|tetromino|sokoban|boulder dash|board game|falling (block|piece))\b/i,
      techniques: ["text_mode_overlay_render"],
    },
  ];
  for (const rule of FORCED_BY_DESCRIPTION_PATTERN) {
    if (rule.pattern.test(description)) {
      for (const t of rule.techniques) if (!forced.includes(t)) forced.push(t);
    }
  }

  const techNames = await resolveProposedTechniques(searchDescription, 10);
  // Prepend forced techniques so they survive the per-category MAX cap.
  for (const name of forced.slice().reverse()) {
    if (!techNames.includes(name)) techNames.unshift(name);
  }

  // -------------------------------------------------------------------------
  // Step 2: Enrich each technique via techniqueLookup
  // -------------------------------------------------------------------------
  const enriched = await Promise.all(
    techNames.map(async name => {
      const r = await techniqueLookup(name);
      return r.structured;
    })
  );

  // Filter out any that weren't found (empty name) and cap at 3 per category (P5-6)
  const MAX_PER_CATEGORY = 3;
  const categoryCounts = new Map<string, number>();
  const validTechs = enriched.filter(t => {
    if (t.name === "") return false;
    if (archetypeForced.has(t.name)) return true;
    const cat = t.category || "_uncategorized";
    const count = categoryCounts.get(cat) ?? 0;
    if (count >= MAX_PER_CATEGORY) return false;
    categoryCounts.set(cat, count + 1);
    return true;
  });

  // -------------------------------------------------------------------------
  // Step 3: Build proposed_techniques array
  // -------------------------------------------------------------------------
  const proposed_techniques: BriefingOutput["proposed_techniques"] = validTechs.map(t => ({
    name: t.name,
    title: t.title,
    category: t.category,
    complexity: (t.complexity || undefined) as BriefingOutput["proposed_techniques"][0]["complexity"],
    why_proposed: whyProposed(t.name, t.category, description),
    uses_registers: t.uses_registers.map(r => r.name),
    uses_kernal: t.uses_kernal.map(k => k.name),
    region: (t.requires_region ?? undefined) as BriefingOutput["proposed_techniques"][0]["region"],
    implementing_recipes: t.recipes.map(r => r.name),
  }));

  // -------------------------------------------------------------------------
  // Step 4: Compatibility check
  // -------------------------------------------------------------------------
  const compatResult = validTechs.length >= 2
    ? await checkCompatibility(validTechs.map(t => t.name))
    : { structured: { techniques: [], conflicts: [], shared_infrastructure: [], verdict: "compatible" as const } };

  const compatibility: BriefingOutput["compatibility"] = {
    conflicts: compatResult.structured.conflicts.filter(c => c.kind === "region_mismatch"),
    warnings: compatResult.structured.conflicts.filter(c => c.kind === "shared_register" || c.kind === "shared_kernal"),
    shared_infrastructure: compatResult.structured.shared_infrastructure,
  };

  // -------------------------------------------------------------------------
  // Step 5: Surface pitfalls (per-technique + per-register deduped)
  // -------------------------------------------------------------------------
  const seenPitfalls = new Set<string>();
  const pitfallsRaw: Array<{ name: string; title: string; severity: string; triggered_by_proposed: string[] }> = [];

  const perTech = await Promise.all(
    validTechs.map(async tech => ({
      techName: tech.name,
      result: await pitfallsFor(tech.name),
    }))
  );

  for (const { techName, result } of perTech) {
    for (const p of result.structured.pitfalls) {
      if (seenPitfalls.has(p.name)) continue;
      seenPitfalls.add(p.name);

      // Which of the proposed techniques triggered this pitfall?
      const triggeredByProposed = p.triggered_by
        .filter(tb => validTechs.some(vt => vt.name === tb.name))
        .map(tb => tb.name);

      pitfallsRaw.push({
        name: p.name,
        title: p.title,
        severity: p.severity,
        triggered_by_proposed: triggeredByProposed.length > 0 ? triggeredByProposed : [techName],
      });
    }
  }

  // The archetype's RISKS: pitfalls the page names for this shape of game,
  // added when no proposed technique already surfaced them.
  if (resolved?.mode === "graph" && resolved.risks.length > 0) {
    const fkRisks = await getFalkor();
    const rows = await fkRisks.roQuery(
      `MATCH (p:Pitfall) WHERE p.name IN $names
       OPTIONAL MATCH (p)-[:TRIGGERED_BY]->(t:Technique)
       RETURN p.name AS name, p.title AS title, p.severity AS severity, collect(t.name) AS triggers`,
      { names: resolved.risks }
    );
    for (const row of (rows.data ?? []) as Array<{ name: string; title: string; severity: string; triggers: string[] }>) {
      if (seenPitfalls.has(row.name)) continue;
      seenPitfalls.add(row.name);
      pitfallsRaw.push({
        name: row.name,
        title: row.title ?? "",
        severity: row.severity ?? "low",
        triggered_by_proposed: (row.triggers ?? []).filter(t => t && validTechs.some(vt => vt.name === t)),
      });
    }
  }

  // Sort by severity, then by name for stable across-run ordering.
  const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const pitfalls = pitfallsRaw.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4) ||
      a.name.localeCompare(b.name)
  );

  // -------------------------------------------------------------------------
  // Step 6: Toolchain split
  // -------------------------------------------------------------------------
  // The handoff is decided by what a technique DEMANDS of the machine (the
  // DEMANDS edges the compatibility checker already reads), not by its
  // category name. Deciding by category handed starfield (effect) to
  // assembly and sprite_multiplex_24 (sprite) to C, which was backwards.
  const CYCLE_TIGHT_DEMANDS = new Set([
    "cpu_every_line", "midframe_raster_irqs", "continuous_interrupts", "badline_free_region", "changes_sprite_set",
  ]);
  const fk = await getFalkor();
  const demandRows = validTechs.length
    ? await fk.roQuery(
        `MATCH (t:Technique)-[:DEMANDS]->(r:Resource) WHERE t.name IN $names
         RETURN t.name AS name, collect(r.name) AS demands`,
        { names: validTechs.map(t => t.name) }
      )
    : { data: [] as unknown[] };
  const demandsOf = new Map<string, string[]>();
  for (const row of (demandRows.data ?? []) as Array<{ name: string; demands: string[] }>) {
    demandsOf.set(row.name, (row.demands ?? []).filter(Boolean));
  }
  const cycloTightTechs = validTechs.filter(
    t => (demandsOf.get(t.name) ?? []).some(d => CYCLE_TIGHT_DEMANDS.has(d)) || t.complexity === "scene-tier"
  );
  const cycle_tight_handoff = cycloTightTechs.map(t => t.name);

  const toolchain_split: BriefingOutput["toolchain_split"] = {
    primary: "oscar64",
    cycle_tight_handoff,
    rationale:
      "Oscar64 is the primary toolchain per c64-kb policy (modern C/C++ → 6502, idiomatic patterns). " +
      (cycle_tight_handoff.length > 0
        ? `KickAssembler handles cycle-tight work for: ${cycle_tight_handoff.join(", ")} ` +
          `(each demands the CPU every line, raster interrupts inside the display, interrupts all frame, a badline-free region or a changing sprite set, or is scene-tier).`
        : "No technique in this set demands cycle-exact timing of the machine — Oscar64 can handle all components."),
  };

  // -------------------------------------------------------------------------
  // Step 7: Build order
  // -------------------------------------------------------------------------
  // Group techniques by category and assign steps in dependency order:
  // 1. Foundation (raster/IRQ prerequisites)
  // 2. Hardware setup (banking, memory layout)
  // 3. Visual effects (sprites, scroll, bitmap, effects)
  // 4. Audio (music, SID)
  // 5. Loader/compression (last — wrap everything)
  const STEP_PRIORITY: Record<string, number> = {
    raster: 1,
    banking: 2,
    cpu: 2,
    input: 2,
    maths: 2,
    sprite: 3,
    scroll: 3,
    bitmap: 3,
    effect: 3,
    render: 3,
    logic: 3,
    text: 3,
    music: 4,
    loader: 5,
    io: 5,
  };

  const grouped = new Map<number, typeof validTechs>();
  for (const tech of validTechs) {
    const priority = STEP_PRIORITY[tech.category] ?? 3;
    if (!grouped.has(priority)) grouped.set(priority, []);
    grouped.get(priority)!.push(tech);
  }

  const STEP_LABELS: Record<number, string> = {
    1: "Raster IRQ foundation",
    2: "Memory layout, banking, input and maths",
    3: "Visual / text-mode rendering and game logic",
    4: "SID audio",
    5: "Loader, compression and file I/O",
  };

  const build_order: BriefingOutput["build_order"] = [];
  let stepNum = 1;

  // Add a game scaffold step for game briefs
  if (isGame) {
    // The one seed recipe the corpus has is the shmup scaffold; it is offered
    // when the archetype (graph name or fallback key) is a shmup and the
    // recipe node exists. No other archetype has a scaffold recipe yet.
    // In the not-found case the label says "generic": the graph did not
    // recognise the name, so the scaffold must not be labelled with it.
    const archetypeKey = resolved?.mode === "graph"
      ? resolved.archetype.name
      : resolved?.mode === "not_found" ? "" : (archetype ?? "").toLowerCase();
    let scaffoldRecipes: string[] = [];
    if (/shmup/.test(archetypeKey)) {
      const rr = await fk.roQuery(`MATCH (r:Recipe {name: "oscar64-simple-shmup"}) RETURN r.name AS name`);
      if ((rr.data?.length ?? 0) > 0) scaffoldRecipes = ["oscar64-simple-shmup"];
    }
    build_order.push({
      step: stepNum++,
      label: `Game scaffold (${archetypeKey || "generic"} archetype)`,
      recipes: scaffoldRecipes,
    });
  }

  for (const [priority, techs] of Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])) {
    const recipes = techs.flatMap(t => t.recipes.map(r => r.name));
    build_order.push({
      step: stepNum++,
      label: STEP_LABELS[priority] ?? `${techs[0].category} techniques`,
      recipes: [...new Set(recipes)],
    });
  }

  // -------------------------------------------------------------------------
  // Step 8: Compose brief summary text
  // -------------------------------------------------------------------------
  const archetypeLabel = resolved?.mode === "graph"
    ? ` (genre: ${resolved.archetype.name}, ${resolved.archetype.title})`
    : resolved?.mode === "not_found"
      ? ` (genre "${archetype}" is not an archetype the graph knows)`
      : archetype ? ` (genre: ${archetype})` : "";
  const brief =
    `C64 ${isGame ? "game" : "demo"} plan for: "${description}"${archetypeLabel}. ` +
    `Proposed ${proposed_techniques.length} technique(s) across ${new Set(proposed_techniques.map(t => t.category)).size} categories. ` +
    `Compatibility: ${compatResult.structured.verdict}. ` +
    `Pitfalls to watch: ${pitfalls.length}. ` +
    `Toolchain: Oscar64 primary${cycle_tight_handoff.length > 0 ? `, KickAssembler for ${cycle_tight_handoff.length} cycle-tight component(s)` : ""}.`;

  const structured: BriefingOutput = {
    brief,
    proposed_techniques,
    compatibility,
    pitfalls,
    toolchain_split,
    build_order,
    ...(resolved?.mode === "graph"
      ? { archetype: { ...resolved.archetype, features: resolved.features, risks: resolved.risks } }
      : {}),
    ...(resolved?.mode === "not_found"
      ? { archetype_not_found: { requested: resolved.requested, known: resolved.known } }
      : {}),
  };

  // -------------------------------------------------------------------------
  // Step 9: Render human-readable text
  // -------------------------------------------------------------------------
  const text = renderBriefingText(structured, description, archetype);

  const a = getAnalytics();
  a.logQuery({
    tool: archetype !== undefined ? "c64_game_briefing" : "c64_demo_briefing",
    query: description,
    resultCount: validTechs.length,
  });

  return { structured, text };
}

function renderBriefingText(
  b: BriefingOutput,
  description: string,
  archetype: string | undefined
): string {
  const isGame = archetype !== undefined;
  let out = `# C64 ${isGame ? "Game" : "Demo"} Briefing\n\n`;
  out += `**Brief:** ${b.brief}\n\n`;
  if (b.archetype_not_found) {
    out += `**Archetype not found:** "${b.archetype_not_found.requested}". Known archetypes: ${b.archetype_not_found.known.join(", ")}\n\n`;
  }
  if (b.archetype) {
    out += `**Archetype:** ${b.archetype.name} (${b.archetype.title}, ${b.archetype.kind})\n`;
    out += `Fingerprint: ${b.archetype.features.join(", ") || "(none)"}\n`;
    out += `Common pitfalls: ${b.archetype.risks.join(", ") || "(none)"}\n\n`;
  }

  out += `## Proposed Techniques (${b.proposed_techniques.length})\n\n`;
  out += `| Name | Category | Complexity | Why |\n|------|----------|------------|-----|\n`;
  for (const t of b.proposed_techniques) {
    out += `| ${t.name} | ${t.category} | ${t.complexity ?? "-"} | ${t.why_proposed} |\n`;
  }

  if (b.proposed_techniques.length > 0) {
    out += `\n### Register + KERNAL dependencies\n\n`;
    for (const t of b.proposed_techniques) {
      const regs = t.uses_registers.length > 0 ? t.uses_registers.join(", ") : "(none)";
      const kernal = t.uses_kernal.length > 0 ? t.uses_kernal.join(", ") : "(none)";
      out += `- **${t.name}**: registers [${regs}], KERNAL [${kernal}]\n`;
    }
  }

  out += `\n## Compatibility\n\n`;
  const allConflicts = [...b.compatibility.conflicts, ...b.compatibility.warnings];
  if (allConflicts.length === 0) {
    out += `No conflicts detected.\n`;
  } else {
    for (const c of allConflicts) {
      out += `- **${c.kind}**: ${c.a} × ${c.b} — ${c.rationale}\n`;
    }
  }
  if (b.compatibility.shared_infrastructure.length > 0) {
    out += `\n**Shared infrastructure:** `;
    out += b.compatibility.shared_infrastructure.map((s: { name: string }) => s.name).join(", ") + "\n";
  }

  out += `\n## Pitfalls to Avoid (${b.pitfalls.length})\n\n`;
  if (b.pitfalls.length === 0) {
    out += `No specific pitfalls identified.\n`;
  } else {
    for (const p of b.pitfalls) {
      out += `- **[${p.severity.toUpperCase()}]** ${p.name}: ${p.title}\n`;
      out += `  Triggered by: ${p.triggered_by_proposed.length > 0 ? p.triggered_by_proposed.join(", ") : "(archetype risk; no proposed technique triggers it)"}\n`;
    }
  }

  out += `\n## Toolchain Split\n\n`;
  out += `**Primary:** ${b.toolchain_split.primary}\n`;
  out += `${b.toolchain_split.rationale}\n`;
  if (b.toolchain_split.cycle_tight_handoff.length > 0) {
    out += `**KickAssembler handoff:** ${b.toolchain_split.cycle_tight_handoff.join(", ")}\n`;
  }

  out += `\n## Build Order\n\n`;
  for (const step of b.build_order) {
    out += `${step.step}. **${step.label}**`;
    if (step.recipes.length > 0) {
      out += ` → recipes: ${step.recipes.join(", ")}`;
    }
    out += `\n`;
  }

  return out;
}
