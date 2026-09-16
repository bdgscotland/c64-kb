/**
 * Parser for HVSC's Songlengths.md5 file.
 *
 * Format: <32-char-md5>=<length>[ <length>...]
 * Each <length> is M:SS or M:SS.sss (decimal seconds).
 * Comment lines start with `;`; blank lines ignored.
 * The `[Database]` header line is also skipped (starts with `[`).
 *
 * Returns a Map<file_md5, length_sec[]> keyed by the lowercase MD5,
 * with one length per subtune (index 0 = subtune 0).
 *
 * Nuances observed in the real HVSC corpus:
 *   - Comment lines use `;` (not `#`), e.g. `; /DEMOS/0-9/10_Orbyte.sid`
 *   - Milliseconds use 2–3 decimal digits, e.g. `4:33.108`, `2:46.93`, `0:40.923`
 *   - The file begins with a `[Database]` header line
 *   - MD5 keys are lowercase 32-char hex in the corpus; we normalise to lowercase
 */

export type SonglengthsIndex = Map<string, number[]>;

function parseDuration(s: string): number {
  // M:SS or M:SS.sss
  const colon = s.indexOf(":");
  if (colon < 0) return NaN;
  const minutes = parseInt(s.slice(0, colon), 10);
  const seconds = parseFloat(s.slice(colon + 1));
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return NaN;
  return minutes * 60 + seconds;
}

export function parseSonglengths(text: string): SonglengthsIndex {
  const idx: SonglengthsIndex = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const md5 = line.slice(0, eq).toLowerCase();
    const lengths = line
      .slice(eq + 1)
      .split(/\s+/)
      .filter(Boolean)
      .map(parseDuration)
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (lengths.length === 0) continue;
    idx.set(md5, lengths);
  }
  return idx;
}
