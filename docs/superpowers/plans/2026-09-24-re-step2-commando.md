# Reverse engineering, pilot step 2: Commando, the first study

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent can take a packed commercial game from a D64 to a measured study page: sessions that reach play by register injection, a RAM snapshot, a load map, coverage, a frame profile with no timer in the game, the next schema so the study is a GameDesign, and the content the Commando run measured.

**Architecture:** Everything runs through `runBatch` (`src/services/vice-batch.ts`, async) and pure analyses in `src/re/`. A new `src/re/session.ts` turns a committed session file into monitor commands (injections, in-play check) and resolves the image through a local sha1 manifest; every tool takes either `prg_path` (our own PRGs) or `session` (a committed session file). Schema 32 extends the game-design extractor. Study facts live in a committed study page plus an observations JSON; images, dumps and disassemblies stay under `data/` (gitignored).

**Tech Stack:** TypeScript (Node 24, strict), zod, vitest, VICE x64sc 3.10 windowless, c1541, da65, KickAssembler 5.25, FalkorDB/Qdrant (ingest).

**Spec:** `docs/superpowers/specs/2026-09-23-reverse-engineering-design.md`, including "Amendment 2026-09-24: Commando is the first study". Gap log from the Commando dogfood run: the table in Task 11 below.

## Global Constraints

- Tools stay read-only (`READ_ONLY`); a disk is copied into the run's work directory; dumps go under `data/re/` (gitignored), never `docs/`.
- Every observation carries `id`, `basis: "measured-vice"`, `rung: 1`; an unsettled value is `null` plus an `unknowns` entry.
- Facts only on study pages: no disassembled routine, no hex run of 16+ bytes, no asset bytes. The image, its files, dumps and disassemblies are never committed.
- Numbers in session files are decimal; written to the monitor as hex (VICE reads monitor numbers as hex: `ignore 1 1000` skips 4,096).
- VICE runs keep `+autostart-delay-random`, `-default`, windowless x64sc; exit 1 on `-limitcycles` is success.
- PAL frame 19,656 / NTSC 17,095 from `REGION_TIMING`; never hard-coded.
- Lint: complexity 15, 80 lines per function; split, never disable. tsconfig `erasableSyntaxOnly`, `noUncheckedIndexedAccess`.
- Commit named paths; messages say what was wrong or missing and the evidence; `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Versions: `MCP_TOOL_VERSION` minor for new tools or fields, `KB_SCHEMA_VERSION` for the new schema, `KB_DATA_VERSION` for docs; merge origin/main first and bump past it; package.json version unchanged.
- The Commando image is the maintainer's: `~/Downloads/Commando.d64`, sha1 `b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f`, file `commando` sha1 `0c19361689f6c977afe2e00e80be303a3d16be5b`. Tests that need it skip without it; CI never has it.

## State of main this plan builds on (2026-09-24, origin/main 16dd6c7)

- #66 landed on main (343fac5, tools 2.5.0): dispatch by stack pushes within a 94-cycle window, `interrupts` and `transient` fields. It lacks four things the unmerged branch `bdgscotland/re-irq-dispatch` (7d88cf6) has and Commando needs: `JMP (pointer)` sub-handler dispatch (`pointer`, `dispatch`, entry `target`); same-clock stores applied before dispatch; `$00` DDR with `$01` for KERNAL mapping (`CpuPort`); IRQ/NMI sharing one RAM handler reported as ambiguous. Task 0 ports them.
- #59 closed: binary-monitor joystick with `-controlport2device 37` (`templates/_harness/drive.py`). Batch runs still use register injection (Task 3).
- #64 closed: the `.sid` worked example is on the disassembly page.
- Versions on main: KB_SCHEMA 39, MCP_TOOL 2.14.0, KB_DATA 827. This plan's schema change is main's + 1 (40 at planning time); "schema 32" in the spec means "the next schema".

## Review Focus

1. A session whose `in_play` check never passes: the tool refuses (`reason: "not-in-play"`) with the clock reached and an exit screenshot path; it never measures the title as play. Test in Task 3.
2. An injection whose `at_pc` is never executed: listed in `unknowns` ("injection at $0FB5 never fired"), and `in_play` then decides. Test in Task 3.
3. A manifest entry whose file hash no longer matches: refused (`reason: "image-changed"`), never run. Test in Task 2.
4. A D64 file name that is not on the disk: refused (`reason: "no-file"`) with the directory listing. Test in Task 2.
5. A study page line naming a technique that does not exist: warned and counted as dropped at ingest, never a created node. Test in Task 8.

---

### Task 0: Port the #66 extras onto main's implementation

**Files:** Modify `src/re/irq-chain.ts`, `src/tools/re.ts`, `src/server/tools-re.ts`, tests `test/re-irq-chain.test.ts`, `test/re-tools.test.ts`; read the branch `bdgscotland/re-irq-dispatch` (commits 2508e4f, f561ac8, fa2f00f, 7d88cf6) and its report for what each part does and its tests.

Keep main's design (343fac5) as the base. Port, test first, each as its own commit: (a) `JMP (abs)` handler → pointer traced, `dispatch` per target with entries/lines/armed, each entry's `target` (the branch's fixture: a `$0314` handler `JMP ($033C)` with three parts on lines 50/120/200); (b) apply every store at a clock before resolving that clock's interrupt; (c) KERNAL mapping from `$00` and `$01` via `CpuPort` (find where main keeps it now: `src/claims/` or `src/re/`); (d) `$FFFE`/`$FFFA` naming one RAM handler → `via` both, an unknown, neither transient. Acceptance: main's existing tests and re-calibration unchanged; sprite-multiplex-game and raster-bars results unchanged; on the Commando session (skip without the image) `$4134 → JMP ($0406)` resolves to five parts. Commit messages cite the branch commit each part came from.

### Task 1: Frames start on raster line 0

**Files:** Modify `src/re/irq-chain.ts` (frame numbering), `src/re/frame-profile.ts` (sample frame), Test `test/re-irq-chain.test.ts`, `test/re-frame-profile.test.ts`.

**Interfaces:** Produces `frameOf(clock: number, ref: { clock: number; line: number; cycle: number }, timing: RegionTiming): number` in a new `src/re/frames.ts`: the clock of line 0 cycle 0 of the reference hit's frame is `ref.clock - (ref.line * cycles_per_line + ref.cycle)`; frames count from there. The first hit with a known line and cycle after the start clock is the reference; with none, frames fall back to the start clock and an `unknowns` entry says so.

- [ ] Test: two entries at lines 30 and 222 of one frame, and line 30 of the next, get frames 0, 0, 1 (today they can split); a hit with line -1 is never the reference.
- [ ] Run, see it fail; implement `frames.ts`; use it in both analyses; run; commit ("frames were numbered from the start clock, so one frame's entries split across two; measured on Commando's five-IRQ chain").

### Task 2: Images by sha1 and D64 files

**Files:** Create `src/re/image.ts`; Modify `src/tools/re.ts`; Test `test/re-image.test.ts`.

**Interfaces:**
```ts
export interface ImageRef { sha1: string; file?: string }            // file: name on a D64
export type Resolved = { ok: true; prg: string; work: string; dispose(): void; image: { sha1: string; kind: "prg" | "d64"; file?: string; fileSha1: string } }
                     | { ok: false; reason: "no-manifest" | "unknown-sha1" | "image-changed" | "no-file" | "not-prg"; error: string };
export async function resolveImage(ref: ImageRef, manifestPath = "data/games/manifest.json"): Promise<Resolved>;
```
Manifest: `{ "<sha1>": { "path": "/abs/path/Commando.d64", "title": "Commando" } }`, local only. The resolver hashes the file and refuses a mismatch; for a D64 it runs `c1541 -attach <copy> -read "<file>" <work>/p.prg` (c1541 from `scripts/lib/toolchains.ts` `findC1541`, moved or re-exported into `src/` if `src/` needs it) and on a missing file returns the directory from `c1541 -list`.

- [ ] Tests with fixtures built in the test (a tiny KickAssembler PRG written into a D64 made with `c1541 -format test,01 d64 x.d64 -write p.prg prog`): unknown sha1, changed file, missing D64 file name (error lists `prog`), PRG and D64 happy paths, `fileSha1` of the extracted PRG.
- [ ] Implement; commit ("tools took only PRG paths inside the repo or os.tmpdir(); a D64 had to be unpacked by hand and a /private/tmp scratch path was refused").

### Task 3: Session files and `c64_re_session`

**Files:** Create `src/re/session.ts`, `docs/game-design/studies/sessions/` (directory, with a README line in the conventions, Task 8); Modify `src/tools/re.ts`, `src/server/tools-re.ts`, `src/cli.ts`; Test `test/re-session.test.ts`.

**Interfaces:**
```ts
export const SessionSchema = z.object({
  image: z.object({ sha1: z.string().regex(/^[0-9a-f]{40}$/), kind: z.enum(["prg", "d64"]), file: z.string().optional(), title: z.string(), release: z.string().optional() }),
  machine: z.object({ model: z.enum(["pal", "ntsc"]).default("pal") }),
  inject: z.array(z.object({ at_pc: z.string(), after_hits: z.number().int().min(0), set: z.record(z.enum(["a", "x", "y"]), z.string()), why: z.string() })).default([]),
  in_play: z.object({ check: z.literal("exec"), pc: z.string(), after_clock: z.number().int() }),
  limitcycles: z.number().int(),
});
export function injectCommands(s: Session, firstCheckpoint: number): string;   // trace exec + ignore <hex> + command N "r a = 6f"
export function inPlayCommand(s: Session): string;                             // trace exec on in_play.pc
export function inPlayClock(hits: Iterable<Hit>, s: Session): number | null;    // first exec of in_play.pc after after_clock
```
Checkpoint numbers: VICE numbers checkpoints in creation order from 1; `injectCommands` takes the first free number so `command N` names the right one, and the tool puts injections first in the command file. `c64_re_session({session})` loads the file (a repo path under `docs/game-design/studies/sessions/`), resolves the image (Task 2), runs, and returns `{play_clock, play_frame, injections: [{at_pc, fired_at_clock|null}], screenshot}` or refusal `not-in-play` (with an exit screenshot under `data/re/`).

- [ ] Tests (unit): hex conversion (`after_hits: 1000` → `ignore N 3e8`), checkpoint numbering, zod refusals; (VICE, own fixture): a KickAssembler PRG whose title loop `LDA $DC00 / CMP #$6F / BNE` waits for fire; the session injects A=$6F and reaches the play PC; an injection at an address never run lands in `unknowns`; a session with no injection is refused `not-in-play`.
- [ ] Commit ("games that wait for fire could not be reached headless; injection at the game's own read, measured on Commando's $0FB5").

### Task 4: `c64_re_snapshot`

**Files:** Create `src/re/vic-state.ts`; Modify `src/tools/re.ts`, `src/server/tools-re.ts`, `src/cli.ts`; Test `test/re-snapshot.test.ts`.

**Interfaces:** `c64_re_snapshot({session, after_hits_of_play_pc?: number})` → dumps RAM (`bank ram`, `save "<data/re/<sha1>-<clock>.bin>" 0 0000 ffff` from a checkpoint `command` on the in-play PC after N hits) and I/O (`bank io`, `save … d000 dfff` in a second checkpoint) and returns `{ram_path, ram_sha1, clock, vic: {bank, screen, charset, bitmap, sprite_pointers: number[8], d011, d016, d018}, cpu_port: {"00": n, "01": n}}` decoded by `vic-state.ts` from `$DD00`, `$D018`, `$D011`, `$D016` and the screen's `+$3F8`. The last save wins (the checkpoint fires again); write to one file per call.

- [ ] Unit tests for `vic-state.ts` decode (bank 3 + `$D018=$84` → screen `$E000`, charset `$C800`); VICE test on the irq-chain recipe PRG: bank 0, screen `$0400`.
- [ ] Commit ("a packed game's code exists only in RAM after depacking; there was no tool to dump it at a known moment").

### Task 5: `c64_re_load_map`

**Files:** Create `src/re/load-map.ts`; Modify tools/server/cli; Test `test/re-load-map.test.ts`.

**Interfaces:** `c64_re_load_map({session} | {prg_path})` → `{load, end, stubs: [{addr, sys, text}], writers: [{pc_range, dest_ranges, stores, first_clock, last_clock, in_stack_page}], transient_vectors, first_program_dispatch_clock}`. Method: one run with `trace store 0000 ffff` capped (stop after the first program dispatch + one frame, or a byte cap with an `unknowns` entry), group stores by writer PC range (contiguous PCs within 256 bytes) and destination ranges; stubs from BASIC lines (`$9E` + digits + text) found by walking the program's BASIC line links and any second stub text in the image.

- [ ] Unit tests on synthetic hits (two writers, stack-page writer flagged, cap reached → unknown); VICE test on a KickAssembler PRG that copies itself to `$8000` from the stack page (as Gridrunner's stub does) and jumps there.
- [ ] Commit ("packed games showed decruncher bulk copies as vector writes with no stage; measured on Commando's $018C and $3EB3 writers").

### Task 6: `c64_re_coverage`

**Files:** Create `src/re/coverage.ts`; Modify tools/server/cli; Test `test/re-coverage.test.ts`.

**Interfaces:** `c64_re_coverage({session})` → runs `memmapzap` at the in-play PC's first hit, then `memmapshow` N frames later (a second checkpoint command), parses VICE's rows (measure the format first on the irq-chain recipe PRG and save a fixture; Task 7 of step 1 quoted rows ending "(uninitialized read)") into ranges `{start, end, kinds: ("x"|"r"|"w")[]}` for RAM, and returns code (executed) ranges, data (read, never executed), written-only, and untouched as `unknown`.

- [ ] Fixture-based parser tests; VICE test on the irq-chain PRG: the dispatcher and slot handlers are in an executed range.
- [ ] Commit ("no tool separated code from data at runtime; memmapshow works from a checkpoint in the windowless build").

### Task 7: Frame mode and sessions for the two existing tools

**Files:** Modify `src/re/frame-profile.ts`, `src/tools/re.ts`, server, cli; Test `test/re-frame-profile.test.ts`, `test/re-tools.test.ts`.

**Interfaces:** `c64_re_frame_profile` gains `mode: "region" | "frame"` (default region, unchanged) and accepts `session` instead of `prg_path`. Frame mode: per raster-aligned frame (Task 1), cycles inside each dispatched handler or pointer sub-handler (entry to its RTI; the RTI address is the first `RTI` executed after the entry at the same stack depth, found by an exec trace on `RTI`s the coverage map lists, or by tracing the handler range), summed per frame; `main = frame − handlers`; worst and typical per handler and for the total, in the `**Measured frame:**` shape. `c64_re_irq_chain` accepts `session` too.

- [ ] Tests: synthetic hits with two handlers per frame; VICE test on the irq-chain PRG (three slots, their per-frame cycles summed, main = rest).
- [ ] Commit ("a studied game has no timer of its own; its frame could not be measured").

### Task 8: The next schema — a studied game is a GameDesign

**Files:** Modify `src/graph/extract/game-design.ts`, `src/graph/apply.ts`, `src/graph/extract/vocabulary.ts` if the basis word list lives there, `src/tools/briefings/*` (game briefing), the plan-budget tool, `docs/ONTOLOGY.md`, `docs/CONVENTIONS-game-designs.md`, `VERSION` (`KB_SCHEMA_VERSION` main's + 1); Test `test/extract-game-design.test.ts`, `test/game-design-graph.test.ts`, `test/briefings.test.ts`, `test/plan-budget.test.ts`.

As specced (spec "Doc format and ontology (schema 32)"): frontmatter `kind: studied`; lines `**Studied from:**`, `**IRQ chain:**`, `**Memory map:**`, `**Diverges from archetype:**`; `**Measured frame:**` basis `measured-vice-study`; `DIVERGES_FROM` edges (MATCHed, unknown names warned and counted); briefing lists studied designs "studied, not buildable here"; plan budget prints a studied design's measured frame and says it has no recipe to predict from.

- [ ] Extractor tests first (each line, malformed lines refused whole, unknown technique counted); graph tests against the test store; briefing and budget tests.
- [ ] `npm run ingest:clean` (pgrep first; the pub-* stores) and quote the summary line; commit.

### Task 9: Lint rule `study_expression`

**Files:** Create a rule in `src/tools/lint/` following its existing rule pattern (read the directory first); Test `test/lint.test.ts`.

As specced: on `kind: studied` pages, refuse a fenced block of 6502 mnemonics and any hex run of 16+ bytes; when `data/games/manifest.json` resolves the page's sha1 locally, refuse any run of 8+ bytes that occurs in the image (or in the file extracted from a D64). Wire it into whatever gate lints docs (check `npm test`/`check:listings` for where doc lints run; if none, add it to `check:listings` for `docs/game-design/studies/`).

- [ ] Tests with a synthetic page and image; commit.

### Task 10: Content the Commando run measured

**Files:** Create `docs/workflow/game-study-method.md` (doc type per CONVENTIONS; use the `add-doc` skill); Modify `docs/toolchains/disassembly-reference.md` (packer section run here; register injection; monitor numbers are hex; RAM dump by checkpoint `command`; `JMP (ind)` dispatch), `docs/techniques/` (a technique for blanking a band with the invalid ECM+BMM mode on purpose, in the file where display-mode techniques live, with a KickAssembler recipe verified in VICE and measured per the `verify-listing` skill — the technique needs a recipe under the conventions), `docs/game-design/reference-game-sources.md` (a row for the Commando image: the maintainer's copy, facts only).

Every command on these pages is run here on our own PRGs or the recipe; facts about Commando are quoted from the study's observations with their rung. The method page is the end-to-end sequence: identify the image (sha1), load map, session with injection, snapshot, IRQ chain (pointer dispatch), coverage, frame profile, disassemble for your own reading, write the study page with the four lines, run the lint and the ingest. Search check after ingest: `node src/cli.ts search "reverse engineer a C64 game"` ranks the method page first (gap 1).

- [ ] Write, `npm run check:listings`, `npm run verify:recipes -- --file <new recipe>`, lint, ingest, search check; commit.

### Task 11: The Commando study

**Files:** Create `docs/game-design/studies/sessions/commando.json`, `docs/game-design/studies/observations/commando.json`, `docs/game-design/studies/commando.md`.

Run every tool through the session on the maintainer's image (skip cleanly without it; this task runs here, not in CI). Record observations JSON from the tools' structured output (addresses, lines, cycles, ranges; no image bytes). Write the page: `kind: studied`, `**Game design:** commando_1985`, `**Instance of:** vertical_shmup`, `**Studied from:**`, `**Composes:**` (techniques actually observed, e.g. `irq_chain_table`, `soft_scroll_v`, `sprite_multiplex_game`, `vic_bank_select`, `ram_under_kernal`, the new blanking technique), `**IRQ chain:**`, `**Memory map:**`, `**Measured frame:**` (frame mode), `**Diverges from archetype:**` against `vertical_shmup`'s expected techniques; the fixed H3 sections; Evidence with each claim's rung and observation IDs. No disassembly-backed cross-check exists for Commando: say so (Gridrunner, step 3, is the cross-check of the tools).

Gap log the plan closes (the Commando dogfood, 2026-09-24):

| # | Gap | Task |
|---|---|---|
| 1 | search does not route "reverse engineer" to a method | 10 |
| 2 | packer method rung 4, no commands | 10 |
| 3 | fire injection undocumented (#59 closed on main by binary-monitor joystick; batch runs need injection) | 3, 10 |
| 4 | monitor numbers are hex | 3, 10 |
| 5 | frames not raster-aligned | 1 |
| 6 | exec hits polluted the chain | #66 (landed) |
| 7 | `JMP (ind)` dispatch invisible | #66 (landed) |
| 8 | phantom `$EA34` | #66 (landed) |
| 9 | decruncher copies read as vector writes | 5, #66 |
| 10 | no technique for deliberate invalid-mode blanking | 10 |
| 11 | only repo/tmp PRGs; no D64 | 2 |
| 12 | no RAM dump tool | 4 |
| 13 | GameDesign cannot hold a studied game | 8 |

- [ ] Run the lint and the ingest; `node src/cli.ts game-briefing "vertical scrolling shooter"` lists `commando_1985` as studied; `node src/cli.ts plan-budget commando_1985` prints the measured frame; commit.

### Task 12: Landing

- [ ] Merge origin/main, bump `MCP_TOOL_VERSION` minor (new tools), `KB_SCHEMA_VERSION` main's + 1, `KB_DATA_VERSION` past main; CHANGELOG entry headed with the versions (what was missing, the Commando evidence); README tools rows for the new tools (plain facts, needs the windowless x64sc); comment on #59 (closed) with batch register injection as the complement to drive.py and #61 (Gridrunner is now step 3, the cross-check); all gates; push the branch; ask the maintainer before merging to main.
