/** pitfall-reference pages (docs/CONVENTIONS-pitfalls.md): one Pitfall per `## name — Title` H2. */

import { group, matchField, parseFrontmatter, splitH2Sections, splitList, warn, type Section } from "./common.ts";
import { TECHNIQUE_NAME } from "./technique-entities.ts";
import { ENTITY_H2, REGION_LINE } from "./technique.ts";
import type { GraphEntity, TargetKind } from "./types.ts";

const SEVERITY_LINE = /^\*\*Severity:\*\*\s+(critical|high|medium|low)\s*$/im;
const TRIGGERED_REGS = /^\*\*Triggered by registers:\*\*\s+(.+)$/m;
const TRIGGERED_KERNAL = /^\*\*Triggered by kernal:\*\*\s+(.+)$/m;
const TRIGGERED_TECHS = /^\*\*Triggered by techniques:\*\*\s+(.+)$/m;
// **Mitigated by techniques:** names the Technique(s) whose application is the
// Fix section's remedy (docs/CONVENTIONS-pitfalls.md). Techniques only.
const MITIGATED_TECHS = /^\*\*Mitigated by techniques:\*\*\s+(.+)$/m;

const TRIGGER_LINES: readonly [RegExp, TargetKind][] = [
  [TRIGGERED_REGS, "Register"],
  [TRIGGERED_KERNAL, "KernalRoutine"],
  [TRIGGERED_TECHS, "Technique"],
];

function mitigatedByEntities(body: string, pitfall: string, sourcePath: string): GraphEntity[] {
  const line = matchField(body, MITIGATED_TECHS);
  if (!line) return [];
  const out: GraphEntity[] = [];
  const seen = new Set<string>();
  for (const t of splitList(line, { stripBackticks: true })) {
    if (!TECHNIQUE_NAME.test(t)) {
      warn(
        `${sourcePath}: pitfall ${pitfall} is mitigated by "${t}", which is not a snake_case technique name — not ingested (see CONVENTIONS-pitfalls.md)`,
      );
      continue;
    }
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({ type: "mitigated_by", pitfall, target: t });
  }
  return out;
}

function sectionEntities(section: Section, category: string, sourcePath: string): GraphEntity[] {
  const header = ENTITY_H2.exec(section.heading);
  if (!header) return [];
  const name = group(header, 1);
  const severity = (matchField(section.body, SEVERITY_LINE) ?? "medium").toLowerCase();
  const region = (matchField(section.body, REGION_LINE) ?? "both").toLowerCase();
  const out: GraphEntity[] = [{ type: "pitfall", name, title: group(header, 2), severity, region, category }];
  for (const [re, targetKind] of TRIGGER_LINES) {
    const line = matchField(section.body, re);
    if (!line) continue;
    for (const target of splitList(line)) out.push({ type: "triggered_by", pitfall: name, target, targetKind });
  }
  out.push(...mitigatedByEntities(section.body, name, sourcePath));
  return out;
}

export function parsePitfallDoc(content: string, sourcePath: string): GraphEntity[] {
  const { fm, rest } = parseFrontmatter(content);
  const category = fm.category;
  if (!category) {
    warn(`pitfall doc ${sourcePath} missing 'category' frontmatter — skipping`);
    return [];
  }
  return splitH2Sections(rest).flatMap((section) => sectionEntities(section, category, sourcePath));
}
