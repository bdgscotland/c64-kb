/**
 * Extract graph entities from C64 hardware reference markdown documents.
 *
 * Recognizes patterns defined in docs/CONVENTIONS-hardware-reference.md:
 *   - Register H3:   `### $D011 — D011 — Screen Control Register 1 (RW)`
 *   - KERNAL H3:     `### $FFD2 — CHROUT — Output a character`
 *   - Memory H3:     `### $0400-$07FF — Default Screen RAM`
 *
 * Only files ending with `<!-- doc-type: hardware-reference -->` are processed.
 */

export type GraphEntity =
  | { type: "register"; name: string; address: string; chip: string; rw: string; aliases: string[] }
  | { type: "kernal_routine"; name: string; address: string; description: string; input?: string; output?: string; affects?: string }
  | { type: "pairs_with"; a: string; b: string }
  | { type: "memory_region"; name: string; start: string; end: string; default_use?: string; bank_switchable?: boolean }
  | { type: "belongs_to"; entityName: string; entityType: "Register"; chip: string }
  | { type: "tool"; name: string; kind: string; maintainer?: string; license?: string; home_url: string; version_verified?: string }
  | { type: "file_format"; name: string; description: string }
  | { type: "produces"; tool: string; format: string }
  | { type: "consumes"; tool: string; format: string }
  | { type: "targets"; tool: string; chip: string }
  | { type: "recipe"; name: string; toolchain: string; output_format: string; region: string; techniques: string[]; file_formats: string[]; uses_registers: string[]; uses_kernal: string[]; scaffolds: string[]; source_doc: string }
  | { type: "scaffolds"; recipe: string; archetype: string }
  | { type: "recipe_occupies"; recipe: string; start: number; end: number }
  | { type: "technique_demands"; technique: string; resource: string; description: string }
  | { type: "implements"; recipe: string; technique: string }
  | { type: "produces_format"; recipe: string; format: string }
  | { type: "technique"; name: string; title: string; category: string; complexity?: string; chip?: string; cost?: TechniqueCost; cost_basis?: CostBasis; raster_band?: string }
  | { type: "technique_uses_register"; technique: string; register: string }
  | { type: "technique_uses_kernal"; technique: string; kernal: string }
  | { type: "technique_requires_region"; technique: string; region: string }
  | { type: "technique_belongs_to"; technique: string; chip: string }
  | { type: "technique_requires"; technique: string; requires: string }
  | { type: "pitfall"; name: string; title: string; severity: string; region: string; category: string }
  | { type: "crash_pattern"; symptom: string; description: string; likely_causes: string[]; diagnosis_steps: string }
  | { type: "triggered_by"; pitfall: string; target: string; targetKind: "Register" | "KernalRoutine" | "Technique" }
  | { type: "mitigated_by"; pitfall: string; target: string }
  | { type: "caused_by"; symptom: string; target: string; targetKind: "Register" | "KernalRoutine" | "Technique" }
  | { type: "archetype"; name: string; title: string; kind: "game" | "demo"; source_doc: string }
  | { type: "archetype_features"; archetype: string; technique: string }
  | { type: "archetype_risks"; archetype: string; pitfall: string };

const DOC_TYPE_MARKER = "<!-- doc-type: hardware-reference -->";
const TOOLCHAIN_MARKER = "<!-- doc-type: toolchain-reference -->";
const RECIPE_MARKER = "<!-- doc-type: recipe -->";
const FORMAT_MARKER = "<!-- doc-type: format-reference -->";
const TECHNIQUE_MARKER = "<!-- doc-type: technique-reference -->";
const PITFALL_MARKER = "<!-- doc-type: pitfall-reference -->";
const FAILURE_MARKER = "<!-- doc-type: failure-reference -->";
const ARCHETYPE_MARKER = "<!-- doc-type: archetype-reference -->";
const ENTITY_H2 = /^##\s+([a-z][a-z0-9_]*)\s+(?:—|--)\s+(.+)$/;
// Archetype pages (docs/CONVENTIONS-archetypes.md): the H2 is the free-form
// title and an **Archetype:** line under it carries the snake_case name.
// The two lines that already existed on the page are the edge sources.
const ARCHETYPE_NAME_LINE = /^\*\*Archetype:\*\*\s+`?([a-z][a-z0-9_]*)`?\s*$/m;
const ARCHETYPE_FINGERPRINT = /^\*\*Technique fingerprint:\*\*\s+(.+)$/m;
const ARCHETYPE_PITFALLS = /^\*\*Common pitfalls:\*\*\s+(.+)$/m;
const ARCHETYPE_KINDS: ReadonlySet<string> = new Set(["game", "demo"]);
const TECHNIQUE_H2 = ENTITY_H2;
const PITFALL_H2 = ENTITY_H2;
const CRASH_H2 = ENTITY_H2;
const COMPLEXITY_LINE = /^\*\*Complexity:\*\*\s+(low|medium|high|scene-tier)\s*$/;
const REGION_LINE = /^\*\*Region:\*\*\s+(PAL|NTSC|both)\s*$/im;
const PITFALL_REGION_LINE = REGION_LINE;
const USES_REGISTERS = /^\*\*Uses registers:\*\*\s+(.+)$/;
const USES_KERNAL = /^\*\*Uses kernal:\*\*\s+(.+)$/;
const DEMANDS_LINE = /^\*\*Demands:\*\*\s+(.+)$/;
// **Requires:** names other Technique H2s that must be set up before, or run
// underneath, this one (docs/CONVENTIONS-techniques.md). Each word must be a
// snake_case technique name; whether it names an existing node is settled at
// link time, where a miss is warned about and counted.
const REQUIRES_LINE = /^\*\*Requires:\*\*\s+(.+)$/;
const TECHNIQUE_NAME = /^[a-z][a-z0-9_]*$/;
// **Raster band:** says which raster lines a technique holds the CPU on
// (docs/CONVENTIONS-techniques.md). The value is comma-separated ranges of
// raster line numbers, `N-M` or `N`, or the word `movable` for a technique
// whose lines the program chooses. A trailing parenthetical note says where
// the numbers came from and is not part of the value.
const RASTER_BAND_LINE = /^\*\*Raster band:\*\*\s+(.+)$/;
// **Cost:** carries key=value pairs from COST_VOCABULARY and **Cost basis:**
// one word from COST_BASIS_WORDS (docs/CONVENTIONS-techniques.md). A pair
// with an unknown key or a non-integer value is warned about and skipped; a
// basis word outside the set, or a Cost line with no basis line at all,
// drops the whole Cost line, because a number without an honest basis is
// worse than no number.
const COST_LINE = /^\*\*Cost:\*\*\s+(.+)$/;
const COST_BASIS_LINE = /^\*\*Cost basis:\*\*\s+(.+)$/;
const COST_PAIR = /^([a-z_]+)\s*=\s*(-?\d+)$/;
const INTEGER = /^-?\d+$/;

export const COST_VOCABULARY: Record<string, string> = {
  cycles_per_line: "CPU cycles the technique takes on each raster line it is active on",
  cycles_per_frame: "CPU cycles the technique takes per frame (PAL 19,656 unless the page says otherwise)",
  lines_active: "raster lines per frame on which the technique runs code",
  bytes_code: "bytes of code in the built recipe's segments",
  bytes_data: "bytes of tables, buffers and other data in the built recipe's segments",
  zp_bytes: "zero-page bytes the technique claims",
  irq_slots: "raster or timer interrupts the technique needs per frame",
  sprites_per_line: "the most hardware sprites displayed on one raster line of the technique's lines (0-8)",
};
// Keys whose value has a hardware ceiling; a figure above it is refused.
const COST_MAXIMUM: Partial<Record<string, number>> = { sprites_per_line: 8 };
export type CostKey = keyof typeof COST_VOCABULARY;
export type TechniqueCost = Partial<Record<CostKey, number>>;

export const COST_BASIS_WORDS = ["measured-vice", "derived-listing", "arithmetic", "estimated"] as const;
export type CostBasis = (typeof COST_BASIS_WORDS)[number];

// Highest raster line number on either machine: PAL has 312 lines (0-311),
// NTSC 263 (0-262). A band is stated in raster line numbers, the same
// numbers on both machines; a line past 262 simply does not occur on NTSC.
export const RASTER_LINE_MAX = 311;

export type RasterBand =
  | { kind: "lines"; ranges: Array<[number, number]>; canonical: string }
  | { kind: "movable"; canonical: "movable" };

/**
 * Parse the value of a **Raster band:** line (or the canonical string stored
 * on the Technique node). Returns an error string for anything outside the
 * grammar, so the extractor can warn and ingest nothing rather than guess.
 */
export function parseRasterBand(raw: string): RasterBand | { error: string } {
  const value = raw.replace(/`/g, "").replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
  if (value === "") return { error: "empty band" };
  if (value === "movable") return { kind: "movable", canonical: "movable" };
  const ranges: Array<[number, number]> = [];
  for (const part of value.split(",").map((s) => s.trim())) {
    const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!m) return { error: `"${part}" is not a line number, a range N-M, or "movable"` };
    const first = Number(m[1]);
    const last = m[2] !== undefined ? Number(m[2]) : first;
    if (first > last) return { error: `range ${first}-${last} runs backwards (write a wrap as two ranges)` };
    if (last > RASTER_LINE_MAX) return { error: `line ${last} is past the last raster line, ${RASTER_LINE_MAX}` };
    ranges.push([first, last]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const canonical = ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(",");
  return { kind: "lines", ranges, canonical };
}

/** True when two line bands share at least one raster line. */
export function rasterBandsOverlap(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  return a.some(([a0, a1]) => b.some(([b0, b1]) => a0 <= b1 && b0 <= a1));
}

// The fixed vocabulary for **Demands:** (docs/CONVENTIONS-techniques.md).
// A word outside it is a doc error and is reported, not ingested.
// Technique categories the graph accepts. A technique doc whose frontmatter
// names a category outside this set is refused with a warning, the same way
// an unknown Demands word is; before this set existed `render` reached the
// graph without ever appearing in ONTOLOGY.md. Keep in step with
// docs/ONTOLOGY.md (Technique.category) and docs/CONVENTIONS-techniques.md.
export const TECHNIQUE_CATEGORIES: ReadonlySet<string> = new Set([
  "raster", "sprite", "scroll", "bitmap", "effect", "music", "cpu", "banking", "loader", "render",
  "input", "logic", "maths", "text", "io",
]);

export const DEMAND_VOCABULARY: Record<string, string> = {
  cpu_every_line: "needs every CPU cycle on every raster line of its region",
  constant_sprite_set: "the set of active sprites must not change inside its region",
  badline_free_region: "no badline may occur inside its region",
  midframe_raster_irqs: "takes raster interrupts inside the display area",
  changes_sprite_set: "changes which hardware sprites are active during the frame",
  continuous_interrupts: "takes timer or NMI interrupts every few raster lines, all frame",
  kernal_rom_out: "runs with the KERNAL ROM banked out",
  serial_bus_exclusive: "owns the drive and its serial bus while resident: KERNAL disk I/O to that drive stalls until it is uninstalled",
};

// Recipe listings declare where they load: KickAssembler `* = $0900`,
// Oscar64 `#pragma region( name, 0x0a00, 0x1000, ...)`, ca65 `.org $0801`.
const KICK_ORIGIN = /^\s*\*\s*=\s*\$([0-9A-Fa-f]{4})\b/gm;
const CA65_ORIGIN = /^\s*\.org\s+\$([0-9A-Fa-f]{4})\b/gm;
const OSCAR_REGION = /#pragma\s+region\s*\(\s*\w+\s*,\s*0x([0-9A-Fa-f]+)\s*,\s*0x([0-9A-Fa-f]+)/g;

const SEVERITY_LINE = /^\*\*Severity:\*\*\s+(critical|high|medium|low)\s*$/im;
const TRIGGERED_REGS = /^\*\*Triggered by registers:\*\*\s+(.+)$/m;
const TRIGGERED_KERNAL = /^\*\*Triggered by kernal:\*\*\s+(.+)$/m;
const TRIGGERED_TECHS = /^\*\*Triggered by techniques:\*\*\s+(.+)$/m;
// **Mitigated by techniques:** names the Technique(s) whose application is the
// Fix section's remedy (docs/CONVENTIONS-pitfalls.md). Techniques only.
const MITIGATED_TECHS = /^\*\*Mitigated by techniques:\*\*\s+(.+)$/m;
const LIKELY_CAUSES = /^\*\*Likely causes:\*\*\s+(.+)$/m;
const DIAGNOSIS_STEPS = /^\*\*Diagnosis steps:\*\*\s+(.+)$/m;
const CAUSED_REGS = /^\*\*Caused by registers:\*\*\s+(.+)$/m;
const CAUSED_KERNAL = /^\*\*Caused by kernal:\*\*\s+(.+)$/m;
const CAUSED_TECHS = /^\*\*Caused by techniques:\*\*\s+(.+)$/m;

// H3 patterns. Separators accept `—` (U+2014) or ` -- `.

const FORMAT_H3  = /^###\s+(\.[A-Z0-9]+)\s+(?:—|--)\s+(.+)$/;
const PRODUCED_BY = /^\*\*Produced by:\*\*\s+(.+)$/;
const CONSUMED_BY = /^\*\*Consumed by:\*\*\s+(.+)$/;
const TARGETS     = /^\*\*Targets:\*\*\s+(.+)$/;

const REG_H3 = /^###\s+(\$[0-9A-F]{4})\s+(?:—|--)\s+([A-Z][A-Z0-9_]*)\s+(?:—|--)\s+(.+?)\s+\((R|W|RW)\)\s*$/;
const KERNAL_H3 = /^###\s+(\$[0-9A-F]{4})\s+(?:—|--)\s+([A-Z][A-Z0-9_]+)\s+(?:—|--)\s+(.+)$/;
const MEMORY_H3 = /^###\s+(\$[0-9A-F]{4})-(\$[0-9A-F]{4})\s+(?:—|--)\s+(.+)$/;

/** Parse `---` YAML-ish frontmatter at the top of the doc. */
function parseFrontmatter(content: string): { fm: Record<string, string>; rest: string } {
  if (!content.startsWith("---\n")) return { fm: {}, rest: content };
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return { fm: {}, rest: content };
  const block = content.slice(4, end);
  const fm: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.+?)\s*$/i);
    if (m) fm[m[1]] = m[2];
  }
  return { fm, rest: content.slice(end + 5) };
}

/** Split a doc body into sections at H3 boundaries. Each section is the H3 line + body until next H3 or end. */
function splitH3Sections(body: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  const lines = body.split("\n");
  let currentHeading: string | null = null;
  let currentBody: string[] = [];
  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: currentBody.join("\n") });
      }
      currentHeading = line;
      currentBody = [];
    } else if (currentHeading !== null) {
      currentBody.push(line);
    }
  }
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: currentBody.join("\n") });
  }
  return sections;
}

/** Split a doc body into sections at H2 boundaries. Each section is the H2 line + body until next H2 or end. */
function splitH2Sections(body: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  const lines = body.split("\n");
  let currentHeading: string | null = null;
  let currentBody: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: currentBody.join("\n") });
      }
      currentHeading = line;
      currentBody = [];
    } else if (currentHeading !== null) {
      currentBody.push(line);
    }
  }
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: currentBody.join("\n") });
  }
  return sections;
}

// Hardcoded per-field bold-label extractors (avoids dynamic RegExp construction).
const FIELD_CHIP        = /^\*\*Chip:\*\*\s*(.+?)\s*$/m;
const FIELD_BANK        = /^\*\*Bank-switchable:\*\*\s*(.+?)\s*$/m;
const FIELD_DEFAULT_USE = /^\*\*Default use:\*\*\s*(.+?)\s*$/m;
const FIELD_INPUT       = /^\*\*Input:\*\*\s*(.+?)\s*$/m;
const FIELD_OUTPUT      = /^\*\*Output:\*\*\s*(.+?)\s*$/m;
const FIELD_AFFECTS     = /^\*\*Affects:\*\*\s*(.+?)\s*$/m;
const FIELD_PAIRS_WITH  = /^\*\*Pairs with:\*\*\s*(.+?)\s*$/m;

function matchField(body: string, re: RegExp): string | undefined {
  const m = body.match(re);
  return m ? m[1] : undefined;
}

export function extractGraphEntities(content: string, sourcePath: string): GraphEntity[] {
  // CONVENTIONS-*.md docs intentionally carry doc-type markers to explain them,
  // but their example H3s should not become graph entities. Skip by basename.
  const basename = sourcePath.replace(/^.*\//, "");
  if (basename.startsWith("CONVENTIONS-")) return [];

  const entities: GraphEntity[] = [];

  // ── hardware-reference ────────────────────────────────────────────────────
  if (content.includes(DOC_TYPE_MARKER)) {
    const { fm, rest } = parseFrontmatter(content);
    const defaultChip = fm.chip ?? "";

    for (const { heading, body } of splitH3Sections(rest)) {
      // Try Register pattern
      const regM = heading.match(REG_H3);
      if (regM) {
        const [, addr, name, , rw] = regM;
        const chipField = matchField(body, FIELD_CHIP);
        const chip = chipField ?? defaultChip;
        if (chip) {
          // Always derive the hex-byte form (e.g. "D011") from the address.
          // Emit it as an alias only when the canonical name differs (e.g.
          // mnemonic-style "SCROLY"). When name == hexForm, aliases is empty.
          const hexForm = addr.replace(/^\$/, "");
          const aliases: string[] = name !== hexForm ? [hexForm] : [];
          entities.push({ type: "register", name, address: addr, chip, rw, aliases });
          entities.push({ type: "belongs_to", entityName: name, entityType: "Register", chip });
        }
        continue;
      }

      // Try Memory region pattern (must come before KERNAL since both use single-address with em-dash;
      // memory has $START-$END not $ADDR alone)
      const memM = heading.match(MEMORY_H3);
      if (memM) {
        const [, start, end, name] = memM;
        const bankField = matchField(body, FIELD_BANK);
        const bank = bankField?.toLowerCase().startsWith("y") ?? false;
        entities.push({
          type: "memory_region",
          name: name.trim(),
          start,
          end,
          default_use: matchField(body, FIELD_DEFAULT_USE),
          bank_switchable: bank,
        });
        continue;
      }

      // Try KERNAL routine pattern
      const krnM = heading.match(KERNAL_H3);
      if (krnM) {
        const [, addr, name, description] = krnM;
        entities.push({
          type: "kernal_routine",
          name,
          address: addr,
          description: description.trim(),
          input: matchField(body, FIELD_INPUT),
          output: matchField(body, FIELD_OUTPUT),
          affects: matchField(body, FIELD_AFFECTS),
        });
        const pairsField = matchField(body, FIELD_PAIRS_WITH);
        if (pairsField) {
          const pairs = pairsField.split(/[,;]/).map((s) => s.trim().replace(/`/g, "")).filter(Boolean);
          for (const b of pairs) {
            entities.push({ type: "pairs_with", a: name, b });
          }
        }
        continue;
      }
    }

    return entities;
  }

  // ── toolchain-reference ───────────────────────────────────────────────────
  if (content.includes(TOOLCHAIN_MARKER)) {
    const { fm, rest } = parseFrontmatter(content);
    if (fm.tool && fm.tool_kind && fm.home_url) {
      entities.push({
        type: "tool",
        name: fm.tool,
        kind: fm.tool_kind,
        maintainer: fm.maintainer,
        license: fm.license,
        home_url: fm.home_url,
        // The version the repo's gates ran with (CONVENTIONS-toolchain-reference.md).
        ...(fm.version_verified ? { version_verified: fm.version_verified.replace(/^["']|["']$/g, "") } : {}),
      });
    }

    // Walk the body line-by-line for FormatH3 + Produced/Consumed/Targets blocks
    const lines = rest.split("\n");
    let currentFormat: string | null = null;
    for (const line of lines) {
      const f = line.match(FORMAT_H3);
      if (f) {
        currentFormat = f[1].replace(/^\./, "");
        entities.push({ type: "file_format", name: currentFormat, description: f[2] });
        continue;
      }
      const p = line.match(PRODUCED_BY);
      if (p && currentFormat) {
        for (const t of p[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          entities.push({ type: "produces", tool: t, format: currentFormat });
        }
        continue;
      }
      const c = line.match(CONSUMED_BY);
      if (c && currentFormat) {
        for (const t of c[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          entities.push({ type: "consumes", tool: t, format: currentFormat });
        }
        continue;
      }
      const tg = line.match(TARGETS);
      if (tg && fm.tool) {
        for (const chip of tg[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          entities.push({ type: "targets", tool: fm.tool, chip });
        }
      }
    }
    return entities;
  }

  // ── format-reference ──────────────────────────────────────────────────────
  if (content.includes(FORMAT_MARKER)) {
    // Parse FileFormat H3s + Produced/Consumed only — no Tool entity
    const lines = content.split("\n");
    let currentFormat: string | null = null;
    for (const line of lines) {
      const f = line.match(FORMAT_H3);
      if (f) {
        currentFormat = f[1].replace(/^\./, "");
        entities.push({ type: "file_format", name: currentFormat, description: f[2] });
        continue;
      }
      const p = line.match(PRODUCED_BY);
      if (p && currentFormat) {
        for (const t of p[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          entities.push({ type: "produces", tool: t, format: currentFormat });
        }
        continue;
      }
      const c = line.match(CONSUMED_BY);
      if (c && currentFormat) {
        for (const t of c[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          entities.push({ type: "consumes", tool: t, format: currentFormat });
        }
      }
    }
    return entities;
  }

  // ── recipe ────────────────────────────────────────────────────────────────
  if (content.includes(RECIPE_MARKER)) {
    const { fm } = parseFrontmatter(content);
    if (fm.recipe && fm.toolchain && fm.output_format && fm.region) {
      // Compose canonical recipe name: <toolchain>-<recipe>
      const name = `${fm.toolchain}-${fm.recipe}`;
      const parseArray = (v?: string): string[] => {
        if (!v) return [];
        // accept YAML flow-style "[A, B, C]" or empty "[]"
        const inner = v.replace(/^\[/, "").replace(/\]$/, "").trim();
        if (!inner) return [];
        return inner.split(",").map((s) => s.trim()).filter(Boolean);
      };
      const techniques = parseArray(fm.techniques);
      const file_formats = parseArray(fm.file_formats);
      const uses_registers = parseArray(fm.uses_registers);
      const uses_kernal = parseArray(fm.uses_kernal);
      // scaffolds: Archetype names this recipe is a starting point for
      // (docs/CONVENTIONS-recipes.md). Optional; absent reads as empty.
      const scaffolds = parseArray(fm.scaffolds);
      entities.push({
        type: "recipe",
        name,
        toolchain: fm.toolchain,
        output_format: fm.output_format,
        region: fm.region,
        techniques,
        file_formats,
        uses_registers,
        uses_kernal,
        scaffolds,
        source_doc: sourcePath,
      });
      for (const tech of techniques) {
        entities.push({ type: "implements", recipe: name, technique: tech });
      }
      for (const arch of scaffolds) {
        entities.push({ type: "scaffolds", recipe: name, archetype: arch });
      }
      for (const fmt of file_formats) {
        entities.push({ type: "produces_format", recipe: name, format: fmt });
      }
      // Load addresses from the listing itself -> OCCUPIES edges to the
      // MemoryRegion nodes those addresses fall in.
      const seen = new Set<string>();
      const occupy = (start: number, end: number) => {
        const key = `${start}:${end}`;
        if (seen.has(key)) return;
        seen.add(key);
        entities.push({ type: "recipe_occupies", recipe: name, start, end });
      };
      for (const m of content.matchAll(KICK_ORIGIN)) occupy(parseInt(m[1], 16), parseInt(m[1], 16));
      for (const m of content.matchAll(CA65_ORIGIN)) occupy(parseInt(m[1], 16), parseInt(m[1], 16));
      for (const m of content.matchAll(OSCAR_REGION)) occupy(parseInt(m[1], 16), parseInt(m[2], 16) - 1);
    }
    return entities;
  }

  // ── technique-reference ───────────────────────────────────────────────────
  if (content.includes(TECHNIQUE_MARKER)) {
    const { fm, rest } = parseFrontmatter(content);
    const category = fm.category;
    const docChip = fm.chip;
    if (!category) return entities;
    if (!TECHNIQUE_CATEGORIES.has(category)) {
      console.warn(`[extract] ${sourcePath}: technique doc category "${category}" is not in the ontology's category set — no techniques ingested from this file (see CONVENTIONS-techniques.md)`);
      return entities;
    }

    // Split body at H2 boundaries (each H2 = one Technique).
    const lines = rest.split("\n");
    let currentTech: { name: string; title: string; category: string; complexity?: string; chip?: string } | null = null;
    let pendingMeta: { region?: string; usesReg?: string[]; usesKernal?: string[]; demands?: string[]; requires?: string[]; cost?: TechniqueCost; costBasis?: string; rasterBand?: string } = {};

    const flush = () => {
      if (!currentTech) return;
      // Cost rides the technique entity itself, not an edge, so it must be
      // settled before the push.
      let cost: TechniqueCost | undefined;
      let costBasis: CostBasis | undefined;
      if (pendingMeta.cost !== undefined) {
        const basis = pendingMeta.costBasis;
        if (basis === undefined) {
          console.warn(`[extract] ${sourcePath}: technique ${currentTech.name} has a **Cost:** line but no **Cost basis:** line — Cost not ingested (see CONVENTIONS-techniques.md)`);
        } else if (!(COST_BASIS_WORDS as readonly string[]).includes(basis)) {
          console.warn(`[extract] ${sourcePath}: technique ${currentTech.name} has cost basis "${basis}", which is not one of ${COST_BASIS_WORDS.join(", ")} — Cost not ingested (see CONVENTIONS-techniques.md)`);
        } else if (Object.keys(pendingMeta.cost).length === 0) {
          console.warn(`[extract] ${sourcePath}: technique ${currentTech.name} has a **Cost:** line with no usable pair — Cost not ingested`);
        } else {
          cost = pendingMeta.cost;
          costBasis = basis as CostBasis;
        }
      } else if (pendingMeta.costBasis !== undefined) {
        console.warn(`[extract] ${sourcePath}: technique ${currentTech.name} has a **Cost basis:** line but no **Cost:** line — ignored`);
      }
      entities.push({
        type: "technique",
        ...currentTech,
        ...(cost !== undefined && costBasis !== undefined ? { cost, cost_basis: costBasis } : {}),
        ...(pendingMeta.rasterBand !== undefined ? { raster_band: pendingMeta.rasterBand } : {}),
      });
      if (currentTech.chip) {
        entities.push({ type: "technique_belongs_to", technique: currentTech.name, chip: currentTech.chip });
      }
      for (const d of pendingMeta.demands ?? []) {
        if (!(d in DEMAND_VOCABULARY)) {
          console.warn(`[extract] ${sourcePath}: technique ${currentTech.name} demands unknown resource "${d}" — not ingested (see CONVENTIONS-techniques.md)`);
          continue;
        }
        entities.push({ type: "technique_demands", technique: currentTech.name, resource: d, description: DEMAND_VOCABULARY[d] });
      }
      const seenRequires = new Set<string>();
      for (const r of pendingMeta.requires ?? []) {
        if (!TECHNIQUE_NAME.test(r)) {
          console.warn(`[extract] ${sourcePath}: technique ${currentTech.name} requires "${r}", which is not a snake_case technique name — not ingested (see CONVENTIONS-techniques.md)`);
          continue;
        }
        if (r === currentTech.name) {
          console.warn(`[extract] ${sourcePath}: technique ${currentTech.name} lists itself under **Requires:** — not ingested`);
          continue;
        }
        if (seenRequires.has(r)) continue;
        seenRequires.add(r);
        entities.push({ type: "technique_requires", technique: currentTech.name, requires: r });
      }
      if (pendingMeta.region && pendingMeta.region !== "both") {
        entities.push({ type: "technique_requires_region", technique: currentTech.name, region: pendingMeta.region });
      }
      for (const r of pendingMeta.usesReg ?? []) {
        entities.push({ type: "technique_uses_register", technique: currentTech.name, register: r });
      }
      for (const k of pendingMeta.usesKernal ?? []) {
        entities.push({ type: "technique_uses_kernal", technique: currentTech.name, kernal: k });
      }
      currentTech = null;
      pendingMeta = {};
    };

    for (const line of lines) {
      const h2 = line.match(TECHNIQUE_H2);
      if (h2) {
        flush();
        currentTech = {
          name: h2[1],
          title: h2[2].trim(),
          category,
          chip: docChip,
        };
        continue;
      }
      if (!currentTech) continue;
      const c = line.match(COMPLEXITY_LINE);
      if (c) {
        currentTech.complexity = c[1];
        continue;
      }
      const r = line.match(REGION_LINE);
      if (r) {
        pendingMeta.region = r[1];
        continue;
      }
      // Treat "(none)" / "none" / "[]" / "-" as empty so docs can author
      // explicit-empty without leaking sentinel names into the graph.
      const isEmptySentinel = (v: string): boolean => {
        const t = v.trim().toLowerCase();
        return t === "" || t === "(none)" || t === "none" || t === "[]" || t === "-";
      };
      const ur = line.match(USES_REGISTERS);
      if (ur) {
        pendingMeta.usesReg = isEmptySentinel(ur[1])
          ? []
          : ur[1].split(",").map((s) => s.trim()).filter((s) => s !== "" && !isEmptySentinel(s));
        continue;
      }
      const uk = line.match(USES_KERNAL);
      if (uk) {
        pendingMeta.usesKernal = isEmptySentinel(uk[1])
          ? []
          : uk[1].split(",").map((s) => s.trim()).filter((s) => s !== "" && !isEmptySentinel(s));
        continue;
      }
      const dm = line.match(DEMANDS_LINE);
      if (dm) {
        pendingMeta.demands = isEmptySentinel(dm[1])
          ? []
          : dm[1].split(",").map((s) => s.trim()).filter((s) => s !== "" && !isEmptySentinel(s));
        continue;
      }
      const rq = line.match(REQUIRES_LINE);
      if (rq) {
        pendingMeta.requires = isEmptySentinel(rq[1])
          ? []
          : rq[1].split(",").map((s) => s.trim().replace(/`/g, "")).filter((s) => s !== "" && !isEmptySentinel(s));
        continue;
      }
      const rb = line.match(RASTER_BAND_LINE);
      if (rb) {
        const band = parseRasterBand(rb[1]);
        if ("error" in band) {
          console.warn(`[extract] ${sourcePath}: technique ${currentTech.name} has **Raster band:** ${JSON.stringify(rb[1].trim())}: ${band.error} — band not ingested, so the technique conflicts as if it had none (see CONVENTIONS-techniques.md)`);
        } else {
          pendingMeta.rasterBand = band.canonical;
        }
        continue;
      }
      const cb = line.match(COST_BASIS_LINE);
      if (cb) {
        pendingMeta.costBasis = cb[1].trim().replace(/`/g, "");
        continue;
      }
      const co = line.match(COST_LINE);
      if (co) {
        const techName = currentTech.name;
        const cost: TechniqueCost = {};
        const pairs = isEmptySentinel(co[1])
          ? []
          : co[1].split(",").map((s) => s.trim().replace(/`/g, "")).filter((s) => s !== "");
        for (const pair of pairs) {
          const m = pair.match(COST_PAIR);
          const eq = pair.indexOf("=");
          const key = (eq >= 0 ? pair.slice(0, eq) : pair).trim();
          const val = eq >= 0 ? pair.slice(eq + 1).trim() : "";
          if (!(key in COST_VOCABULARY)) {
            console.warn(`[extract] ${sourcePath}: technique ${techName} has cost key "${key}", which is not in the cost vocabulary — pair skipped (see CONVENTIONS-techniques.md)`);
            continue;
          }
          if (!m || !INTEGER.test(val) || Number(val) < 0) {
            console.warn(`[extract] ${sourcePath}: technique ${techName} has cost ${key}=${JSON.stringify(val)}, which is not a non-negative integer — pair skipped (see CONVENTIONS-techniques.md)`);
            continue;
          }
          const ceiling = COST_MAXIMUM[key];
          if (ceiling !== undefined && Number(val) > ceiling) {
            console.warn(`[extract] ${sourcePath}: technique ${techName} has cost ${key}=${val}, above the hardware maximum of ${ceiling} — pair skipped (see CONVENTIONS-techniques.md)`);
            continue;
          }
          cost[key as CostKey] = Number(val);
        }
        pendingMeta.cost = cost;
      }
    }
    flush();
    return entities;
  }

  // ── pitfall-reference ─────────────────────────────────────────────────────
  if (content.includes(PITFALL_MARKER)) {
    const { fm, rest } = parseFrontmatter(content);
    const category = fm.category;
    if (!category) {
      console.warn(`[extract] pitfall doc ${sourcePath} missing 'category' frontmatter — skipping`);
      return entities;
    }
    for (const section of splitH2Sections(rest)) {
      const headerMatch = section.heading.match(PITFALL_H2);
      if (!headerMatch) continue;
      const [, name, title] = headerMatch;

      const severityMatch = matchField(section.body, SEVERITY_LINE);
      const regionMatch = matchField(section.body, PITFALL_REGION_LINE);
      const severity = (severityMatch ?? "medium").toLowerCase();
      const region = (regionMatch ?? "both").toLowerCase();

      entities.push({ type: "pitfall", name, title, severity, region, category });

      const regs = matchField(section.body, TRIGGERED_REGS);
      if (regs) {
        for (const r of regs.split(",").map(s => s.trim()).filter(Boolean)) {
          entities.push({ type: "triggered_by", pitfall: name, target: r, targetKind: "Register" });
        }
      }
      const kernals = matchField(section.body, TRIGGERED_KERNAL);
      if (kernals) {
        for (const k of kernals.split(",").map(s => s.trim()).filter(Boolean)) {
          entities.push({ type: "triggered_by", pitfall: name, target: k, targetKind: "KernalRoutine" });
        }
      }
      const techs = matchField(section.body, TRIGGERED_TECHS);
      if (techs) {
        for (const t of techs.split(",").map(s => s.trim()).filter(Boolean)) {
          entities.push({ type: "triggered_by", pitfall: name, target: t, targetKind: "Technique" });
        }
      }
      const mitigators = matchField(section.body, MITIGATED_TECHS);
      if (mitigators) {
        const seen = new Set<string>();
        for (const t of mitigators.split(",").map(s => s.trim().replace(/`/g, "")).filter(Boolean)) {
          if (!TECHNIQUE_NAME.test(t)) {
            console.warn(`[extract] ${sourcePath}: pitfall ${name} is mitigated by "${t}", which is not a snake_case technique name — not ingested (see CONVENTIONS-pitfalls.md)`);
            continue;
          }
          if (seen.has(t)) continue;
          seen.add(t);
          entities.push({ type: "mitigated_by", pitfall: name, target: t });
        }
      }
    }
    return entities;
  }

  // ── archetype-reference ───────────────────────────────────────────────────
  if (content.includes(ARCHETYPE_MARKER)) {
    const { fm, rest } = parseFrontmatter(content);
    const kind = fm.kind ?? "game";
    if (!ARCHETYPE_KINDS.has(kind)) {
      console.warn(`[extract] ${sourcePath}: archetype doc kind "${kind}" is not game or demo — no archetypes ingested from this file (see CONVENTIONS-archetypes.md)`);
      return entities;
    }
    const seenNames = new Set<string>();
    // Split a backticked, comma-separated name list; refuse anything that is
    // not a snake_case name here. Whether a name exists in the graph is
    // settled at link time, where a miss is warned about and counted.
    const nameList = (line: string | undefined, archetype: string, label: string): string[] => {
      if (!line) return [];
      const out: string[] = [];
      for (const raw of line.split(",")) {
        const n = raw.trim().replace(/`/g, "");
        if (!n) continue;
        if (!TECHNIQUE_NAME.test(n)) {
          console.warn(`[extract] ${sourcePath}: archetype ${archetype} lists "${n}" under ${label}, which is not a snake_case name — not ingested (see CONVENTIONS-archetypes.md)`);
          continue;
        }
        if (out.includes(n)) continue;
        out.push(n);
      }
      return out;
    };
    for (const section of splitH2Sections(rest)) {
      const title = section.heading.replace(/^##\s+/, "").trim();
      const nameM = section.body.match(ARCHETYPE_NAME_LINE);
      if (!nameM) {
        // A prose H2 on an archetype page (history, cross-references, a
        // buildable-reference table) is allowed and silent. Only a section
        // that carries a fingerprint or pitfall line without naming its
        // archetype is a mistake worth a warning.
        if (ARCHETYPE_FINGERPRINT.test(section.body) || ARCHETYPE_PITFALLS.test(section.body)) {
          console.warn(`[extract] ${sourcePath}: H2 "${title}" has a fingerprint or pitfall line but no **Archetype:** line — not ingested (see CONVENTIONS-archetypes.md)`);
        }
        continue;
      }
      const name = nameM[1];
      if (seenNames.has(name)) {
        console.warn(`[extract] ${sourcePath}: archetype name "${name}" appears under two H2s — second one not ingested`);
        continue;
      }
      seenNames.add(name);
      entities.push({ type: "archetype", name, title, kind: kind as "game" | "demo", source_doc: sourcePath });
      for (const t of nameList(matchField(section.body, ARCHETYPE_FINGERPRINT), name, "**Technique fingerprint:**")) {
        entities.push({ type: "archetype_features", archetype: name, technique: t });
      }
      for (const p of nameList(matchField(section.body, ARCHETYPE_PITFALLS), name, "**Common pitfalls:**")) {
        entities.push({ type: "archetype_risks", archetype: name, pitfall: p });
      }
    }
    return entities;
  }

  // ── failure-reference ─────────────────────────────────────────────────────
  if (content.includes(FAILURE_MARKER)) {
    const sections = splitH2Sections(parseFrontmatter(content).rest);
    for (const section of sections) {
      const headerMatch = section.heading.match(CRASH_H2);
      if (!headerMatch) continue;
      const [, symptom, description] = headerMatch;

      const causesLine = matchField(section.body, LIKELY_CAUSES) ?? "";
      const likely_causes = causesLine.split(",").map(s => s.trim()).filter(Boolean);
      const diagnosis_steps = matchField(section.body, DIAGNOSIS_STEPS) ?? "";

      entities.push({ type: "crash_pattern", symptom, description, likely_causes, diagnosis_steps });

      for (const [re, kind] of [
        [CAUSED_REGS, "Register"],
        [CAUSED_KERNAL, "KernalRoutine"],
        [CAUSED_TECHS, "Technique"],
      ] as const) {
        const line = matchField(section.body, re);
        if (line) {
          for (const target of line.split(",").map(s => s.trim()).filter(Boolean)) {
            entities.push({ type: "caused_by", symptom, target, targetKind: kind });
          }
        }
      }
    }
    return entities;
  }

  return entities;
}
