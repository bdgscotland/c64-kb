/**
 * The rebuild marker: one `IngestRun` node a batch ingest writes before it
 * cleans or writes anything and deletes once its report is done
 * (FalkorService.markRebuildStarted / markRebuildFinished). While it exists
 * the graph is half built, and the query tools say so instead of answering
 * from it.
 *
 * Until #41 they answered: during an `ingest:clean` the pitfall tools
 * returned "Pitfalls (0)" and technique cards lost their recipes, and an
 * agent read that as the knowledge base's answer. The marker lives in the
 * graph, not in a file, because the MCP server and the ingest need not
 * share a checkout; they share the graph. An ingest that fails leaves it
 * behind, which is right: its graph is half built too.
 */

import { z } from "zod";
import { getFalkor } from "../context.ts";

const MarkerRow = z.object({ started_at: z.string().nullable(), flags: z.string().nullable() });

export interface RebuildState {
  started_at: string;
  flags: string;
}

/**
 * The marker's contents, or null when no rebuild is in progress. A graph
 * that cannot be reached is not a rebuild: the tool runs and reports its
 * own connection error.
 */
export async function rebuildInProgress(): Promise<RebuildState | null> {
  let data: unknown[];
  try {
    const f = await getFalkor();
    data = (
      await f.roQuery(
        `MATCH (m:IngestRun {name: 'rebuild'}) RETURN m.started_at AS started_at, m.flags AS flags LIMIT 1`,
      )
    ).data;
  } catch {
    return null;
  }
  const row = z.array(MarkerRow).parse(data).at(0);
  if (!row) return null;
  return { started_at: row.started_at ?? "an unknown time", flags: row.flags ?? "" };
}

/** What a query tool answers instead of its result while the marker exists. */
export function rebuildMessage(state: RebuildState): string {
  return (
    `The knowledge base is being rebuilt: an ingest${state.flags} started at ${state.started_at} ` +
    `and has not finished. The graph is half built, so an answer now would be missing nodes and edges ` +
    `(no pitfalls, no recipes) without saying so. Retry when the ingest ends. ` +
    `If no ingest is running, the last one failed: run \`npm run ingest:clean\` (or \`c64-kb ingest --clean\`).`
  );
}
