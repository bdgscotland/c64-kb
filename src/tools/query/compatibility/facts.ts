/**
 * What the compatibility rules read: everything the graph holds about the
 * techniques in a check, fetched once (fetch.ts) and then evaluated by
 * pure functions (rules.ts, closure.ts). Tests build these by hand.
 */

import type { Claim } from "../../../graph/claims.ts";
import type { RecipeDevice } from "./device-rules.ts";
import type { RecipeZeroPage } from "./recipe-rules.ts";
import type { RecipeKernalOut, SerialPitfall } from "./state-rules.ts";

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
  /** CLAIMS edges (schema 25), sorted by unit. */
  claims: readonly Claim[];
  /** "unknown" when the page has no usable Claims line; never read as "none". */
  claimsStated: "stated" | "none" | "unknown";
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
  /** CLOBBERS_ZP may sets (schema 26), canonical ranges, for every KERNAL routine a checked technique USES. */
  kernalClobbers?: ReadonlyMap<string, string>;
  /** Owned zero page of every recipe that IMPLEMENTS an input (schema 34). */
  recipeZeroPage?: readonly RecipeZeroPage[];
  /** Devices required (REQUIRES_DEVICE, schema 36) by every recipe that IMPLEMENTS an input. */
  recipeDevices?: readonly RecipeDevice[];
  /** The serial-I/O pitfalls and the KERNAL routines that trigger them (#94). */
  serialPitfalls?: readonly SerialPitfall[];
  /** Recipes that build an input and run with the KERNAL out (#94). */
  recipeKernalOut?: readonly RecipeKernalOut[];
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
  claims: [],
  claimsStated: "unknown",
};

export function factsOf(all: CompatibilityFacts, name: string): TechniqueFacts {
  return all.facts.get(name) ?? UNKNOWN_TECHNIQUE;
}
