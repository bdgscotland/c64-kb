/**
 * What a refused name is, when it is not a technique (#19): a pitfall,
 * file format, recipe, register or any other named node. The refusal then
 * says which node type the name belongs to and, for a pitfall or recipe,
 * which techniques it points at, instead of only "no such technique".
 */

import { z } from "zod";
import { getFalkor } from "../../../context.ts";
import { parseRows } from "../shared.ts";

export interface IdentifiedName {
  /** The name as the caller passed it. */
  requested: string;
  /** The node's own spelling. */
  name: string;
  /** The node's label: Pitfall, FileFormat, Recipe, Register, Technique (case differs), ... */
  label: string;
  /** Techniques the node points at, as "TRIGGERED_BY:x", "MITIGATED_BY:x" or "IMPLEMENTS:x". */
  techniques: string[];
}

const Row = z.object({
  requested: z.string(),
  name: z.string(),
  label: z.string(),
  techniques: z.array(z.string().nullable()),
});

/** Every named node whose name matches a refused name, ignoring case. */
export async function identifyNames(names: readonly string[]): Promise<IdentifiedName[]> {
  if (names.length === 0) return [];
  const f = await getFalkor();
  const rows = parseRows(
    Row,
    await f.roQuery(
      `UNWIND $names AS requested
       MATCH (n) WHERE n.name IS NOT NULL AND toLower(n.name) = toLower(requested)
       OPTIONAL MATCH (n)-[r:TRIGGERED_BY|MITIGATED_BY|IMPLEMENTS]->(t:Technique)
       RETURN requested, n.name AS name, labels(n)[0] AS label,
              collect(DISTINCT type(r) + ':' + t.name) AS techniques
       ORDER BY label, name`,
      { names: [...new Set(names)] },
    ),
  );
  const order = (n: string) => names.indexOf(n);
  return rows
    .map((r) => ({ ...r, techniques: r.techniques.filter((t): t is string => Boolean(t)).sort() }))
    .sort((a, b) => order(a.requested) - order(b.requested));
}

/** Relation → the words the refusal uses, in the order it lists them. */
const RELATIONS: readonly (readonly [string, string])[] = [
  ["TRIGGERED_BY", "Arises in"],
  ["MITIGATED_BY", "Cured by"],
  ["IMPLEMENTS", "Implements"],
];

/** One sentence per identified node, for the refusal text. */
export function renderIdentified(found: readonly IdentifiedName[]): string {
  let out = "";
  for (const n of found) {
    if (n.label === "Technique") {
      out += `- \`${n.requested}\` is the technique \`${n.name}\`; pass it with that spelling.\n`;
      continue;
    }
    out += `- \`${n.requested}\` is a ${n.label} (\`${n.name}\`), not a technique.`;
    for (const [rel, words] of RELATIONS) {
      const techs = n.techniques.filter((t) => t.startsWith(`${rel}:`)).map((t) => t.slice(rel.length + 1));
      if (techs.length > 0) out += ` ${words}: ${techs.join(", ")}.`;
    }
    out += `\n`;
  }
  return out;
}
