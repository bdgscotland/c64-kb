/**
 * hardware-reference pages (docs/CONVENTIONS-hardware-reference.md):
 *   - Register H3:   `### $D011 — D011 — Screen Control Register 1 (RW)`
 *   - KERNAL H3:     `### $FFD2 — CHROUT — Output a character`
 *   - Memory H3:     `### $0400-$07FF — Default Screen RAM`
 * Separators accept `—` (U+2014) or ` -- `.
 */

import { formatZeroPageRanges } from "../claims.ts";
import { CLOBBERS_LINE, parseClobbers } from "../kernal-clobbers.ts";
import { group, matchField, parseFrontmatter, splitH3Sections, warn, type Section } from "./common.ts";
import type { GraphEntity } from "./types.ts";

const REG_H3 = /^###\s+(\$[0-9A-F]{4})\s+(?:—|--)\s+([A-Z][A-Z0-9_]*)\s+(?:—|--)\s+(.+?)\s+\((R|W|RW)\)\s*$/;
const KERNAL_H3 = /^###\s+(\$[0-9A-F]{4})\s+(?:—|--)\s+([A-Z][A-Z0-9_]+)\s+(?:—|--)\s+(.+)$/;
const MEMORY_H3 = /^###\s+(\$[0-9A-F]{4})-(\$[0-9A-F]{4})\s+(?:—|--)\s+(.+)$/;

// Hardcoded per-field bold-label extractors (avoids dynamic RegExp construction).
const FIELD_CHIP = /^\*\*Chip:\*\*\s*(.+?)\s*$/m;
const FIELD_BANK = /^\*\*Bank-switchable:\*\*\s*(.+?)\s*$/m;
const FIELD_DEFAULT_USE = /^\*\*Default use:\*\*\s*(.+?)\s*$/m;
const FIELD_INPUT = /^\*\*Input:\*\*\s*(.+?)\s*$/m;
const FIELD_OUTPUT = /^\*\*Output:\*\*\s*(.+?)\s*$/m;
const FIELD_AFFECTS = /^\*\*Affects:\*\*\s*(.+?)\s*$/m;
const FIELD_PAIRS_WITH = /^\*\*Pairs with:\*\*\s*(.+?)\s*$/m;

/** Optional string fields, with the absent ones left out rather than set to undefined. */
function optionalFields(body: string, fields: Record<string, RegExp>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, re] of Object.entries(fields)) {
    const value = matchField(body, re);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function registerEntities(m: RegExpExecArray, body: string, defaultChip: string): GraphEntity[] {
  const addr = group(m, 1);
  const name = group(m, 2);
  const chip = matchField(body, FIELD_CHIP) ?? defaultChip;
  if (!chip) return [];
  // Always derive the hex-byte form (e.g. "D011") from the address. Emit it
  // as an alias only when the canonical name differs (e.g. mnemonic-style
  // "SCROLY"). When name == hexForm, aliases is empty.
  const hexForm = addr.replace(/^\$/, "");
  const aliases: string[] = name !== hexForm ? [hexForm] : [];
  return [
    { type: "register", name, address: addr, chip, rw: group(m, 4), aliases },
    { type: "belongs_to", entityName: name, entityType: "Register", chip },
  ];
}

function memoryEntity(m: RegExpExecArray, body: string): GraphEntity {
  const bank = matchField(body, FIELD_BANK)?.toLowerCase().startsWith("y") ?? false;
  return {
    type: "memory_region",
    name: group(m, 3).trim(),
    start: group(m, 1),
    end: group(m, 2),
    ...optionalFields(body, { default_use: FIELD_DEFAULT_USE }),
    bank_switchable: bank,
  };
}

/**
 * One CLOBBERS_ZP entity per `**Clobbers zero page:**` line (schema 26): the
 * may line the ROM walk writes and any must line a VICE trace wrote. A line
 * that does not parse is warned about and dropped, never guessed at.
 */
function clobberEntities(routine: string, body: string): GraphEntity[] {
  const out: GraphEntity[] = [];
  for (const m of body.matchAll(CLOBBERS_LINE)) {
    const c = parseClobbers(group(m, 1));
    if ("error" in c) {
      warn(`${routine}: **Clobbers zero page:** refused: ${c.error}`);
      continue;
    }
    out.push({
      type: "kernal_clobbers_zp",
      routine,
      ranges: formatZeroPageRanges(c.ranges),
      bound: c.bound,
      basis: c.basis,
    });
  }
  return out;
}

function kernalEntities(m: RegExpExecArray, body: string): GraphEntity[] {
  const name = group(m, 2);
  const entities: GraphEntity[] = [
    {
      type: "kernal_routine",
      name,
      address: group(m, 1),
      description: group(m, 3).trim(),
      ...optionalFields(body, { input: FIELD_INPUT, output: FIELD_OUTPUT, affects: FIELD_AFFECTS }),
    },
  ];
  entities.push(...clobberEntities(name, body));
  const pairsField = matchField(body, FIELD_PAIRS_WITH);
  if (pairsField) {
    const pairs = pairsField
      .split(/[,;]/)
      .map((s) => s.trim().replace(/`/g, ""))
      .filter(Boolean);
    for (const b of pairs) entities.push({ type: "pairs_with", a: name, b });
  }
  return entities;
}

function sectionEntities({ heading, body }: Section, defaultChip: string): GraphEntity[] {
  const regM = REG_H3.exec(heading);
  if (regM) return registerEntities(regM, body, defaultChip);
  // Memory before KERNAL: both start with an address and a dash separator,
  // but a memory heading has $START-$END where a KERNAL one has one $ADDR.
  const memM = MEMORY_H3.exec(heading);
  if (memM) return [memoryEntity(memM, body)];
  const krnM = KERNAL_H3.exec(heading);
  if (krnM) return kernalEntities(krnM, body);
  return [];
}

export function parseHardwareDoc(content: string): GraphEntity[] {
  const { fm, rest } = parseFrontmatter(content);
  const defaultChip = fm.chip ?? "";
  return splitH3Sections(rest).flatMap((section) => sectionEntities(section, defaultChip));
}
