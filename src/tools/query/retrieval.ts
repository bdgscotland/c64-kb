/**
 * Tools that answer from the document vectors: free search, opcode
 * lookup, PAL/NTSC differences and the toolchain hint.
 */

import { z } from "zod";
import { getFalkor, getAnalytics } from "../../context.ts";
import type {
  OpcodeLookupOutput,
  PalNtscDiffOutput,
  SearchOutput,
  ToolchainHintOutput,
} from "../../schemas/tool-outputs.ts";
import { parseRows, renderDocBlocks, searchChunks, toDocChunk } from "./shared.ts";
import type {
  OpcodeLookupResult,
  PalNtscDiffResult,
  PalNtscRegion,
  SearchResult,
  ToolchainHintResult,
} from "./types.ts";

type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNSCORED";

function confidenceLabel(score: number, isVector: boolean): Confidence {
  if (!isVector) return "UNSCORED";
  if (score >= 0.7) return "HIGH";
  if (score >= 0.4) return "MEDIUM";
  return "LOW";
}

function normalizeQuery(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function search(query: string, limit = 5, filterSource?: string): Promise<SearchResult> {
  const normalized = normalizeQuery(query);
  const { chunks: results, isVector } = await searchChunks({ query: normalized, limit, filterSource });

  getAnalytics().logQuery({
    tool: "c64_search",
    query,
    resultCount: results.length,
    searchMode: isVector ? "vector" : "keyword",
    resultScores: results.map((r) => r.score),
    resultSources: results.map((r) => r.source),
  });

  const hits = results.map((r) => ({
    ...toDocChunk(r),
    confidence: confidenceLabel(r.score, isVector),
  }));
  const structured: SearchOutput = { query, hits };

  if (results.length === 0) {
    return { structured, text: `No results for: "${query}". This gap has been logged.` };
  }

  const text = hits
    .map(
      (h) =>
        `## [${h.confidence}] ${h.source} > ${h.section}\n` + `(score: ${h.score.toFixed(3)})\n\n${h.text}`,
    )
    .join("\n\n---\n\n");
  return { structured, text };
}

export async function lookupOpcode(byteOrMnemonic: string): Promise<OpcodeLookupResult> {
  // The opcode docs use `### $XX — MNEMONIC #addressing — description` headings, so
  // we search for the byte form or the mnemonic and rank by score.
  const term = byteOrMnemonic.trim().toUpperCase();
  const { chunks: results } = await searchChunks({
    query: `6510 opcode ${term}`,
    limit: 5,
    keywordText: term,
  });

  // Prefer results from the opcode docs
  const opcodeDocs = results.filter(
    (r) => r.source.includes("6510-cpu") || r.source.includes("illegal-opcodes"),
  );
  const final = opcodeDocs.length > 0 ? opcodeDocs : results;

  getAnalytics().logQuery({ tool: "c64_lookup_opcode", query: byteOrMnemonic, resultCount: final.length });

  const top = final.slice(0, 3);
  const structured: OpcodeLookupOutput = { query: byteOrMnemonic, results: top.map(toDocChunk) };

  if (final.length === 0) {
    return {
      structured,
      text:
        `No opcode information found for "${byteOrMnemonic}".\n\n` +
        `Try \`c64_search\` for fuzzy lookup, or use a mnemonic like "LDA" or a byte like "$A9".`,
    };
  }
  return { structured, text: `# Opcode lookup: ${byteOrMnemonic}\n\n${renderDocBlocks(top, "##")}` };
}

const RegionRow = z.object({ name: z.string(), hz: z.number(), lines: z.number(), cycles: z.number() });

export async function palNtscDiff(topic: string, region: PalNtscRegion = "both"): Promise<PalNtscDiffResult> {
  const f = await getFalkor();
  const regionRows = await f.roQuery(
    `MATCH (r:Region) RETURN r.name AS name, r.refresh_hz AS hz,
            r.lines_per_frame AS lines, r.cycles_per_line AS cycles
     ORDER BY r.name`,
  );

  const queryStr = region === "both" ? `PAL NTSC ${topic}` : `${region.toUpperCase()} ${topic}`;
  const { chunks: ctx } = await searchChunks({ query: queryStr, limit: 5 });

  getAnalytics().logQuery({ tool: "c64_pal_ntsc_diff", query: topic, resultCount: ctx.length });

  const allRegions = parseRows(RegionRow, regionRows).map((row) => ({
    name: row.name,
    refresh_hz: row.hz,
    lines_per_frame: row.lines,
    cycles_per_line: row.cycles,
  }));
  const regions = region === "both" ? allRegions : allRegions.filter((r) => r.name.toLowerCase() === region);

  const top = ctx.slice(0, 3);
  const structured: PalNtscDiffOutput = { topic, regions, documentation: top.map(toDocChunk) };

  let out = `# PAL vs NTSC — ${topic}\n\n`;
  out += `## Regions\n\n| Region | Refresh | Lines | Cycles/line |\n|--------|---------|-------|-------------|\n`;
  for (const r of regions) {
    out += `| ${r.name} | ${r.refresh_hz} Hz | ${r.lines_per_frame} | ${r.cycles_per_line} |\n`;
  }
  if (ctx.length > 0) {
    out += `\n## Topic-specific documentation\n\n${renderDocBlocks(top)}`;
  }
  return { structured, text: out };
}

const OSCAR64_BIAS = "oscar64";

export async function toolchainHint(
  toolchain: string | undefined,
  intent: string,
): Promise<ToolchainHintResult> {
  const tc = toolchain ?? OSCAR64_BIAS;
  const { chunks: ctx } = await searchChunks({ query: `${tc} ${intent}`, limit: 5 });

  getAnalytics().logQuery({ tool: "c64_toolchain_hint", query: `${tc}:${intent}`, resultCount: ctx.length });

  const sources = ctx.slice(0, 3).map(toDocChunk);
  const top = sources.at(0);
  const related = sources.slice(1);

  const rationale =
    toolchain === undefined
      ? `No toolchain specified; defaulting to ${OSCAR64_BIAS} per c64-kb's primary-toolchain policy. Pass toolchain explicitly to override.`
      : `Toolchain ${tc} requested.`;

  const structured: ToolchainHintOutput = {
    toolchain: tc,
    intent,
    snippet: top ? top.text : "(no snippet found — consider adding a recipe or pattern doc)",
    rationale,
    sources,
  };

  let out = `# Toolchain hint: ${tc} — ${intent}\n\n${rationale}\n\n`;
  if (!top) {
    out += `No idiomatic snippet found in the KB. This is a coverage gap — consider adding a recipe under \`docs/recipes/${tc}/\`.\n`;
  } else {
    out += `## Canonical snippet (top match)\n\n${top.text}\n\n`;
    if (related.length > 0) {
      out += `## Related context\n\n`;
      for (const s of related) out += `### ${s.source} > ${s.section}\n${s.text}\n\n---\n\n`;
    }
  }
  return { structured, text: out };
}
