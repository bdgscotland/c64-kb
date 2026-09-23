/**
 * Version helpers. Reads the repo-root VERSION file + package.json so
 * the CLI, MCP server, and health check all surface the same numbers.
 *
 * Three axes track independently — see VERSION for definitions.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export interface Versions {
  kb_data: string;
  kb_schema: string;
  mcp_tool: string;
  package: string;
}

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
// dist/services/ at runtime, src/services/ during tests — both walk up 2.
const REPO_ROOT = resolve(SELF_DIR, "..", "..");

const VERSION_KEYS = [
  ["KB_DATA_VERSION", "kb_data"],
  ["KB_SCHEMA_VERSION", "kb_schema"],
  ["MCP_TOOL_VERSION", "mcp_tool"],
] as const;

const PackageJson = z.object({ version: z.string() });

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The file's text, or null when it cannot be read. A missing file is
 * expected in a partial install and stays quiet; any other failure is
 * reported on stderr (never stdout: the MCP server reaches this).
 */
function readOptional(name: string): string | null {
  try {
    return readFileSync(resolve(REPO_ROOT, name), "utf-8");
  } catch (err) {
    const code = err instanceof Error && "code" in err ? err.code : undefined;
    if (code !== "ENOENT") console.error(`[versions] cannot read ${name}: ${message(err)}`);
    return null;
  }
}

function parseVersionFile(txt: string, v: Versions): void {
  for (const line of txt.split("\n")) {
    for (const [key, field] of VERSION_KEYS) {
      const value = line.startsWith(`${key}=`) ? line.slice(key.length + 1).trim() : "";
      if (value) v[field] = value;
    }
  }
}

function parsePackageVersion(txt: string): string | null {
  try {
    const parsed = PackageJson.safeParse(JSON.parse(txt));
    return parsed.success ? parsed.data.version : null;
  } catch (err) {
    console.error(`[versions] package.json is not valid JSON: ${message(err)}`);
    return null;
  }
}

let cached: Versions | null = null;

export function getVersions(): Versions {
  if (cached) return cached;
  const v: Versions = { kb_data: "?", kb_schema: "?", mcp_tool: "?", package: "?" };
  const versionTxt = readOptional("VERSION");
  if (versionTxt !== null) parseVersionFile(versionTxt, v);
  const pkgTxt = readOptional("package.json");
  const pkgVersion = pkgTxt === null ? null : parsePackageVersion(pkgTxt);
  if (pkgVersion !== null) v.package = pkgVersion;
  cached = v;
  return v;
}
