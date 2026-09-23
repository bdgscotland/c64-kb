/** failure-reference pages: one CrashPattern per `## symptom — Description` H2. */

import { group, matchField, parseFrontmatter, splitH2Sections, splitList, type Section } from "./common.ts";
import { ENTITY_H2 } from "./technique.ts";
import type { GraphEntity, TargetKind } from "./types.ts";

const LIKELY_CAUSES = /^\*\*Likely causes:\*\*\s+(.+)$/m;
const DIAGNOSIS_STEPS = /^\*\*Diagnosis steps:\*\*\s+(.+)$/m;
const CAUSE_LINES: readonly [RegExp, TargetKind][] = [
  [/^\*\*Caused by registers:\*\*\s+(.+)$/m, "Register"],
  [/^\*\*Caused by kernal:\*\*\s+(.+)$/m, "KernalRoutine"],
  [/^\*\*Caused by techniques:\*\*\s+(.+)$/m, "Technique"],
];

function sectionEntities(section: Section): GraphEntity[] {
  const header = ENTITY_H2.exec(section.heading);
  if (!header) return [];
  const symptom = group(header, 1);
  const out: GraphEntity[] = [
    {
      type: "crash_pattern",
      symptom,
      description: group(header, 2),
      likely_causes: splitList(matchField(section.body, LIKELY_CAUSES) ?? ""),
      diagnosis_steps: matchField(section.body, DIAGNOSIS_STEPS) ?? "",
    },
  ];
  for (const [re, targetKind] of CAUSE_LINES) {
    const line = matchField(section.body, re);
    if (!line) continue;
    for (const target of splitList(line)) out.push({ type: "caused_by", symptom, target, targetKind });
  }
  return out;
}

export function parseFailureDoc(content: string): GraphEntity[] {
  return splitH2Sections(parseFrontmatter(content).rest).flatMap(sectionEntities);
}
