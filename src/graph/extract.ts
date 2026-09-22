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
  | { type: "tool"; name: string; kind: string; maintainer?: string; license?: string; home_url: string }
  | { type: "file_format"; name: string; description: string }
  | { type: "produces"; tool: string; format: string }
  | { type: "consumes"; tool: string; format: string }
  | { type: "targets"; tool: string; chip: string }
  | { type: "recipe"; name: string; toolchain: string; output_format: string; region: string; techniques: string[]; file_formats: string[]; uses_registers: string[]; uses_kernal: string[]; source_doc: string }
  | { type: "recipe_occupies"; recipe: string; start: number; end: number }
  | { type: "technique_demands"; technique: string; resource: string; description: string }
  | { type: "implements"; recipe: string; technique: string }
  | { type: "produces_format"; recipe: string; format: string }
  | { type: "technique"; name: string; title: string; category: string; complexity?: string; chip?: string }
  | { type: "technique_uses_register"; technique: string; register: string }
  | { type: "technique_uses_kernal"; technique: string; kernal: string }
  | { type: "technique_requires_region"; technique: string; region: string }
  | { type: "technique_belongs_to"; technique: string; chip: string }
  | { type: "technique_requires"; technique: string; requires: string }
  | { type: "pitfall"; name: string; title: string; severity: string; region: string; category: string }
  | { type: "crash_pattern"; symptom: string; description: string; likely_causes: string[]; diagnosis_steps: string }
  | { type: "triggered_by"; pitfall: string; target: string; targetKind: "Register" | "KernalRoutine" | "Technique" }
  | { type: "mitigated_by"; pitfall: string; target: string }
  | { type: "caused_by"; symptom: string; target: string; targetKind: "Register" | "KernalRoutine" | "Technique" };

const DOC_TYPE_MARKER = "<!-- doc-type: hardware-reference -->";
const TOOLCHAIN_MARKER = "<!-- doc-type: toolchain-reference -->";
const RECIPE_MARKER = "<!-- doc-type: recipe -->";
const FORMAT_MARKER = "<!-- doc-type: format-reference -->";
const TECHNIQUE_MARKER = "<!-- doc-type: technique-reference -->";
const PITFALL_MARKER = "<!-- doc-type: pitfall-reference -->";
const FAILURE_MARKER = "<!-- doc-type: failure-reference -->";
const ENTITY_H2 = /^##\s+([a-z][a-z0-9_]*)\s+(?:—|--)\s+(.+)$/;
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

// H3 patterns. Note: em-dash is U+2014, not a regular ASCII hyphen.
// We accept both `—` (em-dash) and ` -- ` (double-hyphen) as separators for tolerance.
const SEP = /\s+(?:—|--)\s+/;

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
        source_doc: sourcePath,
      });
      for (const tech of techniques) {
        entities.push({ type: "implements", recipe: name, technique: tech });
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
    let pendingMeta: { region?: string; usesReg?: string[]; usesKernal?: string[]; demands?: string[]; requires?: string[] } = {};

    const flush = () => {
      if (!currentTech) return;
      entities.push({ type: "technique", ...currentTech });
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
