/**
 * The compatibility verdict as a pure function of the fetched facts: no
 * services, so every rule can be tested with facts built by hand.
 */

import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";
import { requiresClosure, type RequiresClosure } from "./closure.ts";
import { factsOf, inputPairs, pairKey, type CompatibilityFacts } from "./facts.ts";
import { hardRules, type BandSeparated, type HardRuleResult, type Named } from "./hard-rules.ts";
import {
  absorbInto,
  CHAIN_HOST,
  unitRules,
  type ClaimSide,
  type PairRelation,
  type UnitHit,
} from "./unit-rules.ts";
import { clobberKey, kernalClobberRules, type KernalSide, type KernalZpHit } from "./kernal-zp-rule.ts";
import { recipeZeroPageRules } from "./recipe-rules.ts";
import { recipeDeviceRules } from "./device-rules.ts";
import { stateRules } from "./state-rules.ts";
import { placeBands } from "./placement.ts";

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
  private readonly closure: RequiresClosure;
  constructor(all: CompatibilityFacts, closure: RequiresClosure) {
    this.all = all;
    this.closure = closure;
  }
  private named(name: string): Named {
    return { name, facts: factsOf(this.all, name), requires: new Set(this.closure.closureOf(name)) };
  }
  run(a: string, b: string): HardRuleResult["hits"] {
    const r = hardRules(this.named(a), this.named(b));
    mergeSeparated(this.separated, r.separated);
    return r.hits;
  }
  private side(name: string): ClaimSide {
    const F = factsOf(this.all, name);
    return { name, claims: F.claims, band: F.band };
  }
  /**
   * The unit-claim rules (schema 25). `rel` says which of the pair requires
   * the other; `absorb` names, per side, the input an implied prerequisite
   * is seen from, whose held units it then does not claim again.
   */
  units(
    a: string,
    b: string,
    rel: PairRelation,
    absorb: { a?: string; b?: string } = {},
  ): (UnitHit | KernalZpHit)[] {
    const sa = absorb.a ? absorbInto(this.side(a), this.side(absorb.a)) : this.side(a);
    const sb = absorb.b ? absorbInto(this.side(b), this.side(absorb.b)) : this.side(b);
    const chainHosted = [...this.all.techniques, ...this.closure.closureOnly].includes(CHAIN_HOST);
    return [
      ...unitRules(sa, sb, { ...rel, chainHosted }),
      ...this.kernal(sa, sb, absorb.a ?? a, absorb.b ?? b),
    ];
  }
  /** Each routine hit reported so far, keyed by the inputs it is attributed to. */
  private readonly reported = new Set<string>();
  /**
   * kernal_clobbers_zp (schema 26) between two sides, attributed to inputs
   * `inA` and `inB`. A routine hit already reported for the same inputs,
   * routine and bytes is dropped: an input and its prerequisite that both
   * call CHROUT give one finding, not two.
   */
  kernal(sa: ClaimSide, sb: ClaimSide, inA: string, inB: string): KernalZpHit[] {
    const withKernal = (s: ClaimSide): KernalSide => ({ ...s, kernal: factsOf(this.all, s.name).kernal });
    const input = (n: string) => (n === sa.name ? inA : inB);
    return kernalClobberRules(
      withKernal(sa),
      withKernal(sb),
      this.all.kernalClobbers ?? new Map(),
      (user, holder, h) => {
        const key = clobberKey(input(user.name), input(holder.name), h);
        if (this.reported.has(key)) return false;
        this.reported.add(key);
        return true;
      },
    );
  }
  /** kernal_clobbers_zp between two techniques of one input's own chain. */
  ownChain(u: string, v: string, input: string): KernalZpHit[] {
    return this.kernal(this.side(u), this.side(v), input, input);
  }
}

const NO_RELATION: PairRelation = { aRequiresB: false, bRequiresA: false };

/**
 * Each input pair. Named techniques are checked as named, even when one
 * requires the other: the caller put both on the list, and the resolution
 * says how to keep them apart. The exception is cpu_exclusive and the
 * mid-frame cpu_vs_irq rule, which do not fire when one runs inside the
 * other's code (hard-rules.ts, runsInside; #29).
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
        severity: h.severity ?? "hard",
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
  const hits: (
    UnitHit | KernalZpHit | (Omit<HardRuleResult["hits"][number], "severity"> & { severity: "hard" | "soft" })
  )[] = [
    ...opts.rules.units(u, v, NO_RELATION, absorb),
    ...opts.rules.run(u, v).map((h) => ({ ...h, severity: h.severity ?? ("hard" as const) })),
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

/**
 * kernal_clobbers_zp inside one input's own chain: the input against
 * itself, against each technique its REQUIRES closure implies, and those
 * against each other. The unit rules do not run here, since a technique and
 * its prerequisite hold units together by design; a KERNAL call clobbers
 * zero page whoever declared the bytes. a and b are both the input. Other
 * named techniques are left to the input pairs.
 */
function ownChainConflicts(all: CompatibilityFacts, closure: RequiresClosure, rules: RuleRunner): Conflict[] {
  const inputSet = new Set(all.techniques);
  // A pair of implied techniques two inputs share is reported once.
  const done = new Set<string>();
  const out: Conflict[] = [];
  for (const x of all.techniques) {
    const chain = [x, ...closure.closureOf(x).filter((t) => !inputSet.has(t))];
    chain.forEach((u, i) => {
      for (const v of chain.slice(i)) {
        if (u !== x && v !== x) {
          if (done.has(`${u}|${v}`)) continue;
          done.add(`${u}|${v}`);
        }
        for (const h of rules.ownChain(u, v, x)) out.push(ownChainConflict(closure, x, [u, v], h));
      }
    });
  }
  return out;
}

function ownChainConflict(
  closure: RequiresClosure,
  x: string,
  members: [string, string],
  h: KernalZpHit,
): Conflict {
  const via = [...new Set(members.filter((n) => n !== x))];
  if (via.length === 0) return { a: x, b: x, ...h };
  const chainText = via.map((m) => closure.describeChain(x, m)).join("; ");
  return {
    a: x,
    b: x,
    kind: "prerequisite_conflict",
    underlying_kind: h.kind,
    severity: h.severity,
    shared: h.shared,
    rationale: `${chainText}. ${h.rationale}`,
    resolution: h.resolution,
    via,
  };
}

/**
 * The soft sprite_set note (a constant set's supplier, #90) once per input
 * pair: a prerequisite that claims the same sprites repeats it, and the
 * input pair's own note, listed first, already says it.
 */
function oneSupplierNote(conflicts: readonly Conflict[]): Conflict[] {
  const seen = new Set<string>();
  return conflicts.filter((c) => {
    if ((c.underlying_kind ?? c.kind) !== "sprite_set" || c.severity !== "soft") return true;
    const key = [c.a, c.b].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function verdictOf(
  conflicts: readonly Conflict[],
  notFound: readonly string[],
): CompatibilityCheckOutput["verdict"] {
  // A name the graph does not hold can conflict with nothing, so any other
  // verdict would clear it (#41: 17 names quoted as one came back COMPATIBLE).
  if (notFound.length > 0) return "unknown_technique";
  if (conflicts.some((c) => c.severity === "hard")) return "incompatible";
  // info (init_order) says what order keeps a pair working; it does not warn.
  return conflicts.some((c) => c.severity === "soft") ? "warnings" : "compatible";
}

/**
 * What the graph holds for each technique, so a technique the graph knows
 * nothing about is named as such instead of passing as compatible.
 */
function dataCoverage(
  all: CompatibilityFacts,
  given: CompatibilityFacts,
  closure: RequiresClosure,
): Coverage[] {
  const coverageOf = (t: string): Coverage => {
    const F = factsOf(all, t);
    const page = factsOf(given, t);
    return {
      technique: t,
      found: F.found,
      registers: F.registers,
      kernal_routines: F.kernal.length,
      demands: [...F.demands].sort(),
      ...(page.band ? { raster_band: page.band } : {}),
      ...(F.band && F.bandPlaced ? { placed_band: F.band } : {}),
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

export function evaluateCompatibility(given: CompatibilityFacts): CompatibilityEvaluation {
  // Placed bands (#90) replace movable or unstated ones before any rule reads a band.
  const placed = placeBands(given.facts, given.placements ?? new Map<string, string>());
  const all: CompatibilityFacts = { ...given, facts: placed.facts };
  const closure = requiresClosure(all.techniques, all.requires);
  const rules = new RuleRunner(all, closure);
  const conflicts = oneSupplierNote([
    ...inputPairConflicts(all, closure, rules),
    ...prerequisiteConflicts(all, closure, rules),
    ...ownChainConflicts(all, closure, rules),
    ...recipeZeroPageRules(all),
    ...recipeDeviceRules(all),
    ...inputPairs(all.techniques).flatMap(({ a, b }) =>
      stateRules({ name: a, facts: factsOf(all, a) }, { name: b, facts: factsOf(all, b) }, all),
    ),
  ]);
  const notFound = all.techniques.filter((t) => !factsOf(all, t).found);
  return {
    conflicts,
    band_separated: rules.separated,
    shared_infrastructure: sharedInfrastructure(all, closure),
    data_coverage: dataCoverage(all, given, closure),
    not_found: notFound,
    verdict: verdictOf(conflicts, notFound),
    ...(placed.refused.length > 0 ? { placements_refused: placed.refused } : {}),
    closureOnly: closure.closureOnly,
  };
}
