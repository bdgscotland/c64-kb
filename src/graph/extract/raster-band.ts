/**
 * **Raster band:** says which raster lines a technique holds the CPU on
 * (docs/CONVENTIONS-techniques.md). The value is comma-separated ranges of
 * raster line numbers, `N-M` or `N`, or the word `movable` for a technique
 * whose lines the program chooses. A trailing parenthetical note says where
 * the numbers came from and is not part of the value.
 */

// Highest raster line number on either machine: PAL has 312 lines (0-311),
// NTSC 263 (0-262). A band is stated in raster line numbers, the same
// numbers on both machines; a line past 262 simply does not occur on NTSC.
export const RASTER_LINE_MAX = 311;

export type RasterBand =
  | { kind: "lines"; ranges: [number, number][]; canonical: string }
  | { kind: "movable"; canonical: "movable" };

const BAND_PART = /^(\d+)(?:\s*[-–]\s*(\d+))?$/;

function parseBandPart(part: string): [number, number] | { error: string } {
  const m = BAND_PART.exec(part);
  if (!m) return { error: `"${part}" is not a line number, a range N-M, or "movable"` };
  const first = Number(m.at(1));
  const lastText = m.at(2);
  const last = lastText !== undefined ? Number(lastText) : first;
  if (first > last) return { error: `range ${first}-${last} runs backwards (write a wrap as two ranges)` };
  if (last > RASTER_LINE_MAX) return { error: `line ${last} is past the last raster line, ${RASTER_LINE_MAX}` };
  return [first, last];
}

/**
 * Parse the value of a **Raster band:** line (or the canonical string stored
 * on the Technique node). Returns an error string for anything outside the
 * grammar, so the extractor can warn and ingest nothing rather than guess.
 */
export function parseRasterBand(raw: string): RasterBand | { error: string } {
  const value = raw
    .replace(/`/g, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
  if (value === "") return { error: "empty band" };
  if (value === "movable") return { kind: "movable", canonical: "movable" };
  const ranges: [number, number][] = [];
  for (const part of value.split(",").map((s) => s.trim())) {
    const range = parseBandPart(part);
    if ("error" in range) return range;
    ranges.push(range);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const canonical = ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(",");
  return { kind: "lines", ranges, canonical };
}

/** True when two line bands share at least one raster line. */
export function rasterBandsOverlap(a: [number, number][], b: [number, number][]): boolean {
  return a.some(([a0, a1]) => b.some(([b0, b1]) => a0 <= b1 && b0 <= a1));
}
