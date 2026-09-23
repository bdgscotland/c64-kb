/** Text helpers for the source lints: comment stripping, number parsing, language detection. */

import type { LintLanguage } from "./types.ts";

const MNEMONIC_LINE =
  /^\s*(?:[\w.@!+-]+:\s*)?(lda|ldx|ldy|sta|stx|sty|jsr|jmp|rts|rti|sei|cli|inc|dec|inx|iny|dex|dey|cmp|cpx|cpy|bne|beq|bcc|bcs|bpl|bmi|bvc|bvs|adc|sbc|and|ora|eor|asl|lsr|rol|ror|bit|pha|pla|php|plp|tax|tay|txa|tya|tsx|txs|nop|brk|sed|cld|sec|clc|clv)\b(?=\s*$|\s+[^=\s])/i;

const ASM_DIRECTIVE =
  /^\s*(\.pc\b|\.(for|while|byte|word|fill|var|const|text|encoding|import|macro|label)\b|!byte\b|!word\b|!fill\b|!zone\b|\.org\b|\.byt\b)/m;

const C_STATEMENT =
  /(^|[^.\w])(void|int|char|unsigned|struct|while|for|if|return|switch|case|byte|word)\b[^;\n]*[;{(:]/;

/** Assembler signatures, tested on comment-stripped text before the C shape test. */
function looksLikeAsm(asmText: string): boolean {
  return /^\s*\*\s*=/m.test(asmText) || ASM_DIRECTIVE.test(asmText) || /\bBasicUpstart2?\s*\(/.test(asmText);
}

/** C by statement shape: a `;`-terminated line and either a C keyword statement or a bare call/assignment. */
function looksLikeC(cText: string): boolean {
  const terminated = /;\s*(\}|$)/m.test(cText);
  if (!terminated) return false;
  if (C_STATEMENT.test(cText)) return true;
  // Bare statements: a call or an assignment ending in `;`.
  return /^\s*[\w.>[\]-]+\s*(\([^;]*\)|=[^=][^;]*)\s*;/m.test(cText);
}

/**
 * Detect the language from the text when the caller does not say.
 * Comments are stripped first, so a `//` comment ending in `;` or a
 * `for` inside a KickAssembler `.for` cannot make an assembler listing
 * read as C. Assembler signatures are tested before the C shape test.
 */
export function detectLanguage(source: string): LintLanguage {
  if (/^\s*#\s*(include|define|pragma|assign|repeat|embed|ifdef|ifndef)\b/m.test(source)) return "c";
  const asmText = stripAsm(source);
  if (looksLikeAsm(asmText)) return "asm";
  const cText = stripC(source);
  if (/__asm\s*\{/.test(cText)) return "c";
  const mnemonicLines = asmText.split("\n").filter((l) => MNEMONIC_LINE.test(l)).length;
  if (mnemonicLines >= 3) return "asm";
  return looksLikeC(cText) ? "c" : "asm";
}

type Token = { text: string; next: number };

function blockComment(source: string, i: number): Token {
  const end = source.indexOf("*/", i + 2);
  const stop = end < 0 ? source.length : end + 2;
  return { text: source.slice(i, stop).replace(/[^\n]/g, " "), next: stop };
}

function lineComment(source: string, i: number): Token {
  let j = i;
  while (j < source.length && source.charAt(j) !== "\n") j++;
  return { text: " ".repeat(j - i), next: j };
}

function quoted(source: string, i: number, quote: string): Token {
  const n = source.length;
  let j = i + 1;
  while (j < n && source.charAt(j) !== quote && source.charAt(j) !== "\n") {
    if (source.charAt(j) === "\\") j++;
    j++;
  }
  const stop = Math.min(n, j + 1);
  // keep the quotes so an empty string is still recognisable as ""
  return { text: quote + " ".repeat(Math.max(0, stop - i - 2)) + (stop - i >= 2 ? quote : ""), next: stop };
}

function cToken(source: string, i: number): Token {
  const c = source.charAt(i);
  const d = source.charAt(i + 1);
  if (c === "/" && d === "*") return blockComment(source, i);
  if (c === "/" && d === "/") return lineComment(source, i);
  if (c === '"' || c === "'") return quoted(source, i, c);
  return { text: c, next: i + 1 };
}

/**
 * Blank out comments and string literals in C while keeping every line
 * break, so line numbers survive and a `sid.` inside a comment or a
 * string is never matched.
 */
export function stripC(source: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const t = cToken(source, i);
    out.push(t.text);
    i = t.next;
  }
  return out.join("");
}

/** Blank out `;` and `//` comments in assembly, keeping line breaks. */
export function stripAsm(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      let cut = line.length;
      const a = line.indexOf(";");
      const b = line.indexOf("//");
      if (a >= 0) cut = Math.min(cut, a);
      if (b >= 0) cut = Math.min(cut, b);
      return line.slice(0, cut);
    })
    .join("\n");
}

export function parseNumber(tok: string): number | null {
  const t = tok.trim();
  if (/^\$[0-9a-f]+$/i.test(t)) return parseInt(t.slice(1), 16);
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
  if (/^%[01]+$/.test(t)) return parseInt(t.slice(1), 2);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  return null;
}

export function isZero(tok: string): boolean {
  return parseNumber(tok) === 0;
}

export function hex4(v: number): string {
  return v.toString(16).toUpperCase().padStart(4, "0");
}
