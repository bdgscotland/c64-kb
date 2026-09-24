/**
 * Where a single-doc ingest reads and writes a page, and the one source
 * name it is stored under. A caller may name the page relative to the
 * working directory (`docs/workflow/agent-harness.md` from the repo root),
 * relative to the repo root, relative to docs/ (`workflow/agent-harness.md`)
 * or absolutely; all four name the same file and the same source. Issue
 * #51: the path used to be joined to docs/ unconditionally, so the first
 * spelling wrote a second copy at docs/docs/... and ingested it as a
 * second source.
 */

import fs from "fs";
import path from "path";

export interface DocLocation {
  /** Absolute path of the page inside the docs directory. */
  file: string;
  /** The page's path below docs/, with forward slashes: the source name in both stores. */
  source: string;
}

function inside(file: string, docsDir: string): boolean {
  return file.startsWith(docsDir + path.sep);
}

/**
 * Resolve a caller-supplied path to a page inside `docsDir`, or null when
 * no reading of it lands there or it names an existing file outside
 * docs/ from the working directory. Candidates are tried in order (working
 * directory, repo root, docs/); the first that exists wins, else the
 * first that is inside docs/ (a new page).
 */
export function locateDoc(docPath: string, docsDir: string, cwd: string = process.cwd()): DocLocation | null {
  const clean = docPath.replace(/\0/g, "");
  if (clean.trim() === "") return null;
  const root = path.resolve(docsDir);
  // A file that exists where the caller stands, outside docs/, is what they meant: refuse it.
  const here = path.resolve(cwd, clean);
  if (!inside(here, root) && fs.existsSync(here)) return null;
  const candidates = [cwd, path.dirname(root), root]
    .map((base) => path.resolve(base, clean))
    .filter((file) => inside(file, root));
  const file = candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
  if (file === undefined) return null;
  return { file, source: path.relative(root, file).split(path.sep).join("/") };
}
