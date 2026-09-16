/**
 * Operator CLI: HVSC ingest state snapshot.
 *
 * Usage:
 *   npm run ingest:hvsc:status          # one-shot summary
 *   npm run ingest:hvsc:status -- -w    # refresh every 5s (--watch)
 */

import { join } from "node:path";
import { IngestStateStore, type StatusCounts } from "./hvsc/state-store.js";
import { HVSC_CACHE_DIR } from "./config.js";

const DB_PATH = join(HVSC_CACHE_DIR, "ingest-state.db");

// ── Formatting ────────────────────────────────────────────────────────────────

const STATUS_KEYS: Array<keyof StatusCounts> = [
  "pending",
  "in_progress",
  "complete",
  "error_transient",
  "error_permanent",
  "skip_unsupported_format",
];

function formatTable(counts: StatusCounts, total: number): string {
  const lines: string[] = [
    `HVSC ingest state (${DB_PATH}):`,
    "─".repeat(51),
  ];

  if (total === 0) {
    lines.push("  (no ingest data yet — run npm run ingest:hvsc first)");
    lines.push("");
    return lines.join("\n");
  }

  for (const key of STATUS_KEYS) {
    const label = key + ":";
    lines.push(`  ${label.padEnd(30)} ${String(counts[key]).padStart(10)}`);
  }
  lines.push("─".repeat(51));
  lines.push(`  ${"total:".padEnd(30)} ${String(total).padStart(10)}`);
  lines.push("");
  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

function printStatus(store: IngestStateStore): void {
  const counts = store.countsByStatus();
  const total = store.totalRows();
  process.stdout.write(formatTable(counts, total));
}

function main(): void {
  const args = process.argv.slice(2);
  const watch = args.includes("--watch") || args.includes("-w");

  const store = new IngestStateStore(DB_PATH);

  if (!watch) {
    printStatus(store);
    store.close();
    return;
  }

  // --watch: clear screen and redraw every 5 s.
  const draw = (): void => {
    // ANSI: clear screen, move cursor to top-left.
    process.stdout.write("\x1b[2J\x1b[H");
    printStatus(store);
    process.stdout.write("  (refreshing every 5s — Ctrl-C to quit)\n");
  };

  draw();
  const timer = setInterval(draw, 5000);

  process.on("SIGINT", () => {
    clearInterval(timer);
    store.close();
    process.stdout.write("\n");
    process.exit(0);
  });
}

main();
