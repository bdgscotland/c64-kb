/** Runtime tools (the eval substrate): run a built PRG in VICE. */

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { runGame, RunGameInputSchema, RunGameOutputSchema } from "../tools/run-game.ts";
import { defineTool, type ToolReply } from "./define-tool.ts";

/** c64_run_game kills the x64sc on monitor port 6502 and starts a new one. */
const RUN_GAME: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

type RunGameArgs = Parameters<typeof runGame>[0] & { inputs: unknown[] };

async function runGameReply(args: RunGameArgs): Promise<ToolReply> {
  const r = await runGame(args);
  const summary =
    `c64_run_game: ${r.exit_reason} after ${r.duration_ms}ms\n` +
    `  state @ $${r.state_address.toString(16).padStart(4, "0")} (size ${r.state_size})\n` +
    `  ${r.frames_observed} polls, ${r.inputs_fired}/${args.inputs.length} inputs fired\n` +
    (r.error ? `  error: ${r.error}\n` : "") +
    (r.final_screen ? `\n--- final screen ---\n${r.final_screen}\n` : "");
  // A caught VICE failure comes back as exit_reason "error"; without
  // isError an MCP client read it as success.
  return { text: summary, structured: r, isError: r.exit_reason === "error" };
}

export const runGameTool = defineTool({
  name: "c64_run_game",
  title: "Run a PRG in VICE and trace its state",
  description: `Spawn x64sc with -autostart for the given .prg, drive it via the parallel-input-cell harness pattern (writeMemory into the game's state struct), and return a state trace + final screen render. The eval substrate primitive — used to verify a built game reaches expected states.

Inputs:
  - prg_path (required): absolute path to the .prg to run
  - dbj_path (required): absolute path to the matching .dbj (typed debug info; oscar64 -g produces this)
  - state_symbol (optional, default "state"): top-level state struct symbol name
  - state_read_len (optional, default 16): bytes to read per poll
  - inputs (optional): scheduled writes into the state struct — each {after_ms, offset_in_state, bytes}. Use this to drive harness inputs (e.g. write 1 to state.start_request to simulate a "press fire").
  - poll_every_ms (optional, default 250): state-polling cadence
  - max_duration_ms (optional, default 20000): session hard cap
  - autostart_wait_ms (optional, default 5000): time after x64sc launch before harness loop starts (lets autostart settle)
  - capture_screen (optional, default true): render the final screen

Output: structured RunGameOutput with state_address, state_size, frames_observed, inputs_fired, trace[{at_ms, bytes}], final_screen, exit_reason.

Limitations: stops only an x64sc a previous run left on monitor port 6502, so parallel emulator runs are safe. Uses the repo's windowless VICE in .tools/ when present, else x64sc on PATH. Needs the .dbj file oscar64 -g writes, so it runs Oscar64 builds only. Designed for the parallel-input-cell pattern (the program polls a state struct the tool writes into); games that must be driven from breakpoints don't fit.

Example: {"prg_path": "/.../unlock-trap.prg", "dbj_path": "/.../unlock-trap.dbj", "inputs": [{"after_ms": 1000, "offset_in_state": 9, "bytes": [1]}, {"after_ms": 2000, "offset_in_state": 8, "bytes": [1]}], "max_duration_ms": 8000}`,
  inputSchema: RunGameInputSchema,
  outputSchema: RunGameOutputSchema,
  annotations: RUN_GAME,
  readsGraph: false,
  run: runGameReply,
});
