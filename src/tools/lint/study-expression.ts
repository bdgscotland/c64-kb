/**
 * Lint rule for kind:studied game-design pages (study_expression).
 *
 * Four checks on any page with frontmatter `kind: studied`:
 *   1. Fenced code blocks containing 6502 mnemonics are refused.
 *   2. Any $-prefixed hex run of 16+ $XX bytes is refused.
 *   3. Any bare hex run of 16+ two-digit tokens (without $) with at least
 *      one token containing a letter a–f is refused.
 *   4. When the caller supplies the game's binary, any hex run ($-prefixed
 *      or bare) of 8+ bytes that appears verbatim in the image is refused.
 *
 * Checks 2–4 cover the full page (including fenced blocks): study pages
 * carry no listings. When a fence is already flagged by the mnemonic rule
 * (check 1), checks 2–4 are suppressed for content inside that fence to
 * avoid reporting the same fence twice.
 *
 * Rule: study_expression
 * Page: docs/game-design/reference-game-sources.md
 */

import type { LintFinding } from "./types.ts";

const STUDY_EXPRESSION_RULE = "study_expression";
const PAGE = "docs/game-design/reference-game-sources.md";

// ── frontmatter ──────────────────────────────────────────────────────────────

/** True when the page has `kind: studied` in its YAML frontmatter. */
export function isStudiedPage(text: string): boolean {
  return /^---\r?\n(?:[\s\S]*?\r?\n)?kind:\s*studied\s*\r?\n/.test(text);
}

/** The sha1 and session path from the **Studied from:** line, or null. */
export function parseStudiedFromLine(text: string): { sha1: string; session: string } | null {
  const m = /^\*\*Studied from:\*\*\s+[^;]+;\s*image\s+sha1=([0-9a-fA-F]{40})\s*;\s*session\s+(\S+)/m.exec(
    text,
  );
  if (!m) return null;
  const sha1 = m[1];
  const session = m[2];
  if (!sha1 || !session) return null;
  return { sha1, session };
}

// ── fenced-block detection ────────────────────────────────────────────────────

const FENCE_MARKER = /^(`{3,}|~{3,})\s*([\w+-]*)$/;

interface FenceBlock {
  /** 0-based line index of the opening fence marker. */
  openLine: number;
  content: string[];
}

function findFencedBlocks(text: string): FenceBlock[] {
  const allLines = text.split("\n");
  const blocks: FenceBlock[] = [];
  let open: { marker: string; openLine: number } | null = null;

  for (let i = 0; i < allLines.length; i++) {
    const m = FENCE_MARKER.exec((allLines[i] ?? "").trimEnd());
    if (!m) continue;
    const marker = m[1] ?? "";
    const info = m[2] ?? "";
    if (open === null) {
      open = { marker, openLine: i };
    } else if (
      marker.startsWith(open.marker.charAt(0)) &&
      marker.length >= open.marker.length &&
      info === ""
    ) {
      blocks.push({ openLine: open.openLine, content: allLines.slice(open.openLine + 1, i) });
      open = null;
    }
  }
  return blocks;
}

// ── mnemonic detection ────────────────────────────────────────────────────────

const MNEMONICS =
  "lda|ldx|ldy|sta|stx|sty|jsr|jmp|rts|rti|sei|cli|inc|dec|inx|iny|dex|dey|cmp|cpx|cpy|bne|beq|bcc|bcs|bpl|bmi|bvc|bvs|adc|sbc|and|ora|eor|asl|lsr|rol|ror|bit|pha|pla|php|plp|tax|tay|txa|tya|tsx|txs|nop|brk|sed|cld|sec|clc|clv";

/**
 * A line of standard assembly: optional label, then a 6502 mnemonic,
 * followed by end-of-line or an operand. The lookahead excludes bare
 * assignments (`and = 5`) while accepting implied-mode instructions.
 */
const ASM_LINE = new RegExp(String.raw`^\s*(?:[\w.@!+-]+:\s*)?(${MNEMONICS})\b(?=\s*$|\s+[^=\s])`, "i");

/**
 * A line of disassembly output: 4-digit hex address, one or more hex bytes,
 * then a 6502 mnemonic. Example: `0851  a9 36     lda #$36`.
 */
const DISASM_LINE = new RegExp(String.raw`^[0-9a-fA-F]{4}\s+(?:[0-9a-fA-F]{2}\s+)+(${MNEMONICS})\b`, "i");

/** Minimum mnemonic lines in a fence before it is refused. */
const MIN_MNEMONIC_LINES = 2;

function isMnemonicLine(l: string): boolean {
  return ASM_LINE.test(l) || DISASM_LINE.test(l);
}

function mnemonicLineCount(lines: string[]): number {
  return lines.filter(isMnemonicLine).length;
}

/**
 * 1-based line numbers of all lines (opening marker through closing marker)
 * belonging to fences whose content contains 2+ mnemonic lines. Byte-run
 * checks skip these lines to avoid double-reporting the same fence.
 */
function mnemonicFencedLines(text: string): Set<number> {
  const skip = new Set<number>();
  for (const block of findFencedBlocks(text)) {
    if (mnemonicLineCount(block.content) < MIN_MNEMONIC_LINES) continue;
    // opening marker, all content lines, closing marker (1-based)
    const last = block.openLine + block.content.length + 2;
    for (let line = block.openLine + 1; line <= last; line++) skip.add(line);
  }
  return skip;
}

// ── $-prefixed hex run detection ──────────────────────────────────────────────

/**
 * A $XX hex byte: exactly 2 hex digits after $, not followed by a third.
 * Does NOT match 4-digit addresses like $C000: the negative lookahead
 * fails when a third hex digit immediately follows the second.
 */
const HEX_BYTE_RE = /\$[0-9a-fA-F]{2}(?![0-9a-fA-F])/g;

interface HexRun {
  startIndex: number;
  bytes: number[];
}

function findHexRuns(text: string): HexRun[] {
  const runs: HexRun[] = [];
  const re = new RegExp(HEX_BYTE_RE.source, "g");
  let current: HexRun | null = null;
  let prevEnd = 0;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const byteVal = parseInt(m[0].slice(1), 16);
    if (current !== null) {
      const gap = text.slice(prevEnd, m.index);
      if (/^[,\s]*$/.test(gap)) {
        current.bytes.push(byteVal);
      } else {
        runs.push(current);
        current = { startIndex: m.index, bytes: [byteVal] };
      }
    } else {
      current = { startIndex: m.index, bytes: [byteVal] };
    }
    prevEnd = m.index + m[0].length;
  }
  if (current !== null) runs.push(current);
  return runs;
}

// ── bare hex run detection ────────────────────────────────────────────────────

/**
 * A bare two-digit hex token: exactly 2 hex digits at a word boundary, not
 * preceded by $ (which the $-prefixed check already handles) and not
 * preceded by another hex digit (which would make it part of a 4-digit
 * address). Matches `a9`, `36`, `ff` but not `0850`, `$a9`, or `a936`.
 */
const BARE_HEX_BYTE_RE = /(?<!\$)(?<![0-9a-fA-F])\b[0-9a-fA-F]{2}\b(?![0-9a-fA-F])/g;

interface BareHexRun {
  startIndex: number;
  tokens: string[];
}

function findBareHexRuns(text: string): BareHexRun[] {
  const runs: BareHexRun[] = [];
  const re = new RegExp(BARE_HEX_BYTE_RE.source, "g");
  let current: BareHexRun | null = null;
  let prevEnd = 0;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[0];
    if (current !== null) {
      const gap = text.slice(prevEnd, m.index);
      if (/^[,\s]*$/.test(gap)) {
        current.tokens.push(tok);
      } else {
        runs.push(current);
        current = { startIndex: m.index, tokens: [tok] };
      }
    } else {
      current = { startIndex: m.index, tokens: [tok] };
    }
    prevEnd = m.index + tok.length;
  }
  if (current !== null) runs.push(current);
  return runs;
}

/** True when at least one token in the run contains a hex letter (a–f). */
function hasHexLetter(tokens: string[]): boolean {
  return tokens.some((t) => /[a-fA-F]/.test(t));
}

// ── image-match ───────────────────────────────────────────────────────────────

function bytesInImage(bytes: number[], image: Buffer): boolean {
  if (bytes.length === 0 || bytes.length > image.length) return false;
  const needle = Buffer.from(bytes);
  for (let i = 0; i <= image.length - needle.length; i++) {
    if (image.subarray(i, i + needle.length).equals(needle)) return true;
  }
  return false;
}

// ── line / excerpt helpers ────────────────────────────────────────────────────

/** 1-based line number of the character at `charIndex` in `text`. */
function lineNoOf(text: string, charIndex: number): number {
  let n = 1;
  for (let i = 0; i < charIndex && i < text.length; i++) {
    if (text[i] === "\n") n++;
  }
  return n;
}

function excerptAt(lines: string[], lineNo: number): string {
  return (lines[lineNo - 1] ?? "").trim().slice(0, 120);
}

interface RunArgs {
  text: string;
  lines: string[];
  startIndex: number;
  msg: string;
}

function hexRunFinding({ text, lines, startIndex, msg }: RunArgs): LintFinding {
  const lineNo = lineNoOf(text, startIndex);
  return {
    rule: STUDY_EXPRESSION_RULE,
    pitfall: STUDY_EXPRESSION_RULE,
    line: lineNo,
    excerpt: excerptAt(lines, lineNo),
    message: msg,
    page: PAGE,
    certainty: "definite",
  };
}

// ── check functions ───────────────────────────────────────────────────────────

interface StudyCtx {
  text: string;
  lines: string[];
  imageBytes: Buffer | null | undefined;
  /** 1-based line numbers inside mnemonic-flagged fences: byte-run checks skip them. */
  skip: Set<number>;
  findings: LintFinding[];
}

function checkFences(text: string, lines: string[], findings: LintFinding[]): void {
  for (const block of findFencedBlocks(text)) {
    const n = mnemonicLineCount(block.content);
    if (n < MIN_MNEMONIC_LINES) continue;
    const lineNo = block.openLine + 1;
    findings.push({
      rule: STUDY_EXPRESSION_RULE,
      pitfall: STUDY_EXPRESSION_RULE,
      line: lineNo,
      excerpt: excerptAt(lines, lineNo),
      message:
        `Fenced code block at line ${String(lineNo)} contains ${String(n)} line${n === 1 ? "" : "s"} of 6502 mnemonics. ` +
        `A study page holds addresses and measurements, not the game's disassembly. ` +
        `Remove the block; disassembly of a third-party game must not be committed.`,
      page: PAGE,
      certainty: "definite",
    });
  }
}

function checkDollarHexRuns(ctx: StudyCtx): void {
  for (const run of findHexRuns(ctx.text)) {
    const lineNo = lineNoOf(ctx.text, run.startIndex);
    if (ctx.skip.has(lineNo)) continue;
    const len = run.bytes.length;
    if (len >= 16) {
      ctx.findings.push(
        hexRunFinding({
          text: ctx.text,
          lines: ctx.lines,
          startIndex: run.startIndex,
          msg:
            `Hex run of ${String(len)} consecutive $XX bytes starting at line ${String(lineNo)}. ` +
            `A study page holds addresses and layouts, not code or data extracts. Remove the byte sequence.`,
        }),
      );
    } else if (len >= 8 && ctx.imageBytes != null && bytesInImage(run.bytes, ctx.imageBytes)) {
      ctx.findings.push(
        hexRunFinding({
          text: ctx.text,
          lines: ctx.lines,
          startIndex: run.startIndex,
          msg:
            `Hex run of ${String(len)} bytes at line ${String(lineNo)} appears verbatim in the game binary. ` +
            `Remove it: a study page holds measurements, not the game's code or data.`,
        }),
      );
    }
  }
}

function checkBareHexRuns(ctx: StudyCtx): void {
  for (const run of findBareHexRuns(ctx.text)) {
    const lineNo = lineNoOf(ctx.text, run.startIndex);
    if (ctx.skip.has(lineNo) || !hasHexLetter(run.tokens)) continue;
    const len = run.tokens.length;
    const bytes = run.tokens.map((t) => parseInt(t, 16));
    if (len >= 16) {
      ctx.findings.push(
        hexRunFinding({
          text: ctx.text,
          lines: ctx.lines,
          startIndex: run.startIndex,
          msg:
            `Bare hex run of ${String(len)} consecutive two-digit tokens starting at line ${String(lineNo)}. ` +
            `A study page holds addresses and layouts, not code or data extracts. Remove the byte sequence.`,
        }),
      );
    } else if (len >= 8 && ctx.imageBytes != null && bytesInImage(bytes, ctx.imageBytes)) {
      ctx.findings.push(
        hexRunFinding({
          text: ctx.text,
          lines: ctx.lines,
          startIndex: run.startIndex,
          msg:
            `Bare hex run of ${String(len)} bytes at line ${String(lineNo)} appears verbatim in the game binary. ` +
            `Remove it: a study page holds measurements, not the game's code or data.`,
        }),
      );
    }
  }
}

// ── main entry ────────────────────────────────────────────────────────────────

/**
 * Lint a studied page. Pass the game's binary as `imageBytes` to enable
 * the 8-byte image-match check; omit or pass null/undefined to skip it.
 *
 * Returns an empty array for pages that are not `kind: studied`.
 */
export function lintStudyExpression(text: string, imageBytes?: Buffer | null): LintFinding[] {
  if (!isStudiedPage(text)) return [];
  const findings: LintFinding[] = [];
  const ctx: StudyCtx = {
    text,
    lines: text.split("\n"),
    imageBytes,
    skip: mnemonicFencedLines(text),
    findings,
  };
  checkFences(text, ctx.lines, findings);
  checkDollarHexRuns(ctx);
  checkBareHexRuns(ctx);
  return findings;
}
