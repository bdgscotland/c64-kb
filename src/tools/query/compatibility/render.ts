/**
 * Markdown for a compatibility check.
 */

import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";

type Output = CompatibilityCheckOutput;

function renderVerdict(r: Output, closureOnly: readonly string[]): string {
  let out = `# Compatibility: ${r.techniques.join(" + ")}\n\n**Verdict:** ${r.verdict.toUpperCase()}`;
  if (r.verdict === "incompatible")
    out += ` — not as combined; each hard conflict below says how to separate them.`;
  out += `\n\n`;
  if (closureOnly.length > 0) {
    out += `Checked with ${closureOnly.length} implied prerequisite(s): ${closureOnly.join(", ")}.\n\n`;
  }
  return out;
}

/**
 * Unit claims: how many inputs state them, and which do not, because an
 * unknown claim set is never read as "claims nothing". Technique claims
 * only: the vectors and zero-page bytes a recipe picks are not in the graph.
 */
function renderClaimsCoverage(r: Output): string {
  const inputs = r.data_coverage.filter((d) => d.implied_by === undefined);
  const stated = inputs.filter((d) => d.claims !== "unknown").length;
  const notRuledOut = [
    ...inputs.filter((d) => d.claims === "unknown").map((d) => d.technique),
    ...r.data_coverage
      .filter((d) => d.implied_by !== undefined && d.claims === "unknown")
      .map((d) => `${d.technique} (prerequisite)`),
  ];
  const tail =
    notRuledOut.length > 0 ? `; a unit conflict cannot be ruled out for: ${notRuledOut.join(", ")}.` : ".";
  return `Unit claims are stated for ${stated} of ${inputs.length} techniques${tail} The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).\n\n`;
}

function renderConflicts(r: Output, unknownCount: number): string {
  if (r.conflicts.length === 0) {
    return unknownCount === r.techniques.length
      ? `No conflicts detected, but the graph holds no register, KERNAL or resource data for any of these techniques, so this is silence, not a clearance.\n`
      : `No conflicts detected among what the graph knows about these techniques.\n`;
  }
  let out = "";
  for (const c of r.conflicts) {
    out += `## ${c.kind} (${c.severity}): ${c.a} × ${c.b}\n`;
    if (c.via && c.via.length > 0) out += `**Via prerequisite(s):** ${c.via.join(", ")}\n`;
    if (c.underlying_kind) out += `**Rule:** ${c.underlying_kind}\n`;
    out += `**Shared:** ${c.shared.join(", ")}\n`;
    out += `${c.rationale}\n`;
    if (c.resolution) out += `**Resolution:** ${c.resolution}\n`;
    out += `\n`;
  }
  return out;
}

function renderBandSeparated(r: Output): string {
  if (r.band_separated.length === 0) return "";
  let out = `\n## Separated by raster band (info)\n`;
  for (const s of r.band_separated) {
    out += `- **${s.a}** (lines ${s.a_band}) and **${s.b}** (lines ${s.b_band}) share no raster line, so ${s.rules.join(", ")} does not apply. Keep each on its own lines: the check trusts the bands the pages state.\n`;
  }
  return out;
}

type Coverage = Output["data_coverage"][number];

function renderNotCovered(unknown: readonly Coverage[], unknownImplied: readonly Coverage[]): string {
  if (unknown.length === 0 && unknownImplied.length === 0) return "";
  let out = `\n## Not covered\n`;
  for (const d of unknown) {
    out += d.found
      ? `- **${d.technique}**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.\n`
      : `- **${d.technique}**: no such technique in the graph (check the name with c64_techniques_for).\n`;
  }
  for (const d of unknownImplied) {
    out += `- **${d.technique}** (prerequisite of ${(d.implied_by ?? []).join(", ")}): the graph has no registers, KERNAL routines or demands for it.\n`;
  }
  return out;
}

function renderInfrastructure(r: Output): string {
  if (r.shared_infrastructure.length === 0) return "";
  let out = `\n## Shared Infrastructure (info)\n`;
  for (const s of r.shared_infrastructure) {
    if (s.kind === "discipline") {
      out += `- **${s.name}**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.\n`;
    } else if (s.kind === "missing_prerequisite") {
      out += `- **${s.name}** (prerequisite, not in the set): required by ${(s.required_by ?? []).join(", ")}; included in the check as implied. Set it up first.\n`;
    } else {
      out += `- **${s.name}** (${s.kind}) shared via recipe(s): ${s.via_recipes.join(", ")}\n`;
    }
  }
  return out;
}

export function renderCompatibility(r: Output, closureOnly: readonly string[]): string {
  // "Not covered" is about the named techniques; implied ones are listed
  // separately so the silence-vs-clearance sentence keeps its denominator.
  const unknown = r.data_coverage.filter((d) => !d.known && d.implied_by === undefined);
  const unknownImplied = r.data_coverage.filter((d) => !d.known && d.implied_by !== undefined);
  return (
    renderVerdict(r, closureOnly) +
    renderClaimsCoverage(r) +
    renderConflicts(r, unknown.length) +
    renderBandSeparated(r) +
    renderNotCovered(unknown, unknownImplied) +
    renderInfrastructure(r)
  );
}
