---
tool: retrodebugger
tool_kind: emulator
maintainer: Marcin Skoczylas (Slajerek/Samar)
license: NOASSERTION
home_url: https://github.com/slajerek/RetroDebugger
version_verified: "1.0.0"
---

<!-- doc-type: toolchain-reference -->

# Retro Debugger (formerly C64 Debugger)

## Tool

Retro Debugger is a graphical real-time debugger for the C64, Atari
XL/XE and NES: VICE, Atari800 and NestopiaUE engines inside one ImGui
window with disassembly, memory maps, VIC/SID/CIA state views, a VIC
editor, breakpoints, a timeline, and the 1541's CPU and disk. It is the
successor of the C64 65XE NES Debugger. It is built for a person at the
screen. Since v1.0.0 it also carries an MCP server, so an agent can drive
it; that part is described below as measured, with its limits.

Everything marked "measured" was run on 2026-09-24 with the release
`RetroDebugger-v1.0.0-macOS-hotfix.zip` (published 2026-06-03, SHA-256
`b18e3ca7e7c955316d51d40f43e7d0a91756727af32b53c0595adb82eaca0fdb`) on
macOS arm64. `--version` prints:

```text
Retro Debugger v1.0.0 by Slajerek/Samar
VICE 3.10 by The VICE Team
Atari 800 Emulator, Version 5.0.0
NestopiaUE, Version 1.51.1
```

The C64 engine is VICE 3.10, not the 3.1 the project README still names
(and #19's candidate note repeated); the release notes list the upgrade
as in progress.

Licence: the README says "some kind of FSF license" and points to the
C64 65XE NES Debugger's, which the bundled manual gives as GPL-2.0 or
later. The repository has no LICENSE file, so the frontmatter says
`NOASSERTION`.

**Targets:** 6510, VIC-II, SID, CIA1, CIA2

## Install

Download the zip for the platform from the GitHub releases page and
unzip; on macOS it is `Retro Debugger.app`, a universal binary (x86_64
and arm64, per `file`), signed with the hardened runtime. Linux x64 and
ARM64 and Windows x64 zips sit beside it. The KERNAL, BASIC and character
ROMs were found without any setup on this machine (the MCP read of
`$E000` matched `kernal-901227-03.bin` byte for byte); the README says to
set ROMs up in Settings, so another machine may need that step.

## Command line

`-help` printed these C64 options (measured; the Atari and NES ones are
left out):

| Option | Effect |
|---|---|
| `-prg <file>`, `-d64 <file>`, `-tap <file>`, `-crt <file>`, `-reu <file>`, `-snapshot <file>` | Load or attach |
| `-jmp <addr>`, `-autojmp`, `-alwaysjmp` | Jump to an address, to the SYS target of a BASIC line, or always to the load address |
| `-autorundisk` | Load the first PRG from the inserted disk |
| `-symbols <file>`, `-debuginfo <file>`, `-breakpoints <file>`, `-watch <file>` | Labels, `.dbg` debug info, breakpoints, watches |
| `-wait <ms>` | Wait before doing the above |
| `-unpause`, `-reset` | Run; hard reset |
| `-pass` | Pass the options to an instance already running |
| `-clearsettings` | Forget all settings |

The bundled manual says other options go to the emulator engine (VICE's
own). The MCP options are not in `-help`; they are read from the source
(`src/RetroDebuggerAppInit.cpp`): `--mcp-server` or `--mcp-headless`
starts an MCP server on stdin/stdout; `--mcp-live` starts a bridge to an
instance already running, over its WebSocket server (default
`127.0.0.1`, port `$0DEB` = 3563, path `/stream`).

## The MCP server, measured

Started as `"Retro Debugger.app/Contents/MacOS/Retro Debugger"
--mcp-headless` and spoken to over stdio (JSON-RPC, one message per line):

- `initialize` answered at once: server `retrodebugger` 1.0.0, protocol
  `2024-11-05`, with tools, resources and prompts.
- `tools/list` gave 42 tools in 1.0.0: `retro_load`, `retro_pause`,
  `retro_continue`, `retro_cpu_jump`, `retro_cpu_status`,
  `retro_memory_read` / `_write` / `_search`, breakpoints and memory
  breakpoints, stepping by instruction, cycle or subroutine, snapshots,
  joystick and key input, `retro_disassemble`, `retro_assemble`,
  `retro_screenshot`, and others. Resources include C64 and 1541 memory
  maps as text.
- **The emulation runs at about real speed**: 747 frames 15 s after
  start. `retro_warp` exists; it was not measured.
- **This loop ran a program and read the result**: wait 6 s (the boot
  reaches `READY.`; a load during the boot was not tried), `retro_load`
  the PRG (the bytes appeared at `$0801`), `retro_pause`, `retro_cpu_jump` to `$080D`, `retro_continue`,
  wait 3 s, then `retro_screenshot` with `savePath`. With the
  [ACME hello world](../toolchains/acme-reference.md) this gave `$D020` =
  `$F2` (red), PC at the program's final `jmp *`, and a 384 x 272 PNG in
  which `HELLO, WORLD!` decodes on screen row 7 at the same geometry as
  VICE's exit screenshot ([vice-reference.md](vice-reference.md),
  "Reading the exit screenshot").
- **The palette is not VICE's default.** Red was (129, 51, 56) and the
  screen blue (46, 44, 155), where x64sc `-default` gives (175, 60, 88)
  and (44, 61, 236). A script that recognises colours by triple needs a
  table for this program.
- **`retro_load` does not check the path.** A path to a file that did
  not exist also returned `"status": "loaded"`.
- **A memory read that runs past `$FFFF`** (16 bytes from `$FFFA`)
  returned `"status": 413` and no data.
- **It is not windowless.** With `--mcp-headless` the process still
  registered with macOS as a foreground application (`lsappinfo`, type
  `Foreground`). For batch runs the windowless x64sc is the tool
  ([vice-reference.md](vice-reference.md), "A windowless build for batch
  runs").
- **It is not yet reliable enough for a gate.** In 3 of 15
  launches the process exited within seconds (the MCP pipe closed; in one,
  before any load), with nothing on stderr. The cause was not found.

The project ships a guide for agents, `docs/mcp/retrodebugger-mcp-skill.md`
in the repository (not in the release zip), which lists the tools and
some WebSocket endpoints not yet wrapped as tools (VIC, SID, CIA and
1541 VIA registers, `c64/savePrg`).

## When to use it

For a person stepping through code with every chip's state on screen, or
for an agent that wants a live, pausable machine with breakpoints and
snapshots over MCP. For a pass/fail check in a script or CI, use the
headless x64sc with a pinned cycle count: its runs are repeatable and it
opens no window. Nothing in this knowledge base's gates uses Retro
Debugger.

## See also

- [vice-reference.md](vice-reference.md): headless runs, the binary and
  text monitors.
- [vice-mcp-reference.md](vice-mcp-reference.md): another MCP bridge to
  VICE.
