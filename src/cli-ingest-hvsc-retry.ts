/**
 * Operator CLI: requeue an error_transient cohort back to pending.
 *
 * Usage:
 *   npm run ingest:hvsc:retry -- --kind vsid_timeout
 *
 * Promotes all error_transient rows of the given kind back to pending.
 * Requires --kind explicitly — no default, to avoid nuking the whole backlog.
 */

import { join } from "node:path";
import { IngestStateStore } from "./hvsc/state-store.js";
import { HVSC_CACHE_DIR } from "./config.js";

const DB_PATH = join(HVSC_CACHE_DIR, "ingest-state.db");

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { kind: string | null } {
  let kind: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--kind" || argv[i] === "-k") && argv[i + 1]) {
      kind = argv[++i];
    }
  }
  return { kind };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const { kind } = parseArgs(process.argv.slice(2));

  if (kind === null) {
    console.error(
      "ERROR: --kind <kind> is required.\n" +
      "Example: npm run ingest:hvsc:retry -- --kind vsid_timeout\n\n" +
      "Use `npm run ingest:hvsc:errors` to see available error kinds.",
    );
    process.exit(1);
  }

  const store = new IngestStateStore(DB_PATH);
  const count = store.requeueByKind(kind);
  store.close();

  if (count === 0) {
    console.log(
      `No error_transient rows found with kind="${kind}". Nothing requeued.\n` +
      "(Only error_transient rows are retryable; error_permanent rows are not.)",
    );
  } else {
    console.log(`Requeued ${count} rows of kind=${kind}; they are now pending.`);
  }
}

main();
