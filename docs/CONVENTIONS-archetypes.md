# Archetype Reference Conventions

Archetype docs describe the shapes a C64 game or demo takes: the vertical
shooter, the single-screen platformer, the text adventure, the crack
intro. Today there are two: `docs/game-design/c64-game-archetypes.md`
for kind `game` and `docs/demo-design/intro-cracktro-patterns.md` for
kind `demo`. Each H2 in them is one `Archetype` node, and two lines under
the H2 become its edges: the technique fingerprint (`FEATURES`, Archetype
to Technique) and the common pitfalls (`RISKS`, Archetype to Pitfall).
`c64_game_briefing` and `c64_demo_briefing` read both.

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

`kind: demo` is the demo forms: the source is
`docs/demo-design/intro-cracktro-patterns.md`, whose crack intro, demo
intro, pack intro, dentro and 4K party intro are each one `Archetype`
node. A form is the node; the parts a multi-part production is cut into
are not a node type, and a page must not try to make them one. The entry
format, the edge lines and the ingest counts are the same as for games,
and `c64_demo_briefing` with `archetype` reads the node exactly as
`c64_game_briefing` does. Archetype names are unique across every
archetype page, not just within one: the ingest merges the node on its
name alone, so a name repeated on a second page overwrites the first
page's node (its kind, title and source) and both pages' edges land on
the one node. The extractor only refuses a repeat within a single file.
`archetype_not_found` lists the names of both kinds.

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

One more line routes a brief that names no archetype (schema 30):

```
**Brief words:** vertical shooter, vertically scrolling, road shooter, road, car, spy hunter
```

- Comma-separated words or phrases, backticks optional. The extractor
  lowers the case, drops apostrophes and reads any other run of
  non-letters and non-digits as one space, so "Beat-'em-up" is stored as
  `beat em up`. It becomes the `brief_words` property of the node, not an
  edge; an entry with no line stores an empty list.
- Only kind `game` is routed. `c64_game_briefing` with no `archetype`
  normalises the brief the same way and counts, per archetype, the
  distinct words it contains, a plural "s" or "es" allowed. The archetype
  with the most wins; a tie or no match routes nowhere.
- Choose words that name the genre, not a technique. A word on two
  entries cancels itself out ("puzzle" is on `puzzle` and `action_puzzle`,
  so "Boulder Dash puzzle" still routes by "boulder dash"). A word that
  every brief carries ("game", "screen", "columns") routes everything.
- The line is how a genre reaches its archetype. It is data here, so no
  genre word or game title is spelled in the briefing code.

One more optional line names the playable starter for the archetype
(schema 31):

```
**Starter:** `shmup-vertical`
```

- The word is a directory in `templates/` (lower case, digits, hyphens).
  It becomes the Archetype's `starter` property, and `c64_game_briefing`
  or `c64_demo_briefing` returns it in `archetype.starter` and tells the
  agent to run `npm run new-project -- <starter> <dir>` in this checkout.
- The extractor does not read the tree. `test/extract-archetype-starters.test.ts`
  fails when a starter named on a real page has no `Makefile` and
  `expect.json` in `templates/`.
- Name a starter only where it is a game or effect of that archetype.
  An archetype with no fitting starter carries no line.

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

With no `archetype`, `c64_game_briefing` routes the brief by the brief
words above and does the same with the winner; the output's
`archetype.inferred_from` lists the words that chose it, and the text
says so. A named `archetype` always wins over the words.

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
4. The `**Technique fingerprint:**`, `**Common pitfalls:**` and
   `**Brief words:**` lines
5. `**Reference titles:**` and `**Modern examples:**`

H3 inside an archetype is fine; the extractor reads only the H2 and the
five bold lines (`**Brief words:**` and `**Starter:**` are optional).
