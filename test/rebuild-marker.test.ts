import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FalkorService } from "../src/services/falkor.ts";
import { registerTools } from "../src/server/define-tool.ts";
import { pitfallsForTool, lintSourceTool } from "../src/server/tools-pitfalls.ts";
import { techniqueLookupTool } from "../src/server/tools-recipes.ts";

// #41: during an `ingest:clean` of the live graph the tools answered from the
// half-built graph ("Pitfalls (0)", technique cards without recipes). A clean
// ingest now sets an IngestRun marker first and clears it after its report;
// while it exists the graph tools answer that the KB is being rebuilt.
let f: FalkorService;
let client: Client;

beforeAll(async () => {
  f = new FalkorService();
  await f.connect();
  await f.clean();
  await f.ensureSchema();
  await f.addTechnique({
    name: "stable_raster_irq",
    title: "Stable raster IRQ",
    category: "raster",
    complexity: "medium",
  });
  const server = new McpServer({ name: "c64-kb-test", version: "0" });
  registerTools(server, [pitfallsForTool, lintSourceTool, techniqueLookupTool]);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

afterEach(async () => {
  await f.markRebuildFinished();
});

afterAll(async () => {
  await client.close();
  await f.close();
});

const text = (r: Awaited<ReturnType<Client["callTool"]>>): string =>
  (r.content as { type: string; text: string }[]).map((c) => c.text).join("");

describe("rebuild marker", () => {
  it("graph tools answer that the KB is being rebuilt while the marker exists", async () => {
    await f.markRebuildStarted(" --clean");
    for (const [name, args] of [
      ["c64_pitfalls_for", { topic: "stable_raster_irq" }],
      ["c64_technique_lookup", { name: "stable_raster_irq" }],
    ] as const) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, name).toBe(true);
      expect(text(r)).toContain("The knowledge base is being rebuilt: an ingest --clean started at");
    }
  });

  it("a tool that never reads the graph still answers", async () => {
    await f.markRebuildStarted(" --clean");
    const r = await client.callTool({ name: "c64_lint_source", arguments: { source: "lda #0\n" } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).not.toContain("being rebuilt");
  });

  it("the tools answer again once the marker is gone, and clean() leaves the marker", async () => {
    await f.markRebuildStarted(" --clean");
    await f.clean();
    const during = await client.callTool({
      name: "c64_technique_lookup",
      arguments: { name: "stable_raster_irq" },
    });
    expect(during.isError).toBe(true);
    await f.markRebuildFinished();
    await f.addTechnique({
      name: "stable_raster_irq",
      title: "Stable raster IRQ",
      category: "raster",
      complexity: "medium",
    });
    const after = await client.callTool({
      name: "c64_technique_lookup",
      arguments: { name: "stable_raster_irq" },
    });
    expect(after.isError).toBeFalsy();
    expect(text(after)).toContain("# Technique: stable_raster_irq");
  });

  it("the CLI prints the rebuild message and exits 1", async () => {
    await f.markRebuildStarted(" --clean");
    const r = spawnSync("node", ["src/cli.ts", "technique-lookup", "stable_raster_irq"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("The knowledge base is being rebuilt");
    expect(r.stdout).not.toContain("# Technique:");
  });
});
