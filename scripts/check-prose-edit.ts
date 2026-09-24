#!/usr/bin/env node
/**
 * Checks that a prose-only edit of docs/ kept every fact. Compares each
 * changed page with its version at a git ref (default HEAD) and fails when:
 *
 *   - a fenced code block, a table row, a heading, a frontmatter line or a
 *     metadata line (`**Region:**`, `**Uses registers:**`, ...) changed;
 *   - a number, hex value, `code span`, link or capitalised term appears fewer
 *     times in the new prose than in the old.
 *
 * New tokens are allowed (a rewrite may spell out a unit). Moved text is
 * fine; removed facts are not.
 *
 *   node scripts/check-prose-edit.ts [--ref <git-ref>] [--allow-headings] [files...]
 *
 * With no files, checks every docs/**\/*.md that differs from the ref.
 * --allow-headings permits heading text changes (free-prose pages only; the
 * extractor reads headings on technique, pitfall, recipe and hardware pages).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const refIdx = argv.indexOf("--ref");
const ref = refIdx >= 0 ? (argv[refIdx + 1] ?? "HEAD") : "HEAD";
const allowHeadings = argv.includes("--allow-headings");
const named = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--ref");

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const files =
  named.length > 0
    ? named
    : git(["diff", "--name-only", ref, "--", "docs"])
        .split("\n")
        .filter((f) => f.endsWith(".md"));

const METADATA = /^\*\*[A-Z][^*]{0,60}:\*\*/;

interface Parts {
  fixed: string[]; // must be byte-identical, in order
  prose: string;
}

function split(text: string, keepHeadings: boolean): Parts {
  const fixed: string[] = [];
  const prose: string[] = [];
  let inFence = false;
  let fence: string[] = [];
  let inFront = false;
  text.split("\n").forEach((line, i) => {
    if (i === 0 && line === "---") {
      inFront = true;
      fixed.push(line);
      return;
    }
    if (inFront) {
      fixed.push(line);
      if (line === "---") inFront = false;
      return;
    }
    if (/^\s*```/.test(line)) {
      fence.push(line);
      if (inFence) {
        fixed.push(fence.join("\n"));
        fence = [];
      }
      inFence = !inFence;
      return;
    }
    if (inFence) {
      fence.push(line);
      return;
    }
    if (/^\s*\|/.test(line) || METADATA.test(line.trim()) || line.startsWith("<!--")) {
      fixed.push(line);
      return;
    }
    if (/^#{1,6} /.test(line)) {
      if (keepHeadings) fixed.push(line);
      prose.push(line.replace(/^#+ /, ""));
      return;
    }
    prose.push(line);
  });
  return { fixed, prose: prose.join("\n") };
}

/**
 * Facts a rewrite must not drop, counted: a number that appears three times
 * must still appear three times, so one changed occurrence is caught even
 * when the same number stands elsewhere on the page.
 */
function facts(prose: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (re: RegExp): void => {
    for (const m of prose.matchAll(re)) out.set(m[0], (out.get(m[0]) ?? 0) + 1);
  };
  add(/`[^`\n]+`/g); // code spans
  add(/https?:\/\/[^\s)>\]]+/g); // links
  add(/\]\([^)\s]+\)/g); // relative link targets
  add(/\$[0-9A-Fa-f]{2,4}\b/g); // hex addresses
  add(/\b0x[0-9A-Fa-f]+\b/g);
  add(/(?<![\w.])\d+(?:[.,]\d+)*(?:\.\d+)?%?/g); // numbers
  add(/\b[A-Z][A-Z0-9]{2,}\b/g); // acronyms, mnemonics, register names
  return out;
}

let failed = 0;
for (const f of files) {
  let before: string;
  try {
    before = git(["show", `${ref}:${f}`]);
  } catch {
    continue; // new file: nothing to preserve
  }
  const after = readFileSync(f, "utf8");
  const a = split(before, !allowHeadings);
  const b = split(after, !allowHeadings);
  const problems: string[] = [];
  if (a.fixed.length !== b.fixed.length) {
    problems.push(`fixed lines: ${a.fixed.length} before, ${b.fixed.length} after`);
  }
  a.fixed.forEach((line, i) => {
    if (b.fixed[i] !== line && problems.length < 12) {
      problems.push(`changed: ${line.slice(0, 100)}`);
    }
  });
  const kept = facts(b.prose);
  const lost = [...facts(a.prose)]
    .filter(([t, n]) => (kept.get(t) ?? 0) < n)
    .map(([t, n]) => (n > 1 ? `${t} (${String(kept.get(t) ?? 0)} of ${String(n)})` : t));
  if (lost.length > 0) problems.push(`facts missing from the prose: ${lost.slice(0, 20).join("  ")}`);
  const wa = a.prose.split(/\s+/).length;
  const wb = b.prose.split(/\s+/).length;
  if (problems.length > 0) {
    failed++;
    console.log(`FAIL ${f}`);
    for (const p of problems) console.log(`     ${p}`);
  } else {
    console.log(
      `ok   ${f}  prose ${wa} -> ${wb} words (${Math.round((100 * (wb - wa)) / Math.max(wa, 1))}%)`,
    );
  }
}
console.log(`\n${files.length - failed} kept every fact, ${failed} did not`);
process.exitCode = failed > 0 ? 1 : 0;
