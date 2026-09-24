# Reverse engineering: measured studies of whole C64 games

Date: 2026-09-23. Status: design, awaiting maintainer review.

## Goal

Learn how complete C64 games are built, from the games themselves, and put
what is learned into the KB as game patterns an agent can build from. The
means is a set of read-only MCP tools that run a game image headless in
VICE and return measured observations, and a study page per game that
turns those observations into facts: main loop, IRQ chain, memory map,
frame budget, data formats, and how the game differs from its archetype.

Success: an agent asking `c64_game_briefing` for an archetype gets, beside
our starters, at least one studied commercial game with a measured frame
and IRQ chain; and a new technique or archetype correction has come out of
a study, measured and landed.

## Decisions taken (maintainer, 2026-09-23)

| Question | Decision |
|---|---|
| Input | Both runtime and static; runtime first. Images are supplied by the maintainer, kept under `data/games/`, never committed. Public commented disassemblies are the cross-check. |
| Who runs the tools | MCP tools from the start (`src/tools/`, `src/server/`), not scripts only. |
| Graph shape | Extend GameDesign; no new node type. |
| Pilot | Gridrunner, Uridium, Elite (public disassemblies: mwenge, Moxon). |
| Engine | Batch `-moncommands` runs, like `scripts/claims-watch.ts`; the vice-mcp live session (`c64_run_game`) stays for interactive use only. |

## Research behind the design

Four threads ran on 2026-09-23 (three Claude agents, one Codex consult).
What changed the design:

- **VICE 3.10 monitor, run here:** `profile` (added in 3.8; `flat`,
  `graph`, `func`, `disass`, `context`), `chis` and `memmapshow` work in
  the windowless build under `-moncommands` + `-monlog`; the build already
  defines `FEATURE_CPUMEMHISTORY`. `memmapshow` must be called from a
  checkpoint's command string after the program has run, not as a
  start-up line: called before anything executes it prints only its
  header (measured in Task 7, docs/toolchains/disassembly-reference.md).
  An earlier version of this bullet said the access map needs a rebuild
  with `--enable-cpuhistory`; that probe had called `memmapshow` at
  start-up. The memmap records access types, not counts. `keybuf` feeds
  the keyboard buffer; no monitor or binary protocol command presses a
  joystick. Binary protocol 0x86 (CPU history) is new in 3.10. Sources:
  VICE manual ch. 6, 12, 13; NEWS.
- **Method (mwenge, Moxon, Lode Runner, pret, Dunki):** hash the exact
  image; find the entry from the BASIC stub or, for packed files, by
  running to the first execute in freshly written memory and snapshotting;
  anchor on hardware (IRQ vectors, `$D012`, `$DC00`, SID); name in stages;
  rebuild byte-identical where possible (Gridrunner is; Uridium and Iridis
  Alpha rebuild only through re-packing); describe architecture apart from
  the listing; tag each claim Code-confirmed / Observed / Inferred /
  Unresolved. No serious project but mwenge's commits the commercial image.
- **Tools elsewhere:** no C64 emulator ships an FCEUX/Mesen-style code/data
  log. Regenerator 2000 (MIT, 2026) has `--headless` and `--mcp-server`
  modes; Unp64 identifies packers and depacks by emulation; SIDId and
  SIDDump identify and log SID players. All are CLIs.
- **Prior art on meaning:** Mappy (Osborn et al. 2017) drives an emulator
  with an input script and reads state, rather than reading intent from
  code. Reflexion models (Murphy, Notkin 1995) compare an expected
  architecture to the measured one and report agreement, divergence and
  absence. ReSym and the 2026 "recompile more, preserve less" study show
  LLM-proposed labels need mechanical cross-checks.
- **Law and norms:** EU Directive 2009/24/EC art. 5(3) lets a lawful user
  run a program to "observe, study or test" it; functionality and data
  formats are not protected expression (SAS v WPL). US: Sega v. Accolade.
  Copy-protection circumvention is a separate question (17 USC 1201).
  Preservation practice identifies an image by hash and does not
  distribute it.

## Principles

1. **Observations and interpretations are separate.** A tool returns
   observations only: an address, a PC, a raster line, a cycle, an access
   type, each with an ID. A study page makes interpretations ("a
   24-sprite multiplexer sorted by Y each frame") and cites the observation
   IDs and the rung each rests on. A label proposed by a model is rung 4
   until an observation confirms it.
2. **Every observation is replayable.** It is pinned to the image SHA-1,
   the VICE version and model, the session file and the frame or cycle at
   which it was taken. Anyone with the same image reproduces it.
3. **Facts only.** Pages carry mechanisms, timings, table layouts in words,
   state machines, and our own re-implementation listings built under the
   usual gates. Never a disassembled routine, a ripped asset or level
   bytes. Enforced by lint.
4. **Calibrate before trusting.** No tool's figure on a third-party game
   is used until the tool reproduces known figures on this repo's own PRGs.
5. **Unknown stays unknown.** A byte never executed is `unknown`, not
   `data`. A handler whose cycles could not be attributed says so.

## Architecture

```
data/games/manifest.json         local: sha1 → file, title (gitignored with the images)
docs/game-design/studies/
  sessions/<game>.json            committed: how to reach play (no image bytes)
  observations/<game>.json        committed: tool output with observation IDs
  <game>.md                       committed: the study page (doc-type game-design)

src/services/vice-batch.ts        one headless run: args, moncommands, monlog, limits, cleanup
src/re/                           pure parsers and analyses (no I/O)
  session.ts  load-map.ts  irq-chain.ts  frame-profile.ts  coverage.ts  disassemble.ts
src/tools/re.ts (+ re/ dir)       tool functions, shared by CLI and MCP
src/server/tools-re.ts            MCP definitions, read-only annotations
```

`vice-batch.ts` absorbs the launch, temp-dir, disk-attach and log-streaming
code now in `scripts/claims-watch.ts` and `scripts/lib/claims-trace.ts`; those
scripts are moved onto it, so there is one way to run VICE in batch. The
trace parser is extended to keep the raster line and cycle (`RL`, `CY`)
that it now discards.

### Image access

Tools take a `sha1`, not a path. The tool resolves it through
`data/games/manifest.json`; an unknown hash is refused. Our own PRGs
(calibration) are addressed by repo path under `docs/recipes/` or
`templates/` build output, which needs no manifest.

### Session file

```json
{
  "image": { "sha1": "…", "kind": "prg|d64|crt", "title": "Gridrunner", "release": "…" },
  "machine": { "model": "c64c", "truedrive": false },
  "start": { "mode": "autostart", "limitcycles": 60000000 },
  "input": [ { "frame": 150, "key": " " }, { "frame": 300, "joy2": "fire", "frames": 5 } ],
  "in_play": { "check": "mem", "addr": "$xxxx", "equals": "$yy", "by_frame": 400 },
  "snapshot": "data/games/snapshots/<sha1>-play.vsf"
}
```

`c64_re_session` runs it, verifies `in_play`, writes the snapshot (local,
gitignored) and returns the frame and cycle at which play was reached. The
other tools start from that snapshot, so boot, loading and title screens
are not measured. Keyboard input uses `keybuf`. Joystick input is an open
problem (below); until it is solved, a session may only use keys or
fire-free starts.

### The tools

All read-only, all returning `{observations: [{id, …, basis, rung}], unknowns: […], run: {vice, model, sha1, session, cycles}}`.

| Tool | Returns | Method |
|---|---|---|
| `c64_re_session` | play reached at frame/cycle; snapshot path | replay the session file |
| `c64_re_load_map` | load address and span; BASIC stub SYS target; packer signature if known; depack transitions (PC of the first execute into memory written after start) | parse PRG/BASIC; exec trace from start; store trace over RAM with a byte cap |
| `c64_re_irq_chain` | per frame: each IRQ/NMI entry PC, raster line and cycle of entry, `$D012` plus `$D011` bit 7 as written, vector writes (`$0314/5`, `$0318/9`, `$FFFA/B`, `$FFFE/F`, both bytes), `$D01A`/`$DC0D` masks, KERNAL dispatch or not | store traces on the vectors and VIC/CIA IRQ registers; exec checkpoints on handler entries found; `RL`/`CY` kept |
| `c64_re_frame_profile` | per phase over N frames: cycles in each handler (self, nested excluded), in the main loop, idle-wait cycles; worst and typical in the `**Measured frame:**` shape | frame boundary = the handler entry nearest a fixed raster line; `profile` for per-routine totals; exec checkpoints for per-frame attribution |
| `c64_re_coverage` | per byte range: executed / read / written / unknown, by bank (`$01`) and epoch (before/after each depack transition); VIC bank (`$DD00`), `$D018`, sprite pointers observed | VICE `memmapshow` from a checkpoint after play starts (not a start-up line); targeted ranges first (an earlier version of this row said memmap needed a rebuilt VICE) |
| `c64_re_disassemble` | disassembly text of a range, seeded from coverage | Regenerator 2000 headless if it passes evaluation (step 1); else da65 with a generated info file |

`c64_re_disassemble` output is for the agent's working context. It never
goes into a page (principle 3).

## Doc format and ontology (schema 32)

A study page is a game-design page (`<!-- doc-type: game-design -->`),
frontmatter `kind: studied`, in `docs/game-design/studies/`. Existing lines
are unchanged. New lines under each H2:

```
**Studied from:** Gridrunner (1982, Jeff Minter, Llamasoft); image sha1=…; session studies/sessions/gridrunner.json
**IRQ chain:** play pal: $xxxx @ line 50, $yyyy @ line 250 (measured-vice, obs gridrunner#12-#14)
**Memory map:** VIC bank 0; screen $0400; charset $2000; $01=$35 in play (measured-vice, obs gridrunner#20-#26)
**Diverges from archetype:** extra: <technique>; missing: <technique>
```

Fixed H3 sections: Main loop and state machine; Object tables; Level and
data formats; How it fits the frame; What an agent should copy as a
mechanism; Evidence (each claim's rung and observation IDs, and the
disassembly cross-check with its URL and licence).

`**Measured frame:**` gains the basis word `measured-vice-study`.

| Graph change | Detail |
|---|---|
| GameDesign `kind` | `built` (default) or `studied`, from frontmatter |
| GameDesign `studied_from` | JSON: title, year, authors, sha1 |
| GameDesign `irq_chain`, `memory_map` | JSON, from the new lines; cleared when the lines go |
| `DIVERGES_FROM` GameDesign → Technique | property `direction`: `extra` (game uses, archetype does not list) or `missing`; names MATCHed, never created; an unknown name is warned and counted, and the candidate technique goes to prose and an issue |

`c64_game_briefing` lists the archetype's studied designs beside its
starters, marked "studied, not buildable here". `c64_plan_budget` accepts a
studied design and prints its measured frame; it has no recipe to predict
from, and says so.

`docs/ONTOLOGY.md`, `CONVENTIONS-game-designs.md` and `VERSION`
(`KB_SCHEMA_VERSION`, package version for the new tools) are updated in the
same change.

### Lint: `study_expression`

On a page with `kind: studied`: refuse a fenced block whose lines are 6502
mnemonics, and any hex run of 16 or more bytes. When the manifest resolves
the page's sha1 locally, also refuse any run of 8 or more bytes that occurs
in the image. Our re-implementation listings live in recipes, not on study
pages, so the rule has no exceptions.

## Pilot, in order, each step gating the next

1. **Calibration and the reference page.** Build `vice-batch`, the parser
   extension, `c64_re_irq_chain` and `c64_re_frame_profile`. Run them on
   the two built designs that carry a `**Measured frame:**`
   (`platformer_scaffold_oscar64`, CIA1 timer B around the loop body;
   `falling_blocks_oscar64`, CIA1 timer A around `game_step`, spawn and
   render) and on two recipes with raster splits. The profiler times the
   same region, between the PCs that start and stop the recipe's timer.
   Pass: every `$D012` line matches the listing; worst and typical fall
   within 2% of the committed figures (the tolerance and the measured
   difference are recorded). `simple_shmup_oscar64` has no measured frame;
   the profiler's figure for it is added as a new measurement, not a
   calibration.
   Evaluate Regenerator 2000 headless against da65 on one recipe PRG.
   Write `docs/toolchains/disassembly-reference.md` (issue #3: da65, the
   monitor commands above, the ROM tables, the byte census), every command
   run here with output quoted. Close #3.
2. **Gridrunner** (PRG, unpacked). `c64_re_session`, `c64_re_load_map`,
   `c64_re_coverage` (targeted mode). Every observation cross-checked
   against mwenge's byte-identical source; the first study page; the
   schema 32 changes and lint land with it.
3. **Uridium** (packed). Depack transition, epoch-aware coverage, a
   second archetype (horizontal shmup). First `DIVERGES_FROM` findings.
4. **Elite** (disk, loader, split screen). True-drive session; cross-check
   against Moxon's source.

After step 4, the tools and page format are reviewed before any further
game is studied.

## Testing

- `src/re/*` parsers are pure and unit-tested on saved monitor logs
  committed as fixtures (logs from our own PRGs only; no third-party
  bytes).
- Calibration (pilot step 1) is a vitest suite that runs VICE, gated like
  `verify:recipes`, and is added to CI.
- Tool tests use our own PRGs. Third-party images are never needed by CI;
  study pages are checked by lint and by the ingest, not by replay.
- `npm run check:listings`, `lint`, `typecheck`, `knip`, `test`,
  `ingest:clean` as for any change.

## Error handling

- Unknown sha1, missing image, missing VICE, missing memmap support: a
  typed refusal naming what is missing and how to supply it; never a
  partial result presented as whole.
- `in_play` not reached by its frame: the tool returns the failure with
  the last screen, not measurements of the wrong state.
- Trace caps (bytes, cycles) hit: the result says so and marks the
  uncovered span `unknown`.
- A handler whose exit was not observed: its cycles are `unknown`, not
  estimated.

## Out of scope

- Copy-protected originals: no circumvention. Use unprotected releases.
- CRT images until the pilot is done.
- Writing labels or comments back into any image or project (no write
  tools).
- Committing any image, snapshot or disassembly of a third-party game.

## Issues filed

A VICE rebuild issue for memmap access maps is not among these: Task 7
measured that `memmapshow` already works in the current windowless build
when called from a checkpoint after the program has run (above); no
rebuild is needed, so no issue was filed for it.

| Issue | Labels |
|---|---|
| #59 Headless joystick input: evaluate VICE event recording/playback; links #42 | harness |
| #60 Legal scope of game studies: art. 5(3), fair use, no circumvention, no distribution; for maintainer review | harness, big-rock |
| #61 Game study: Gridrunner (pilot step 2) | big-rock, content |
| #62 Game study: Uridium (pilot step 3) | big-rock, content |
| #63 Game study: Elite (pilot step 4) | big-rock, content |
| #64 `.sid` worked recipe: find a player's init and play routines (split from #3) | content |

Pilot step 1 closes #3.

## Risks

| Risk | Mitigation |
|---|---|
| Measuring boot or title instead of play | session file with an `in_play` check; tools start from its snapshot |
| False cycle precision in IRQ attribution | calibration against known figures; nested handlers and KERNAL dispatch counted apart; unknown when unobserved |
| Trace volume on all-RAM runs | targeted ranges first; byte caps; `memmapshow` from a checkpoint (no rebuild needed, see above) |
| Coverage mistaken for complete disassembly | `unknown` class; epochs per depack transition |
| Joystick-only games unreachable | issue above; pilot games chosen to start from keys or fire-free where possible |
| Expression leaking into pages | `study_expression` lint; review of every study page |
