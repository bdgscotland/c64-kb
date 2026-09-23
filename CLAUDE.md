# c64-kb — instructions for Claude Code

This repository is a reference for AI coding agents: markdown documents
about the Commodore 64 (hardware, techniques, pitfalls, recipes,
toolchains), indexed two ways (Qdrant vectors, FalkorDB graph) and served
over MCP. It is public, and agents build C64 software from it: games,
demos, tools, anything on the stock machine. A wrong cycle count, register
bit or timing value in a page becomes a torn screen or a crash in
someone's program. Work accordingly.

Tallies are a different kind of number. How many documents, nodes, edges,
tests or recipes there are does not go in README.md, this file or any
page's prose; it goes stale within commits. `npm run health` prints
the live figures; `CHANGELOG.md` records what an audit changed.

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
   `**Uses registers:**`, `**Demands:**`, `**Requires:**`,
   `**Triggered by …:**`, `**Mitigated by techniques:**` lines become
   nodes and edges. After changing any of them run `npm run ingest:clean`
   (the graph merges edges and never removes one a doc stopped asserting).
   Unknown `Demands` words are refused; unresolved trigger targets are
   warned about and counted — fix the doc, do not ignore the warning.
6. **Commit named paths.** Never `git add -A` or `git add .` (a hook
   refuses them). `data/`, `dist/`, `.claude/state/` and scratch never
   land. Commit messages say what was wrong and what the evidence was.
7. **Do not invent.** No recipe, register, routine or link that does not
   exist. "No recipe yet" is the honest form; a dangling link is a defect.
8. **Plain English, concise, cognitively efficient.** Everything written
   here — pages, commit messages, issues, replies — is read by people and
   agents under load. Say the fact, the number and its rung, and stop.
   Short sentences. No filler, no hedging that carries no information, no
   jargon before it is explained, no metaphor where a measurement will do.
   One idea per paragraph. If a table says it, do not repeat it in prose.
9. **Big rocks become GitHub issues.** Any piece of work too large for the
   current session, any gap that needs a source or an instrument this
   machine lacks, and any deferred item from an audit or a discovery run
   is filed as an issue on this repository with acceptance criteria, not
   left in a chat reply, a scratch file or a "later" note. Label it
   (`big-rock`, `content`, `harness`, `ontology`, `audit-follow-up`,
   `hardware-verification`); link the page or line it concerns; close it
   with the commit that lands the work. Issues #1–#9 are the model.

## Instruments on this machine and how to call them

| Instrument | Command |
|---|---|
| KickAssembler 5.25 | `java -jar $KICKASS_JAR file.asm -o out.prg` (set `KICKASS_JAR`; default location `~/Developer/c64/kickassembler/KickAss.jar`) |
| Oscar64 | `$OSCAR64 -tm=c64 -O2 -o=out.prg file.c` (`OSCAR64` env, `oscar64` on PATH, or the default build `~/Developer/c64/oscar64/bin/oscar64`; headers in `<oscar64>/include/`). That build reports 1.32.271 but is upstream 709bd70 plus one unpublished local fix (c1270bc, an OptimizeInnerLoop bounds crash). Every Oscar64 recipe was verified with it; upstream 709bd70 fails 46 of them and v1.32.273 fails 57 (issue #25) |
| cc65 | `cl65 -t c64 -O -o out.prg file.c` |
| VICE 3.10 headless (PAL 6569) | `GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound -autostartprgmode 1 -limitcycles 8000000 -exitscreenshot out.png -autostart out.prg` (`-model ntsc` for 6567R8). ~10–20 s per run; wrap in `timeout`. |
| Screenshot geometry | PAL 384×272 PNG, screenshot row = raster line − 16 (rows 0–271 are lines 16–287); NTSC (`-model ntsc`) 384×247, row = line − 28, and rows 235–246 are lines 0–11 of the next frame. x = 8 is VIC X coordinate 0; left border x 0–31, right border 352–383. Measure with PIL, never by eye. An earlier version of this row said − 14; 16 and 28 were each derived from three boundaries in `docs/recipes/kickassembler/topbottom-border-open.md`. The full geometry for both models, the sixteen palette RGB triples VICE emits for each, and a decode snippet are in `docs/runtime/vice-reference.md`, section "Reading the exit screenshot", measured by `docs/recipes/kickassembler/palette-cells.md`. |
| KERNAL / BASIC / char ROM | `/opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin` ($E000), `basic-901226-01.bin` ($A000), `chargen-901225-01.bin` ($D000). Read bytes with python to settle any address or vector claim. |

## Gates before a commit

```bash
npm run check:listings     # every listing builds; fails on a missing toolchain unless --allow-missing
npm run verify:recipes     # every recipe runs headless in VICE at its pinned cycles (docs/recipes/runs.json) and matches its committed PNG pixel-for-pixel; --update re-baselines after a deliberate change, --allow-missing tolerates a recipe with no PNG yet
npm run typecheck          # src, scripts and test, strict incl. noUncheckedIndexedAccess; before 2026-09-22 this was `tsc --noEmit` over src/ alone
npm run lint               # ESLint strict + complexity budget (cyclomatic/cognitive 15, 80 lines/function); split code, never raise a limit
npm run format:check       # Prettier on TypeScript/JSON/YAML; markdown is never reformatted
npm run knip               # unused files, exports, dependencies
npm test                   # vitest against c64_test / c64_docs_test — never the live stores; C64_TEST_STORE=<name> when another run may be going
npm run vice:headless      # once: a windowless VICE into .tools/; every emulator launch here prefers it (src/services/vice-bin.ts)
npm run ingest:clean       # if any doc changed: rebuild graph + vectors; read the summary line
npm run health             # live counts; README carries none, so nothing to update there
```

`.github/workflows/ci.yml` runs all of these except the ingest; Oscar64 recipes are skipped there until #25. `npx lefthook install` once per clone adds git hooks that run the fast ones on what you stage. In a Claude Code session the hooks format, lint and type-check each edited `.ts` file, and a Stop hook builds `dist/` and runs the unit tests once per turn.

## Map

- `docs/` — the knowledge base. `CONVENTIONS-*.md` define the extractable
  structure per doc type; read the one for the type you are editing.
- `docs/recipes/<toolchain>/` — one page per recipe, listing + build +
  expected output + why; `kickassembler/screenshots/` holds the VICE
  pictures that verified them.
- `src/graph/extract.ts` — markdown → graph entities: a marker → parser
  table; one parser per doc type in `src/graph/extract/`.
  `src/graph/apply.ts` writes entities to FalkorDB for both ingest paths.
- `src/ingest.ts` + `src/ingest/` — two-pass batch ingest.
  `src/tools/hydrate.ts` — the single-page path (`c64_ingest_doc`).
- `src/tools/*.ts` — tool functions shared by CLI and MCP; the big ones are
  directories (`query/`, `briefings/`, `pitfalls/`, `lint/`) behind an
  entry file that re-exports. The compatibility rules are a pure function
  in `src/tools/query/compatibility/`; PAL/NTSC timing constants are in
  `src/domain/timing.ts`.
- `src/server.ts` + `src/server/tools-*.ts` — MCP tool definitions
  (description, schemas, title, annotations) registered by one loop.
- `src/services/` — FalkorDB, Qdrant, SQLite analytics, Ollama clients.
  Rows from a store are checked with zod where they are read.
- `scripts/check-listings.ts` — the build gate. `--file <path>` checks one
  file. Toolchains are found by env var, then PATH, then the default paths
  in `scripts/lib/toolchains.ts`.
- `test/` — vitest; `vitest.config.ts` isolates the stores.
- `docs/ONTOLOGY.md` — every node label and edge type, what each means,
  and which page line produces it.
- `CHANGELOG.md`, `VERSION` — bump `KB_DATA_VERSION` for content,
  `KB_SCHEMA_VERSION` for ontology shape, package version with tool surface.

## Read-only ways to see what an agent gets

```bash
node src/cli.ts search "side border cycle 56"
node src/cli.ts technique-lookup sideborder_open
node src/cli.ts check-compatibility fli_image sprite_multiplex_24
node src/cli.ts pitfalls-for stable_raster_irq
node src/cli.ts timing-budget fli_image
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
  cycle-exact; there is no object linker, a library's `.c` is pulled in by
  `#pragma compile("file.c")` from its header; an undefined `extern`
  variable links silently; an immediate-mode `sta` in `__asm` emits opcode
  $FF with no diagnostic; at -O1 to -O3 `c == 255 ? 255 : a[c]` with `a`
  shorter than 256 loses its guard and reads `a[255]` (write it as an `if`);
  `#define A()` with an empty parameter list is refused (error 3006); at -O2 a
  loop-invariant `array + signed_char` is hoisted and zero-extended (-2 → +254). The verbatim messages are in each toolchain
  page's "Reading the errors".
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
