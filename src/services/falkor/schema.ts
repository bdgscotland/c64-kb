/**
 * Graph schema: one table of node labels drives the range indexes, the
 * unique constraints and the labels clean() wipes. The three lists used to
 * be written out separately. Keep the table aligned with docs/ONTOLOGY.md §4.1.
 */

import { ConstraintType, EntityType } from "falkordb";
import type { Graph } from "falkordb";

interface LabelSpec {
  readonly label: string;
  /** Primary key property: range-indexed, and unique when `unique`. */
  readonly key: "name" | "symptom";
  /** A uniqueness constraint makes a duplicate fail at write time instead of merging silently. */
  readonly unique: boolean;
  /** Holds ingested-doc entities; clean() wipes it. Chip and Region are seeds ensureSchema re-MERGEs. */
  readonly cleanable: boolean;
}

const LABELS = [
  { label: "KernalRoutine", key: "name", unique: true, cleanable: true },
  { label: "Register", key: "name", unique: true, cleanable: true },
  { label: "MemoryRegion", key: "name", unique: true, cleanable: true },
  { label: "Chip", key: "name", unique: true, cleanable: false },
  { label: "Region", key: "name", unique: true, cleanable: false },
  { label: "Technique", key: "name", unique: true, cleanable: true },
  { label: "Pitfall", key: "name", unique: true, cleanable: true },
  { label: "CrashPattern", key: "symptom", unique: true, cleanable: true },
  { label: "Tool", key: "name", unique: true, cleanable: true },
  { label: "Recipe", key: "name", unique: true, cleanable: true },
  { label: "FileFormat", key: "name", unique: true, cleanable: true },
  // Resource has a range index but no uniqueness constraint, as before the table existed.
  { label: "Resource", key: "name", unique: false, cleanable: true },
  { label: "Archetype", key: "name", unique: true, cleanable: true },
  // Seeds (schema 25) that CLAIMS edges point at; ensureSchema re-MERGEs them.
  { label: "HardwareUnit", key: "name", unique: true, cleanable: false },
] as const satisfies readonly LabelSpec[];

export type NodeLabel = (typeof LABELS)[number]["label"];
/** Labels whose primary key is `name` (every label but CrashPattern). */
export type NamedLabel = Extract<(typeof LABELS)[number], { key: "name" }>["label"];

export const CLEANABLE_LABELS: readonly NodeLabel[] = LABELS.filter((l) => l.cleanable).map((l) => l.label);

// Full-text indexes for "find a thing that does X" queries.
const FULLTEXT_INDEXES: readonly (readonly [NodeLabel, string])[] = [["KernalRoutine", "description"]];

export const CHIPS: readonly { name: string; variants: string; role: string }[] = [
  { name: "VIC-II", variants: "6569 PAL / 6567 NTSC", role: "Graphics + raster" },
  { name: "SID", variants: "6581 / 8580", role: "Audio synthesis" },
  { name: "CIA1", variants: "6526", role: "Keyboard / joystick / timer-A IRQ" },
  { name: "CIA2", variants: "6526", role: "VIC bank / RS-232 / timer-B NMI" },
  { name: "6510", variants: "MOS 6510", role: "CPU (6502-compatible + I/O port at $00/$01)" },
];

export const REGIONS: readonly {
  name: string;
  refresh_hz: number;
  lines_per_frame: number;
  cycles_per_line: number;
}[] = [
  { name: "PAL", refresh_hz: 50, lines_per_frame: 312, cycles_per_line: 63 },
  { name: "NTSC", refresh_hz: 60, lines_per_frame: 263, cycles_per_line: 65 },
];

/**
 * ensureSchema is re-run on every connect, so "already there" is expected.
 * Messages measured against FalkorDB graph module 4.18.7: "Attribute 'x' is
 * already indexed", "Constraint already exists". Anything else is rethrown;
 * the bare catch here used to hide every error, not just these.
 */
async function unlessExists(op: () => Promise<unknown>): Promise<void> {
  try {
    await op();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already indexed|already exists/i.test(msg)) throw err;
  }
}

/**
 * Range index on every label's key, then the unique constraints (FalkorDB
 * requires the supporting range index first), then the full-text indexes.
 * Every unique key is also the indexed key, so the pass that used to add a
 * supporting index for a constraint on another property had nothing to do
 * and is gone.
 */
export async function createIndexes(g: Graph): Promise<void> {
  for (const { label, key } of LABELS) {
    await unlessExists(() => g.createNodeRangeIndex(label, key));
  }
  for (const { label, key } of LABELS.filter((l) => l.unique)) {
    await unlessExists(() => g.constraintCreate(ConstraintType.UNIQUE, EntityType.NODE, label, key));
  }
  for (const [label, prop] of FULLTEXT_INDEXES) {
    await unlessExists(() => g.createNodeFulltextIndex(label, prop));
  }
}
