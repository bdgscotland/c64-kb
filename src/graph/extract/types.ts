/** The entities the extractor emits. Node types and edge types share one union; see src/graph/apply.ts. */

import type { ClaimMode, ClaimsBasis } from "../claims.ts";
import type { ClobberBound } from "../kernal-clobbers.ts";
import type { GameDesignPhase, MeasuredFrame } from "./game-design.ts";
import type { CostBasis, TechniqueCost } from "./vocabulary.ts";

export type TargetKind = "Register" | "KernalRoutine" | "Technique";

export type GraphEntity =
  | { type: "register"; name: string; address: string; chip: string; rw: string; aliases: string[] }
  | {
      type: "kernal_routine";
      name: string;
      address: string;
      description: string;
      input?: string;
      output?: string;
      affects?: string;
    }
  | { type: "pairs_with"; a: string; b: string }
  | {
      // **Clobbers zero page:** under a KERNAL routine H3 (schema 26):
      // ranges canonical "B8-BA,C3" ("" for none), $00-$FF.
      type: "kernal_clobbers_zp";
      routine: string;
      ranges: string;
      bound: ClobberBound;
      basis: string;
    }
  | {
      type: "memory_region";
      name: string;
      start: string;
      end: string;
      default_use?: string;
      bank_switchable?: boolean;
    }
  | { type: "belongs_to"; entityName: string; entityType: "Register"; chip: string }
  | {
      type: "tool";
      name: string;
      kind: string;
      maintainer?: string;
      license?: string;
      home_url: string;
      version_verified?: string;
    }
  | { type: "file_format"; name: string; description: string }
  | { type: "produces"; tool: string; format: string }
  | { type: "consumes"; tool: string; format: string }
  | { type: "targets"; tool: string; chip: string }
  | {
      type: "recipe";
      name: string;
      toolchain: string;
      output_format: string;
      region: string;
      techniques: string[];
      file_formats: string[];
      uses_registers: string[];
      uses_kernal: string[];
      scaffolds: string[];
      source_doc: string;
      // Recipe claims (schema 34): whether the frontmatter has a claims: key; absent is unknown.
      claims_stated?: "stated" | "none";
      claims_basis?: ClaimsBasis;
    }
  | { type: "scaffolds"; recipe: string; archetype: string }
  | { type: "recipe_occupies"; recipe: string; start: number; end: number }
  | { type: "technique_demands"; technique: string; resource: string; description: string }
  | { type: "implements"; recipe: string; technique: string }
  | { type: "produces_format"; recipe: string; format: string }
  | {
      type: "technique";
      name: string;
      title: string;
      category: string;
      complexity?: string;
      chip?: string;
      cost?: TechniqueCost;
      cost_basis?: CostBasis;
      // **Cost bytes basis:** (#72): the byte figures' basis when it differs.
      cost_bytes_basis?: CostBasis;
      // **Cost measured on:** / **Cost includes:** (schema 27).
      cost_recipe?: string;
      cost_conditions?: string;
      cost_includes?: string[];
      raster_band?: string;
      // Resource claims (schema 25): whether the page states them; absent is unknown.
      claims_stated?: "stated" | "none";
      claims_basis?: ClaimsBasis;
    }
  | {
      type: "claims";
      owner: string;
      // Recipe since schema 34: a recipe's own claims: frontmatter.
      ownerKind: "Technique" | "Recipe";
      unit: string;
      mode: ClaimMode;
      ranges?: string;
      relocatable?: boolean;
      basis: ClaimsBasis;
    }
  | { type: "technique_uses_register"; technique: string; register: string }
  | { type: "technique_uses_kernal"; technique: string; kernal: string }
  | { type: "technique_requires_region"; technique: string; region: string }
  | { type: "technique_belongs_to"; technique: string; chip: string }
  | { type: "technique_requires"; technique: string; requires: string }
  | { type: "pitfall"; name: string; title: string; severity: string; region: string; category: string }
  | {
      type: "crash_pattern";
      symptom: string;
      description: string;
      likely_causes: string[];
      diagnosis_steps: string;
    }
  | { type: "triggered_by"; pitfall: string; target: string; targetKind: TargetKind }
  | { type: "mitigated_by"; pitfall: string; target: string }
  | { type: "caused_by"; symptom: string; target: string; targetKind: TargetKind }
  | {
      type: "archetype";
      name: string;
      title: string;
      kind: "game" | "demo";
      source_doc: string;
      /** The **Brief words:** line, normalised; empty when the entry has none. */
      brief_words: string[];
      starter?: string;
    }
  | { type: "archetype_features"; archetype: string; technique: string }
  | { type: "archetype_risks"; archetype: string; pitfall: string }
  // Game designs (schema 28): docs/CONVENTIONS-game-designs.md.
  | {
      type: "game_design";
      name: string;
      title: string;
      region?: "PAL" | "NTSC" | "both";
      measured: MeasuredFrame[];
      source_doc: string;
    }
  | { type: "composes"; design: string; technique: string; phase: GameDesignPhase }
  | { type: "instance_of"; design: string; archetype: string }
  | { type: "realised_by"; design: string; recipe: string };

/** One doc-type parser: the whole page in, its entities out. */
export type DocParser = (content: string, sourcePath: string) => GraphEntity[];
