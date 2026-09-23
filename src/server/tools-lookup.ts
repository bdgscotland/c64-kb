/** Lookup and search tools: health, search, registers, KERNAL, memory map, opcodes, PAL/NTSC. */

import { z } from "zod";
import {
  search,
  lookupRegister,
  lookupKernal,
  memoryMap,
  lookupOpcode,
  palNtscDiff,
} from "../tools/query.ts";
import { health, formatHealth } from "../tools/intelligence.ts";
import {
  RegisterLookupSchema,
  KernalLookupSchema,
  MemoryMapSchema,
  OpcodeLookupSchema,
  PalNtscDiffSchema,
  SearchSchema,
} from "../schemas/tool-outputs.ts";
import { defineTool, READ_ONLY } from "./define-tool.ts";

export const healthTool = defineTool({
  name: "c64_health",
  title: "Service health",
  description: `Health check for c64-kb backing services (Qdrant vector store, FalkorDB graph, Ollama embeddings, SQLite analytics).

Guidelines: Call this before any other tool when a session begins or after suspected service hiccups. The result indicates whether vector search is available (Ollama OK = vector mode; DEGRADED = keyword-only fallback).

Limitations: Reports current liveness only. Does not validate data freshness or detect partial ingest failures.

Returns a markdown table with one row per service. Expected length: ~6 lines.

Example: {} — no arguments.`,
  inputSchema: {},
  annotations: READ_ONLY,
  run: async () => ({ text: formatHealth(await health()) }),
});

export const searchTool = defineTool({
  name: "c64_search",
  title: "Search the C64 knowledge base",
  description: `Semantic + keyword hybrid search across the entire C64 knowledge base. Returns ranked documentation chunks with confidence badges (HIGH/MEDIUM/LOW based on cosine similarity score).

Guidelines: Use for fuzzy intent ("how does badline timing work?", "which chip handles joystick?") or when the user's question doesn't map cleanly to a register, KERNAL routine, or opcode. For known identifiers, prefer c64_lookup_register / c64_lookup_kernal / c64_lookup_opcode which return structured data.

Limitations: Quality depends on Ollama availability. Without Ollama, falls back to Qdrant's full-text index (no semantic similarity). Indexed corpus is stock C64 only (no Mega65 / SuperCPU / cartridge-specific docs).

Param notes: 'limit' defaults to 5; raise for survey-style queries, lower for tight follow-ups. 'filter_source' is an exact-match source filename (e.g. "vic-ii-reference.md").

Expected length: 5-30 chunks of ~100-300 words each in the markdown view; structuredContent has the same hits as typed JSON.

Example: {"query": "stable raster IRQ", "limit": 3} returns the top-3 chunks across all docs.`,
  inputSchema: {
    query: z.string().describe("Natural-language query about C64 development"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(5)
      .describe("Max results to return (1-20, default 5)"),
    filter_source: z
      .string()
      .optional()
      .describe("Restrict to an exact source file (e.g. 'vic-ii-reference.md')"),
  },
  outputSchema: SearchSchema.shape,
  annotations: READ_ONLY,
  run: ({ query, limit, filter_source }) => search(query, limit, filter_source),
});

export const lookupRegisterTool = defineTool({
  name: "c64_lookup_register",
  title: "Look up a hardware register",
  description: `Look up a Commodore 64 hardware register by canonical name, mnemonic, or hex address. Returns the register's chip, R/W status, aliases, and the top 3 most relevant documentation chunks.

Guidelines: Use this when you know a specific register identifier (e.g. "D011", "SCROLY", "$D011") and want its semantics. For fuzzy intent ("which register controls scrolling?"), use c64_search instead.

Limitations: Stock C64 only (no Mega65/SuperCPU registers). Custom expansion-cartridge registers at $DE00-$DFFF are not documented.

Param notes: 'name_or_addr' accepts canonical name (SCROLY), short mnemonic (D011), or hex address ($D011 / D011). The lookup matches all three forms via aliases.

Expected length: 1 register header + up to 3 doc chunks (~200-500 words total).

Example: {"name_or_addr": "D011"} or {"name_or_addr": "$D011"} or {"name_or_addr": "SCROLY"} — all three resolve to the same register.

Returns structured: {name, address, chip, rw, aliases, documentation[]}.`,
  inputSchema: {
    name_or_addr: z
      .string()
      .describe("Register name (e.g. 'SCROLY'), mnemonic (e.g. 'D011'), or hex address ($D011 / D011)"),
  },
  outputSchema: RegisterLookupSchema.shape,
  annotations: READ_ONLY,
  run: ({ name_or_addr }) => lookupRegister(name_or_addr),
});

export const lookupKernalTool = defineTool({
  name: "c64_lookup_kernal",
  title: "Look up a KERNAL routine",
  description: `Look up a KERNAL ROM routine by canonical name (e.g. 'CHROUT') or jump-table address (e.g. '$FFD2'). Returns the routine's description, pairs-with partners (e.g. OPEN/CLOSE, CHKIN/CLRCHN), and the top 3 most relevant documentation chunks.

Guidelines: Use when you know a KERNAL routine identifier. For "what KERNAL routine should I call to print a string?", use c64_search.

Limitations: Stock C64 KERNAL only. JiffyDOS / Final Cartridge / SpeedDOS KERNAL extensions are not indexed.

Param notes: 'name_or_addr' is case-insensitive. Hex addresses accept '$FFD2', 'FFD2', or 'ffd2'.

Expected length: 1 routine header + pairs list + up to 3 doc chunks (~200-400 words total).

Example: {"name_or_addr": "CHROUT"} or {"name_or_addr": "$FFD2"}.

Returns structured: {name, address, description, pairs_with[], documentation[]}.`,
  inputSchema: {
    name_or_addr: z.string().describe("KERNAL routine name (CHROUT) or jump-table address ($FFD2 / FFD2)"),
  },
  outputSchema: KernalLookupSchema.shape,
  annotations: READ_ONLY,
  run: ({ name_or_addr }) => lookupKernal(name_or_addr),
});

export const memoryMapTool = defineTool({
  name: "c64_memory_map",
  title: "Memory map for an address",
  description: `Given a hex address, return the memory region(s) the address lives in. Correctly reports banked overlap — e.g. $D011 is BOTH "I/O area" AND "VIC-II registers" depending on the bank-switching state of $01.

Guidelines: Use to disambiguate "what is at this address?" when reading existing C64 code. For lookups by region name, query the c64://memory-map resource directly.

Limitations: Returns documented stock-C64 regions only. Doesn't model the full bank-switching matrix; only flags which regions overlap.

Param notes: 'addr' accepts '$D011', 'D011', or 'd011'. Non-hex characters are stripped.

Expected length: Header + 1-3 region rows.

Example: {"addr": "$D011"} returns both the I/O area and VIC-II register entries.

Returns structured: {address, regions[{name, start, end, default_use, bank_switchable}]}.`,
  inputSchema: {
    addr: z.string().describe("Hex address (e.g. '$D011', 'D011'). Non-hex characters stripped."),
  },
  outputSchema: MemoryMapSchema.shape,
  annotations: READ_ONLY,
  run: ({ addr }) => memoryMap(addr),
});

export const lookupOpcodeTool = defineTool({
  name: "c64_lookup_opcode",
  title: "Look up a 6510 opcode",
  description: `Look up a 6510 opcode by byte (e.g. '$A9') or by mnemonic (e.g. 'LDA'). Returns cycles, flag effects, page-cross penalty, and a description from the 6510-cpu-reference (legal opcodes) or 6502-illegal-opcodes (undocumented opcodes) reference docs.

Guidelines: For a byte lookup, expect the single matching opcode at the top. For a mnemonic, expect all addressing-mode variants (e.g. 'LDA' returns LDA #imm, LDA $zp, LDA $nnnn,X, etc.).

Limitations: HuC6280 / 65C02 extensions are not indexed. Illegal opcode behavior reported is the most-commonly-cited consensus (some illegals are bus-dependent and vary by chip revision).

Param notes: 'byte_or_mnemonic' accepts '$A9', 'A9', or 'LDA' (case-insensitive).

Expected length: Up to 3 doc chunks (~150-400 words total).

Example: {"byte_or_mnemonic": "$A9"} returns LDA #imm. {"byte_or_mnemonic": "LDA"} returns all LDA variants.

Returns structured: {query, results[{source, section, text, score}]}.`,
  inputSchema: {
    byte_or_mnemonic: z.string().describe("Opcode byte ($A9, A9) or mnemonic (LDA, lda)"),
  },
  outputSchema: OpcodeLookupSchema.shape,
  annotations: READ_ONLY,
  run: ({ byte_or_mnemonic }) => lookupOpcode(byte_or_mnemonic),
});

export const palNtscDiffTool = defineTool({
  name: "c64_pal_ntsc_diff",
  title: "PAL vs NTSC differences",
  description: `Compare PAL vs NTSC for a topic. Always returns the canonical region property table (refresh Hz, lines/frame, cycles/line for both PAL and NTSC) plus topic-specific documentation chunks.

Guidelines: Use to surface region-dependent behavior — timing, music tempo, raster mechanics, badline behavior, SID clock. The structured 'regions' array is identical regardless of topic; the 'documentation' array narrows the discussion.

Limitations: PAL-N (Argentina/Brazil) and SECAM are not modeled. Drean PAL-B variant is treated as standard PAL.

Param notes: 'topic' is freeform — short keywords work best ("badline", "music tempo", "SID clock").

Expected length: Region table + up to 3 topic chunks (~200-500 words total).

Example: {"topic": "badline"} returns the timing table plus badline-specific docs.

Returns structured: {topic, regions[], documentation[]}.`,
  inputSchema: {
    topic: z
      .string()
      .describe("Topic to compare (e.g. 'raster timing', 'music tempo', 'badline', 'SID clock')"),
    region: z
      .enum(["pal", "ntsc", "both"])
      .optional()
      .default("both")
      .describe("Limit discussion to a single region (default 'both')"),
  },
  outputSchema: PalNtscDiffSchema.shape,
  annotations: READ_ONLY,
  run: ({ topic, region }) => palNtscDiff(topic, region),
});
