/**
 * HVSC catalog parsers: PSID headers, STIL.txt, Songlengths.md5.
 *
 * The PSID header format is documented at:
 *   https://www.hvsc.c64.org/download/files/HVSC_PSID_v2NG.txt
 *
 * The 124-byte PSID v2 header is fixed-layout big-endian binary.
 */

export interface PsidHeader {
  magic: "PSID" | "RSID";
  version: number;          // 1 or 2
  dataOffset: number;       // typically 124 for v2
  loadAddress: number;      // 16-bit big-endian; 0 means take from data body
  initAddress: number;
  playAddress: number;
  subtuneCount: number;
  startSubtune: number;
  speedFlags: number;       // bitmap, one bit per subtune (1=CIA, 0=VBI)
  name: string;             // 32 bytes, null-padded, latin-1
  author: string;
  released: string;
  flags: number;            // v2+
}

export class PsidParseError extends Error {}

export function parsePsidHeader(raw: Buffer): PsidHeader {
  if (raw.length < 22) {
    throw new PsidParseError(`PSID header too short: ${raw.length} bytes`);
  }
  const magic = raw.slice(0, 4).toString("ascii");
  if (magic !== "PSID" && magic !== "RSID") {
    throw new PsidParseError(`Bad PSID magic: ${JSON.stringify(magic)}`);
  }
  const version = raw.readUInt16BE(4);
  const dataOffset = raw.readUInt16BE(6);
  const loadAddress = raw.readUInt16BE(8);
  const initAddress = raw.readUInt16BE(10);
  const playAddress = raw.readUInt16BE(12);
  const subtuneCount = raw.readUInt16BE(14);
  const startSubtune = raw.readUInt16BE(16);
  const speedFlags = raw.readUInt32BE(18);

  const name = raw.length >= 54 ? raw.slice(22, 54).toString("latin1").replace(/\0.*$/, "") : "";
  const author = raw.length >= 86 ? raw.slice(54, 86).toString("latin1").replace(/\0.*$/, "") : "";
  const released = raw.length >= 118 ? raw.slice(86, 118).toString("latin1").replace(/\0.*$/, "") : "";
  const flags = version >= 2 && raw.length >= 120 ? raw.readUInt16BE(118) : 0;

  return {
    magic: magic as "PSID" | "RSID",
    version, dataOffset, loadAddress, initAddress, playAddress,
    subtuneCount, startSubtune, speedFlags, name, author, released, flags,
  };
}

export interface StilEntry {
  path: string;
  title?: string;
  artist?: string;
  comments: string[];
  covers: string[];
  sampleSources: string[];
}

/**
 * Parse the STIL.txt format.
 * Format reference: https://www.hvsc.c64.org/download/files/STIL.faq
 *
 * Blocks are delimited by lines starting with "/MUSICIANS/" (a tune path).
 * Within a block, each line is "KEYWORD: value" or a continuation. Lines
 * starting with "#" and the file header before the first tune-path are
 * skipped.
 */
export function parseStilTxt(raw: string): Map<string, StilEntry> {
  const entries = new Map<string, StilEntry>();
  let current: StilEntry | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("/MUSICIANS/") || line.startsWith("/DEMOS/") || line.startsWith("/GAMES/")) {
      if (current) entries.set(current.path, current);
      current = { path: line.trim(), comments: [], covers: [], sampleSources: [] };
      continue;
    }
    if (!current || line.startsWith("#") || line.trim() === "") continue;

    const m = line.match(/^([A-Z][A-Z_-]*)\s*:\s*(.+)$/);
    if (!m) {
      if (current.comments.length > 0) {
        current.comments[current.comments.length - 1] += " " + line.trim();
      }
      continue;
    }
    const key = m[1];
    const val = m[2].trim();
    if (key === "TITLE") current.title = val;
    else if (key === "ARTIST" || key === "AUTHOR") current.artist = val;
    else if (key === "COMMENT") current.comments.push(val);
    else if (key === "COVER") current.covers.push(val);
    else if (key === "SAMPLED-FROM" || key === "ORIGINAL_LOC") current.sampleSources.push(val);
  }
  if (current) entries.set(current.path, current);
  return entries;
}

// Songlengths.md5 parsing is in the standalone module; re-export for back-compat.
export { parseSonglengths as parseSongLengths } from "./songlengths-parser.js";
export { parseSonglengths } from "./songlengths-parser.js";
export type { SonglengthsIndex } from "./songlengths-parser.js";

// Standalone STIL parser with subtune-indexed keys and role-typed credits.
// parseStilTxt above is retained for back-compat (path-keyed, simpler schema).
export { parseSTIL } from "./stil-parser.js";
export type { StilEntry as StilEntryV2, StilCredit, StilIndex } from "./stil-parser.js";
