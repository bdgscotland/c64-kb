# Game Design Conventions

A game design page describes one whole game: which archetype it is, which
recipe builds it, which techniques it runs in each phase, and, once the
built game has been timed, what its frame took. Each H2 is one
`GameDesign` node (schema 28). `c64_plan_budget` takes a design name and
budgets its phases; `c64_game_briefing` lists the designs of the archetype
it resolved.

Pages live in `docs/game-design/designs/`, one design per file. The marker
`<!-- doc-type: game-design -->` MUST appear in the first 10 lines. A
studied game, a released title measured with the RE tools, is a design
too: see "Studied designs" below (schema 40).

## The lines under each H2

```
## Single-screen platformer scaffold (Oscar64)

**Game design:** `platformer_scaffold_oscar64`
**Instance of:** single_screen_platformer
**Realised by:** oscar64-platformer-scaffold
**Region:** both
**Composes:** tile_map_render (init), decimal_print ×2-7, lfsr_random (init), kernal_file_write_seq (transition)
**Measured frame:** play pal worst=8693 typical=4966; play ntsc worst=10287 typical=6628 (measured-vice, CIA1 timer B around the loop body, recipes/oscar64/platformer-scaffold.md "Expected output")
```

| Line | Required | Becomes |
|---|---|---|
| `**Game design:**` | yes | the node's `name`, snake_case. Without it the H2 is prose and is not ingested; with a `**Composes:**` line but no name, the extractor warns. |
| `**Instance of:**` | no | `INSTANCE_OF` edges to Archetype names from `c64-game-archetypes.md`. |
| `**Realised by:**` | no | `REALISED_BY` edges to canonical recipe names (`<toolchain>-<recipe>`). |
| `**Region:**` | no | `PAL`, `NTSC` or `both`: the region the budget uses when the caller names none. |
| `**Composes:**` | yes | `COMPOSES` edges, one per technique and phase. |
| `**Measured frame:**` | no | the node's `measured` property. More than one line is allowed, for the same phase and region too. |

Every name is MATCHed at ingest, never created. A name that matches no
node is warned about and counted in the ingest summary as dropped.

## Composes

A comma-separated list of Technique names. A name alone runs in `play`,
the frame loop. `name (init)` runs once before play; `name (transition)`
runs between plays (a level load, a game-over save). A technique used in
two phases is listed twice, once per phase. Any other phase word is
refused with a warning.

A Cost figure is one call. A technique the frame calls more than once
carries a count before the phase: `name ×N` for N calls every frame,
`name ×M-N` for M calls in the cheapest frame and N in the worst. `*N`,
or `xN` after a space, is read the same. `c64_plan_budget` multiplies the
member's low end by M and its high end by N; whether one call is above a
frame is still judged on one call. A band or per-line charge is lines, not
calls, and is not multiplied. A count of 0 in the worst frame, or M above
N, drops the item with a warning. The count rides the `COMPOSES` edge as
`calls_low` and `calls_high`.

On a technique whose Cost line states `cycles_per_item` (#95), the count
is items, not calls: `char_bullets ×0-12` is up to twelve bullets, and
the plan charges `cycles_item_base` + M × item for the low end and the
same with N for the high. A count of 0 is allowed as M there, for a
frame with no bullets. `c64_plan_budget` takes the same `×N` on a plain
technique list.

```
**Composes:** frame_sync_loop, decimal_print ×2-7, kernal_file_write_seq (transition)
```

The platformer's HUD prints two fields every frame (the frame counter and
the cycle count) and up to five more when they change, so its
`decimal_print` is `×2-7`. Count the calls in the listing's frame loop,
not in the recipe's prose. Before #37 there was no count, and the budget
charged that HUD one call.

List what the listing runs, not what the recipe's frontmatter says. Read
the frame loop. When the two differ, fix the frontmatter or say why in the
page's prose.

## Measured frame

`<phase> <pal|ntsc> worst=N [typical=N]`, entries separated by `;`, then
a parenthetical: the basis word first (`measured-vice`, `derived-listing`,
`arithmetic`, `estimated`, or on a studied design `measured-vice-study`),
then the instrument and where the figures are. `measured-vice-study` on a
page that is not `kind: studied` refuses the line.
A malformed line is refused whole, because part of it would read as the
whole measurement.

Several lines are allowed, and two lines may give the same phase and
region: each line is its own measurement (another build, instrument or
run) with its own basis and source, and `c64_plan_budget` prints each
beside the prediction. Within one line a phase and region appear once.
Before #107 the extractor kept only the first line's figure for a phase
and region and warned, although this page allowed more than one line.

- `worst` is the largest frame the run recorded, in CPU cycles.
- `typical` is a common frame. Say in prose what it is: a mean, or one
  frame's reading.
- State what the timed region holds. A figure that leaves out the HUD, the
  IRQ or the badline stalls says so in prose under the lines.
- Figures come from the realising recipe's page, with its rung. A figure
  this repo did not measure is `estimated` and names its source.

`c64_plan_budget` prints each measured figure beside its prediction for
the same phase and region. The two answer different questions: the
prediction adds up each technique's own recipe; the measurement is this
game's listing.

## Studied designs

A study page describes a released game the RE tools measured in VICE
(`docs/superpowers/specs/2026-09-23-reverse-engineering-design.md`). It
lives in `docs/game-design/studies/`, carries the same marker, and has
frontmatter `kind: studied`. Without `kind`, or with `kind: built`, a page
is a built design; any other word is warned about and read as built. The
session files in `studies/sessions/` are JSON, not pages, and are not
ingested.

```
---
kind: studied
---
<!-- doc-type: game-design -->

## Commando (Elite, 1985), studied

**Game design:** `commando_1985`
**Instance of:** vertical_run_and_gun
**Region:** PAL
**Studied from:** Commando (1985, Chris Butler, Rob Hubbard, Elite); image sha1=<40 hex digits>; session studies/sessions/commando.json
**IRQ chain:** play pal: $41C5 @ line 30, $4284 @ line 50/60, $4389 @ line 161/198, $4137 @ line 213, $4188 @ line 222 (measured-vice, <instrument and run>)
**Memory map:** VIC bank 3; $DD00=$94; screen $E000-$E3E7; charset area 0 $C000-$C7FF; $01=$36 in play; $D018=$80 in area 0 (measured-vice, <instrument and run>)
**Diverges from archetype:** extra: <technique>; missing: <technique>
**Measured frame:** play pal worst=N typical=N (measured-vice-study, <instrument>, <run>)
```

The lines are cut from `game-design/studies/commando.md`, which holds the
full set and where each was measured; an earlier version of this example
had placeholder values (`commando_study`, `vertical_shmup`, screen $C000,
`$01=$35`).

| Line | Required | Becomes |
|---|---|---|
| `**Studied from:**` | yes | `studied_from` JSON `{title, year, authors[], image_sha1, session}`, and a `STUDIES` edge to the Production of that title. One per page: a second line that parses is warned about and ignored. The title is MATCHed against the Productions the archetype pages' `**Reference titles:**` create: add it there, with its source, first. |
| `**IRQ chain:**` | no | `irq_chain` JSON. `<phase> <pal\|ntsc>: $pc @ line N, …`, groups separated by `;`; `line N/M` for a handler armed on more than one line: the lines seen, or the ends of a range, which the prose says. The phase word is free (`title`, `play`). A line above the region's last (PAL 311, NTSC 262) refuses the line. Several lines allowed. |
| `**Memory map:**` | no | `memory_map` JSON. Entries separated by `;`: `<what> $addr`, `<what> $addr-$addr`, `<what> N`, or a port or register and its value (`$01=$36`, `$DD00=$94`, `$D018=$80`), each optionally followed by `in <when>` (letters, digits, spaces: `in play`, `in area 0`). `<what>` is letters, digits, spaces and `- / ( ) $`, with no comma or `;`. Several lines allowed. An earlier version took only `$00`/`$01` as ports, letters only after `in`, and no punctuation in `<what>`. |
| `**Diverges from archetype:**` | no | `DIVERGES_FROM` edges with `direction`: `extra: a, b` (the game uses them, the archetype does not list them) and `missing: c` (the archetype lists it, the game does not use it), separated by `;`. |

`**IRQ chain:**` and `**Memory map:**` end in the same `(basis, source)`
parenthetical as `**Measured frame:**`; the source names the observation
IDs. Each study line is refused whole on any malformed part, and a built
page carrying one is warned about and the line ignored. A studied design
needs no `**Composes:**` or `**Realised by:**` line. Every name is
MATCHed; an unknown technique or title is warned about and counted as
dropped. The candidate technique goes to the page's prose and an issue.

`c64_game_briefing` lists a studied design beside the archetype's built
ones as "studied, not buildable here", with its page. `c64_plan_budget`
accepts a studied design's name and prints its measured frame; it
budgets no members, since no recipe here builds the game, and says so.

## What is not here

No claims, zero page or memory lines yet: those are per-technique
(`CONVENTIONS-techniques.md`) and per-recipe. `c64_check_compatibility`
takes a design name and checks each phase alone, since init and
transition members do not run beside play; before #37 it took only a
technique list, and a flat list of a design reported conflicts between
techniques that never run together. What one phase leaves configured for
the next is not checked.
