/**
 * The briefing pipeline: resolve the archetype, propose techniques, look
 * each up, then check compatibility, gather pitfalls, split toolchains,
 * order the build, add up the budget and render.
 */

import { techniqueLookup, checkCompatibility } from "../query.ts";
import { getAnalytics } from "../../context.ts";
import {
  BriefingSchema,
  type BriefingOutput,
  type TechniqueLookupOutput,
} from "../../schemas/tool-outputs.ts";
import {
  archetypeRisks,
  describedReason,
  resolveArchetype,
  routeArchetypeFromBrief,
  seedsFor,
  type ArchetypeResolution,
} from "./archetype.ts";
import { contradictsBriefAxis, resolveProposedTechniques, unaskedEffect } from "./discovery.ts";
import { whyProposed } from "./why-proposed.ts";
import { oneOfEachAlternative, type LeftOut } from "./alternatives.ts";
import { collectPitfalls } from "./plan-pitfalls.ts";
import { toolchainSplit } from "./toolchain.ts";
import { buildOrder } from "./build-order.ts";
import { computeBudget } from "./budget.ts";
import { fetchBudgetMembers } from "../query/plan-budget.ts";
import { designsOfArchetype } from "../query/game-design.ts";
import { briefSummary, renderArchetype, renderBriefingText } from "./render.ts";

export type BriefingResult = { structured: BriefingOutput; text: string };

type Proposed = BriefingOutput["proposed_techniques"][number];
const ComplexitySchema = BriefingSchema.shape.proposed_techniques.element.shape.complexity;
const RegionSchema = BriefingSchema.shape.proposed_techniques.element.shape.region;

const MAX_PER_CATEGORY = 3;

/** A long, specific brief names more parts than a short one. Ten slots made a nine-part platformer brief drop its LFSR. */
function proposalLimitFor(description: string): number {
  const briefWords = description.split(/\s+/).filter(Boolean).length;
  if (briefWords >= 40) return 16;
  if (briefWords >= 20) return 13;
  return 10;
}

/**
 * Drop techniques the lookup did not find (empty name), cap at three per
 * category (P5-6), then cap the non-forced total at the proposal limit.
 * Archetype FEATURES pass both caps.
 */
function selectTechniques(
  enriched: TechniqueLookupOutput[],
  archetypeForced: Set<string>,
  proposalLimit: number,
): TechniqueLookupOutput[] {
  const categoryCounts = new Map<string, number>();
  let nonForced = 0;
  return enriched.filter((t) => {
    if (t.name === "") return false;
    if (archetypeForced.has(t.name)) return true;
    const cat = t.category || "_uncategorized";
    const count = categoryCounts.get(cat) ?? 0;
    if (count >= MAX_PER_CATEGORY || nonForced >= proposalLimit) return false;
    categoryCounts.set(cat, count + 1);
    nonForced++;
    return true;
  });
}

interface ReasonContext {
  description: string;
  resolved: ArchetypeResolution | undefined;
  isGame: boolean;
  leftOut: Map<string, LeftOut[]>;
}

/**
 * The reason a technique is in the plan: the archetype's fingerprint when
 * it forced it, then a description rule, else the brief's words.
 */
function reasonFor(t: TechniqueLookupOutput, ctx: ReasonContext) {
  const { description, resolved } = ctx;
  if (resolved?.mode === "graph" && resolved.features.includes(t.name)) {
    return `In the ${resolved.archetype.name} archetype's technique fingerprint`;
  }
  if (resolved?.mode === "ambiguous" && resolved.shared_features.includes(t.name)) {
    return `In the fingerprint of every archetype the brief fits (${resolved.candidates.join(", ")})`;
  }
  return (
    describedReason(t.name, description, ctx.isGame) ?? whyProposed(t.name, t.category, description, t.title)
  );
}

function proposedOf(t: TechniqueLookupOutput, ctx: ReasonContext): Proposed {
  // An empty or unknown complexity or region word is left out, as the
  // output schema allows only its enum values.
  const complexity = ComplexitySchema.safeParse(t.complexity || undefined);
  const region = RegionSchema.safeParse(t.requires_region);
  return {
    name: t.name,
    title: t.title,
    category: t.category,
    complexity: complexity.success ? complexity.data : undefined,
    why_proposed: reasonFor(t, ctx),
    uses_registers: t.uses_registers.map((r) => r.name),
    uses_kernal: t.uses_kernal.map((k) => k.name),
    region: region.success ? region.data : undefined,
    implementing_recipes: t.recipes.map((r) => r.name),
    ...(ctx.leftOut.has(t.name) ? { alternatives_left_out: ctx.leftOut.get(t.name) } : {}),
  };
}

async function compatibilityOf(techs: TechniqueLookupOutput[]) {
  if (techs.length < 2) {
    return {
      verdict: "compatible",
      compatibility: { conflicts: [], warnings: [], shared_infrastructure: [] },
    } satisfies { verdict: string; compatibility: BriefingOutput["compatibility"] };
  }
  const { structured } = await checkCompatibility(techs.map((t) => t.name));
  // Every hard conflict the verdict rests on, and every soft one. An earlier
  // version kept only region_mismatch and the shared-register/KERNAL kinds,
  // so a vertical_shmup plan read "incompatible" over a body of soft notes
  // (#41).
  const compatibility: BriefingOutput["compatibility"] = {
    conflicts: structured.conflicts.filter((c) => c.severity === "hard"),
    warnings: structured.conflicts.filter((c) => c.severity === "soft"),
    shared_infrastructure: structured.shared_infrastructure,
  };
  return { verdict: structured.verdict, compatibility };
}

async function proposeTechniques(
  description: string,
  archetype: string | undefined,
  resolved: ArchetypeResolution | undefined,
  isGame: boolean,
): Promise<{ techs: TechniqueLookupOutput[]; leftOut: Map<string, LeftOut[]> }> {
  const seeds = seedsFor({ description, archetype, resolved, isGame });
  const proposalLimit = proposalLimitFor(description);
  const techNames = await resolveProposedTechniques(
    seeds.searchDescription,
    proposalLimit,
    seeds.archetypeForced.size,
  );
  // Prepend forced techniques so they survive the per-category MAX cap.
  for (const name of seeds.forced.slice().reverse()) {
    if (!techNames.includes(name)) techNames.unshift(name);
  }
  const enriched = await Promise.all(techNames.map(async (name) => (await techniqueLookup(name)).structured));
  // A forced technique stays whatever its axis; a found one on the axis the
  // brief did not ask for goes, and so does, in a game plan, a demo effect
  // the brief does not name.
  const onAxis = enriched.filter(
    (t) =>
      seeds.forced.includes(t.name) ||
      !(
        contradictsBriefAxis(t, seeds.searchDescription) ||
        (isGame && unaskedEffect(t, seeds.searchDescription))
      ),
  );
  // One of each ALTERNATIVE_TO pair, before the caps, so a dropped
  // alternative frees its slot.
  const { kept, leftOut } = oneOfEachAlternative(onAxis, new Set(seeds.forced), description);
  const techs = selectTechniques(kept, seeds.archetypeForced, proposalLimit);
  return { techs, leftOut };
}

function archetypeFields(
  resolved: ArchetypeResolution | undefined,
): Pick<BriefingOutput, "archetype" | "archetype_not_found" | "archetype_candidates"> {
  if (resolved?.mode === "ambiguous") {
    const { candidates, from, shared_features, shared_risks } = resolved;
    return { archetype_candidates: { candidates, from, shared_features, shared_risks } };
  }
  if (resolved?.mode === "graph") {
    return {
      archetype: {
        ...resolved.archetype,
        features: resolved.features,
        risks: resolved.risks,
        ...(resolved.resolved_from ? { resolved_from: resolved.resolved_from } : {}),
        ...(resolved.inferred_from ? { inferred_from: resolved.inferred_from } : {}),
      },
    };
  }
  if (resolved?.mode === "not_found") {
    return {
      archetype_not_found: {
        requested: resolved.requested,
        known: resolved.known,
        ...(resolved.candidates ? { candidates: resolved.candidates } : {}),
      },
    };
  }
  return {};
}

/** The GameDesigns of a resolved archetype; absent when there are none. */
async function designFields(
  resolved: ArchetypeResolution | undefined,
): Promise<Pick<BriefingOutput, "designs">> {
  if (resolved?.mode !== "graph") return {};
  const designs = await designsOfArchetype(resolved.archetype.name);
  if (designs.length === 0) return {};
  return {
    designs: designs.map((d) => ({
      name: d.name,
      title: d.title,
      realised_by: d.realised_by,
      composes: d.composes,
      measured: d.measured.map((m) => ({ ...m, typical: m.typical ?? null })),
    })),
  };
}

/**
 * A named archetype is looked up. A game brief that names none is routed by
 * the archetypes' brief words; a demo brief that names none is not.
 */
async function resolutionFor(
  description: string,
  archetype: string | undefined,
  isGame: boolean,
): Promise<ArchetypeResolution | undefined> {
  if (archetype !== undefined) return resolveArchetype(archetype, isGame ? "game" : "demo");
  return isGame ? routeArchetypeFromBrief(description) : undefined;
}

/**
 * A named archetype the graph does not hold: no plan, only the names that
 * would work. An earlier version went on to plan from the brief's words
 * alone under the unknown name (#41).
 */
function refusal(
  description: string,
  resolved: Extract<ArchetypeResolution, { mode: "not_found" }>,
  isGame: boolean,
): BriefingResult {
  const kindWord = isGame ? "genre" : "form";
  const structured: BriefingOutput = {
    brief: `Refused: ${kindWord} "${resolved.requested}" is not an archetype the graph knows, so no plan was made for "${description}". Pass one of the known archetypes, or none to route the brief by its words.`,
    proposed_techniques: [],
    compatibility: { conflicts: [], warnings: [], shared_infrastructure: [] },
    pitfalls: [],
    toolchain_split: { primary: "oscar64", rationale: "No plan.", cycle_tight_handoff: [] },
    build_order: [],
    budget: computeBudget([]),
    ...archetypeFields(resolved),
  };
  const text = `# C64 ${isGame ? "Game" : "Demo"} Briefing\n\n**Brief:** ${structured.brief}\n\n${renderArchetype(structured)}`;
  return { structured, text };
}

export async function buildBriefing(
  description: string,
  archetype: string | undefined,
  isGame: boolean,
): Promise<BriefingResult> {
  const resolved = await resolutionFor(description, archetype, isGame);
  if (archetype !== undefined && resolved?.mode === "not_found")
    return refusal(description, resolved, isGame);
  const { techs, leftOut } = await proposeTechniques(description, archetype, resolved, isGame);
  const techNames = techs.map((t) => t.name);

  const proposed_techniques = techs.map((t) => proposedOf(t, { description, resolved, isGame, leftOut }));
  const { verdict, compatibility } = await compatibilityOf(techs);
  const pitfalls = await collectPitfalls(techNames, archetypeRisks(resolved));
  const toolchain_split = await toolchainSplit(techs);
  const { build_order, scaffoldPages } = await buildOrder({ techs, isGame, resolved, archetype });
  const budget = computeBudget(await fetchBudgetMembers(techNames.map((name) => ({ name, phase: "play" }))));

  const plan = { proposed_techniques, pitfalls, toolchain_split, budget };
  const structured: BriefingOutput = {
    brief: briefSummary({ description, isGame, resolved, archetype, plan, verdict }),
    proposed_techniques,
    compatibility,
    pitfalls,
    toolchain_split,
    build_order,
    budget,
    ...archetypeFields(resolved),
    ...(await designFields(resolved)),
  };

  getAnalytics().logQuery({
    tool: isGame ? "c64_game_briefing" : "c64_demo_briefing",
    query: description,
    resultCount: techs.length,
  });
  return { structured, text: renderBriefingText(structured, isGame, scaffoldPages) };
}
