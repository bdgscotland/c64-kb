# c64-demo-starter — Agent Instructions

## STOP — Read this first

Before you Edit, Write, or MultiEdit anything under `src/`, you MUST run the
c64-kb briefing for this project. This is enforced two ways:

- A PreToolUse hook in `.claude/settings.json` blocks every Edit/Write that
  targets a path under `src/` until `.kb-briefing-done` exists.
- `make` refuses to build until `.kb-briefing-done` exists (see the
  `briefing-check` target in the Makefile).

The required steps:

1. `c64_demo_briefing("<your demo concept>")`.
2. For each technique the briefing proposes:
   `c64_technique_lookup(name)` AND `c64_pitfalls_for(name)`.
3. For each seed recipe in the briefing's `build_order`:
   `c64_recipe_lookup(name)`.
4. Record that you actually consumed the briefing:
   `touch .kb-briefing-done`.

The marker file exists because text-only "you should call the briefing"
advice gets skipped. The marker forces the agent to acknowledge the
briefing was actually read, not just available.

If you have a trivial change that doesn't justify a full briefing pass,
write a one-line reason into the marker instead — that logs the bypass
in git history:

```
echo "bypass: rename typo in comment" > .kb-briefing-done
```

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

This is a C64 demo project scaffolded from c64-kb's templates/c64-demo-starter.
Target: a 1K to 4K intro / cracktro running on stock C64 PAL and NTSC hardware.

## MCP server note

`.mcp.json` wires c64-kb at a relative path that assumes this template lives at
`templates/c64-demo-starter/` inside a sibling checkout of the c64-kb repo
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

- **Primary: Oscar64** — main demo entry point, control flow, raster setup, asset
  wiring. Use for everything that isn't cycle-tight inner-loop assembly.
  Repo: https://github.com/drmortalwombat/oscar64
- **Secondary: KickAssembler** — cycle-tight escape hatch for stable raster IRQ
  handlers, sprite-multiplex sort loops, side-border opening, sine-scroller
  column writes. Assembled separately; the `.prg` output is passed as an
  additional source file to the Oscar64 invocation.
  Home: http://theweb.dk/KickAssembler/ (requires Java 11+)
- **Tertiary: cc65** — DO NOT use unless you have an explicit reason and have
  documented it. cc65 patterns (raw POKE loops, manual IRQ vector swaps) are
  antipatterns in this KB.

For idiomatic snippets for any (toolchain, intent) pair, call:

```
c64_toolchain_hint(toolchain="oscar64", intent="raster bars")
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
| `c64_timing_budget` | Per-scanline + per-frame cycle math for a technique |
| `c64_pitfalls_for` | Pitfalls triggered by a register, KERNAL, or technique |
| `c64_failure_diagnose` | Match symptom description against CrashPattern nodes |
| `c64_demo_briefing` | Synthesise techniques + pitfalls + build order for a demo brief |
| `c64_game_briefing` | Same synthesis for a game brief |

The **briefing flow** is the required first step for any new demo:

1. Call `c64_demo_briefing("your demo idea description")`.
2. The returned plan lists recommended techniques, known pitfalls, toolchain
   split, and build order. Treat this as your working spec.

## Workflow

```
1.  Brief the demo:    c64_demo_briefing("your demo idea")
2.  Review the proposed techniques, pitfalls, and build order
3.  For each technique: c64_technique_lookup("technique_name")
                        to get register/KERNAL usage and linked recipes
4.  Check compatibility: c64_check_compatibility(["tech_a", "tech_b", ...])
5.  Cycle-budget raster work: c64_timing_budget("technique_name", "pal")
6.  Get the recipe(s): c64_recipe_lookup("oscar64-stable-raster-irq")
                       Copy the canonical source structure
7.  Write the Oscar64 entry in src/main.c
8.  Drop any KickAssembler escape-hatch routines in src/asm/
9.  Build:             make
10. Test in VICE:      make run   (or wire vice-mcp and use MCP tools)
```

## What is in src/

- `src/main.c` — Oscar64 C entry point. Sets up a light-blue border, black
  background, writes a welcome message to screen RAM, and installs a single
  raster IRQ using `rasterirq.h` that changes the border color at raster
  line 100. Replace with your demo's raster effect chain.
- `src/asm/raster.asm` — KickAssembler escape-hatch stub. Shows the external-
  asm linking pattern. Declares a `raster_irq_install` function that Oscar64
  can call via `extern "C"`. Replace with a real cycle-tight IRQ handler when
  you need it.

## KickAssembler external-asm linking pattern

Oscar64 can call a KickAssembler-compiled routine by declaring it `extern "C"`
on the Oscar64 side and exporting it from the `.asm` file. The assembled `.prg`
is passed as an additional source to the Oscar64 invocation:

```bash
# Step 1: assemble the KickAssembler routine
java -jar KickAss.jar src/asm/raster.asm -o raster_asm.prg

# Step 2: compile Oscar64 with the .prg as extra source
oscar64 -O2 -o=main.prg -tf=prg src/main.c raster_asm.prg
```

The Makefile does this in two steps. See docs/toolchains/oscar64-reference.md
section "External KickAssembler linking" for the calling convention details.

## Hardware target

**Stock C64 PAL and NTSC only.** Out of scope: C128, Mega65, SuperCPU, REU,
Ultimate II+. Every technique in the KB is tagged `region: pal`, `region: ntsc`,
or `region: both`. Check before relying on timing constants.

## First thing to do as an agent

Call `c64_demo_briefing("<your demo idea>")` and treat the returned plan as your
spec. Do not write any code before running the briefing.
