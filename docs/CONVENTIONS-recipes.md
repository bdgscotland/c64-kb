# Recipe Conventions

Recipes live in `docs/recipes/<toolchain>/<recipe-name>.md`. Each recipe is a
complete, buildable example with source, build command, expected output, and a
description of why it's done this way. The same conceptual demo MAY have one
recipe per toolchain (e.g. `oscar64/raster-bars.md`, `kickassembler/raster-bars.md`)
— they are distinct Recipe nodes IMPLEMENTS-edged to the same Technique.

The marker `<!-- doc-type: recipe -->` MUST appear in the first 10 lines.

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
