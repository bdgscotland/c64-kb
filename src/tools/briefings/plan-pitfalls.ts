/**
 * The briefing's pitfall list: each proposed technique's pitfalls, then the
 * archetype's RISKS, de-duplicated and ordered by severity.
 */

import { pitfallsFor } from "../pitfalls.ts";
import { getFalkor } from "../../context.ts";
import type { BriefingOutput } from "../../schemas/tool-outputs.ts";
import { parseRows, presentNames, RiskPitfallRow } from "./rows.ts";

type PlanPitfall = BriefingOutput["pitfalls"][number];

const SEVERITY_ORDER = new Map<string, number>([
  ["critical", 0],
  ["high", 1],
  ["medium", 2],
  ["low", 3],
]);

async function perTechniquePitfalls(techNames: string[], seen: Set<string>): Promise<PlanPitfall[]> {
  const proposed = new Set(techNames);
  const perTech = await Promise.all(
    techNames.map(async (techName) => ({ techName, result: await pitfallsFor(techName) })),
  );
  const out: PlanPitfall[] = [];
  for (const { techName, result } of perTech) {
    for (const p of result.structured.pitfalls) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      // Which of the proposed techniques triggered this pitfall?
      const triggeredByProposed = p.triggered_by.filter((tb) => proposed.has(tb.name)).map((tb) => tb.name);
      out.push({
        name: p.name,
        title: p.title,
        severity: p.severity,
        triggered_by_proposed: triggeredByProposed.length > 0 ? triggeredByProposed : [techName],
      });
    }
  }
  return out;
}

/**
 * The archetype's RISKS: pitfalls the page names for this shape of game,
 * added when no proposed technique already surfaced them.
 */
async function archetypeRiskPitfalls(
  risks: string[],
  techNames: string[],
  seen: Set<string>,
): Promise<PlanPitfall[]> {
  if (risks.length === 0) return [];
  const fk = await getFalkor();
  const result = await fk.roQuery(
    `MATCH (p:Pitfall) WHERE p.name IN $names
     OPTIONAL MATCH (p)-[:TRIGGERED_BY]->(t:Technique)
     RETURN p.name AS name, p.title AS title, p.severity AS severity, collect(t.name) AS triggers`,
    { names: risks },
  );
  const proposed = new Set(techNames);
  const out: PlanPitfall[] = [];
  for (const row of parseRows(RiskPitfallRow, result.data)) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    out.push({
      name: row.name,
      title: row.title ?? "",
      severity: row.severity ?? "low",
      triggered_by_proposed: presentNames(row.triggers).filter((t) => proposed.has(t)),
    });
  }
  return out;
}

/** Per-technique pitfalls first, then archetype risks; sorted by severity, then name. */
export async function collectPitfalls(techNames: string[], archetypeRisks: string[]): Promise<PlanPitfall[]> {
  const seen = new Set<string>();
  const fromTechs = await perTechniquePitfalls(techNames, seen);
  const fromRisks = await archetypeRiskPitfalls(archetypeRisks, techNames, seen);
  const rank = (s: string) => SEVERITY_ORDER.get(s) ?? 4;
  return [...fromTechs, ...fromRisks].sort(
    (a, b) => rank(a.severity) - rank(b.severity) || a.name.localeCompare(b.name),
  );
}
