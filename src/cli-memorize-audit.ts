#!/usr/bin/env node
/**
 * c64-kb memorize-audit — run a candidate's events through the memorization
 * service and print a verdict table.
 *
 * Usage:
 *   npm run memorize:audit -- --candidate path/to/candidate-events.json
 *                              [--references path/to/refs.json]
 *
 * candidate-events.json is a JSON array of NoteEvent dicts.
 * references.json is a JSON array of arrays (each inner array is one
 * reference tune's events).
 *
 * Exit codes:
 *   0 — not flagged as a copy
 *   1 — service error / crash
 *   2 — candidate flagged as a possible copy
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);

const candidateIdx = args.indexOf("--candidate");
const referencesIdx = args.indexOf("--references");

if (candidateIdx === -1 || !args[candidateIdx + 1]) {
  console.error("Usage: memorize-audit --candidate <events.json> [--references <refs.json>]");
  process.exit(2);
}

const candidatePath = args[candidateIdx + 1];
const referencesPath = referencesIdx !== -1 ? args[referencesIdx + 1] : null;

const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
const references = referencesPath ? JSON.parse(readFileSync(referencesPath, "utf8")) : [];

const request = JSON.stringify({ kind: "check", events: candidate, references });
const analyzerDir = join(process.cwd(), "analyzer");

const result = spawnSync(
  join(analyzerDir, ".venv/bin/python"),
  ["-m", "src.memorization.service", "--stdio"],
  { cwd: analyzerDir, input: request + "\n", encoding: "utf8" },
);

if (result.status !== 0) {
  console.error("Service crashed:", result.stderr);
  process.exit(1);
}

const rawOut = result.stdout?.trim();
if (!rawOut) {
  console.error("Service produced no output");
  process.exit(1);
}

let verdict: Record<string, unknown>;
try {
  verdict = JSON.parse(rawOut);
} catch {
  console.error("Could not parse service output:", rawOut);
  process.exit(1);
}

if (verdict["kind"] === "error") {
  console.error("Service error:", verdict["error_kind"], verdict["message"]);
  process.exit(1);
}

console.log("Memorization audit verdict");
console.log("==========================");
console.log(`copy_detected:              ${verdict["copy_detected"]}`);
console.log(`ssimuse_score:              ${Number(verdict["ssimuse_score"]).toFixed(3)}`);
console.log(`originality_pct:            ${Number(verdict["originality_pct"]).toFixed(3)}`);
console.log(`nearest_neighbor_distance:  ${Number(verdict["nearest_neighbor_distance"]).toFixed(3)}`);
console.log("");
console.log("Thresholds:");
for (const [k, v] of Object.entries(verdict["thresholds"] as Record<string, unknown>)) {
  console.log(`  ${k}: ${v}`);
}
console.log("");
if (verdict["copy_detected"]) {
  console.error("WARNING: Candidate flagged as a possible copy.");
  process.exit(2);
}
