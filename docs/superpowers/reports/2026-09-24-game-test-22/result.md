# Game test (issue #22, step 7): result

Date 2026-09-24. KB data 810, schema 35, tools 2.10.0, commit ff82eaf.
Verdict: **not passed.** P1, P4 and P5 pass. P2, P3 and P6 do not.

## How it was run

- A fresh agent got `brief.md` in this folder: the brief from section 4.1,
  word for word, plus harness notes. It did not get the trap list
  (section 4.2) or the pass criteria (4.4). It was told not to read GitHub
  issues. The brief's heading names issue #22, so a determined agent could
  have looked; its outputs show no sign that it did.
- The store was a throwaway graph `c64_i22g` and collection
  `c64_docs_i22g`, built from this tree by `ingest --clean` (0 dropped).
  The live store was not touched.
- The agent used the c64-kb CLI, started from `templates/shmup-vertical`
  (`npm run new-project`), and worked for 103 minutes (334 tool calls).
  It named its game DELTA STRIKE.
- The grader rebuilt the game from a clean copy and ran it in VICE
  x64sc 3.10, windowless, PAL (`-default`, C64C) and NTSC (`-model ntsc`).
  Figures marked **grader** come from those runs. Figures marked **agent**
  come from the agent's `MEASURED.md`; only the graded checks were
  re-run.
- Sources, PLAN.md, DECISIONS.md, MEASURED.md, the design-page draft,
  the release PRG and D64, and the grader's logs are outside the repo in
  `~/Developer/c64/game-test-22/`. The game is a git repository there:
  commit 094a2e8 holds PLAN.md and the unchanged starter only, so the plan
  came before any code.

## What was built, against the brief

| Brief item | Result | Evidence |
|---|---|---|
| Scrolls down 1 px a frame | yes | the starter's scroll, unchanged; not measured separately by the grader |
| Map at least three screens tall | yes: 96 map rows, 4.8 screens of 20 rows | `src/level.h` `LEVEL_ROWS` |
| Fixed five-row panel | **partly**: the starter's 36-line panel from line 215; row 24 is partly under the border | agent's DECISIONS.md 20 |
| 16 enemies and the player as sprites | yes: 17 in one multiplexer build | verdict text `SHOWN 17`, PAL and NTSC (grader) |
| Waves by scroll position, entry paths | yes | `waves.c`, path bytecode |
| Up to eight character bullets | yes, but shots wait on tight frames | `BOLTS 8` (grader); 34 PAL and 317 NTSC shots deferred (agent) |
| A hitbox per animation frame | yes | `hitbox.c`, `hit.asm` |
| Three-voice tune; effects take one voice | yes, voice 3 | `make watch`: SID written in 3,195 PAL and 2,896 NTSC frames (grader) |
| Random enemy variation | yes, 16-bit Galois LFSR seeded from the title's frame count | `step.asm` |
| High-score table saved to disk | yes | verdict's round-trip check (grader); reboot shows the saved HI (agent, `make joytest`) |
| Level 2's map loaded from disk | yes: 3,927 bytes; 560 PAL and 668 NTSC frames (11.2 s, the stock KERNAL) | map pixels checked on level 2 (grader); CIA2 timers around LOAD (agent) |

## Pass criteria

| # | Result | Evidence |
|---|---|---|
| P1 | **pass** | Builds. `make shot check`: 26 of 26 on PAL and NTSC. 0 lost frames in 1,114 PAL and 1,183 NTSC play frames of the autopilot run: a store trace on `LOST_FRAMES` (`$02FD`) saw only the two stores at start, and `play_frames` read at the verdict store (grader, 90,000,000 cycles, `grade-runs/` and `i22g-lost.sh` in that folder). `make phases`: 16 of 16 (grader). It compares the panel's rule row and one blank row, not the score row, because each phase freezes at a different score. The agent's long runs lost 1 frame in 30,225 in one of four NTSC games. |
| P2 | **fail** (3 of 5) | T2, T3 and T5 were reported before code. T4 was not. T1 was not in the design. See below. |
| P3 | **fail** | The measured worst frame is below the predicted range: PAL 16,965 and NTSC 15,377 against a low end of 19,712 + 2,020 fixed (meter, grader's run matches). The one unknown member (`screen_double_buffer_d018`) was measured. Two members with `measured-vice` figures are more than 25 % off. See below. |
| P4 | **pass** | `make claims` (claims-watch, 90,000,000 cycles, drive attached): 0 stores outside the declared claims. KERNAL stores stay inside the CLOBBERS_ZP may-sets of OPEN, CLOSE, CHKIN, CHKOUT, CHRIN, CHROUT, READST, LOAD, SETNAM, SETLFS and IRQ (grader). |
| P5 | **pass** | Every figure in MEASURED.md names its instrument (meter, CIA timer, PROFILE build, trace, screenshot text). No label passes as a measurement. |
| P6 | **partly** | `DESIGN-PAGE.md` has the GameDesign lines and two `**Measured frame:**` lines. No Cost line was written: the agent could not edit `docs/`. The page names no `**Realised by:**` because the game is not in the repo. |

## The traps

| Trap | Tool report before code | What happened |
|---|---|---|
| T1 player outside the multiplexer | none, correctly | The starter already puts the ship through the multiplexer (17 actors). The trap was never set, so the rule was not tested. |
| T2 panel split and multiplexer | `unit_contention (hard)`, `vic_raster_irq` | Resolved as the tool said: one IRQ chain (the starter's). |
| T3 music, effects, RNG | `init_order (info)` and `shared_register (soft)`, lfsr × player | The agent seeded from the frame count, not voice 3. No `unit_shared` for the effects, because `sfx_in_player` has no Claims line; the tool said a conflict "cannot be ruled out" for it. |
| T4 disk I/O beside a KERNAL-out multiplexer | **none** | The game runs with `$01 = $35` and IRQ vectors at `$FFFE` (`kernel.asm`), and loads and saves through the KERNAL. `kernal_banked_out` never fired: it keys on a `kernal_rom_out` Demand, and `sprite_multiplex_game` demands only `midframe_raster_irqs, changes_sprite_set`. Banking out is a recipe's choice that no technique list can state. The agent handled it from the starter's `io_begin`/`io_end` and two pitfall pages. `kernal_clobbers_zp` was silent, correctly: the game's zero page is `$02-$58` and the KERNAL stores measured at `$90-$C5`. |
| T5 zero page | `recipe_zero_page_overlap (info)` with the bytes, e.g. soft_scroll_v × sprite_multiplex_game `$20-$22, $24-$39` | The rule compares the recipes, not the game. The game's assembly uses no zero page and its C uses `$02-$58`. |
| T6 carry frame | `plan-budget`: play "undetermined", naming `screen_double_buffer_d018` as the unknown | The design has no carry frame: it copies three rows a frame into a hidden screen and flips. Passes on the criterion's "undetermined, with them named" branch. |

## The budget against the run

| Member | Cost line | Measured, final build | Off by |
|---|---|---|---|
| char_bullets | 3,995 (8 bullets) | 2,749 PAL, 1,677 NTSC (8 bolts, 4 dots) | −31 % PAL |
| per_frame_hitbox | 3,693 (8 boxes) | 2,303 PAL, 2,883 NTSC (16 enemies, 9 boxes, half each frame) | −38 % PAL, −22 % NTSC |
| wave_director | 1,170-3,188 | 3,795 PAL, 2,800 NTSC | +19 % over high, PAL |
| sprite_multiplex_game | 8,995-16,600 (arithmetic) | sort 1,522 + build 2,840 PAL; all IRQs of a frame at most 2,579 | not a measured-vice figure |
| screen_double_buffer_d018 | none | 2,180 PAL, 2,015 NTSC (0, 3 or 6 rows) | was unknown |

All from the agent's PROFILE, SORTPROF and WAVEPROF builds (CIA timers,
IRQs held off per step). The first 16-enemy build was 21,017 PAL and
21,309 NTSC worst (meter) and dropped 92 frames in 1,500 on PAL. At that
point bullets cost 6,477 (+62 %) and collisions 4,772 (+29 %). Neither the
over nor the under is the tool's arithmetic being wrong. The figures are
each recipe's own, with its counts, and a technique list cannot give
counts. The final build fits because of a governor that defers shots,
spawns and row copies on tight frames (the agent's DECISIONS.md 11).

## What the KB lacked

1. T4: no way to say "this design runs with the KERNAL banked out" in a
   technique list, so disk I/O beside it is never checked.
2. `check-compatibility` refuses `name:phase`, which `plan-budget` accepts.
   Without it a list mixes the play phase with transition I/O, and
   hazards that cross phases go unseen: the LOAD against the raster chain
   and sprite DMA (`raster_irq_during_serial_io`,
   `sprites_over_badlines_hang_serial_io`). `--design` needs an ingested
   page.
3. `plan-budget` takes no counts on a technique list (`×N` is only read
   from a GameDesign page), and the per-object Cost lines give no per-unit
   figure. So it cannot scale 8 bullets to 12, or 8 boxes to 16 enemies.
4. `plan-budget`'s sprite-DMA charge is 945 cycles (arithmetic) for the
   whole frame. The agent saw code under 17 sprites run up to about half
   again slower. That figure was not isolated and needs a measurement.
5. No Cost line for `screen_double_buffer_d018`, `kernal_load_to_address`
   or `pal_ntsc_detection`.
6. `game-briefing` proposed no random or LOAD technique, though the brief
   names both, and proposed four that do not fit (`text_mode_overlay_render`,
   `software_sprite_preshifted`, `mixed_sprite_char_actors`,
   `tile_map_render`).
7. `sfx_in_player` has no Claims line (already on this issue's deferred
   list). T3's `unit_shared` could not fire.
8. `lint` reports `lfsr_zero_state_lockup` on `rng_hi: .byte 0` beside
   `rng_lo: .byte 1`: a false positive. The grader re-ran it on
   `src/step.asm` and got the same finding.
9. Oscar64: a `bool x = false;` declared inside a `switch` case stopped
   play in the release build; moving it out fixed it. The agent did not
   cut it down to a minimal program, so it is not a confirmed fault.
   Reduced later (#98): the `bool` was not the cause. The same edit made
   `if (metering) meter_open();` with `meter_open()` defined empty, and the
   local Oscar64 build eats the `;` after such a call, so `play_frame` became
   the `if`'s body. v1.32.273 and upstream compile it correctly
   (`docs/toolchains/oscar64-reference.md`, #30).
10. The harness plan gate re-runs `check-compatibility` through
    `npx tsx` against whatever store the environment names. Nothing says
    so.

## Should the game land

Maybe, as a starter or folded into `templates/shmup-vertical`. It adds the
level-2 load, a 17-sprite grid, pre-made bullet glyphs and the frame
governor. It would need the NTSC long-run lost frame fixed and a real
five-row panel. With a starter in the repo, the design page could land
with `**Realised by:**`, and its figures could become Cost lines. That is
the maintainer's call. Nothing was added to `templates/`.
