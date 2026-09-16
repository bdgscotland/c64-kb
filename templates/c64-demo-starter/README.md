# c64-demo-starter

A starter template for C64 intros and cracktros, scaffolded from
[c64-kb](https://github.com/your-org/c64-kb). Builds a runnable `.prg` with
Oscar64 and a KickAssembler escape-hatch stub for cycle-tight routines.

## Prerequisites

**Oscar64 is NOT in Homebrew.** Build from source (one-time, ~2 min):

```bash
git clone https://github.com/drmortalwombat/oscar64 ~/Developer/oscar64
cd ~/Developer/oscar64/make && make -j4
# binary now at ~/Developer/oscar64/bin/oscar64
# either add to PATH, or set OSCAR64=... when invoking make:
OSCAR64=~/Developer/oscar64/bin/oscar64 make
```

| Tool | Install |
|------|---------|
| **Oscar64** | See block above. The `oscar64` binary must be on your PATH, or set the `OSCAR64` environment variable. |
| **KickAssembler** | Download `KickAssembler.zip` from http://theweb.dk/KickAssembler/ and unzip to a local directory. Update the `KICKASS` variable in the Makefile to point at your `KickAss.jar`. Requires Java 11+. |
| **Java 11+** | Required to run KickAssembler. Install via your OS package manager or https://adoptium.net/. |
| **c64-kb** | Clone the c64-kb repo as a sibling of this project and build it: `npm install && npm run build`. The `.mcp.json` references `../../dist/cli.js`. |
| **VICE** | `brew install vice` on macOS. Provides `x64sc` / `x64` on PATH. Required to load + run `.prg` files. |
| **vice-mcp** (recommended) | Lets an AI agent drive VICE: load .prg, screenshot, memory inspect, breakpoints. Clone https://github.com/simen/vice-mcp, `npm install && npm run build`, then add to `.mcp.json` (already done in this template — update the path if your checkout lives elsewhere). |
| **sim6502** (optional) | Unit-test framework for 6502 code. C# project at https://github.com/barryw/sim6502 — install .NET 6+ and build. Not required for the demo build. |

## Quick start

```bash
# 1. Build main.prg
make

# 2. Load in VICE
make run
# or: x64 main.prg
```

If `oscar64` is not installed, `make` prints a clear error message and exits
without attempting to compile.

## Project layout

```
c64-demo-starter/
  src/
    main.c            Oscar64 C entry point (raster bars + welcome message)
    asm/
      raster.asm      KickAssembler escape-hatch stub (external-asm linking)
  assets/
    sprites/          Drop .spd sprite files here
    charsets/         Drop .ctm charset / koala .kla files here
    music/            Drop .sid music files here
  Makefile            Build: all, clean, run, check
  CLAUDE.md           Agent-facing workflow and tool reference (read this first)
  README.md           This file
  .mcp.json           Wires c64-kb MCP server
  .gitignore          Excludes build artifacts
```

## Customising

1. Open `CLAUDE.md` for the full agent workflow.
2. Call `c64_demo_briefing("your idea")` as the first MCP tool call.
3. Edit `src/main.c` to build out the raster effect chain.
4. Put cycle-tight inner loops in `src/asm/raster.asm` (KickAssembler).
5. Drop asset files in `assets/` and reference them with `#embed` in main.c.

## See also

- `CLAUDE.md` — agent workflow, toolchain ranking, MCP tool list
- `docs/recipes/oscar64/stable-raster-irq.md` — canonical raster IRQ pattern
- `docs/recipes/kickassembler/cracktro-template.md` — full cracktro structure
- c64-kb MCP tools: `c64_demo_briefing`, `c64_technique_lookup`, `c64_timing_budget`
