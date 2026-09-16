/**
 * Parser for HVSC's STIL.txt (SID Tune Information List).
 *
 * Real STIL.txt format (v84, confirmed against disk):
 *   - Entry headers are bare `/<path>` lines (e.g. `/MUSICIANS/H/Hubbard_Rob/Commando.sid`)
 *     — NOT `# /path` as some docs suggest. Lines starting with `#` are section markers
 *     or preamble comments and are skipped.
 *   - Fields have 0–3 leading spaces before the field name. `COMMENT:` frequently
 *     appears at column 0 with no leading space.
 *   - Multi-line COMMENT continuations are indented with 9 spaces.
 *   - Sub-tune scoping markers `(#N)` appear at column 0 (no leading whitespace).
 *     N is 1-indexed in STIL; we store them as 0-indexed subtune keys
 *     so (#1) → ":0", (#2) → ":1", matching our extractor's subtune numbering.
 *   - Multiple AUTHOR lines per entry/subtune → separate composer credits.
 *   - ARTIST → role "artist".
 *   - Comment text is capped at 2 KB per entry for graph property hygiene.
 *
 * Returns a Map keyed by "<hvsc_path>:<subtune_index>" (0-indexed).
 * File-level fields (before any (#N) marker) are stored at subtune index 0.
 * When (#1) is seen it also maps to subtune index 0 (first subtune).
 */

export interface StilCredit {
  name: string;
  role: "composer" | "artist" | "arranger" | "cover-of" | "sample-credit" | "other";
}

/**
 * A cover-of style relation extracted from a STIL COMMENT, e.g.
 *   "Remix of /MUSICIANS/H/Hubbard_Rob/Commando.sid" → { kind: "REMIX", target_path }
 * The target_path is the raw HVSC path as it appears in the COMMENT; the consumer
 * resolves it against existing Tune nodes.  Multiple relations per entry are
 * common (e.g. a "version of X" comment that also mentions "based on Y").
 */
export interface StilCoverRelation {
  kind:
    | "REMIX"
    | "EDIT"
    | "COVER"
    | "VERSION"
    | "CONVERSION"
    | "HACK"
    | "ARRANGEMENT"
    | "BASED_ON"
    | "SAME_AS";
  target_path: string;
}

export interface StilEntry {
  hvsc_path: string;
  subtune_index: number;
  title?: string;
  name?: string;
  comment?: string;
  credits: StilCredit[];
  cover_relations: StilCoverRelation[];
}

export type StilIndex = Map<string, StilEntry>;

const COMMENT_CAP_BYTES = 2048;

/**
 * Verb-to-canonical-kind map for cover-of relations.  All matching is
 * case-insensitive.  Multi-word verbs ("based on", "same as") come BEFORE
 * single-word verbs that could absorb them as a prefix; the regex below
 * uses an alternation in this order so the longest match wins.
 */
const COVER_VERB_KINDS: Array<[RegExp, StilCoverRelation["kind"]]> = [
  [/\bsame\s+as\b/i, "SAME_AS"],
  [/\bbased\s+on\b/i, "BASED_ON"],
  [/\bremix(?:ed)?\b/i, "REMIX"],
  [/\bedit(?:ed)?\b/i, "EDIT"],
  [/\bcover(?:ed)?\b/i, "COVER"],
  [/\bconversions?\b/i, "CONVERSION"],
  [/\barrangement\b|\barranged\b/i, "ARRANGEMENT"],
  [/\bhack\b/i, "HACK"],
  [/\bversion\b/i, "VERSION"],
];

/**
 * Regex to find an HVSC path inside a COMMENT.  We look for /SECTION/... .sid
 * with SECTION ∈ {MUSICIANS, DEMOS, GAMES} — the three top-level HVSC sections
 * the corpus uses.  The path captures everything up to and including `.sid`,
 * stopping at whitespace or a sentence-ending punctuation that would not be
 * part of a real path.
 */
const HVSC_PATH_RE = /\/(MUSICIANS|DEMOS|GAMES)\/[A-Za-z0-9_\-\/.]+\.sid/g;

/**
 * Extract cover-of relations from a COMMENT string.  We look for an HVSC path
 * mention and the closest preceding cover-verb within the same sentence (split
 * on `. `, `; `, newline, or sentence start).  Plain path mentions with no
 * matching verb are skipped — they're usually generic cross-references, not
 * cover assertions.  Returns deduped relations.
 */
function extractCoverRelations(comment: string): StilCoverRelation[] {
  const found: StilCoverRelation[] = [];
  const seen = new Set<string>();
  HVSC_PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HVSC_PATH_RE.exec(comment)) !== null) {
    const target_path = m[0];
    // Window: characters from the start of this clause/sentence up to the path.
    const start = m.index;
    let clauseStart = 0;
    for (let i = start - 1; i >= 0; i--) {
      const c = comment[i];
      // End-of-clause markers walking backwards: `. ` `; ` newline
      if (c === "\n") { clauseStart = i + 1; break; }
      if ((c === "." || c === ";") && comment[i + 1] === " ") { clauseStart = i + 2; break; }
    }
    const window = comment.slice(clauseStart, start);
    let kind: StilCoverRelation["kind"] | null = null;
    for (const [re, k] of COVER_VERB_KINDS) {
      if (re.test(window)) { kind = k; break; }
    }
    if (kind === null) continue;
    const key = `${kind}::${target_path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ kind, target_path });
  }
  return found;
}

function entryKey(hvsc_path: string, subtune_index: number): string {
  return `${hvsc_path}:${subtune_index}`;
}

function makeEntry(hvsc_path: string, subtune_index: number): StilEntry {
  return { hvsc_path, subtune_index, credits: [], cover_relations: [] };
}

function appendComment(entry: StilEntry, text: string): void {
  if (!entry.comment) {
    entry.comment = text;
  } else {
    entry.comment += " " + text;
  }
  if (entry.comment.length > COMMENT_CAP_BYTES) {
    entry.comment = entry.comment.slice(0, COMMENT_CAP_BYTES - 1) + "…";
  }
}

export function parseSTIL(text: string): StilIndex {
  const idx: StilIndex = new Map();

  let currentPath: string | null = null;
  // subtune index 0 = file-level fields (before any (#N)) or (#1) which is the first subtune
  let currentSubtune = 0;
  let lastField: "comment" | null = null;

  const getOrCreate = (): StilEntry => {
    const key = entryKey(currentPath!, currentSubtune);
    let entry = idx.get(key);
    if (!entry) {
      entry = makeEntry(currentPath!, currentSubtune);
      idx.set(key, entry);
    }
    return entry;
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");

    // Entry header: bare `/path` line (starts with `/`, not a section marker)
    // Must start with exactly `/` followed by a non-space character.
    if (line.startsWith("/") && line.length > 1 && line[1] !== " ") {
      currentPath = line.trim();
      currentSubtune = 0;
      lastField = null;
      // Ensure the root entry exists even if no fields follow
      getOrCreate();
      continue;
    }

    // Skip lines that start with `#` (preamble, section headers like `### /DEMOS/ ###`)
    if (line.startsWith("#")) {
      continue;
    }

    // No current path → still in preamble
    if (!currentPath) continue;

    // Subtune marker: `(#N)` at column 0 (or with minimal leading whitespace)
    // Real format has no leading whitespace on these lines.
    const subtuneMatch = line.match(/^\s*\(#(\d+)\)\s*$/);
    if (subtuneMatch) {
      const oneIndexed = parseInt(subtuneMatch[1], 10);
      // STIL (#1) = first subtune = our index 0; (#2) = index 1; etc.
      currentSubtune = Math.max(0, oneIndexed - 1);
      lastField = null;
      getOrCreate();
      continue;
    }

    // Blank line — close any open continuation
    if (line.trim() === "") {
      lastField = null;
      continue;
    }

    // Field lines: optional leading spaces, then FIELDNAME: value
    // Field name is all uppercase letters (and hyphens/underscores for e.g. SAMPLED-FROM).
    // We match with zero-to-many leading spaces before the uppercase field name.
    const fieldMatch = line.match(/^(\s*)([A-Z][A-Z_-]*):\s*(.*)$/);
    if (fieldMatch) {
      const fieldName = fieldMatch[2];
      const value = fieldMatch[3].trim();
      const entry = getOrCreate();
      switch (fieldName) {
        case "TITLE":
          entry.title = value;
          lastField = null;
          break;
        case "NAME":
          entry.name = value;
          lastField = null;
          break;
        case "AUTHOR":
          entry.credits.push({ name: value, role: "composer" });
          lastField = null;
          break;
        case "ARTIST":
          entry.credits.push({ name: value, role: "artist" });
          lastField = null;
          break;
        case "COMMENT":
          appendComment(entry, value);
          lastField = "comment";
          break;
        default:
          lastField = null;
          break;
      }
      continue;
    }

    // Continuation of a multi-line COMMENT: indented line (9 spaces in real STIL),
    // not matching a field pattern. Only continue if we're in an active COMMENT.
    if (lastField === "comment" && line.match(/^\s+\S/)) {
      appendComment(getOrCreate(), line.trim());
      continue;
    }

    // Unrecognised line — close continuation
    lastField = null;
  }

  // Post-pass: for every entry that has a COMMENT, extract cover-of relations
  // from the COMMENT text.  We do this after the fact (rather than per-line)
  // because COMMENT continuation lines are joined first, and the verb+path can
  // span line boundaries in real STIL entries.
  for (const entry of idx.values()) {
    if (entry.comment) {
      entry.cover_relations = extractCoverRelations(entry.comment);
    }
  }

  return idx;
}
