/**
 * Intelligence tools for c64-kb.
 *
 * Phase 0 ships only the `health` check. Coverage / suggest-links /
 * report-gap / catalog tools land in later phases (per the spec's
 * Phase 7 self-improvement loop).
 */

import { getQdrant, getFalkor, getAnalytics } from "../context.ts";
import { isAvailable as ollamaAvailable } from "../services/embeddings.ts";
import { getVersions, type Versions } from "../services/versions.ts";
import { config } from "../config.ts";

interface HealthCheck {
  service: string;
  status: "OK" | "FAIL" | "DEGRADED";
  detail: string;
}

export interface HealthResult {
  healthy: boolean;
  checks: HealthCheck[];
  versions: Versions;
}

/**
 * A refused connection arrives as an AggregateError with an empty message
 * (measured: FALKOR_PORT=7999 gave a FAIL row with a blank detail), so dig
 * out the first inner error, then fall back to its code or name.
 */
function errorDetail(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) return errorDetail(err.errors[0]);
  if (!(err instanceof Error)) return String(err);
  if (err.message) return err.message;
  return "code" in err ? String(err.code) : err.name;
}

/** OK with the probe's detail, or FAIL with the error it threw. */
async function probe(service: string, detail: () => Promise<string> | string): Promise<HealthCheck> {
  try {
    return { service, status: "OK", detail: await detail() };
  } catch (err) {
    return { service, status: "FAIL", detail: errorDetail(err) };
  }
}

export async function health(): Promise<HealthResult> {
  const checks: HealthCheck[] = [];

  checks.push(
    await probe("Qdrant", async () => {
      const stats = await (await getQdrant()).getStats();
      return `${stats.total_points} vectors`;
    }),
  );

  // getStats throws when the graph cannot be queried; it used to return
  // zeros, and this check then printed "OK, 0 nodes" for a dead graph.
  checks.push(
    await probe("FalkorDB", async () => {
      const stats = await (await getFalkor()).getStats();
      return `${stats.nodes} nodes, ${stats.edges} edges`;
    }),
  );

  const hasOllama = await ollamaAvailable();
  checks.push({
    service: "Ollama",
    status: hasOllama ? "OK" : "DEGRADED",
    detail: hasOllama ? `${config.ollama.model} available` : "Not available — keyword-only mode",
  });

  checks.push(
    await probe("Analytics", () => `${getAnalytics().getQueryStats().total_queries} queries logged`),
  );

  const healthy = checks.every((c) => c.status === "OK" || c.status === "DEGRADED");
  return { healthy, checks, versions: getVersions() };
}

export function formatHealth(result: HealthResult): string {
  let output = `# c64-kb Health: ${result.healthy ? "HEALTHY" : "UNHEALTHY"}\n\n`;
  const v = result.versions;
  output += `**Versions:** KB_DATA=${v.kb_data}, KB_SCHEMA=${v.kb_schema}, MCP_TOOL=${v.mcp_tool}, package=${v.package}\n\n`;
  output += `| Service | Status | Detail |\n|---------|--------|--------|\n`;
  for (const c of result.checks) {
    output += `| ${c.service} | ${c.status} | ${c.detail} |\n`;
  }
  return output;
}
