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

export interface HealthCheck {
  service: string;
  status: "OK" | "FAIL" | "DEGRADED";
  detail: string;
}

export interface HealthResult {
  healthy: boolean;
  checks: HealthCheck[];
  versions: Versions;
}

export async function health(): Promise<HealthResult> {
  const checks: HealthCheck[] = [];

  try {
    const q = await getQdrant();
    const stats = await q.getStats();
    checks.push({ service: "Qdrant", status: "OK", detail: `${stats.total_points} vectors` });
  } catch (err) {
    checks.push({ service: "Qdrant", status: "FAIL", detail: (err as Error).message ?? String(err) });
  }

  try {
    const f = await getFalkor();
    const stats = await f.getStats();
    checks.push({ service: "FalkorDB", status: "OK", detail: `${stats.nodes} nodes, ${stats.edges} edges` });
  } catch (err) {
    checks.push({ service: "FalkorDB", status: "FAIL", detail: (err as Error).message ?? String(err) });
  }

  const hasOllama = await ollamaAvailable();
  checks.push({
    service: "Ollama",
    status: hasOllama ? "OK" : "DEGRADED",
    detail: hasOllama ? `${config.ollama.model} available` : "Not available — keyword-only mode",
  });

  try {
    const a = getAnalytics();
    const stats = a.getQueryStats();
    checks.push({ service: "Analytics", status: "OK", detail: `${stats.total_queries} queries logged` });
  } catch (err) {
    checks.push({ service: "Analytics", status: "FAIL", detail: (err as Error).message ?? String(err) });
  }

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
