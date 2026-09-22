/**
 * Query tools — real implementations starting in Phase 1.
 *
 * Each query function returns `{ structured, text }`:
 *   - `structured`: a typed JSON payload matching a Zod outputSchema.
 *     The MCP layer attaches this to `structuredContent` so consuming
 *     agents can parse the result without re-tokenizing markdown.
 *   - `text`: a rendered human-readable markdown blob. The CLI prints
 *     this directly; the MCP layer includes it as `content[0].text`
 *     for backward compat.
 *
 * Phase coverage:
 *   - Phase 1: search, lookupRegister, lookupKernal, memoryMap,
 *              lookupOpcode, palNtscDiff
 *   - Phase 2: toolchainHint (Oscar64-bias enforcer), recipeLookup,
 *              recipesFor
 *   - Phase 3: techniqueLookup, techniquesFor, checkCompatibility,
 *              timingBudget
 *   - Phase 5+: pitfalls + briefings (later)
 */

import { getQdrant, getFalkor, getAnalytics } from "../context.js";
import { embed } from "../services/embeddings.js";
import { BM25Encoder, type SparseVector } from "../services/bm25.js";
import { config } from "../config.js";
import fs from "fs";
import path from "path";
import type {
  RegisterLookupOutput,
  KernalLookupOutput,
  MemoryMapOutput,
  OpcodeLookupOutput,
  PalNtscDiffOutput,
  SearchOutput,
  ToolchainHintOutput,
  RecipeLookupOutput,
  RecipesForOutput,
  TechniqueLookupOutput,
  TechniquesForOutput,
  CompatibilityCheckOutput,
  TimingBudgetOutput,
} from "../schemas/tool-outputs.js";

const VOCAB_FILE = path.resolve(config.analytics.dbPath, "../bm25-vocab.json");
let bm25Cache: BM25Encoder | null | undefined; // undefined = not yet attempted

function getBM25(): BM25Encoder | null {
  if (bm25Cache !== undefined) return bm25Cache;
  try {
    if (!fs.existsSync(VOCAB_FILE)) {
      bm25Cache = null;
      return null;
    }
    const data = JSON.parse(fs.readFileSync(VOCAB_FILE, "utf-8"));
    bm25Cache = BM25Encoder.fromJSON(data);
    return bm25Cache;
  } catch {
    bm25Cache = null;
    return null;
  }
}

function encodeSparse(text: string): SparseVector {
  const enc = getBM25();
  return enc ? enc.encode(text) : { indices: [], values: [] };
}

type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNSCORED";

function confidenceLabel(score: number, isVector: boolean): Confidence {
  if (!isVector) return "UNSCORED";
  if (score >= 0.7) return "HIGH";
  if (score >= 0.4) return "MEDIUM";
  return "LOW";
}

function confidenceBadge(score: number, isVector: boolean): string {
  return `[${confidenceLabel(score, isVector)}]`;
}

function normalizeQuery(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function hexToInt(addr: string): number {
  return parseInt(addr.replace(/^\$/, ""), 16);
}

/**
 * Strip the leading "${section}\n\n" prefix from a chunk's stored
 * text so it isn't rendered twice (once in the formatter heading,
 * once at the top of the body). Phase 1.5 prepended the prefix to
 * the stored text so the Qdrant text index catches heading tokens;
 * the display layer strips it back out.
 */
function stripSectionPrefix(section: string, text: string): string {
  const prefix = `${section}\n\n`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function normalizeRw(rw: string | null | undefined): "R" | "W" | "RW" {
  const upper = (rw ?? "").trim().toUpperCase();
  if (upper === "R" || upper === "W" || upper === "RW") return upper;
  // Stored values like "Read-only" / "Write-only" — best-effort coerce.
  if (upper.startsWith("R") && !upper.includes("W")) return "R";
  if (upper.startsWith("W") && !upper.includes("R")) return "W";
  return "RW";
}

export interface SearchResult {
  structured: SearchOutput;
  text: string;
}

export interface RegisterLookupResult {
  structured: RegisterLookupOutput;
  text: string;
}

export interface KernalLookupResult {
  structured: KernalLookupOutput;
  text: string;
}

export interface MemoryMapResult {
  structured: MemoryMapOutput;
  text: string;
}

export interface OpcodeLookupResult {
  structured: OpcodeLookupOutput;
  text: string;
}

export interface PalNtscDiffResult {
  structured: PalNtscDiffOutput;
  text: string;
}

export async function search(
  query: string,
  limit: number = 5,
  filterSource?: string,
  sourceProject?: string
): Promise<SearchResult> {
  const q = await getQdrant();
  const a = getAnalytics();
  const normalized = normalizeQuery(query);
  const vector = await embed(normalized);
  const isVector = vector !== null;

  const results = vector
    ? await q.hybridSearch(vector, encodeSparse(normalized), limit, filterSource)
    : await q.searchByText(normalized, limit, filterSource);

  a.logQuery({
    tool: "c64_search",
    query,
    resultCount: results.length,
    searchMode: isVector ? "vector" : "keyword",
    resultScores: results.map((r) => r.score),
    resultSources: results.map((r) => r.source),
  });

  const hits = results.map((r) => ({
    source: r.source,
    section: r.section,
    text: stripSectionPrefix(r.section, r.text),
    score: r.score,
    confidence: confidenceLabel(r.score, isVector),
  }));

  const structured: SearchOutput = { query, hits };

  if (results.length === 0) {
    return {
      structured,
      text: `No results for: "${query}". This gap has been logged.`,
    };
  }

  const text = results
    .map(
      (r) =>
        `## ${confidenceBadge(r.score, isVector)} ${r.source} > ${r.section}\n` +
        `(score: ${r.score.toFixed(3)})\n\n${stripSectionPrefix(r.section, r.text)}`
    )
    .join("\n\n---\n\n");

  return { structured, text };
}

export async function lookupRegister(
  nameOrAddr: string,
  sourceProject?: string
): Promise<RegisterLookupResult> {
  const f = await getFalkor();
  const q = await getQdrant();
  const a = getAnalytics();

  const cleaned = nameOrAddr.trim().toUpperCase().replace(/^\$/, "");

  // Guard: single-letter mnemonic queries match the entire register table and
  // produce useless noise. Return early with a helpful hint.
  if (cleaned.length === 1 && /^[A-Z]$/.test(cleaned)) {
    return {
      structured: {
        found: false,
        name: "",
        address: "",
        chip: "",
        rw: "RW",
        aliases: [],
        documentation: [],
      },
      text:
        `"${nameOrAddr}" is too short for a register lookup. ` +
        `Provide at least 2 characters for mnemonic lookups; ` +
        `for fuzzy intent use c64_search instead.`,
    };
  }

  // Decimal address: e.g. 53265 → D011, 54272 → D400.
  // All C64 I/O registers live in the $D000–$DFFF range (53248–57343).
  const decimalMatch = cleaned.match(/^(\d{4,5})$/);
  if (decimalMatch) {
    const decimal = parseInt(decimalMatch[1], 10);
    if (decimal >= 0xd000 && decimal <= 0xdfff) {
      const asHex = decimal.toString(16).toUpperCase().padStart(4, "0");
      return lookupRegister(asHex, sourceProject);
    }
  }

  // Match by canonical name, hex address, or any alias.
  const result = await f.roQuery(
    `MATCH (r:Register)
     WHERE r.name = $cleaned
        OR r.address = $addr
        OR $cleaned IN r.aliases
     OPTIONAL MATCH (r)-[:BELONGS_TO]->(c:Chip)
     RETURN r.name AS name,
            r.address AS addr,
            r.rw AS rw,
            r.aliases AS aliases,
            c.name AS chip
     LIMIT 1`,
    { cleaned, addr: `$${cleaned}` }
  );

  const rows = result.data ?? [];

  a.logQuery({
    tool: "c64_lookup_register",
    query: nameOrAddr,
    resultCount: rows.length,
  });

  if (rows.length === 0) {
    // Helpful "not found" — suggest near-matches over the Register label.
    const partial = cleaned.slice(0, 3);
    const suggestions = partial
      ? await f.roQuery(
          `MATCH (r:Register)
           WHERE r.name CONTAINS $partial
              OR r.address CONTAINS $partial
           RETURN r.name AS name LIMIT 5`,
          { partial }
        )
      : { data: [] };
    const names = (suggestions.data ?? [])
      .map((r) => (r as { name: string }).name)
      .filter(Boolean);

    return {
      structured: {
        found: false,
        name: "",
        address: "",
        chip: "",
        rw: "RW",
        aliases: [],
        documentation: [],
      },
      text:
        `No register found matching "${nameOrAddr}".\n\n` +
        `Did you mean: ${names.length > 0 ? names.join(", ") : "(no near-matches)"}.\n\n` +
        `Try \`c64_search\` with "${nameOrAddr}" for fuzzy lookup.`,
    };
  }

  const reg = rows[0] as {
    name: string;
    addr: string;
    rw: string;
    aliases: string[] | null;
    chip: string | null;
  };
  const aliases = reg.aliases ?? [];

  // Pull richer context from Qdrant. Include all alias forms so both
  // dense and sparse vectors have multiple shots at the right chunk.
  const queryStr = [reg.name, reg.addr, ...aliases].filter(Boolean).join(" ");
  const vec = await embed(queryStr);
  const ctx = vec
    ? await q.hybridSearch(vec, encodeSparse(queryStr), 3)
    : await q.searchByText(queryStr, 3);

  const documentation = ctx.map((c) => ({
    source: c.source,
    section: c.section,
    text: stripSectionPrefix(c.section, c.text),
    score: c.score,
  }));

  const structured: RegisterLookupOutput = {
    found: true,
    name: reg.name,
    address: reg.addr,
    chip: reg.chip ?? "unknown",
    rw: normalizeRw(reg.rw),
    aliases,
    documentation,
  };

  let out = `# ${reg.name} — ${reg.addr}\n\n`;
  out += `**Chip:** ${reg.chip ?? "unknown"}\n`;
  out += `**Access:** ${reg.rw}\n`;
  if (aliases.length > 0) {
    out += `**Aliases:** ${aliases.join(", ")}\n`;
  }
  out += `\n`;

  if (ctx.length > 0) {
    out += `## Documentation\n\n`;
    for (const c of ctx) {
      out += `### ${c.source} > ${c.section}\n${stripSectionPrefix(c.section, c.text)}\n\n---\n\n`;
    }
  } else {
    out += `(No additional documentation found.)\n`;
  }

  return { structured, text: out };
}

export async function lookupKernal(
  nameOrAddr: string,
  sourceProject?: string
): Promise<KernalLookupResult> {
  const f = await getFalkor();
  const q = await getQdrant();
  const a = getAnalytics();

  const cleaned = nameOrAddr.trim().toUpperCase().replace(/^\$/, "");
  const byName = await f.roQuery(
    `MATCH (k:KernalRoutine {name: $name})
     OPTIONAL MATCH (k)-[:PAIRS_WITH]->(p:KernalRoutine)
     RETURN k.name AS name, k.address AS addr, k.description AS desc, collect(DISTINCT p.name) AS pairs`,
    { name: cleaned }
  );
  const byAddr = await f.roQuery(
    `MATCH (k:KernalRoutine {address: $addr})
     OPTIONAL MATCH (k)-[:PAIRS_WITH]->(p:KernalRoutine)
     RETURN k.name AS name, k.address AS addr, k.description AS desc, collect(DISTINCT p.name) AS pairs`,
    { addr: `$${cleaned}` }
  );

  const rows = [...(byName.data ?? []), ...(byAddr.data ?? [])];

  a.logQuery({
    tool: "c64_lookup_kernal",
    query: nameOrAddr,
    resultCount: rows.length,
  });

  if (rows.length === 0) {
    // Helpful "not found" — suggest near-matches over KernalRoutine.
    const partial = cleaned.slice(0, 3);
    const suggestions = partial
      ? await f.roQuery(
          `MATCH (k:KernalRoutine)
           WHERE k.name CONTAINS $partial
              OR k.address CONTAINS $partial
           RETURN k.name AS name LIMIT 5`,
          { partial }
        )
      : { data: [] };
    const names = (suggestions.data ?? [])
      .map((r) => (r as { name: string }).name)
      .filter(Boolean);

    return {
      structured: {
        name: "",
        address: "",
        description: "",
        pairs_with: [],
        documentation: [],
      },
      text:
        `No KERNAL routine found matching "${nameOrAddr}".\n\n` +
        `Did you mean: ${names.length > 0 ? names.join(", ") : "(no near-matches)"}.\n\n` +
        `Try \`c64_search\` with "${nameOrAddr}" for fuzzy lookup.`,
    };
  }

  const row = rows[0] as { name: string; addr: string; desc: string; pairs: string[] };
  const queryStr = `KERNAL ${row.name} ${row.addr}`;
  const vec = await embed(queryStr);
  const ctx = vec
    ? await q.hybridSearch(vec, encodeSparse(queryStr), 3)
    : await q.searchByText(`${row.name} ${row.addr}`, 3);

  const documentation = ctx.map((c) => ({
    source: c.source,
    section: c.section,
    text: stripSectionPrefix(c.section, c.text),
    score: c.score,
  }));

  const structured: KernalLookupOutput = {
    name: row.name,
    address: row.addr,
    description: row.desc ?? "",
    pairs_with: row.pairs ?? [],
    documentation,
  };

  let out = `# ${row.name} — ${row.addr}\n\n${row.desc}\n\n`;
  if (row.pairs.length > 0) {
    out += `**Pairs with:** ${row.pairs.join(", ")}\n\n`;
  }
  if (ctx.length > 0) {
    out += `## Documentation\n\n`;
    for (const c of ctx) {
      out += `### ${c.source} > ${c.section}\n${stripSectionPrefix(c.section, c.text)}\n\n---\n\n`;
    }
  }
  return { structured, text: out };
}

export async function memoryMap(
  addr: string,
  sourceProject?: string
): Promise<MemoryMapResult> {
  const f = await getFalkor();
  const a = getAnalytics();

  const cleaned = addr.trim().toUpperCase().replace(/^\$/, "").replace(/[^0-9A-F]/g, "");
  if (!cleaned) {
    return {
      structured: { address: addr, regions: [] },
      text: `Invalid address: "${addr}". Use a hex address like $D011 or 0400.`,
    };
  }
  const numeric = parseInt(cleaned, 16);
  const canonicalAddr = `$${cleaned}`;

  // Find regions whose [start, end] contains this address.
  const rows = await f.roQuery(
    `MATCH (m:MemoryRegion)
     RETURN m.name AS name, m.start AS start, m.end AS end, m.default_use AS use, m.bank_switchable AS bank`
  );

  const matches = (rows.data ?? []).filter((r) => {
    const row = r as { start: string; end: string };
    return numeric >= hexToInt(row.start) && numeric <= hexToInt(row.end);
  });

  a.logQuery({
    tool: "c64_memory_map",
    query: addr,
    resultCount: matches.length,
  });

  const regions = matches.map((r) => {
    const row = r as { name: string; start: string; end: string; use: string; bank: boolean };
    return {
      name: row.name,
      start: row.start,
      end: row.end,
      default_use: row.use ?? "",
      bank_switchable: Boolean(row.bank),
    };
  });

  const structured: MemoryMapOutput = { address: canonicalAddr, regions };

  if (matches.length === 0) {
    return {
      structured,
      text: `No memory region found containing ${canonicalAddr}. The address may be outside any documented region.`,
    };
  }

  let out = `# ${canonicalAddr} memory map\n\n`;
  for (const region of regions) {
    out += `## ${region.name} (${region.start}-${region.end})\n`;
    out += `**Default use:** ${region.default_use || "(not documented)"}\n`;
    out += `**Bank-switchable:** ${region.bank_switchable ? "Yes" : "No"}\n\n`;
  }
  return { structured, text: out };
}

export async function lookupOpcode(
  byteOrMnemonic: string,
  sourceProject?: string
): Promise<OpcodeLookupResult> {
  const q = await getQdrant();
  const a = getAnalytics();

  // The opcode docs use `### $XX — MNEMONIC #addressing — description` headings, so
  // we search for the byte form or the mnemonic and rank by score.
  const term = byteOrMnemonic.trim().toUpperCase();
  const queryStr = `6510 opcode ${term}`;
  const vec = await embed(queryStr);
  const results = vec
    ? await q.hybridSearch(vec, encodeSparse(queryStr), 5)
    : await q.searchByText(term, 5);

  // Prefer results from the opcode docs
  const opcodeDocs = results.filter((r) => r.source.includes("6510-cpu") || r.source.includes("illegal-opcodes"));
  const final = opcodeDocs.length > 0 ? opcodeDocs : results;

  a.logQuery({
    tool: "c64_lookup_opcode",
    query: byteOrMnemonic,
    resultCount: final.length,
  });

  const docs = final.slice(0, 3).map((r) => ({
    source: r.source,
    section: r.section,
    text: stripSectionPrefix(r.section, r.text),
    score: r.score,
  }));

  const structured: OpcodeLookupOutput = { query: byteOrMnemonic, results: docs };

  if (final.length === 0) {
    return {
      structured,
      text:
        `No opcode information found for "${byteOrMnemonic}".\n\n` +
        `Try \`c64_search\` for fuzzy lookup, or use a mnemonic like "LDA" or a byte like "$A9".`,
    };
  }

  let out = `# Opcode lookup: ${byteOrMnemonic}\n\n`;
  for (const r of final.slice(0, 3)) {
    out += `## ${r.source} > ${r.section}\n${stripSectionPrefix(r.section, r.text)}\n\n---\n\n`;
  }
  return { structured, text: out };
}

export type PalNtscRegion = "pal" | "ntsc" | "both";

export async function palNtscDiff(
  topic: string,
  region: PalNtscRegion = "both"
): Promise<PalNtscDiffResult> {
  const f = await getFalkor();
  const q = await getQdrant();
  const a = getAnalytics();

  const regionRows = await f.roQuery(
    `MATCH (r:Region) RETURN r.name AS name, r.refresh_hz AS hz,
            r.lines_per_frame AS lines, r.cycles_per_line AS cycles
     ORDER BY r.name`
  );

  const queryStr = region === "both" ? `PAL NTSC ${topic}` : `${region.toUpperCase()} ${topic}`;
  const vec = await embed(queryStr);
  const ctx = vec
    ? await q.hybridSearch(vec, encodeSparse(queryStr), 5)
    : await q.searchByText(queryStr, 5);

  a.logQuery({
    tool: "c64_pal_ntsc_diff",
    query: topic,
    resultCount: ctx.length,
  });

  const allRegions = (regionRows.data ?? []).map((r) => {
    const row = r as { name: string; hz: number; lines: number; cycles: number };
    return {
      name: row.name,
      refresh_hz: row.hz,
      lines_per_frame: row.lines,
      cycles_per_line: row.cycles,
    };
  });
  const regions =
    region === "both"
      ? allRegions
      : allRegions.filter((r) => r.name.toLowerCase() === region);

  const documentation = ctx.slice(0, 3).map((c) => ({
    source: c.source,
    section: c.section,
    text: stripSectionPrefix(c.section, c.text),
    score: c.score,
  }));

  const structured: PalNtscDiffOutput = { topic, regions, documentation };

  let out = `# PAL vs NTSC — ${topic}\n\n`;
  out += `## Regions\n\n| Region | Refresh | Lines | Cycles/line |\n|--------|---------|-------|-------------|\n`;
  for (const region of regions) {
    out += `| ${region.name} | ${region.refresh_hz} Hz | ${region.lines_per_frame} | ${region.cycles_per_line} |\n`;
  }

  if (ctx.length > 0) {
    out += `\n## Topic-specific documentation\n\n`;
    for (const c of ctx.slice(0, 3)) {
      out += `### ${c.source} > ${c.section}\n${stripSectionPrefix(c.section, c.text)}\n\n---\n\n`;
    }
  }

  return { structured, text: out };
}

const OSCAR64_BIAS = "oscar64";

export type TechniqueLookupResult = { structured: TechniqueLookupOutput; text: string };
export type TechniquesForResult = { structured: TechniquesForOutput; text: string };
export type CompatibilityCheckResult = { structured: CompatibilityCheckOutput; text: string };
export type TimingBudgetResult = { structured: TimingBudgetOutput; text: string };

export type ToolchainHintResult = { structured: ToolchainHintOutput; text: string };
export type RecipeLookupResult = { structured: RecipeLookupOutput; text: string };
export type RecipesForResult = { structured: RecipesForOutput; text: string };

export async function toolchainHint(
  toolchain: string | undefined,
  intent: string
): Promise<ToolchainHintResult> {
  const f = await getFalkor();
  const q = await getQdrant();
  const a = getAnalytics();

  // f is referenced for future graph queries (tool node lookups in Phase 3+).
  void f;

  const tc = toolchain ?? OSCAR64_BIAS;

  const queryStr = `${tc} ${intent}`;
  const vec = await embed(queryStr);
  const ctx = vec
    ? await q.hybridSearch(vec, encodeSparse(queryStr), 5)
    : await q.searchByText(queryStr, 5);

  a.logQuery({
    tool: "c64_toolchain_hint",
    query: `${tc}:${intent}`,
    resultCount: ctx.length,
  });

  const sources = ctx.slice(0, 3).map((c) => ({
    source: c.source,
    section: c.section,
    text: stripSectionPrefix(c.section, c.text),
    score: c.score,
  }));

  const rationale =
    toolchain === undefined
      ? `No toolchain specified; defaulting to ${OSCAR64_BIAS} per c64-kb's primary-toolchain policy. Pass toolchain explicitly to override.`
      : `Toolchain ${tc} requested.`;

  const snippet = sources.length > 0 ? sources[0].text : "(no snippet found — consider adding a recipe or pattern doc)";

  const structured: ToolchainHintOutput = {
    toolchain: tc,
    intent,
    snippet,
    rationale,
    sources,
  };

  let out = `# Toolchain hint: ${tc} — ${intent}\n\n`;
  out += `${rationale}\n\n`;
  if (sources.length === 0) {
    out += `No idiomatic snippet found in the KB. This is a coverage gap — consider adding a recipe under \`docs/recipes/${tc}/\`.\n`;
  } else {
    out += `## Canonical snippet (top match)\n\n${sources[0].text}\n\n`;
    if (sources.length > 1) {
      out += `## Related context\n\n`;
      for (const s of sources.slice(1)) {
        out += `### ${s.source} > ${s.section}\n${s.text}\n\n---\n\n`;
      }
    }
  }

  return { structured, text: out };
}

export async function recipeLookup(name: string): Promise<RecipeLookupResult> {
  const f = await getFalkor();
  const q = await getQdrant();
  const a = getAnalytics();

  const recipeRows = await f.roQuery(
    `MATCH (r:Recipe {name: $name})
     RETURN r.toolchain AS toolchain, r.output_format AS output_format,
            r.region AS region, r.source_doc AS source_doc`,
    { name }
  );

  if ((recipeRows.data?.length ?? 0) === 0) {
    // Suggest near matches
    const all = await f.roQuery(`MATCH (r:Recipe) RETURN r.name AS name ORDER BY r.name`);
    const names = (all.data ?? []).map((row) => (row as { name: string }).name);
    const suggestions = name.length < 3
      ? []
      : names
          .filter((n) => {
            const lname = name.toLowerCase();
            if (n.includes(lname)) return true;
            const stem = n.split("-").slice(1).join("-");
            return stem !== "" && lname.includes(stem);
          })
          .slice(0, 5);

    a.logQuery({ tool: "c64_recipe_lookup", query: name, resultCount: 0 });

    const empty: RecipeLookupOutput = {
      name: "",
      toolchain: "",
      output_format: "",
      region: "",
      source_doc: "",
      documentation: [],
    };
    const text = `Recipe \`${name}\` not found.${
      suggestions.length > 0 ? `\n\nDid you mean: ${suggestions.join(", ")}?` : ""
    }\n\nList all recipes with \`c64-kb recipes-for\` (no filter).`;
    return { structured: empty, text };
  }

  const row = recipeRows.data?.[0] as { toolchain: string; output_format: string; region: string; source_doc: string };
  const { toolchain, output_format, region, source_doc } = row;

  // Pull doc context
  const vec = await embed(name);
  const ctx = vec
    ? await q.hybridSearch(vec, encodeSparse(name), 5)
    : await q.searchByText(name, 5);
  const documentation = ctx
    .filter((c) => c.source === source_doc)
    .slice(0, 5)
    .map((c) => ({
      source: c.source,
      section: c.section,
      text: stripSectionPrefix(c.section, c.text),
      score: c.score,
    }));

  a.logQuery({ tool: "c64_recipe_lookup", query: name, resultCount: 1 });

  const structured: RecipeLookupOutput = {
    name,
    toolchain,
    output_format,
    region,
    source_doc,
    documentation,
  };

  let out = `# Recipe: ${name}\n\n`;
  out += `**Toolchain:** ${toolchain}\n`;
  out += `**Output:** ${output_format}\n`;
  out += `**Region:** ${region}\n`;
  out += `**Source:** \`${source_doc}\`\n\n`;
  for (const d of documentation) {
    out += `## ${d.section}\n${d.text}\n\n---\n\n`;
  }
  return { structured, text: out };
}

export async function recipesFor(filter: {
  toolchain?: string;
  region?: string;
  technique?: string;
  file_format?: string;
}): Promise<RecipesForResult> {
  const f = await getFalkor();
  const a = getAnalytics();

  const where: string[] = [];
  const params: Record<string, string> = {};
  if (filter.toolchain) {
    where.push("r.toolchain = $toolchain");
    params.toolchain = filter.toolchain;
  }
  if (filter.region) {
    where.push("(r.region = $region OR r.region = 'both')");
    params.region = filter.region;
  }
  let cypher = `MATCH (r:Recipe)`;
  if (filter.technique) {
    cypher += ` -[:IMPLEMENTS]-> (t:Technique {name: $technique})`;
    params.technique = filter.technique;
  }
  if (filter.file_format) {
    cypher += ` , (r)-[:PRODUCES]->(f:FileFormat {name: $file_format})`;
    params.file_format = filter.file_format;
  }
  if (where.length > 0) cypher += ` WHERE ${where.join(" AND ")}`;
  cypher += ` RETURN r.name AS name, r.toolchain AS toolchain, r.output_format AS output_format, r.region AS region, r.source_doc AS source_doc ORDER BY r.name`;

  const rows = await f.roQuery(cypher, params);
  const recipes = (rows.data ?? []).map((row) => {
    const r = row as { name: string; toolchain: string; output_format: string; region: string; source_doc: string };
    return {
      name: r.name,
      toolchain: r.toolchain,
      output_format: r.output_format,
      region: r.region,
      source_doc: r.source_doc,
    };
  });

  a.logQuery({
    tool: "c64_recipes_for",
    query: JSON.stringify(filter),
    resultCount: recipes.length,
  });

  const structured: RecipesForOutput = { filter, recipes };

  let out = `# Recipes`;
  const flt = Object.entries(filter)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  if (flt) out += ` (filter: ${flt})`;
  out += `\n\n`;
  if (recipes.length === 0) {
    out += `No recipes match. Try a broader filter or no filter at all.`;
  } else {
    out += `| Recipe | Toolchain | Output | Region |\n|--------|-----------|--------|--------|\n`;
    for (const r of recipes) {
      out += `| ${r.name} | ${r.toolchain} | ${r.output_format} | ${r.region} |\n`;
    }
  }
  return { structured, text: out };
}

export async function techniqueLookup(name: string): Promise<TechniqueLookupResult> {
  const f = await getFalkor();
  const q = await getQdrant();
  const a = getAnalytics();

  const result = await f.roQuery(
    `MATCH (t:Technique {name: $name})
     OPTIONAL MATCH (t)-[:BELONGS_TO]->(c:Chip)
     OPTIONAL MATCH (t)-[:REQUIRES_REGION]->(rr:Region)
     RETURN t.name AS name, t.title AS title, t.category AS category,
            t.complexity AS complexity, c.name AS chip, toLower(rr.name) AS requires_region
     LIMIT 1`,
    { name }
  );

  if ((result.data?.length ?? 0) === 0) {
    // Suggestion logic: mirror recipeLookup but for underscore-separated names
    const all = await f.roQuery(`MATCH (t:Technique) RETURN t.name AS name ORDER BY t.name`);
    const names = (all.data ?? []).map((row) => (row as { name: string }).name);
    const suggestions = name.length < 3
      ? []
      : names
          .filter((n) => {
            const lname = name.toLowerCase();
            if (n.includes(lname)) return true;
            const stem = n.split("_").slice(1).join("_");
            return stem !== "" && lname.includes(stem);
          })
          .slice(0, 5);

    a.logQuery({ tool: "c64_technique_lookup", query: name, resultCount: 0 });

    const empty: TechniqueLookupOutput = {
      name: "",
      title: "",
      category: "",
      complexity: "",
      uses_registers: [],
      uses_kernal: [],
      recipes: [],
      requires: [],
      required_by: [],
      mitigates: [],
      documentation: [],
    };
    const text =
      `Technique \`${name}\` not found.` +
      (suggestions.length > 0 ? `\n\nDid you mean: ${suggestions.join(", ")}?` : "") +
      `\n\nList all techniques with \`c64-kb techniques-for\` (no filter).`;
    return { structured: empty, text };
  }

  const row = result.data![0] as {
    name: string;
    title: string;
    category: string;
    complexity: string;
    chip: string | null;
    requires_region: string | null;
  };

  // USES → Registers
  const regRows = await f.roQuery(
    `MATCH (t:Technique {name: $name})-[:USES]->(r:Register)
     RETURN r.name AS name, r.address AS address`,
    { name }
  );
  const uses_registers = (regRows.data ?? []).map((r) => {
    const rr = r as { name: string; address: string };
    return { name: rr.name, address: rr.address ?? "" };
  });

  // USES → KernalRoutines
  const kernalRows = await f.roQuery(
    `MATCH (t:Technique {name: $name})-[:USES]->(k:KernalRoutine)
     RETURN k.name AS name, k.address AS address`,
    { name }
  );
  const uses_kernal = (kernalRows.data ?? []).map((r) => {
    const kr = r as { name: string; address: string };
    return { name: kr.name, address: kr.address ?? "" };
  });

  // Recipes that IMPLEMENT this Technique (reverse direction)
  const recipeRows = await f.roQuery(
    `MATCH (t:Technique {name: $name})<-[:IMPLEMENTS]-(r:Recipe)
     RETURN r.name AS name, r.toolchain AS toolchain`,
    { name }
  );
  const recipes = (recipeRows.data ?? []).map((r) => {
    const rr = r as { name: string; toolchain: string };
    return { name: rr.name, toolchain: rr.toolchain };
  });

  // REQUIRES → techniques that must be set up before, or run underneath, this one
  const toRef = (r: unknown) => {
    const rr = r as { name: string; title: string };
    return { name: rr.name, title: rr.title ?? "" };
  };
  const requiresRows = await f.roQuery(
    `MATCH (t:Technique {name: $name})-[:REQUIRES]->(p:Technique)
     RETURN p.name AS name, p.title AS title ORDER BY p.name`,
    { name }
  );
  const requires = (requiresRows.data ?? []).map(toRef);

  // REQUIRES (reverse) → techniques that presuppose this one
  const requiredByRows = await f.roQuery(
    `MATCH (t:Technique {name: $name})<-[:REQUIRES]-(d:Technique)
     RETURN d.name AS name, d.title AS title ORDER BY d.name`,
    { name }
  );
  const required_by = (requiredByRows.data ?? []).map(toRef);

  // MITIGATED_BY (reverse) → pitfalls whose Fix is this technique
  const mitigatesRows = await f.roQuery(
    `MATCH (t:Technique {name: $name})<-[:MITIGATED_BY]-(p:Pitfall)
     RETURN p.name AS name, p.title AS title, p.severity AS severity ORDER BY p.name`,
    { name }
  );
  const mitigates = (mitigatesRows.data ?? []).map((r) => {
    const pr = r as { name: string; title: string; severity: string };
    return { name: pr.name, title: pr.title ?? "", severity: pr.severity ?? "" };
  });

  // Documentation chunks from Qdrant
  const queryStr = `${name} ${row.title ?? ""}`.trim();
  const vec = await embed(queryStr);
  const ctx = vec
    ? await q.hybridSearch(vec, encodeSparse(queryStr), 3)
    : await q.searchByText(queryStr, 3);
  const documentation = ctx.map((c) => ({
    source: c.source,
    section: c.section,
    text: stripSectionPrefix(c.section, c.text),
    score: c.score,
  }));

  a.logQuery({ tool: "c64_technique_lookup", query: name, resultCount: 1 });

  const structured: TechniqueLookupOutput = {
    name: row.name,
    title: row.title ?? "",
    category: row.category ?? "",
    complexity: row.complexity ?? "",
    chip: row.chip ?? undefined,
    requires_region: row.requires_region ?? undefined,
    uses_registers,
    uses_kernal,
    recipes,
    requires,
    required_by,
    mitigates,
    documentation,
  };

  let out = `# Technique: ${row.name} — ${row.title}\n\n`;
  out += `**Category:** ${row.category}\n`;
  out += `**Complexity:** ${row.complexity || "(not set)"}\n`;
  if (row.chip) out += `**Chip:** ${row.chip}\n`;
  if (row.requires_region) out += `**Requires region:** ${row.requires_region}\n`;
  out += `\n`;
  if (uses_registers.length > 0) {
    out += `**Uses registers:** ${uses_registers.map((r) => r.name).join(", ")}\n`;
  }
  if (uses_kernal.length > 0) {
    out += `**Uses KERNAL:** ${uses_kernal.map((k) => k.name).join(", ")}\n`;
  }
  if (requires.length > 0) {
    out += `**Requires:** ${requires.map((r) => r.name).join(", ")}\n`;
  }
  if (required_by.length > 0) {
    out += `**Required by:** ${required_by.map((r) => r.name).join(", ")}\n`;
  }
  if (mitigates.length > 0) {
    out += `**Mitigates:** ${mitigates.map((m) => `${m.name} (${m.severity})`).join(", ")}\n`;
  }
  if (recipes.length > 0) {
    out += `\n## Recipes\n\n`;
    for (const r of recipes) {
      out += `- \`${r.name}\` (${r.toolchain})\n`;
    }
  }
  if (documentation.length > 0) {
    out += `\n## Documentation\n\n`;
    for (const d of documentation) {
      out += `### ${d.source} > ${d.section}\n${d.text}\n\n---\n\n`;
    }
  }

  return { structured, text: out };
}

export async function techniquesFor(filter: {
  category?: string;
  chip?: string;
  region?: string;
  register?: string;
  recipe?: string;
  requires?: string;
}): Promise<TechniquesForResult> {
  const f = await getFalkor();
  const a = getAnalytics();

  const where: string[] = [];
  const params: Record<string, string> = {};
  let cypher = `MATCH (t:Technique)`;

  if (filter.chip) {
    cypher += ` -[:BELONGS_TO]-> (ch:Chip {name: $chip})`;
    params.chip = filter.chip;
  }
  if (filter.requires) {
    // "What builds on X": techniques whose REQUIRES chain reaches X, directly
    // or through other techniques (ifli_image -> fli_image -> stable_raster_irq),
    // up to twelve edges deep (the longest authored chain is two). Variants
    // are not unified: double_irq has no edge to stable_raster_irq.
    cypher += ` , (t)-[:REQUIRES*1..12]->(req:Technique {name: $requires})`;
    params.requires = filter.requires;
  }
  if (filter.region) {
    cypher += ` , (t)-[:REQUIRES_REGION]->(reg:Region {name: $region})`;
    params.region = filter.region;
  }
  if (filter.register) {
    cypher += ` , (t)-[:USES]->(rg:Register {name: $register})`;
    params.register = filter.register;
  }
  if (filter.recipe) {
    cypher += ` , (rec:Recipe {name: $recipe})-[:IMPLEMENTS]->(t)`;
    params.recipe = filter.recipe;
  }
  if (filter.category) {
    where.push(`t.category = $category`);
    params.category = filter.category;
  }
  if (where.length > 0) cypher += ` WHERE ${where.join(" AND ")}`;
  cypher += ` RETURN DISTINCT t.name AS name, t.title AS title, t.category AS category, t.complexity AS complexity ORDER BY t.category, t.name`;

  const rows = await f.roQuery(cypher, params);
  const techniques = (rows.data ?? []).map((row) => {
    const r = row as { name: string; title: string; category: string; complexity: string };
    return {
      name: r.name,
      title: r.title ?? "",
      category: r.category ?? "",
      complexity: r.complexity ?? "",
    };
  });

  a.logQuery({ tool: "c64_techniques_for", query: JSON.stringify(filter), resultCount: techniques.length });

  const structured: TechniquesForOutput = { filter, techniques };

  let out = `# Techniques`;
  const flt = Object.entries(filter)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  if (flt) out += ` (filter: ${flt})`;
  out += `\n\n`;
  if (techniques.length === 0) {
    out += `No techniques match. Try a broader filter or no filter at all.`;
  } else {
    out += `| Name | Title | Category | Complexity |\n|------|-------|----------|------------|\n`;
    for (const t of techniques) {
      out += `| ${t.name} | ${t.title} | ${t.category} | ${t.complexity} |\n`;
    }
  }
  return { structured, text: out };
}

export async function checkCompatibility(techniques: string[]): Promise<CompatibilityCheckResult> {
  const f = await getFalkor();
  const a = getAnalytics();

  // --- REQUIRES closure --------------------------------------------------
  // A technique's prerequisites (**Requires:** in CONVENTIONS-techniques.md)
  // take part in the check without being named: text_zoom presupposes
  // stable_raster_irq, so the stable IRQ's demands are in play whenever
  // text_zoom is. impliedBy maps each technique reached through REQUIRES to
  // the input techniques whose chain reaches it; chainOf keeps one such chain
  // per (input, member) for the rationale text. The walk is a plain BFS over
  // direct edges — ingest refuses cycles, and the visited set guards anyway.
  const inputSet = new Set(techniques);
  const impliedBy = new Map<string, Set<string>>();
  const chainOf = new Map<string, string[]>();
  const requiresCache = new Map<string, string[]>();
  const requiresOf = async (name: string): Promise<string[]> => {
    let r = requiresCache.get(name);
    if (r === undefined) {
      const rows = await f.roQuery(
        `MATCH (t:Technique {name: $name})-[:REQUIRES]->(p:Technique)
         RETURN p.name AS name ORDER BY p.name`,
        { name }
      );
      r = (rows.data ?? []).map((row) => (row as { name: string }).name).filter(Boolean);
      requiresCache.set(name, r);
    }
    return r;
  };
  for (const input of techniques) {
    const visited = new Set<string>([input]);
    const queue: Array<{ name: string; chain: string[] }> = [{ name: input, chain: [input] }];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const p of await requiresOf(cur.name)) {
        if (visited.has(p)) continue;
        visited.add(p);
        const chain = [...cur.chain, p];
        if (!impliedBy.has(p)) impliedBy.set(p, new Set());
        impliedBy.get(p)!.add(input);
        chainOf.set(`${input}|${p}`, chain);
        queue.push({ name: p, chain });
      }
    }
  }
  // Techniques that entered the check only through a REQUIRES chain.
  const closureOnly = [...impliedBy.keys()].filter((n) => !inputSet.has(n)).sort();
  const allNames = [...techniques, ...closureOnly];
  // closure(x): everything x's REQUIRES chain reaches, inputs included.
  const closureOf = (x: string): string[] => allNames.filter((n) => n !== x && (impliedBy.get(n)?.has(x) ?? false));
  const describeChain = (input: string, member: string): string => {
    const chain = chainOf.get(`${input}|${member}`) ?? [input, member];
    const middle = chain.slice(1, -1);
    return `${input} requires ${member}${middle.length > 0 ? ` (via ${middle.join(" → ")})` : ""}`;
  };

  // Resolve each technique to its region requirement
  const regionMap = new Map<string, string | null>();
  for (const tname of allNames) {
    const rr = await f.roQuery(
      `MATCH (t:Technique {name: $name})
       OPTIONAL MATCH (t)-[:REQUIRES_REGION]->(reg:Region)
       RETURN toLower(reg.name) AS region`,
      { name: tname }
    );
    const region = (rr.data?.[0] as { region: string | null } | undefined)?.region ?? null;
    regionMap.set(tname, region);
  }

  const conflicts: CompatibilityCheckOutput["conflicts"] = [];

  // What the graph holds for each technique: demands, register and KERNAL
  // counts. Drives the hard-conflict rules below and the data_coverage
  // report, so a technique the graph knows nothing about is named as such
  // instead of passing as compatible.
  type Facts = { found: boolean; demands: Set<string>; registers: number; kernal: string[] };
  const facts = new Map<string, Facts>();
  for (const tname of allNames) {
    const rr = await f.roQuery(
      `MATCH (t:Technique {name: $name})
       OPTIONAL MATCH (t)-[:DEMANDS]->(res:Resource)
       WITH t, collect(DISTINCT res.name) AS demands
       OPTIONAL MATCH (t)-[:USES]->(reg:Register)
       WITH t, demands, count(DISTINCT reg) AS registers
       OPTIONAL MATCH (t)-[:USES]->(k:KernalRoutine)
       RETURN demands, registers, collect(DISTINCT k.name) AS kernal`,
      { name: tname }
    );
    const row = rr.data?.[0] as { demands: string[]; registers: number; kernal: string[] } | undefined;
    facts.set(tname, {
      found: row !== undefined,
      demands: new Set((row?.demands ?? []).filter(Boolean)),
      registers: Number(row?.registers ?? 0),
      kernal: (row?.kernal ?? []).filter(Boolean),
    });
  }

  // Hard rules over DEMANDS and region, evaluated for one pair of technique
  // names. Each rule is symmetric; `has` tests one side. Returned rather than
  // pushed so the same rules serve the input pairs and the REQUIRES closure.
  type ConflictKind = CompatibilityCheckOutput["conflicts"][number]["kind"];
  type HardHit = { kind: ConflictKind; shared: string[]; rationale: string; resolution: string };
  const hardRules = (a_name: string, b_name: string): HardHit[] => {
    const hits: HardHit[] = [];
    const A = facts.get(a_name)!;
    const B = facts.get(b_name)!;
    const hard = (kind: ConflictKind, shared: string[], rationale: string, resolution: string) =>
      hits.push({ kind, shared, rationale, resolution });

    // Region mismatch
    const aRegion = regionMap.get(a_name);
    const bRegion = regionMap.get(b_name);
    if (aRegion && bRegion && aRegion !== bRegion) {
      hard("region_mismatch", [aRegion, bRegion],
        `${a_name} requires ${aRegion} but ${b_name} requires ${bRegion}.`,
        `Detect the machine at start and ship both variants, or drop one.`);
    }

    // Both need every CPU cycle on their lines.
    if (A.demands.has("cpu_every_line") && B.demands.has("cpu_every_line")) {
      hard("cpu_exclusive", ["cpu_every_line"],
        `Both need every CPU cycle on every raster line they cover; they cannot share a raster line.`,
        `Give each its own band of lines and switch between them in the border.`);
    }

    // One needs every CPU cycle; the other interrupts mid-frame.
    for (const [X, Y, xn, yn] of [[A, B, a_name, b_name], [B, A, b_name, a_name]] as const) {
      if (!X.demands.has("cpu_every_line")) continue;
      if (Y.demands.has("midframe_raster_irqs")) {
        hard("cpu_vs_irq", ["cpu_every_line", "midframe_raster_irqs"],
          `${xn} needs every CPU cycle on its lines; a raster interrupt from ${yn} inside that region breaks its cycle count.`,
          `Keep ${yn}'s interrupts on lines outside ${xn}'s region (the borders, or a separate band).`);
      }
      if (Y.demands.has("continuous_interrupts")) {
        hard("cpu_vs_irq", ["cpu_every_line", "continuous_interrupts"],
          `${xn} needs every CPU cycle on its lines; ${yn} takes interrupts every few raster lines throughout the frame.`,
          `Pause ${yn} while ${xn}'s region is being drawn, or do not combine them.`);
      }
      if (Y.demands.has("changes_sprite_set") && !X.demands.has("constant_sprite_set")) {
        hard("cpu_vs_irq", ["cpu_every_line", "changes_sprite_set"],
          `${yn} rewrites sprite registers from interrupts during the frame; inside ${xn}'s region that breaks its cycle count.`,
          `Multiplex only outside ${xn}'s region.`);
      }
    }

    // One needs the same sprites active on every line; the other changes them.
    for (const [X, Y, xn, yn] of [[A, B, a_name, b_name], [B, A, b_name, a_name]] as const) {
      if (X.demands.has("constant_sprite_set") && Y.demands.has("changes_sprite_set")) {
        hard("sprite_set", ["constant_sprite_set", "changes_sprite_set"],
          `${xn}'s per-line timing depends on the same sprites being active on every line of its region; ${yn} changes the active set during the frame.`,
          `Multiplex only outside ${xn}'s region, or keep the sprite set fixed while ${xn}'s lines are drawn.`);
      }
    }

    // One runs with the KERNAL ROM out; the other calls KERNAL routines.
    for (const [X, Y, xn, yn] of [[A, B, a_name, b_name], [B, A, b_name, a_name]] as const) {
      if (X.demands.has("kernal_rom_out") && Y.kernal.length > 0) {
        hard("kernal_banked_out", Y.kernal,
          `${xn} runs with the KERNAL ROM banked out; ${yn} calls KERNAL routine(s) ${Y.kernal.join(", ")}, which are not there.`,
          `Bank the KERNAL in ($01 bit 1) around the calls, or replace them with RAM-resident code.`);
      }
    }
    return hits;
  };

  // Check each input pair. Named techniques are checked as named, even when
  // one requires the other: the caller put both on the list, and the
  // resolution says how to keep them apart.
  for (let i = 0; i < techniques.length; i++) {
    for (let j = i + 1; j < techniques.length; j++) {
      const a_name = techniques[i];
      const b_name = techniques[j];

      for (const h of hardRules(a_name, b_name)) {
        conflicts.push({ a: a_name, b: b_name, kind: h.kind, severity: "hard", shared: h.shared, rationale: h.rationale, resolution: h.resolution });
      }

      // Shared registers (soft)
      const sharedRegRows = await f.roQuery(
        `MATCH (a:Technique {name: $a})-[:USES]->(reg:Register)<-[:USES]-(b:Technique {name: $b})
         RETURN reg.name AS shared`,
        { a: a_name, b: b_name }
      );
      const sharedRegs = (sharedRegRows.data ?? []).map((r) => (r as { shared: string }).shared).filter(Boolean);
      if (sharedRegs.length > 0) {
        conflicts.push({
          a: a_name,
          b: b_name,
          kind: "shared_register",
          severity: "soft",
          shared: sharedRegs,
          rationale: `Both techniques touch register(s) ${sharedRegs.join(", ")}. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.`,
        });
      }

      // Shared KERNAL routines (soft)
      const sharedKernalRows = await f.roQuery(
        `MATCH (a:Technique {name: $a})-[:USES]->(k:KernalRoutine)<-[:USES]-(b:Technique {name: $b})
         RETURN k.name AS shared`,
        { a: a_name, b: b_name }
      );
      const sharedKernals = (sharedKernalRows.data ?? []).map((r) => (r as { shared: string }).shared).filter(Boolean);
      if (sharedKernals.length > 0) {
        conflicts.push({
          a: a_name,
          b: b_name,
          kind: "shared_kernal",
          severity: "soft",
          shared: sharedKernals,
          rationale: `Both techniques call KERNAL routine(s) ${sharedKernals.join(", ")}. Concurrent use may clobber KERNAL state.`,
        });
      }
    }
  }

  // Prerequisite closure. For each input pair (x, y), the hard rules run
  // between x's implied techniques and y, between y's and x, and between the
  // two implied sets. A technique is never reported against something it
  // says it runs on top of, from either direction: a candidate is dropped
  // when the other input declared it as its own prerequisite too (the okOn
  // sets), and when one member of the pair is on the other's own REQUIRES
  // chain (reaches) — with ifli_image → fli_image → stable_raster_irq and
  // stable_raster_irq named, fli_image is not turned against the IRQ it
  // declared. A hit is its own kind, prerequisite_conflict, attributed to
  // the input techniques with the implied ones in `via`; no technique's
  // demand set is changed by this. Only the hard rules run here: shared
  // registers between a prerequisite and a named technique would be noise.
  const reaches = async (from: string, to: string): Promise<boolean> => {
    // Every technique in the closure went through requiresOf above, so this
    // is a walk over the cache.
    const seen = new Set<string>([from]);
    const queue = [from];
    while (queue.length > 0) {
      for (const p of await requiresOf(queue.shift()!)) {
        if (p === to) return true;
        if (!seen.has(p)) {
          seen.add(p);
          queue.push(p);
        }
      }
    }
    return false;
  };
  for (let i = 0; i < techniques.length; i++) {
    for (let j = i + 1; j < techniques.length; j++) {
      const x = techniques[i];
      const y = techniques[j];
      const cx = closureOf(x);
      const cy = closureOf(y);
      const okOnX = new Set([x, ...cx]);
      const okOnY = new Set([y, ...cy]);
      const candidates: Array<[string, string]> = [];
      for (const u of cx) if (!okOnY.has(u)) candidates.push([u, y]);
      for (const v of cy) if (!okOnX.has(v)) candidates.push([x, v]);
      for (const u of cx) {
        if (okOnY.has(u)) continue;
        for (const v of cy) {
          if (u !== v && !okOnX.has(v)) candidates.push([u, v]);
        }
      }
      for (const [u, v] of candidates) {
        // Two named techniques are the input loop's business, whichever
        // chain also reached them.
        if (inputSet.has(u) && inputSet.has(v)) continue;
        // One of the pair declared the other as its prerequisite.
        if ((await reaches(u, v)) || (await reaches(v, u))) continue;
        const via = [u, v].filter((n) => n !== x && n !== y);
        const chainText = [
          u !== x ? describeChain(x, u) : null,
          v !== y ? describeChain(y, v) : null,
        ].filter((s): s is string => s !== null).join("; ");
        for (const h of hardRules(u, v)) {
          conflicts.push({
            a: x,
            b: y,
            kind: "prerequisite_conflict",
            severity: "hard",
            shared: h.shared,
            rationale: `${chainText}. ${h.rationale}`,
            resolution: h.resolution,
            via,
          });
        }
      }
    }
  }

  const verdict: CompatibilityCheckOutput["verdict"] =
    conflicts.some((c) => c.severity === "hard")
      ? "incompatible"
      : conflicts.length > 0
        ? "warnings"
        : "compatible";

  const coverageOf = (t: string): CompatibilityCheckOutput["data_coverage"][number] => {
    const F = facts.get(t)!;
    return {
      technique: t,
      found: F.found,
      registers: F.registers,
      kernal_routines: F.kernal.length,
      demands: [...F.demands].sort(),
      known: F.found && (F.registers > 0 || F.kernal.length > 0 || F.demands.size > 0),
    };
  };
  const data_coverage: CompatibilityCheckOutput["data_coverage"] = [
    ...techniques.map(coverageOf),
    ...closureOnly.map((c) => ({ ...coverageOf(c), implied_by: [...impliedBy.get(c)!].sort() })),
  ];

  // --- Shared infrastructure (info-level, not hard conflicts) ---

  const shared_infrastructure: CompatibilityCheckOutput["shared_infrastructure"] = [];

  // Prerequisites the set leans on without naming them. Not a conflict: a
  // note that the check included them, and that they have to be set up.
  for (const c of closureOnly) {
    shared_infrastructure.push({
      name: c,
      kind: "missing_prerequisite",
      via_recipes: [],
      required_by: [...impliedBy.get(c)!].sort(),
    });
  }

  // Transitive USES: find Recipes that implement >=2 of the input techniques,
  // then surface any Register/KernalRoutine that Recipe USES.
  if (techniques.length >= 2) {
    const transitiveRows = await f.roQuery(
      `MATCH (r:Recipe)-[:IMPLEMENTS]->(t:Technique)
       WHERE t.name IN $techs
       WITH r, collect(DISTINCT t.name) AS implements
       WHERE size(implements) >= 2
       MATCH (r)-[:USES]->(shared)
       RETURN DISTINCT shared.name AS name, labels(shared)[0] AS kind, r.name AS recipe`,
      { techs: techniques }
    );

    // Group by (name, kind) -> via_recipes[]
    const transitiveMap = new Map<string, { kind: string; via_recipes: Set<string> }>();
    for (const row of transitiveRows.data ?? []) {
      const rec = row as { name: string; kind: string; recipe: string };
      if (!rec.name || !rec.kind) continue;
      // Only surface Register and KernalRoutine nodes
      if (rec.kind !== "Register" && rec.kind !== "KernalRoutine") continue;
      const key = `${rec.kind}:${rec.name}`;
      if (!transitiveMap.has(key)) {
        transitiveMap.set(key, { kind: rec.kind, via_recipes: new Set() });
      }
      transitiveMap.get(key)!.via_recipes.add(rec.recipe);
    }

    for (const [key, val] of transitiveMap) {
      const name = key.slice(val.kind.length + 1);
      shared_infrastructure.push({
        name,
        kind: val.kind as "Register" | "KernalRoutine",
        via_recipes: Array.from(val.via_recipes),
      });
    }

    // Raster-discipline heuristic: if >=2 techniques have category=raster
    // OR directly USES the screen-control / raster-line registers (D011/SCROLY
    // or D012/RASTER — both alias forms because of the Register-dedup issue
    // tracked as P5-15), emit one discipline info entry.
    const rasterTechs: string[] = [];
    for (const tname of techniques) {
      const rr = await f.roQuery(
        `MATCH (t:Technique {name: $name})
         OPTIONAL MATCH (t)-[:USES]->(reg:Register)
         WHERE reg.name IN ['D011', 'D012', 'SCROLY', 'RASTER']
         RETURN t.category AS category, collect(reg.name) AS raster_regs`,
        { name: tname }
      );
      const row = rr.data?.[0] as { category: string; raster_regs: string[] } | undefined;
      if (!row) continue;
      const isRasterCategory = row.category === "raster";
      const usesRasterReg = Array.isArray(row.raster_regs) && row.raster_regs.length > 0;
      if (isRasterCategory || usesRasterReg) {
        rasterTechs.push(tname);
      }
    }
    if (rasterTechs.length >= 2) {
      shared_infrastructure.push({
        name: "raster_discipline",
        kind: "discipline",
        via_recipes: [],
      });
    }
  }

  a.logQuery({ tool: "c64_check_compatibility", query: techniques.join("+"), resultCount: conflicts.length });

  const structured: CompatibilityCheckOutput = { techniques, conflicts, shared_infrastructure, data_coverage, verdict };

  // "Not covered" is about the named techniques; implied ones are listed
  // separately so the silence-vs-clearance sentence keeps its denominator.
  const unknown = data_coverage.filter((d) => !d.known && d.implied_by === undefined);
  const unknownImplied = data_coverage.filter((d) => !d.known && d.implied_by !== undefined);
  let out = `# Compatibility: ${techniques.join(" + ")}\n\n`;
  out += `**Verdict:** ${verdict.toUpperCase()}`;
  if (verdict === "incompatible") out += ` — not as combined; each hard conflict below says how to separate them.`;
  out += `\n\n`;
  if (closureOnly.length > 0) {
    out += `Checked with ${closureOnly.length} implied prerequisite(s): ${closureOnly.join(", ")}.\n\n`;
  }
  if (conflicts.length === 0) {
    out += unknown.length === techniques.length
      ? `No conflicts detected, but the graph holds no register, KERNAL or resource data for any of these techniques, so this is silence, not a clearance.\n`
      : `No conflicts detected among what the graph knows about these techniques.\n`;
  } else {
    for (const c of conflicts) {
      out += `## ${c.kind} (${c.severity}): ${c.a} × ${c.b}\n`;
      if (c.via && c.via.length > 0) out += `**Via prerequisite(s):** ${c.via.join(", ")}\n`;
      out += `**Shared:** ${c.shared.join(", ")}\n`;
      out += `${c.rationale}\n`;
      if (c.resolution) out += `**Resolution:** ${c.resolution}\n`;
      out += `\n`;
    }
  }
  if (unknown.length > 0 || unknownImplied.length > 0) {
    out += `\n## Not covered\n`;
    for (const d of unknown) {
      out += d.found
        ? `- **${d.technique}**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.\n`
        : `- **${d.technique}**: no such technique in the graph (check the name with c64_techniques_for).\n`;
    }
    for (const d of unknownImplied) {
      out += `- **${d.technique}** (prerequisite of ${(d.implied_by ?? []).join(", ")}): the graph has no registers, KERNAL routines or demands for it.\n`;
    }
  }
  if (shared_infrastructure.length > 0) {
    out += `\n## Shared Infrastructure (info)\n`;
    for (const s of shared_infrastructure) {
      if (s.kind === "discipline") {
        out += `- **${s.name}**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.\n`;
      } else if (s.kind === "missing_prerequisite") {
        out += `- **${s.name}** (prerequisite, not in the set): required by ${(s.required_by ?? []).join(", ")}; included in the check as implied. Set it up first.\n`;
      } else {
        out += `- **${s.name}** (${s.kind}) shared via recipe(s): ${s.via_recipes.join(", ")}\n`;
      }
    }
  }
  return { structured, text: out };
}

const REGION_CONSTANTS = {
  PAL: { cycles_per_line: 63, lines_per_frame: 312 },
  NTSC: { cycles_per_line: 65, lines_per_frame: 263 },
} as const;

// A badline takes the bus for 40 cycles (15-54) and pulls BA low three cycles
// earlier; the CPU can spend those three only on write cycles, so 43 is the
// figure to plan on (20 of 63 left on PAL, 22 of 65 on NTSC).
const BADLINE_CYCLES_LOST = 43;
// Through the KERNAL vector: 7 cycles of interrupt sequence + 29 for the
// dispatcher at $FF48 before the handler's first instruction. A handler on
// $FFFE with the KERNAL out pays 7 plus its own register saves.
const DEFAULT_IRQ_OVERHEAD = 36;

export async function timingBudget(opts: {
  technique: string;
  region: string;
}): Promise<TimingBudgetResult> {
  const f = await getFalkor();
  const a = getAnalytics();

  const regionKey = opts.region.toUpperCase() as "PAL" | "NTSC";
  const rc = REGION_CONSTANTS[regionKey] ?? REGION_CONSTANTS.PAL;

  // Look up technique's irq_overhead if stored; fall back to default
  const techRows = await f.roQuery(
    `MATCH (t:Technique {name: $name}) RETURN t.irq_overhead AS irq_overhead`,
    { name: opts.technique }
  );
  const storedOverhead = (techRows.data?.[0] as { irq_overhead: number | null } | undefined)?.irq_overhead;
  const irq_overhead = typeof storedOverhead === "number" ? storedOverhead : DEFAULT_IRQ_OVERHEAD;

  const cycles_per_line = rc.cycles_per_line;
  const cycles_per_frame = cycles_per_line * rc.lines_per_frame;
  const user_cycles_per_line_normal = cycles_per_line - irq_overhead;
  // A handler entered on a badline through the KERNAL vector has nothing
  // left on that line (63 - 43 - 36 < 0); report 0, and the note below says
  // to put splits on non-badlines.
  const user_cycles_per_line_badline = Math.max(0, cycles_per_line - irq_overhead - BADLINE_CYCLES_LOST);

  const notes: string[] = [
    `${regionKey}: ${cycles_per_line} cycles/line × ${rc.lines_per_frame} lines = ${cycles_per_frame} cycles/frame.`,
    `Badline: the VIC takes the bus on cycles 15-54 and drops BA on cycle 12, so ${BADLINE_CYCLES_LOST} cycles are lost to code that is not writing on 12-14 (40 to code that is). No read cycle is possible between 12 and 54.`,
    `IRQ overhead: ${irq_overhead} cycles before the handler's first instruction (7 interrupt sequence + 29 KERNAL dispatcher at $FF48 via $0314; 7 via $FFFE with the KERNAL out), plus 0-6 cycles of jitter unless a double IRQ is used.`,
    `User cycles/line normal: ${cycles_per_line} - ${irq_overhead} = ${user_cycles_per_line_normal}.`,
    `User cycles/line badline: ${cycles_per_line} - ${irq_overhead} - ${BADLINE_CYCLES_LOST} = ${user_cycles_per_line_badline}.`,
  ];
  if (user_cycles_per_line_badline <= 0) {
    notes.push(`WARNING: badline leaves no user cycles — tight handler required.`);
  }

  a.logQuery({ tool: "c64_timing_budget", query: `${opts.technique}:${regionKey}`, resultCount: 1 });

  const structured: TimingBudgetOutput = {
    technique: opts.technique,
    region: regionKey,
    cycles_per_line,
    cycles_per_frame,
    badline_cycles_lost: BADLINE_CYCLES_LOST,
    irq_overhead_cycles: irq_overhead,
    user_cycles_per_line_normal,
    user_cycles_per_line_badline,
    notes,
  };

  let out = `# Timing budget: ${opts.technique} (${regionKey})\n\n`;
  out += `| Property | Value |\n|----------|-------|\n`;
  out += `| Region | ${regionKey} |\n`;
  out += `| Cycles/line | ${cycles_per_line} |\n`;
  out += `| Cycles/frame | ${cycles_per_frame} |\n`;
  out += `| Badline cycles lost | ${BADLINE_CYCLES_LOST} |\n`;
  out += `| IRQ overhead | ${irq_overhead} |\n`;
  out += `| User cycles/line (normal) | ${user_cycles_per_line_normal} |\n`;
  out += `| User cycles/line (badline) | ${user_cycles_per_line_badline} |\n`;
  out += `\n## Notes\n\n`;
  for (const note of notes) {
    out += `- ${note}\n`;
  }

  return { structured, text: out };
}
