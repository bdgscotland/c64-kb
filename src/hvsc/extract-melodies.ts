// NOTE: this tool shells out to the sid-stylometry research scripts,
// which are not part of the public KB distribution.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Finalizer step: extract real per-voice note-streams + parametric timbre from the
 * SID files and attach them to the matching VoicePart nodes (line_* properties). This
 * makes "store full melodies" part of the ingest itself rather than a manual back-fill.
 *
 * Implemented by spawning the parallel Python extractor (analyzer/.venv +
 * scripts/sid-stylometry/ingest-melodies.py), which enumerates Tunes straight from the
 * graph (hvsc_path is absolute) and upserts onto VoiceParts. `--skip-existing` makes
 * re-runs cheap (only new tunes), so it's idempotent like the other cluster passes.
 *
 * Guarded: only runs when the HVSC corpus is present (so unit tests / corpus-less envs
 * skip cleanly) and the python venv + script exist. Non-fatal — a failure warns rather
 * than aborting the whole ingest (the note-stream layer is additive).
 */
export function extractMelodiesInGraph(opts: { workers?: number; graph?: string } = {}): void {
  const cwd = process.cwd();
  const corpus = join(cwd, "data", "hvsc-corpus");
  const py = join(cwd, "analyzer", ".venv", "bin", "python");
  const script = join(cwd, "scripts", "sid-stylometry", "ingest-melodies.py");
  if (!existsSync(corpus)) {
    console.warn("[clusterAll] HVSC corpus not present — skipping melody/timbre extraction");
    return;
  }
  if (!existsSync(py) || !existsSync(script)) {
    console.warn("[clusterAll] python venv or ingest-melodies.py missing — skipping melody/timbre extraction");
    return;
  }
  const args = [script, "--skip-existing", "--workers", String(opts.workers ?? 8)];
  if (opts.graph) args.push("--graph", opts.graph);
  console.log(`[clusterAll] extracting note-streams + timbre (${args.join(" ")})`);
  const res = spawnSync(py, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      GSETTINGS_SCHEMA_DIR:
        process.env.GSETTINGS_SCHEMA_DIR ?? "/opt/homebrew/share/glib-2.0/schemas",
    },
  });
  if (res.status !== 0) {
    console.warn(`[clusterAll] melody/timbre extraction exited ${res.status} — note-streams may be incomplete`);
  }
}
