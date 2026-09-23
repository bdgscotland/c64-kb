// src/tools/run-game.ts — c64_run_game MCP tool.
//
// Spawns x64sc with -autostart, connects via the bundled vice-mcp,
// drives the parallel-input-cell harness pattern proven by loop/demo,
// and returns a state trace + final screen render.
//
// This is the substrate layer the c64-kb MCP exposes for game
// development. Claude Code calls it from a session to verify a
// freshly-built .prg actually runs and reaches expected states.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { resolveX64sc } from "../services/vice-bin.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_VICE_MCP_PATH =
  process.env.VICE_MCP_PATH ?? "vice-mcp/dist/index.js";

const DEFAULT_X64SC_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  XDG_DATA_DIRS: "/opt/homebrew/share:/usr/local/share:/usr/share",
  GSETTINGS_SCHEMA_DIR: "/opt/homebrew/share/glib-2.0/schemas",
};

// ---------------------------------------------------------------------------
// Schemas (Zod-validated)
// ---------------------------------------------------------------------------

export const RunGameInputSchema = {
  prg_path: z.string().describe("Absolute path to the .prg to load"),
  dbj_path: z.string().describe("Absolute path to the matching .dbj (typed debug info)"),
  state_symbol: z
    .string()
    .default("state")
    .describe("Top-level state struct symbol name (resolved via .dbj). Default 'state'."),
  state_read_len: z
    .number()
    .int()
    .min(1)
    .max(256)
    .default(16)
    .describe("Bytes to read from the state struct each poll. Default 16."),
  inputs: z
    .array(
      z.object({
        after_ms: z
          .number()
          .int()
          .min(0)
          .describe("Milliseconds to wait from session start before this input fires"),
        offset_in_state: z
          .number()
          .int()
          .min(0)
          .describe("Byte offset within the state struct to write. 0 = state.<first field>."),
        bytes: z.array(z.number().int().min(0).max(255)).describe("Bytes to write (1 byte typical for action codes)"),
      }),
    )
    .default([])
    .describe("Scripted inputs: scheduled writes into the state struct (the harness input channel)"),
  poll_every_ms: z
    .number()
    .int()
    .min(10)
    .default(250)
    .describe("How often to read state + check for next input. Default 250ms (5 game frames)."),
  max_duration_ms: z
    .number()
    .int()
    .min(100)
    .default(20000)
    .describe("Hard upper bound on session duration. Default 20s."),
  autostart_wait_ms: z
    .number()
    .int()
    .min(0)
    .default(5000)
    .describe("Wait this long after x64sc launch before starting the harness loop (lets autostart complete). Default 5s."),
  capture_screen: z
    .boolean()
    .default(true)
    .describe("Whether to capture the final PETSCII screen render."),
};

export const RunGameOutputSchema = {
  frames_observed: z.number().int().describe("Number of state polls captured"),
  duration_ms: z.number().describe("Total wall-clock duration of the session"),
  state_address: z.number().int().describe("Resolved state symbol address"),
  state_size: z.number().int().describe("Resolved state symbol size"),
  inputs_fired: z.number().int().describe("How many of the scheduled inputs actually fired"),
  trace: z
    .array(
      z.object({
        at_ms: z.number().int(),
        bytes: z.array(z.number().int()),
      }),
    )
    .describe("State snapshots over time"),
  final_screen: z.string().describe("PETSCII render of the screen at session end (empty if capture_screen=false)"),
  exit_reason: z.enum(["max_duration", "error"]).describe("Why the session ended"),
  error: z.string().optional().describe("If exit_reason is 'error', the error message"),
};

export type RunGameInput = {
  prg_path: string;
  dbj_path: string;
  state_symbol?: string;
  state_read_len?: number;
  inputs?: Array<{ after_ms: number; offset_in_state: number; bytes: number[] }>;
  poll_every_ms?: number;
  max_duration_ms?: number;
  autostart_wait_ms?: number;
  capture_screen?: boolean;
};

export type RunGameOutput = {
  frames_observed: number;
  duration_ms: number;
  state_address: number;
  state_size: number;
  inputs_fired: number;
  trace: Array<{ at_ms: number; bytes: number[] }>;
  final_screen: string;
  exit_reason: "max_duration" | "error";
  error?: string;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface DbjVariable {
  name: string;
  start: number;
  end: number;
}

interface DbjFile {
  variables: DbjVariable[];
}

/** Resolve a top-level variable's (address, size) from a .dbj file. */
function resolveSymbol(dbjPath: string, symbol: string): { address: number; size: number } {
  const dbj = JSON.parse(readFileSync(dbjPath, "utf8")) as DbjFile;
  const v = dbj.variables.find(x => x.name === symbol);
  if (!v) {
    throw new Error(`Symbol '${symbol}' not found in ${dbjPath}. Available: ${dbj.variables.map(x => x.name).slice(0, 10).join(", ")}...`);
  }
  return { address: v.start, size: v.end - v.start };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface ViceTool {
  (name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export async function runGame(opts: RunGameInput): Promise<RunGameOutput> {
  const stateSymbol = opts.state_symbol ?? "state";
  const stateReadLen = opts.state_read_len ?? 16;
  const inputs = (opts.inputs ?? []).slice().sort((a, b) => a.after_ms - b.after_ms);
  const pollEveryMs = opts.poll_every_ms ?? 250;
  const maxDurationMs = opts.max_duration_ms ?? 20000;
  const autostartWaitMs = opts.autostart_wait_ms ?? 5000;
  const captureScreen = opts.capture_screen ?? true;

  if (!existsSync(opts.prg_path)) throw new Error(`prg not found: ${opts.prg_path}`);
  if (!existsSync(opts.dbj_path)) throw new Error(`dbj not found: ${opts.dbj_path}`);

  const sym = resolveSymbol(opts.dbj_path, stateSymbol);

  // 1. Kill any existing x64sc on port 6502 to ensure a clean session.
  try { execSync("pkill -f x64sc 2>/dev/null", { stdio: "ignore" }); } catch { /* nothing to kill */ }
  await sleep(500);

  // 2. Spawn fresh x64sc with -autostart: the repo's windowless build when
  //    it exists, else whatever is on PATH (src/services/vice-bin.ts).
  const x64scBin = resolveX64sc()?.path ?? "x64sc";
  const x64sc = spawn(
    x64scBin,
    [
      "-binarymonitor",
      "-binarymonitoraddress", "ip4://127.0.0.1:6502",
      "-autostart", opts.prg_path,
    ],
    { env: DEFAULT_X64SC_ENV, detached: true, stdio: "ignore" },
  );
  x64sc.unref();
  await sleep(autostartWaitMs);

  // 3. Spawn vice-mcp and connect.
  const transport = new StdioClientTransport({ command: "node", args: [DEFAULT_VICE_MCP_PATH] });
  const client = new Client({ name: "c64-run-game", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const tool: ViceTool = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const content = (r as { content?: Array<{ type: string; text: string }> }).content;
    if (!content || !content[0]) throw new Error(`tool ${name}: no content`);
    try { return JSON.parse(content[0].text); }
    catch { throw new Error(`tool ${name} returned non-JSON: ${content[0].text}`); }
  };

  const trace: Array<{ at_ms: number; bytes: number[] }> = [];
  let inputsFired = 0;
  let errMsg: string | undefined;
  let exit: "max_duration" | "error" = "max_duration";
  let finalScreen = "";

  const startedAt = Date.now();
  try {
    await tool("connect");
    await tool("continue");

    let nextInputIdx = 0;
    while (true) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxDurationMs) break;

      // Fire any inputs whose schedule has come due.
      while (nextInputIdx < inputs.length && inputs[nextInputIdx].after_ms <= elapsed) {
        const ev = inputs[nextInputIdx];
        await tool("writeMemory", { address: sym.address + ev.offset_in_state, bytes: ev.bytes });
        await tool("continue");
        inputsFired++;
        nextInputIdx++;
      }

      // Read state.
      const mem = await tool("readMemory", { address: sym.address, length: Math.min(stateReadLen, sym.size) });
      const bytes = (mem.bytes as number[] | undefined) ?? [];
      trace.push({ at_ms: elapsed, bytes });

      // Resume emulator and wait until next poll.
      await tool("continue");
      await sleep(pollEveryMs);
    }

    if (captureScreen) {
      const r = await tool("renderScreen", {});
      finalScreen = (r.render as string | undefined) ?? "";
    }

    await tool("disconnect").catch(() => { /* tolerant teardown */ });
  } catch (e) {
    exit = "error";
    errMsg = e instanceof Error ? e.message : String(e);
  } finally {
    await client.close().catch(() => { /* tolerant teardown */ });
  }

  return {
    frames_observed: trace.length,
    duration_ms: Date.now() - startedAt,
    state_address: sym.address,
    state_size: sym.size,
    inputs_fired: inputsFired,
    trace,
    final_screen: finalScreen,
    exit_reason: exit,
    error: errMsg,
  };
}
