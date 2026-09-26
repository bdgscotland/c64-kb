/**
 * A technique page's own pitfalls: the `### Pitfalls` (or `### Pitfalls
 * met`, or bold `**Pitfalls.**`) section under its `## name — Title`
 * heading. They are prose on the page, not Pitfall nodes, so the graph
 * never held them and pitfallsFor answered facing_turn_step with three
 * `$DC00` pitfalls of other techniques and none of its own four
 * (KB-GAPS 19, FIREBASE build).
 */

import fs from "node:fs";
import path from "node:path";

const H2 = /^##\s+([a-z][a-z0-9_]*)\s+(?:—|--)\s+/;
const SECTION_HEADING = /^###\s+Pitfalls(?:\s+met)?\s*$/i;
const BOLD_HEADING = /^\*\*Pitfalls[.:]?\*\*\s*$/i;
// A line that is only bold text ("**When not to use it.**") heads a
// paragraph section of the bold form.
const BOLD_ONLY = /^\*\*[^*]+\*\*\s*$/;
const BULLET = /^(?:[-*]|\d+\.)\s+/;

/** The lines under the technique's H2, up to the next H2; null when the page has no such heading. */
function techniqueBody(markdown: string, name: string): string[] | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => H2.exec(l)?.[1] === name);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

/** The lines of the pitfalls section in a technique body; empty when it has none. */
function pitfallLines(body: string[]): string[] {
  const at = body.findIndex((l) => SECTION_HEADING.test(l) || BOLD_HEADING.test(l));
  if (at < 0) return [];
  const bold = BOLD_HEADING.test(body[at] ?? "");
  const rest = body.slice(at + 1);
  const end = rest.findIndex((l) => /^#{2,3}\s/.test(l) || (bold && BOLD_ONLY.test(l)));
  return end < 0 ? rest : rest.slice(0, end);
}

/** One item per bullet, or per paragraph where there are no bullets; wrapped lines joined with a space. */
export function sectionItems(text: string): string[] {
  const items: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) items.push(current.join(" "));
    current = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") flush();
    else if (BULLET.test(line)) {
      flush();
      current.push(line.replace(BULLET, ""));
    } else current.push(line);
  }
  flush();
  return items;
}

/** The technique's own pitfalls on this page; null when the page has no heading for it, [] when it has no section. */
export function pagePitfalls(markdown: string, name: string): string[] | null {
  const body = techniqueBody(markdown, name);
  return body === null ? null : sectionItems(pitfallLines(body).join("\n"));
}

// Page text by path, kept while its mtime holds: a briefing asks for every
// proposed technique, and each ask scans every technique page.
const pageCache = new Map<string, { mtimeMs: number; text: string }>();

function readPage(file: string): string {
  const { mtimeMs } = fs.statSync(file);
  const hit = pageCache.get(file);
  if (hit?.mtimeMs === mtimeMs) return hit.text;
  const text = fs.readFileSync(file, "utf-8");
  pageCache.set(file, { mtimeMs, text });
  return text;
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err.code === "ENOENT" || err.code === "ENOTDIR");
}

/**
 * The technique's page under `docs/techniques/` and its own pitfalls, or
 * null when no page there holds its heading. `source` is relative to the
 * docs directory, as a chunk's source is.
 */
export function techniquePagePitfalls(
  docsDir: string,
  name: string,
): { source: string; items: string[] } | null {
  const dir = path.join(docsDir, "techniques");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  for (const file of files.sort()) {
    const items = pagePitfalls(readPage(path.join(dir, file)), name);
    if (items !== null) return { source: `techniques/${file}`, items };
  }
  return null;
}
