/**
 * c64-kb MCP server: a thin wrapper over the tool functions in src/tools/.
 *
 * Structured tools return `structuredContent` matching a Zod
 * `outputSchema`, alongside a `content[0].text` markdown blob. Closed-set
 * string args use `z.enum()`. Tool descriptions follow the 6-component
 * template: purpose, guidelines, limitations, param notes, expected length,
 * example. `c64_health` lists the live surface; the list is not repeated
 * here because it went stale.
 *
 * The tools themselves are defined in src/server/ (one file per family) and
 * registered by one loop; src/server/tools.ts fixes their order.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getVersions } from "./services/versions.ts";
import { closeAll } from "./context.ts";
import { registerTools } from "./server/define-tool.ts";
import { TOOLS } from "./server/tools.ts";
import { STATIC_RESOURCES, readStaticResource, readRegisterResource } from "./tools/resources.ts";
import { demoBriefPrompt, gameBriefPrompt, demoBriefArgs, gameBriefArgs } from "./tools/prompts.ts";

export async function startMcpServer(): Promise<void> {
  // The version said "0.1.0" through package 0.8.0.
  const server = new McpServer(
    { name: "c64-kb", version: getVersions().package },
    {
      instructions:
        "Commodore 64 knowledge base. Call c64_health first to see what the stores hold; c64_demo_briefing and c64_game_briefing plan a whole program in one call.",
    },
  );

  registerTools(server, TOOLS);
  registerResources(server);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  exitWhenStdinCloses(server);
}

function registerResources(server: McpServer): void {
  for (const r of STATIC_RESOURCES) {
    server.registerResource(r.name, r.uri, { description: r.description, mimeType: "text/markdown" }, () => {
      const res = readStaticResource(r.uri);
      return { contents: res ? [res] : [] };
    });
  }

  // Template resource for per-register structured lookup.
  server.registerResource(
    "register",
    new ResourceTemplate("c64://register/{name}", { list: undefined }),
    {
      description:
        "Per-register structured data (name, address, chip, R/W, aliases). Useful for direct attach when the consuming agent already knows which register it cares about.",
    },
    async (uri, vars) => {
      const raw = vars.name;
      const name = typeof raw === "string" ? raw : Array.isArray(raw) ? (raw.at(0) ?? "") : "";
      const res = await readRegisterResource(uri.toString(), name);
      return { contents: res ? [res] : [] };
    },
  );
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "c64_demo_brief",
    {
      description:
        "Design a C64 demo from a natural-language brief. Templated body guides the agent through technique identification, register/KERNAL lookup, pitfall surfacing, build order, and toolchain split (Oscar64 vs KickAssembler). Prefer the c64_demo_briefing tool, which runs the lookups itself.",
      argsSchema: demoBriefArgs,
    },
    demoBriefPrompt,
  );

  server.registerPrompt(
    "c64_game_brief",
    {
      description:
        "Design a C64 game from a natural-language brief. Templated body guides the agent through archetype matching, architecture sketch, technique selection, SID approach, KERNAL usage, and toolchain split. Prefer the c64_game_briefing tool, which runs the lookups itself.",
      argsSchema: gameBriefArgs,
    },
    gameBriefPrompt,
  );
}

/**
 * A stdio client shuts the server down by closing stdin (MCP spec,
 * transports/stdio); the SDK's transport does not listen for that, and the
 * open FalkorDB socket kept the process alive. Close everything and exit.
 */
function exitWhenStdinCloses(server: McpServer): void {
  let closing = false;
  const shutdown = (code: number) => {
    if (closing) return;
    closing = true;
    const force = setTimeout(() => process.exit(code), 3000);
    force.unref();
    void server
      .close()
      .catch((e: unknown) => {
        console.error("c64-kb: closing the MCP server failed:", e);
      })
      .then(() => closeAll())
      .finally(() => process.exit(code));
  };
  process.stdin.on("end", () => {
    shutdown(0);
  });
  process.stdin.on("close", () => {
    shutdown(0);
  });
  process.on("SIGINT", () => {
    shutdown(0);
  });
  process.on("SIGTERM", () => {
    shutdown(0);
  });
}
