/**
 * Edge writes. Most are one mergeEdge call; the MATCH-both links warn by
 * name when an end is missing, because a reference that names no node is a
 * defect in the doc, not a debug detail.
 */

import { FalkorNodes } from "./nodes.ts";
import { firstCount } from "./params.ts";
import type { EdgeEnd } from "./base.ts";

/** Targets a pitfall's Triggered-by or a failure's Caused-by line may name. */
export type CauseKind = "Register" | "KernalRoutine" | "Technique";
/** Labels linkBelongsTo accepts: the ones with a `name` key that can belong to a Chip. */
const CHIP_MEMBER_LABELS = ["Register", "KernalRoutine", "Technique", "Tool"] as const;
type ChipMemberLabel = (typeof CHIP_MEMBER_LABELS)[number];

function isChipMemberLabel(s: string): s is ChipMemberLabel {
  return (CHIP_MEMBER_LABELS as readonly string[]).includes(s);
}

function causeEnd(targetName: string, targetKind: CauseKind): EdgeEnd {
  return targetKind === "Register" ? { register: targetName } : { label: targetKind, name: targetName };
}

export class FalkorLinks extends FalkorNodes {
  /** mergeEdge, plus the standard warning when the edge did not land. */
  private async mergeOrWarn(opts: {
    from: EdgeEnd;
    rel: string;
    to: EdgeEnd;
    warn: string;
  }): Promise<boolean> {
    const landed = await this.mergeEdge(opts);
    if (!landed) console.warn(`[falkor] ${opts.warn}, edge dropped`);
    return landed;
  }

  /**
   * IN_REGION: every Register and KernalRoutine whose address falls inside a
   * MemoryRegion. Run once after all nodes exist. Without this the 220
   * MemoryRegion nodes had no edges at all.
   */
  async linkAddressesToRegions(): Promise<{ registers: number; kernal: number }> {
    const link = async (label: "Register" | "KernalRoutine") =>
      firstCount(
        await this.write(
          `MATCH (x:${label}), (m:MemoryRegion)
           WHERE x.addr_n >= 0 AND m.start_n >= 0 AND x.addr_n >= m.start_n AND x.addr_n <= m.end_n
           MERGE (x)-[:IN_REGION]->(m)
           RETURN count(*) AS n`,
        ),
      );
    return { registers: await link("Register"), kernal: await link("KernalRoutine") };
  }

  /** OCCUPIES: a recipe loads code or data into [start, end]; link every MemoryRegion that overlaps. */
  async linkRecipeOccupies(recipeName: string, start: number, end: number): Promise<number> {
    const rows = await this.write(
      `MATCH (r:Recipe {name: $recipeName})
       MATCH (m:MemoryRegion)
       WHERE m.start_n >= 0 AND m.start_n <= $end AND m.end_n >= $start
       MERGE (r)-[:OCCUPIES]->(m)
       RETURN count(m) AS n`,
      { recipeName, start, end },
    );
    return firstCount(rows);
  }

  /** DEMANDS: a technique needs a machine-level resource while active (see CONVENTIONS-techniques.md). */
  async linkTechniqueDemands(techniqueName: string, resource: string, description: string): Promise<void> {
    await this.write(
      `MATCH (t:Technique {name: $techniqueName})
       MERGE (res:Resource {name: $resource})
       ON CREATE SET res.description = $description, res.created_at = timestamp()
       MERGE (t)-[:DEMANDS]->(res)`,
      { techniqueName, resource, description },
    );
  }

  /**
   * The label is spliced into the Cypher text, so it is checked against a
   * fixed list: this used to interpolate any string it was given.
   */
  async linkBelongsTo(entityType: string, entityName: string, chip: string): Promise<void> {
    if (!isChipMemberLabel(entityType)) {
      throw new Error(`linkBelongsTo: "${entityType}" is not one of ${CHIP_MEMBER_LABELS.join(", ")}`);
    }
    await this.mergeEdge({
      from: { label: entityType, name: entityName },
      rel: "BELONGS_TO",
      to: { label: "Chip", name: chip },
    });
  }

  async linkPairsWith(a: string, b: string): Promise<{ linked: boolean }> {
    const linked = await this.mergeEdge({
      from: { label: "KernalRoutine", name: a },
      rel: "PAIRS_WITH",
      to: { label: "KernalRoutine", name: b },
    });
    // Gated behind INGEST_VERBOSE so MCP-host stderr stays clean. Set
    // INGEST_VERBOSE=1 during a clean re-ingest to surface per-pair details
    // in kernal-routines-reference.md.
    if (!linked && process.env.INGEST_VERBOSE) {
      console.warn(`linkPairsWith: ${a} -> ${b} skipped (one or both KernalRoutines not in graph)`);
    }
    return { linked };
  }

  async linkProduces(toolName: string, formatName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Tool", name: toolName },
      rel: "PRODUCES",
      to: { label: "FileFormat", name: formatName },
    });
  }

  async linkConsumes(toolName: string, formatName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Tool", name: toolName },
      rel: "CONSUMES",
      to: { label: "FileFormat", name: formatName },
    });
  }

  /**
   * CONSUMES from a Technique (schema 37): the technique reads files of this
   * format. Both ends MATCHed, so a misspelt format drops the edge with a
   * warning instead of making a FileFormat stub. Returns whether it landed.
   */
  async linkTechniqueConsumes(techniqueName: string, formatName: string): Promise<boolean> {
    return this.mergeOrWarn({
      from: { label: "Technique", name: techniqueName },
      rel: "CONSUMES",
      to: { label: "FileFormat", name: formatName },
      warn: `linkTechniqueConsumes: ${techniqueName} -> ${formatName} — technique or FileFormat not found`,
    });
  }

  async linkTargets(toolName: string, chipName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Tool", name: toolName },
      rel: "TARGETS",
      to: { label: "Chip", name: chipName },
    });
  }

  async linkRecipeImplements(recipeName: string, techniqueName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Recipe", name: recipeName },
      rel: "IMPLEMENTS",
      to: { label: "Technique", name: techniqueName, create: true },
    });
  }

  /**
   * SCAFFOLDS: the recipe's frontmatter names this archetype as one it is a
   * starting point for. Both ends MATCHed, never MERGEd, so an archetype
   * name the graph does not have drops the edge with a warning instead of
   * creating a stub. Returns whether the edge landed.
   */
  async linkRecipeScaffolds(recipeName: string, archetypeName: string): Promise<boolean> {
    return this.mergeOrWarn({
      from: { label: "Recipe", name: recipeName },
      rel: "SCAFFOLDS",
      to: { label: "Archetype", name: archetypeName },
      warn: `linkRecipeScaffolds: ${recipeName} -> ${archetypeName} (Archetype) — recipe or archetype not found`,
    });
  }

  async linkRecipeProducesFormat(recipeName: string, formatName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Recipe", name: recipeName },
      rel: "PRODUCES",
      to: { label: "FileFormat", name: formatName },
    });
  }

  async linkRecipeUsesKernal(recipeName: string, kernalName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Recipe", name: recipeName },
      rel: "USES",
      to: { label: "KernalRoutine", name: kernalName },
    });
  }

  async linkRecipeUsesRegister(recipeName: string, registerName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Recipe", name: recipeName },
      rel: "USES",
      to: { register: registerName },
    });
  }

  // The recipe-to-tool link is REQUIRES_TOOL, as the ontology defines it. Until
  // data 713 this wrote USES, which left REQUIRES_TOOL populated by nothing.
  async linkRecipeUsesTool(recipeName: string, toolName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Recipe", name: recipeName },
      rel: "REQUIRES_TOOL",
      to: { label: "Tool", name: toolName, create: true },
    });
  }

  async linkTechniqueUsesRegister(techniqueName: string, registerName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Technique", name: techniqueName },
      rel: "USES",
      to: { register: registerName },
    });
  }

  async linkTechniqueUsesKernal(techniqueName: string, kernalName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Technique", name: techniqueName },
      rel: "USES",
      to: { label: "KernalRoutine", name: kernalName },
    });
  }

  async linkTechniqueRequiresRegion(techniqueName: string, regionName: string): Promise<void> {
    await this.mergeEdge({
      from: { label: "Technique", name: techniqueName },
      rel: "REQUIRES_REGION",
      to: { label: "Region", name: regionName },
    });
  }

  async linkTechniqueBelongsTo(techniqueName: string, chipName: string): Promise<void> {
    await this.linkBelongsTo("Technique", techniqueName, chipName);
  }

  /**
   * REQUIRES: a technique presupposes another one being set up before, or
   * running underneath, it (see CONVENTIONS-techniques.md). Both ends must
   * already exist — a MERGE on the target, as linkRecipeImplements does,
   * would manufacture a stub Technique out of a typo. A reference that would
   * close a cycle (the required technique already requires this one, directly
   * or through others) is refused, as is a self-reference. The back-path
   * check walks at most twelve REQUIRES edges, the same bound as
   * techniquesFor's chain filter; a longer chain would not be checked. The
   * longest authored chain is two. Returns whether the edge landed; every
   * refusal is warned about by name.
   */
  async linkTechniqueRequires(techniqueName: string, requiresName: string): Promise<boolean> {
    if (techniqueName === requiresName) {
      console.warn(`[falkor] linkTechniqueRequires: ${techniqueName} -> itself — refused`);
      return false;
    }
    const back = await this.roQuery(
      `MATCH (p:Technique {name: $requiresName})-[:REQUIRES*1..12]->(t:Technique {name: $techniqueName})
       RETURN 1 LIMIT 1`,
      { techniqueName, requiresName },
    );
    if (back.data.length > 0) {
      console.warn(
        `[falkor] linkTechniqueRequires: ${techniqueName} -> ${requiresName} would close a cycle (${requiresName} already requires ${techniqueName}) — refused`,
      );
      return false;
    }
    return this.mergeOrWarn({
      from: { label: "Technique", name: techniqueName },
      rel: "REQUIRES",
      to: { label: "Technique", name: requiresName },
      warn: `linkTechniqueRequires: ${techniqueName} -> ${requiresName} — one or both techniques not found`,
    });
  }

  /**
   * ALTERNATIVE_TO (schema 37): two techniques that do the same job another
   * way; `tradeoff` describes the source against the target, as its page
   * states it. The relation is symmetric and stored once, in the direction
   * the page wrote it. Refused, with a warning by name: a self-reference; a
   * pair already stored from the other page (one page states the pair); a
   * pair joined by REQUIRES either way, since a technique cannot stand in for
   * its own prerequisite; an end that is no Technique. Batch ingest links
   * these after every REQUIRES edge. Returns whether the edge landed.
   * The checks are plain MATCHes. Measured on FalkorDB here: exists() on a
   * pattern answered true with no such edge, and a pattern comprehension
   * compiled on a graph with no ALTERNATIVE_TO edge yet kept answering 0
   * after the first one landed.
   */
  async linkTechniqueAlternative(
    techniqueName: string,
    alternativeName: string,
    tradeoff: string,
  ): Promise<boolean> {
    const pair = `${techniqueName} -> ${alternativeName}`;
    if (techniqueName === alternativeName) {
      console.warn(`[falkor] linkTechniqueAlternative: ${techniqueName} -> itself — refused`);
      return false;
    }
    const ends = { a: techniqueName, b: alternativeName };
    const found = async (cypher: string) => (await this.roQuery(cypher, ends)).data.length > 0;
    if (
      await found(`MATCH (:Technique {name: $b})-[:ALTERNATIVE_TO]->(:Technique {name: $a}) RETURN 1 LIMIT 1`)
    ) {
      console.warn(
        `[falkor] linkTechniqueAlternative: ${pair} — ${alternativeName}'s page already states this pair; state it on one page — refused`,
      );
      return false;
    }
    if (
      (await found(
        `MATCH (:Technique {name: $a})-[:REQUIRES*1..12]->(:Technique {name: $b}) RETURN 1 LIMIT 1`,
      )) ||
      (await found(
        `MATCH (:Technique {name: $b})-[:REQUIRES*1..12]->(:Technique {name: $a}) RETURN 1 LIMIT 1`,
      ))
    ) {
      console.warn(
        `[falkor] linkTechniqueAlternative: ${pair} — one requires the other, so neither is an alternative to it — refused`,
      );
      return false;
    }
    const rows = await this.write(
      `MATCH (a:Technique {name: $a})
       MATCH (b:Technique {name: $b})
       MERGE (a)-[e:ALTERNATIVE_TO]->(b)
       SET e.tradeoff = $tradeoff
       RETURN 1`,
      { a: techniqueName, b: alternativeName, tradeoff },
    );
    if (rows.length === 0)
      console.warn(
        `[falkor] linkTechniqueAlternative: ${pair} — one or both techniques not found, edge dropped`,
      );
    return rows.length > 0;
  }

  /**
   * CLAIMS (schema 25): a technique holds a HardwareUnit in a mode (owns,
   * shares, reads, init); zero_page carries its byte ranges. Both ends must
   * exist: the unit is a seed and the technique came from pass 1, so a MERGE
   * could only manufacture a stub out of a typo. Returns whether it landed.
   */
  async linkClaims(c: {
    owner: string;
    ownerKind: "Technique" | "Recipe" | "Device";
    unit: string;
    mode: string;
    ranges?: string | undefined;
    relocatable?: boolean | undefined;
    basis: string;
  }): Promise<boolean> {
    const rows = await this.write(
      `MATCH (t:${c.ownerKind} {name: $owner})
       MATCH (h:HardwareUnit {name: $unit})
       MERGE (t)-[e:CLAIMS]->(h)
       SET e.mode = $mode, e.ranges = $ranges, e.relocatable = $relocatable, e.basis = $basis
       RETURN 1`,
      {
        owner: c.owner,
        unit: c.unit,
        mode: c.mode,
        ranges: c.ranges ?? null,
        relocatable: c.relocatable === true,
        basis: c.basis,
      },
    );
    if (rows.length > 0) return true;
    console.warn(
      `[falkor] linkClaims: ${c.owner} -> ${c.unit} — ${c.ownerKind} or HardwareUnit not found, edge dropped`,
    );
    return false;
  }

  /**
   * CLOBBERS_ZP (schema 26): the zero-page bytes a KERNAL routine may write
   * (bound may, the ROM walk) or did write in a VICE trace (bound must, one
   * edge per traced call, keyed by its basis). Both ends must exist: the
   * routine came from pass 1, zero_page is a seed.
   */
  async linkKernalClobbersZp(c: {
    routine: string;
    ranges: string;
    bound: string;
    basis: string;
  }): Promise<boolean> {
    const rows = await this.write(
      `MATCH (k:KernalRoutine {name: $routine})
       MATCH (z:HardwareUnit {name: 'zero_page'})
       MERGE (k)-[e:CLOBBERS_ZP {bound: $bound, basis: $basis}]->(z)
       SET e.ranges = $ranges
       RETURN 1`,
      c,
    );
    if (rows.length > 0) return true;
    console.warn(
      `[falkor] linkKernalClobbersZp: ${c.routine} — KernalRoutine or zero_page unit not found, edge dropped`,
    );
    return false;
  }

  async linkTriggeredBy(pitfallName: string, targetName: string, targetKind: CauseKind): Promise<boolean> {
    return this.mergeOrWarn({
      from: { label: "Pitfall", name: pitfallName },
      rel: "TRIGGERED_BY",
      to: causeEnd(targetName, targetKind),
      warn: `linkTriggeredBy: ${pitfallName} -> ${targetName} (${targetKind}) — target not found`,
    });
  }

  /**
   * MITIGATED_BY: applying this technique is the pitfall's Fix (see
   * CONVENTIONS-pitfalls.md). Technique targets only; both ends are MATCHed,
   * never MERGEd, so a misspelt name drops the edge with a warning instead
   * of creating a stub node. Returns whether the edge landed.
   */
  async linkMitigatedBy(pitfallName: string, techniqueName: string): Promise<boolean> {
    return this.mergeOrWarn({
      from: { label: "Pitfall", name: pitfallName },
      rel: "MITIGATED_BY",
      to: { label: "Technique", name: techniqueName },
      warn: `linkMitigatedBy: ${pitfallName} -> ${techniqueName} (Technique) — pitfall or technique not found`,
    });
  }

  /**
   * FEATURES: the archetype's technique fingerprint names this technique.
   * Both ends MATCHed, never MERGEd, so a name the graph does not have drops
   * the edge with a warning instead of creating a stub. Returns whether it landed.
   */
  async linkArchetypeFeatures(archetypeName: string, techniqueName: string): Promise<boolean> {
    return this.mergeOrWarn({
      from: { label: "Archetype", name: archetypeName },
      rel: "FEATURES",
      to: { label: "Technique", name: techniqueName },
      warn: `linkArchetypeFeatures: ${archetypeName} -> ${techniqueName} (Technique) — archetype or technique not found`,
    });
  }

  /**
   * RISKS: the archetype's common-pitfalls line names this pitfall. Same
   * MATCH-both discipline as FEATURES. Returns whether the edge landed.
   */
  async linkArchetypeRisks(archetypeName: string, pitfallName: string): Promise<boolean> {
    return this.mergeOrWarn({
      from: { label: "Archetype", name: archetypeName },
      rel: "RISKS",
      to: { label: "Pitfall", name: pitfallName },
      warn: `linkArchetypeRisks: ${archetypeName} -> ${pitfallName} (Pitfall) — archetype or pitfall not found`,
    });
  }

  /**
   * COMPOSES (schema 28): the design runs this technique in this phase.
   * Keyed by phase, so one technique may be composed in two phases. Both
   * ends MATCHed, never MERGEd. `calls` (#37) lands as calls_low and
   * calls_high, and is removed when the page stops stating it.
   */
  async linkComposes(
    design: string,
    technique: string,
    phase: string,
    calls?: { low: number; high: number },
  ): Promise<boolean> {
    const rows = await this.write(
      `MATCH (g:GameDesign {name: $design})
       MATCH (t:Technique {name: $technique})
       MERGE (g)-[c:COMPOSES {phase: $phase}]->(t)
       SET c.calls_low = $calls_low, c.calls_high = $calls_high
       RETURN 1`,
      { design, technique, phase, calls_low: calls?.low ?? null, calls_high: calls?.high ?? null },
    );
    if (rows.length > 0) return true;
    console.warn(
      `[falkor] linkComposes: ${design} -> ${technique} (Technique) — game design or technique not found, edge dropped`,
    );
    return false;
  }

  /** INSTANCE_OF (schema 28): the design is a game of this archetype. MATCH both. */
  async linkInstanceOf(design: string, archetype: string): Promise<boolean> {
    return this.mergeOrWarn({
      from: { label: "GameDesign", name: design },
      rel: "INSTANCE_OF",
      to: { label: "Archetype", name: archetype },
      warn: `linkInstanceOf: ${design} -> ${archetype} (Archetype) — game design or archetype not found`,
    });
  }

  /**
   * EXEMPLIFIED_BY (schema 34): the archetype page names this title as a
   * reference and links `source` for its genre and year. MATCH both.
   */
  async linkExemplifiedBy(e: {
    archetype: string;
    production: string;
    source: string;
    source_doc: string;
  }): Promise<boolean> {
    const rows = await this.write(
      `MATCH (a:Archetype {name: $archetype})
       MATCH (p:Production {name: $production})
       MERGE (a)-[x:EXEMPLIFIED_BY]->(p)
       SET x.source = $source, x.source_doc = $source_doc
       RETURN 1`,
      e,
    );
    if (rows.length > 0) return true;
    console.warn(
      `[falkor] linkExemplifiedBy: ${e.archetype} -> ${e.production} — archetype or production not found, edge dropped`,
    );
    return false;
  }

  /** REQUIRES_DEVICE (schema 36): the recipe's run attaches this device. MATCH both. */
  async linkRequiresDevice(recipe: string, device: string): Promise<boolean> {
    return this.mergeOrWarn({
      from: { label: "Recipe", name: recipe },
      rel: "REQUIRES_DEVICE",
      to: { label: "Device", name: device },
      warn: `linkRequiresDevice: ${recipe} -> ${device} (Device) — recipe or device not found`,
    });
  }

  /** REALISED_BY (schema 28): this recipe builds the design. MATCH both. */
  async linkRealisedBy(design: string, recipe: string): Promise<boolean> {
    return this.mergeOrWarn({
      from: { label: "GameDesign", name: design },
      rel: "REALISED_BY",
      to: { label: "Recipe", name: recipe },
      warn: `linkRealisedBy: ${design} -> ${recipe} (Recipe) — game design or recipe not found`,
    });
  }

  /**
   * VERIFIED_ON (schema 29): verify:recipes runs this recipe page on this
   * variant and compares the committed screenshot pixel for pixel. Built
   * from docs/recipes/runs.json after every ingest, never from a page, so
   * the old edges are removed first: replaceVerifiedOn owns the edge type.
   */
  async replaceVerifiedOn(
    edges: readonly {
      source_doc: string;
      variant: string;
      model: string;
      cycles: number;
      shot: string;
      flags: string;
      pinned: boolean;
    }[],
  ): Promise<{ landed: number; dropped: string[] }> {
    await this.write(`MATCH ()-[e:VERIFIED_ON]->() DELETE e`);
    let landed = 0;
    const dropped: string[] = [];
    for (const e of edges) {
      const rows = await this.write(
        `MATCH (r:Recipe {source_doc: $source_doc})
         MATCH (v:MachineVariant {name: $variant})
         MERGE (r)-[x:VERIFIED_ON {model: $model}]->(v)
         SET x.cycles = $cycles, x.shot = $shot, x.flags = $flags, x.pinned = $pinned
         RETURN 1`,
        e,
      );
      if (rows.length > 0) landed++;
      else dropped.push(`${e.source_doc} -> ${e.variant}`);
    }
    if (dropped.length > 0)
      console.warn(`[falkor] replaceVerifiedOn: ${dropped.length} edge(s) dropped: ${dropped.join(", ")}`);
    return { landed, dropped };
  }

  async linkCausedBy(symptom: string, targetName: string, targetKind: CauseKind): Promise<boolean> {
    return this.mergeOrWarn({
      from: { label: "CrashPattern", symptom },
      rel: "CAUSED_BY",
      to: causeEnd(targetName, targetKind),
      warn: `linkCausedBy: ${symptom} -> ${targetName} (${targetKind}) — target not found`,
    });
  }
}
