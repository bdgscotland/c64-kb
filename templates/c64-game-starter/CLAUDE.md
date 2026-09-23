# c64-game-starter — Agent Instructions

## STOP — Read this first

Before you Edit, Write, or MultiEdit anything under `src/`, you MUST run the
c64-kb briefing for this project. This is enforced two ways:

- A PreToolUse hook in `.claude/settings.json` blocks every Edit/Write that
  targets a path under `src/` until `.kb-briefing-done` exists.
- `make` refuses to build until `.kb-briefing-done` exists (see the
  `briefing-check` target in the Makefile).

The required steps:

1. `c64_game_briefing("<your concept>", archetype="<shmup|platformer|puzzle|adventure>")`
   (or `c64_demo_briefing(...)` for a demo, not a game).
2. For each technique the briefing proposes:
   `c64_technique_lookup(name)` AND `c64_pitfalls_for(name)`.
3. For each seed recipe in the briefing's `build_order`:
   `c64_recipe_lookup(name)`.
4. Record that you actually consumed the briefing:
   `touch .kb-briefing-done`.

The marker file exists because text-only "you should call the briefing"
advice gets skipped. The marker forces the agent to acknowledge the
briefing was actually read, not just available.

The KB has technique + pitfall coverage for classes of bugs that bite C64
games — frame-budget overruns in text-mode renders, dirty-cell skip
trails on falling-piece overlays, raster-IRQ stability, sprite multiplex
constraints. Skipping the briefing means re-discovering those bugs by
hand on real hardware (or, in our case, in VICE while the user watches).

If you genuinely have a trivial change that doesn't justify a full
briefing pass, write a one-line reason into the marker instead:

```
echo "bypass: rename typo in comment" > .kb-briefing-done
```

That leaves the reason in the marker for anyone reading this checkout.
The marker is not committed (see .gitignore), so a fresh clone is briefed
again from scratch.

---

## IDE / clangd noise

The `src/*.c` files target the **Oscar64** compiler, not standard C. Oscar64
ships its own headers (`c64/vic.h`, `c64/rasterirq.h`, etc.) and globals
(`vic`, `VCOL_*`, `RIRQCode`). Your editor's clangd LSP will produce dozens of
`file not found` / `undeclared identifier` diagnostics for these — they are
NOT real bugs. A `.clangd` config in this directory suppresses them, but if
you're using a different editor or LSP, expect noise. The source of truth is
`make` (invokes the real `oscar64` binary). Ignore LSP warnings; trust the
compiler.

## What this is

This is a C64 game project scaffolded from c64-kb's templates/c64-game-starter.
Target: a buildable PAL+NTSC C64 game `.prg` running on stock hardware.

## MCP server note

`.mcp.json` wires c64-kb at a relative path that assumes this template lives at
`templates/c64-game-starter/` inside a sibling checkout of the c64-kb repo
(i.e., `../../dist/cli.js` resolves to c64-kb's built CLI).

If you have moved this project, update `.mcp.json` to use the absolute path to
your c64-kb checkout, e.g.:

```json
{
  "mcpServers": {
    "c64-kb": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/c64-kb/dist/cli.js", "serve"],
      "env": {}
    }
  }
}
```

Once vice-mcp is installed (https://github.com/barryw/vice-mcp), add it as a
second entry:

```json
    "vice-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/vice-mcp/dist/cli.js", "serve"]
    }
```

Once sim6502 is installed, add it similarly:

```json
    "sim6502": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/sim6502/dist/cli.js", "serve"]
    }
```

## The toolchain (locked decisions)

- **Primary: Oscar64** — game logic, sprite control, joystick input, collision
  detection, score HUD, SID music play-routine wiring. Use for everything that
  isn't cycle-tight inner-loop assembly.
  Repo: https://github.com/drmortalwombat/oscar64
- **Secondary: KickAssembler** — cycle-tight escape hatch for sprite multiplexers
  (24-sprite sort loop), stable raster IRQ handlers, and hardware register
  sequences that must hit specific cycle offsets.
  Home: http://theweb.dk/KickAssembler/ (requires Java 11+)
- **Tertiary: cc65** — DO NOT use unless you have an explicit reason and have
  documented it. cc65 patterns are antipatterns in this KB.

For idiomatic snippets for any (toolchain, intent) pair, call:

```
c64_toolchain_hint(toolchain="oscar64", intent="joystick input")
```

## The MCP tools at your disposal

All 24 tools from c64-kb are available once the MCP server is running:

| Tool | Purpose |
|------|---------|
| `c64_health` | Service health snapshot (Qdrant / FalkorDB / Ollama / analytics) |
| `c64_search` | Hybrid semantic + keyword search across the KB |
| `c64_ingest_doc` | Ingest a single markdown file at runtime |
| `c64_lookup_register` | Structured register lookup by name or address |
| `c64_lookup_kernal` | KERNAL routine lookup with paired-routine edges |
| `c64_memory_map` | Memory region lookup by address |
| `c64_lookup_opcode` | 6510 opcode lookup (legal + illegal) |
| `c64_pal_ntsc_diff` | PAL vs NTSC differences scoped by topic |
| `c64_toolchain_hint` | Idiomatic snippet for a (toolchain, intent) pair |
| `c64_recipe_lookup` | Structured Recipe lookup by canonical name |
| `c64_recipes_for` | List recipes filtered by toolchain / region / technique |
| `c64_technique_lookup` | Technique lookup with USES registers + recipes |
| `c64_techniques_for` | List techniques filtered by category / chip / region |
| `c64_check_compatibility` | Conflict detection across a list of techniques |
| `c64_timing_budget` | Per-scanline cycle math for a technique |
| `c64_plan_budget` | Add your technique list up against a frame, per phase; names what is unknown |
| `c64_pitfalls_for` | Pitfalls triggered by a register, KERNAL, or technique |
| `c64_failure_diagnose` | Match symptom description against CrashPattern nodes |
| `c64_demo_briefing` | Synthesise techniques + pitfalls + build order for a demo brief |
| `c64_game_briefing` | Same synthesis for a game brief |

The **briefing flow** is the required first step for any new game:

1. Call `c64_game_briefing("your game idea", archetype="shmup")`.
2. The returned plan lists recommended techniques, known pitfalls, toolchain
   split, and build order. Treat this as your working spec.

Supported archetypes: `shmup`, `platformer`, `puzzle`, `adventure`.
Choose the archetype that best matches your game concept; the briefing tool
selects a canonical scaffold recipe accordingly.

## Workflow

```
1.  Brief the game:    c64_game_briefing("your idea", archetype="shmup")
2.  Review the proposed techniques, pitfalls, and build order
3.  For each technique: c64_technique_lookup("technique_name")
                        to get register/KERNAL usage and linked recipes
4.  Check compatibility: c64_check_compatibility(["tech_a", "tech_b", ...])
5.  Cycle-budget raster work: c64_timing_budget("technique_name", "pal")
    and the whole frame: c64_plan_budget(["tech_a", "tech_b", "kernal_file_read_seq:transition"])
6.  Get the recipe(s): c64_recipe_lookup("oscar64-simple-shmup")
                       Copy the canonical source structure
7.  Write the Oscar64 entry in src/main.c
8.  Drop any KickAssembler sprite multiplexer in src/asm/sprites.asm
9.  Build:             make
10. Test in VICE:      make run   (or wire vice-mcp and use MCP tools)
```

## What is in src/

- `src/main.c` — Oscar64 C entry point. Reads joystick port 2 via
  `joystick.h`, moves a single hardware sprite on screen, and displays a
  score counter on row 0. The `for(;;)` main loop polls per frame and calls
  `rirq_wait()` for frame sync. Extend with bullets, enemies, and collision
  detection following `docs/recipes/oscar64/simple-shmup.md`.
- `src/asm/sprites.asm` — KickAssembler escape-hatch stub for a 24-sprite
  multiplexer skeleton (structure + TODO comments). Fill in the sort and
  bank-write logic from `docs/recipes/kickassembler/sprite-multiplex-24.md`
  when you need more than 8 sprites on screen.

## KickAssembler external-asm linking pattern

Oscar64 can call a KickAssembler-compiled routine by declaring it `extern "C"`
on the Oscar64 side and passing the assembled `.prg` as extra source:

```bash
# Step 1: assemble the KickAssembler multiplex stub
java -jar KickAss.jar src/asm/sprites.asm -o sprites_asm.prg

# Step 2: compile Oscar64 with the .prg as extra source
oscar64 -O2 -o=game.prg -tf=prg src/main.c sprites_asm.prg
```

The Makefile does this in two steps. See docs/toolchains/oscar64-reference.md
section "External KickAssembler linking" for the calling convention details.

## Hardware target

**Stock C64 PAL and NTSC only.** Out of scope: C128, Mega65, SuperCPU, REU,
Ultimate II+. Every technique in the KB is tagged `region: pal`, `region: ntsc`,
or `region: both`. Check before relying on timing constants.

## First thing to do as an agent

Call `c64_game_briefing("<your game idea>", archetype="<shmup|platformer|puzzle|adventure>")`
and treat the returned plan as your spec. Do not write any code before running
the briefing.
