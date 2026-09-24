/**
 * Markdown for a compatibility check.
 */

import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";

type Output = CompatibilityCheckOutput;

/** The refusal for names the graph does not hold, with a hint when one argument carries several names. */
function renderNotFound(r: Output): string {
  const joined = r.not_found.filter((n) => /[\s,]/.test(n));
  const hint =
    joined.length > 0
      ? ` Several names in one argument? ${joined.map((n) => `"${n}"`).join(", ")} contains a space or comma; pass each technique as its own argument.`
      : "";
  return `# Compatibility: ${r.techniques.join(" + ")}\n\n**Verdict:** UNKNOWN_TECHNIQUE — refused, no verdict. No such technique: ${r.not_found.join(", ")}.${hint} Check the names with c64_techniques_for.\n`;
}

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
 * unknown claim set is never read as "claims nothing". Recipe claims enter
 * only through recipe_zero_page_overlap (info), recipe devices through recipe_device_conflict (info).
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
  return `Unit claims are stated for ${stated} of ${inputs.length} techniques${tail} Recipes' zero-page bytes and required devices are compared as info (recipe_zero_page_overlap, recipe_device_conflict); the interrupt vector a recipe installs is not, since a combined program installs one handler either way.\n\n`;
}

function renderConflicts(r: Output, unknownCount: number): string {
  if (r.conflicts.length === 0) {
    return unknownCount === r.techniques.length
      ? `No conflicts detected, but the graph holds no register, KERNAL or resource data for any of these techniques, so this is silence, not a clearance.\n`
      : `No conflicts detected among what the graph knows about these techniques.\n`;
  }
  let out = "";
  for (const c of r.conflicts) {
    // a = b: one technique's own KERNAL calls against its own (or its prerequisites') zero page.
    const pair = c.a === c.b ? `${c.a}, within its own chain` : `${c.a} × ${c.b}`;
    out += `## ${c.kind} (${c.severity}): ${pair}\n`;
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
  if (r.verdict === "unknown_technique") return renderNotFound(r);
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
