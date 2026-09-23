/**
 * Exact lookups against the graph: registers, KERNAL routines and the
 * memory map, each followed by the best-matching document chunks.
 */

import { z } from "zod";
import { getFalkor, getAnalytics } from "../../context.ts";
import type {
  KernalLookupOutput,
  MemoryMapOutput,
  RegisterLookupOutput,
} from "../../schemas/tool-outputs.ts";
import { names, parseRows, renderDocBlocks, searchChunks, toDocChunk } from "./shared.ts";
import type { KernalLookupResult, MemoryMapResult, RegisterLookupResult } from "./types.ts";

function hexToInt(addr: string): number {
  return parseInt(addr.replace(/^\$/, ""), 16);
}

function normalizeRw(rw: string | null | undefined): "R" | "W" | "RW" {
  const upper = (rw ?? "").trim().toUpperCase();
  if (upper === "R" || upper === "W" || upper === "RW") return upper;
  // Stored values like "Read-only" / "Write-only" — best-effort coerce.
  if (upper.startsWith("R") && !upper.includes("W")) return "R";
  if (upper.startsWith("W") && !upper.includes("R")) return "W";
  return "RW";
}

/** Up to five names of `label` nodes whose name or address contains the first three characters. */
async function nearMatches(label: "Register" | "KernalRoutine", cleaned: string): Promise<string[]> {
  const partial = cleaned.slice(0, 3);
  if (!partial) return [];
  const f = await getFalkor();
  return names(
    await f.roQuery(
      `MATCH (r:${label})
       WHERE r.name CONTAINS $partial
          OR r.address CONTAINS $partial
       RETURN r.name AS name LIMIT 5`,
      { partial },
    ),
  );
}

function notFoundText(what: string, query: string, suggestions: string[]): string {
  return (
    `No ${what} found matching "${query}".\n\n` +
    `Did you mean: ${suggestions.length > 0 ? suggestions.join(", ") : "(no near-matches)"}.\n\n` +
    `Try \`c64_search\` with "${query}" for fuzzy lookup.`
  );
}

const emptyRegister = (): RegisterLookupOutput => ({
  found: false,
  name: "",
  address: "",
  chip: "",
  rw: "RW",
  aliases: [],
  documentation: [],
});

const RegisterRow = z.object({
  name: z.string(),
  addr: z.string(),
  rw: z.string(),
  aliases: z.array(z.string()).nullable(),
  chip: z.string().nullable(),
});

/**
 * Decimal I/O address to hex: 53265 → "D011". All C64 I/O registers live
 * in $D000–$DFFF (53248–57343); anything else is not a decimal address.
 */
function decimalIoToHex(cleaned: string): string | null {
  if (!/^\d{4,5}$/.test(cleaned)) return null;
  const decimal = parseInt(cleaned, 10);
  if (decimal < 0xd000 || decimal > 0xdfff) return null;
  return decimal.toString(16).toUpperCase().padStart(4, "0");
}

export async function lookupRegister(nameOrAddr: string): Promise<RegisterLookupResult> {
  const cleaned = nameOrAddr.trim().toUpperCase().replace(/^\$/, "");

  // Guard: single-letter mnemonic queries match the entire register table and
  // produce useless noise. Return early with a helpful hint.
  if (/^[A-Z]$/.test(cleaned)) {
    return {
      structured: emptyRegister(),
      text:
        `"${nameOrAddr}" is too short for a register lookup. ` +
        `Provide at least 2 characters for mnemonic lookups; ` +
        `for fuzzy intent use c64_search instead.`,
    };
  }

  const asHex = decimalIoToHex(cleaned);
  if (asHex !== null) return lookupRegister(asHex);

  // Match by canonical name, hex address, or any alias.
  const f = await getFalkor();
  const rows = parseRows(
    RegisterRow,
    await f.roQuery(
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
      { cleaned, addr: `$${cleaned}` },
    ),
  );

  getAnalytics().logQuery({ tool: "c64_lookup_register", query: nameOrAddr, resultCount: rows.length });

  const reg = rows.at(0);
  if (!reg) {
    return {
      structured: emptyRegister(),
      text: notFoundText("register", nameOrAddr, await nearMatches("Register", cleaned)),
    };
  }
  return describeRegister(reg);
}

async function describeRegister(reg: z.infer<typeof RegisterRow>): Promise<RegisterLookupResult> {
  const aliases = reg.aliases ?? [];
  const chip = reg.chip ?? "unknown";

  // Pull richer context from Qdrant. Include all alias forms so both
  // dense and sparse vectors have multiple shots at the right chunk.
  const queryStr = [reg.name, reg.addr, ...aliases].filter(Boolean).join(" ");
  const { chunks: ctx } = await searchChunks({ query: queryStr, limit: 3 });

  const structured: RegisterLookupOutput = {
    found: true,
    name: reg.name,
    address: reg.addr,
    chip,
    rw: normalizeRw(reg.rw),
    aliases,
    documentation: ctx.map(toDocChunk),
  };

  let out = `# ${reg.name} — ${reg.addr}\n\n**Chip:** ${chip}\n**Access:** ${reg.rw}\n`;
  if (aliases.length > 0) out += `**Aliases:** ${aliases.join(", ")}\n`;
  out += `\n`;
  out +=
    ctx.length > 0 ? `## Documentation\n\n${renderDocBlocks(ctx)}` : `(No additional documentation found.)\n`;
  return { structured, text: out };
}

const KernalRow = z.object({
  name: z.string(),
  addr: z.string(),
  desc: z.string().nullable(),
  pairs: z.array(z.string()),
});

const KERNAL_QUERY = (key: "name" | "address") =>
  `MATCH (k:KernalRoutine {${key}: $value})
   OPTIONAL MATCH (k)-[:PAIRS_WITH]->(p:KernalRoutine)
   RETURN k.name AS name, k.address AS addr, k.description AS desc, collect(DISTINCT p.name) AS pairs`;

export async function lookupKernal(nameOrAddr: string): Promise<KernalLookupResult> {
  const f = await getFalkor();
  const cleaned = nameOrAddr.trim().toUpperCase().replace(/^\$/, "");
  const byName = parseRows(KernalRow, await f.roQuery(KERNAL_QUERY("name"), { value: cleaned }));
  const byAddr = parseRows(KernalRow, await f.roQuery(KERNAL_QUERY("address"), { value: `$${cleaned}` }));
  const rows = [...byName, ...byAddr];

  getAnalytics().logQuery({ tool: "c64_lookup_kernal", query: nameOrAddr, resultCount: rows.length });

  const row = rows.at(0);
  if (!row) {
    return {
      structured: { name: "", address: "", description: "", pairs_with: [], documentation: [] },
      text: notFoundText("KERNAL routine", nameOrAddr, await nearMatches("KernalRoutine", cleaned)),
    };
  }

  const { chunks: ctx } = await searchChunks({
    query: `KERNAL ${row.name} ${row.addr}`,
    limit: 3,
    keywordText: `${row.name} ${row.addr}`,
  });
  const desc = row.desc ?? "";

  const structured: KernalLookupOutput = {
    name: row.name,
    address: row.addr,
    description: desc,
    pairs_with: row.pairs,
    documentation: ctx.map(toDocChunk),
  };

  let out = `# ${row.name} — ${row.addr}\n\n${desc}\n\n`;
  if (row.pairs.length > 0) out += `**Pairs with:** ${row.pairs.join(", ")}\n\n`;
  if (ctx.length > 0) out += `## Documentation\n\n${renderDocBlocks(ctx)}`;
  return { structured, text: out };
}

const MemoryRegionRow = z.object({
  name: z.string(),
  start: z.string(),
  end: z.string(),
  use: z.string().nullable(),
  bank: z.unknown(),
});

export async function memoryMap(addr: string): Promise<MemoryMapResult> {
  const cleaned = addr
    .trim()
    .toUpperCase()
    .replace(/^\$/, "")
    .replace(/[^0-9A-F]/g, "");
  if (!cleaned) {
    return {
      structured: { address: addr, regions: [] },
      text: `Invalid address: "${addr}". Use a hex address like $D011 or 0400.`,
    };
  }
  const numeric = parseInt(cleaned, 16);
  const canonicalAddr = `$${cleaned}`;

  // Find regions whose [start, end] contains this address.
  const f = await getFalkor();
  const rows = parseRows(
    MemoryRegionRow,
    await f.roQuery(
      `MATCH (m:MemoryRegion)
       RETURN m.name AS name, m.start AS start, m.end AS end, m.default_use AS use, m.bank_switchable AS bank`,
    ),
  );
  const matches = rows.filter((r) => numeric >= hexToInt(r.start) && numeric <= hexToInt(r.end));

  getAnalytics().logQuery({ tool: "c64_memory_map", query: addr, resultCount: matches.length });

  const regions = matches.map((r) => ({
    name: r.name,
    start: r.start,
    end: r.end,
    default_use: r.use ?? "",
    bank_switchable: Boolean(r.bank),
  }));
  const structured: MemoryMapOutput = { address: canonicalAddr, regions };

  if (regions.length === 0) {
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
