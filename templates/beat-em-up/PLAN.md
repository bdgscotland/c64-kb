# Plan: beat-em-up

The side-on brawler starter for c64-kb issue #39. The tool output below was
produced on 2026-09-23 by c64-kb 0.15.0 and pasted whole.

## Concept

A side-on street brawler: a street 256 characters long scrolls to the right
through a 38-column window in three stages, and each stage locks the camera
until its waves of enemies are beaten. The player and up to three enemies
are two multicolour sprites each and walk on a depth plane; the nearest
fighter is drawn in front. Punch, kick and a jump kick land only on the
animation frames that carry a hit box and only on a fighter in the same
lane. Enemies approach, line up in the lane, attack and back off; a kick or
a third punch knocks a fighter down and he gets up again. Health bars and
faces in a HUD, a two-voice tune with hit effects on the third. Title, fire
to start, game over back to the title. PAL and NTSC.

## Briefing

Command: `npx tsx src/cli.ts game-briefing "A side-on street brawler in the Double Dragon style: the street scrolls horizontally in stages that lock until the wave of enemies is cleared; fighters are several sprites each and move in depth lanes, sorted by Y for priority; punch, kick and jump attack with per-frame hitboxes; enemies approach, align in the lane, attack and retreat; knockdown and recovery; health bars in a HUD; a SID tune with hit effects. PAL and NTSC." --archetype beat-em-up`

Kept from its 16 proposals: lane_depth_engine, multi_sprite_object,
lane_pursuit_ai (the state names: approach, alongside, attack, back off),
wave_director (waves start at a scroll position), soft_scroll_h,
sid_play_routine_pattern. Its sprite_multiplex_24 becomes
sprite_multiplex_game (the KB's game multiplexer: double-buffered tables
written by IRQs, $D010 precalculated); mob_priority is not needed (every
sprite is in front of the street).

Dropped: `vector_balls_sprites` and `dypp_sprite_sine_scroller` (the word
"scrolls" matched demo effects), `char_scroll_buffer_h` (one buffer shifted
in place: visible while it runs, issue #18; the platformer's three pages
replace it), `self_modifying_code` and `zero_page_burst` (not needed as
named; the IRQ patches its pointer page once a frame), `stable_raster_irq`
(no split here needs a stable cycle), `sprite_collision_detect` (hits are
software boxes gated by depth, which $D01E cannot see).

Added, not proposed: screen_double_buffer_d018, tile_map_render,
raster_split_modes (the HUD needs its own $D016 and $D018),
per_frame_hitbox, sprite_animation_table, jump_arc_table, object_pool,
sfx_engine_beside_music, frame_sync_loop, joystick_edge_detect,
decimal_print, raster_profile_bars (the meter).

Pitfalls the briefing and `pitfalls-for` name that this program meets:
sprite_dma_overflow (a reused sprite needs its last use finished: the
multiplexer reuses a sprite only across bands 5 or more lines apart),
sprite_x_high_bit_wrong_register and sprite_x_range_hidden_and_seam (world
X is 16 bits; a part outside the window is switched off),
xscroll_applies_to_all_rows and d016_unmasked_rmw_clobbers_csel_mcm (the
HUD split writes whole values), vic_bank_visibility_collision (bank 3 has
no ROM font: glyphs are copied), full_field_redraw_exceeds_vblank (the
scroll prepares a hidden page in slices), decimal_mode_in_irq_handler (the
IRQs do no arithmetic that depends on D), pal_ntsc_tempo_mismatch (one step
a frame: 6/5 as fast on NTSC), signed_compare_bmi_overflow (distances are
computed as ints), vic_colour_register_upper_nibble_reads_set (the verdict
masks colour reads with 15).

## Techniques

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| tile_map_render | 2 x 2 metatiles from the street text; one new column per coarse step | oscar64-tile-map-render | full_field_redraw_exceeds_vblank, colour_ram_index_past_last_cell_hits_cia1 |
| soft_scroll_h | XSCROLL for the pixel; the column step is a page flip | the platformer starter's view.c | xscroll_applies_to_all_rows, d016_unmasked_rmw_clobbers_csel_mcm |
| screen_double_buffer_d018 | three pages: one shown, one behind, one prepared five rows a frame | the platformer starter's view.c | full_field_redraw_exceeds_vblank, vic_bank_visibility_collision |
| raster_split_modes | the HUD under the street gets 40 columns, hires and its own page at line 212 | the platformer starter's engine.asm | xscroll_applies_to_all_rows, raster_irq_first_line_jitter, idle_fetch_byte_shows_in_gaps |
| lane_depth_engine | plane Y is depth: sorted every frame, nearest fighter in the lowest sprites, hits gated by a 6-line window | oscar64-beat-em-up-lanes | sprite_x_high_bit_wrong_register, sprite_x_range_hidden_and_seam |
| multi_sprite_object | a fighter is two parts at per-pose offsets from his feet | oscar64-multi-sprite-object | sprite_registers_persist_across_state_change, sprite_x_range_hidden_and_seam |
| sprite_multiplex_game | three bands a frame (sign, fighters, HUD faces) from double-buffered tables the IRQs write | kickassembler-sprite-multiplex-game | sprite_dma_overflow, decimal_mode_in_irq_handler, d012_wrap_around |
| per_frame_hitbox | an attack frame carries a hit box; every pose a hurt box | oscar64-per-frame-hitbox | sprite_x_high_bit_wrong_register |
| sprite_animation_table | fighter moves as (pose, frames, box) tables | oscar64-sprite-animation-table | vic_bank_visibility_collision |
| jump_arc_table | the jump and the knock-down flight from one height table | oscar64-fixed-point-jump-velocity | pal_ntsc_tempo_mismatch |
| lane_pursuit_ai | enemy states: approach, line up, attack, back off, wait for a turn | oscar64-lane-pursuit | signed_compare_bmi_overflow, pal_ntsc_tempo_mismatch |
| wave_director | each stage's waves start when the camera reaches the stage's lock | oscar64-wave-director | sprite_x_high_bit_wrong_register |
| object_pool | three enemy slots | oscar64-object-pool | sprite_x_range_hidden_and_seam |
| sid_play_routine_pattern | an original two-voice tune, init and play in KickAssembler | the platformer starter's engine.asm | pal_ntsc_tempo_mismatch, sid_write_only_registers |
| sfx_engine_beside_music | punch, hit, knock-down, jump on voice 3, which the tune leaves alone | oscar64-sfx-engine | sid_adsr_bug_8580, sid_write_only_registers |
| frame_sync_loop | one pass a frame, started by the IRQ at line 251 | oscar64-frame-sync-loop | d012_wrap_around, badline_cycle_loss |
| joystick_edge_detect | an attack starts on the fire press | oscar64-joystick-input | joystick2_scan_phantom_press, cia1_ddr_cleared_kills_keyboard |
| decimal_print | six score digits added digit by digit | oscar64-print-number | petscii_written_to_screen_ram |
| raster_profile_bars | the harness meter, CIA2 timer A; the IRQs time themselves on timer B | oscar64-raster-profile-bars | badline_cycle_loss, vic_bus_takeover_on_dma |

## Compatibility

Command: `npx tsx src/cli.ts check-compatibility tile_map_render soft_scroll_h screen_double_buffer_d018 raster_split_modes lane_depth_engine multi_sprite_object sprite_multiplex_game per_frame_hitbox sprite_animation_table jump_arc_table lane_pursuit_ai wave_director object_pool sid_play_routine_pattern sfx_engine_beside_music frame_sync_loop joystick_edge_detect decimal_print raster_profile_bars`

```text
# Compatibility: tile_map_render + soft_scroll_h + screen_double_buffer_d018 + raster_split_modes + lane_depth_engine + multi_sprite_object + sprite_multiplex_game + per_frame_hitbox + sprite_animation_table + jump_arc_table + lane_pursuit_ai + wave_director + object_pool + sid_play_routine_pattern + sfx_engine_beside_music + frame_sync_loop + joystick_edge_detect + decimal_print + raster_profile_bars

**Verdict:** INCOMPATIBLE — not as combined; each hard conflict below says how to separate them.

Checked with 4 implied prerequisite(s): fixed_point_8_8, screen_ram_relocation, sid_voice_setup, tile_grid_collision.

Unit claims are stated for 6 of 19 techniques; a unit conflict cannot be ruled out for: tile_map_render, soft_scroll_h, screen_double_buffer_d018, lane_depth_engine, multi_sprite_object, per_frame_hitbox, sprite_animation_table, jump_arc_table, wave_director, object_pool, frame_sync_loop, decimal_print, raster_profile_bars, fixed_point_8_8 (prerequisite), screen_ram_relocation (prerequisite), sid_voice_setup (prerequisite), tile_grid_collision (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## shared_register (soft): soft_scroll_h × raster_split_modes
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_double_buffer_d018 × raster_split_modes
**Shared:** VMCSB, SCROLY
Both techniques touch register(s) VMCSB, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_double_buffer_d018 × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): raster_split_modes × sprite_multiplex_game
**Shared:** vic_raster_irq
Both raster_split_modes and sprite_multiplex_game own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## shared_register (soft): raster_split_modes × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): lane_depth_engine × multi_sprite_object
**Shared:** SP0COL, MSIGX, M0Y, M0X
Both techniques touch register(s) SP0COL, MSIGX, M0Y, M0X. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): lane_depth_engine × sprite_multiplex_game
**Shared:** SP0COL, MSIGX, M0Y, M0X
Both techniques touch register(s) SP0COL, MSIGX, M0Y, M0X. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): lane_depth_engine × per_frame_hitbox
**Shared:** MSIGX
Both techniques touch register(s) MSIGX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): multi_sprite_object × sprite_multiplex_game
**Shared:** SP0COL, SPENA, MSIGX, M0Y, M0X
Both techniques touch register(s) SP0COL, SPENA, MSIGX, M0Y, M0X. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): multi_sprite_object × per_frame_hitbox
**Shared:** MSIGX
Both techniques touch register(s) MSIGX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_multiplex_game × per_frame_hitbox
**Shared:** MSIGX
Both techniques touch register(s) MSIGX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_multiplex_game × frame_sync_loop
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

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
- **sprite_animation_table**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **jump_arc_table**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **wave_director**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **object_pool**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **decimal_print**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **fixed_point_8_8** (prerequisite of jump_arc_table, lane_pursuit_ai): the graph has no registers, KERNAL routines or demands for it.
- **tile_grid_collision** (prerequisite of lane_pursuit_ai): the graph has no registers, KERNAL routines or demands for it.

## Shared Infrastructure (info)
- **fixed_point_8_8** (prerequisite, not in the set): required by jump_arc_table, lane_pursuit_ai; included in the check as implied. Set it up first.
- **screen_ram_relocation** (prerequisite, not in the set): required by screen_double_buffer_d018; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sfx_engine_beside_music, sid_play_routine_pattern; included in the check as implied. Set it up first.
- **tile_grid_collision** (prerequisite, not in the set): required by lane_pursuit_ai; included in the check as implied. Set it up first.
- **SP6COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **CHRIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHROUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CLRCHN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKOUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CLOSE** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **OPEN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETNAM** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETLFS** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **DC0F** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-eight-way-scroll, oscar64-flip-screen-rooms
- **DC07** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-eight-way-scroll, oscar64-flip-screen-rooms
- **DC06** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-eight-way-scroll, oscar64-flip-screen-rooms
- **DC03** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP5COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP4COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP3COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP2COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP1COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP0COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-wave-director, oscar64-flip-screen-rooms
- **BGCOL0** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks, kickassembler-eight-way-scroll, oscar64-wave-director, kickassembler-cracktro-template, oscar64-flip-screen-rooms
- **EXTCOL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks, kickassembler-eight-way-scroll, oscar64-wave-director, kickassembler-cracktro-template, oscar64-flip-screen-rooms
- **IRQMSK** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-eight-way-scroll, kickassembler-cracktro-template
- **VICIRQ** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-eight-way-scroll, kickassembler-cracktro-template
- **SPENA** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-wave-director, oscar64-flip-screen-rooms
- **RASTER** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks, kickassembler-eight-way-scroll, oscar64-wave-director, kickassembler-cracktro-template, oscar64-flip-screen-rooms
- **SCROLY** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks, kickassembler-eight-way-scroll, oscar64-wave-director, kickassembler-cracktro-template, oscar64-flip-screen-rooms
- **MSIGX** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-wave-director, oscar64-flip-screen-rooms
- **M0Y** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-wave-director, oscar64-flip-screen-rooms
- **M0X** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-wave-director, oscar64-flip-screen-rooms
- **RANDOM** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC02** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC00** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks, kickassembler-cracktro-template, oscar64-flip-screen-rooms
- **SIGVOL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-cracktro-template
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
- **DC0E** (Register) shared via recipe(s): oscar64-falling-blocks, oscar64-wave-director, oscar64-flip-screen-rooms
- **DC05** (Register) shared via recipe(s): oscar64-falling-blocks, oscar64-wave-director, oscar64-flip-screen-rooms
- **DC04** (Register) shared via recipe(s): oscar64-falling-blocks, oscar64-wave-director, oscar64-flip-screen-rooms
- **DD0D** (Register) shared via recipe(s): kickassembler-eight-way-scroll
- **DC0D** (Register) shared via recipe(s): kickassembler-eight-way-scroll, kickassembler-cracktro-template
- **VMCSB** (Register) shared via recipe(s): kickassembler-eight-way-scroll, kickassembler-cracktro-template
- **SCROLX** (Register) shared via recipe(s): kickassembler-eight-way-scroll, kickassembler-cracktro-template
- **XXPAND** (Register) shared via recipe(s): oscar64-flip-screen-rooms
- **SPMC** (Register) shared via recipe(s): oscar64-flip-screen-rooms
- **YXPAND** (Register) shared via recipe(s): oscar64-flip-screen-rooms
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

What the warnings mean for this program:

- The hard conflict, raster_split_modes x sprite_multiplex_game over
  vic_raster_irq: its resolution is followed. One chain in engine.asm owns
  $D012: line 251 (playfield registers, the sign band), line 76 (the fighter
  band), line 212 (the HUD split and the face band). Each handler sets the
  next. Adding irq_chain_table to the set to say so makes the verdict worse
  (it reports irq_chain_table against both as new hard conflicts), so it is
  not in the set.
- SCROLX, VMCSB, SCROLY shared by the scroll, the split and the frame loop:
  $D016 and $D018 are written only by the IRQs at 251 and 212, from a pair C
  publishes once a frame. $D011 is written once at start.
- The sprite registers shared by lane_depth_engine, multi_sprite_object,
  sprite_multiplex_game and per_frame_hitbox: only the IRQs write them. C
  builds the band tables; the depth sort decides which parts go to which
  sprite.
- sid_voice_2 shared by the tune and the effects: the tune plays voices 1
  and 2; the effects own voice 3. The tool's "sid_voice_2" is its own label,
  not this program's split.
- EXTCOL: only the start and the verdict write $D020.

## Budget

Command: `npx tsx src/cli.ts plan-budget tile_map_render soft_scroll_h screen_double_buffer_d018 raster_split_modes lane_depth_engine multi_sprite_object sprite_multiplex_game per_frame_hitbox sprite_animation_table jump_arc_table lane_pursuit_ai wave_director object_pool sid_play_routine_pattern sfx_engine_beside_music frame_sync_loop joystick_edge_detect decimal_print raster_profile_bars --region both --sprites 8 --sprite-lines 42`

```text
# Budget plan: undetermined

Techniques: tile_map_render, soft_scroll_h, screen_double_buffer_d018, raster_split_modes, lane_depth_engine, multi_sprite_object, sprite_multiplex_game, per_frame_hitbox, sprite_animation_table, jump_arc_table, lane_pursuit_ai, wave_director, object_pool, sid_play_routine_pattern, sfx_engine_beside_music, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars

## play (PAL, 19656 cycles a frame): undetermined

Range 36919-43868 + 1873 fixed cycles; floor 0; weakest basis arithmetic; IRQ slots 19.

Summed:
- tile_map_render: 268 (arithmetic, on oscar64-tile-map-render (one column edge, 11 metatiles))
- lane_depth_engine: 1413 (measured-vice, on oscar64-beat-em-up-lanes (four actors: sort, priority draw and hit test in one step, screen on))
- multi_sprite_object: 1342 (measured-vice, on oscar64-multi-sprite-object (worst frame, six parts, in the vertical blank))
- sprite_multiplex_game: 16600 (arithmetic, on kickassembler-sprite-multiplex-game (worst frame: a reversed sort))
- per_frame_hitbox: 3693 (measured-vice, on oscar64-per-frame-hitbox (eight boxes, 28 pairs))
- sprite_animation_table: 357-747 (measured-vice, on oscar64-sprite-animation-table (six actors, the scenario's worst frame))
- lane_pursuit_ai: 9871-14204 (measured-vice, on oscar64-lane-pursuit (worst frame: the spawn table's two same-frame spawns, then four cars on the ram path, one in contact, each with an eight-probe swept span and both room scans, screen blanked; typical: worst frame of the 780-step run, screen blanked))
- wave_director: 1170-3188 (measured-vice, on oscar64-wave-director (worst frame, screen blanked))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- sfx_engine_beside_music: 50-258 (measured-vice, on oscar64-sfx-engine (a frame the engine owns the voice))
- decimal_print: 1361 (measured-vice, on oscar64-print-number (one call, worst decimal case))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

Left out:
- object_pool: not added, inside wave_director's figure (Cost includes)
- soft_scroll_h: 74041 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-soft-scroll-h)

To measure:
- screen_double_buffer_d018: no **Cost:** line; measure it on kickassembler-eight-way-scroll
- raster_split_modes: no **Cost:** line; no recipe yet
- jump_arc_table: no **Cost:** line; measure it on oscar64-fixed-point-jump
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-attract-replay

Notes:
- Fixed losses 1873 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 798; arithmetic) charged because tile_map_render, multi_sprite_object, sprite_multiplex_game, per_frame_hitbox, sprite_animation_table, lane_pursuit_ai, wave_director, sid_play_routine_pattern, sfx_engine_beside_music, decimal_print, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: lane_depth_engine was measured with the screen on and already holds the stalls that fell inside it, so the charge is too high by that much and the over test counts 0.
- The low end, 36919 + 1873, passes the 19656-cycle frame, but it is not a floor: the figures of tile_map_render, lane_depth_engine, multi_sprite_object, sprite_multiplex_game, per_frame_hitbox, sprite_animation_table, lane_pursuit_ai, wave_director, sid_play_routine_pattern, sfx_engine_beside_music, decimal_print, raster_profile_bars are a common frame or a real run's worst, and those frames need not fall together. tile_map_render, lane_depth_engine, multi_sprite_object, sprite_multiplex_game, per_frame_hitbox, sid_play_routine_pattern, decimal_print, raster_profile_bars have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: screen_double_buffer_d018, raster_split_modes, jump_arc_table, frame_sync_loop, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.
- Multi-frame: soft_scroll_h (74041) is above one PAL frame of 19656 and not summed; spread the work over frames or budget it as its own phase.

## play (NTSC, 17095 cycles a frame): undetermined

Range 36919-43868 + 1873 fixed cycles; floor 0; weakest basis arithmetic; IRQ slots 19.

Summed:
- tile_map_render: 268 (arithmetic, on oscar64-tile-map-render (one column edge, 11 metatiles))
- lane_depth_engine: 1413 (measured-vice, on oscar64-beat-em-up-lanes (four actors: sort, priority draw and hit test in one step, screen on))
- multi_sprite_object: 1342 (measured-vice, on oscar64-multi-sprite-object (worst frame, six parts, in the vertical blank))
- sprite_multiplex_game: 16600 (arithmetic, on kickassembler-sprite-multiplex-game (worst frame: a reversed sort))
- per_frame_hitbox: 3693 (measured-vice, on oscar64-per-frame-hitbox (eight boxes, 28 pairs))
- sprite_animation_table: 357-747 (measured-vice, on oscar64-sprite-animation-table (six actors, the scenario's worst frame))
- lane_pursuit_ai: 9871-14204 (measured-vice, on oscar64-lane-pursuit (worst frame: the spawn table's two same-frame spawns, then four cars on the ram path, one in contact, each with an eight-probe swept span and both room scans, screen blanked; typical: worst frame of the 780-step run, screen blanked))
- wave_director: 1170-3188 (measured-vice, on oscar64-wave-director (worst frame, screen blanked))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- sfx_engine_beside_music: 50-258 (measured-vice, on oscar64-sfx-engine (a frame the engine owns the voice))
- decimal_print: 1361 (measured-vice, on oscar64-print-number (one call, worst decimal case))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

Left out:
- object_pool: not added, inside wave_director's figure (Cost includes)
- soft_scroll_h: 74041 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-soft-scroll-h)

To measure:
- screen_double_buffer_d018: no **Cost:** line; measure it on kickassembler-eight-way-scroll
- raster_split_modes: no **Cost:** line; no recipe yet
- jump_arc_table: no **Cost:** line; measure it on oscar64-fixed-point-jump
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-attract-replay

Notes:
- Fixed losses 1873 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 798; arithmetic) charged because tile_map_render, multi_sprite_object, sprite_multiplex_game, per_frame_hitbox, sprite_animation_table, lane_pursuit_ai, wave_director, sid_play_routine_pattern, sfx_engine_beside_music, decimal_print, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: lane_depth_engine was measured with the screen on and already holds the stalls that fell inside it, so the charge is too high by that much and the over test counts 0.
- The low end, 36919 + 1873, passes the 17095-cycle frame, but it is not a floor: the figures of tile_map_render, lane_depth_engine, multi_sprite_object, sprite_multiplex_game, per_frame_hitbox, sprite_animation_table, lane_pursuit_ai, wave_director, sid_play_routine_pattern, sfx_engine_beside_music, decimal_print, raster_profile_bars are a common frame or a real run's worst, and those frames need not fall together. tile_map_render, lane_depth_engine, multi_sprite_object, sprite_multiplex_game, per_frame_hitbox, sid_play_routine_pattern, decimal_print, raster_profile_bars have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: screen_double_buffer_d018, raster_split_modes, jump_arc_table, frame_sync_loop, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.
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
- Sprites: 8 a line on 42 lines, (3 + 2 × 8) × 42 = 798 cycles of DMA a frame (3 + 2n measured in VICE x64sc for sprites numbered without gaps).
```

The budget's range, 36,919 to 43,868 plus 1,873 fixed, is two frames. Most
of it is other programs' worst cases: sprite_multiplex_game's 16,600 is a
reversed sort of 24 actors (here: four fighters, and the bands need no
sort across them), lane_pursuit_ai's 9,871 to 14,204 is four cars probing a
tile map (here: three enemies comparing distances), per_frame_hitbox's
3,693 is 28 pairs (here: at most 3 attacker-target pairs a frame). The
scroll and the split have no figure. The meter measures the whole frame,
the IRQs included; README.md, "The measured frame", compares the two.

## Memory and screen

VIC bank 3 ($DD00 bits 0-1 = 0). $C000, $C400 and $C800: the three street
pages (rows 0-19; row 20 blank); $CC00: the HUD page (rows 21-24);
$E000-$E7FF: the character set (the ROM's glyphs 0-63 copied in, so text
and the meter decode; street glyphs from 64); $F000-$FFBF: 63 sprite
blocks (192-254). BASIC and KERNAL are banked out ($01 = $35), so $FFFE
and $FFFA point at the IRQ chain and an RTI. Code from $1000; the
KickAssembler blob (scroll slice copy, the IRQ chain and band writers, the
tune) at $0900. Colour RAM is never scrolled. In AUTOPILOT builds the
meter owns HUD row 24, columns 20 to 39; CIA2 timer A is the meter's, and
CIA2 timer B times the IRQs that land outside the meter's brackets.

Sprites: three bands a frame. Band 0 (from line 251): the GO sign, lines
53-73. Band 1 (IRQ at line 76): the fighters, two parts each, at most
eight parts, tops no higher than line 91. Band 2 (IRQ at line 212): two
faces in the HUD, lines 219-239. Within a band no sprite is reused, so a
band never drops a part; the multiplexer reuses all eight sprites between
bands.

## Autopilot and checks

A bot, not a timeline: in AUTOPILOT builds the joystick byte is computed
from the game state each frame (fire on the title; in play, line up with
the nearest enemy, close in, then punch, punch, kick, with a jump kick
now and then; walk right when a stage is clear). For a stretch of stage 2
it stands still and takes blows, so a life is lost and the respawn runs.
At three crowded moments (four fighters within 24 lines of depth) it
holds the game still for 64 frames and prints the fighter band's table on
the HUD, so `tools/flickercheck.py` can render the eight parts and match
the picture pixel for pixel.

The verdict, after stage 3's first wave: every event seen (punch, kick,
jump kick hits, knock-downs, get-ups, KOs, a life lost, three stage
locks, two unlocks), score equal to the sum of the hits and KOs counted,
the band IRQ never late, no part ever dropped, the pages equal to the
street at their columns, the fighter sprite registers against the model.
expect.json checks the border, the HUD text, the health-bar cells, the
player's two parts where the model leaves them, the scrolled street at
the final camera, the blank row 20, PAL and NTSC alike, and the meter.

## Decisions and open questions

- Two parts a fighter, four fighters: eight sprites in the fighter band,
  so no reuse inside it and nothing to drop. A third part per fighter (a
  fist or a foot sprite) was the first idea; with four fighters on one
  line it needs 12 sprites on those lines, which no multiplexer can give,
  so reach is drawn inside the 24-pixel parts instead.
- Sprite priority follows the depth sort, not the raster order: the
  nearest fighter's parts are sprites 0 and 1.
- The scroll is the platformer's three-page scheme, the camera only
  moving right.
- NTSC runs the same per-frame steps at 60 Hz: 6/5 as fast. Not corrected.
- No disk persistence: the high score lives until power-off.
- Oscar64: the local build named in c64-kb's CLAUDE.md.
