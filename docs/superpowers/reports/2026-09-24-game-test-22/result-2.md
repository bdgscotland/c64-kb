# Game test (issue #22, step 7): second run

Date 2026-09-24. KB data 823, schema 39, tools 2.14.0, commit f781473.
The first run (`result.md`) was on data 810, tools 2.10.0. Between them,
follow-ups #94, #95, #96 and #98 closed; #97 is still open.

Verdict: **not passed.** P1, P4 and P5 pass. P2, P3 and P6 do not.
P2 improved from 3 of 5 to 4 of 5. T6, which passed in run 1, fails now.

## How it was run

The same method as run 1, with three differences, each noted.

- A throwaway store, graph `c64_i22r` and collection `c64_docs_i22r`, was
  built from this tree by `ingest --clean`: 0 dropped on every edge type,
  0 unresolved Cost references. It was deleted after grading.
- A fresh agent (general-purpose, own worktree) got `brief.md`'s brief and
  harness notes, with the store names changed. It was told not to read
  GitHub issues, `docs/superpowers/`, or anything outside its checkout and
  project directory. Difference 1: the heading "issue #22 section 4.1" was
  removed from the text it got, so nothing pointed it at the issue.
  Difference 2: it was told to commit PLAN.md before any game code, so the
  order could be checked from git.
- The agent worked 85 minutes (271 tool calls; run 1: 103 minutes, 334).
  It again started from `templates/shmup-vertical`. Its game is DELTA
  PATROL, in `~/Developer/c64/game-test-22b/delta` (outside the repo).
  Commit 0278d0b holds PLAN.md alone; the starter import is 91be700, after
  it.
- The grader cloned the project at 146c050, rebuilt it with the grader's
  checkout as `C64KB` (the plan gate passed), and ran it in VICE x64sc 3.10
  windowless: PAL `-default` (C64C), NTSC `-model ntsc`. Figures marked
  **grader** come from those runs; **agent** marks figures from its
  MEASURED.md. Difference 3: run 1 counted lost frames with a store trace
  on `LOST_FRAMES`; this run read the same counter through the game's
  `make longplay` driver (`tools/joytest.py`, which reads `$02FD` over the
  binary monitor). The counter is the game's own; the grader read its code
  (`main.c wait_frame`): a frame is lost when the frame flag is already
  set before the wait.
- The clean build's PRG is byte-identical to the agent's `release/delta.prg`
  (grader, `cmp`). The release D64 holds `delta` (66 blocks) and `level2`
  (16 blocks).

## What was built, against the brief

| Brief item | Run 1 | Run 2 | Evidence (run 2) |
|---|---|---|---|
| Scrolls down 1 px a frame | yes | yes | the starter's scroll |
| Map at least three screens | 96 rows | 96 rows, 4.8 screens | `LEVEL2` is 3,923 bytes to `$9000` |
| Fixed five-row panel | **partly**: 4 rows showed | yes: the split moved up 8 lines, panel on lines 207-246 | `expect.json` rect checks; `make phases` compares all of lines 207-246 (run 1: two rows) |
| 16 enemies and the player as sprites | yes, 17 | yes, 17 | verdict `SHOWN 17`, `SEEN 17`, PAL and NTSC (grader) |
| Waves by scroll position, entry paths | yes | yes | `waves.c`, path bytecode |
| Up to eight character bullets | yes; shots deferred on tight frames | yes; NTSC sheds fire in heavy frames | `BOLTS 8` (grader); 375-417 of about 5,760 NTSC frames shed (grader longplay) |
| A hitbox per animation frame | yes, one frame per type | yes, two frames per type, each with its box | `hit.asm fb_*`; the verdict checks both frames show |
| Three-voice tune, effects on one voice | yes, voice 3 | yes, voice 3; the tune also plays during disk calls | `make watch` PASS (grader); 546 steps in a 549-frame LOAD PAL, 643 in 642 NTSC (agent, leveltest; the grader's leveltest printed the same verdict) |
| Random enemy variation | yes | yes: LFSR seeded from the frame count and CIA1 timer A | `ANY 3 2 0` (grader) |
| High-score table saved to disk | yes | yes, five entries with initials | `make gameover` 12 of 12 (grader) |
| Level 2's map loaded from disk | yes, 11.2 s | yes, 10.96 s PAL, 10.73 s NTSC | `make leveltest` 23 of 23 (grader); cycles from CIA2 timers cascaded (agent) |

## Pass criteria, run against run

| # | Run 1 | Run 2 | Evidence (run 2, grader unless marked) |
|---|---|---|---|
| P1 | pass | **pass** | `make shot check` 82 of 82 on PAL and NTSC, `phases: 16 of 16 panels match` over lines 207-246, `watch: PASS`. Lost frames: 0 in 5,398 and 5,399 PAL play frames and 0 in 5,758 and 5,774 NTSC play frames (`make longplay LONGPLAY_GAMES=2 LONGPLAY_SECONDS=150`, a `-dGOD=1` build, fire held and swept, level-2 LOADs included). The agent's own runs: 0 in 32 `joytest` games and 8 `longplay` games of about 26,000-29,600 frames each. |
| P2 | fail, 3 of 5 | **fail, 4 of 5** | T2, T3, T4 and T5 reported before code; T1 was not set. See the trap table. |
| P3 | fail | **fail** | The measured worst frame is below the predicted low end again, the redraw work is in no figure, and two members are more than 25 % off. See below. |
| P4 | pass | **pass** | `make claims` (claims-watch, autopilot, 30,000,000 cycles, drive attached): 0 violations. The autopilot run does no LOAD, so the grader also traced every store to `$59-$FF` in the level-test build (40,000,000 cycles, the `make leveltest` VICE command plus `trace store 0059 00ff`, 147,905 hits): no program store; ROM stores to `$90, $93-$95, $98-$9A, $A3-$A5, $AE-$AF, $B7-$BC, $C3-$C4`, all inside the may-sets of SETNAM, SETLFS, OPEN and LOAD in `docs/hardware/kernal-routines-reference.md` (LOAD's must-set there is `$90, $93-$95, $A3-$A5, $AE-$AF, $B9, $C3-$C4`). |
| P5 | pass | **pass** | Every figure in MEASURED.md names its instrument, model and cycle count. The one set of unmeasured savings (DECISIONS 15) says it is arithmetic. |
| P6 | partly | **partly** | DESIGN-PAGE.md has the GameDesign lines and two `**Measured frame:**` lines (play, transition). No Cost line: the agent may not edit `docs/`. No `**Realised by:**`: the game is not in the repo. |

## The traps, run against run

| Trap | Run 1 | Run 2 |
|---|---|---|
| T1 player outside the multiplexer | not set | **not set.** The starter multiplexes the ship again (17 actors). A grader probe shows the tool would report it: `check-compatibility sprite_multiplex_game sprite_multiplex_8` gives `unit_contention (hard)` on `sprite_0-7, vic_raster_irq`, and `game-briefing` proposed that very pair to the agent, which dropped `sprite_multiplex_8` because of the finding. |
| T2 panel split and multiplexer | reported | **reported**: `unit_contention (hard)` on `vic_raster_irq`, resolved as the tool said, one chain. |
| T3 music, effects, RNG | reported (`init_order`, `shared_register`); no `unit_shared`, `sfx_in_player` had no Claims | **reported**: `init_order (info)` for both SID techniques × `lfsr_random` on `sid_voice_3, sid_filter_volume`, and `shared_register (soft)`. Still no `unit_shared` between the effects and the player: since #96 `sfx_in_player` claims `sid_voice_1-3 (owns)` as one writer with the player, so the rule does not fire, by design. The agent seeded from the frame count and CIA1 timer A. |
| T4 disk I/O beside a KERNAL-out multiplexer | **not reported** | **reported, as info**: `recipe_kernal_out` names the listings that bank the KERNAL out and says to list `ram_under_kernal` so `kernal_banked_out` applies, and to bank the KERNAL in around the calls. Across phases, `raster_irq_during_serial_io` and `sprites_over_badlines_hang_serial_io` (soft) between the play chain and the transition's disk calls (#94). The hard `kernal_banked_out` did not fire, because the agent did not add `ram_under_kernal`. The game runs with `$01 = $35` and banks the KERNAL in around every call, as the finding said. `kernal_clobbers_zp` was silent, correctly (game zero page `$02-$58`). |
| T5 zero page | reported (`recipe_zero_page_overlap`) | **reported**: `recipe_zero_page_overlap (info)` with the bytes, e.g. soft_scroll_v × sprite_multiplex_game `$20-$22, $24-$39`. |
| T6 carry frame | passed: `screen_double_buffer_d018` named as unknown | **fails.** `plan-budget` says "undetermined" but names no unknown member. Since #96, `screen_double_buffer_d018` has a Cost of 57 cycles: the flip and pointer copy only, "the page redraw ... not in it". `soft_scroll_v`'s 46 excludes the carry. So the work that run 1's T6 was about, drawing three rows of the hidden screen each frame, is in no figure and is not named: 1,716-1,776 cycles a frame measured here (agent, PROFILE builds), 2,015-2,180 in run 1. |

## The budget against the run

`plan-budget` on the flat list in PLAN.md (the form the plan gate reads):
play 19,769-29,811 + 2,272 fixed, floor 0, "undetermined" on both models.
With `char_bullets ×14` (#95): 22,709-32,751 + 2,272. The tool now says
the low end "is not a floor": it sums each member's typical or worst frame,
and those need not fall together.

| Measure | Run 1 | Run 2 |
|---|---|---|
| Measured worst play frame (meter) | 16,965 PAL, 15,377 NTSC | 16,284 PAL, 14,189 NTSC, staged heaviest (grader `make stage`, matches agent); 12,502 PAL, 12,755 NTSC over the graded run |
| Predicted low end + fixed | 19,712 + 2,020 | 19,769 + 2,272 |
| Inside `[low, high + fixed]` | no | no: below the low end on both models |

| Member | Cost line | Measured, final build (agent PROFILE, CIA1 timer B, IRQs held off) | Off by |
|---|---|---|---|
| char_bullets | 3,995 for 8; per item 75 + 490 n (#95) | 4,049 PAL, 4,002 NTSC graded (8 bolts, 3 dots: 11 items, 5,465 by the per-item line) | −26 % PAL against 11 items; +1 % against the 8-bullet figure |
| per_frame_hitbox | 3,693 (8 boxes) | 2,126 PAL, 1,872 NTSC graded; 2,664 PAL, 2,492 NTSC staged | −28 % to −49 %; the game tests half the enemies a frame (DECISIONS 10). Before that cut, 3,455 NTSC (−6 %) |
| wave_director | 1,170-3,188 | 877-1,840 | inside the range |
| sid_play_routine_pattern | 779-1,198 | not measured alone; IRQs of a frame 2,176-2,444 PAL, with the zones and split | not comparable |
| sprite_multiplex_game | 8,995-16,600 (arithmetic) | sort at most 1,641, build at most 3,001 | not a measured-vice figure |
| screen_double_buffer_d018 | 57 | redraw 1,716-1,776 a frame, which the 57 excludes | the work is uncounted |

These PROFILE figures are the steps of the one frame whose steps summed
largest, not each step's own worst; only the multiplexer's sort and build
are each step's maximum. So P3's ±25 % test is made against a frame's
share, as in run 1.

**The low end cannot be met by a game that drops no frame.** Both runs'
low ends exceed the PAL frame (22,041 against 19,656 here), and a game
with 0 lost frames cannot have a worst frame above the frame. P3 as
written in the issue (`[low, high + fixed losses]`) therefore fails for any
game that passes P1 on this design. The tool now reports a floor (0 here)
for exactly this reason. Whether P3 should read `[floor, high + fixed]`
is the maintainer's call; on that reading the play frame passes, and P3
still fails on the uncounted redraw and the two members off by more than
25 %.

## What changed because of the follow-ups

| Follow-up | Effect in run 2 |
|---|---|
| #94 phases in `check-compatibility`, KERNAL-out from `ram_under_kernal` | The agent used `name:phase` lists. T4 was reported (info), and the cross-phase serial-I/O hazards were listed. The design kept the play chain and the disk calls apart. |
| #95 counts on a technique list | The agent used `char_bullets ×14` and got 6,935. Its game ended with 11 items and measured 4,049. |
| #96 Cost lines, `sfx_in_player` Claims, sprite DMA | `screen_double_buffer_d018` now has a figure, which hid the redraw (T6). `kernal_load_to_address` and `pal_ntsc_detection` figures were used. The agent charged sprite DMA as 8 sprites on 63 lines (`--sprites 8 --sprite-lines 63`, 1,197), not the 17-sprite measurement. |
| #98 Oscar64 empty-macro fault | Not met. |
| #97 (open) `game-briefing` | Improved without the fix: it now proposed `lfsr_random` and `kernal_load_to_address`. It still proposed `tile_map_render` and `sprite_multiplex_8`, which the check reports as a hard conflict with `sprite_multiplex_game`. |

## What the KB lacked this time (agent's report, checked by the grader)

1. `sprites_over_badlines_hang_serial_io` is listed for the SEQ file
   techniques but not for `kernal_load_to_address` (PLAN.md line 958), though
   LOAD uses the same serial bus.
2. The redraw of a double-buffered screen has no Cost and is not named
   unknown (T6 above).
3. The harness plan gate reads only the flat `# Compatibility:` output and
   plain technique names, not the by-phase output or `name ×N`
   (`harness/hooks/plan-gate.py`; the agent pasted both forms).
4. `lfsr_random` seeds from SID voice 3 and offers no other seed, so the
   `init_order` finding has one answer the brief's effects voice rules out.
5. Nothing in the KB on keeping music playing through KERNAL disk calls.
   The agent found that CIA1 timer interrupts merge while the serial
   routines hold IRQs off (286 steps in a 531-frame LOAD) and paced the
   tune from the TOD clock instead (agent, LOADTIME build). Not measured by
   the grader.
6. `memory-map` has no entry for `$02A7-$02FF`.
7. `CONVENTIONS-game-designs.md` allows several `**Measured frame:**`
   lines; the extractor keeps one per phase and region and warns.
8. The `shmup-vertical` starter's "five-row" panel shows four rows (run 1
   found the same; still unfixed on f781473).

## Should the game land

Maybe, as the maintainer decides; nothing was added to `templates/`. Over
run 1's game it adds a real five-row panel, two animation frames per enemy
with a box each, music through disk calls, a five-entry table with
initials, and load shedding. It sheds 5-7 % of NTSC fire in long games.
