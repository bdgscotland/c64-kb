/**
 * Operator CLI: HVSC ingest error histogram.
 *
 * Usage:
 *   npm run ingest:hvsc:errors                        # top-10 error_kind histogram
 *   npm run ingest:hvsc:errors -- --limit 20          # top-20 kinds
 *   npm run ingest:hvsc:errors -- --kind vsid_timeout # list MD5s for that kind
 */

import { join } from "node:path";
import { IngestStateStore } from "./hvsc/state-store.js";
import { HVSC_CACHE_DIR } from "./config.js";

const DB_PATH = join(HVSC_CACHE_DIR, "ingest-state.db");

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { kind: string | null; limit: number } {
  let kind: string | null = null;
  let limit = 10;

  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--kind" || argv[i] === "-k") && argv[i + 1]) {
      kind = argv[++i];
    } else if ((argv[i] === "--limit" || argv[i] === "-l") && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (!isNaN(n) && n > 0) limit = n;
    }
  }
  return { kind, limit };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const { kind, limit } = parseArgs(process.argv.slice(2));
  const store = new IngestStateStore(DB_PATH);

  if (kind !== null) {
    // List MD5s affected by a specific error kind.
    const md5s = store.md5sByErrorKind(kind, 100);
    if (md5s.length === 0) {
      console.log(`No rows with error_kind="${kind}"`);
    } else {
      console.log(`MD5s with error_kind="${kind}" (${md5s.length} shown, max 100):`);
      console.log("─".repeat(40));
      for (const md5 of md5s) {
        console.log(`  ${md5}`);
      }
    }
  } else {
    // Histogram of top-N error kinds.
    const rows = store.topErrorKinds(limit);
    if (rows.length === 0) {
      console.log("No error rows in the ingest state store.");
    } else {
      const maxCount = rows[0].count;
      const countWidth = String(maxCount).length;
      console.log(`Top ${limit} error kinds:`);
      console.log("─".repeat(50));
      for (const row of rows) {
        const label = (row.error_kind ?? "(null)") + ":";
        console.log(`  ${label.padEnd(30)} ${String(row.count).padStart(countWidth)}`);
      }
    }
  }

  store.close();
}

main();
