# Recipe Conventions

Recipes live in `docs/recipes/<toolchain>/<recipe-name>.md`. Each recipe is a
complete, buildable example with source, build command, expected output, and a
description of why it's done this way. The same conceptual demo MAY have one
recipe per toolchain (e.g. `oscar64/raster-bars.md`, `kickassembler/raster-bars.md`)
— they are distinct Recipe nodes IMPLEMENTS-edged to the same Technique.

The marker `<!-- doc-type: recipe -->` MUST appear immediately after the
frontmatter — line 12 of every recipe, after the ten frontmatter lines and
one blank; the extractor matches it anywhere in the file. An earlier
version of this line said "in the first 10 lines", which no recipe
satisfied.

## File-level frontmatter (required)

```yaml
---
recipe: hello-world             # short identifier, lowercase, hyphen-separated
toolchain: oscar64              # canonical toolchain name (matches a Tool node)
output_format: PRG              # one of PRG, CRT, BIN, D64
region: both                    # pal | ntsc | both
techniques: []                  # array of Technique names this recipe implements (Phase 2: empty for hello-worlds)
file_formats: [PRG]             # FileFormat nodes this recipe produces
uses_registers: []              # array of Register canonical names referenced
uses_kernal: [CHROUT]           # array of KernalRoutine names called
---
```

`recipe`, `toolchain`, `output_format`, and `region` are required. The rest may be
empty arrays but the keys must be present.

## Section structure

After the frontmatter:

1. `# <Human-readable title>` (H1, exactly one)
2. `## Synopsis` — one paragraph: what this recipe demonstrates and when to use it
3. `## Source` — a single fenced code block with the complete source listing
4. `## Build` — the exact shell command(s) to produce the artifact
5. `## Expected output` — what you should see on screen / in the .prg
6. `## Why this works` — one to three paragraphs walking through the load-bearing
   lines, calling out chip-specific quirks or toolchain idioms

Recipes are atomic — no "and another variation". Variations are separate recipes.

## Naming

The filename matches the `recipe:` frontmatter value. Directory matches `toolchain:`.
`oscar64/hello-world.md` produces a Recipe node with `name: oscar64-hello-world`
(directory and basename joined with `-`).

## Verification (required)

A recipe page is not done when it reads well. Before it lands:

1. The listing is extracted from the page and built with the toolchain the
   page names — `npm run check:listings` does exactly that and is run by
   `npm test`. A listing that does not build does not land.
2. For anything that draws, the PRG is run headless in VICE with the
   pinned command (`x64sc -default -warp +sound +autostart-delay-random
   -autostartprgmode 1 -limitcycles N [-model ntsc] -exitscreenshot
   out.png -autostart recipe.prg`) and the screenshot is measured against
   the "Expected output" section; the PNG goes in
   `recipes/<toolchain>/screenshots/<recipe>.png` and the page names it.
   The cycle count, models, extra flags and any fresh disk are pinned per
   recipe in `recipes/runs.json`, and `npm run verify:recipes` re-runs
   every recipe from that manifest and fails on a pixel that differs from
   the committed PNG. The pixel geometry, the palette RGB values per model
   and a decode snippet are in `runtime/vice-reference.md`, section
   "Reading the exit screenshot".
3. Any timing constant that was found by trying values (a sync padding, a
   line padding) is labelled as measured in VICE, with what the picture
   looks like when it is off by one. VICE is the instrument; the pages do
   not claim bench measurements.
4. If the page corrects an earlier version, it says what was wrong. That
   history is worth more to the next reader than a clean surface.

