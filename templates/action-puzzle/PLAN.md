# Plan: action-puzzle

A Boulder Dash-style cave game, planned from the c64-kb tools on 2026-09-23
(c64-kb 0.14.0, the graph on this branch). The tool output is pasted whole.

## Concept

The player digs through earth in a 40 x 22 cave of one-character cells.
Boulders and gems fall and roll under a cave scan; two enemy kinds follow
walls. Collecting the cave's quota of gems opens the exit; walking into it
decodes the next cave from its RLE stream. A timer, a score and three lives;
at game over a new high score is entered by joystick and the five-row table
is saved to drive 8 and loaded back at start-up. An original tune plays
through the game, sound effects on their own voice. PAL and NTSC, the same
game logic on both (one cave frame every four display frames).

## Briefing

Command: `npx tsx src/cli.ts game-briefing "Boulder Dash-style cave game: dig earth, boulders and gems fall and roll under a cave scan, enemies follow walls, enough gems open the exit; RLE-compressed caves decoded between caves; timer, score, high-score table saved to disk" --archetype action-puzzle`

Kept from its 13 proposals: cave_scan_engine, high_score_table_insert,
raster_profile_bars (the harness meter is its CIA half).

Dropped, and why: text_mode_overlay_render (no moving overlay: every
object is a cell), directory_read_and_select (the file name is fixed),
irq_keyboard_own_scan and keyboard_matrix_scan (joystick only),
text_window_and_menu (one fixed table box, drawn directly),
actor_activation_window and nav_area_pathfinding (enemies are cells the scan
moves by local rules), two_word_parser (no text input),
drive_code_upload_and_job_queue (KERNAL file calls are enough for a small
file), jump_arc_table (no jumping).

Added, which the briefing did not propose: tile_map_render (its RLE row
stream is the cave format), charset_animation (gems, enemies and the open
exit animate by glyph), sid_play_routine_pattern and sfx_engine_beside_music
(tune and effects), kernal_file_read_seq, kernal_file_write_seq and
error_channel_check (the table on disk), frame_sync_loop, joystick_edge_detect.

The briefing listed 0 pitfalls; pitfalls-for on the techniques kept found
the ones in the table below.

## Techniques

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| cave_scan_engine | falling, rolling, digging, pushing, wall-following enemies, explosions; one scan per cave frame, split into four row slices, one a display frame | oscar64-cave-scan | pal_ntsc_tempo_mismatch |
| tile_map_render | caves stored as the RLE row stream (run `0x80+n`, literal count, `0` ends a row), decoded between caves | oscar64-level-rle-decoder, oscar64-tile-map-render | badline_cycle_loss, colour_ram_index_past_last_cell_hits_cia1, full_field_redraw_exceeds_vblank |
| charset_animation | gem sparkle, enemy spin and the open exit by rewriting glyph bytes in the RAM charset (method (a)) | oscar64-charset-animation | charset_blit_overruns_grown_code, vic_bank_visibility_collision, petscii_written_to_screen_ram |
| sid_play_routine_pattern | an original two-voice tune, one play call a frame | oscar64-sid-music-player | pal_ntsc_tempo_mismatch, sid_write_only_registers |
| sfx_engine_beside_music | table-driven effects with priorities on voice 3, after the tune's play call | oscar64-sfx-engine | sid_adsr_bug_8580, sid_voice3_disable_silent_bit |
| high_score_table_insert | a new score into the sorted five-row table; a tie goes below | kickassembler-high-score-insert, oscar64-high-score-persist | petscii_written_to_screen_ram |
| kernal_file_read_seq | load the table at start-up | oscar64-high-score-persist, oscar64-save-load-seq-file | first_open_after_reset_hangs_on_pal, kernal_assumes_sei_cleared, kernal_io_mapping_dependency, c1541_uppercase_filename_petscii_shift |
| kernal_file_write_seq | save it after a new entry: scratch, then write | oscar64-high-score-persist | krnio_save_leaves_splat_file, raster_irq_during_serial_io |
| error_channel_check | the drive's reply decides first run (62), loaded (00), no disk (74) | oscar64-high-score-persist | first_open_after_reset_hangs_on_pal |
| frame_sync_loop | one pass a frame, polled at raster line 250 | oscar64-frame-sync-loop, templates/hello | badline_cycle_loss, d012_wrap_around, raster_line_count_difference |
| joystick_edge_detect | fire and name entry act once per press | oscar64-headless-verify (the autopilot) | joystick2_scan_phantom_press, cia1_ddr_cleared_kills_keyboard |
| raster_profile_bars | the harness frame meter (CIA2 timer A) | oscar64-raster-profile-bars | badline_cycle_loss, vic_bus_takeover_on_dma |

## Compatibility

Command: `npx tsx src/cli.ts check-compatibility cave_scan_engine tile_map_render charset_animation sfx_engine_beside_music sid_play_routine_pattern high_score_table_insert kernal_file_write_seq kernal_file_read_seq error_channel_check frame_sync_loop joystick_edge_detect raster_profile_bars`

```text
# Compatibility: cave_scan_engine + tile_map_render + charset_animation + sfx_engine_beside_music + sid_play_routine_pattern + high_score_table_insert + kernal_file_write_seq + kernal_file_read_seq + error_channel_check + frame_sync_loop + joystick_edge_detect + raster_profile_bars

**Verdict:** WARNINGS

Checked with 1 implied prerequisite(s): sid_voice_setup.

Unit claims are stated for 3 of 12 techniques; a unit conflict cannot be ruled out for: cave_scan_engine, tile_map_render, charset_animation, high_score_table_insert, kernal_file_write_seq, kernal_file_read_seq, error_channel_check, frame_sync_loop, raster_profile_bars, sid_voice_setup (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## unit_shared (soft): sfx_engine_beside_music × sid_play_routine_pattern
**Shared:** sid_voice_2
sid_play_routine_pattern owns sid_voice_2; sfx_engine_beside_music writes it under sid_play_routine_pattern's protocol.
**Resolution:** sfx_engine_beside_music must follow sid_play_routine_pattern's protocol: write after sid_play_routine_pattern's write in the frame, or run inside sid_play_routine_pattern's interrupt chain.

## shared_register (soft): sfx_engine_beside_music × sid_play_routine_pattern
**Shared:** SIGVOL, SUREL3, ATDCY3, VCREG3, PWHI3, PWLO3, FREHI3, FRELO3, SUREL2, ATDCY2, VCREG2, PWHI2, PWLO2, FREHI2, FRELO2, SUREL1, ATDCY1, VCREG1, PWHI1, PWLO1, FREHI1, FRELO1
Both techniques touch register(s) SIGVOL, SUREL3, ATDCY3, VCREG3, PWHI3, PWLO3, FREHI3, FRELO3, SUREL2, ATDCY2, VCREG2, PWHI2, PWLO2, FREHI2, FRELO2, SUREL1, ATDCY1, VCREG1, PWHI1, PWLO1, FREHI1, FRELO1. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_kernal (soft): kernal_file_write_seq × kernal_file_read_seq
**Shared:** CLRCHN, CLOSE, OPEN, SETNAM, SETLFS
Both techniques call KERNAL routine(s) CLRCHN, CLOSE, OPEN, SETNAM, SETLFS. Concurrent use may clobber KERNAL state.

## shared_kernal (soft): kernal_file_write_seq × error_channel_check
**Shared:** CLRCHN, CLOSE, OPEN, SETNAM, SETLFS
Both techniques call KERNAL routine(s) CLRCHN, CLOSE, OPEN, SETNAM, SETLFS. Concurrent use may clobber KERNAL state.

## shared_kernal (soft): kernal_file_read_seq × error_channel_check
**Shared:** CHRIN, CLRCHN, CHKIN, CLOSE, OPEN, SETNAM, SETLFS, READST
Both techniques call KERNAL routine(s) CHRIN, CLRCHN, CHKIN, CLOSE, OPEN, SETNAM, SETLFS, READST. Concurrent use may clobber KERNAL state.

## shared_register (soft): frame_sync_loop × raster_profile_bars
**Shared:** EXTCOL
Both techniques touch register(s) EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.


## Not covered
- **cave_scan_engine**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **tile_map_render**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **high_score_table_insert**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.

## Shared Infrastructure (info)
- **sid_voice_setup** (prerequisite, not in the set): required by sfx_engine_beside_music, sid_play_routine_pattern; included in the check as implied. Set it up first.
- **CHRIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader, oscar64-high-score-persist
- **CHROUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader, oscar64-high-score-persist
- **CLRCHN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader, oscar64-high-score-persist
- **CHKOUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader, oscar64-high-score-persist
- **CHKIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader, oscar64-high-score-persist
- **SP6COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP5COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP4COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP3COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP2COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP1COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **CLOSE** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader, oscar64-high-score-persist
- **OPEN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader, oscar64-high-score-persist
- **SETNAM** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader, oscar64-high-score-persist
- **SETLFS** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader, oscar64-high-score-persist
- **SP0COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC0F** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-cave-scan
- **DC07** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-cave-scan
- **DC06** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-cave-scan
- **DC03** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **BGCOL0** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-cave-scan, oscar64-falling-blocks
- **EXTCOL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-cave-scan, oscar64-directory-reader, oscar64-falling-blocks
- **IRQMSK** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-cave-scan
- **VICIRQ** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-cave-scan
- **SPENA** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **RASTER** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-cave-scan, oscar64-directory-reader, oscar64-falling-blocks
- **SCROLY** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks
- **MSIGX** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **M0Y** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **M0X** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **RANDOM** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SIGVOL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SUREL3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **ATDCY3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VCREG3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWHI3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWLO3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FREHI3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FRELO3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SUREL2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **ATDCY2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VCREG2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWHI2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWLO2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FREHI2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FRELO2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SUREL1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **ATDCY1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VCREG1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWHI1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWLO1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FREHI1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FRELO1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC02** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC00** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-directory-reader, oscar64-falling-blocks
- **READST** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader, oscar64-high-score-persist
- **DC0E** (Register) shared via recipe(s): oscar64-cave-scan, oscar64-falling-blocks
- **DC05** (Register) shared via recipe(s): oscar64-cave-scan, oscar64-falling-blocks
- **DC04** (Register) shared via recipe(s): oscar64-cave-scan, oscar64-falling-blocks
- **DD0F** (Register) shared via recipe(s): kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader
- **DD0E** (Register) shared via recipe(s): kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader
- **DD07** (Register) shared via recipe(s): kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader
- **DD06** (Register) shared via recipe(s): kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader
- **DD05** (Register) shared via recipe(s): kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader
- **DD04** (Register) shared via recipe(s): kickassembler-file-io-roundtrip, oscar64-save-load-seq-file, oscar64-directory-reader
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

What the warnings mean for this program:

- sid_voice_2 unit and the shared SID registers (sfx x tune): the tune here
  uses voices 1 and 2 only; effects own voice 3 and run after the play call
  in the same frame, so the resolution the tool asks for holds by layout.
- Shared KERNAL routines between the three file techniques: they run one
  after another on a static screen, never at once.
- EXTCOL (frame_sync_loop x raster_profile_bars): no border bars; only the
  verdict writes `$D020`.

## Budget

Command: `npx tsx src/cli.ts plan-budget cave_scan_engine:play tile_map_render:transition charset_animation:play sfx_engine_beside_music:play sid_play_routine_pattern:play high_score_table_insert:transition kernal_file_write_seq:transition kernal_file_read_seq:init error_channel_check:transition frame_sync_loop:play joystick_edge_detect:play raster_profile_bars:play --region both --screen on`

```text
# Budget plan: undetermined

Techniques: cave_scan_engine, tile_map_render:transition, charset_animation, sfx_engine_beside_music, sid_play_routine_pattern, high_score_table_insert:transition, kernal_file_write_seq:transition, kernal_file_read_seq:init, error_channel_check:transition, frame_sync_loop, joystick_edge_detect, raster_profile_bars

## play (PAL, 19656 cycles a frame): undetermined

Range 19599-19807 + 1075 fixed cycles; floor 0; weakest basis measured-vice; IRQ slots 2.

Summed:
- cave_scan_engine: 18559 (measured-vice, on oscar64-cave-scan (one scan, run every fourth frame; slowest game-cave scan, NTSC, screen on))
- charset_animation: 196 (measured-vice, on oscar64-charset-animation (one glyph a frame, in the vertical blank))
- sfx_engine_beside_music: 50-258 (measured-vice, on oscar64-sfx-engine (a frame the engine owns the voice))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

To measure:
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-attract-replay

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because charset_animation, sfx_engine_beside_music, sid_play_routine_pattern, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: cave_scan_engine was measured with the screen on and already holds the stalls that fell inside it, so the charge is too high by that much and the over test counts 0.
- The low end, 19599 + 1075, passes the 19656-cycle frame, but it is not a floor: the figures of cave_scan_engine, charset_animation, sfx_engine_beside_music, sid_play_routine_pattern, raster_profile_bars are a common frame or a real run's worst, and those frames need not fall together. cave_scan_engine, charset_animation, sid_play_routine_pattern, raster_profile_bars have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: frame_sync_loop, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.

## play (NTSC, 17095 cycles a frame): undetermined

Range 1040-1248 + 1075 fixed cycles; floor 1075; weakest basis measured-vice; IRQ slots 2.

Summed:
- charset_animation: 196 (measured-vice, on oscar64-charset-animation (one glyph a frame, in the vertical blank))
- sfx_engine_beside_music: 50-258 (measured-vice, on oscar64-sfx-engine (a frame the engine owns the voice))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

Left out:
- cave_scan_engine: 18559 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-cave-scan)

To measure:
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-attract-replay

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because charset_animation, sfx_engine_beside_music, sid_play_routine_pattern, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Unknown is not zero: frame_sync_loop, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.
- Multi-frame: cave_scan_engine (18559) is above one NTSC frame of 17095 and not summed; spread the work over frames or budget it as its own phase.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## transition (PAL, 19656 cycles a frame): undetermined

Range 749 + 1075 fixed cycles; floor 1075; weakest basis arithmetic; IRQ slots 0.

Summed:
- tile_map_render: 268 (arithmetic, on oscar64-tile-map-render (one column edge, 11 metatiles))
- high_score_table_insert: 481 (measured-vice, on kickassembler-high-score-insert (worst insert, once a round, screen blanked))

To measure:
- kernal_file_write_seq: no **Cost:** line; measure it on kickassembler-file-io-roundtrip
- error_channel_check: no **Cost:** line; measure it on kickassembler-dos-error-codes

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because tile_map_render, high_score_table_insert are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Unknown is not zero: kernal_file_write_seq, error_channel_check have no cycles figure, so the verdict cannot be fits.
- The transition phase is judged against one frame too; a transition that takes several frames drops frames, which may be acceptable there.

## transition (NTSC, 17095 cycles a frame): undetermined

Range 749 + 1075 fixed cycles; floor 1075; weakest basis arithmetic; IRQ slots 0.

Summed:
- tile_map_render: 268 (arithmetic, on oscar64-tile-map-render (one column edge, 11 metatiles))
- high_score_table_insert: 481 (measured-vice, on kickassembler-high-score-insert (worst insert, once a round, screen blanked))

To measure:
- kernal_file_write_seq: no **Cost:** line; measure it on kickassembler-file-io-roundtrip
- error_channel_check: no **Cost:** line; measure it on kickassembler-dos-error-codes

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because tile_map_render, high_score_table_insert are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Unknown is not zero: kernal_file_write_seq, error_channel_check have no cycles figure, so the verdict cannot be fits.
- The transition phase is judged against one frame too; a transition that takes several frames drops frames, which may be acceptable there.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## init (PAL, 19656 cycles a frame): undetermined

Range 0 cycles; floor 0; weakest basis (nothing summed); IRQ slots 0.

To measure:
- kernal_file_read_seq: no **Cost:** line; measure it on kickassembler-file-io-roundtrip

Notes:
- Unknown is not zero: kernal_file_read_seq has no cycles figure, so the verdict cannot be fits.
- The init phase is judged against one frame too; an init that takes several frames drops frames, which may be acceptable there.

## init (NTSC, 17095 cycles a frame): undetermined

Range 0 cycles; floor 0; weakest basis (nothing summed); IRQ slots 0.

To measure:
- kernal_file_read_seq: no **Cost:** line; measure it on kickassembler-file-io-roundtrip

Notes:
- Unknown is not zero: kernal_file_read_seq has no cycles figure, so the verdict cannot be fits.
- The init phase is judged against one frame too; an init that takes several frames drops frames, which may be acceptable there.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

No member states a byte figure that can be summed.
- frame_sync_loop: 985 bytes left out, the whole program, not the technique

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
```

The frame meter measures the real figure once the loop runs: worst, and
typical as the median of the autopilot's play frames. Both are recorded in
README.md with the model and the command.

What is unknown, and how the meter settles it: the tool sums a whole cave
scan (18,559 cycles, the recipe's slowest scan) into one PAL play frame and
drops it on NTSC as multi-frame. This program splits each scan into four
slices of five rows, one slice a display frame, so the play frame holds a
quarter scan plus the redraw of the cells it changed, the tune, the effects
and the glyph animation. The meter over the autopilot's play frames gives
the real worst and typical on both models. The RLE decode (the recipe's C
decoder: 28,193 to 50,447 cycles a room) is a transition on a static
screen; it is timed once with CIA1 timer B and printed, not metered.

## Memory and screen

- `$0801`-`$087F` Oscar64 start-up; code and data `$0880`-`$1FFF`, then
  `$2800`-`$9FFF` for the rest (`#pragma region`, the split the
  bitmap-koala-viewer recipe uses).
- `$2000`-`$27FF` the RAM character set: the ROM set copied at start-up
  (text, digits and the meter's F, W, T keep their ROM glyphs), codes
  `$40`-`$5F` replaced by the cave's glyphs. `$D018` = `$18`.
- Screen `$0400`: row 0 the HUD, rows 1-22 the cave (cell x, y at row
  y + 1), row 23 messages, row 24 columns 0-19 the cave name; columns 20-39
  belong to the meter in AUTOPILOT builds.
- No sprites, no raster IRQ. The KERNAL IRQ is off (`SEI`) except during
  disk calls, and `SEI` again after each one.
- CIA2 timer A is the meter's; CIA1 timer B times the RLE decode once.

## Autopilot and checks

- The script is one string of moves per cave start (L U R D, `-` still),
  keyed to the game's own counter of starts and held on the synthetic
  joystick byte for the four display frames of each cave frame. Start 1
  digs, pushes a boulder, collects cave 1's quota and enters the open exit;
  starts 2 to 4 are cave 2 after each lost life, each ending under a falling
  boulder, so the restart path runs twice and all three lives are played.
  The script then enters a name; the table is saved to the shot's fresh D64
  (`SHOT_DISK := 1`), read back and compared, and shown.
- `tools/gen.py` holds the caves, packs them, and runs a Python model of
  the same rules over the same script. It writes `src/gen_caves.h` (the RLE
  streams), `src/gen_autopilot.h` (the script and the model's expected
  values) and `src/gen_notes.h` (the note tables).
- Verdict, after the table is shown, outside the meter, one letter per
  failed test: the fold chained over every cave left, score, gems, cave,
  play frames, cave starts, the table row, the decodes, the scan meeting the
  player once a cave frame, the screen against the cave at every cave end,
  dropped frames (the `$D019` raster latch), and the save's read-back.
  `$02FF` and the border. A watchdog ends a game that runs past the model's
  play frames.
- FORCE_FAULT flips a byte of the save as it is read back: the verdict turns
  red and the table shows READ BACK BAD. `make selftest-scan` builds with
  SCAN_FLAG=0 and must fail with E.
- expect.json: verdict, the HUD text, the table box text, cave cells the
  model places, the `same` area over the cave, the meter with the recorded
  frame count.
- A separate `make disktest` proves the save with true drive emulation: the
  autopilot build writes the table to a fresh D64, then saves again over
  it; a cold VICE boots the release PRG from that D64, which loads the
  table and shows it.

## Decisions and open questions

- One cave frame every four display frames on both models, so the game is
  the same on PAL and NTSC and one model run serves both; NTSC plays 20 %
  faster in real time (pal_ntsc_tempo_mismatch). The time counter ticks every
  12 cave frames. The tune's note lengths are in frames, so it plays 20 %
  faster on NTSC too; the note frequencies come from a PAL or NTSC table.
- The meter records at most 255 frames; the script is kept to fit (240).
- Measured (make shot check, 2026-09-23): worst 13,619 / typical 6,529
  cycles on PAL, 13,832 / 6,786 on NTSC; the worst is the slice where 16
  boulders fall and overflow the dirty list. About 440 cycles a moving
  object, so about 20 a slice fit NTSC. The overflow queues rows, redrawn
  two a frame. A first build passed the cell
  pointer to `cell()`; Oscar64 then computed it for every cell before the
  test and the scan loop took 42 cycles a cell (typical frame 11,812).
  Passing row and column made it 17 (counted from the generated code).
- Settled: first_open_after_reset_hangs_on_pal. `DISK_WAIT` waits 50 frames
  before the first OPEN (main.c). `make disktest` ran on PAL and NTSC with a
  true-drive 1541: the start-up read, two saves (the second replacing the
  file) and a cold boot that loads it, all without a hang. It is a phase
  effect, so any change to the code before the first OPEN needs that test again.
