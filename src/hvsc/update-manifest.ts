/**
 * Parser for HVSC's Update_XX.hvs (also UpdateXX.hvs) per-release manifests.
 *
 * Format observations (from Update84.hvs and surrounding releases):
 *   - ISO-8859-1 encoded, CRLF line endings
 *   - Comment lines start with `#`; blank lines are separators
 *   - Header comments give release date: `# Date: December 25, 2025`
 *   - Section keywords are bare uppercase words on their own line:
 *       REPLACE   — files with fixed/better content replacing existing SIDs
 *       MOVE      — either new tunes arriving OR files being relocated
 *       DELETE    — files/dirs removed from the collection
 *       CREDITS / TITLE / AUTHOR / RELEASED / ... — metadata correction
 *         blocks (ignored for delta purposes)
 *   - A MOVE block is "new tunes" when the source path starts with
 *     `/update/new/`.  It is a "relocation" when both paths are canonical
 *     (no `/update/` prefix).
 *   - REPLACE source paths start with `/update/fix/`.
 *   - Pairs of consecutive paths form (source, destination):
 *       2-line pair: source\ndest  — simple rename / new-in-dir
 *       4-line group (rename + keep-old): old\nnew\nnew\nold — used to
 *         update STIL references; treat the first two lines as (from, to).
 *   - MOVE pairs where source is `/update/new/...` describe new file batches
 *     landing in a destination directory.  The individual filenames are
 *     listed only in comments above the pair, not in structured form.
 *   - DELETE paths that start with `/update/` are housekeeping for the
 *     staging tree, not real corpus deletions; they are skipped.
 *   - Paths ending in `/` are directories; directory entries are kept when
 *     they are real corpus paths (useful for the orchestrator to detect
 *     whole-directory moves).
 *
 * Returns ParsedUpdateManifest with categorised UpdateAction records.
 * Lossy is acceptable — the goal is sanity-checking against a file-presence
 * diff, not perfectly reproducing the HVSC shell script.
 */

export interface UpdateAction {
  /** Canonical HVSC path, e.g. /MUSICIANS/H/Hubbard_Rob/Flash_Gordon.sid */
  hvsc_path: string;
  kind: "new" | "changed" | "moved" | "removed";
  /** Populated only when kind === "moved": the old path before relocation */
  moved_from?: string;
}

export interface ParsedUpdateManifest {
  /** Numeric part of the filename, e.g. 84 for Update84.hvs */
  release_number: number;
  /** Best-effort extraction from the `# Date:` header, e.g. "December 25, 2025" */
  release_date?: string;
  actions: UpdateAction[];
}

/** Section keywords that matter for delta tracking */
type Section = "replace" | "move" | "delete" | "credits" | "other";

function classifySection(keyword: string): Section {
  switch (keyword.trim().toUpperCase()) {
    case "REPLACE":
      return "replace";
    case "MOVE":
      return "move";
    case "DELETE":
      return "delete";
    case "CREDITS":
    case "TITLE":
    case "AUTHOR":
    case "RELEASED":
    case "SONGS":
    case "SPEED":
    case "INITPLAY":
    case "FLAGS":
    case "CLOCK":
    case "SIDMODEL":
    case "FREEPAGES":
    case "FIXLOAD":
      return "credits";
    default:
      return "other";
  }
}

/**
 * Returns true if a line looks like an HVSC path (starts with `/`).
 * Paths may end in `/` (directory) or `.sid` (file).
 */
function isPath(line: string): boolean {
  return line.startsWith("/");
}

/**
 * Returns true when a path is a staging path — used internally by the HVSC
 * update script but not a real corpus path.  Staging paths begin with
 * `/update/`, `/DOCUMENTS/Songlengths.txt` does not.
 */
function isStagingPath(p: string): boolean {
  return p.startsWith("/update/");
}

export function parseUpdateManifest(
  text: string,
  release_number: number
): ParsedUpdateManifest {
  // Normalise CRLF → LF, then split
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  let release_date: string | undefined;
  const actions: UpdateAction[] = [];

  let section: Section = "other";

  // Collect consecutive path lines into runs; reset on blank/comment lines.
  let pathRun: string[] = [];

  const flushRun = () => {
    if (pathRun.length === 0) return;
    processPaths(pathRun, section, actions);
    pathRun = [];
  };

  for (const raw of lines) {
    const line = raw.trim();

    // --- comment lines ---
    if (line.startsWith("#")) {
      // Extract date from header
      const dateMatch = line.match(/^#\s*Date:\s*(.+)$/i);
      if (dateMatch) {
        release_date = dateMatch[1].trim();
      }
      // Comments break path runs
      flushRun();
      continue;
    }

    // --- blank lines ---
    if (line === "") {
      flushRun();
      continue;
    }

    // --- section keyword? ---
    // A keyword is an all-uppercase token alone on its line (no `/` prefix)
    if (!isPath(line) && /^[A-Z][A-Z0-9_,.\-\s]*$/.test(line)) {
      flushRun();
      const classified = classifySection(line.split(/\s/)[0]);
      if (classified !== "other") {
        section = classified;
      }
      // Reset to "other" on unrecognised tokens so we don't misparse
      // credit data (author names, release years, etc.) as paths
      continue;
    }

    // --- path line ---
    if (isPath(line)) {
      // If we're in a credits/other section, ignore paths (they are SID
      // files being credit-fixed, not structural changes)
      if (section === "credits" || section === "other") {
        flushRun();
        continue;
      }
      pathRun.push(line);
    } else {
      // Non-path, non-comment, non-blank, non-keyword in a credits section:
      // part of a CREDITS record — ignore and break the run
      flushRun();
    }
  }

  flushRun();

  return { release_number, release_date, actions };
}

/**
 * Process a run of consecutive path lines under the current section and
 * push the appropriate UpdateAction records into `actions`.
 *
 * Run shapes observed in the wild:
 *
 *   REPLACE — pairs (source_staging, dest_dir):
 *     /update/fix/MUSICIANS/H/Hubbard_Rob/Flash_Gordon.sid
 *     /MUSICIANS/H/Hubbard_Rob/
 *
 *   MOVE (new) — pairs (staging_dir, dest_dir):
 *     /update/new/DEMOS/0-9/
 *     /DEMOS/0-9/
 *     → emit `new` for the destination directory
 *
 *   MOVE (rename, 2-line) — pairs (old_path, new_path):
 *     /MUSICIANS/B/Bordeaux/Hangmania.sid
 *     /MUSICIANS/B/Bordeaux/Hangmani.sid
 *     → emit `moved` (moved_from=old, hvsc_path=new)
 *
 *   MOVE (rename, 4-line) — STIL mirror pattern:
 *     /old/path.sid    ← original name (from)
 *     /new/path.sid    ← new name (to)
 *     /new/path.sid    ← repeated: STIL reference update
 *     /old/path.sid    ← repeated: old-name anchor
 *     → treat as (from=line[0], to=line[1]), emit `moved`
 *
 *   DELETE — individual paths, one per line:
 *     /DEMOS/A-F/C_C_S_Digihits.sid
 *     → emit `removed` (skip staging paths)
 */
function processPaths(
  run: string[],
  section: Section,
  actions: UpdateAction[]
): void {
  if (run.length === 0) return;

  if (section === "replace") {
    // Pairs: (staging_source, dest_dir)
    for (let i = 0; i + 1 < run.length; i += 2) {
      const src = run[i];
      const dest = run[i + 1];
      if (!isStagingPath(src)) {
        // Unexpected format — skip
        continue;
      }
      // Derive the canonical dest path: dest is a dir, filename from src
      const filename = src.split("/").pop() ?? "";
      const destPath = dest.endsWith("/")
        ? dest + filename
        : dest;
      if (destPath) {
        actions.push({ hvsc_path: destPath, kind: "changed" });
      }
    }
    return;
  }

  if (section === "move") {
    // Determine sub-mode from the first path
    const first = run[0];

    if (isStagingPath(first)) {
      // New-tunes mode: pairs (staging_dir, dest_dir)
      for (let i = 0; i + 1 < run.length; i += 2) {
        const dest = run[i + 1];
        if (!isStagingPath(dest)) {
          actions.push({ hvsc_path: dest, kind: "new" });
        }
      }
      return;
    }

    // Relocation mode.  Groups are 2 or 4 lines.
    let i = 0;
    while (i < run.length) {
      const a = run[i];
      const b = run[i + 1];
      if (b === undefined) {
        // Orphan path — skip
        i++;
        continue;
      }
      // Detect 4-line STIL mirror group: a b b a
      const c = run[i + 2];
      const d = run[i + 3];
      if (c !== undefined && d !== undefined && c === b && d === a) {
        // 4-line rename group
        actions.push({ hvsc_path: b, kind: "moved", moved_from: a });
        i += 4;
        continue;
      }
      // 2-line rename
      // Special case: directory-level relocation (both paths end with `/`)
      actions.push({ hvsc_path: b, kind: "moved", moved_from: a });
      i += 2;
    }
    return;
  }

  if (section === "delete") {
    for (const p of run) {
      if (!isStagingPath(p)) {
        actions.push({ hvsc_path: p, kind: "removed" });
      }
    }
    return;
  }
}
