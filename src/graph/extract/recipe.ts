/** recipe pages (docs/CONVENTIONS-recipes.md): frontmatter lists plus load addresses read from the listing. */

import { CLAIMS_BASIS_WORDS, isClaimsBasis, parseClaims, type ClaimsBasis } from "../claims.ts";
import { group, parseFrontmatter, warn } from "./common.ts";
import { DEVICE_NAME } from "./device.ts";
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

interface RecipeClaims {
  stated: "stated" | "none";
  basis: ClaimsBasis;
  entities: GraphEntity[];
}

/**
 * The `claims:` key (schema 34), in the Claims-line grammar
 * (docs/CONVENTIONS-recipes.md). `[]` or `[none]` says the listing chooses
 * no unit beyond its techniques' claims; an absent key is unknown. The key
 * is written from a claims-watch trace, so the basis is measured-vice unless
 * `claims_basis:` says otherwise. A value outside the grammar is refused
 * whole, with a warning: a partial set would read as a complete one.
 */
function recipeClaims(
  fm: Partial<Record<string, string>>,
  recipe: string,
  sourcePath: string,
): RecipeClaims | null {
  const raw = fm.claims;
  if (raw === undefined) return null;
  const basis = fm.claims_basis ?? "measured-vice";
  if (!isClaimsBasis(basis)) {
    warn(
      `${sourcePath}: recipe claims_basis "${basis}" is not one of ${CLAIMS_BASIS_WORDS.join(", ")} — claims not ingested`,
    );
    return null;
  }
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "").trim();
  const parsed = inner === "" ? [] : parseClaims(inner);
  if ("error" in parsed) {
    warn(`${sourcePath}: recipe claims refused (${parsed.error}) — its claims read as unknown`);
    return null;
  }
  return {
    stated: parsed.length > 0 ? "stated" : "none",
    basis,
    entities: parsed.map((c): GraphEntity => ({
      type: "claims",
      owner: recipe,
      ownerKind: "Recipe",
      ...c,
      basis,
    })),
  };
}

/**
 * The `devices:` key (schema 36, #87): the Device names the recipe's run
 * attaches (docs/CONVENTIONS-devices.md). `[]` says it needs none beyond
 * the stock machine; an absent key is unknown. A name outside the Device
 * name form refuses the whole key, as a partial list would read as whole.
 */
export function recipeDevices(raw: string | undefined, sourcePath: string): string[] | null {
  if (raw === undefined) return null;
  const names = parseArray(raw).map((s) => s.replace(/`/g, ""));
  const bad = names.find((n) => !DEVICE_NAME.test(n));
  if (bad) {
    warn(
      `${sourcePath}: recipe devices lists "${bad}", which is not a device name — devices read as unknown`,
    );
    return null;
  }
  return [...new Set(names)];
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
  const claims = recipeClaims(fm, name, sourcePath);
  const devices = recipeDevices(fm.devices, sourcePath);
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
      ...(claims ? { claims_stated: claims.stated, claims_basis: claims.basis } : {}),
      ...(devices ? { devices_stated: devices.length > 0 ? "stated" : "none" } : {}),
    },
    ...techniques.map((technique): GraphEntity => ({ type: "implements", recipe: name, technique })),
    ...scaffolds.map((archetype): GraphEntity => ({ type: "scaffolds", recipe: name, archetype })),
    ...file_formats.map((format): GraphEntity => ({ type: "produces_format", recipe: name, format })),
    ...occupiesEntities(content, name),
    ...(claims?.entities ?? []),
    ...(devices ?? []).map((device): GraphEntity => ({ type: "requires_device", recipe: name, device })),
  ];
}
