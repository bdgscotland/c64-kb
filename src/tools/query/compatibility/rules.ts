/**
 * The compatibility verdict as a pure function of the fetched facts: no
 * services, so every rule can be tested with facts built by hand.
 */

import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";
import { requiresClosure, type RequiresClosure } from "./closure.ts";
import { factsOf, inputPairs, pairKey, type CompatibilityFacts } from "./facts.ts";
import { hardRules, type BandSeparated, type HardRuleResult } from "./hard-rules.ts";
import { absorbInto, unitRules, type ClaimSide, type PairRelation, type UnitHit } from "./unit-rules.ts";

type Conflict = CompatibilityCheckOutput["conflicts"][number];
type Coverage = CompatibilityCheckOutput["data_coverage"][number];
type SharedInfrastructure = CompatibilityCheckOutput["shared_infrastructure"][number];

export interface CompatibilityEvaluation extends Omit<CompatibilityCheckOutput, "techniques"> {
  /** Techniques checked only because an input's REQUIRES chain reached them. */
  closureOnly: string[];
}

/** Accumulates band separations the way each rule call reported them. */
function mergeSeparated(list: BandSeparated[], s: BandSeparated | null): void {
  if (!s) return;
  const hit = list.find((x) => (x.a === s.a && x.b === s.b) || (x.a === s.b && x.b === s.a));
  if (!hit) {
    list.push({ ...s, rules: [...s.rules] });
    return;
  }
  for (const rule of s.rules) if (!hit.rules.includes(rule)) hit.rules.push(rule);
}

class RuleRunner {
  readonly separated: BandSeparated[] = [];
  private readonly all: CompatibilityFacts;
  constructor(all: CompatibilityFacts) {
    this.all = all;
  }
  run(a: string, b: string): HardRuleResult["hits"] {
    const r = hardRules({ name: a, facts: factsOf(this.all, a) }, { name: b, facts: factsOf(this.all, b) });
    mergeSeparated(this.separated, r.separated);
    return r.hits;
  }
  private side(name: string): ClaimSide {
    return { name, claims: factsOf(this.all, name).claims };
  }
  /**
   * The unit-claim rules (schema 25). `rel` says which of the pair requires
   * the other; `absorb` names, per side, the input an implied prerequisite
   * is seen from, whose held units it then does not claim again.
   */
  units(a: string, b: string, rel: PairRelation, absorb: { a?: string; b?: string } = {}): UnitHit[] {
    const sa = absorb.a ? absorbInto(this.side(a), this.side(absorb.a)) : this.side(a);
    const sb = absorb.b ? absorbInto(this.side(b), this.side(absorb.b)) : this.side(b);
    return unitRules(sa, sb, rel);
  }
}

const NO_RELATION: PairRelation = { aRequiresB: false, bRequiresA: false };

/**
 * Each input pair. Named techniques are checked as named, even when one
 * requires the other: the caller put both on the list, and the resolution
 * says how to keep them apart.
 */
function inputPairConflicts(
  all: CompatibilityFacts,
  closure: RequiresClosure,
  rules: RuleRunner,
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const { i, j, a, b } of inputPairs(all.techniques)) {
    // A named technique and its own prerequisite hold units together by
    // design; the unit rules are told which one requires the other.
    const rel = {
      aRequiresB: closure.closureOf(a).includes(b),
      bRequiresA: closure.closureOf(b).includes(a),
    };
    for (const h of rules.units(a, b, rel)) conflicts.push({ a, b, ...h });
    for (const h of rules.run(a, b)) {
      conflicts.push({
        a,
        b,
        kind: h.kind,
        severity: "hard",
        shared: h.shared,
        rationale: h.rationale,
        resolution: h.resolution,
      });
    }
    const regs = all.sharedRegisters.get(pairKey(i, j)) ?? [];
    if (regs.length > 0) {
      conflicts.push({
        a,
        b,
        kind: "shared_register",
        severity: "soft",
        shared: [...regs],
        rationale: `Both techniques touch register(s) ${regs.join(", ")}. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.`,
      });
    }
    const kernal = all.sharedKernal.get(pairKey(i, j)) ?? [];
    if (kernal.length > 0) {
      conflicts.push({
        a,
        b,
        kind: "shared_kernal",
        severity: "soft",
        shared: [...kernal],
        rationale: `Both techniques call KERNAL routine(s) ${kernal.join(", ")}. Concurrent use may clobber KERNAL state.`,
      });
    }
  }
  return conflicts;
}

/**
 * The closure members to test for input pair (x, y): x's implied techniques
 * against y, y's against x, and the two implied sets against each other. A
 * candidate is dropped when the other input declared it as its own
 * prerequisite too (the okOn sets).
 */
function closureCandidates(closure: RequiresClosure, x: string, y: string): [string, string][] {
  const cx = closure.closureOf(x);
  const cy = closure.closureOf(y);
  const okOnX = new Set([x, ...cx]);
  const okOnY = new Set([y, ...cy]);
  const fromX = cx.filter((u) => !okOnY.has(u));
  const fromY = cy.filter((v) => !okOnX.has(v));
  return [
    ...fromX.map((u): [string, string] => [u, y]),
    ...fromY.map((v): [string, string] => [x, v]),
    ...fromX.flatMap((u) => fromY.filter((v) => u !== v).map((v): [string, string] => [u, v])),
  ];
}

/**
 * Prerequisite closure. A technique is never reported against something
 * it says it runs on top of, from either direction: besides the okOn sets,
 * a pair is skipped when one member is on the other's own REQUIRES chain —
 * with ifli_image → fli_image → stable_raster_irq and stable_raster_irq
 * named, fli_image is not turned against the IRQ it declared. A hit is its
 * own kind, prerequisite_conflict, attributed to the input techniques with
 * the implied ones in `via`; no technique's demand set is changed by this.
 * The hard rules and the unit rules run here, the hit keeping its severity
 * and its rule in underlying_kind; shared registers between a prerequisite
 * and a named technique would be noise.
 */
function prerequisiteConflicts(
  all: CompatibilityFacts,
  closure: RequiresClosure,
  rules: RuleRunner,
): Conflict[] {
  const inputSet = new Set(all.techniques);
  // Two named techniques are the input loop's business, whichever chain
  // also reached them; and a pair where one declared the other as its
  // prerequisite is never checked.
  const skip = (u: string, v: string) =>
    (inputSet.has(u) && inputSet.has(v)) || closure.reaches(u, v) || closure.reaches(v, u);
  return inputPairs(all.techniques).flatMap(({ a: x, b: y }) =>
    closureCandidates(closure, x, y)
      .filter(([u, v]) => !skip(u, v))
      .flatMap(([u, v]) => closureConflicts({ closure, rules, input: [x, y], member: [u, v] })),
  );
}

/** Hard-rule hits between closure members u and v, attributed to inputs x and y. */
function closureConflicts(opts: {
  closure: RequiresClosure;
  rules: RuleRunner;
  input: [string, string];
  member: [string, string];
}): Conflict[] {
  const [x, y] = opts.input;
  const [u, v] = opts.member;
  const via = [u, v].filter((n) => n !== x && n !== y);
  const chains: string[] = [];
  if (u !== x) chains.push(opts.closure.describeChain(x, u));
  if (v !== y) chains.push(opts.closure.describeChain(y, v));
  const chainText = chains.join("; ");
  // An implied prerequisite's claims on units its input holds are the
  // input's (absorbInto); the input's own pair reports them.
  const absorb = { ...(u !== x ? { a: x } : {}), ...(v !== y ? { b: y } : {}) };
  const hits: (UnitHit | (HardRuleResult["hits"][number] & { severity: "hard" }))[] = [
    ...opts.rules.units(u, v, NO_RELATION, absorb),
    ...opts.rules.run(u, v).map((h) => ({ ...h, severity: "hard" as const })),
  ];
  return hits.map((h) => ({
    a: x,
    b: y,
    kind: "prerequisite_conflict",
    underlying_kind: h.kind,
    severity: h.severity,
    shared: h.shared,
    rationale: `${chainText}. ${h.rationale}`,
    resolution: h.resolution,
    via,
  }));
}

function verdictOf(conflicts: readonly Conflict[]): CompatibilityCheckOutput["verdict"] {
  if (conflicts.some((c) => c.severity === "hard")) return "incompatible";
  // info (init_order) says what order keeps a pair working; it does not warn.
  return conflicts.some((c) => c.severity === "soft") ? "warnings" : "compatible";
}

/**
 * What the graph holds for each technique, so a technique the graph knows
 * nothing about is named as such instead of passing as compatible.
 */
function dataCoverage(all: CompatibilityFacts, closure: RequiresClosure): Coverage[] {
  const coverageOf = (t: string): Coverage => {
    const F = factsOf(all, t);
    return {
      technique: t,
      found: F.found,
      registers: F.registers,
      kernal_routines: F.kernal.length,
      demands: [...F.demands].sort(),
      ...(F.band ? { raster_band: F.band } : {}),
      known:
        F.found &&
        (F.registers > 0 || F.kernal.length > 0 || F.demands.size > 0 || F.claimsStated !== "unknown"),
      claims: F.claimsStated,
    };
  };
  return [
    ...all.techniques.map(coverageOf),
    ...closure.closureOnly.map((c) => ({
      ...coverageOf(c),
      implied_by: [...(closure.impliedBy.get(c) ?? [])].sort(),
    })),
  ];
}

/** Register and KERNAL nodes shared through recipes that implement two or more inputs. */
function recipeInfrastructure(all: CompatibilityFacts): SharedInfrastructure[] {
  const byNode = new Map<string, { name: string; kind: "Register" | "KernalRoutine"; via: Set<string> }>();
  for (const use of all.recipeUses) {
    if (!use.name) continue;
    // Only surface Register and KernalRoutine nodes
    if (use.kind !== "Register" && use.kind !== "KernalRoutine") continue;
    const key = `${use.kind}:${use.name}`;
    const entry = byNode.get(key) ?? { name: use.name, kind: use.kind, via: new Set<string>() };
    entry.via.add(use.recipe);
    byNode.set(key, entry);
  }
  return [...byNode.values()].map((e) => ({ name: e.name, kind: e.kind, via_recipes: [...e.via] }));
}

/**
 * Raster-discipline heuristic: if two or more inputs have category=raster
 * or directly USE the screen-control / raster-line registers (D011/SCROLY
 * or D012/RASTER — both alias forms because of the Register-dedup issue
 * tracked as P5-15), one discipline entry.
 */
function needsRasterDiscipline(all: CompatibilityFacts): boolean {
  const raster = all.techniques.filter((t) => {
    const F = factsOf(all, t);
    return F.found && (F.category === "raster" || F.rasterRegisters > 0);
  });
  return raster.length >= 2;
}

function sharedInfrastructure(all: CompatibilityFacts, closure: RequiresClosure): SharedInfrastructure[] {
  // Prerequisites the set leans on without naming them. Not a conflict: a
  // note that the check included them, and that they have to be set up.
  const out: SharedInfrastructure[] = closure.closureOnly.map((c) => ({
    name: c,
    kind: "missing_prerequisite",
    via_recipes: [],
    required_by: [...(closure.impliedBy.get(c) ?? [])].sort(),
  }));
  if (all.techniques.length < 2) return out;
  out.push(...recipeInfrastructure(all));
  if (needsRasterDiscipline(all)) {
    out.push({ name: "raster_discipline", kind: "discipline", via_recipes: [] });
  }
  return out;
}

export function evaluateCompatibility(all: CompatibilityFacts): CompatibilityEvaluation {
  const closure = requiresClosure(all.techniques, all.requires);
  const rules = new RuleRunner(all);
  const conflicts = [
    ...inputPairConflicts(all, closure, rules),
    ...prerequisiteConflicts(all, closure, rules),
  ];
  return {
    conflicts,
    band_separated: rules.separated,
    shared_infrastructure: sharedInfrastructure(all, closure),
    data_coverage: dataCoverage(all, closure),
    verdict: verdictOf(conflicts),
    closureOnly: closure.closureOnly,
  };
}
