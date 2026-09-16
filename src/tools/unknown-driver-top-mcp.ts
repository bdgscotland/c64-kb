/**
 * MCP tool for the driver-curation backlog (SID Phase A, M8.4).
 *
 * Surfaces the top N driver_hashes that have no Tracker linked yet via
 * EMITTED_BY. Each row represents a popular un-curated driver — adding
 * a signature for it to analyzer/data/tracker-signatures.yaml typically
 * covers hundreds of tunes per entry.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FalkorHvscClient } from "../services/falkor-hvsc.js";

const InputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Top-N drivers to return (default 50, max 500)"),
});

interface DriverRow {
  driver_hash: string;
  tune_count: number;
}

export function registerUnknownDriverTopTool(server: McpServer): void {
  server.registerTool(
    "c64_unknown_driver_top",
    {
      description:
        `List Driver nodes in the c64_hvsc graph that have no Tracker provenance (no EMITTED_BY edge yet), sorted by tune count descending.

Purpose: surfaces the curation backlog for the tracker-signature database. Each row represents a popular un-curated driver; adding a SIDId-style byte-pattern signature for one tracker_id covers hundreds of tunes per entry.

Inputs:
  - limit (default 50, max 500): how many top drivers to return.

Output: an array of { driver_hash, tune_count } sorted by tune_count desc. Empty array if the c64_hvsc graph has no orphan drivers (everything is already classified, or the graph is empty).

When to use: after a full HVSC ingest, to identify the highest-leverage signatures to add to analyzer/data/tracker-signatures.yaml. Each new entry there is processed by tracker_detect.py on the next re-ingest.

Example: {"limit": 20} → [{"driver_hash": "abc123", "tune_count": 412}, ...]`,
      inputSchema: InputSchema.shape,
    },
    async ({ limit }) => {
      const client = new FalkorHvscClient();
      try {
        await client.connect();
        const rows = await client.rawQuery<DriverRow>(
          `MATCH (d:Driver)<-[:USES_DRIVER]-(t:Tune)
           WHERE NOT (d)-[:EMITTED_BY]->(:Tracker)
           WITH d.driver_hash AS driver_hash, count(t) AS tune_count
           RETURN driver_hash, tune_count
           ORDER BY tune_count DESC
           LIMIT $limit`,
          { params: { limit } } as Parameters<typeof client.rawQuery>[1],
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      } finally {
        await client.disconnect();
      }
    },
  );
}
