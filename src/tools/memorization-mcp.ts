/**
 * MCP tool for the memorization-detection service (SID Phase A, M6.5).
 *
 * Runs as a one-shot subprocess per call (no persistent worker pool) —
 * memorization checks are infrequent and the latency cost is acceptable.
 * Phase 0b can promote this to a persistent pool if needed.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_DIR = path.resolve(__dirname, "../../analyzer");

const InputSchema = z.object({
  candidate_events: z
    .array(z.record(z.string(), z.unknown()))
    .describe("Note events from the candidate tune (NoteEvent.model_dump() shape)"),
  reference_events: z
    .array(z.array(z.record(z.string(), z.unknown())))
    .default([])
    .describe("List of reference tune event lists. Pass [] to get a neutral (no-reference) verdict."),
});

const PYTHON = path.join(ANALYZER_DIR, ".venv/bin/python");

/**
 * Registers the tool only where the Python analyzer is installed. The public
 * repository has no analyzer/, and the tool used to be listed there anyway
 * and fail on every call.
 */
export function registerMemorizationTool(server: McpServer): void {
  if (!existsSync(PYTHON)) return;
  server.registerTool(
    "c64_memorization_check",
    {
      description: `Check whether a candidate's SID note stream resembles any reference tune via SSIMuse + Originality Report detectors.

Purpose: Guards the SID generation pipeline against memorized copies of HVSC canon tunes. Returns a structured verdict with nearest-neighbor distance, similarity scores, and a binary copy_detected flag calibrated against the YAML-configured thresholds.

Inputs:
  - candidate_events (required): array of NoteEvent dicts for the tune being evaluated. Shape: {voice, frame, kind, pitch_hz, sid_chip}.
  - reference_events (optional, default []): array of arrays — each inner array is one reference tune's event list. Pass [] for a no-reference neutral check. Pass the HVSC canon events to run the full detector.

Output: a MemorizationResult JSON object with fields:
  - kind: "result"
  - nearest_neighbor_distance: 0.0 (identical) → 1.0 (maximally different)
  - ssimuse_score: 0.0 → 1.0 (higher = more similar to best reference)
  - originality_pct: 0.0 (fully original) → 1.0 (fully recycled n-grams)
  - copy_detected: true if ANY detector exceeds its configured threshold
  - copies: [] (populated in a follow-up phase when (md5, title, composer) lookup is wired)
  - thresholds: the threshold dict active for this verdict

On service error, returns a ServiceError object: {kind: "error", error_kind, message}.

When to use: After generating a SID candidate, before publishing or scoring it. Also useful for human-in-the-loop audits via the memorize-audit CLI.

Example: {"candidate_events": [...], "reference_events": [[...]]} → {"kind": "result", "copy_detected": true, ...}

Limitations: copies[] is always [] in Phase A — identifying WHICH reference matched requires a follow-up md5 lookup pass. SSIMuse + Originality Report use PAL-50Hz frame timing by default.`,
      inputSchema: InputSchema.shape,
    },
    async ({ candidate_events, reference_events }) => {
      const requestLine = JSON.stringify({
        kind: "check",
        events: candidate_events,
        references: reference_events ?? [],
      });

      const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn(PYTHON, ["-m", "src.memorization.service", "--stdio"], {
          cwd: ANALYZER_DIR,
          stdio: ["pipe", "pipe", "inherit"],
        });
        let stdout = "";
        proc.stdout.on("data", (b: Buffer) => {
          stdout += b.toString();
        });
        proc.on("error", reject);
        proc.on("close", (code: number | null) => {
          if (code !== 0) {
            reject(new Error(`memorization service exited with code ${code}`));
          } else {
            resolve(stdout.trim());
          }
        });
        proc.stdin.write(requestLine + "\n");
        proc.stdin.end();
      });

      // The service answers {kind: "error", ...} on its own failures; an MCP
      // client only sees a failure when isError is set.
      let isError = false;
      try {
        isError = (JSON.parse(result) as { kind?: unknown }).kind === "error";
      } catch {
        isError = true;
      }
      return {
        content: [{ type: "text" as const, text: result }],
        isError,
      };
    },
  );
}
