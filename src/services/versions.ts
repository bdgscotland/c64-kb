/**
 * Version helpers. Reads the repo-root VERSION file + package.json so
 * the CLI, MCP server, and health check all surface the same numbers.
 *
 * Three axes track independently — see VERSION for definitions.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface Versions {
  kb_data: string;
  kb_schema: string;
  mcp_tool: string;
  package: string;
}

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
// dist/services/ at runtime, src/services/ during tests — both walk up 2.
const REPO_ROOT = resolve(SELF_DIR, "..", "..");

let cached: Versions | null = null;

export function getVersions(): Versions {
  if (cached) return cached;
  const v: Versions = { kb_data: "?", kb_schema: "?", mcp_tool: "?", package: "?" };
  try {
    const txt = readFileSync(resolve(REPO_ROOT, "VERSION"), "utf-8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^(KB_DATA_VERSION|KB_SCHEMA_VERSION|MCP_TOOL_VERSION)=(.+)$/);
      if (!m) continue;
      if (m[1] === "KB_DATA_VERSION") v.kb_data = m[2].trim();
      else if (m[1] === "KB_SCHEMA_VERSION") v.kb_schema = m[2].trim();
      else if (m[1] === "MCP_TOOL_VERSION") v.mcp_tool = m[2].trim();
    }
  } catch {
    // VERSION file missing — fall through, all "?" defaults
  }
  try {
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8"));
    if (typeof pkg.version === "string") v.package = pkg.version;
  } catch {
    // package.json missing or malformed — keep "?"
  }
  cached = v;
  return v;
}
