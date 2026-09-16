# c64-game-starter

A starter template for C64 games, scaffolded from
[c64-kb](https://github.com/your-org/c64-kb). Builds a runnable `.prg` with
Oscar64 and a KickAssembler escape-hatch stub for a 24-sprite multiplexer.

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
| **sim6502** (optional) | Unit-test framework for 6502 code. C# project at https://github.com/barryw/sim6502 — install .NET 6+ and build. Not required for the game build. |

## Quick start

```bash
# 1. Build game.prg
make

# 2. Load in VICE — joystick port 2, push to move
make run
# or: x64 game.prg
```

If `oscar64` is not installed, `make` prints a clear error message and exits
without attempting to compile.

## Project layout

```
c64-game-starter/
  src/
    main.c            Oscar64 C entry point (joystick + sprite + score HUD)
    asm/
      sprites.asm     KickAssembler 24-sprite multiplexer stub
  assets/
    sprites/          Drop .spd sprite files here (SpritePad format)
    charsets/         Drop .ctm charset / koala .kla bitmap files here
    music/            Drop .sid music files here
  Makefile            Build: all, clean, run, check
  CLAUDE.md           Agent-facing workflow and tool reference (read this first)
  README.md           This file
  .mcp.json           Wires c64-kb MCP server
  .gitignore          Excludes build artifacts
```

## Asset conventions (for agents)

- **sprites/**: drop SpritePad `.spd` files here. Load with
  `#embed spd_sprites "assets/sprites/player.spd"` in main.c.
- **charsets/**: drop CharPad `.ctm` files or Koala `.kla` bitmaps here.
  Load with `#embed ctm_chars "assets/charsets/tiles.ctm"`.
- **music/**: drop `.sid` files here. Embed the player binary and call its
  init/play addresses following `docs/recipes/oscar64/sid-music-player.md`.

## Customising

1. Open `CLAUDE.md` for the full agent workflow.
2. Call `c64_game_briefing("your idea", archetype="shmup")` as the first MCP
   tool call.
3. Edit `src/main.c` to build out the game loop (bullets, enemies, collision).
4. Fill in `src/asm/sprites.asm` when you need more than 8 sprites on screen.
5. Drop asset files in `assets/` and reference them with `#embed` in main.c.

## See also

- `CLAUDE.md` — agent workflow, toolchain ranking, MCP tool list
- `docs/recipes/oscar64/simple-shmup.md` — full shmup scaffold with vspr_*
- `docs/recipes/kickassembler/sprite-multiplex-24.md` — 24-sprite multiplexer
- c64-kb MCP tools: `c64_game_briefing`, `c64_technique_lookup`, `c64_timing_budget`
