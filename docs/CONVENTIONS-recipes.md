# Recipe Conventions

Recipes live in `docs/recipes/<toolchain>/<recipe-name>.md`. Each recipe is a
complete, buildable example with source, build command, expected output and an
explanation of the design. The same demo MAY have one
recipe per toolchain (e.g. `oscar64/raster-bars.md`, `kickassembler/raster-bars.md`);
they are distinct Recipe nodes IMPLEMENTS-edged to the same Technique.

The marker `<!-- doc-type: recipe -->` MUST appear immediately after the
frontmatter: line 12 of every recipe, after the ten frontmatter lines and
one blank. The extractor matches it anywhere in the file. An earlier
version of this line said "in the first 10 lines", which no recipe
satisfied.

## File-level frontmatter (required)

```yaml
---
recipe: hello-world             # short identifier, lowercase, hyphen-separated
toolchain: oscar64              # canonical toolchain name (matches a Tool node; becomes a REQUIRES_TOOL edge)
output_format: PRG              # one of PRG, CRT, BIN, D64
region: both                    # pal | ntsc | both
techniques: []                  # array of Technique names this recipe implements (Phase 2: empty for hello-worlds)
file_formats: [PRG]             # FileFormat nodes this recipe produces
uses_registers: []              # array of Register canonical names referenced
uses_kernal: [CHROUT]           # array of KernalRoutine names called
scaffolds: []                   # optional: Archetype names this recipe is a starting point for
---
```

`recipe`, `toolchain`, `output_format`, and `region` are required. The rest may be
empty arrays but the keys must be present.

`scaffolds` is the exception: it is optional, and absent reads as empty.
Set it only on a recipe that is a whole playable game an agent should copy
and change rather than start from nothing, such as `simple-shmup`. Each
entry must be the `name` of an Archetype on an archetype page
(`CONVENTIONS-archetypes.md`); the ingest links `Recipe -[:SCAFFOLDS]->
Archetype`, drops a name that matches no Archetype with a warning, and
`c64_game_briefing` offers the recipe as the first build step for that
archetype.

`claims` is optional too. It lists the hardware units the listing chooses,
beyond what its techniques' `**Claims:**` lines hold, in the same grammar
(`CONVENTIONS-techniques.md`): `claims: [irq_vector_0314 (owns),
cia1_timer_a (init)]`. The interrupt vector is the usual entry: a technique
does not claim a vector, because its recipes choose `$0314` or `$FFFE`.
Masking CIA1 with one `$7F` store to `$DC0D` before the frame loop is
`init` on each CIA1 unit that store changes. Write it from a
`scripts/claims-watch.ts --recipe` trace, never from reading the listing;
a measurement harness is not a claim. `claims-watch` reads the key; the
ingest does not yet (#22, step 8).

`harness` is optional and is not a claim. It lists what the listing's
measurement harness writes, in `claims-watch --harness` form: units or
address ranges, `harness: [cia1_timer_a]`. The usual entry is the CIA1
timer a recipe starts and stops around a routine to report its cycles.
`claims-watch` lists those stores apart and never fails on them; the
ingest ignores the key. A timer the effect itself depends on (a pulse
clock, a detection) is a claim, not a harness. Where the harness timer is
also masked at start-up, name it here only: the harness covers that
store. The result bytes a headless verifier reads (`$02FF`, a record at
`$02F0-$02FE`) are harness too: `harness: [$02F0-$02FF]`.

`ram` is optional and is not a claim. It lists the listing's own RAM
outside its PRG's load span, in `claims-watch --range` form:
`ram: [colour=$D800-$DBFF, buf=$0340-$03FF]`. The usual entries are colour
RAM, the cassette buffer and RAM under the I/O window. Zero page is
refused here: a zero-page byte is a unit, so it goes in `claims:` as
`zero_page $FB-$FE (owns)`, where the compatibility check can see it.
`claims-watch` reads the key; the ingest ignores it.

`kernal_services` is optional. It names the KERNAL interrupt service the
listing leaves running, `IRQ` or `NMI`: `kernal_services: [IRQ]` when a
handler ends in `JMP $EA31` or the CIA1 interrupt is never masked.
`claims-watch` then accepts the service's zero-page stores inside its
may-set (`docs/hardware/kernal-routines-reference.md`). It is not
`uses_kernal`, which names routines the listing calls; the ingest ignores
it.

`scripts/claims-recipes.ts` (`npm run claims:recipes`) builds every
KickAssembler recipe and runs `claims-watch --recipe` on it with the
cycles, flags and disk of its `runs.json` entry. It fails on any store
these keys, the techniques' Claims lines and `uses_kernal` do not declare.

## Section structure

After the frontmatter:

1. `# <Human-readable title>` (H1, exactly one)
2. `## Synopsis`: one paragraph, what this recipe demonstrates and when to use it
3. `## Source`: a single fenced code block with the complete source listing
4. `## Build`: the exact shell command(s) to produce the artifact
5. `## Expected output`: what appears on screen / in the .prg
6. `## Why this works`: one to three paragraphs on the lines the result
   depends on, naming chip-specific quirks or toolchain idioms

A recipe shows one thing. Variations are separate recipes.

## Naming

The filename matches the `recipe:` frontmatter value. Directory matches `toolchain:`.
`oscar64/hello-world.md` produces a Recipe node with `name: oscar64-hello-world`
(directory and basename joined with `-`).

## Verification (required)

Before a recipe page lands:

1. The listing is extracted from the page and built with the toolchain the
   page names. `npm run check:listings` does this and is run by
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
   the committed PNG. A recipe whose listing builds a cartridge instead of
   a PRG is pinned with a `"cartridge"` key: `{"file": "x.crt", "write":
   true, "runs": 2}`. The verifier takes `x.crt` from the build's work
   directory (a KickAssembler listing writes it with `outBin`), boots a
   fresh copy of it per model with `-cartcrt` in place of `-autostart`,
   adds `-easyflashcrtwrite` when `write` is true so VICE saves the flash
   back into the copy, and boots that copy `runs` times in sequence. Run 1
   is shot key `pal`; run N is `pal-runN`, default path
   `screenshots/<recipe>[-<model>]-runN.png`. The pixel geometry, the
   palette RGB values per model and a decode snippet are in `runtime/vice-reference.md`, section
   "Reading the exit screenshot"; a program that reports its own verdict
   through a result byte and the border colour, with a harness that turns
   it into a shell exit code, is the section "Verifying a run without a
   human" on the same page and the two `headless-verify` recipes.
   A recipe the verifier cannot run because it needs an input the harness
   has no key for (a TAP on the datasette, a prepared disk image, a key
   press) is listed in `runs.json` with a `"skip"` key whose value says why;
   the verifier reports it as skipped rather than failed, the listing gate
   still builds its Source listing, the page keeps its own pictures under
   `figures/` with the exact command that made them, and its "Expected
   output" says it is not pinned.
3. Any timing constant that was found by trying values (a sync padding, a
   line padding) is labelled as measured in VICE, with what the picture
   looks like when it is off by one. VICE is the instrument; the pages do
   not claim bench measurements.
4. If the page corrects an earlier version, it says what was wrong.

