/**
 * Operator CLI: post-ingest markdown report.
 *
 * Usage:
 *   npm run ingest:hvsc:report
 *
 * Writes data/hvsc-cache/ingest-report-<timestamp>.md covering:
 *   - Summary counts by status
 *   - Top 20 error kinds
 *   - Top 20 unknown driver_hashes (Driver nodes without EMITTED_BY→Tracker)
 *   - Tracker coverage % (Tunes with tracker_id != "unknown")
 *
 * Also prints the path of the written report.
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { IngestStateStore, type StatusCounts } from "./hvsc/state-store.js";
import { FalkorHvscClient } from "./services/falkor-hvsc.js";
import { HVSC_CACHE_DIR } from "./config.js";

const DB_PATH = join(HVSC_CACHE_DIR, "ingest-state.db");

// ── Status section ────────────────────────────────────────────────────────────

const STATUS_KEYS: Array<keyof StatusCounts> = [
  "pending",
  "in_progress",
  "complete",
  "error_transient",
  "error_permanent",
  "skip_unsupported_format",
];

function buildStatusSection(counts: StatusCounts, total: number): string {
  if (total === 0) {
    return "## Status Counts\n\n_No ingest data yet._\n";
  }

  const rows = STATUS_KEYS.map((k) => `| ${k} | ${counts[k]} |`).join("\n");
  return [
    "## Status Counts",
    "",
    "| Status | Count |",
    "|--------|------:|",
    rows,
    `| **total** | **${total}** |`,
    "",
  ].join("\n");
}

// ── Error kinds section ───────────────────────────────────────────────────────

function buildErrorSection(store: IngestStateStore): string {
  const rows = store.topErrorKinds(20);
  if (rows.length === 0) {
    return "## Top 20 Error Kinds\n\n_No errors recorded._\n";
  }

  const tableRows = rows
    .map((r) => `| ${r.error_kind ?? "(null)"} | ${r.count} |`)
    .join("\n");

  return [
    "## Top 20 Error Kinds",
    "",
    "| error_kind | Count |",
    "|------------|------:|",
    tableRows,
    "",
  ].join("\n");
}

// ── Unknown driver hashes section ─────────────────────────────────────────────

interface DriverHashRow {
  h: string;
  n: number;
}

async function buildUnknownDriversSection(falkor: FalkorHvscClient): Promise<string> {
  const cypher = `
    MATCH (t:Tune)-[:USES_DRIVER]->(d:Driver)
    WHERE NOT (d)-[:EMITTED_BY]->(:Tracker)
    WITH d.driver_hash AS h, count(t) AS n
    ORDER BY n DESC, h ASC
    LIMIT 20
    RETURN h, n
  `;

  let rows: DriverHashRow[];
  try {
    rows = await falkor.rawQuery<DriverHashRow>(cypher);
  } catch {
    return "## Top 20 Unknown Driver Hashes\n\n_Graph query failed (FalkorDB unavailable?)._\n";
  }

  if (rows.length === 0) {
    return "## Top 20 Unknown Driver Hashes\n\n_None — all drivers have a known tracker._\n";
  }

  const tableRows = rows
    .map((r) => `| \`${r.h ?? "(null)"}\` | ${r.n} |`)
    .join("\n");

  return [
    "## Top 20 Unknown Driver Hashes",
    "",
    "Driver nodes with no `EMITTED_BY→Tracker` edge.",
    "These are candidates for new tracker fingerprint rules.",
    "",
    "| driver_hash | Tune count |",
    "|-------------|----------:|",
    tableRows,
    "",
  ].join("\n");
}

// ── Tracker coverage section ──────────────────────────────────────────────────

interface CountRow {
  n: number;
}

async function buildTrackerCoverageSection(falkor: FalkorHvscClient): Promise<string> {
  let total = 0;
  let known = 0;

  try {
    const totalRows = await falkor.rawQuery<CountRow>(
      "MATCH (t:Tune) RETURN count(t) AS n",
    );
    total = totalRows[0]?.n ?? 0;

    const knownRows = await falkor.rawQuery<CountRow>(
      `MATCH (t:Tune) WHERE t.tracker_id <> 'unknown' AND t.tracker_id IS NOT NULL RETURN count(t) AS n`,
    );
    known = knownRows[0]?.n ?? 0;
  } catch {
    return "## Tracker Coverage\n\n_Graph query failed (FalkorDB unavailable?)._\n";
  }

  if (total === 0) {
    return "## Tracker Coverage\n\n_No Tune nodes in graph yet._\n";
  }

  const pct = ((known / total) * 100).toFixed(1);

  return [
    "## Tracker Coverage",
    "",
    `| Metric | Value |`,
    `|--------|------:|`,
    `| Total tunes | ${total} |`,
    `| Known tracker | ${known} |`,
    `| Unknown tracker | ${total - known} |`,
    `| Coverage | **${pct}%** |`,
    "",
  ].join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const store = new IngestStateStore(DB_PATH);
  const falkor = new FalkorHvscClient();

  let falkorConnected = false;
  try {
    await falkor.connect();
    falkorConnected = true;
  } catch {
    console.warn("WARNING: Could not connect to FalkorDB — graph sections will be skipped.");
  }

  const counts = store.countsByStatus();
  const total = store.totalRows();

  const sections: string[] = [];

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  sections.push(`# HVSC Ingest Report — ${new Date().toISOString()}`);
  sections.push("");
  sections.push(`Generated from: \`${DB_PATH}\``);
  sections.push("");

  sections.push(buildStatusSection(counts, total));
  sections.push(buildErrorSection(store));

  if (falkorConnected) {
    sections.push(await buildUnknownDriversSection(falkor));
    sections.push(await buildTrackerCoverageSection(falkor));
  } else {
    sections.push("## Top 20 Unknown Driver Hashes\n\n_FalkorDB unavailable._\n");
    sections.push("## Tracker Coverage\n\n_FalkorDB unavailable._\n");
  }

  store.close();
  if (falkorConnected) await falkor.disconnect();

  const reportPath = join(HVSC_CACHE_DIR, `ingest-report-${timestamp}.md`);
  mkdirSync(HVSC_CACHE_DIR, { recursive: true });
  writeFileSync(reportPath, sections.join("\n"), "utf8");

  console.log(reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
