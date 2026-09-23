/**
 * MCP Resource handlers. Resources expose stable reference content
 * via URIs that consuming clients can attach to context directly,
 * bypassing the tool round-trip. This is particularly useful for
 * high-frequency reads of canonical reference docs (memory map,
 * KERNAL jump table, opcode tables, etc.).
 *
 * Static URIs:
 *   c64://memory-map
 *   c64://kernal-jumptable
 *   c64://opcodes
 *   c64://illegal-opcodes
 *   c64://pal-ntsc
 *   c64://vic-ii
 *   c64://sid
 *   c64://cia
 *   c64://6510-cpu
 *   c64://registers
 *   c64://ontology
 *
 * Templates:
 *   c64://register/{name}    — structured JSON for a single register
 *
 * Path-traversal safety: doc file paths are NEVER taken from MCP
 * client input. Each resource maps to a hardcoded entry in the
 * `STATIC_RESOURCES` whitelist below. `readResourceByKey()` looks
 * up the entry by URI; the resolved file path is fully derived
 * from constants baked into this module.
 */

import fs from "fs";
import path from "path";
import { config } from "../config.ts";
import { getFalkor } from "../context.ts";

const DOCS_DIR = config.docs.dir;

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

/**
 * Look up a register by name/alias/address and return a structured
 * JSON resource document. Returns null if no match.
 */
export async function readRegisterResource(
  uri: string,
  name: string
): Promise<ResourceContent | null> {
  // MCP clients may percent-encode the name segment (e.g. "%24D011" for "$D011").
  // Decode before matching; fall back to the raw value if the string is malformed.
  let decodedName = name;
  try {
    decodedName = decodeURIComponent(name);
  } catch {
    // malformed percent-sequence — use raw value
  }
  const f = await getFalkor();
  const cleaned = decodedName.trim().toUpperCase().replace(/^\$/, "");
  const result = await f.roQuery(
    `MATCH (r:Register)
     WHERE r.name = $name OR r.address = $addr OR $name IN r.aliases
     OPTIONAL MATCH (r)-[:BELONGS_TO]->(c:Chip)
     RETURN r.name AS name,
            r.address AS addr,
            r.rw AS rw,
            r.aliases AS aliases,
            c.name AS chip
     LIMIT 1`,
    { name: cleaned, addr: `$${cleaned}` }
  );
  const row = result.data?.[0] as
    | { name: string; addr: string; rw: string; aliases: string[]; chip: string | null }
    | undefined;
  if (!row) return null;
  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify(
      {
        name: row.name,
        address: row.addr,
        chip: row.chip ?? "unknown",
        rw: row.rw,
        aliases: row.aliases ?? [],
      },
      null,
      2
    ),
  };
}

/**
 * Static resource manifest. Each entry maps a stable c64:// URI to a
 * markdown file. The full filesystem path is computed at module-load
 * time from `DOCS_DIR` + a constant, hardcoded relative path —
 * `relPath` is never sourced from MCP client input.
 */
export const STATIC_RESOURCES: ReadonlyArray<{
  readonly name: string;
  readonly uri: string;
  readonly description: string;
  readonly filePath: string;
}> = (
  [
    ["memory-map", "c64://memory-map", "Complete C64 memory map ($0000-$FFFF) with bank-switching details.", "hardware/c64-memory-map.md"],
    ["kernal-jumptable", "c64://kernal-jumptable", "KERNAL jump-table routines at $FF81-$FFF3 with inputs, outputs, and pairs.", "hardware/kernal-routines-reference.md"],
    ["opcodes", "c64://opcodes", "6510 CPU opcode reference (cycles, flags, addressing modes, page-cross penalties).", "hardware/6510-cpu-reference.md"],
    ["illegal-opcodes", "c64://illegal-opcodes", "6502/6510 undocumented (illegal) opcodes reference.", "hardware/6502-illegal-opcodes.md"],
    ["pal-ntsc", "c64://pal-ntsc", "PAL vs NTSC differences: refresh rate, lines/frame, cycles/line, raster timing.", "hardware/pal-ntsc-reference.md"],
    ["vic-ii", "c64://vic-ii", "VIC-II video chip reference: registers, sprite mechanics, raster timing, badlines.", "hardware/vic-ii-reference.md"],
    ["sid", "c64://sid", "SID sound chip reference: voices, ADSR, filter, control registers.", "hardware/sid-reference.md"],
    ["cia", "c64://cia", "CIA 6526 reference: timers, IRQ sources, keyboard/joystick scanning.", "hardware/cia-reference.md"],
    ["6510-cpu", "c64://6510-cpu", "6510 CPU architecture: registers, addressing modes, flags, instruction set.", "hardware/6510-cpu-reference.md"],
    ["registers", "c64://registers", "Consolidated C64 registers reference (VIC-II, SID, CIA, KERNAL vectors).", "hardware/c64-registers-reference.md"],
    ["ontology", "c64://ontology", "c64-kb knowledge graph ontology: node labels, edge types, property conventions.", "ONTOLOGY.md"],
  ] as const
).map(([name, uri, description, rel]) => ({
  name,
  uri,
  description,
  // path.join with two constants — neither crosses a user-input boundary.
  filePath: path.join(DOCS_DIR, rel),
}));

/**
 * Read a static resource by its exact c64:// URI. The URI is matched
 * against the whitelist; the file path comes from the matched entry's
 * precomputed `filePath`, so no client-supplied string is ever joined
 * into a filesystem path.
 */
export function readStaticResource(uri: string): ResourceContent | null {
  const entry = STATIC_RESOURCES.find((r) => r.uri === uri);
  if (!entry) return null;
  if (!fs.existsSync(entry.filePath)) return null;
  return {
    uri: entry.uri,
    mimeType: "text/markdown",
    text: fs.readFileSync(entry.filePath, "utf-8"),
  };
}
