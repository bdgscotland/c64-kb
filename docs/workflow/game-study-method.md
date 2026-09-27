---
tool: game-study-method
tool_kind: reference-catalog
maintainer: bdgscotland
license: BSD-3-Clause
home_url: https://github.com/bdgscotland/c64-kb
---

<!-- doc-type: toolchain-reference -->

# Reverse engineer a C64 game: the study method, as run on Commando

## Tool

This page is the sequence an agent follows to take a commercial C64 game
apart and turn what it finds into knowledge-base pages: techniques, an
archetype, and a study page. It is written from the first run of it, on
the maintainer's copy of Commando (Elite, 1985), 2026-09-24 to 09-26.
The result is [the Commando study](../game-design/studies/commando.md).

Every command below was run on this machine with VICE x64sc 3.10 (the
windowless build, `-default`: PAL C64C, VIC-II 8565, SID 8580, CIA 8521)
and its output is quoted, cut where "…" shows. The inputs are the
Commando session file and, where a step needs a program of our own, the
recipe PRGs named there. Facts about Commando are quoted from the study
page and its observations with their rung.

The rules that bind the whole method:

- **Facts only.** Addresses, raster lines, cycle counts, sizes and table
  layouts in words. No code, graphics, music or map bytes, and no
  disassembly, leave the working directory `data/re/<game>/` (gitignored).
  The lint in step 10 enforces it on the study page.
- **Every claim carries its rung** (CLAUDE.md rule 3). A routine's name is
  a guess until a run shows what it does. A claim read from code in a RAM
  dump but not seen running says so.
- **The image stays out of the repository.** Only its sha1 and a session
  file are committed.

## The sequence

| Step | Tool (MCP / CLI) | Gives |
|---|---|---|
| 1. Identify the image | `shasum`, `c1541 -list`, `data/games/manifest.json` | sha1, file name, where the copy lives |
| 2. Load map | `c64_re_load_map` / `re-load-map` | stubs, depack stages, game entry |
| 3. Session to play | `c64_re_session` / `re-session` | a replay that reaches play, with injected input |
| 4. Snapshot | `c64_re_snapshot` / `re-snapshot` | RAM and I/O at play start, VIC state decoded |
| 5. IRQ chain | `c64_re_irq_chain` / `re-irq-chain` | handlers, raster lines, pointer dispatch |
| 6. Frame budget | `c64_re_frame_profile` / `re-frame-profile`, monitor traces | cycles per region and per frame kind |
| 7. Teardown fan-out | one agent per subsystem, one shared brief | findings per subsystem, with rungs |
| 8. Verify static claims | VICE runs that poke and watch | confirmed, refuted, unsettled |
| 9. Study page | `docs/game-design/studies/<game>.md` + observations JSON | the GameDesign node, kind studied |
| 10. Lint and ingest | `check:listings`, `ingest` | the page in the graph and the vectors |
| 11. Techniques and archetype | `add-doc`, recipes, `verify-listing` | buildable knowledge |

No coverage tool exists yet. The memory-map agent
used the monitor's `memmapshow` from a checkpoint instead
([disassembly-reference](../toolchains/disassembly-reference.md), "The
VICE monitor in batch").

## 1. Identify the image

Hash the copy you were given, list the disk, and record the sha1 in the
local manifest. The tools resolve an image by sha1 through
`data/games/manifest.json` (gitignored), which maps it to a path:

```text
$ shasum ~/Downloads/Commando.d64
b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f  /Users/duncan/Downloads/Commando.d64
$ c1541 -attach ~/Downloads/Commando.d64 -list
0 "www.c64hq.com   " 00 2a
…
170  "commando"         prg
…
183  "commando ii"      prg
…
73 blocks free.
```

```json
{ "b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f": { "path": "/Users/duncan/Downloads/Commando.d64", "title": "Commando" } }
```

The disk sha1 names the image; the tools also report the extracted
file's sha1 (`fileSha1` 0c19361689f6c977afe2e00e80be303a3d16be5b for
`commando`). Add a row for the image to
[reference-game-sources](../game-design/reference-game-sources.md): whose
copy, which release, and that it is not distributed.

## 2. The load map

A cracked game is usually packed. Before any other trace, find where the
game really starts, or every later tool measures the depacker:

```text
$ node src/cli.ts re-load-map session:docs/game-design/studies/sessions/commando.json
…
    "stubs": [ { "addr": 2049, "sys": 2217, "text": "COMPUTERBRAINS", "line": 2049, … },
               { "addr": 2277, "sys": 2066, "text": "C.C.S.", "line": 65535, … }, … ],
    … { "id": "w20", …, "in_stack_page": true, …, "stage": 1 },
    … { "id": "w23", …, "in_stack_page": true, …, "stage": 2 },
    "entry_pc": 2128,
    "first_program_dispatch_clock": 15243156,
```

Two depack stages running from the stack page, game entry $0850, the
game's first raster interrupt at clock 15,243,156 (30 s run). What the
stages do, and how to read `ram_under_io` and the stub line numbers, is
in [disassembly-reference](../toolchains/disassembly-reference.md),
"Packers and loader stubs". Any trace window you choose later starts
after that clock.

## 3. A session that reaches play

A game that waits for fire never reaches play headless. The session file
replays the image to play by forcing the value the title reads:

```json
{
  "image": { "sha1": "b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f", "kind": "d64", "file": "commando", "title": "Commando", "release": "c64hq" },
  "machine": { "model": "pal" },
  "inject": [
    { "at_pc": "$0FB5", "after_hits": 1000, "set": { "a": "$6F" }, "why": "title waits for fire: CMP #$6F at $0FB5" }
  ],
  "in_play": { "check": "exec", "pc": "$0FEB", "after_clock": 0, "why": "…" },
  "limitcycles": 60000000
}
```

How the injection point was found:

1. Trace loads of `$DC00` and `$DC01` on the title (`trace load dc00
   dc01`). Commando's title reads `$DC00` at $0FB2 (rung 1).
2. Put the checkpoint on the instruction after the load ($0FB5, the
   compare), never on the load: the load would overwrite the value.
3. Set A to the port value wanted (fire on port 2 = $6F) with
   `command N "r a = xx"`, after enough hits for the title to settle
   (`after_hits` 1000; the monitor takes `ignore N 3e8`, hex).
4. Pick an `in_play` PC that runs only once play starts. Commando's
   raster handler already runs on the title, so it cannot tell title from
   play; $0FEB, the title's exit, ran once, only with fire injected.

The same steps on a recipe PRG, with the monitor lines and log, are in
[disassembly-reference](../toolchains/disassembly-reference.md),
"Forcing a read". The session run:

```text
$ node src/cli.ts re-session docs/game-design/studies/sessions/commando.json
{
  "ok": true,
  "result": {
    "session": "commando",
    "image": { "sha1": "b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f", "kind": "d64", "file": "commando",
               "fileSha1": "0c19361689f6c977afe2e00e80be303a3d16be5b" },
    "disk": true,
    "model": "pal",
    "cycles": 60000000,
    "play_clock": 35080026,
    "play_frame": 1784,
    "injections": [ { "at_pc": "$0FB5", "fired_at_clock": 35080021 } ],
    "screenshot": "…/data/re/session-commando-….png",
    "unknowns": []
  }
}
```

Play starts at clock 35,080,026, five cycles after the injection. The
run took 5 s. Every tool that takes `session:<file>` replays the same
path, so their clocks agree.

To move the player, do the same at the game's in-play reads. Commando
reads `$DC00` seven times a frame, one bit at a time ($39F0 fire, $3AC7
up, $3B00 down, $3B18 left, $3B35 right, $3B52 diagonals, $3BA3 any
direction), and the grenade on `$DC01` at $38DC (rung 1, the flow
agent's runs). Create those checkpoints disabled and enable them from a
checkpoint on the play-start PC, so they act only in play.

A menu that needs a fresh press per question is edge-triggered: it counts
a press only after a release. An injection as above holds its value on
every pass after `after_hits`, so that menu counts one press and then
waits for a release that never comes. Give the entry `"once": true` and it
sets its value on exactly one hit and disables its checkpoint in the same
command (`command N "r a = 6f; disable N"`); the next pass reads the
port's own idle value, which is the release, so one once entry is one
press. Two once entries are two presses only if the game reads the idle
value between them: `after_hits` 0 and 1 hit consecutive reads, so the
menu sees no release and counts one. Measured in
VICE x64sc on test/fixtures/re/press-count.asm (a loop that counts a press
only after a release): two once entries counted 2 presses, one held
injection counted 1.

## 4. Snapshot

```text
$ node src/cli.ts re-snapshot docs/game-design/studies/sessions/commando.json
{
  "ok": true,
  "result": {
    "ram_path": "…/data/re/f0f49fdab30454a4f90bf9b26073188f052b931e-35080026.bin",
    "ram_sha1": "f0f49fdab30454a4f90bf9b26073188f052b931e",
    "clock": 35080026,
    "vic": { "bank": 3, "screen": 57344, "charset": 53248, "bitmap": 49152,
             "sprite_pointers": [ 65472, 65472, 65472, 65472, 65472, 64960, 64896, 65024 ],
             "d011": 119, "d016": 216, "d018": 133 },
    "cpu_port": { "00": 47, "01": 54 }
  }
}
```

VIC bank 3, screen $E000, `$01` = $36 at the play-start PC. The dump
(64 KB after a two-byte header) stays in `data/re/`; it is what the
subsystem agents disassemble for their own reading (`da65 --start-addr
0` on the dump without its header). `--after-hits N` dumps at a later
pass of the play PC. The observations record `ram_sha1` f0f49fda… for
clock 35,080,026; two runs with the fixed seed agree. VICE's `-default`
sets `RAMInitRandomChance=10`, a random flip of power-on RAM bits with a
per-run seed: before `runBatch` passed `-raminitrandomchance 0`, two runs
at this clock differed at $07EA ($FB against $FF), and an earlier
observation recorded 783da690…. `runBatch` now passes that flag, so
`c64_re_snapshot` RAM hashes are reproducible across runs. An earlier
version of this paragraph said "until the tools pass that flag, compare
decoded fields between runs, not RAM hashes"; the flag was added after that
was measured.

## 5. IRQ chain and pointer dispatch

```text
$ node src/cli.ts re-irq-chain session:docs/game-design/studies/sessions/commando.json
…
    "handlers": [ { "handler": 16692, "via": ["irq_0314"], "entries": 6318, "pointer": 1030,
        "dispatch": [ { "target": 16695, … "entry_lines": [213, 224] }, { "target": 16776, … [222] },
                      { "target": 16837, … [30, 286, 287] }, { "target": 17028, … [50, 60] },
                      { "target": 17289, … [177, 178, …] } ] } ],
```

One KERNAL-dispatched handler, $4134, which is `JMP ($0406)`; five
parts, each re-arming `$D012` and rewriting $0406 for the next. Without
the `dispatch` list a break on the handler shows one address for all
five parts. The run took 17 s. Reading the output is in
[disassembly-reference](../toolchains/disassembly-reference.md),
"Dispatch through `JMP (ind)`".

## 6. Frame budget

`re-frame-profile` measures the clock between two markers, a store of a
value or an executed PC, once per occurrence. Commando's main loop calls
its frame wait at $08CB (`JSR`, three bytes), so $08CE is where logic
starts and $08CB where it goes back to wait:

```text
$ node src/cli.ts re-frame-profile session:docs/game-design/studies/sessions/commando.json --start 'pc:$08CE' --stop 'pc:$08CB'
{
  "run": { …, "cycles": 60000000, "start_clock": 35080026, … },
  "samples": 1254,
  "worst": 69359,
  "typical": 10525,
  "count": 1254,
  "unpaired": 1,
  "over_frame": 2,
  "unknowns": []
}
```

Typically 10,525 cycles from waking to waiting again, the raster parts
that fire in between included (no input, player standing). The two
samples over a frame are multi-frame passes; the study measured the
respawn pass at 57,840-59,999 cycles over 3 frames. The study's budget
split each frame into IRQ, main-loop and idle cycles by kind of frame
(normal, and the redraw frame every 8th while scrolling) with
hand-written monitor traces: typical busy 11,524 cycles on a normal
frame and 18,004 on a redraw frame (obs `commando#frame-1`, `#frame-3`).
Separate frame kinds before you quote a worst case: the redraw frame is
the one that decides whether a game like this fits.

## 7. The teardown fan-out

With the entry, the session, a snapshot and the chain known, split the
game by subsystem and give each to one agent. Commando's seven:

| Subsystem | What its agent answered |
|---|---|
| memory-map | banking, `$01` over time, what lives where, free RAM, load stages |
| frame | the raster parts, the main loop's order, cycles per frame kind |
| scroll | fine and coarse scroll, the map format, the redraw |
| sprites | virtual sprite arrays, the sort, the multiplexer zones, parking |
| objects | object slots, dispatch, enemy types, spawning, collision, scoring |
| flow | state without a state variable, input, death, area end |
| audio | the driver, songs, effects and voice use |

Every agent gets the same brief (`data/re/<game>/BRIEF.md`): the legal
and repo rules, the rung ladder, where the image, dumps and windowless
VICE are, the monitor quirks already paid for (numbers hex, one `save`
per command, `bank cpu` for `$00`/`$01`), how to reach play, what is
already known, and one output shape: summary, mechanism with rungs, data
layouts in words, links to other subsystems, what a builder should copy,
open questions. The first agent to find a shared fact writes it where
the rest read it: Commando's flow agent found the in-play joystick reads
and wrote them to `INPUT.md`. A synthesis then maps the findings onto
the knowledge base: which techniques exist and match, which differ, and
which are missing.

## 8. Verify static claims in a run

A claim read from code is rung 4 until a run shows it. Commando's
objects agent could not run VICE (it crashed with exit 139), so every
behaviour it described came from the RAM dump alone. A second agent then
tested each claim in VICE: poke an object and a projectile at set
offsets for one frame, walk the player through an area with terrain on
and enemies harmless, trace stores to the type bytes. Most claims were
confirmed, and moved from rung 4 to rung 1. What the runs changed
(rung 1, the verifying agent's runs, kept local with the teardown; the
study page's prose carries the results):

- The area-end bonus is 1,400 points, not 2,000: the score moved
  010000 → 011400 on the walk-out. The 2,000 was the flow agent's
  reading of the operand $14 as decimal 20 hundreds; the score routine
  adds in decimal mode, so $14 is 14 hundreds.
- The static reading warned that the equal-X-extension test makes the
  hit boxes imperfect near X 255/256. The run made it a measured miss: a
  bullet at X 250 does not hit a target at X 255, because X + 10 wraps in
  8 bits.
- The static enemy-grenade aim, vx = trunc(dx / 64) and
  vy = trunc(dy / 64) − 2 with dx, dy the distance to the player, held in
  101 of 101 throws: the range depends on where the player
  stands, not a fixed arc.
- Area 0 has no deadly ground (its attribute table has no deadly
  characters); in area 1 walking up killed the player at row 124.
- The enemy dispatcher doubles a copy of the type in A; the static
  reading had it writing the type byte.

Attack your own claims the same way: for each, name the run that would
refute it, and run it.

## 9. The study page

`docs/game-design/studies/<game>.md`, frontmatter `kind: studied`, one
H2 per game, and the lines
[CONVENTIONS-game-designs](../CONVENTIONS-game-designs.md), "Studied
designs", defines. Four are the study's own:

- `**Studied from:**` title, year, authors, image sha1, session path;
- `**IRQ chain:**` each part's address and raster line, per phase;
- `**Memory map:**` bank, screen, charsets, sprites, code, `$01`,
  `$D018` per area;
- `**Diverges from archetype:**` techniques the game uses that the
  archetype does not list, and the reverse.

`**Measured frame:**` carries the budget with basis
`measured-vice-study`. Each study line ends in `(basis, source)`, and the
source names observation ids. Those ids are entries in
`docs/game-design/studies/observations/<game>.json`: one object per
measurement with `id` (`commando#irq-1`), `tool`, `basis`, `rung`,
`what` and the figures, condensed from the tool's output; no image
bytes. The prose under the lines gives each fact its rung and
observation id, and says where the game differs from the knowledge
base's own techniques.

## 10. The lint and the ingest

`npm run check:listings` runs the `study_expression` lint on every
`kind: studied` page: it refuses a fence holding 6502 mnemonics, a run
of 16 or more hex bytes, and, when the manifest can resolve the image, any
run of 8 or more bytes found verbatim in it:

```text
$ npm run check:listings -- --file docs/game-design/studies/commando.md
     [study] image resolved for docs/game-design/studies/commando.md
ok   docs/game-design/studies/commando.md (study_expression, image-match)
```

Then ingest (`npm run ingest:clean` after changing metadata lines) and
read the summary for dropped names: a Composes or Instance-of name with
no node is counted there, not refused. Check what an agent now gets:
`node src/cli.ts search "<the game>"` and `c64_game_briefing` for the
archetype.

## 11. From findings to techniques and an archetype

The study describes one game; the knowledge base needs what a builder
can reuse. From the synthesis:

- A mechanism the knowledge base lacks becomes a technique H2
  (`CONVENTIONS-techniques.md`) with a KickAssembler recipe built by
  `check:listings` and measured in VICE (`verify-listing`). Commando gave
  ten candidates, among them `threshold_scroll_v`, `row_map_redraw`,
  `sprite_slot_parking` and `invalid_mode_band`; they land with the
  branch `bdgscotland/run-and-gun`, not on this page.
- A mechanism that exists but differs goes into that technique's text as
  a variant, with the study as its source.
- The genre becomes an archetype when no existing one fits:
  `vertical_run_and_gun`, landing with the same branch. A fingerprint
  written from one study agrees with that study by construction, so the
  study page says so, and a second game is the real test.
- Anything too large for the session is a GitHub issue with acceptance
  criteria (CLAUDE.md rule 9).

## 12. What the second study added (Pirates!, 1987)

Pirates! is a BASIC program over machine code, with menus that need a
fresh press per question and a play start 213,772,067 cycles in. Each
point below cost a run to find (VICE x64sc 3.10, the maintainer's copy).

- **Edge-triggered menus.** A menu that counts a press only after a
  release ignores a held value. Give the inject entry `"once": true`: it
  sets the value on one hit and disables its checkpoint (section 3).
  Two once-entries are two presses only if the game reads the idle
  value between them. Pirates!'s setup questions took one-frame presses
  50 frames apart.
- **A text search misses indexed and pointer reads.** Searching the
  trace for `$DC00` found nothing in the fencing scene; its joystick
  read is `LDA ($61),Y` with the pointer set to `$DC00` just before. Put
  a load checkpoint on the register (`trace load dc00 dc00`) and read
  the PC from the hit.
- **BASIC-driven games.** When BASIC reads the input with `PEEK`, the
  read runs inside the BASIC ROM (Pirates!: `LDA ($14),Y` at `$B818`),
  and every screen shares it. Inject at the machine-code routine that
  fills the value BASIC peeks, not at the ROM.
- **An "in play" PC may run everywhere.** A loop shared by menus and
  play gives a false start. Bisect the start with screenshots at a few
  cycle counts, then gate the check with `after_clock`. Say in the
  session's `why` that the PC is not play-only.
- **Long sessions.** 213M cycles of trace wrote a 1.7 GB monitor log;
  the tools now read it as a stream (#134). Keep hand-written runs
  under five minutes each and use the tool's staging: autostarting the
  D64 instead of the extracted file changes every later clock.
- **A cracked copy can alter the code.** Pirates!'s start-up options
  menu patched five interpreter table entries. Say so wherever a
  finding touches them.

It gave four techniques (`scene_bytecode_interpreter`,
`basic_ml_service_blocks`, `bank_swap_trampoline`,
`centred_sprite_map_scroll`), the archetype `open_world_modes`, and
[the Pirates! study](../game-design/studies/pirates.md).

## See also

- [disassembly-reference](../toolchains/disassembly-reference.md): da65,
  the monitor in batch, forcing a read, packers, pointer dispatch.
- [The Commando study](../game-design/studies/commando.md),
  [the Pirates! study](../game-design/studies/pirates.md) and
  [reference-game-sources](../game-design/reference-game-sources.md).
- [vice-reference](../runtime/vice-reference.md): models and reading the
  exit screenshot.
