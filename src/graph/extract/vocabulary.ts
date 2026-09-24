/**
 * Fixed vocabularies the extractor checks page metadata against: technique
 * categories, **Demands:** words, **Cost:** keys and **Cost basis:** words
 * (docs/CONVENTIONS-techniques.md). A word outside a set is a doc error; the
 * extractor warns and ingests nothing for it.
 */

export const COST_VOCABULARY: Record<string, string> = {
  cycles_per_line: "CPU cycles the technique takes on each raster line it is active on",
  cycles_per_frame: "CPU cycles the technique takes per frame (PAL 19,656 unless the page says otherwise)",
  cycles_per_frame_typical:
    "CPU cycles on a typical frame, measured, when cycles_per_frame is a worst frame (schema 27); never above cycles_per_frame",
  cycles_per_item:
    "worst CPU cycles each item adds to a frame (a bullet, a tested pair), measured (#95); a plan's count on the technique charges cycles_item_base + N × this",
  cycles_item_base: "CPU cycles of a frame with no items, beside cycles_per_item (#95); never without it",
  lines_active: "raster lines per frame on which the technique runs code",
  bytes_code: "bytes of code in the built recipe's segments",
  bytes_data: "bytes of tables, buffers and other data in the built recipe's segments",
  zp_bytes: "zero-page bytes the technique claims",
  irq_slots: "raster or timer interrupts the technique needs per frame",
  sprites_per_line: "the most hardware sprites displayed on one raster line of the technique's lines (0-8)",
};
// Keys whose value has a hardware ceiling; a figure above it is refused.
export const COST_MAXIMUM: Partial<Record<string, number>> = { sprites_per_line: 8 };
type CostKey = keyof typeof COST_VOCABULARY;
export type TechniqueCost = Partial<Record<CostKey, number>>;
// The byte figures, which a **Cost bytes basis:** line (#72) can give a
// basis of their own; every other key stays under **Cost basis:**.
export const BYTE_COST_KEYS = ["bytes_code", "bytes_data", "zp_bytes"] as const;

export const COST_BASIS_WORDS = ["measured-vice", "derived-listing", "arithmetic", "estimated"] as const;
export type CostBasis = (typeof COST_BASIS_WORDS)[number];

export function isCostBasis(word: string): word is CostBasis {
  return COST_BASIS_WORDS.some((w) => w === word);
}

// Technique categories the graph accepts. A technique doc whose frontmatter
// names a category outside this set is refused with a warning, the same way
// an unknown Demands word is; before this set existed `render` reached the
// graph without ever appearing in ONTOLOGY.md. Keep in step with
// docs/ONTOLOGY.md (Technique.category) and docs/CONVENTIONS-techniques.md.
export const TECHNIQUE_CATEGORIES: ReadonlySet<string> = new Set([
  "raster",
  "sprite",
  "scroll",
  "bitmap",
  "effect",
  "music",
  "cpu",
  "banking",
  "loader",
  "render",
  "input",
  "logic",
  "maths",
  "text",
  "io",
]);

// The fixed vocabulary for **Demands:** (docs/CONVENTIONS-techniques.md).
// A word outside it is a doc error and is reported, not ingested.
export const DEMAND_VOCABULARY: Record<string, string> = {
  cpu_every_line: "needs every CPU cycle on every raster line of its region",
  constant_sprite_set: "the set of active sprites must not change inside its region",
  badline_free_region: "no badline may occur inside its region",
  midframe_raster_irqs: "takes raster interrupts inside the display area",
  changes_sprite_set: "changes which hardware sprites are active during the frame",
  continuous_interrupts: "takes timer or NMI interrupts every few raster lines, all frame",
  kernal_rom_out: "runs with the KERNAL ROM banked out",
  serial_bus_exclusive:
    "owns the drive and its serial bus while resident: KERNAL disk I/O to that drive stalls until it is uninstalled",
};

/**
 * The value for `key` when the vocabulary defines it as its own key. A
 * prototype name such as `toString` is not a vocabulary word.
 */
export function vocabularyEntry(
  vocabulary: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  return Object.hasOwn(vocabulary, key) ? vocabulary[key] : undefined;
}
