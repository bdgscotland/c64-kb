/** The entities the extractor emits. Node types and edge types share one union; see src/graph/apply.ts. */

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
      raster_band?: string;
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
  | { type: "archetype"; name: string; title: string; kind: "game" | "demo"; source_doc: string }
  | { type: "archetype_features"; archetype: string; technique: string }
  | { type: "archetype_risks"; archetype: string; pitfall: string };

/** One doc-type parser: the whole page in, its entities out. */
export type DocParser = (content: string, sourcePath: string) => GraphEntity[];
