# c64-kb — instructions for Claude Code

This repository is a reference for AI coding agents: 67 markdown documents
about the Commodore 64 (hardware, techniques, pitfalls, recipes,
toolchains), indexed two ways (Qdrant vectors, FalkorDB graph) and served
over MCP. Thousands of people have read about it; fifty have cloned it. A
wrong number here becomes a torn screen in someone's demo. Work accordingly.

## The rules that are enforced

1. **A code listing is built before it lands.** `npm run check:listings`
   assembles every recipe with the toolchain it names and every
   KickAssembler fragment in `docs/`. A hook runs it on the file you just
   edited; `npm test` runs it too. Six of eight recipes once shipped without
   ever having been assembled. Never again.
2. **Anything that draws is run in VICE and the screenshot is measured.**
   Not looked at — measured with a script (the `verify-listing` skill has
   the recipe). A count cannot see a screen; a human eye misses one cycle.
3. **A number comes from an instrument, or says which rung it stands on.**
   Evidence ladder, strongest first: (1) you ran it — VICE, an assembler,
   the ROM bytes, a header file; (2) two documents in this repo agree and
   neither cites the other; (3) arithmetic from stated constants; (4) your
   own knowledge. Rung 4 is "unverifiable", never "verified". Write the
   rung into the text when it matters ("measured in VICE x64sc",
   "from Bauer's article, not measured here").
4. **Corrections are recorded, not erased.** When you change a number or a
   mechanism an agent might have relied on, one clause says what was
   wrong. The pages that were rewritten this way are the model.
5. **Metadata lines drive the graph.** Frontmatter and the `**Region:**`,
   `**Uses registers:**`, `**Demands:**`, `**Triggered by …:**` lines become
   nodes and edges. After changing any of them run `npm run ingest:clean`
   (the graph merges edges and never removes one a doc stopped asserting).
   Unknown `Demands` words are refused; unresolved trigger targets are
   warned about and counted — fix the doc, do not ignore the warning.
6. **Commit named paths.** Never `git add -A` or `git add .` (a hook
   refuses them). `data/`, `dist/`, `.claude/state/` and scratch never
   land. Commit messages say what was wrong and what the evidence was.
7. **Do not invent.** No recipe, register, routine or link that does not
   exist. "No recipe yet" is the honest form; a dangling link is a defect.

## Instruments on this machine and how to call them

| Instrument | Command |
|---|---|
| KickAssembler 5.25 | `java -jar $KICKASS_JAR file.asm -o out.prg` (set `KICKASS_JAR`; default location `~/Developer/c64/kickassembler/KickAss.jar`) |
| Oscar64 | `$OSCAR64 -tm=c64 -O2 -o=out.prg file.c` (`OSCAR64` env or `oscar64` on PATH; headers in `<oscar64>/include/`) |
| cc65 | `cl65 -t c64 -O -o out.prg file.c` |
| VICE 3.10 headless (PAL 6569) | `GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound -autostartprgmode 1 -limitcycles 8000000 -exitscreenshot out.png -autostart out.prg` (`-model ntsc` for 6567R8). ~10–20 s per run; wrap in `timeout`. |
| Screenshot geometry | 384×272 PNG; screenshot row = raster line − 14; x = 8 is VIC X coordinate 0; left border x 0–31, right border 352–383. Measure with PIL, never by eye. |
| KERNAL / BASIC / char ROM | `/opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin` ($E000), `basic-901226-01.bin` ($A000), `chargen-901225-01.bin` ($D000). Read bytes with python to settle any address or vector claim. |

## Gates before a commit

```bash
npm run check:listings     # every listing builds; fails on a missing toolchain unless --allow-missing
npx tsc --noEmit
npm test                   # 133 tests, against c64_test / c64_docs_test — never the live stores
npm run ingest:clean       # if any doc changed: rebuild graph + vectors; read the summary line
npx c64-kb health          # live counts for README's table if you touched it
```

The pre-commit gate is you. There is no CI yet.

## Map

- `docs/` — the knowledge base. `CONVENTIONS-*.md` define the extractable
  structure per doc type; read the one for the type you are editing.
- `docs/recipes/<toolchain>/` — one page per recipe, listing + build +
  expected output + why; `kickassembler/screenshots/` holds the VICE
  pictures that verified them.
- `src/graph/extract.ts` — markdown → graph entities. `src/ingest.ts` —
  two-pass ingest. `src/tools/*.ts` — tool functions shared by CLI and
  MCP. `src/server.ts` — MCP registration and tool descriptions.
- `scripts/check-listings.ts` — the build gate. `--file <path>` checks one file.
- `test/` — vitest; `vitest.config.ts` isolates the stores.
- `docs/ONTOLOGY.md` — 12 node labels, 15 edge types, what each means.
- `CHANGELOG.md`, `VERSION` — bump `KB_DATA_VERSION` for content,
  `KB_SCHEMA_VERSION` for ontology shape, package version with tool surface.

## Read-only ways to see what an agent gets

```bash
npx tsx src/cli.ts search "side border cycle 56"
npx tsx src/cli.ts technique-lookup sideborder_open
npx tsx src/cli.ts check-compatibility fli_image sprite_multiplex_24
npx tsx src/cli.ts pitfalls-for stable_raster_irq
npx tsx src/cli.ts timing-budget fli_image
```

If a tool's answer is wrong, the fix is usually in a doc's metadata line or
in `src/tools/query.ts`; check which before editing either.

## Gotchas that cost time this year

- KickAssembler: `;` is not a comment; `txa : pha` is not two statements;
  `.if (n)` on a number is an error (`.if (n != 0)`); `(label),y` with a
  non-zero-page label assembles silently and reads the wrong pointer;
  `!:` labels inside a `.for` share one scope; branches past 127 bytes of
  unrolled code fail; macro calls need parentheses; the default `.text`
  encoding is screen codes, not PETSCII.
- Oscar64: a call through a `const` function pointer to a literal address
  segfaults the compiler; an unreferenced placed array is dropped by the
  linker (`__export`); `NUM_IRQS` is per translation unit (`-dNUM_IRQS=`);
  `__attribute__` is not accepted; `rasterirq.h` polls, it is not
  cycle-exact.
- VICE headless: without `GSETTINGS_SCHEMA_DIR` the GTK build aborts;
  without `-autostartprgmode 1` large PRGs are still loading at exit; an
  exit screenshot can land mid-frame, so a spurious boundary moves when
  you change `-limitcycles`.
- The KERNAL dispatcher is at `$FF48` (29 cycles); `$EA31` is the whole
  service routine, `$EA81` the bare exit. A badline leaves 20 cycles, not
  23. DEN is sampled once, on line $30. The 6510 has no `JMP (abs,X)`.

## What "verified" means here

Verified against VICE x64sc 3.10 and the ROM images, not a 6569 on a bench.
The pages say so. Do not upgrade that wording.
