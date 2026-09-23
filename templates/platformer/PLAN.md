# Plan: platformer

The side-scrolling platformer starter for c64-kb issue #39. The tool output
below was produced on 2026-09-23 by c64-kb 0.14.0 (KB data 760) and pasted
whole.

## Concept

A side-scrolling platformer. A tile-mapped level 256 characters wide scrolls
horizontally through a 38-column window as the player runs. The player runs
and jumps with 8.8 fixed-point physics and lands on flat ground, 45-degree and
1-in-2 slopes, blocks and one-way ledges. Enemies placed in the level wake as
they enter an activation window around the view. Coins raise the score; the
player has three lives; a HUD sits under the playfield; a SID tune plays.
Title, fire to start, game over back to the title. PAL and NTSC.

## Briefing

Command: `npx tsx src/cli.ts game-briefing "A side-scrolling platformer: a tile-mapped level wider than the screen scrolls horizontally as the player runs; the player runs and jumps with fixed-point physics and lands on slopes and platforms; enemies wake as they enter an activation window around the screen; pickups raise the score; lives and a HUD; SID music. PAL and NTSC." --archetype platformer`

Kept from its 15 proposals: actor_activation_window, sid_play_routine_pattern,
tile_map_render, slope_collision, fixed_point_8_8. Its `sfx_in_player`
becomes sfx_engine_beside_music: the effects are C, on a voice the tune
leaves free.

Dropped: `char_scroll_buffer_h` (one screen buffer shifted in place: the
shift is visible while it runs, issue #18), replaced by soft_scroll_h plus
screen_double_buffer_d018. `goattracker_player_api` (the tune and its player
are original). `mixed_sprite_char_actors`, `multi_sprite_object`,
`charset_parallax`, `sprite_collision_detect` (not the archetype's core; the
hit test is software boxes). `drive_code_upload_and_job_queue` (nothing loads
after start) and `bfs_distance_map` (no path-finding enemy).
`text_window_and_menu` (the title is three HUD lines).

Added, not proposed: screen_double_buffer_d018, soft_scroll_h,
raster_split_modes (the HUD needs its own $D016), jump_arc_table,
object_pool, per_frame_hitbox, sprite_animation_table, frame_sync_loop,
joystick_edge_detect, decimal_print, raster_profile_bars (the meter).

The briefing named no pitfalls. `pitfalls-for` on the kept techniques names
the ones this program meets: full_field_redraw_exceeds_vblank (the coarse
shift goes to the hidden page), xscroll_applies_to_all_rows (the HUD split),
d016_unmasked_rmw_clobbers_csel_mcm (every $D016 write is a whole value),
sprite_x_range_hidden_and_seam and sprite_x_high_bit_wrong_register (world X
is 16-bit; a sprite outside the window is switched off),
pal_ntsc_tempo_mismatch (one step a frame: the game runs 6/5 as fast on
NTSC), vic_bank_visibility_collision (bank 3 has no ROM font, so the text
glyphs are copied to RAM).

## Techniques

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| tile_map_render | 2x2 metatiles from the level text; one new column per coarse step | oscar64-tile-map-render | full_field_redraw_exceeds_vblank, colour_ram_index_past_last_cell_hits_cia1 |
| soft_scroll_h | XSCROLL for the pixel, a one-column shift for the character | oscar64-soft-scroll-h (its fine step only; issue #18) | xscroll_applies_to_all_rows, d016_unmasked_rmw_clobbers_csel_mcm |
| screen_double_buffer_d018 | three pages: the next is prepared off screen; the flip and XSCROLL land together in the blank | kickassembler-eight-way-scroll | full_field_redraw_exceeds_vblank, vic_bank_visibility_collision, d012_wrap_around |
| raster_split_modes | the HUD under the playfield gets its own $D016 and $D018 at line 212 | kickassembler-eight-way-scroll (its IRQ chain) | xscroll_applies_to_all_rows, raster_irq_first_line_jitter |
| slope_collision | ground snap on slopes, walls, one-way ledges | oscar64-slope-collision | signed_compare_bmi_overflow |
| fixed_point_8_8 | 8.8 Y, sub-pixel X speed | oscar64-fixed-point-jump-velocity | signed_compare_bmi_overflow |
| jump_arc_table | one velocity table for jump, fall and bounce | oscar64-fixed-point-jump-velocity | pal_ntsc_tempo_mismatch |
| actor_activation_window | enemies wake near the view and go back to the level table when they leave | oscar64-actor-activation-window | sprite_x_high_bit_wrong_register |
| object_pool | six live enemy slots, one sprite each | oscar64-object-pool | sprite_x_range_hidden_and_seam |
| per_frame_hitbox | each animation frame carries its box; a squashed enemy has none | oscar64-per-frame-hitbox | sprite_x_high_bit_wrong_register, sprite_x_range_hidden_and_seam |
| sprite_animation_table | run, jump, walk, hop and squash from tables | oscar64-sprite-animation-table | vic_bank_visibility_collision |
| sid_play_routine_pattern | an original two-voice tune, init and play in KickAssembler | oscar64-sid-music-player | pal_ntsc_tempo_mismatch, sid_write_only_registers |
| sfx_engine_beside_music | jump, coin, stomp and hurt effects on voice 3, which the tune leaves alone | oscar64-sid-music-player | sid_adsr_bug_8580, sid_write_only_registers |
| frame_sync_loop | one pass a frame, started by the IRQ at line 251 | oscar64-frame-sync-loop | d012_wrap_around, raster_line_count_difference, badline_cycle_loss |
| joystick_edge_detect | fire starts a jump on the press, not while held | oscar64-joystick-input | joystick2_scan_phantom_press, cia1_ddr_cleared_kills_keyboard |
| decimal_print | the score is six decimal digits, added digit by digit; no division | oscar64-print-number | petscii_written_to_screen_ram |
| raster_profile_bars | the harness meter, CIA2 timer A | oscar64-raster-profile-bars | badline_cycle_loss, vic_bus_takeover_on_dma |

## Compatibility

Command: `npx tsx src/cli.ts check-compatibility tile_map_render soft_scroll_h screen_double_buffer_d018 raster_split_modes slope_collision fixed_point_8_8 jump_arc_table actor_activation_window object_pool per_frame_hitbox sprite_animation_table sid_play_routine_pattern sfx_engine_beside_music frame_sync_loop joystick_edge_detect decimal_print raster_profile_bars`

```text
# Compatibility: tile_map_render + soft_scroll_h + screen_double_buffer_d018 + raster_split_modes + slope_collision + fixed_point_8_8 + jump_arc_table + actor_activation_window + object_pool + per_frame_hitbox + sprite_animation_table + sid_play_routine_pattern + sfx_engine_beside_music + frame_sync_loop + joystick_edge_detect + decimal_print + raster_profile_bars

**Verdict:** WARNINGS

Checked with 3 implied prerequisite(s): screen_ram_relocation, sid_voice_setup, tile_grid_collision.

Unit claims are stated for 4 of 17 techniques; a unit conflict cannot be ruled out for: tile_map_render, soft_scroll_h, screen_double_buffer_d018, slope_collision, fixed_point_8_8, jump_arc_table, actor_activation_window, object_pool, per_frame_hitbox, sprite_animation_table, frame_sync_loop, decimal_print, raster_profile_bars, screen_ram_relocation (prerequisite), sid_voice_setup (prerequisite), tile_grid_collision (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## shared_register (soft): soft_scroll_h × raster_split_modes
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_double_buffer_d018 × raster_split_modes
**Shared:** VMCSB, SCROLY
Both techniques touch register(s) VMCSB, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_double_buffer_d018 × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_split_modes × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): sid_play_routine_pattern × sfx_engine_beside_music
**Shared:** sid_voice_2
sid_play_routine_pattern owns sid_voice_2; sfx_engine_beside_music writes it under sid_play_routine_pattern's protocol.
**Resolution:** sfx_engine_beside_music must follow sid_play_routine_pattern's protocol: write after sid_play_routine_pattern's write in the frame, or run inside sid_play_routine_pattern's interrupt chain.

## shared_register (soft): sid_play_routine_pattern × sfx_engine_beside_music
**Shared:** SIGVOL, SUREL3, ATDCY3, VCREG3, PWHI3, PWLO3, FREHI3, FRELO3, SUREL2, ATDCY2, VCREG2, PWHI2, PWLO2, FREHI2, FRELO2, SUREL1, ATDCY1, VCREG1, PWHI1, PWLO1, FREHI1, FRELO1
Both techniques touch register(s) SIGVOL, SUREL3, ATDCY3, VCREG3, PWHI3, PWLO3, FREHI3, FRELO3, SUREL2, ATDCY2, VCREG2, PWHI2, PWLO2, FREHI2, FRELO2, SUREL1, ATDCY1, VCREG1, PWHI1, PWLO1, FREHI1, FRELO1. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): frame_sync_loop × raster_profile_bars
**Shared:** EXTCOL
Both techniques touch register(s) EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.


## Not covered
- **tile_map_render**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **slope_collision**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **fixed_point_8_8**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **jump_arc_table**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **actor_activation_window**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **object_pool**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **sprite_animation_table**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **decimal_print**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **tile_grid_collision** (prerequisite of slope_collision): the graph has no registers, KERNAL routines or demands for it.

## Shared Infrastructure (info)
- **screen_ram_relocation** (prerequisite, not in the set): required by screen_double_buffer_d018; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sfx_engine_beside_music, sid_play_routine_pattern; included in the check as implied. Set it up first.
- **tile_grid_collision** (prerequisite, not in the set): required by slope_collision; included in the check as implied. Set it up first.
- **DC0D** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-eight-way-scroll
- **DC00** (Register) shared via recipe(s): kickassembler-cracktro-template, oscar64-platformer-scaffold, oscar64-flip-screen-rooms
- **BGCOL0** (Register) shared via recipe(s): kickassembler-cracktro-template, oscar64-platformer-scaffold, oscar64-flip-screen-rooms, oscar64-fixed-point-jump, oscar64-fixed-point-jump-velocity, kickassembler-eight-way-scroll, oscar64-actor-activation-window
- **EXTCOL** (Register) shared via recipe(s): kickassembler-cracktro-template, oscar64-platformer-scaffold, oscar64-flip-screen-rooms, oscar64-fixed-point-jump, oscar64-fixed-point-jump-velocity, kickassembler-eight-way-scroll, oscar64-actor-activation-window
- **IRQMSK** (Register) shared via recipe(s): kickassembler-cracktro-template, oscar64-platformer-scaffold, kickassembler-eight-way-scroll
- **VICIRQ** (Register) shared via recipe(s): kickassembler-cracktro-template, oscar64-platformer-scaffold, kickassembler-eight-way-scroll
- **VMCSB** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-eight-way-scroll
- **SCROLX** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-eight-way-scroll
- **RASTER** (Register) shared via recipe(s): kickassembler-cracktro-template, oscar64-platformer-scaffold, oscar64-flip-screen-rooms, kickassembler-eight-way-scroll
- **SCROLY** (Register) shared via recipe(s): kickassembler-cracktro-template, oscar64-platformer-scaffold, oscar64-flip-screen-rooms, kickassembler-eight-way-scroll, oscar64-actor-activation-window
- **SIGVOL** (Register) shared via recipe(s): kickassembler-cracktro-template, oscar64-platformer-scaffold
- **CLRCHN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKOUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CLOSE** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **OPEN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETNAM** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETLFS** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **DC0F** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-flip-screen-rooms, kickassembler-eight-way-scroll
- **DC07** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-flip-screen-rooms, kickassembler-eight-way-scroll
- **DC06** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-flip-screen-rooms, kickassembler-eight-way-scroll
- **DC03** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC02** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP6COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP5COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP4COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP3COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP2COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP1COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-fixed-point-jump-velocity
- **SP0COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-flip-screen-rooms, oscar64-fixed-point-jump, oscar64-fixed-point-jump-velocity, oscar64-actor-activation-window
- **SPENA** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-flip-screen-rooms, oscar64-fixed-point-jump, oscar64-fixed-point-jump-velocity, oscar64-actor-activation-window
- **MSIGX** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-flip-screen-rooms, oscar64-fixed-point-jump, oscar64-fixed-point-jump-velocity, oscar64-actor-activation-window
- **M0Y** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-flip-screen-rooms, oscar64-fixed-point-jump, oscar64-fixed-point-jump-velocity, oscar64-actor-activation-window
- **M0X** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-flip-screen-rooms, oscar64-fixed-point-jump, oscar64-fixed-point-jump-velocity, oscar64-actor-activation-window
- **RANDOM** (Register) shared via recipe(s): oscar64-platformer-scaffold
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
- **READST** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHRIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHROUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **DC0E** (Register) shared via recipe(s): oscar64-flip-screen-rooms, oscar64-actor-activation-window
- **DC05** (Register) shared via recipe(s): oscar64-flip-screen-rooms, oscar64-actor-activation-window
- **DC04** (Register) shared via recipe(s): oscar64-flip-screen-rooms, oscar64-actor-activation-window
- **XXPAND** (Register) shared via recipe(s): oscar64-flip-screen-rooms, oscar64-fixed-point-jump, oscar64-fixed-point-jump-velocity
- **SPMC** (Register) shared via recipe(s): oscar64-flip-screen-rooms, oscar64-fixed-point-jump, oscar64-fixed-point-jump-velocity
- **YXPAND** (Register) shared via recipe(s): oscar64-flip-screen-rooms, oscar64-fixed-point-jump, oscar64-fixed-point-jump-velocity
- **M1Y** (Register) shared via recipe(s): oscar64-fixed-point-jump-velocity
- **M1X** (Register) shared via recipe(s): oscar64-fixed-point-jump-velocity
- **DD0D** (Register) shared via recipe(s): kickassembler-eight-way-scroll
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

What the warnings mean for this program:

- SCROLX shared by soft_scroll_h and raster_split_modes: one IRQ writes the
  playfield's $D016 at line 251, the other the HUD's at line 212. Each owns
  its region.
- VMCSB and SCROLY shared by screen_double_buffer_d018, raster_split_modes
  and frame_sync_loop: $D018 is written at line 251 (the flip) and at 212
  (the HUD page), both by the IRQs; $D011 once at start.
- sid_voice_2 shared by the tune and the effects: the tune plays voices 1
  and 2 only; the effects own voice 3. No voice is shared.
- The SID register list: the same split, voice 3 to the effects.
- EXTCOL shared by frame_sync_loop and raster_profile_bars: only the start
  and the verdict write $D020.

## Budget

Command: `npx tsx src/cli.ts plan-budget tile_map_render soft_scroll_h screen_double_buffer_d018 raster_split_modes slope_collision fixed_point_8_8 jump_arc_table actor_activation_window object_pool per_frame_hitbox sprite_animation_table sid_play_routine_pattern sfx_engine_beside_music frame_sync_loop joystick_edge_detect decimal_print raster_profile_bars --region both --sprites 7 --sprite-lines 21`

```text
# Budget plan: undetermined

Techniques: tile_map_render, soft_scroll_h, screen_double_buffer_d018, raster_split_modes, slope_collision, fixed_point_8_8, jump_arc_table, actor_activation_window, object_pool, per_frame_hitbox, sprite_animation_table, sid_play_routine_pattern, sfx_engine_beside_music, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars

## play (PAL, 19656 cycles a frame): undetermined

Range 10167-10765 + 1432 fixed cycles; floor 1432; weakest basis arithmetic; IRQ slots 2.

Summed:
- tile_map_render: 268 (arithmetic, on oscar64-tile-map-render (one column edge, 11 metatiles))
- slope_collision: 455 (measured-vice, on oscar64-slope-collision (worst frame, one actor, in the vertical blank))
- actor_activation_window: 2809 (measured-vice, on oscar64-actor-activation-window (worst tick, screen blanked))
- object_pool: 380 (measured-vice, on oscar64-object-pool (eight live slots, screen blanked))
- per_frame_hitbox: 3693 (measured-vice, on oscar64-per-frame-hitbox (eight boxes, 28 pairs))
- sprite_animation_table: 357-747 (measured-vice, on oscar64-sprite-animation-table (six actors, the scenario's worst frame))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- sfx_engine_beside_music: 50-258 (measured-vice, on oscar64-sfx-engine (a frame the engine owns the voice))
- decimal_print: 1361 (measured-vice, on oscar64-print-number (one call, worst decimal case))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

Left out:
- soft_scroll_h: 74041 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-soft-scroll-h)

To measure:
- screen_double_buffer_d018: no **Cost:** line; measure it on kickassembler-eight-way-scroll
- raster_split_modes: no **Cost:** line; no recipe yet
- fixed_point_8_8: no **Cost:** line; measure it on oscar64-fixed-point-jump
- jump_arc_table: no **Cost:** line; measure it on oscar64-fixed-point-jump
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-attract-replay

Notes:
- Fixed losses 1432 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 357; arithmetic) charged because tile_map_render, slope_collision, actor_activation_window, object_pool, per_frame_hitbox, sprite_animation_table, sid_play_routine_pattern, sfx_engine_beside_music, decimal_print, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Unknown is not zero: screen_double_buffer_d018, raster_split_modes, fixed_point_8_8, jump_arc_table, frame_sync_loop, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.
- Multi-frame: soft_scroll_h (74041) is above one PAL frame of 19656 and not summed; spread the work over frames or budget it as its own phase.

## play (NTSC, 17095 cycles a frame): undetermined

Range 10167-10765 + 1432 fixed cycles; floor 1432; weakest basis arithmetic; IRQ slots 2.

Summed:
- tile_map_render: 268 (arithmetic, on oscar64-tile-map-render (one column edge, 11 metatiles))
- slope_collision: 455 (measured-vice, on oscar64-slope-collision (worst frame, one actor, in the vertical blank))
- actor_activation_window: 2809 (measured-vice, on oscar64-actor-activation-window (worst tick, screen blanked))
- object_pool: 380 (measured-vice, on oscar64-object-pool (eight live slots, screen blanked))
- per_frame_hitbox: 3693 (measured-vice, on oscar64-per-frame-hitbox (eight boxes, 28 pairs))
- sprite_animation_table: 357-747 (measured-vice, on oscar64-sprite-animation-table (six actors, the scenario's worst frame))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- sfx_engine_beside_music: 50-258 (measured-vice, on oscar64-sfx-engine (a frame the engine owns the voice))
- decimal_print: 1361 (measured-vice, on oscar64-print-number (one call, worst decimal case))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

Left out:
- soft_scroll_h: 74041 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-soft-scroll-h)

To measure:
- screen_double_buffer_d018: no **Cost:** line; measure it on kickassembler-eight-way-scroll
- raster_split_modes: no **Cost:** line; no recipe yet
- fixed_point_8_8: no **Cost:** line; measure it on oscar64-fixed-point-jump
- jump_arc_table: no **Cost:** line; measure it on oscar64-fixed-point-jump
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-attract-replay

Notes:
- Fixed losses 1432 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 357; arithmetic) charged because tile_map_render, slope_collision, actor_activation_window, object_pool, per_frame_hitbox, sprite_animation_table, sid_play_routine_pattern, sfx_engine_beside_music, decimal_print, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Unknown is not zero: screen_double_buffer_d018, raster_split_modes, fixed_point_8_8, jump_arc_table, frame_sync_loop, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.
- Multi-frame: soft_scroll_h (74041) is above one NTSC frame of 17095 and not summed; spread the work over frames or budget it as its own phase.
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
- Sprites: 7 a line on 21 lines, (3 + 2 × 7) × 21 = 357 cycles of DMA a frame (3 + 2n measured in VICE x64sc for sprites numbered without gaps).
```

The frame meter measures the real figure once the loop runs: worst, and
typical as the median of the autopilot's play frames. The figures and the
comparison with this budget are in README.md, "The measured frame".

Unknown in the budget: the coarse shift. plan-budget leaves soft_scroll_h
out at 74,041 cycles, the old recipe's in-place C shift (issue #18). The
first plan here was a KickAssembler copy of all 20 rows into the hidden
page at a crossing, near 7,500 cycles by arithmetic; the meter measured
9,457 for that frame's camera work (`PROF=3`) and 18,112 for the whole
worst frame, too close to NTSC's 17,095. So the scroll became three pages
with the next one prepared five rows a frame (README.md, "How a frame
runs"). The six techniques with no figure are settled the same way: the
meter brackets the whole frame.

## Memory and screen

VIC bank 3 ($DD00 bits 0-1 = 0). $C000, $C400 and $E800: the three
playfield pages; $C800: the HUD page; $CC00-$CFFF: sixteen sprite blocks
(48-63); $E000-$E7FF: the character set (ROM glyphs 0-63 copied, so text
and the meter decode; tiles from 64). BASIC and KERNAL are banked out ($01
= $35), so $FFFE and $FFFA point at the IRQs and an RTI. Code from $1000;
the KickAssembler blob (scroll slice copy, the two IRQs, tune player) at
$0900. Colour RAM is never scrolled: playfield rows hold $0D (multicolour,
green), so the four playfield colours are $D021, $D022, $D023 and green.
In AUTOPILOT builds the meter owns HUD row 24, columns 20 to 39; CIA2
timer A belongs to the meter.

## Autopilot and checks

A timeline of joystick bytes from frame 1: fire on the title, then run right
over slopes, a jump over a gap, coins, a stomp, a hit from an enemy, the
respawn, more running. After the script the program grades itself: score
against coins and stomps counted, lives, events seen, every playfield cell
of the page on display against the level at the camera, and the activation
window's invariants. $02FF and the border report it. expect.json checks the
border, the HUD text, the player sprite where the model leaves it, the
scrolled playfield's cells, and the meter. A separate check
(`make tearcheck`) shoots the run at many cycle counts and matches each
playfield against a model render of the level.

## Decisions and open questions

- Two raster IRQs own $D016 and $D018: line 212 for the HUD, line 251 for
  the playfield pair C publishes. The first build set the playfield pair
  from the main loop at a polled line 251; `make tearcheck` then caught
  blank pictures, because a frame whose work ran past 251 left the HUD
  page and hires mode on for the whole next frame. With the IRQ at 251 the
  main loop waits for its tick instead: polling $D012 for 251 missed the
  line the IRQ spends, on PAL every frame (measured: the run never left
  camera 0).
- Three pages, the next prepared in slices: see Budget.
- NTSC runs the same per-frame steps at 60 Hz: the game is 6/5 as fast and
  the tune 6/5 as quick. Not corrected.
- No disk persistence: the high score lives until power-off.
- Oscar64: the local build. Upstream 9a902f6 miscompiles surface_walk
  (README.md, "Which Oscar64"). One loop clearing four pages miscompiles on
  both (issue #30 fault 7); view_init uses one memset per page.
