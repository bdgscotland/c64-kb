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
import { z } from "zod";

// The service's reply is JSON from a subprocess: validated, not cast. Every
// field is printed as the service sent it, so each is only required to be
// an object field; thresholds, which is iterated, must be an object if present.
const VerdictSchema = z.object({
  kind: z.unknown(),
  error_kind: z.unknown(),
  message: z.unknown(),
  copy_detected: z.unknown(),
  ssimuse_score: z.unknown(),
  originality_pct: z.unknown(),
  nearest_neighbor_distance: z.unknown(),
  thresholds: z.record(z.string(), z.unknown()).optional(),
});

const args = process.argv.slice(2);

const candidateIdx = args.indexOf("--candidate");
const referencesIdx = args.indexOf("--references");

const candidatePath = candidateIdx === -1 ? undefined : args.at(candidateIdx + 1);
if (!candidatePath) {
  console.error("Usage: memorize-audit --candidate <events.json> [--references <refs.json>]");
  process.exit(2);
}

const referencesPath = referencesIdx !== -1 ? args.at(referencesIdx + 1) : undefined;

// Passed through to the service unchanged; the service validates the events.
const candidate: unknown = JSON.parse(readFileSync(candidatePath, "utf8"));
const references: unknown = referencesPath ? JSON.parse(readFileSync(referencesPath, "utf8")) : [];

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

const rawOut = result.stdout.trim();
if (!rawOut) {
  console.error("Service produced no output");
  process.exit(1);
}

function parseVerdict(raw: string): z.infer<typeof VerdictSchema> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("Could not parse service output:", raw);
    process.exit(1);
  }
  const verdict = VerdictSchema.safeParse(parsed);
  if (!verdict.success) {
    console.error("Service output is not a verdict object:", raw);
    process.exit(1);
  }
  return verdict.data;
}

const verdict = parseVerdict(rawOut);

if (verdict.kind === "error") {
  console.error("Service error:", verdict.error_kind, verdict.message);
  process.exit(1);
}

console.log("Memorization audit verdict");
console.log("==========================");
console.log(`copy_detected:              ${String(verdict.copy_detected)}`);
console.log(`ssimuse_score:              ${Number(verdict.ssimuse_score).toFixed(3)}`);
console.log(`originality_pct:            ${Number(verdict.originality_pct).toFixed(3)}`);
console.log(`nearest_neighbor_distance:  ${Number(verdict.nearest_neighbor_distance).toFixed(3)}`);
console.log("");
console.log("Thresholds:");
for (const [k, v] of Object.entries(verdict.thresholds ?? {})) {
  console.log(`  ${k}: ${String(v)}`);
}
console.log("");
if (verdict.copy_detected) {
  console.error("WARNING: Candidate flagged as a possible copy.");
  process.exit(2);
}
