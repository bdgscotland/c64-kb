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
import { resolveArchetype, seedsFor, type ArchetypeResolution } from "./archetype.ts";
import { resolveProposedTechniques } from "./discovery.ts";
import { whyProposed } from "./why-proposed.ts";
import { collectPitfalls } from "./plan-pitfalls.ts";
import { toolchainSplit } from "./toolchain.ts";
import { buildOrder } from "./build-order.ts";
import { computeBudget } from "./budget.ts";
import { fetchBudgetMembers } from "../query/plan-budget.ts";
import { designsOfArchetype } from "../query/game-design.ts";
import { briefSummary, renderBriefingText } from "./render.ts";

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

function proposedOf(t: TechniqueLookupOutput, description: string): Proposed {
  // An empty or unknown complexity or region word is left out, as the
  // output schema allows only its enum values.
  const complexity = ComplexitySchema.safeParse(t.complexity || undefined);
  const region = RegionSchema.safeParse(t.requires_region);
  return {
    name: t.name,
    title: t.title,
    category: t.category,
    complexity: complexity.success ? complexity.data : undefined,
    why_proposed: whyProposed(t.name, t.category, description),
    uses_registers: t.uses_registers.map((r) => r.name),
    uses_kernal: t.uses_kernal.map((k) => k.name),
    region: region.success ? region.data : undefined,
    implementing_recipes: t.recipes.map((r) => r.name),
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
  const compatibility: BriefingOutput["compatibility"] = {
    conflicts: structured.conflicts.filter((c) => c.kind === "region_mismatch"),
    warnings: structured.conflicts.filter((c) => c.kind === "shared_register" || c.kind === "shared_kernal"),
    shared_infrastructure: structured.shared_infrastructure,
  };
  return { verdict: structured.verdict, compatibility };
}

async function proposeTechniques(
  description: string,
  archetype: string | undefined,
  resolved: ArchetypeResolution | undefined,
  isGame: boolean,
): Promise<TechniqueLookupOutput[]> {
  const seeds = seedsFor({ description, archetype, resolved, isGame });
  const proposalLimit = proposalLimitFor(description);
  const techNames = await resolveProposedTechniques(seeds.searchDescription, proposalLimit);
  // Prepend forced techniques so they survive the per-category MAX cap.
  for (const name of seeds.forced.slice().reverse()) {
    if (!techNames.includes(name)) techNames.unshift(name);
  }
  const enriched = await Promise.all(techNames.map(async (name) => (await techniqueLookup(name)).structured));
  return selectTechniques(enriched, seeds.archetypeForced, proposalLimit);
}

function archetypeFields(
  resolved: ArchetypeResolution | undefined,
): Pick<BriefingOutput, "archetype" | "archetype_not_found"> {
  if (resolved?.mode === "graph") {
    return {
      archetype: {
        ...resolved.archetype,
        features: resolved.features,
        risks: resolved.risks,
        ...(resolved.resolved_from ? { resolved_from: resolved.resolved_from } : {}),
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

export async function buildBriefing(
  description: string,
  archetype: string | undefined,
  isGame: boolean,
): Promise<BriefingResult> {
  const resolved =
    archetype !== undefined ? await resolveArchetype(archetype, isGame ? "game" : "demo") : undefined;
  const techs = await proposeTechniques(description, archetype, resolved, isGame);
  const techNames = techs.map((t) => t.name);

  const proposed_techniques = techs.map((t) => proposedOf(t, description));
  const { verdict, compatibility } = await compatibilityOf(techs);
  const pitfalls = await collectPitfalls(techNames, resolved?.mode === "graph" ? resolved.risks : []);
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
