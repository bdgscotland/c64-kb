/**
 * Query-parameter types and small helpers shared by the FalkorDB service.
 * The falkordb package does not export its QueryParams type, so it is
 * derived here once from Graph.query's signature.
 */

import type { Graph } from "falkordb";

export type QueryParams = NonNullable<NonNullable<Parameters<Graph["query"]>[1]>["params"]>;
type QueryParam = QueryParams[string];

/**
 * Check a caller's parameter record against what the client can serialise.
 * The client throws the same TypeError for anything else (undefined, a
 * function, a symbol), so this changes where the error is raised, not whether.
 */
function toQueryParam(value: unknown): QueryParam {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toQueryParam);
  if (typeof value === "object") return toQueryParams(value);
  throw new TypeError(`Unexpected param type ${typeof value}`);
}

export function toQueryParams(params: object): QueryParams {
  const out: QueryParams = {};
  for (const [key, value] of Object.entries(params)) out[key] = toQueryParam(value);
  return out;
}

/** "$D011" -> 0xD011; -1 when the string is not a 16-bit hex address (the graph stores -1, not null). */
export function hexAddr(s: string | undefined): number {
  if (!s) return -1;
  const m = /^\$?([0-9A-Fa-f]{1,4})$/.exec(s.trim());
  return m?.[1] ? parseInt(m[1], 16) : -1;
}

/** The numeric `n` column of the first row, or 0. */
export function firstCount(rows: readonly unknown[], column = "n"): number {
  const row = rows[0];
  if (typeof row !== "object" || row === null) return 0;
  const v: unknown = Reflect.get(row, column);
  return typeof v === "number" ? v : Number(v ?? 0);
}
