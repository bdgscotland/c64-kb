---
tool: vice-mcp
tool_kind: debug-bridge
maintainer: simen
license: none stated
home_url: https://github.com/simen/vice-mcp
---

<!-- doc-type: toolchain-reference -->

# vice-mcp — MCP Server for VICE Runtime Introspection

## Tool

vice-mcp is an MCP server that bridges AI agents to the VICE Commodore 64 emulator. It speaks the [VICE Binary Monitor Protocol](https://vice-emu.sourceforge.io/vice_13.html) over a TCP socket and exposes VICE's capabilities as MCP tools that return interpreted JSON rather than raw hex bytes.

**Targets:** 6510

Output is interpreted, not raw: `readScreen` returns decoded PETSCII text, not screen codes; `readVicState` returns graphics mode names and color names, not register values; `readSprites` returns visibility analysis with diagnostic hints. Every response also includes a `hint` field and a `_meta` block showing connection state.

vice-mcp is the runtime-introspection half of the agent toolchain. It does not build or assemble code (use [oscar64](../toolchains/oscar64-reference.md) or [KickAssembler](../toolchains/kickassembler-reference.md) for that). It does not run deterministic unit tests (use [sim6502](sim6502-reference.md) for that). It connects to a live emulator process so the agent can read and change machine state.

## Quick Reference

**Prerequisite:** VICE must be running with the binary monitor enabled on port 6502:

```bash
x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502
```

`x64sc` is the cycle-accurate C64 emulator (recommended). `x64` is faster but less accurate.

**Install and register with Claude Code:**

```bash
# Quickest path — run directly from GitHub
claude mcp add vice-mcp -- npx github:simen/vice-mcp

# Or install from npm (when published)
npx @simen/vice-mcp

# Local development build
git clone https://github.com/simen/vice-mcp.git
cd vice-mcp && npm install && npm run build && npm start
```

These lines install upstream simen/vice-mcp (1.0.1, last pushed 2025-12-30), which has no Input Injection tools. For `sendKey` and `pressJoystick` install the fork instead: `claude mcp add vice-mcp -- npx github:bdgscotland/vice-mcp` (1.1.0, pushed 2026-05-18; no pull request against upstream exists as of 2026-09-22, so do not expect `github:simen/vice-mcp` to pick it up). The fork's own README still shows the upstream install lines; ignore them. An earlier version of this page gave only the upstream lines and then documented the fork's tools as if they came with them.

**Manual config** — `claude mcp add` (above) is the normal route; it writes the entry to Claude Code's own store (`~/.claude.json`, or the project's `.mcp.json` with `-s project`). To register by hand, put the block below in the project's `.mcp.json`, or under the top-level `mcpServers` key of `~/.claude.json` for user scope. The upstream README's `~/.claude/claude_desktop_config.json` (which this page used to repeat) is not a path Claude Code reads. `claude_desktop_config.json` is Claude Desktop's file, which lives under `~/Library/Application Support/Claude/` and is only consulted by `claude mcp add-from-claude-desktop`.

```json
{
  "mcpServers": {
    "vice-mcp": {
      "command": "npx",
      "args": ["github:bdgscotland/vice-mcp"]
    }
  }
}
```

Restart Claude Code after adding the server. The server connects lazily; call `connect` before any other tool.

## Tool Surface

The tables below list the 28 tools registered in `src/index.ts` of the bdgscotland fork at 1.1.0 (origin/main commit 7e40b8a): the 26 of simen/vice-mcp 1.0.1 (upstream commit d06d2ef) plus the two Input Injection tools. Counted from `server.registerTool` calls on 2026-09-22; later fork branches add more. An earlier version of this line said 24, copied from the upstream README's architecture diagram, which is stale. These are the exact names an LLM should call.

### Connection

| Tool | Description |
|------|-------------|
| `connect` | Connect to a running VICE instance (default host `127.0.0.1`, port `6502`) |
| `disconnect` | Cleanly close the connection to VICE |
| `status` | Return connection state and whether emulation is running or paused |

### Memory

| Tool | Description |
|------|-------------|
| `readMemory` | Read raw bytes from the C64 address space; returns hex dump, ASCII, and a region hint |
| `writeMemory` | Write an array of bytes to a starting address |

### CPU and Execution

| Tool | Description |
|------|-------------|
| `getRegisters` | Return A, X, Y, SP, PC, and the processor flags register decoded into individual boolean fields and a compact `NV-BDIZC` string |
| `step` | Execute one or more instructions (`count`, default 1); optional `stepOver` to treat JSR as a single instruction |
| `continue` | Resume emulation from a paused state |
| `reset` | Perform a soft or hard reset |
| `runTo` | Set a temporary breakpoint at an address and continue; breakpoint auto-deletes on hit |
| `disassemble` | Disassemble instructions at an address (default: current PC) with KERNAL/BASIC labels |

### Breakpoints and Watchpoints

The text monitor is the interactive twin of this API; its commands, register line and a measured cycle delta between two breakpoints are in `vice-reference.md`, "Text monitor for debugging".

| Tool | Description |
|------|-------------|
| `setBreakpoint` | Set an execution breakpoint; returns a numeric breakpoint ID |
| `deleteBreakpoint` | Delete a breakpoint or watchpoint by ID |
| `listBreakpoints` | List all breakpoints set in the current session |
| `toggleBreakpoint` | Enable or disable a breakpoint without deleting it |
| `setWatchpoint` | Set a memory read/write watchpoint on an address or address range; type is `"load"`, `"store"`, or `"both"` |
| `listWatchpoints` | List all watchpoints set in the current session |

### Semantic Layer

| Tool | Description |
|------|-------------|
| `readScreen` | Read screen RAM and return PETSCII-decoded text lines; `format: "summary"` returns only non-empty lines |
| `readColorRam` | Read color RAM ($D800–$DBE7) and return color names, a 25×40 grid, and a usage summary |
| `readVicState` | Return a fully interpreted VIC-II snapshot: graphics mode, colors, bank, scroll, raster line, sprite enable/visibility summary |
| `readSprites` | Return position, color, enable, expansion, priority, and data-pointer address for all 8 sprites; optional `enabledOnly` filter |

### Visual

| Tool | Description |
|------|-------------|
| `screenshot` | Capture the display buffer (raw pixel data base64-encoded) with optional palette |
| `renderScreen` | Render the current screen as ASCII art |

### Input Injection

Available only in the bdgscotland fork (1.1.0); see the install note in Quick Reference. With them an agent can drive code that reads the keyboard or joystick without JSR-NOP patching of joystick poll routines.

| Tool | Description |
|------|-------------|
| `sendKey` | Feed PETSCII bytes and/or symbolic key names (`RETURN`, `RUN_STOP`, `F1`–`F8`, cursor keys, color keys, case shift) into the kernal keyboard buffer. Max 255 bytes per call. RESTORE cannot be injected — it is a hardwired NMI key, not a buffer entry. |
| `pressJoystick` | Set the state of control port 1 or 2. Inputs: `port` (1 or 2), `directions` (subset of `up`/`down`/`left`/`right`), `fire`. Pure state setter — call again with empty directions and `fire:false` to release. Hold timing is the caller's responsibility (compose with `continue` + wall-clock waits, or with `step` using its `count` parameter — `step` wraps binary-monitor command 0x71 Advance Instructions; there is no separate `advanceInstructions` tool, though an earlier version of this row named one). |

Typical loop:

```
pressJoystick({port:2, directions:['right'], fire:true})
// let the game react (wall-clock sleep, or stepped frames)
pressJoystick({port:2, directions:[], fire:false})
readSprites() or readMemory($DC00) to verify
```

Verify a keypress reached BASIC:

```
sendKey({text:'PRINT 1+1', keys:['RETURN']})
// wait
readScreen() → expect "2" on the response line
```

### State Management

| Tool | Description |
|------|-------------|
| `saveSnapshot` | Save complete machine state (RAM, CPU registers, VIC-II, SID, CIA, disk state) to a `.vsf` file |
| `loadSnapshot` | Restore machine state from a `.vsf` file |
| `loadProgram` | Load and optionally autostart a `.prg`, `.d64`, or `.t64` file |

## Semantic Layer

The four semantic-layer tools are the main reason to use vice-mcp rather than the raw binary monitor. They translate register values into named fields.

### readVicState

Reads all 47 VIC-II registers ($D000–$D02E) and CIA2 ($DD00 for bank selection). Returns:

- `graphicsMode` — one of `"standard text"`, `"multicolor text"`, `"standard bitmap"`, `"multicolor bitmap"`, or `"extended background color"`; ECM set together with BMM or MCM is reported as the single string `"invalid (ECM + other modes)"` (strings from `src/utils/c64.ts`; an earlier version of this line said `"extended color text"` and "combinations thereof", neither of which the code emits)
- `bitmap` / `multicolor` / `extendedColor` — the raw BMM ($D011 bit 5), MCM ($D016 bit 4) and ECM ($D011 bit 6) flags as booleans, so an invalid combination can still be read bit by bit
- `borderColor` / `backgroundColor` — objects with `value` (0–15) and `name` (e.g., `"light blue"`)
- `vicBank` — bank index (0–3) and `baseAddress` ($0000, $4000, $8000, $C000)
- `screenAddress` / `charAddress` — absolute addresses derived from $D018 and the active bank
- `rasterLine` — 9-bit current raster position
- `spriteEnable` — raw byte plus `enabledSprites` and `visibleSprites` arrays
- `scrollX` / `scrollY` — fine-scroll values (0–7)
- `rows` / `columns` — 25/24 and 40/38 depending on border bits
- `displayEnabled` — DEN flag ($D011 bit 4)
- `hint` — diagnostic string, e.g., `"standard text mode, 3 sprites enabled but only 2 visible. Use readSprites() for details."`

One call returns the whole video configuration; the agent needs no knowledge of VIC-II register layouts.

### readSprites

Reads VIC-II registers plus sprite pointer slots at `screenAddress + $3F8`. For each sprite (0–7) returns:

- `enabled` — whether the VIC-II sprite-enable bit is set
- `position.x` / `position.y` — resolved 9-bit X position and 8-bit Y position
- `position.visible` — computed visibility check (on-screen coordinates)
- `position.visibilityReason` — plain-text explanation if not visible
- `color` — color index and name
- `multicolor`, `expandX`, `expandY`, `priority` (`"front"` or `"behind"`)
- `dataAddress` — absolute address of sprite data in the active VIC bank, with a `region` classification and a `warning` string for suspicious addresses (e.g., pointing into ROM or the zero page)

Problems it flags: sprite off-screen, wrong bank, data pointer pointing into ROM.

## Watchpoint Workflow

Watchpoints stop emulation when a memory address is read or written. The usual pattern for catching a raster interrupt mid-frame:

```
1. connect()
2. loadProgram("demo.prg")
3. setWatchpoint(startAddress: 0xD012, type: "store")
   → Emulation stops the next time code writes to the raster compare register
4. continue()
5. getRegisters()
   → PC is the instruction AFTER the one that wrote $D012, and the write has already landed.
     VICE stops at the instruction boundary once the writer retires (measured in x64sc 3.10:
     a store watchpoint on screen RAM stopped with PC=$EA20, the STA ($D1),Y at $EA1E;
     a test STA $0400 at $081C stopped with PC=$081F). The writer is the instruction
     immediately before PC — back up by its own length (3 for STA abs, 2 for STA (zp),Y),
     or disassemble from a few bytes earlier and read forward to PC, since a backward
     6502 disassembly can mis-align. An earlier version of this step said PC was the writer.
6. disassemble()
   → See the raster IRQ setup code
7. readVicState()
   → Confirm current raster line, graphics mode, and border color
```

For screen RAM writes (debugging sprite or character corruption):

```
setWatchpoint(startAddress: 0x0400, endAddress: 0x07FF, type: "store")
continue()
getRegisters()   → PC is just past the writer; the writer ends at PC-1
disassemble()    → Understand what wrote there
```

Breakpoints and watchpoints share the same ID namespace. `deleteBreakpoint(id)` removes both.

**Checkpoint count:** no ceiling was found in x64sc 3.10 — 20,000 simultaneous checkpoints were accepted over the binary monitor with no error response, IDs 1..20000, and one set afterwards still fired (measured 2026-09-22; a malformed request in the same run did return an error, so the zero-error count is real). An earlier version of this paragraph claimed an internal limit that made `setWatchpoint`/`setBreakpoint` fail; no such limit was reached. Delete checkpoints you no longer need anyway: a forgotten one with stop set halts the emulator somewhere you did not expect, and `listBreakpoints`/`listWatchpoints` only know about the ones this vice-mcp session created.

## State Checkpoints

`saveSnapshot` and `loadSnapshot` wrap VICE's native snapshot format (`.vsf`). The snapshot captures all memory, CPU registers, VIC-II, SID, CIA states, and attached drive state, so an agent loop can return to a known state:

```
saveSnapshot("before-sprite-test.vsf")

; run experiments, write memory, toggle bits
writeMemory(0xD015, [0x03])   → enable sprites 0 and 1
readVicState()                → confirm state
readSprites()                 → check positions

loadSnapshot("before-sprite-test.vsf")
; machine is back to the saved state exactly
```

Snapshot/restore is significantly faster than a full machine `reset` + `loadProgram` cycle.

Snapshot files accumulate on disk. The VICE binary monitor protocol codes for these operations are `0x41` (Dump) and `0x42` (Undump).

## Pairing with c64-kb

vice-mcp reads the running machine; c64-kb supplies the reference facts. In an agent loop:

**Example: agent debugging a VIC-II display-enable issue**

```
1. c64_lookup_register D011
   → Returns: bit 4 = DEN (Display Enable), 1 = screen on, 0 = blank

2. connect()
   readMemory(address: 0xD011, length: 1)
   → Returns: raw byte, e.g. 0x1B

3. readVicState()
   → Returns: displayEnabled: true, graphicsMode: "standard text", etc.

4. ; Agent suspects blanked screen, tries clearing DEN to reproduce
   writeMemory(address: 0xD011, bytes: [0x0B])

5. readVicState()
   → displayEnabled: false, hint: "Display is blanked (DEN=0) - screen shows border color only"

6. ; Agent restores
   writeMemory(address: 0xD011, bytes: [0x1B])
```

**Example: agent verifying a KERNAL call reach**

```
1. c64_lookup_kernal CHROUT
   → Address: $FFD2, JSR to output character in A to current device

2. setBreakpoint(address: 0xFFD2)
   continue()

3. ; breakpoint hit
   getRegisters()
   → A: 0x48 ("H" in PETSCII), confirms code is calling CHROUT

4. disassemble()
   → Shows the JSR $FFD2 instruction at caller's PC
```

**Example: verifying a SID register write**

```
1. c64_lookup_register D400
   → SID: voice 1 frequency low byte

2. c64_search "SID voice frequency register"
   → Returns documentation on 16-bit frequency calculation

3. setWatchpoint(startAddress: 0xD400, endAddress: 0xD41C, type: "store")
   continue()
   getRegisters()
   → PC is the SID initialization code
```

## Pairing with sim6502

vice-mcp and sim6502 do different jobs:

- **sim6502** runs fast, deterministic, headless tests against either an internal CPU simulator or the VICE backend. It is the CI gate: green means every assertion passed.
- **vice-mcp** connects to a live VICE instance for interactive debugging. Use it when a sim6502 test fails and the cause is not clear.

**Recommended workflow:**

```
Write code → Build with Oscar64/KickAssembler
  ↓
Run sim6502 tests (--backend sim, fast)
  ↓ pass
Run sim6502 tests (--backend vice, hardware-accurate)
  ↓ fail
Use vice-mcp interactively:
  connect() → loadProgram() → setBreakpoint() → continue()
  → readVicState() / readSprites() / disassemble()
  → identify root cause
  ↓
Fix code → repeat
```

sim6502's `--backend vice` does not talk to this server: it connects to the embedded MCP server of barryw/vice-mcp, a separate VICE fork (`x64sc -mcpserver`, port 6510, see [sim6502-reference.md](sim6502-reference.md)), which is not a fork of simen/vice-mcp and does not expose these tool names. Run sim6502 tests first, then start an interactive vice-mcp session against `-binarymonitor` on port 6502; do not assume one VICE instance is serving both at once. An earlier version of this paragraph said sim6502 used this server's `saveSnapshot`/`loadSnapshot`; no document in this repo shows that.

## Pitfalls

**Connection drops require VICE restart.** If `x64sc` crashes or is restarted while vice-mcp is connected, the TCP socket becomes invalid. Call `disconnect()`, restart VICE with `-binarymonitor`, then call `connect()` again. The MCP server process itself does not need to be restarted.

**Stale checkpoints.** There is no known checkpoint ceiling (see Watchpoint Workflow; an earlier version of this pitfall claimed a finite table that failed silently), but a checkpoint you forgot, with stop set, halts the emulator at an unexpected place, and the list tools cannot show you one set outside this session. Call `listWatchpoints` and `listBreakpoints` and delete what you no longer need.

**Screenshot performance.** `screenshot` transfers the full display buffer (raw pixel data, base64-encoded). It is larger than any other vice-mcp response and can be slow on slow machines or over a network. Prefer `readScreen` (text) or `readVicState` (semantic) for non-visual checks.

**Session-local checkpoint tracking.** `listBreakpoints` and `listWatchpoints` only return checkpoints set through the current vice-mcp session. Breakpoints set directly via VICE's built-in monitor UI or command line are not visible to these tools.

**Snapshot file paths.** `saveSnapshot` and `loadSnapshot` use paths relative to the VICE process's working directory, not the agent's working directory. Use absolute paths to avoid surprises.

## See Also

- [vice-reference.md](vice-reference.md) — The VICE emulator itself: how to install, launch options, disk image handling
- [sim6502-reference.md](sim6502-reference.md) — Deterministic 6502 unit tests; pairs with vice-mcp for the full test loop
- [../hardware/c64-registers-reference.md](../hardware/c64-registers-reference.md) — C64 register reference; use with `c64_lookup_register` to interpret vice-mcp readouts
