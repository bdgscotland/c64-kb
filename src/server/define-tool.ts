/**
 * The tool registry's shape: one `defineTool` entry per MCP tool and one
 * loop that registers them all with the same result wrapper.
 *
 * Before this file every tool was an inline `server.registerTool` call in
 * one 748-line function, each repeating the `content` / `structuredContent`
 * wrapper by hand.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { rebuildInProgress, rebuildMessage } from "../services/rebuild-marker.ts";

/** What a tool's `run` returns: the markdown text and, for a tool with an outputSchema, the typed payload. */
export interface ToolReply {
  text: string;
  structured?: Record<string, unknown>;
  /** Set only by tools whose failure comes back as a value rather than a throw. */
  isError?: boolean;
}

export interface ToolDefinition<In extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: In;
  outputSchema?: ZodRawShapeCompat;
  annotations: ToolAnnotations;
  /**
   * False for a tool that never answers from the graph (health, lint, the
   * VICE runs, gap reports, ingest_doc). Every other tool is refused while
   * a rebuild marker is set; see guardRebuild.
   */
  readsGraph?: false;
  run: (args: z.output<z.ZodObject<In>>) => ToolReply | Promise<ToolReply>;
}

/** A defined tool with its argument types erased, so tools of different shapes share one list. */
export interface RegistrableTool {
  readonly name: string;
  readonly register: (server: McpServer) => void;
}

/** Read-only lookups, searches and briefings: they read the stores and change nothing an agent can see. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/** The shared result wrapper. Key order matches what the inline handlers returned. */
function toCallToolResult(reply: ToolReply): CallToolResult {
  return {
    content: [{ type: "text", text: reply.text }],
    ...(reply.structured === undefined ? {} : { structuredContent: reply.structured }),
    ...(reply.isError === undefined ? {} : { isError: reply.isError }),
  };
}

/**
 * While a batch ingest is rebuilding the graph, a tool that reads it
 * answers with the rebuild message and isError, not with what the half-built
 * graph holds (#41: "Pitfalls (0)" mid-ingest). Null lets the tool run.
 */
async function guardRebuild(readsGraph: false | undefined): Promise<ToolReply | null> {
  if (readsGraph === false) return null;
  const state = await rebuildInProgress();
  return state ? { text: rebuildMessage(state), isError: true } : null;
}

/**
 * Wrap one tool. The SDK validates the arguments against `inputSchema`
 * before the handler runs; the handler parses them once more with the same
 * schema so `run` gets typed arguments without a cast (the SDK's handler
 * type is a conditional type TypeScript cannot resolve for a generic shape).
 * The second parse cannot fail and changes nothing: defaults are applied
 * idempotently and no schema here transforms.
 */
export function defineTool<In extends z.ZodRawShape>(def: ToolDefinition<In>): RegistrableTool {
  const parser = z.object(def.inputSchema);
  return {
    name: def.name,
    register: (server) => {
      server.registerTool<ZodRawShapeCompat, ZodRawShapeCompat>(
        def.name,
        {
          title: def.title,
          description: def.description,
          inputSchema: def.inputSchema,
          ...(def.outputSchema === undefined ? {} : { outputSchema: def.outputSchema }),
          annotations: def.annotations,
        },
        async (args) =>
          toCallToolResult((await guardRebuild(def.readsGraph)) ?? (await def.run(parser.parse(args)))),
      );
    },
  };
}

/** The one registration loop. */
export function registerTools(server: McpServer, tools: readonly RegistrableTool[]): void {
  for (const tool of tools) tool.register(server);
}
