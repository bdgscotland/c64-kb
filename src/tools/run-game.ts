// src/tools/run-game.ts — c64_run_game MCP tool.
//
// Spawns x64sc with -autostart, connects through vice-mcp (VICE_MCP_PATH),
// drives the parallel-input-cell pattern (the program polls a state struct
// this tool writes into), and returns a state trace + final screen render.
//
// This is the substrate layer the c64-kb MCP exposes for game
// development. Claude Code calls it from a session to verify a
// freshly-built .prg actually runs and reaches expected states.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { resolveX64sc } from "../services/vice-bin.ts";
import { getVersions } from "../services/versions.ts";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_VICE_MCP_PATH = process.env.VICE_MCP_PATH ?? "vice-mcp/dist/index.js";

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
        bytes: z
          .array(z.number().int().min(0).max(255))
          .describe("Bytes to write (1 byte typical for action codes)"),
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
    .describe(
      "Wait this long after x64sc launch before starting the harness loop (lets autostart complete). Default 5s.",
    ),
  capture_screen: z.boolean().default(true).describe("Whether to capture the final PETSCII screen render."),
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
  final_screen: z
    .string()
    .describe("PETSCII render of the screen at session end (empty if capture_screen=false)"),
  exit_reason: z.enum(["max_duration", "error"]).describe("Why the session ended"),
  error: z.string().optional().describe("If exit_reason is 'error', the error message"),
};

export type RunGameInput = {
  prg_path: string;
  dbj_path: string;
  state_symbol?: string;
  state_read_len?: number;
  inputs?: { after_ms: number; offset_in_state: number; bytes: number[] }[];
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
  trace: { at_ms: number; bytes: number[] }[];
  final_screen: string;
  exit_reason: "max_duration" | "error";
  error?: string;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

// The .dbj is JSON from disk: validated rather than cast.
const DbjSchema = z.object({
  variables: z.array(z.object({ name: z.string(), start: z.number(), end: z.number() })),
});

/** Resolve a top-level variable's (address, size) from a .dbj file. */
function resolveSymbol(dbjPath: string, symbol: string): { address: number; size: number } {
  const dbj = DbjSchema.parse(JSON.parse(readFileSync(dbjPath, "utf8")));
  const v = dbj.variables.find((x) => x.name === symbol);
  if (!v) {
    throw new Error(
      `Symbol '${symbol}' not found in ${dbjPath}. Available: ${dbj.variables
        .map((x) => x.name)
        .slice(0, 10)
        .join(", ")}...`,
    );
  }
  return { address: v.start, size: v.end - v.start };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type ViceTool = (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
type ScheduledInput = { after_ms: number; offset_in_state: number; bytes: number[] };

const ViceReplySchema = z.record(z.string(), z.unknown());

/**
 * Kill the x64sc a previous run left on monitor port 6502, and only that
 * one: a bare `pkill -f x64sc` also killed a parallel verify:recipes run
 * and any VICE the user had open.
 */
function killPreviousVice(): void {
  try {
    execSync(`pkill -f "x64sc.*-binarymonitoraddress ip4://127.0.0.1:6502" 2>/dev/null`, { stdio: "ignore" });
  } catch (e) {
    // pkill exits 1 when no process matched: there was nothing to kill.
    if (e instanceof Error && "status" in e && e.status === 1) return;
    console.error("c64_run_game: pkill of the previous x64sc failed:", e);
  }
}

/** Spawn x64sc with -autostart: the repo's windowless build when it exists, else whatever is on PATH (src/services/vice-bin.ts). */
function launchVice(prgPath: string): void {
  const x64scBin = resolveX64sc()?.path ?? "x64sc";
  const x64sc = spawn(
    x64scBin,
    ["-binarymonitor", "-binarymonitoraddress", "ip4://127.0.0.1:6502", "-autostart", prgPath],
    { env: DEFAULT_X64SC_ENV, detached: true, stdio: "ignore" },
  );
  x64sc.unref();
}

/** Call one vice-mcp tool and return its JSON reply as an object. */
function viceTool(client: Client): ViceTool {
  return async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const content = z.array(z.object({ text: z.string() }).loose()).safeParse(r.content);
    const first = content.success ? content.data.at(0) : undefined;
    if (!first) throw new Error(`tool ${name}: no content`);
    // An error reply is text, so without this check it surfaced as the
    // misleading "returned non-JSON".
    if (r.isError) throw new Error(`tool ${name} failed: ${first.text}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(first.text);
    } catch {
      throw new Error(`tool ${name} returned non-JSON: ${first.text}`);
    }
    const reply = ViceReplySchema.safeParse(parsed);
    if (!reply.success) throw new Error(`tool ${name} returned JSON that is not an object: ${first.text}`);
    return reply.data;
  };
}

/** What the harness has seen so far; filled in place so an error mid-run still reports it. */
interface HarnessState {
  trace: { at_ms: number; bytes: number[] }[];
  inputsFired: number;
  finalScreen: string;
}

interface HarnessPlan {
  sym: { address: number; size: number };
  inputs: ScheduledInput[];
  stateReadLen: number;
  pollEveryMs: number;
  maxDurationMs: number;
  captureScreen: boolean;
}

/** Fire every scheduled input whose time has come. Inputs are sorted, so the next one is at index inputsFired. */
async function fireDueInputs(
  tool: ViceTool,
  plan: HarnessPlan,
  st: HarnessState,
  elapsed: number,
): Promise<void> {
  for (
    let ev = plan.inputs.at(st.inputsFired);
    ev && ev.after_ms <= elapsed;
    ev = plan.inputs.at(st.inputsFired)
  ) {
    await tool("writeMemory", { address: plan.sym.address + ev.offset_in_state, bytes: ev.bytes });
    await tool("continue");
    st.inputsFired++;
  }
}

async function runHarness(
  tool: ViceTool,
  plan: HarnessPlan,
  st: HarnessState,
  startedAt: number,
): Promise<void> {
  await tool("connect");
  await tool("continue");

  for (let elapsed = Date.now() - startedAt; elapsed < plan.maxDurationMs; elapsed = Date.now() - startedAt) {
    await fireDueInputs(tool, plan, st, elapsed);
    const mem = await tool("readMemory", {
      address: plan.sym.address,
      length: Math.min(plan.stateReadLen, plan.sym.size),
    });
    const bytes = z.array(z.number()).safeParse(mem.bytes);
    st.trace.push({ at_ms: elapsed, bytes: bytes.success ? bytes.data : [] });
    // Resume emulator and wait until next poll.
    await tool("continue");
    await sleep(plan.pollEveryMs);
  }

  if (plan.captureScreen) {
    const r = await tool("renderScreen", {});
    st.finalScreen = typeof r.render === "string" ? r.render : "";
  }

  await tool("disconnect").catch((e: unknown) => {
    console.error("c64_run_game: vice-mcp disconnect failed:", e);
  });
}

function planFrom(opts: RunGameInput, sym: { address: number; size: number }): HarnessPlan {
  return {
    sym,
    inputs: (opts.inputs ?? []).slice().sort((a, b) => a.after_ms - b.after_ms),
    stateReadLen: opts.state_read_len ?? 16,
    pollEveryMs: opts.poll_every_ms ?? 250,
    maxDurationMs: opts.max_duration_ms ?? 20000,
    captureScreen: opts.capture_screen ?? true,
  };
}

export async function runGame(opts: RunGameInput): Promise<RunGameOutput> {
  if (!existsSync(opts.prg_path)) throw new Error(`prg not found: ${opts.prg_path}`);
  if (!existsSync(opts.dbj_path)) throw new Error(`dbj not found: ${opts.dbj_path}`);

  const sym = resolveSymbol(opts.dbj_path, opts.state_symbol ?? "state");
  const plan = planFrom(opts, sym);

  killPreviousVice();
  await sleep(500);
  launchVice(opts.prg_path);
  await sleep(opts.autostart_wait_ms ?? 5000);

  // Spawn vice-mcp and connect.
  const transport = new StdioClientTransport({ command: "node", args: [DEFAULT_VICE_MCP_PATH] });
  const client = new Client({ name: "c64-run-game", version: getVersions().package }, { capabilities: {} });
  await client.connect(transport);

  const st: HarnessState = { trace: [], inputsFired: 0, finalScreen: "" };
  let errMsg: string | undefined;
  const startedAt = Date.now();
  try {
    await runHarness(viceTool(client), plan, st, startedAt);
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  } finally {
    await client.close().catch((e: unknown) => {
      console.error("c64_run_game: closing the vice-mcp client failed:", e);
    });
  }

  return {
    frames_observed: st.trace.length,
    duration_ms: Date.now() - startedAt,
    state_address: sym.address,
    state_size: sym.size,
    inputs_fired: st.inputsFired,
    trace: st.trace,
    final_screen: st.finalScreen,
    exit_reason: errMsg === undefined ? "max_duration" : "error",
    ...(errMsg === undefined ? {} : { error: errMsg }),
  };
}
