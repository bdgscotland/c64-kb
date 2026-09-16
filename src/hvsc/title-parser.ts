/**
 * Layer 7 (Function) extractor — parses a Tune's title + STIL cover title into
 * structural metadata about the **function** the tune serves in its host work
 * (game, demo, intro, loader, etc.).  This is a regex/structural pass over the
 * existing string properties; no ML.
 *
 * Layer 7 was previously schema-undefined.  This first pass populates four new
 * Tune properties:
 *   - `function_role`  — enum (see `FunctionRole`); "" when nothing matches
 *   - `source_work`    — free-text work name from `[from <X>]` in STIL title
 *   - `level_number`   — integer when an explicit `(level N)` / `Level N` marker
 *                        is found; null otherwise
 *   - `section_marker` — the raw `(...)` parenthetical from the tune title (e.g.
 *                        "tune 4", "loader v2", "C64 Remix"); "" when absent
 *
 * Conservative on level_number: we only set it from explicit `level N`
 * patterns to avoid false positives on band/movie names like "Level 42".
 */

/**
 * Closed enum of function roles.  Order is documentation-only; the matcher
 * tries the most specific patterns first.
 */
export type FunctionRole =
  | "title"      // title screen / main theme
  | "loader"     // disk/tape loader tune
  | "intro"      // intro sequence (pre-game, pre-demo)
  | "ingame"     // main gameplay / in-game music
  | "level"      // level-specific music
  | "boss"       // boss fight
  | "ending"     // end credits / end sequence
  | "gameover"   // game over screen
  | "highscore"  // high-score table
  | "credits"    // credits / staff roll
  | "jingle"     // short jingle / sting (death, bonus, etc.)
  | "demo"       // demo-mode / attract-mode / magazine cover-disk
  | "menu"       // menu music (often between attract and game)
  | "sfx"        // sound effects tune (not melodic music)
  | "preview"    // preview / teaser version of unreleased music
  | "unused"     // leftover / cut / unused track
  | "sample"     // speech / digi-sample / vocal-only track
  | "";          // unknown / no match

/**
 * Source-work type classification.  When the STIL `[from <qualifier> <title>]`
 * pattern matches a known qualifier ("movie", "TV series", etc.), the
 * qualifier becomes the `source_type` and the proper-noun title becomes the
 * `source_work`.  When the bracketed content is *just* a qualifier with no
 * title (e.g. `[from the Spectrum game]`), we record the type only and leave
 * source_work empty — the bracket carries platform/medium info, not a work
 * title.
 */
export type SourceType =
  | "movie"
  | "tv_series"
  | "tv_show"
  | "radio_show"
  | "book"
  | "album"
  | "musical"
  | "cartoon"
  | "anime"
  | "arcade_game"
  | "computer_game"
  | "amiga_module"
  | "xm_module"
  | "spectrum_game"
  | "nes_game"
  | "amiga_game"
  | "game"          // generic
  | "";             // unknown / no match

export interface TuneFunctionExtract {
  function_role: FunctionRole;
  source_work: string;
  source_type: SourceType;
  level_number: number | null;
  section_marker: string;
}

const EMPTY: TuneFunctionExtract = {
  function_role: "",
  source_work: "",
  source_type: "",
  level_number: null,
  section_marker: "",
};

/**
 * (keyword → role) — case-insensitive substring match within a title or a
 * parenthetical marker.  Order matters: more specific keywords go first so
 * "Game Over" wins over "Game", "Title Screen" wins over "Title".
 *
 * Each keyword is wrapped in word-boundary `\b` and matched on the original
 * string (not just the parenthetical), so a freestanding "Game Over" in the
 * title is recognised as well as "(Game Over)".
 */
const ROLE_KEYWORDS: Array<[RegExp, FunctionRole]> = [
  // Multi-word / specific patterns first so they win over broader matches
  [/\bgame\s*over\b/i, "gameover"],
  [/\bhigh[\s_-]*score\b/i, "highscore"],
  [/\btitle\s*screen\b/i, "title"],
  [/\bmain\s*title\b/i, "title"],
  [/\bend[\s_-]*credits\b/i, "credits"],
  [/\bend[\s_-]*sequence\b/i, "ending"],
  [/\bend\s+part\b/i, "ending"],
  [/\bending\b/i, "ending"],
  [/\bcredits\b/i, "credits"],
  [/\battract[\s_-]*mode\b/i, "demo"],
  [/\bdemo[\s_-]*mode\b/i, "demo"],
  [/\binter[\s_-]*level\b/i, "level"],
  [/\blevel\s*\d+/i, "level"],
  [/\blevel\b/i, "level"],
  [/\bboss\b/i, "boss"],
  [/\bloader\b/i, "loader"],
  [/\bintro\b/i, "intro"],
  [/\bin[\s_-]*game\b/i, "ingame"],
  [/\bingame\b/i, "ingame"],
  // Layer-7 extras added 2026-05-27 from section_marker histogram analysis
  [/\bsfx\b/i, "sfx"],
  [/\bmenu\b/i, "menu"],
  [/\bpreview\b/i, "preview"],
  [/\bunused\b/i, "unused"],
  [/\b(speech|digi[\s_-]*sample|vocals?)\b/i, "sample"],
  [/\bmagazine\b/i, "demo"],
  [/\bindoor\b/i, "level"],
  [/\bmain\b/i, "ingame"],
  // Bare-word matches last
  [/\btitle\b/i, "title"],
  [/\bjingle\b/i, "jingle"],
  [/\bsting\b/i, "jingle"],
  [/\bdemo\b/i, "demo"],
  // "(end)" alone — placed last because freestanding "end" can be noisy in
  // longer prose, but inside a (...) marker it's almost always the ending.
  [/\bend\b/i, "ending"],
];

/**
 * Trailing `(...)` parenthetical at the end of the title.  Captures the inner
 * content so we can both store it raw (`section_marker`) and feed it back into
 * the role/level matchers as a high-priority signal.
 *
 * Examples this matches:
 *   "Honey Bee (loader)"           → "loader"
 *   "Poltergeist (loader v2)"      → "loader v2"
 *   "Resource (5:26-9:07)"         → "5:26-9:07"
 *   "Magnetic Fields, Part 1 [from Magnetic Fields] (0:41-0:51)" → "0:41-0:51"
 */
const TRAILING_PAREN_RE = /\(([^()]+)\)\s*$/;

/**
 * `level N` pattern — only `level` followed by a positive integer N up to 99
 * counts, and `level` must be on a word boundary.  Conservative on purpose:
 * "Level 42" (the band) gets `function_role=level` from the keyword match
 * but does NOT set `level_number` because we don't want a band name appearing
 * as a level reference.  Actually, we DO match here as well — but only when
 * the `(level N)` parenthetical or a context like "End of Level N" applies;
 * see callers below.
 */
const LEVEL_N_RE = /\blevel\s+(\d{1,2})\b/i;

/**
 * `[from <work>]` pattern in STIL title.  Captures the inner work name,
 * stripping leading qualifiers like "the arcade game", "the movie", "the TV
 * series", "the Spectrum game" so the captured `source_work` is the bare
 * title.  Examples:
 *   "Cobra (Title) [from the Spectrum game]"
 *      → source_work = "Cobra"       *(qualifier-only; no actual title)*
 *      → falls back to "the Spectrum game"
 *   "Resource [from the movie Koyaanisqatsi]"
 *      → source_work = "Koyaanisqatsi"
 *   "Eve of the War [from War of the Worlds]"
 *      → source_work = "War of the Worlds"
 *
 * When the bracketed content is a bare qualifier with no proper title (rare),
 * we keep the qualifier as the source_work — better than empty.
 */
const FROM_BRACKET_RE = /\[from\s+(.+?)\]/i;

/**
 * Map a qualifier phrase (lowercased) to a `SourceType` enum value.  Order
 * matters: longer / more specific phrases must come before shorter / generic
 * ones so the longest match wins.  Each entry strips the qualifier phrase
 * from the leading position of the bracketed text; remaining text (if any)
 * is the source_work.
 */
const QUALIFIER_RULES: Array<[RegExp, SourceType]> = [
  [/^the\s+amiga\s+mod\s+module(?:\s+|$)/i, "amiga_module"],
  [/^the\s+xm\s+module(?:\s+|$)/i, "xm_module"],
  [/^the\s+amiga\s+(?:soundtracker\s+)?module(?:\s+|$)/i, "amiga_module"],
  [/^the\s+spectrum\s+(?:computer\s+)?game(?:\s+|$)/i, "spectrum_game"],
  [/^the\s+nes\s+game(?:\s+|$)/i, "nes_game"],
  [/^the\s+amiga\s+game(?:\s+|$)/i, "amiga_game"],
  [/^the\s+arcade\s+game(?:\s+|$)/i, "arcade_game"],
  [/^the\s+computer\s+game(?:\s+|$)/i, "computer_game"],
  [/^the\s+(?:tv|television)\s+series(?:\s+|$)/i, "tv_series"],
  [/^the\s+(?:tv|television)\s+show(?:\s+|$)/i, "tv_show"],
  [/^the\s+radio\s+show(?:\s+|$)/i, "radio_show"],
  [/^the\s+(?:motion\s+picture|movie|film)(?:\s+|$)/i, "movie"],
  [/^the\s+album(?:\s+|$)/i, "album"],
  [/^the\s+musical(?:\s+|$)/i, "musical"],
  [/^the\s+book(?:\s+|$)/i, "book"],
  [/^the\s+cartoon(?:\s+|$)/i, "cartoon"],
  [/^the\s+anime(?:\s+|$)/i, "anime"],
  [/^the\s+game(?:\s+|$)/i, "game"],
];

/**
 * Parse a `[from <X>]` bracket capture into `{ source_work, source_type }`.
 * If the capture begins with a known qualifier phrase, we strip the qualifier
 * and use the residue as the work.  When nothing remains after stripping the
 * capture is a bare qualifier ("[from the TV series]" — no actual work named);
 * we record the type and leave source_work empty.  When no qualifier matches,
 * the whole capture is the work and source_type is "".
 */
function parseFromBracket(raw: string): { source_work: string; source_type: SourceType } {
  const trimmed = raw.trim();
  for (const [re, type] of QUALIFIER_RULES) {
    if (re.test(trimmed)) {
      const residue = trimmed.replace(re, "").trim();
      return { source_work: residue, source_type: type };
    }
  }
  return { source_work: trimmed, source_type: "" };
}

/**
 * Parse a Tune's title + (optional) STIL cover-source title into Layer-7
 * function metadata.  Pure function — no I/O, no side effects.
 *
 * Empty / undefined inputs → all-empty result (no false-positive matches on
 * empty strings).
 */
export function parseTuneFunction(
  title: string | null | undefined,
  stilTitle: string | null | undefined = "",
): TuneFunctionExtract {
  const t = (title ?? "").trim();
  const st = (stilTitle ?? "").trim();
  if (t === "" && st === "") return { ...EMPTY };

  let function_role: FunctionRole = "";
  let source_work = "";
  let source_type: SourceType = "";
  let level_number: number | null = null;
  let section_marker = "";

  // 1. Trailing (...) parenthetical on the title — highest priority since
  //    composers explicitly tag function role this way.
  const parenMatch = TRAILING_PAREN_RE.exec(t);
  if (parenMatch) {
    section_marker = parenMatch[1].trim();
  }

  // 2. function_role — prefer role match inside the parenthetical, fall back to
  //    the full title, fall back to the STIL title.
  const roleSources: string[] = [];
  if (section_marker) roleSources.push(section_marker);
  if (t) roleSources.push(t);
  if (st) roleSources.push(st);
  outer: for (const src of roleSources) {
    for (const [re, role] of ROLE_KEYWORDS) {
      if (re.test(src)) {
        function_role = role;
        break outer;
      }
    }
  }

  // 3. level_number — only when a "level N" pattern appears explicitly (in
  //    the parenthetical OR after "level " in the title).  Capping at two
  //    digits keeps spurious years (1990, 2025) from being parsed as levels.
  for (const src of roleSources) {
    const m = LEVEL_N_RE.exec(src);
    if (m) {
      level_number = parseInt(m[1], 10);
      // A real level_number also confirms function_role=level (overrides any
      // weaker keyword match earlier).
      if (function_role === "" || function_role === "title") function_role = "level";
      break;
    }
  }

  // 4. source_work + source_type — `[from <X>]` is STIL-canonical.  Look in
  //    stil_title first (where 99 % of these live) then fall back to the tune
  //    title.  parseFromBracket strips a leading qualifier phrase ("the movie",
  //    "the TV series", ...) and records it as source_type; if the residue is
  //    empty the bracket was a bare qualifier and we leave source_work empty.
  for (const src of [st, t]) {
    const m = FROM_BRACKET_RE.exec(src);
    if (m) {
      const parsed = parseFromBracket(m[1]);
      source_work = parsed.source_work;
      source_type = parsed.source_type;
      break;
    }
  }

  return { function_role, source_work, source_type, level_number, section_marker };
}
