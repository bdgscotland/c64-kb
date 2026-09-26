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
   assembles every recipe with the toolchain it names, every
   KickAssembler fragment in `docs/`, and every `acme`, `64tass` and
   llvm-mos listing. A hook runs it on the file you just
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
| ACME 0.97 | `acme -f cbm -o out.prg file.a` (`ACME` env or `acme` on PATH; `brew install acme`) |
| 64tass 1.60 | `64tass -a -o out.prg file.s` (`TASS64` env or `64tass` on PATH; `brew install tass64`); without `-a` text is copied unconverted |
| llvm-mos SDK v23.2.0 | `$LLVM_MOS/bin/mos-c64-clang -Os -o out.prg file.c` (`LLVM_MOS` = SDK directory, `mos-c64-clang` on PATH, or `~/Developer/c64/llvm-mos`) |
| VICE 3.10 headless (PAL c64c: 8565, 8580, 8521) | `GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound -autostartprgmode 1 -limitcycles 8000000 -exitscreenshot out.png -autostart out.prg` (`-model ntsc` for 6567R8). ~10–20 s per run; wrap in `timeout`. With no `-model`, `-default` runs the C64C: VIC-II 8565, SID 8580, CIA 8521 (`-dumpconfig` is identical to `-model c64c`). Every runs.json `pal` run and PAL screenshot is that machine, and stays so (#36). Add `-model c64` (6569, 6581, 6526) to check the older machine: the CIA timer interrupt one cycle later, the 6581 filter and `$D418` digis (not measured here), eleven of the sixteen palette entries (`vice-reference.md`). An earlier version of this row said PAL 6569. |
| Screenshot geometry | PAL 384×272 PNG, screenshot row = raster line − 16 (rows 0–271 are lines 16–287); NTSC (`-model ntsc`) 384×247, row = line − 28, and rows 235–246 are lines 0–11 of the next frame. x = 8 is VIC X coordinate 0; left border x 0–31, right border 352–383. Measure with PIL, never by eye. An earlier version of this row said − 14; 16 and 28 were each derived from three boundaries in `docs/recipes/kickassembler/topbottom-border-open.md`. The full geometry for both models, the sixteen palette RGB triples VICE emits for each, and a decode snippet are in `docs/runtime/vice-reference.md`, section "Reading the exit screenshot", measured by `docs/recipes/kickassembler/palette-cells.md`. |
| KERNAL / BASIC / char ROM | `/opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin` ($E000), `basic-901226-01.bin` ($A000), `chargen-901225-01.bin` ($D000). Read bytes with python to settle any address or vector claim. |

## Gates before a commit

```bash
npm run check:listings     # every listing builds; fails on a missing toolchain unless --allow-missing
npm run verify:templates   # every starter in templates/, made as a fresh project: build, shot + check on PAL and NTSC, disk; --selftest adds the FORCE_FAULT build and each starter's VERIFY_TARGETS
npm run verify:recipes     # every recipe runs headless in VICE at its pinned cycles (docs/recipes/runs.json) and matches its committed PNG pixel-for-pixel; --update re-baselines after a deliberate change, --allow-missing tolerates a recipe with no PNG yet
npm run claims:recipes     # every KickAssembler recipe under claims-watch with its runs.json cycles and flags; fails on a store its techniques' Claims and its claims/harness/ram/kernal_services keys do not declare; cartridge and skipped recipes are listed as not run
npm run typecheck          # src, scripts and test, strict incl. noUncheckedIndexedAccess; before 2026-09-22 this was `tsc --noEmit` over src/ alone
npm run lint               # ESLint strict + complexity budget (cyclomatic/cognitive 15, 80 lines/function); split code, never raise a limit
npm run format:check       # Prettier on TypeScript/JSON/YAML; markdown is never reformatted
npm run knip               # unused files, exports, dependencies
npm test                   # vitest against c64_test / c64_docs_test — never the live stores; C64_TEST_STORE=<name> when another run may be going
npm run vice:headless      # once: a windowless VICE into .tools/; every emulator launch here prefers it (src/services/vice-bin.ts)
npm run ingest:clean       # if any doc changed: rebuild graph + vectors; read the summary line
npm run health             # live counts; README carries none, so nothing to update there
```

`.github/workflows/ci.yml` runs the type check, lint, formatting, knip, the unit and integration tests, `check:listings --allow-missing`, and `verify:recipes` for the KickAssembler and cc65 recipes. It does not run `verify:templates`, the ingest, `health` or anything Oscar64: those are skipped there until #25, so run them here. An earlier version of this sentence said CI ran all of these except the ingest. `npx lefthook install` once per clone adds git hooks that run the fast ones on what you stage. In a Claude Code session the hooks format, lint and type-check each edited `.ts` file, and a Stop hook builds `dist/` and runs the unit tests once per turn.

## Releasing to npm

The package is `c64-kb` on npm (unscoped, BSD-3-Clause). A release is
outward-facing: tag only when the maintainer asks for one.

1. Land the work on `main` with every gate green (above).
2. Set the version in both package files: `npm version <x.y.z>
   --no-git-tag-version`. Bump `MCP_TOOL_VERSION` in `VERSION` with the
   tool surface (major: breaking schema, minor: new tool or field, patch:
   fix). Head the CHANGELOG entry with the new versions.
3. Commit, push to `main`, then `git tag v<x.y.z>` and
   `git push origin v<x.y.z>`. The tag must equal package.json's version,
   or `.github/workflows/release.yml` fails.
4. The workflow's one job declares `environment: npm`, so it first waits
   for the maintainer's approval in GitHub. It then checks the tag against
   package.json, runs typecheck, lint and the unit tests, and publishes
   through npm trusted publishing: no token, provenance added by npm. A
   version already on npm is skipped, so re-running a tag is safe.
5. Check `npm view c64-kb version`. Users upgrade with
   `npm install -g c64-kb` and must run `c64-kb ingest --clean` after it.

The package ships `dist`, `docs`, `templates`, `VERSION`, `CHANGELOG.md`
and `docker-compose.yml` (package.json `files`; `c64-kb services up` needs
the compose file), and npm adds README and LICENSE. A doc or starter change
reaches users only through a release.

## The README

README.md is the public front page. Keep it current in the same push as
the work:
- A new starter gets its picture in "What the starters play": a clean
  capture of the normal build in play, with no verdict, meter or debug
  text, made reproducibly by `make gallery` and copied to
  `docs/figures/starters/<name>.png`. The graded shots stay the checks'
  baselines; they are not front-page pictures. (Maintainer, 2026-09-24:
  the graded shots showed debug text; an earlier version of this rule
  used them.)
- A new or changed MCP tool updates the tools section. A new npm script
  or gate updates the development section.
- No counts (rule 8 and the tallies note above). Link a live figure's
  source (`c64-kb health`, CHANGELOG) instead of quoting it.
- Never link a path that is not on `main`.

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
  a call of `#define A()` (empty parameter list) eats the `;` after it: a
  non-empty body gives error 3006, an empty body compiles silently and
  `if (c) A(); f();` becomes `if (c) f();` (local build only; v1.32.273
  and upstream are correct; an earlier version of this line said the
  macro is always refused); a loop-invariant `array + signed_char` is hoisted and zero-extended
  (-2 → +254) at every level, upstream too; `a[x]++` after a store indexed by
  `a[x] + 1` can store the wrong value (read `a[x]` into a variable); stores to a
  local `volatile` vanish at -O1/-O2 (use a global that something writes);
  at -O2 a `volatile` global that nothing writes is read as its initial
  value (`g | 8` compiles to `LDA #$0D`; local, v1.32.273 and upstream
  9a902f6 alike);
  a comparison on a function's address at `$8000` or above folds wrong
  (`((unsigned)&main >> 8) >= 0x80` with `main` at `$8080` in a
  `-tf=crt8` build compiles as false; the same test at `$0880` is right;
  all three builds);
  a `while (x >= y)` midpoint-circle loop calling an `inline` plot eight
  times a pass leaves after one pass at -O2 and -O3 (-O1 is right; all
  three builds; a `__noinline` wrapper around the plot avoids it); two `const char` tables
  shifted `<< 8` with one index in a loop that also calls a `__noinline`
  function read the second table at the first one's value (-O1 and up);
  four fixed-address arrays cleared in one loop send one array's stores
  to another's page (-O1 and up, upstream too: one `memset` each). Status per fault against
  upstream HEAD is in #30. The verbatim messages are in each toolchain
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
The VICE PAL runs are its default C64C model (8565, 8580, 8521), not a
6569 either; an earlier version of this section did not say which model.
The pages say so. Do not upgrade that wording.
