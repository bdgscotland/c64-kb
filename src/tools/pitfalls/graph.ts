/**
 * Graph reads for pitfallsFor. FalkorDB rows come back as `unknown`; each is
 * read through a zod schema here, with null properties typed as missing.
 */

import { z } from "zod";
import type { FalkorService } from "../../services/falkor.ts";
import { registerKey } from "../query/shared.ts";
import type { PitfallsForOutput } from "../../schemas/tool-outputs.ts";

export type EntityKind = "Register" | "KernalRoutine" | "Technique" | "LibraryFunction";
type Pitfall = PitfallsForOutput["pitfalls"][number];
type Via = NonNullable<Pitfall["via"]>[number];
type Severity = Pitfall["severity"];
type Region = Pitfall["region"];

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
const SeveritySchema = z.enum(SEVERITY_ORDER);
const RegionSchema = z.enum(["pal", "ntsc", "both"]);
const KindSchema = z.enum(["Register", "KernalRoutine", "Technique"]);

const PitfallRow = z.object({
  name: z.string(),
  title: z.string().nullish(),
  severity: z.string().nullish(),
  region: z.string().nullish(),
  category: z.string().nullish(),
});
type PitfallRow = z.infer<typeof PitfallRow>;
const ViaRow = PitfallRow.extend({ via: z.array(z.string()).nullish() });
const EdgeRow = z.object({ tname: z.string().nullish(), tkind: z.string().nullish() });

const severityRank = (s: string | null | undefined): number => {
  const i = (SEVERITY_ORDER as readonly (string | null | undefined)[]).indexOf(s);
  return i < 0 ? SEVERITY_ORDER.length : i;
};

// Values outside the enum cannot occur on an ingested graph: the extractor
// lower-cases both fields and defaults them to medium / both.
const severityOf = (s: string | null | undefined): Severity => {
  const r = SeveritySchema.safeParse(s);
  return r.success ? r.data : "low";
};
const regionOf = (s: string | null | undefined): Region => {
  const r = RegionSchema.safeParse(s);
  return r.success ? r.data : "both";
};

export function normalizeKey(kind: EntityKind, topic: string): string {
  if (kind === "Register") return registerKey(topic);
  if (kind === "KernalRoutine") return topic.toUpperCase();
  // C names keep their case (vic_waitLine); the match is case-insensitive.
  if (kind === "LibraryFunction") return topic.trim();
  return topic.toLowerCase().replace(/[- ]/g, "_");
}

/** Pitfalls with a direct TRIGGERED_BY (or, for a technique, MITIGATED_BY) edge to the topic. */
export async function directPitfalls(f: FalkorService, kind: EntityKind, key: string): Promise<PitfallRow[]> {
  // No pitfall names a library function; it reaches them only through WRAPS.
  if (kind === "LibraryFunction") return [];
  const severityCase = `CASE p.severity ${SEVERITY_ORDER.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} ELSE ${SEVERITY_ORDER.length} END`;
  // For Register, also match by address or alias (mirrors lookupRegister logic)
  const matchClause =
    kind === "Register"
      ? `(t:Register) WHERE t.name = $key OR t.address = $addr OR $key IN t.aliases`
      : `(t:${kind} {name: $key})`;
  // MITIGATED_BY only ever points at a Technique, so only that branch
  // widens the relation; a pitfall reached solely through its Fix still
  // counts as an answer for the technique that fixes it.
  const rel = kind === "Technique" ? "TRIGGERED_BY|MITIGATED_BY" : "TRIGGERED_BY";
  const r = await f.roQuery(
    `MATCH (p:Pitfall)-[:${rel}]->${matchClause}
     RETURN DISTINCT p.name AS name, p.title AS title, p.severity AS severity,
            p.region AS region, p.category AS category
     ORDER BY
       ${severityCase},
       p.name`,
    { key, addr: `$${key}` },
  );
  return z.array(PitfallRow).parse(r.data);
}

function parseVia(v: string): Via {
  const [name = "", label, address] = v.split("|");
  return {
    name,
    kind: label === "KernalRoutine" ? "KernalRoutine" : "Register",
    ...(address ? { address } : {}),
  };
}

// The edge through which a topic reaches registers and KERNAL routines.
const REACHES = {
  Technique: "(t:Technique {name: $key})-[:USES]->(x)",
  LibraryFunction:
    "(t:LibraryFunction)-[:WRAPS]->(x) WHERE toLower(t.name) = toLower($key) WITH t, x MATCH (x)",
} as const;

/**
 * A technique also meets every pitfall that a register or KERNAL routine
 * it declares (Uses registers / Uses kernal) triggers; a C library function
 * (#19) every pitfall of a routine or register it WRAPS. Both sides of that
 * join are exact declarations on the pages, so the edge is derived, not
 * guessed, and the answer names the register or routine that carried it.
 * Returns the direct rows plus the derived ones, re-sorted by severity.
 */
export async function withPitfallsViaUses(
  f: FalkorService,
  key: string,
  direct: PitfallRow[],
  from: keyof typeof REACHES = "Technique",
): Promise<{ rows: PitfallRow[]; viaOf: Map<string, Via[]> }> {
  const m = await f.roQuery(
    `MATCH ${REACHES[from]}<-[:TRIGGERED_BY]-(p:Pitfall)
     WHERE x:Register OR x:KernalRoutine
     RETURN p.name AS name, p.title AS title, p.severity AS severity,
            p.region AS region, p.category AS category,
            collect(DISTINCT (x.name + '|' + labels(x)[0] + '|' + coalesce(x.address, ''))) AS via`,
    { key },
  );
  const directNames = new Set(direct.map((x) => x.name));
  const viaOf = new Map<string, Via[]>();
  const rows = [...direct];
  for (const row of z.array(ViaRow).parse(m.data)) {
    if (!row.name || directNames.has(row.name)) continue;
    viaOf.set(row.name, (row.via ?? []).map(parseVia));
    rows.push(row);
  }
  rows.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.name.localeCompare(b.name));
  return { rows, viaOf };
}

/** Edges from one node to its targets, as {name, kind}; rows with no name or an unknown label are dropped. */
export async function edgeTargets(
  f: FalkorService,
  cypher: string,
  params: Record<string, unknown>,
): Promise<{ name: string; kind: z.infer<typeof KindSchema> }[]> {
  const r = await f.roQuery(cypher, params);
  return z
    .array(EdgeRow)
    .parse(r.data)
    .flatMap((e) => {
      const kind = KindSchema.safeParse(e.tkind);
      return e.tname && kind.success ? [{ name: e.tname, kind: kind.data }] : [];
    });
}

/** One pitfall row with its full TRIGGERED_BY and MITIGATED_BY lists. */
export async function enrichPitfall(
  f: FalkorService,
  row: PitfallRow,
  via: Via[] | undefined,
): Promise<Pitfall> {
  const triggered_by = await edgeTargets(
    f,
    `MATCH (p:Pitfall {name: $name})-[:TRIGGERED_BY]->(t)
     RETURN t.name AS tname, labels(t)[0] AS tkind`,
    { name: row.name },
  );
  const remedies = await f.roQuery(
    `MATCH (p:Pitfall {name: $name})-[:MITIGATED_BY]->(t:Technique)
     RETURN t.name AS tname ORDER BY tname`,
    { name: row.name },
  );
  const mitigated_by = z
    .array(EdgeRow.pick({ tname: true }))
    .parse(remedies.data)
    .flatMap((e) => (e.tname ? [{ name: e.tname, kind: "Technique" as const }] : []));
  return {
    name: row.name,
    title: row.title ?? "",
    severity: severityOf(row.severity),
    region: regionOf(row.region),
    category: row.category ?? "",
    triggered_by,
    mitigated_by,
    ...(via ? { via } : {}),
  };
}

const OwnersRow = z.object({ name: z.string(), owners: z.array(z.string()).nullish() });

/**
 * Leaves out a pitfall the technique reaches through a register or routine
 * it uses when every technique that triggers it (TRIGGERED_BY) is another
 * one: neither the topic nor a technique the topic requires (REQUIRES, up
 * to twelve deep). A pitfall no technique triggers, only the register,
 * stays. `pitfalls-for threshold_scroll_v` listed every `$D011` trick
 * through SCROLY (fpp_write_outside_window, linecrunch_write_outside_window,
 * mid_row_badline_write_off_by_one), none of which a one-line YSCROLL step
 * meets (KB-GAPS 6). Returns the kept rows, and in leftOut each pitfall
 * left out with the techniques that trigger it (its owners).
 */
export async function withoutOthersPitfalls(
  f: FalkorService,
  key: string,
  rows: PitfallRow[],
  viaOf: Map<string, Via[]>,
): Promise<{ rows: PitfallRow[]; leftOut: { name: string; owners: string[] }[] }> {
  const viaNames = rows.filter((r) => viaOf.has(r.name)).map((r) => r.name);
  if (viaNames.length === 0) return { rows, leftOut: [] };
  const own = await f.roQuery(
    `MATCH (t:Technique {name: $key})
     OPTIONAL MATCH (t)-[:REQUIRES*1..12]->(r:Technique)
     RETURN collect(DISTINCT r.name) AS owners, t.name AS name`,
    { key },
  );
  const mine = new Set([key, ...(z.array(OwnersRow).parse(own.data).at(0)?.owners ?? [])]);
  const res = await f.roQuery(
    `MATCH (p:Pitfall)-[:TRIGGERED_BY]->(o:Technique) WHERE p.name IN $names
     RETURN p.name AS name, collect(DISTINCT o.name) AS owners`,
    { names: viaNames },
  );
  const leftOut = z
    .array(OwnersRow)
    .parse(res.data)
    .map((r) => ({ name: r.name, owners: [...(r.owners ?? [])].sort() }))
    .filter((r) => r.owners.length > 0 && !r.owners.some((o) => mine.has(o)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const dropped = new Set(leftOut.map((r) => r.name));
  return { rows: rows.filter((r) => !dropped.has(r.name)), leftOut };
}

/** Whether the graph holds a Technique of this name. */
export async function techniqueExists(f: FalkorService, key: string): Promise<boolean> {
  const r = await f.roQuery(`MATCH (t:Technique {name: $key}) RETURN t.name AS name LIMIT 1`, { key });
  return r.data.length > 0;
}
