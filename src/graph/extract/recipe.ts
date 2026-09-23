/** recipe pages (docs/CONVENTIONS-recipes.md): frontmatter lists plus load addresses read from the listing. */

import { group, parseFrontmatter } from "./common.ts";
import type { GraphEntity } from "./types.ts";

// Recipe listings declare where they load: KickAssembler `* = $0900`,
// Oscar64 `#pragma region( name, 0x0a00, 0x1000, ...)`, ca65 `.org $0801`.
const KICK_ORIGIN = /^\s*\*\s*=\s*\$([0-9A-Fa-f]{4})\b/gm;
const CA65_ORIGIN = /^\s*\.org\s+\$([0-9A-Fa-f]{4})\b/gm;
const OSCAR_REGION = /#pragma\s+region\s*\(\s*\w+\s*,\s*0x([0-9A-Fa-f]+)\s*,\s*0x([0-9A-Fa-f]+)/g;

/** A YAML flow-style list, "[A, B, C]" or "[]"; absent reads as empty. */
function parseArray(v?: string): string[] {
  if (!v) return [];
  const inner = v.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Load addresses from the listing itself -> OCCUPIES edges to the MemoryRegion nodes they fall in. */
function occupiesEntities(content: string, recipe: string): GraphEntity[] {
  const ranges: [number, number][] = [];
  for (const m of content.matchAll(KICK_ORIGIN))
    ranges.push([parseInt(group(m, 1), 16), parseInt(group(m, 1), 16)]);
  for (const m of content.matchAll(CA65_ORIGIN))
    ranges.push([parseInt(group(m, 1), 16), parseInt(group(m, 1), 16)]);
  for (const m of content.matchAll(OSCAR_REGION))
    ranges.push([parseInt(group(m, 1), 16), parseInt(group(m, 2), 16) - 1]);
  const seen = new Set<string>();
  const entities: GraphEntity[] = [];
  for (const [start, end] of ranges) {
    const key = `${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push({ type: "recipe_occupies", recipe, start, end });
  }
  return entities;
}

export function parseRecipeDoc(content: string, sourcePath: string): GraphEntity[] {
  const { fm } = parseFrontmatter(content);
  if (!fm.recipe || !fm.toolchain || !fm.output_format || !fm.region) return [];
  // Canonical recipe name: <toolchain>-<recipe>
  const name = `${fm.toolchain}-${fm.recipe}`;
  const techniques = parseArray(fm.techniques);
  const file_formats = parseArray(fm.file_formats);
  // scaffolds: Archetype names this recipe is a starting point for
  // (docs/CONVENTIONS-recipes.md). Optional; absent reads as empty.
  const scaffolds = parseArray(fm.scaffolds);
  return [
    {
      type: "recipe",
      name,
      toolchain: fm.toolchain,
      output_format: fm.output_format,
      region: fm.region,
      techniques,
      file_formats,
      uses_registers: parseArray(fm.uses_registers),
      uses_kernal: parseArray(fm.uses_kernal),
      scaffolds,
      source_doc: sourcePath,
    },
    ...techniques.map((technique): GraphEntity => ({ type: "implements", recipe: name, technique })),
    ...scaffolds.map((archetype): GraphEntity => ({ type: "scaffolds", recipe: name, archetype })),
    ...file_formats.map((format): GraphEntity => ({ type: "produces_format", recipe: name, format })),
    ...occupiesEntities(content, name),
  ];
}
