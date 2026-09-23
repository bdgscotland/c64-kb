/**
 * What the compatibility rules read: everything the graph holds about the
 * techniques in a check, fetched once (fetch.ts) and then evaluated by
 * pure functions (rules.ts, closure.ts). Tests build these by hand.
 */

export interface TechniqueFacts {
  /** False when the graph has no Technique node of this name. */
  found: boolean;
  /** DEMANDS → Resource names. */
  demands: ReadonlySet<string>;
  /** Count of distinct USES → Register targets. */
  registers: number;
  /** USES → KernalRoutine names. */
  kernal: readonly string[];
  /** **Raster band:** in canonical form, or null. */
  band: string | null;
  /** REQUIRES_REGION, lower case ("pal", "ntsc"), or null. */
  region: string | null;
  category: string | null;
  /** How many of D011/D012/SCROLY/RASTER the technique USES. */
  rasterRegisters: number;
}

interface RecipeUse {
  name: string;
  kind: string;
  recipe: string;
}

export interface CompatibilityFacts {
  /** The techniques as named by the caller, in order. */
  techniques: readonly string[];
  /** Direct REQUIRES edges, sorted by target, for every technique reachable from the inputs. */
  requires: ReadonlyMap<string, readonly string[]>;
  /** Facts for every input and every technique reached through REQUIRES. */
  facts: ReadonlyMap<string, TechniqueFacts>;
  /** Registers both techniques of input pair (i, j) USE, keyed by pairKey(i, j). */
  sharedRegisters: ReadonlyMap<string, readonly string[]>;
  /** KERNAL routines both techniques of input pair (i, j) USE, keyed by pairKey(i, j). */
  sharedKernal: ReadonlyMap<string, readonly string[]>;
  /** Register and KERNAL nodes USEd by recipes that implement two or more inputs. */
  recipeUses: readonly RecipeUse[];
}

export function pairKey(i: number, j: number): string {
  return `${i}|${j}`;
}

/** Every (i, j) with i < j over a list, in row order. */
export function inputPairs<T>(items: readonly T[]): { i: number; j: number; a: T; b: T }[] {
  return items.flatMap((a, i) => items.slice(i + 1).map((b, k) => ({ i, j: i + 1 + k, a, b })));
}

const UNKNOWN_TECHNIQUE: TechniqueFacts = {
  found: false,
  demands: new Set(),
  registers: 0,
  kernal: [],
  band: null,
  region: null,
  category: null,
  rasterRegisters: 0,
};

export function factsOf(all: CompatibilityFacts, name: string): TechniqueFacts {
  return all.facts.get(name) ?? UNKNOWN_TECHNIQUE;
}
