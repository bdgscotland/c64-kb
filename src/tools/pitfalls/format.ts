/** Text renderings for pitfallsFor and failureDiagnose. */

import type { ChunkPayload } from "../../services/qdrant.ts";
import type { PitfallsForOutput, FailureDiagnoseOutput } from "../../schemas/tool-outputs.ts";
import type { EntityKind } from "./graph.ts";

/**
 * Strip the leading "${section}\n\n" prefix from a chunk's stored
 * text so it isn't rendered twice (once in the formatter heading,
 * once at the top of the body). Mirrors the pattern in query.ts.
 */
function stripSectionPrefix(section: string, text: string): string {
  const prefix = `${section}\n\n`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

export function formatSearchFallbackText(
  topic: string,
  results: (ChunkPayload & { score: number })[],
): string {
  const lines = [`No direct entity match for "${topic}". Top pitfall-doc matches:`, ""];
  for (const r of results) {
    lines.push(`### ${r.source} — ${r.section} (score: ${r.score.toFixed(3)})`);
    lines.push(stripSectionPrefix(r.section, r.text).slice(0, 240).trim());
    lines.push("");
  }
  return lines.join("\n");
}

function formatVia(via: PitfallsForOutput["pitfalls"][number]["via"], kind: EntityKind): string {
  if (!via?.length) return "";
  const names = via.map((v) => `${v.name}${v.address ? " " + v.address : ""} (${v.kind})`).join(", ");
  const how = kind === "LibraryFunction" ? "which this function wraps" : "which this technique uses";
  return `**Reached through:** ${names}, ${how}\n`;
}

export function formatPitfallsText(
  topic: string,
  kind: EntityKind,
  pitfalls: PitfallsForOutput["pitfalls"],
): string {
  if (pitfalls.length === 0) {
    return `No pitfalls found for ${kind} "${topic}".`;
  }
  const header = `Found ${pitfalls.length} pitfall(s) for ${kind} "${topic}":\n\n`;
  const rows = pitfalls.map((p) => {
    const triggers = p.triggered_by.map((t) => `${t.name} (${t.kind})`).join(", ");
    const remedies = p.mitigated_by.map((t) => t.name).join(", ");
    return (
      `### ${p.name} [${p.severity}, ${p.region}]\n` +
      `**${p.title}**\n` +
      `**Category:** ${p.category}\n` +
      (triggers ? `**Triggered by:** ${triggers}\n` : "") +
      (remedies ? `**Mitigated by:** ${remedies}\n` : "") +
      formatVia(p.via, kind)
    );
  });
  return header + rows.join("\n");
}

/** At most three owners by name, then a count. */
function ownersText(owners: string[]): string {
  const shown = owners.slice(0, 3).join(", ");
  return owners.length > 3 ? `${shown} and ${owners.length - 3} more` : shown;
}

/**
 * A technique's answer: its page's own pitfalls first, then the Pitfall
 * nodes, then the register-reached ones left out as other techniques'.
 */
export function formatTechniquePitfallsText(
  out: PitfallsForOutput,
  where: { key: string; inGraph: boolean },
): string {
  const { key, inGraph } = where;
  const parts: string[] = [];
  const page = out.page_pitfalls;
  if (page && page.items.length > 0) {
    parts.push(
      `## On its page (${page.source}, ${key}'s Pitfalls section)\n\n` +
        page.items.map((i) => `- ${i}`).join("\n") +
        "\n",
    );
  } else if (page) {
    parts.push(`${key}'s section in ${page.source} has no Pitfalls section.\n`);
  }
  if (!inGraph) parts.push(`${key} is on its page but not in the graph: re-run the ingest.\n`);
  if (out.pitfalls.length > 0) {
    parts.push(formatPitfallsText(out.topic, "Technique", out.pitfalls));
  } else if (inGraph) {
    parts.push(
      `${key} is a technique; no Pitfall node names it (no TRIGGERED_BY or MITIGATED_BY edge, and none through the registers and KERNAL routines it uses${out.left_out?.length ? " other than those left out below" : ""}).\n`,
    );
  }
  if (out.left_out && out.left_out.length > 0) {
    parts.push(
      `**Left out:** ${out.left_out.length} pitfall(s) reached through a register this technique uses, which other techniques trigger and this one neither is nor requires: ` +
        out.left_out.map((l) => `${l.name} (${ownersText(l.owners)})`).join(", ") +
        ".\n",
    );
  }
  return parts.join("\n");
}

export function formatFailureDiagnoseText(query: string, matches: FailureDiagnoseOutput["matches"]): string {
  if (matches.length === 0) {
    return `No failure patterns matched "${query}". Try c64_search for broader lookup.`;
  }
  const header = `# Failure diagnosis: "${query}"\n\nTop ${matches.length} match(es):\n\n`;
  const rows = matches.map((m) => {
    const causedBy = m.caused_by.map((c) => `${c.name} (${c.kind})`).join(", ");
    return (
      `## ${m.symptom} (relevance: ${m.relevance.toFixed(2)})\n` +
      `${m.description}\n\n` +
      `**Likely causes:** ${m.likely_causes.join(", ")}\n\n` +
      `**Diagnosis:** ${m.diagnosis_steps}\n` +
      (causedBy ? `**Caused by:** ${causedBy}\n` : "")
    );
  });
  return header + rows.join("\n---\n\n");
}
