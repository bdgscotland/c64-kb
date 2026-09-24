# Game Design Conventions

A game design page describes one whole game: which archetype it is, which
recipe builds it, which techniques it runs in each phase, and, once the
built game has been timed, what its frame took. Each H2 is one
`GameDesign` node (schema 28). `c64_plan_budget` takes a design name and
budgets its phases; `c64_game_briefing` lists the designs of the archetype
it resolved.

Pages live in `docs/game-design/designs/`, one design per file. The marker
`<!-- doc-type: game-design -->` MUST appear in the first 10 lines.

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
| `**Measured frame:**` | no | the node's `measured` property. More than one line is allowed. |

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
`arithmetic`, `estimated`), then the instrument and where the figures are.
A malformed line is refused whole, because part of it would read as the
whole measurement.

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

## What is not here

No claims, zero page or memory lines yet: those are per-technique
(`CONVENTIONS-techniques.md`) and per-recipe. `c64_check_compatibility`
takes the technique list.
