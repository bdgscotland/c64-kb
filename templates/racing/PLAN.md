# Plan: racing

The pseudo-3D road racer starter, rebuilt for c64-kb issue #110: an original
racer with the feel of a 16-bit sprint racer at C64 fidelity. Fast, smooth,
hard to finish. Nothing from any commercial game ships: no name, track,
graphic, tune or code. The tool output below was produced on 2026-09-26 by
this checkout of c64-kb (KB data 843) and pasted whole.

## Concept

A road that recedes to a horizon, bends and climbs over crests, with edges
that move on every raster line, red and white rumble strips and road bands
alternating by segment. Roadside objects scaled by distance, gears or a rev
curve, a top speed that feels fast. Checkpoints with a countdown, a field of
more than three opponents reused down the road, crashes into roadside
objects that cost time, two stages with their own scenery and colours, the
second harder. A title, an original tune, sound effects, a finish screen.
PAL and NTSC. Oscar64 C with a KickAssembler engine.

Built in four steps, each playable and green before the next, each signed
off by the maintainer:

1. Road: per-line edges, rumble strips and bands, curves and hills kept.
2. Speed: scaled roadside objects, gears or a rev curve, top speed.
3. Challenge: checkpoints and countdown, more than three opponents,
   crashes cost time, two stages.
4. Polish: title, tune, effects, finish screen.

## Briefing

Command: `node src/cli.ts game-briefing "original pseudo-3D road racer with the feel of a 16-bit sprint racer at C64 fidelity: fast smooth road whose edges move per raster line, rumble strips and road bands alternating by segment, curves and hills, roadside objects scaled by distance, gears or rev curve, checkpoints with a countdown, more than three opponents multiplexed, crashes cost time, two stages with own scenery and colours, title, music, sound effects" --archetype racing`

It proposed 17 techniques; compatibility incompatible (char_row_road and
speedcode_bitmap_road both own the character base), 52 pitfalls.

Kept: pseudo_3d_road_raster (the bend, per line), stable_raster_irq and
double_irq (the road's code starts on a known cycle), raster_split_modes
(the panel), sprite_multiplex_8 (step 3: opponents and objects reused down
the road), sid_play_routine_pattern and sfx_in_player (step 4: the tune and
its effects), object_pool (roadside objects and opponents), frame_sync_loop.

Dropped: char_row_road (draws every row's edge characters per picture:
about 60,000 cycles a picture, a picture every 9.2 PAL frames on the #110
work-in-progress branch), speedcode_bitmap_road (measured this month and
lost to the character road on cost and memory; not redone),
raster_bars, sprite_expand (a Y-expanded sprite fetches on twice the lines,
which the road's pads would have to allow for; revisit in step 2),
fighter_opponent_tables, sfx_engine_beside_music (the effects go in the
player), music_during_kernal_load (nothing loads during play).

Added, not proposed: the starter's existing set (irq_chain_table,
pal_ntsc_detection, screen_double_buffer_d018, unrolled_loops,
self_modifying_code, mcm_text, vic_bank_select, charset_copy_rom_to_ram,
vehicle_control, car_contact_response, fixed_point_8_8, sid_voice_setup,
joystick_edge_detect, decimal_print, raster_profile_bars).

Pitfalls this program meets (briefing and `pitfalls-for`): badline_cycle_loss
(a badline's block stores two registers before cycle 12, the pad allows for
the rest), raster_irq_first_line_jitter (the double IRQ), sprite_dma_overflow
and vic_bus_takeover_on_dma (sprites 0-2 fetch at a line's end; sprites 3-7
stay off the road lines), d016_unmasked_rmw_clobbers_csel_mcm (whole $D016
values), charset_blit_overruns_grown_code (five road character sets in bank
3: the memory map below is the plan), irq_during_charen_window (the glyphs
are copied under I/O with interrupts off), d012_wrap_around,
pal_ntsc_tempo_mismatch, colour_ram_index_past_last_cell_hits_cia1,
vic_bank_visibility_collision.

## The road method (step 1)

The staircase in the old road came from its width stepping once per
character row; its bend was already per line (`$D016`). The new road keeps
the per-line bend and draws the width with static slanted-edge glyphs
(c64-kb `slanted_glyph_road`, written from this starter).

- The row's characters are drawn around a content centre on a 4-pixel
  boundary (phase 0 or 4 within a character); each line's XSCROLL adds
  its centre's offset from that, 0-7, and a line that needs 8 or more is a
  whole-column move: the row is "sheared" and gets glyphs built at run
  time from its static ones, in a dynamic set per copy.
- KickAssembler computes every glyph at assembly from the projection's
  own width, for the 12 even horizon offsets, 12 rows and both phases:
  321 left glyphs in three character sets (100, 115, 106; rows 0-3, 4-6,
  7-11), their mirrors at id + $80, and 1,860 bytes of row templates
  (the assembler's count). A Python model before any code (four sets for
  a 1-line horizon step, 666 glyphs over all 24 offsets) chose the 2-line
  step. Each row's badline block stores its set in `$D018` on cycle 5.
- The builder copies a decoded row template into the back screen shifted
  by whole columns; no static glyph is drawn at run time. Measured: no
  piece over 4,300 cycles; 1,158 pictures in the autopilot's 3,615-step
  race on PAL (3.04 frames a picture), 699 on NTSC (5.03).
- Colours per line: grass %00 (`$D021`), road band %01 (`$D022`), kerb
  stripes %10 (`$D023`), centre line %11 (colour RAM). Each block loads
  them from the copy's z table plus the camera's position through colour
  tables, so the bands move every frame. Stores on cycles 5, 9 and 13,
  inside the left border (PROBE build, both models).

Questions the KB had no answer for, and what was measured:

- The per-line road edge: no technique or recipe existed for static
  slanted-edge glyphs. Measured here and written up as
  `slanted_glyph_road` (docs/techniques/effects-vector-3d.md).
- Which cycles of a line hide a colour store in 40-column mode: the
  PROBE build puts a store on cycle 19 at screenshot x 49, so stores on
  cycles 5-13 are in the border, on both models.
- A block ending in a write is a cycle off with sprite 2 on the line; the
  double IRQ's first handler needs a margin over the main loop's longest
  interrupt-off window (measured, pitfalls on the technique page).

## Techniques

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| pseudo_3d_road_raster | the bend: $D016 per line; the bands: $D021, $D022, $D023 per line | kickassembler-pseudo-3d-road; kickassembler-road-sprite-lines | badline_cycle_loss, raster_irq_first_line_jitter, d016_unmasked_rmw_clobbers_csel_mcm, charset_blit_overruns_grown_code |
| stable_raster_irq | the first road block on cycle 2 of line 107 | kickassembler-stable-raster-irq | raster_irq_first_line_jitter, decimal_mode_in_irq_handler |
| double_irq | IRQ at 103 into a NOP slide, the second at 105, two $D012 reads | kickassembler-stable-raster-irq | branch_page_cross_extra_cycle, irq_during_charen_window |
| irq_chain_table | one chain: 251, 103, 105 (the road), 203 (the panel) | kickassembler-irq-chain | d012_wrap_around, irq_row_armed_after_beam_passed |
| pal_ntsc_detection | the last line's number decides the pads and the sync | kickassembler-pseudo-3d-road (detect_region) | raster_line_count_difference |
| raster_split_modes | $D018 per road row (its character set); line 203 to the panel | the starter's engine.asm | xscroll_applies_to_all_rows, fpp_write_outside_window |
| screen_double_buffer_d018 | two road screens and two code copies: the builder writes the ones not shown | the platformer starter's view.c | full_field_redraw_exceeds_vblank |
| unrolled_loops | 96 blocks of 64 bytes a copy, one a road line | kickassembler-pseudo-3d-road | branch_page_cross_extra_cycle |
| self_modifying_code | each block's loads, store address and branch operand patched per picture | kickassembler-dysp | branch_page_cross_extra_cycle |
| mcm_text | grass, road, kerb and centre line as multicolour pairs | kickassembler-mcm-text | ecm_with_mcm_set_is_invalid_black_mode |
| vic_bank_select | bank 3: screens, sprites, five road sets and the font | the starter's engine.asm | vic_bank_visibility_collision |
| charset_copy_rom_to_ram | the ROM font at $E800 for the panel; the road glyphs copied under I/O | kickassembler-charset-copy-rom-to-ram | vic_bank_visibility_collision, irq_during_charen_window |
| vehicle_control | throttle, brake, steering that needs speed, the grass, a bend's push | oscar64-vehicle-control | signed_compare_bmi_overflow |
| car_contact_response | contact with opponents | oscar64-car-contact | signed_compare_bmi_overflow |
| fixed_point_8_8 | speeds in 8.8, the road's centre in 10.6 | oscar64-vehicle-control | signed_compare_bmi_overflow |
| sid_voice_setup | the engine note and effects until step 4's player | kickassembler-music-player | sid_adsr_bug_8580, sid_write_only_registers |
| frame_sync_loop | one game step a tick of line 251; the builder in between | oscar64-frame-sync-loop | d012_wrap_around, badline_cycle_loss |
| joystick_edge_detect | fire starts the race on the press | oscar64-attract-replay | joystick2_scan_phantom_press |
| decimal_print | clock, countdown and speed on the panel | oscar64-print-number | petscii_written_to_screen_ram |
| raster_profile_bars | the harness meter, CIA2 timer A; IRQs on timer B | oscar64-raster-profile-bars | badline_cycle_loss, vic_bus_takeover_on_dma |
| sprite_multiplex_8 | step 3: opponents and objects reused down the road | oscar64-sprite-multiplex-8 | sprite_dma_overflow, irq_table_rebuilt_per_frame_loses_close_entries |
| sid_play_routine_pattern | step 4: an original tune | kickassembler-music-player | sid_adsr_bug_8580 |
| sfx_in_player | step 4: effects through the player | kickassembler-sfx-in-player | sid_write_only_registers |
| object_pool | roadside objects and opponents | oscar64-object-pool | sprite_dma_overflow |

## Compatibility

Command: `node src/cli.ts check-compatibility` with the 24 techniques of the table.

# Compatibility: pseudo_3d_road_raster + stable_raster_irq + double_irq + irq_chain_table + pal_ntsc_detection + raster_split_modes + screen_double_buffer_d018 + unrolled_loops + self_modifying_code + mcm_text + vic_bank_select + charset_copy_rom_to_ram + vehicle_control + car_contact_response + fixed_point_8_8 + sid_voice_setup + frame_sync_loop + joystick_edge_detect + decimal_print + raster_profile_bars + sprite_multiplex_8 + sid_play_routine_pattern + sfx_in_player + object_pool

**Verdict:** WARNINGS

Checked with 5 implied prerequisite(s): cpu_io_port_bank, screen_ram_relocation, soft_scroll_v, tile_grid_collision, tile_map_render.

Unit claims are stated for 18 of 24 techniques; a unit conflict cannot be ruled out for: unrolled_loops, self_modifying_code, fixed_point_8_8, decimal_print, raster_profile_bars, object_pool, cpu_io_port_bank (prerequisite), screen_ram_relocation (prerequisite), tile_grid_collision (prerequisite), tile_map_render (prerequisite). Recipes' zero-page bytes and required devices are compared as info (recipe_zero_page_overlap, recipe_device_conflict); the interrupt vector a recipe installs is not, since a combined program installs one handler either way.

## shared_register (soft): pseudo_3d_road_raster × stable_raster_irq
**Shared:** SCROLY, RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) SCROLY, RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × double_irq
**Shared:** RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × irq_chain_table
**Shared:** SCROLY, RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) SCROLY, RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × pal_ntsc_detection
**Shared:** SCROLY, RASTER
Both techniques touch register(s) SCROLY, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × raster_split_modes
**Shared:** SCROLY, SCROLX, VMCSB
Both techniques touch register(s) SCROLY, SCROLX, VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × screen_double_buffer_d018
**Shared:** SCROLY, VMCSB
Both techniques touch register(s) SCROLY, VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × mcm_text
**Shared:** SCROLX, VMCSB, BGCOL0, BGCOL1, BGCOL2
Both techniques touch register(s) SCROLX, VMCSB, BGCOL0, BGCOL1, BGCOL2. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × charset_copy_rom_to_ram
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × frame_sync_loop
**Shared:** SCROLY, RASTER
Both techniques touch register(s) SCROLY, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × sprite_multiplex_8
**Shared:** RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × double_irq
**Shared:** vic_raster_irq
stable_raster_irq and double_irq both run on the one raster compare, as entries in a handler chain someone else owns.
**Resolution:** Put both in one interrupt chain, in the order its owner sets. With no raster effect in the set, the program's own chain is that owner.

## shared_register (soft): stable_raster_irq × double_irq
**Shared:** RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × irq_chain_table
**Shared:** vic_raster_irq
irq_chain_table owns the raster compare; stable_raster_irq runs inside irq_chain_table's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of irq_chain_table's handler or as one more entry in irq_chain_table's chain, not as a second interrupt setup.

## shared_register (soft): stable_raster_irq × irq_chain_table
**Shared:** SCROLY, RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) SCROLY, RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): stable_raster_irq × pal_ntsc_detection
**Shared:** SCROLY, RASTER
Both techniques touch register(s) SCROLY, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × raster_split_modes
**Shared:** vic_raster_irq
raster_split_modes owns the raster compare; stable_raster_irq runs inside raster_split_modes's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of raster_split_modes's handler or as one more entry in raster_split_modes's chain, not as a second interrupt setup.

## shared_register (soft): stable_raster_irq × raster_split_modes
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): stable_raster_irq × screen_double_buffer_d018
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × frame_sync_loop
**Shared:** vic_raster_irq
stable_raster_irq and frame_sync_loop both run on the one raster compare, as entries in a handler chain someone else owns.
**Resolution:** Put both in one interrupt chain, in the order its owner sets. With no raster effect in the set, the program's own chain is that owner.

## shared_register (soft): stable_raster_irq × frame_sync_loop
**Shared:** SCROLY, RASTER
Both techniques touch register(s) SCROLY, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × sprite_multiplex_8
**Shared:** vic_raster_irq
sprite_multiplex_8 owns the raster compare; stable_raster_irq runs inside sprite_multiplex_8's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of sprite_multiplex_8's handler or as one more entry in sprite_multiplex_8's chain, not as a second interrupt setup.

## shared_register (soft): stable_raster_irq × sprite_multiplex_8
**Shared:** RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): double_irq × irq_chain_table
**Shared:** vic_raster_irq
irq_chain_table owns the raster compare; double_irq runs inside irq_chain_table's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run double_irq as the entry of irq_chain_table's handler or as one more entry in irq_chain_table's chain, not as a second interrupt setup.

## shared_register (soft): double_irq × irq_chain_table
**Shared:** RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): double_irq × pal_ntsc_detection
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): double_irq × raster_split_modes
**Shared:** vic_raster_irq
raster_split_modes owns the raster compare; double_irq runs inside raster_split_modes's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run double_irq as the entry of raster_split_modes's handler or as one more entry in raster_split_modes's chain, not as a second interrupt setup.

## unit_shared (soft): double_irq × frame_sync_loop
**Shared:** vic_raster_irq
double_irq and frame_sync_loop both run on the one raster compare, as entries in a handler chain someone else owns.
**Resolution:** Put both in one interrupt chain, in the order its owner sets. With no raster effect in the set, the program's own chain is that owner.

## shared_register (soft): double_irq × frame_sync_loop
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): double_irq × sprite_multiplex_8
**Shared:** vic_raster_irq
sprite_multiplex_8 owns the raster compare; double_irq runs inside sprite_multiplex_8's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run double_irq as the entry of sprite_multiplex_8's handler or as one more entry in sprite_multiplex_8's chain, not as a second interrupt setup.

## shared_register (soft): double_irq × sprite_multiplex_8
**Shared:** RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): irq_chain_table × pal_ntsc_detection
**Shared:** SCROLY, RASTER
Both techniques touch register(s) SCROLY, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (soft): irq_chain_table × raster_split_modes
**Shared:** vic_raster_irq
Both irq_chain_table and raster_split_modes own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** irq_chain_table is the host: rewrite raster_split_modes's raster handler(s) as entries in irq_chain_table's table, so the table alone programs $D012 and raster_split_modes runs inside it.

## shared_register (soft): irq_chain_table × raster_split_modes
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): irq_chain_table × screen_double_buffer_d018
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): irq_chain_table × frame_sync_loop
**Shared:** vic_raster_irq
irq_chain_table owns the raster compare; frame_sync_loop runs inside irq_chain_table's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run frame_sync_loop as the entry of irq_chain_table's handler or as one more entry in irq_chain_table's chain, not as a second interrupt setup.

## shared_register (soft): irq_chain_table × frame_sync_loop
**Shared:** SCROLY, RASTER, EXTCOL
Both techniques touch register(s) SCROLY, RASTER, EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): irq_chain_table × raster_profile_bars
**Shared:** EXTCOL
Both techniques touch register(s) EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (soft): irq_chain_table × sprite_multiplex_8
**Shared:** vic_raster_irq
Both irq_chain_table and sprite_multiplex_8 own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** irq_chain_table is the host: rewrite sprite_multiplex_8's raster handler(s) as entries in irq_chain_table's table, so the table alone programs $D012 and sprite_multiplex_8 runs inside it.

## shared_register (soft): irq_chain_table × sprite_multiplex_8
**Shared:** RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pal_ntsc_detection × raster_split_modes
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pal_ntsc_detection × screen_double_buffer_d018
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pal_ntsc_detection × frame_sync_loop
**Shared:** SCROLY, RASTER
Both techniques touch register(s) SCROLY, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pal_ntsc_detection × sprite_multiplex_8
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_split_modes × screen_double_buffer_d018
**Shared:** SCROLY, VMCSB
Both techniques touch register(s) SCROLY, VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_split_modes × mcm_text
**Shared:** SCROLX, VMCSB
Both techniques touch register(s) SCROLX, VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_split_modes × charset_copy_rom_to_ram
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): raster_split_modes × frame_sync_loop
**Shared:** vic_raster_irq
raster_split_modes owns the raster compare; frame_sync_loop runs inside raster_split_modes's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run frame_sync_loop as the entry of raster_split_modes's handler or as one more entry in raster_split_modes's chain, not as a second interrupt setup.

## shared_register (soft): raster_split_modes × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (soft): raster_split_modes × sprite_multiplex_8
**Shared:** vic_raster_irq
Both raster_split_modes and sprite_multiplex_8 own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** irq_chain_table is in the set: rewrite both raster handlers as entries in its table, so the table alone programs $D012.

## shared_register (soft): screen_double_buffer_d018 × mcm_text
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_double_buffer_d018 × charset_copy_rom_to_ram
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_double_buffer_d018 × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): mcm_text × charset_copy_rom_to_ram
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sid_voice_setup × sid_play_routine_pattern
**Shared:** FRELO1, FREHI1, PWLO1, PWHI1, VCREG1, ATDCY1, SUREL1, FRELO2, FREHI2, PWLO2, PWHI2, VCREG2, ATDCY2, SUREL2, FRELO3, FREHI3, PWLO3, PWHI3, VCREG3, ATDCY3, SUREL3
Both techniques touch register(s) FRELO1, FREHI1, PWLO1, PWHI1, VCREG1, ATDCY1, SUREL1, FRELO2, FREHI2, PWLO2, PWHI2, VCREG2, ATDCY2, SUREL2, FRELO3, FREHI3, PWLO3, PWHI3, VCREG3, ATDCY3, SUREL3. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sid_voice_setup × sfx_in_player
**Shared:** FRELO1, FREHI1, PWLO1, PWHI1, VCREG1, ATDCY1, SUREL1, FRELO2, FREHI2, PWLO2, PWHI2, VCREG2, ATDCY2, SUREL2, FRELO3, FREHI3, PWLO3, PWHI3, VCREG3, ATDCY3, SUREL3
Both techniques touch register(s) FRELO1, FREHI1, PWLO1, PWHI1, VCREG1, ATDCY1, SUREL1, FRELO2, FREHI2, PWLO2, PWHI2, VCREG2, ATDCY2, SUREL2, FRELO3, FREHI3, PWLO3, PWHI3, VCREG3, ATDCY3, SUREL3. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): frame_sync_loop × raster_profile_bars
**Shared:** EXTCOL
Both techniques touch register(s) EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): frame_sync_loop × sprite_multiplex_8
**Shared:** vic_raster_irq
sprite_multiplex_8 owns the raster compare; frame_sync_loop runs inside sprite_multiplex_8's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run frame_sync_loop as the entry of sprite_multiplex_8's handler or as one more entry in sprite_multiplex_8's chain, not as a second interrupt setup.

## shared_register (soft): frame_sync_loop × sprite_multiplex_8
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sid_play_routine_pattern × sfx_in_player
**Shared:** FRELO1, FREHI1, PWLO1, PWHI1, VCREG1, ATDCY1, SUREL1, FRELO2, FREHI2, PWLO2, PWHI2, VCREG2, ATDCY2, SUREL2, FRELO3, FREHI3, PWLO3, PWHI3, VCREG3, ATDCY3, SUREL3, CUTLO, CUTHI, RESON, SIGVOL
Both techniques touch register(s) FRELO1, FREHI1, PWLO1, PWHI1, VCREG1, ATDCY1, SUREL1, FRELO2, FREHI2, PWLO2, PWHI2, VCREG2, ATDCY2, SUREL2, FRELO3, FREHI3, PWLO3, PWHI3, VCREG3, ATDCY3, SUREL3, CUTLO, CUTHI, RESON, SIGVOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## recipe_zero_page_overlap (info): pseudo_3d_road_raster × stable_raster_irq
**Shared:** $10-$1E
Recipes that build them own the same zero-page bytes: kickassembler-pseudo-3d-road and kickassembler-tech-tech ($10-$1E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pseudo_3d_road_raster × pal_ntsc_detection
**Shared:** $10-$1E
Recipes that build them own the same zero-page bytes: kickassembler-pseudo-3d-road and kickassembler-tech-tech ($10-$1E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pseudo_3d_road_raster × mcm_text
**Shared:** $10-$18
Recipes that build them own the same zero-page bytes: kickassembler-pseudo-3d-road and kickassembler-glenz ($10-$14); kickassembler-pseudo-3d-road and kickassembler-rotozoomer ($10-$18). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pseudo_3d_road_raster × vic_bank_select
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-road-sprite-lines and kickassembler-fli-music-scroller ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pseudo_3d_road_raster × charset_copy_rom_to_ram
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-road-sprite-lines and kickassembler-charset-copy-rom-to-ram ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pseudo_3d_road_raster × sid_play_routine_pattern
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-road-sprite-lines and kickassembler-cracktro-template ($FB-$FE); kickassembler-road-sprite-lines and kickassembler-fli-music-scroller ($FB-$FE); kickassembler-road-sprite-lines and kickassembler-one-part-demo ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pseudo_3d_road_raster × sfx_in_player
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-road-sprite-lines and kickassembler-sfx-in-player ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): stable_raster_irq × irq_chain_table
**Shared:** $20-$22, $24-$61
Recipes that build them own the same zero-page bytes: kickassembler-tech-tech and kickassembler-eight-way-scroll ($20-$22, $24-$61). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): stable_raster_irq × pal_ntsc_detection
**Shared:** $02-$04
Recipes that build them own the same zero-page bytes: kickassembler-fld and kickassembler-kefrens-bars ($02-$04). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): stable_raster_irq × screen_double_buffer_d018
**Shared:** $20-$22, $24-$61
Recipes that build them own the same zero-page bytes: kickassembler-tech-tech and kickassembler-eight-way-scroll ($20-$22, $24-$61). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): stable_raster_irq × mcm_text
**Shared:** $02-$18
Recipes that build them own the same zero-page bytes: kickassembler-agsp and kickassembler-glenz ($02-$08); kickassembler-agsp and kickassembler-rotozoomer ($02-$08); kickassembler-char-zoomer and kickassembler-glenz ($02-$06); kickassembler-char-zoomer and kickassembler-rotozoomer ($02-$06), and 18 more pair(s). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): stable_raster_irq × charset_copy_rom_to_ram
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-fli-music-scroller and kickassembler-charset-copy-rom-to-ram ($FB-$FE); kickassembler-ifli-image and kickassembler-charset-copy-rom-to-ram ($FB-$FD); kickassembler-one-part-demo and kickassembler-charset-copy-rom-to-ram ($FB-$FE); kickassembler-road-sprite-lines and kickassembler-charset-copy-rom-to-ram ($FB-$FE), and 1 more pair(s). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): stable_raster_irq × sid_play_routine_pattern
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-ifli-image and kickassembler-cracktro-template ($FB-$FD); kickassembler-road-sprite-lines and kickassembler-cracktro-template ($FB-$FE); kickassembler-tech-tech and kickassembler-cracktro-template ($FB). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): stable_raster_irq × sfx_in_player
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-fli-music-scroller and kickassembler-sfx-in-player ($FB-$FE); kickassembler-ifli-image and kickassembler-sfx-in-player ($FB-$FD); kickassembler-one-part-demo and kickassembler-sfx-in-player ($FB-$FE); kickassembler-road-sprite-lines and kickassembler-sfx-in-player ($FB-$FE), and 1 more pair(s). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): double_irq × pal_ntsc_detection
**Shared:** $02-$09, $FB
Recipes that build them own the same zero-page bytes: kickassembler-fld and kickassembler-kefrens-bars ($02-$04); kickassembler-fld and kickassembler-tech-tech ($02-$09); kickassembler-fld and kickassembler-vsp ($02-$03); kickassembler-fli-music-scroller and kickassembler-tech-tech ($FB), and 2 more pair(s). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): double_irq × mcm_text
**Shared:** $02-$0B
Recipes that build them own the same zero-page bytes: kickassembler-agsp and kickassembler-glenz ($02-$08); kickassembler-agsp and kickassembler-rotozoomer ($02-$08); kickassembler-char-zoomer and kickassembler-glenz ($02-$06); kickassembler-char-zoomer and kickassembler-rotozoomer ($02-$06), and 14 more pair(s). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): double_irq × charset_copy_rom_to_ram
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-fli-music-scroller and kickassembler-charset-copy-rom-to-ram ($FB-$FE); kickassembler-ifli-image and kickassembler-charset-copy-rom-to-ram ($FB-$FD); kickassembler-one-part-demo and kickassembler-charset-copy-rom-to-ram ($FB-$FE); kickassembler-road-sprite-lines and kickassembler-charset-copy-rom-to-ram ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): double_irq × sid_play_routine_pattern
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-ifli-image and kickassembler-cracktro-template ($FB-$FD); kickassembler-road-sprite-lines and kickassembler-cracktro-template ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): double_irq × sfx_in_player
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-fli-music-scroller and kickassembler-sfx-in-player ($FB-$FE); kickassembler-ifli-image and kickassembler-sfx-in-player ($FB-$FD); kickassembler-one-part-demo and kickassembler-sfx-in-player ($FB-$FE); kickassembler-road-sprite-lines and kickassembler-sfx-in-player ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): irq_chain_table × pal_ntsc_detection
**Shared:** $20-$22, $24-$61
Recipes that build them own the same zero-page bytes: kickassembler-eight-way-scroll and kickassembler-tech-tech ($20-$22, $24-$61). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pal_ntsc_detection × screen_double_buffer_d018
**Shared:** $20-$22, $24-$61
Recipes that build them own the same zero-page bytes: kickassembler-tech-tech and kickassembler-eight-way-scroll ($20-$22, $24-$61). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pal_ntsc_detection × mcm_text
**Shared:** $02-$18
Recipes that build them own the same zero-page bytes: kickassembler-agsp and kickassembler-glenz ($02-$08); kickassembler-agsp and kickassembler-rotozoomer ($02-$08); kickassembler-char-zoomer and kickassembler-glenz ($02-$06); kickassembler-char-zoomer and kickassembler-rotozoomer ($02-$06), and 18 more pair(s). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pal_ntsc_detection × vic_bank_select
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-road-sprite-lines and kickassembler-fli-music-scroller ($FB-$FE); kickassembler-tech-tech and kickassembler-fli-music-scroller ($FB). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pal_ntsc_detection × charset_copy_rom_to_ram
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-road-sprite-lines and kickassembler-charset-copy-rom-to-ram ($FB-$FE); kickassembler-tech-tech and kickassembler-charset-copy-rom-to-ram ($FB). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pal_ntsc_detection × sid_play_routine_pattern
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-road-sprite-lines and kickassembler-cracktro-template ($FB-$FE); kickassembler-road-sprite-lines and kickassembler-fli-music-scroller ($FB-$FE); kickassembler-road-sprite-lines and kickassembler-one-part-demo ($FB-$FE); kickassembler-tech-tech and kickassembler-cracktro-template ($FB), and 2 more pair(s). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): pal_ntsc_detection × sfx_in_player
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-road-sprite-lines and kickassembler-sfx-in-player ($FB-$FE); kickassembler-tech-tech and kickassembler-sfx-in-player ($FB). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): mcm_text × vic_bank_select
**Shared:** $03-$08
Recipes that build them own the same zero-page bytes: kickassembler-glenz and kickassembler-chunky-4x4 ($03-$08); kickassembler-glenz and kickassembler-ufli-underlay ($03-$07); kickassembler-rotozoomer and kickassembler-chunky-4x4 ($03-$08); kickassembler-rotozoomer and kickassembler-ufli-underlay ($03-$07). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): vic_bank_select × charset_copy_rom_to_ram
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-fli-music-scroller and kickassembler-charset-copy-rom-to-ram ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): vic_bank_select × sfx_in_player
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-fli-music-scroller and kickassembler-sfx-in-player ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): charset_copy_rom_to_ram × sid_play_routine_pattern
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-charset-copy-rom-to-ram and kickassembler-cracktro-template ($FB-$FE); kickassembler-charset-copy-rom-to-ram and kickassembler-fli-music-scroller ($FB-$FE); kickassembler-charset-copy-rom-to-ram and kickassembler-one-part-demo ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): charset_copy_rom_to_ram × sfx_in_player
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-charset-copy-rom-to-ram and kickassembler-sfx-in-player ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): sid_play_routine_pattern × sfx_in_player
**Shared:** $FB-$FE
Recipes that build them own the same zero-page bytes: kickassembler-cracktro-template and kickassembler-sfx-in-player ($FB-$FE); kickassembler-fli-music-scroller and kickassembler-sfx-in-player ($FB-$FE); kickassembler-one-part-demo and kickassembler-sfx-in-player ($FB-$FE). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.


## Not covered
- **unrolled_loops**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **self_modifying_code**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **fixed_point_8_8**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **decimal_print**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **object_pool**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **cpu_io_port_bank** (prerequisite of charset_copy_rom_to_ram): the graph has no registers, KERNAL routines or demands for it.
- **tile_grid_collision** (prerequisite of car_contact_response, vehicle_control): the graph has no registers, KERNAL routines or demands for it.
- **tile_map_render** (prerequisite of car_contact_response, vehicle_control): the graph has no registers, KERNAL routines or demands for it.

## Shared Infrastructure (info)
- **cpu_io_port_bank** (prerequisite, not in the set): required by charset_copy_rom_to_ram; included in the check as implied. Set it up first.
- **screen_ram_relocation** (prerequisite, not in the set): required by screen_double_buffer_d018; included in the check as implied. Set it up first.
- **soft_scroll_v** (prerequisite, not in the set): required by vehicle_control; included in the check as implied. Set it up first.
- **tile_grid_collision** (prerequisite, not in the set): required by car_contact_response, vehicle_control; included in the check as implied. Set it up first.
- **tile_map_render** (prerequisite, not in the set): required by car_contact_response, vehicle_control; included in the check as implied. Set it up first.
- **DC04** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-tech-tech, oscar64-falling-blocks, oscar64-difficulty-tables, kickassembler-dysp
- **DC05** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-tech-tech, oscar64-falling-blocks, oscar64-difficulty-tables, kickassembler-dysp
- **DC0D** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-afli-image, kickassembler-one-part-demo, kickassembler-stable-raster-irq, kickassembler-eight-way-scroll, kickassembler-fli-music-scroller, kickassembler-chunky-4x4, kickassembler-fli-image, kickassembler-char-zoomer, kickassembler-road-sprite-lines, kickassembler-line-doubling, oscar64-difficulty-tables, kickassembler-linecrunch, kickassembler-vsp, kickassembler-ufli-underlay, kickassembler-fld, kickassembler-agsp, kickassembler-ifli-image, kickassembler-fpp
- **DC0E** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-tech-tech, oscar64-falling-blocks, oscar64-difficulty-tables, kickassembler-dysp
- **DD0D** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-eight-way-scroll, kickassembler-road-sprite-lines
- **FRELO1** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, kickassembler-one-part-demo, oscar64-simple-shmup, kickassembler-fli-music-scroller, oscar64-platformer-scaffold
- **FREHI1** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **PWLO1** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **PWHI1** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **VCREG1** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **ATDCY1** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **SUREL1** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **FRELO2** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **FREHI2** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **PWLO2** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **PWHI2** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **VCREG2** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **ATDCY2** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **SUREL2** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **FRELO3** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **FREHI3** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **PWLO3** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **PWHI3** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **VCREG3** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **ATDCY3** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **SUREL3** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup, oscar64-platformer-scaffold
- **CUTLO** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup
- **CUTHI** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup
- **RESON** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, oscar64-simple-shmup
- **SIGVOL** (Register) shared via recipe(s): kickassembler-music-player, oscar64-sid-music-player, kickassembler-one-part-demo, oscar64-simple-shmup, kickassembler-fli-music-scroller, oscar64-platformer-scaffold
- **ENV3** (Register) shared via recipe(s): kickassembler-music-player
- **SCROLY** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-tech-tech, kickassembler-afli-image, kickassembler-one-part-demo, kickassembler-stable-raster-irq, oscar64-simple-shmup, oscar64-falling-blocks, oscar64-mcm-ecm-zones, kickassembler-eight-way-scroll, kickassembler-fli-music-scroller, kickassembler-chunky-4x4, kickassembler-fli-image, kickassembler-char-zoomer, kickassembler-road-sprite-lines, oscar64-vehicle-control, kickassembler-sideborder-open, kickassembler-line-doubling, oscar64-difficulty-tables, oscar64-platformer-scaffold, kickassembler-linecrunch, kickassembler-vsp, kickassembler-ufli-underlay, kickassembler-dysp, kickassembler-fld, kickassembler-agsp, kickassembler-ifli-image, kickassembler-fpp
- **RASTER** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-tech-tech, kickassembler-afli-image, kickassembler-one-part-demo, kickassembler-stable-raster-irq, oscar64-simple-shmup, oscar64-falling-blocks, oscar64-mcm-ecm-zones, kickassembler-eight-way-scroll, kickassembler-fli-music-scroller, kickassembler-chunky-4x4, kickassembler-fli-image, kickassembler-char-zoomer, kickassembler-road-sprite-lines, kickassembler-sideborder-open, kickassembler-line-doubling, oscar64-difficulty-tables, oscar64-platformer-scaffold, kickassembler-linecrunch, kickassembler-vsp, kickassembler-ufli-underlay, kickassembler-dysp, kickassembler-fld, kickassembler-agsp, kickassembler-ifli-image, kickassembler-fpp
- **VICIRQ** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-tech-tech, kickassembler-afli-image, kickassembler-one-part-demo, kickassembler-stable-raster-irq, oscar64-simple-shmup, oscar64-mcm-ecm-zones, kickassembler-eight-way-scroll, kickassembler-fli-music-scroller, kickassembler-chunky-4x4, kickassembler-fli-image, kickassembler-char-zoomer, kickassembler-road-sprite-lines, kickassembler-sideborder-open, kickassembler-line-doubling, oscar64-platformer-scaffold, kickassembler-linecrunch, kickassembler-vsp, kickassembler-ufli-underlay, kickassembler-dysp, kickassembler-fld, kickassembler-agsp, kickassembler-ifli-image, kickassembler-fpp
- **IRQMSK** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-tech-tech, kickassembler-afli-image, kickassembler-one-part-demo, kickassembler-stable-raster-irq, oscar64-simple-shmup, oscar64-mcm-ecm-zones, kickassembler-eight-way-scroll, kickassembler-fli-music-scroller, kickassembler-chunky-4x4, kickassembler-fli-image, kickassembler-char-zoomer, kickassembler-road-sprite-lines, kickassembler-sideborder-open, kickassembler-line-doubling, oscar64-platformer-scaffold, kickassembler-linecrunch, kickassembler-vsp, kickassembler-ufli-underlay, kickassembler-dysp, kickassembler-fld, kickassembler-agsp, kickassembler-ifli-image, kickassembler-fpp
- **EXTCOL** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-tech-tech, kickassembler-afli-image, kickassembler-one-part-demo, kickassembler-stable-raster-irq, oscar64-falling-blocks, oscar64-mcm-ecm-zones, kickassembler-eight-way-scroll, kickassembler-fli-music-scroller, kickassembler-chunky-4x4, kickassembler-fli-image, kickassembler-char-zoomer, kickassembler-road-sprite-lines, oscar64-vehicle-control, kickassembler-line-doubling, oscar64-difficulty-tables, oscar64-platformer-scaffold, kickassembler-linecrunch, kickassembler-vsp, kickassembler-ufli-underlay, kickassembler-agsp, kickassembler-ifli-image, kickassembler-fpp
- **BGCOL0** (Register) shared via recipe(s): kickassembler-music-player, kickassembler-tech-tech, kickassembler-afli-image, kickassembler-one-part-demo, kickassembler-stable-raster-irq, oscar64-falling-blocks, oscar64-mcm-ecm-zones, kickassembler-eight-way-scroll, kickassembler-fli-music-scroller, kickassembler-chunky-4x4, kickassembler-fli-image, kickassembler-char-zoomer, kickassembler-road-sprite-lines, oscar64-vehicle-control, kickassembler-line-doubling, oscar64-difficulty-tables, oscar64-platformer-scaffold, kickassembler-linecrunch, kickassembler-vsp, kickassembler-ufli-underlay, kickassembler-agsp, kickassembler-ifli-image, kickassembler-fpp
- **DC06** (Register) shared via recipe(s): kickassembler-tech-tech, oscar64-simple-shmup, kickassembler-eight-way-scroll, oscar64-vehicle-control, oscar64-difficulty-tables, oscar64-platformer-scaffold
- **DC07** (Register) shared via recipe(s): kickassembler-tech-tech, oscar64-simple-shmup, kickassembler-eight-way-scroll, oscar64-vehicle-control, oscar64-difficulty-tables, oscar64-platformer-scaffold
- **DC0F** (Register) shared via recipe(s): kickassembler-tech-tech, oscar64-simple-shmup, kickassembler-eight-way-scroll, oscar64-vehicle-control, oscar64-difficulty-tables, oscar64-platformer-scaffold
- **SCROLX** (Register) shared via recipe(s): kickassembler-tech-tech, kickassembler-afli-image, kickassembler-one-part-demo, oscar64-simple-shmup, oscar64-mcm-ecm-zones, kickassembler-eight-way-scroll, kickassembler-fli-music-scroller, kickassembler-chunky-4x4, kickassembler-fli-image, kickassembler-road-sprite-lines, kickassembler-sideborder-open, kickassembler-vsp, kickassembler-dysp, kickassembler-agsp, kickassembler-ifli-image
- **VMCSB** (Register) shared via recipe(s): kickassembler-tech-tech, kickassembler-afli-image, oscar64-mcm-ecm-zones, kickassembler-eight-way-scroll, kickassembler-fli-music-scroller, kickassembler-chunky-4x4, kickassembler-fli-image, kickassembler-char-zoomer, kickassembler-road-sprite-lines, oscar64-vehicle-control, kickassembler-line-doubling, kickassembler-linecrunch, kickassembler-vsp, kickassembler-ufli-underlay, kickassembler-agsp, kickassembler-ifli-image, kickassembler-fpp
- **DD00** (Register) shared via recipe(s): kickassembler-afli-image, oscar64-mcm-ecm-zones, kickassembler-fli-music-scroller, kickassembler-chunky-4x4, kickassembler-fli-image, kickassembler-char-zoomer, kickassembler-ufli-underlay, kickassembler-ifli-image, kickassembler-fpp
- **DD04** (Register) shared via recipe(s): kickassembler-one-part-demo, oscar64-simple-shmup, kickassembler-fli-music-scroller, oscar64-vehicle-control, kickassembler-fld
- **DD05** (Register) shared via recipe(s): kickassembler-one-part-demo, oscar64-simple-shmup, kickassembler-fli-music-scroller, oscar64-vehicle-control, kickassembler-fld
- **DD0E** (Register) shared via recipe(s): kickassembler-one-part-demo, oscar64-simple-shmup, kickassembler-fli-music-scroller, oscar64-vehicle-control, kickassembler-fld
- **DD0F** (Register) shared via recipe(s): kickassembler-one-part-demo, kickassembler-fli-music-scroller
- **M0X** (Register) shared via recipe(s): kickassembler-one-part-demo, oscar64-simple-shmup, kickassembler-fli-music-scroller, kickassembler-road-sprite-lines, oscar64-vehicle-control, kickassembler-sideborder-open, oscar64-platformer-scaffold, kickassembler-ufli-underlay, kickassembler-dysp
- **M0Y** (Register) shared via recipe(s): kickassembler-one-part-demo, oscar64-simple-shmup, kickassembler-fli-music-scroller, kickassembler-road-sprite-lines, oscar64-vehicle-control, kickassembler-sideborder-open, oscar64-platformer-scaffold, kickassembler-ufli-underlay, kickassembler-dysp
- **MSIGX** (Register) shared via recipe(s): kickassembler-one-part-demo, oscar64-simple-shmup, kickassembler-fli-music-scroller, kickassembler-road-sprite-lines, oscar64-vehicle-control, kickassembler-sideborder-open, oscar64-platformer-scaffold, kickassembler-ufli-underlay, kickassembler-dysp
- **SPENA** (Register) shared via recipe(s): kickassembler-one-part-demo, oscar64-simple-shmup, kickassembler-fli-music-scroller, kickassembler-road-sprite-lines, oscar64-vehicle-control, kickassembler-sideborder-open, oscar64-platformer-scaffold, kickassembler-ufli-underlay, kickassembler-dysp
- **YXPAND** (Register) shared via recipe(s): kickassembler-one-part-demo, kickassembler-fli-music-scroller, kickassembler-road-sprite-lines, kickassembler-sideborder-open, kickassembler-ufli-underlay, kickassembler-dysp
- **SPBGPR** (Register) shared via recipe(s): kickassembler-one-part-demo, kickassembler-fli-music-scroller, kickassembler-road-sprite-lines, kickassembler-ufli-underlay
- **SPMC** (Register) shared via recipe(s): kickassembler-one-part-demo, kickassembler-fli-music-scroller, kickassembler-road-sprite-lines, kickassembler-ufli-underlay, kickassembler-dysp
- **XXPAND** (Register) shared via recipe(s): kickassembler-one-part-demo, kickassembler-fli-music-scroller, kickassembler-road-sprite-lines, kickassembler-ufli-underlay, kickassembler-dysp
- **SP0COL** (Register) shared via recipe(s): kickassembler-one-part-demo, oscar64-simple-shmup, kickassembler-fli-music-scroller, kickassembler-road-sprite-lines, oscar64-vehicle-control, kickassembler-sideborder-open, oscar64-platformer-scaffold, kickassembler-ufli-underlay, kickassembler-dysp
- **SPSPCL** (Register) shared via recipe(s): oscar64-simple-shmup
- **SPBGCL** (Register) shared via recipe(s): oscar64-simple-shmup
- **SP1COL** (Register) shared via recipe(s): oscar64-simple-shmup, kickassembler-road-sprite-lines, oscar64-platformer-scaffold, kickassembler-dysp
- **SP2COL** (Register) shared via recipe(s): oscar64-simple-shmup, kickassembler-road-sprite-lines, oscar64-platformer-scaffold, kickassembler-dysp
- **SP3COL** (Register) shared via recipe(s): oscar64-simple-shmup, oscar64-platformer-scaffold, kickassembler-dysp
- **SP4COL** (Register) shared via recipe(s): oscar64-simple-shmup, oscar64-platformer-scaffold
- **SP5COL** (Register) shared via recipe(s): oscar64-simple-shmup, oscar64-platformer-scaffold
- **SP6COL** (Register) shared via recipe(s): oscar64-simple-shmup, oscar64-platformer-scaffold
- **SP7COL** (Register) shared via recipe(s): oscar64-simple-shmup
- **DC00** (Register) shared via recipe(s): oscar64-falling-blocks, oscar64-platformer-scaffold
- **BGCOL1** (Register) shared via recipe(s): oscar64-mcm-ecm-zones, oscar64-vehicle-control
- **BGCOL2** (Register) shared via recipe(s): oscar64-mcm-ecm-zones, oscar64-vehicle-control
- **BGCOL3** (Register) shared via recipe(s): oscar64-mcm-ecm-zones, oscar64-vehicle-control
- **M1X** (Register) shared via recipe(s): kickassembler-road-sprite-lines, kickassembler-dysp
- **M1Y** (Register) shared via recipe(s): kickassembler-road-sprite-lines, kickassembler-dysp
- **M2X** (Register) shared via recipe(s): kickassembler-road-sprite-lines, kickassembler-dysp
- **M2Y** (Register) shared via recipe(s): kickassembler-road-sprite-lines, kickassembler-dysp
- **DC02** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC03** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SETLFS** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETNAM** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **OPEN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CLOSE** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKOUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CLRCHN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHROUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHRIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **READST** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **RANDOM** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **M3X** (Register) shared via recipe(s): kickassembler-dysp
- **M3Y** (Register) shared via recipe(s): kickassembler-dysp
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.


## Budget

Command: `node src/cli.ts plan-budget` with the same 24 techniques, `--region both`.

# Budget plan: undetermined

Techniques: pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, pal_ntsc_detection, raster_split_modes, screen_double_buffer_d018, unrolled_loops, self_modifying_code, mcm_text, vic_bank_select, charset_copy_rom_to_ram, vehicle_control, car_contact_response, fixed_point_8_8, sid_voice_setup, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars, sprite_multiplex_8, sid_play_routine_pattern, sfx_in_player, object_pool

## play (PAL, 19656 cycles a frame): undetermined

Range 44006-60027 + 1075 fixed cycles; floor 0; weakest basis arithmetic; IRQ slots 8.

Summed:
- pseudo_3d_road_raster: 17975 (measured-vice, on kickassembler-pseudo-3d-road (PAL, the frame of each pair in which the table computation runs: the CPU is busy from line 0 to cycle 20 of line 285 at the latest, the fine chain included; see Cycle budget))
- stable_raster_irq: 310 (measured-vice, on kickassembler-stable-raster-irq (one double-IRQ entry through $0314 to the synced line, plus the re-arm and exit; screen on, badlines inside; NTSC, 262 on PAL))
- double_irq: 160 (arithmetic, on kickassembler-stable-raster-irq (one zero-jitter entry))
- irq_chain_table: 498 (measured-vice, on kickassembler-irq-chain (three slots with two-store handlers and an empty music call, frame-counter print left out, badline stalls left out))
- screen_double_buffer_d018: 13196 (measured-vice, on oscar64-double-buffer (the recipe's whole-page redraw with its caption, 12,598 PAL and 13,165 NTSC, plus the 31-cycle flip; an item is one 40-byte row copied into the hidden page by a C byte loop at -O2, fitted to -dREDRAW_ROWS builds of 0 to 25 rows on PAL and NTSC; CIA1 timer B, screen on and one sprite, so the stolen cycles are in it; the base is the flip, 31, and the sprite-pointer copy, 26; the wait for line 256 is not in it))
- vehicle_control: 557-655 (measured-vice, on oscar64-vehicle-control (worst frame is a crash under braking while sliding left on the verge over its limit, one car, in the vertical blank))
- car_contact_response: 2081-17549 (measured-vice, on oscar64-car-contact (worst frame: a built frame, not a bound, eight cars packed so all 28 pairs are in contact and 7 get an impulse, with the tile probe, screen blanked; typical: the mean over one 256-frame pass of the six-car game, screen on, PAL))
- fixed_point_8_8: 31 (measured-vice, on oscar64-platformer-scaffold (PROFILE=2 build, the 8.8 Y add and the pixel byte of one actor, display off, PAL and NTSC))
- frame_sync_loop: 314 (measured-vice, on oscar64-platformer-scaffold (the raster IRQ from entry to return, 291, plus the loop's tick bookkeeping, 23; PROFILE=1 build, PAL and NTSC; the budget bar's two stores are not inside))
- joystick_edge_detect: 114 (measured-vice, on oscar64-joystick-input (one port read and the three-way split, Oscar64 -O2, call included; PAL and NTSC))
- decimal_print: 1361 (measured-vice, on oscar64-print-number (one call, worst decimal case))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))
- sprite_multiplex_8: 5301 (arithmetic, on oscar64-sprite-multiplex-8 (the three calls' worst cases summed))
- sid_play_routine_pattern: 768-1223 (measured-vice, on kickassembler-music-player (worst of 2,000 calls, NTSC, a frame with no effect that starts a note on all three voices; PAL 1,215, the same kind of frame; typical is the NTSC median, PAL 762; bytes from the symbol file: player code $1182-$172A, data is player state 337 + effect priorities and data 250 + octave-6 tables 48 + tune 451))
- sfx_in_player: 493 (arithmetic, on kickassembler-sfx-in-player (increment over the player, worst effect frame))
- object_pool: 380 (measured-vice, on oscar64-object-pool (eight live slots, screen blanked))

Left out:
- pal_ntsc_detection: 23032 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-pal-ntsc-detect)

To measure:
- raster_split_modes: no **Cost:** line; measure it on kickassembler-raster-split-modes
- unrolled_loops: no **Cost:** line; no recipe yet
- self_modifying_code: no **Cost:** line; no recipe yet
- mcm_text: no **Cost:** line; measure it on kickassembler-mcm-text
- vic_bank_select: no **Cost:** line; measure it on kickassembler-chunky-4x4
- charset_copy_rom_to_ram: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on kickassembler-charset-copy-rom-to-ram
- sid_voice_setup: no **Cost:** line; measure it on oscar64-sid-music-player

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because pseudo_3d_road_raster, double_irq, irq_chain_table, vehicle_control, car_contact_response, fixed_point_8_8, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars, sprite_multiplex_8, sid_play_routine_pattern, sfx_in_player, object_pool are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: stable_raster_irq, screen_double_buffer_d018 were measured with the screen on and already hold the stalls that fell inside them, so the charge is too high by that much and the over test counts 0.
- The low end, 44006 + 1075 = 45081, is over the 19656-cycle frame by 25425, but it is not a floor: the figures of pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, screen_double_buffer_d018, vehicle_control, car_contact_response, fixed_point_8_8, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars, sprite_multiplex_8, sid_play_routine_pattern, sfx_in_player, object_pool are a common frame or a real run's worst, and those frames need not fall together. pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, screen_double_buffer_d018, fixed_point_8_8, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars, sprite_multiplex_8, sfx_in_player, object_pool have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: raster_split_modes, unrolled_loops, self_modifying_code, mcm_text, vic_bank_select, charset_copy_rom_to_ram, sid_voice_setup have no cycles figure, so the verdict cannot be fits.
- Multi-frame: pal_ntsc_detection (23032) is above the longest frame (PAL, 19656) and not summed on either model; spread the work over frames or budget it as its own phase.

## play (NTSC, 17095 cycles a frame): undetermined

Range 44006-60027 + 1075 fixed cycles; floor 0; weakest basis arithmetic; IRQ slots 8.

Summed:
- pseudo_3d_road_raster: 17975 (measured-vice, on kickassembler-pseudo-3d-road (PAL, the frame of each pair in which the table computation runs: the CPU is busy from line 0 to cycle 20 of line 285 at the latest, the fine chain included; see Cycle budget))
- stable_raster_irq: 310 (measured-vice, on kickassembler-stable-raster-irq (one double-IRQ entry through $0314 to the synced line, plus the re-arm and exit; screen on, badlines inside; NTSC, 262 on PAL))
- double_irq: 160 (arithmetic, on kickassembler-stable-raster-irq (one zero-jitter entry))
- irq_chain_table: 498 (measured-vice, on kickassembler-irq-chain (three slots with two-store handlers and an empty music call, frame-counter print left out, badline stalls left out))
- screen_double_buffer_d018: 13196 (measured-vice, on oscar64-double-buffer (the recipe's whole-page redraw with its caption, 12,598 PAL and 13,165 NTSC, plus the 31-cycle flip; an item is one 40-byte row copied into the hidden page by a C byte loop at -O2, fitted to -dREDRAW_ROWS builds of 0 to 25 rows on PAL and NTSC; CIA1 timer B, screen on and one sprite, so the stolen cycles are in it; the base is the flip, 31, and the sprite-pointer copy, 26; the wait for line 256 is not in it))
- vehicle_control: 557-655 (measured-vice, on oscar64-vehicle-control (worst frame is a crash under braking while sliding left on the verge over its limit, one car, in the vertical blank))
- car_contact_response: 2081-17549 (measured-vice, on oscar64-car-contact (worst frame: a built frame, not a bound, eight cars packed so all 28 pairs are in contact and 7 get an impulse, with the tile probe, screen blanked; typical: the mean over one 256-frame pass of the six-car game, screen on, PAL))
- fixed_point_8_8: 31 (measured-vice, on oscar64-platformer-scaffold (PROFILE=2 build, the 8.8 Y add and the pixel byte of one actor, display off, PAL and NTSC))
- frame_sync_loop: 314 (measured-vice, on oscar64-platformer-scaffold (the raster IRQ from entry to return, 291, plus the loop's tick bookkeeping, 23; PROFILE=1 build, PAL and NTSC; the budget bar's two stores are not inside))
- joystick_edge_detect: 114 (measured-vice, on oscar64-joystick-input (one port read and the three-way split, Oscar64 -O2, call included; PAL and NTSC))
- decimal_print: 1361 (measured-vice, on oscar64-print-number (one call, worst decimal case))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))
- sprite_multiplex_8: 5301 (arithmetic, on oscar64-sprite-multiplex-8 (the three calls' worst cases summed))
- sid_play_routine_pattern: 768-1223 (measured-vice, on kickassembler-music-player (worst of 2,000 calls, NTSC, a frame with no effect that starts a note on all three voices; PAL 1,215, the same kind of frame; typical is the NTSC median, PAL 762; bytes from the symbol file: player code $1182-$172A, data is player state 337 + effect priorities and data 250 + octave-6 tables 48 + tune 451))
- sfx_in_player: 493 (arithmetic, on kickassembler-sfx-in-player (increment over the player, worst effect frame))
- object_pool: 380 (measured-vice, on oscar64-object-pool (eight live slots, screen blanked))

Left out:
- pal_ntsc_detection: 23032 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-pal-ntsc-detect)

To measure:
- raster_split_modes: no **Cost:** line; measure it on kickassembler-raster-split-modes
- unrolled_loops: no **Cost:** line; no recipe yet
- self_modifying_code: no **Cost:** line; no recipe yet
- mcm_text: no **Cost:** line; measure it on kickassembler-mcm-text
- vic_bank_select: no **Cost:** line; measure it on kickassembler-chunky-4x4
- charset_copy_rom_to_ram: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on kickassembler-charset-copy-rom-to-ram
- sid_voice_setup: no **Cost:** line; measure it on oscar64-sid-music-player

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because pseudo_3d_road_raster, double_irq, irq_chain_table, vehicle_control, car_contact_response, fixed_point_8_8, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars, sprite_multiplex_8, sid_play_routine_pattern, sfx_in_player, object_pool are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: stable_raster_irq, screen_double_buffer_d018 were measured with the screen on and already hold the stalls that fell inside them, so the charge is too high by that much and the over test counts 0.
- The low end, 44006 + 1075 = 45081, is over the 17095-cycle frame by 27986, but it is not a floor: the figures of pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, screen_double_buffer_d018, vehicle_control, car_contact_response, fixed_point_8_8, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars, sprite_multiplex_8, sid_play_routine_pattern, sfx_in_player, object_pool are a common frame or a real run's worst, and those frames need not fall together. pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, screen_double_buffer_d018, fixed_point_8_8, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars, sprite_multiplex_8, sfx_in_player, object_pool have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: raster_split_modes, unrolled_loops, self_modifying_code, mcm_text, vic_bank_select, charset_copy_rom_to_ram, sid_voice_setup have no cycles figure, so the verdict cannot be fits.
- Multi-frame: pal_ntsc_detection (23032) is above the longest frame (PAL, 19656) and not summed on either model; spread the work over frames or budget it as its own phase.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

Sum 4653 over charset_copy_rom_to_ram (derived-listing), sid_play_routine_pattern (measured-vice); weakest basis derived-listing; a floor, since pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, raster_split_modes, screen_double_buffer_d018, unrolled_loops, self_modifying_code, mcm_text, vic_bank_select, vehicle_control, car_contact_response, fixed_point_8_8, sid_voice_setup, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars, sprite_multiplex_8, sfx_in_player, object_pool state no bytes.
- pal_ntsc_detection: 339 bytes left out, the whole program, not the technique

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.


The budget is undetermined: it sums other programs' recipe figures (the
pseudo-3d-road recipe's whole-frame 17,975, eight cars' contact 17,549),
and seven members have no figure. The frame is settled by the meter on
this program: the game step plus the IRQs, and the builder's pictures a
second, PAL and NTSC.

## Memory and screen

- $0801-$087F Oscar64's start; from $0880 the KickAssembler blob (IRQs,
  builder, tables, road templates, the glyph data to copy, the two road
  copies of 96 blocks); then the C program, its data and its stack, below
  $C000.
- VIC bank 3: road screens A $C000 and B $C400, the panel's screen $C800,
  sprite blocks 48-63 at $CC00, road character sets at $D000, $D800,
  $E000, $F000 and $F800 (char 255 of the last is under the vectors and
  unused), the ROM font at $E800. BASIC and KERNAL banked out ($01 = $35);
  the sets under I/O are written with $01 = $34 and interrupts off.
- Step 2 needs more sprite blocks than $CC00 holds: the panel moves to its
  own VIC bank at the line-203 split ($DD00), freeing $C800 and $E800.
- Zero page: Oscar64 $02-$6F; the builder $D0-$D3 and $E0-$FF.

## Autopilot and checks

- The bot drives the race; the verdict grades the game's state; then a
  still that the shots and `make roadcheck` are pinned on.
- Step 1 adds: roadcheck models the per-row character sets and the
  per-line $D022/$D023, and a check that no edge steps by 8 or more
  pixels between lines; expect.json pins kerb and band colours.
- Lost frames: `late` 0 on long PAL and NTSC runs.

## Decisions and open questions

- Base: main's racing starter (green contract, per-line bend, a picture
  every 3.5 PAL frames). The #110 work-in-progress branch
  (worktree-agent-a93621e446c442cbf) drew glyphs per picture and measured
  a picture every 9.2 PAL frames; its original tune and asm opponent field
  are candidates for steps 3 and 4. Step 1 landed at a picture every 3.04
  PAL frames with per-line edges.
- The horizon moves in 2-line steps. A 1-line step needs five character
  sets (the model's count) and about 4 KB more; the 2-line step was not
  visible in play and is recorded here for step 2 to revisit if memory
  allows.
- The road leans half as far as a camera fixed on the centre line would
  make it: full lean sheared every row by up to 10 pixels with the car
  off-centre.
- 38 columns everywhere: in 40 columns XSCROLL's shifted-in pixels showed
  the background as a sawtooth wherever a bend brought the road to the
  screen's edge (seen at top speed on the first play). The panel's text
  keeps to columns 1-37; the meter is at columns 18-37.
- The tune is original. The maintainer asked to "port the music too"; a
  commercial game's music cannot ship, so step 4 writes a new tune in the
  same spirit.
