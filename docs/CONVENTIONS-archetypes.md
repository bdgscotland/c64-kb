# Archetype Reference Conventions

Archetype docs describe the shapes a C64 game or demo takes: the vertical
shooter, the single-screen platformer, the text adventure. Today there is
one, `docs/game-design/c64-game-archetypes.md`. Each H2 in it is one
`Archetype` node, and two lines under the H2 become its edges: the
technique fingerprint (`FEATURES`, Archetype to Technique) and the common
pitfalls (`RISKS`, Archetype to Pitfall). `c64_game_briefing` reads both.

The marker `<!-- doc-type: archetype-reference -->` MUST appear in the
first 10 lines for the extractor to process the file.

## File-level frontmatter

```yaml
---
kind: game                    # game | demo; optional, defaults to game
---
```

`kind` applies to every archetype in the file. Any other word refuses the
whole file with a warning, the way an unknown technique category does.

## Archetype entries

The H2 is the human-readable title, free-form, and is NOT the node name.
Technique and pitfall H2s carry `## name — Title`; archetype titles have
slashes and hyphens in them ("Text Adventure / Parser-Driven",
"Beat-em-up"), so the name is a separate line instead. The first line
after the H2 is:

```
## Vertical Shmup

**Archetype:** `vertical_shmup`
```

- `vertical_shmup` is the snake_case node name (`Archetype.name`), unique
  in the file. Backticks are optional.
- An H2 with no `**Archetype:**` line is not an archetype: it is warned
  about and skipped, so a prose section cannot become a node by accident.
- A second H2 with the same name is warned about and skipped.

Two more lines under the H2 are the edge sources. Both existed on the page
before the graph read them; the format did not change.

```
**Technique fingerprint:** `soft_scroll_v`, `sprite_multiplex_24`, `stable_raster_irq`
**Common pitfalls:** `sprite_dma_overflow`, `badline_cycle_loss`
```

- Comma-separated, backticks optional. Each word must be a snake_case
  name. A word that is not one is refused at extract time with a warning
  and never reaches the graph.
- `**Technique fingerprint:**` makes one `FEATURES` edge per word to the
  `Technique` of that name. `**Common pitfalls:**` makes one `RISKS` edge
  per word to the `Pitfall` of that name.
- Both ends are MATCHed, never MERGEd. A name that matches no node is
  dropped at link time with a `[falkor]` warning and counted in the ingest
  summary (`archetype_features: … dropped`, `archetype_risks: … dropped`),
  beside `triggered_by` and `mitigated_by`. It is never silently dropped
  and it never creates a stub node. Fix the page, do not ignore the count.
- Only name a technique the archetype's own prose supports. The
  fingerprint is what `c64_game_briefing` forces into a plan for that
  archetype, so a name here is a claim that every such game needs it.

The other lines on the page (`**Reference titles:**`, `**Modern
examples:**`) are prose for the reader and are not read by the extractor.

## What the briefing does with it

`c64_game_briefing` with `archetype: "vertical_shmup"` (also accepted:
"Vertical Shmup", "vertical-shmup") looks the node up. Its `FEATURES`
targets are proposed regardless of the keyword scorer's verdict and are
exempt from the three-per-category cap; its `RISKS` targets are added to
the pitfalls when no proposed technique already surfaced them; its title
is appended to the search text. The output repeats what the graph held
in an `archetype` field.

A name the graph does not have returns `archetype_not_found` with the
known names and builds the rest of the plan from the description alone.
The briefing does not guess a near match. Only a graph with no
`Archetype` nodes at all falls back to a small built-in table; with this
page ingested, the page is the source of truth.

## Section structure inside an Archetype

After the H2 and the `**Archetype:**` line, free-form prose covering:

1. **What it is** — the defining mechanic and the scene tradition
2. **Where the budget goes** — the technical constraint that shapes it
3. **How the pieces fit** — sprites, scroll, SID, loading, in plain terms
4. The `**Technique fingerprint:**` and `**Common pitfalls:**` lines
5. `**Reference titles:**` and `**Modern examples:**`

H3 inside an archetype is fine; the extractor reads only the H2 and the
three bold lines.
