# Plan: racing

The pseudo-3D road racer starter for c64-kb issue #53. The tool output below
was produced on 2026-09-24 by this checkout of c64-kb and pasted whole.

## Concept

A pseudo-3D road racer in the Pitstop II manner: the road recedes to a
horizon, bends left and right and rises over crests, drawn from a raster
split on every road line ($D016 for the bend, $D021 for the grass bands and
the sky above the horizon). Three opponent cars are sprites that grow as
they come nearer, stepping through six pictures. The player steers,
accelerates and brakes; the grass slows the car; contact with an opponent
costs speed. A lap clock, the laps, the position and the speed on a panel
under the road; an engine note, start beeps and a bump on the SID. Title,
three lights, two laps, the finish, back to the title. PAL and NTSC.

## Briefing

Command: `npx tsx src/cli.ts game-briefing "A pseudo-3D road racer in the Pitstop II style: the road recedes to a horizon and curves left and right and rises over hills, drawn from raster splits that shift each road line; opponent cars are sprites that grow as they come nearer, stepping through sizes; the player steers, accelerates and brakes; lap timer and lap counter in a HUD; collisions with opponents and the verge slow the car; a SID engine note. PAL and NTSC." --archetype racing`

Kept from its 16 proposals: pseudo_3d_road_raster (the road; its recipe
kickassembler-pseudo-3d-road is where the road starts), stable_raster_irq
and double_irq (the road's per-line code starts on a known cycle),
raster_split_modes (the panel under the road), pal_ntsc_detection,
sid_voice_setup, raster_profile_bars (the harness meter).

Dropped: sprite_multiplex_8 (three sprites on the road lines, none reused),
sprite_expand (the cars step through six pictures instead; a Y-expanded
sprite fetches on twice the lines, which the road's timing would have to
pad), mixed_sprite_char_actors, multi_sprite_object and
sprites_only_screen_mode (the cars are one sprite each; the road is
characters), dypp_sprite_sine_scroller and raster_bars (matched words, not
this game), sid_play_routine_pattern and sfx_engine_beside_music (no tune:
an engine note and two effects on their own voices).

Added, not proposed: irq_chain_table (pseudo_3d_road_raster requires it:
one chain of lines 251, 103, 105), screen_double_buffer_d018 (two road
screens and two copies of the road's code, one shown, one being built),
unrolled_loops and self_modifying_code (one block of code a road line, its
immediates patched), mcm_text, vic_bank_select, charset_copy_rom_to_ram
(the panel's font in bank 3), vehicle_control, car_contact_response,
fixed_point_8_8, frame_sync_loop, joystick_edge_detect, decimal_print.

Pitfalls the briefing and `pitfalls-for` name that this program meets:
badline_cycle_loss (a badline takes 43 cycles from a block that reads on
cycle 12: measured, the pad allows for it), raster_irq_first_line_jitter
(the double IRQ at 103 and 105), sprite_dma_overflow and
vic_bus_takeover_on_dma (sprites 0-2 fetch at a line's end: each line's pad
leaves out what its sprites take; sprites 3-7 would stall the stores and
stay off), d016_unmasked_rmw_clobbers_csel_mcm (whole $D016 values only),
d012_wrap_around (every IRQ line below 256), pal_ntsc_tempo_mismatch (one
game step a frame: 6/5 as fast on NTSC; the clock counts 5 frames a tenth
on PAL, 6 on NTSC), colour_ram_index_past_last_cell_hits_cia1 (colour RAM
written to 999), vic_bank_visibility_collision (bank 3 has no ROM font:
copied), petscii_written_to_screen_ram (screen codes), cia_timer_phi2_difference
(the meter's figures are per model).

## Techniques

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| pseudo_3d_road_raster | the road: characters for the width, $D016 per line for the bend, $D021 per line for the bands and the horizon | kickassembler-pseudo-3d-road; the per-line pad for sprite fetches from kickassembler-dysp | badline_cycle_loss, raster_irq_first_line_jitter, d016_unmasked_rmw_clobbers_csel_mcm, colour_ram_index_past_last_cell_hits_cia1 |
| stable_raster_irq | the first road block on cycle 1 of line 107 | kickassembler-stable-raster-irq | raster_irq_first_line_jitter, decimal_mode_in_irq_handler |
| double_irq | IRQ at 103 into a NOP slide, the second at 105, two $D012 reads | kickassembler-stable-raster-irq | branch_page_cross_extra_cycle, irq_during_charen_window |
| irq_chain_table | one chain: 251 (the frame, the swap), 103, 105 (the road), then 203 (the panel) | kickassembler-irq-chain | d012_wrap_around |
| pal_ntsc_detection | the last line's number decides the pads and the sync | kickassembler-pseudo-3d-road (detect_region) | raster_line_count_difference |
| raster_split_modes | line 203: $D018 to the panel's screen and font, $D016 to hires | the beat-em-up starter's engine.asm | xscroll_applies_to_all_rows, idle_fetch_byte_shows_in_gaps |
| screen_double_buffer_d018 | two road screens and two code copies: the builder writes the ones not shown | the platformer starter's view.c | full_field_redraw_exceeds_vblank |
| unrolled_loops | 96 blocks of 64 bytes a copy, one a road line | kickassembler-pseudo-3d-road | branch_page_cross_extra_cycle |
| self_modifying_code | each block's $D016, $D021 and branch operand are patched per picture | kickassembler-dysp | branch_page_cross_extra_cycle |
| mcm_text | grass, road, kerb and dash as multicolour pairs | kickassembler-pseudo-3d-road | ecm_with_mcm_set_is_invalid_black_mode |
| vic_bank_select | bank 3: screens at $C000-$CBFF, sprites $CC00, characters $E000 | the beat-em-up starter's view.c | vic_bank_visibility_collision |
| charset_copy_rom_to_ram | the ROM font at $E800 for the panel and the meter | kickassembler-charset-copy-rom-to-ram | vic_bank_visibility_collision |
| vehicle_control | throttle, brake, steering that needs speed, the grass's limit, a bend's push | oscar64-vehicle-control | signed_compare_bmi_overflow |
| car_contact_response | overlap along and across the road: pushed apart, the car behind slowed, 25 frames' cool-down | oscar64-car-contact | signed_compare_bmi_overflow |
| fixed_point_8_8 | speeds in 8.8, the road's centre in 10.6 | oscar64-vehicle-control | signed_compare_bmi_overflow |
| sid_voice_setup | the engine on voice 1, beeps on 2, the bump on 3 | kickassembler-music-player | sid_adsr_bug_8580, sid_write_only_registers |
| frame_sync_loop | one game step for every tick of line 251; the builder in the time between | oscar64-frame-sync-loop | d012_wrap_around, badline_cycle_loss |
| joystick_edge_detect | fire starts the race on the press | oscar64-attract-replay | joystick2_scan_phantom_press |
| decimal_print | the lap clock digit by digit, the times on the panel | oscar64-print-number | petscii_written_to_screen_ram |
| raster_profile_bars | the harness meter, CIA2 timer A; the IRQs time themselves on timer B | oscar64-raster-profile-bars | badline_cycle_loss, vic_bus_takeover_on_dma |

## Compatibility

Command: `npx tsx src/cli.ts check-compatibility pseudo_3d_road_raster stable_raster_irq double_irq irq_chain_table pal_ntsc_detection raster_split_modes screen_double_buffer_d018 unrolled_loops self_modifying_code mcm_text vic_bank_select charset_copy_rom_to_ram vehicle_control car_contact_response fixed_point_8_8 sid_voice_setup frame_sync_loop joystick_edge_detect decimal_print raster_profile_bars`

```text
# Compatibility: pseudo_3d_road_raster + stable_raster_irq + double_irq + irq_chain_table + pal_ntsc_detection + raster_split_modes + screen_double_buffer_d018 + unrolled_loops + self_modifying_code + mcm_text + vic_bank_select + charset_copy_rom_to_ram + vehicle_control + car_contact_response + fixed_point_8_8 + sid_voice_setup + frame_sync_loop + joystick_edge_detect + decimal_print + raster_profile_bars

**Verdict:** WARNINGS

Checked with 5 implied prerequisite(s): cpu_io_port_bank, screen_ram_relocation, soft_scroll_v, tile_grid_collision, tile_map_render.

Unit claims are stated for 10 of 20 techniques; a unit conflict cannot be ruled out for: pseudo_3d_road_raster, pal_ntsc_detection, unrolled_loops, self_modifying_code, mcm_text, charset_copy_rom_to_ram, fixed_point_8_8, frame_sync_loop, decimal_print, raster_profile_bars, cpu_io_port_bank (prerequisite), screen_ram_relocation (prerequisite), tile_grid_collision (prerequisite), tile_map_render (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## shared_register (soft): pseudo_3d_road_raster × stable_raster_irq
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × double_irq
**Shared:** IRQMSK, VICIRQ, RASTER
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × irq_chain_table
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × pal_ntsc_detection
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × raster_split_modes
**Shared:** VMCSB, SCROLX, SCROLY
Both techniques touch register(s) VMCSB, SCROLX, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × screen_double_buffer_d018
**Shared:** VMCSB, SCROLY
Both techniques touch register(s) VMCSB, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × mcm_text
**Shared:** BGCOL2, BGCOL1, BGCOL0, VMCSB, SCROLX
Both techniques touch register(s) BGCOL2, BGCOL1, BGCOL0, VMCSB, SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × charset_copy_rom_to_ram
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pseudo_3d_road_raster × frame_sync_loop
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × double_irq
**Shared:** vic_raster_irq
stable_raster_irq and double_irq both run on the one raster compare, as entries in a handler chain someone else owns.
**Resolution:** Put both in one interrupt chain, in the order its owner sets. With no raster effect in the set, the program's own chain is that owner.

## shared_register (soft): stable_raster_irq × double_irq
**Shared:** IRQMSK, VICIRQ, RASTER
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × irq_chain_table
**Shared:** vic_raster_irq
irq_chain_table owns the raster compare; stable_raster_irq runs inside irq_chain_table's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of irq_chain_table's handler or as one more entry in irq_chain_table's chain, not as a second interrupt setup.

## shared_register (soft): stable_raster_irq × irq_chain_table
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): stable_raster_irq × pal_ntsc_detection
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

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

## shared_register (soft): stable_raster_irq × frame_sync_loop
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): double_irq × irq_chain_table
**Shared:** vic_raster_irq
irq_chain_table owns the raster compare; double_irq runs inside irq_chain_table's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run double_irq as the entry of irq_chain_table's handler or as one more entry in irq_chain_table's chain, not as a second interrupt setup.

## shared_register (soft): double_irq × irq_chain_table
**Shared:** IRQMSK, VICIRQ, RASTER
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): double_irq × pal_ntsc_detection
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): double_irq × raster_split_modes
**Shared:** vic_raster_irq
raster_split_modes owns the raster compare; double_irq runs inside raster_split_modes's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run double_irq as the entry of raster_split_modes's handler or as one more entry in raster_split_modes's chain, not as a second interrupt setup.

## shared_register (soft): double_irq × frame_sync_loop
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): irq_chain_table × pal_ntsc_detection
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

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

## shared_register (soft): irq_chain_table × frame_sync_loop
**Shared:** EXTCOL, RASTER, SCROLY
Both techniques touch register(s) EXTCOL, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): irq_chain_table × raster_profile_bars
**Shared:** EXTCOL
Both techniques touch register(s) EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pal_ntsc_detection × raster_split_modes
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pal_ntsc_detection × screen_double_buffer_d018
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): pal_ntsc_detection × frame_sync_loop
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_split_modes × screen_double_buffer_d018
**Shared:** VMCSB, SCROLY
Both techniques touch register(s) VMCSB, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_split_modes × mcm_text
**Shared:** VMCSB, SCROLX
Both techniques touch register(s) VMCSB, SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_split_modes × charset_copy_rom_to_ram
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_split_modes × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

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

## shared_register (soft): frame_sync_loop × raster_profile_bars
**Shared:** EXTCOL
Both techniques touch register(s) EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.


## Not covered
- **unrolled_loops**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **self_modifying_code**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **fixed_point_8_8**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **decimal_print**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **cpu_io_port_bank** (prerequisite of charset_copy_rom_to_ram): the graph has no registers, KERNAL routines or demands for it.
- **tile_grid_collision** (prerequisite of car_contact_response, vehicle_control): the graph has no registers, KERNAL routines or demands for it.
- **tile_map_render** (prerequisite of car_contact_response, vehicle_control): the graph has no registers, KERNAL routines or demands for it.

## Shared Infrastructure (info)
- **cpu_io_port_bank** (prerequisite, not in the set): required by charset_copy_rom_to_ram; included in the check as implied. Set it up first.
- **screen_ram_relocation** (prerequisite, not in the set): required by screen_double_buffer_d018; included in the check as implied. Set it up first.
- **soft_scroll_v** (prerequisite, not in the set): required by vehicle_control; included in the check as implied. Set it up first.
- **tile_grid_collision** (prerequisite, not in the set): required by car_contact_response, vehicle_control; included in the check as implied. Set it up first.
- **tile_map_render** (prerequisite, not in the set): required by car_contact_response, vehicle_control; included in the check as implied. Set it up first.
- **SP6COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP5COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP4COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP3COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp
- **SP2COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp
- **SP1COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp
- **CHRIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHROUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CLRCHN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKOUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CLOSE** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **OPEN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETNAM** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETLFS** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **DC0F** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-vehicle-control, kickassembler-tech-tech, kickassembler-eight-way-scroll
- **DC07** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-vehicle-control, kickassembler-tech-tech, kickassembler-eight-way-scroll
- **DC06** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-vehicle-control, kickassembler-tech-tech, kickassembler-eight-way-scroll
- **DC03** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC02** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC00** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks
- **SP0COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp, oscar64-vehicle-control, kickassembler-sideborder-open
- **BGCOL0** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-vehicle-control, kickassembler-fli-image, kickassembler-stable-raster-irq, kickassembler-tech-tech, kickassembler-eight-way-scroll, oscar64-falling-blocks
- **EXTCOL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-vehicle-control, kickassembler-fli-image, kickassembler-stable-raster-irq, kickassembler-tech-tech, kickassembler-eight-way-scroll, oscar64-falling-blocks
- **IRQMSK** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp, kickassembler-sideborder-open, kickassembler-fld, kickassembler-fli-image, kickassembler-stable-raster-irq, kickassembler-tech-tech, kickassembler-eight-way-scroll
- **VICIRQ** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp, kickassembler-sideborder-open, kickassembler-fld, kickassembler-fli-image, kickassembler-stable-raster-irq, kickassembler-tech-tech, kickassembler-eight-way-scroll
- **SPENA** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp, oscar64-vehicle-control, kickassembler-sideborder-open
- **RASTER** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp, kickassembler-sideborder-open, kickassembler-fld, kickassembler-fli-image, kickassembler-stable-raster-irq, kickassembler-tech-tech, kickassembler-eight-way-scroll, oscar64-falling-blocks
- **SCROLY** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp, oscar64-vehicle-control, kickassembler-sideborder-open, kickassembler-fld, kickassembler-fli-image, kickassembler-stable-raster-irq, kickassembler-tech-tech, kickassembler-eight-way-scroll, oscar64-falling-blocks
- **MSIGX** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp, oscar64-vehicle-control, kickassembler-sideborder-open
- **M0Y** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp, oscar64-vehicle-control, kickassembler-sideborder-open
- **M0X** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-dysp, oscar64-vehicle-control, kickassembler-sideborder-open
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
- **READST** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **DC0E** (Register) shared via recipe(s): kickassembler-dysp, kickassembler-tech-tech, oscar64-falling-blocks
- **DC05** (Register) shared via recipe(s): kickassembler-dysp, kickassembler-tech-tech, oscar64-falling-blocks
- **DC04** (Register) shared via recipe(s): kickassembler-dysp, kickassembler-tech-tech, oscar64-falling-blocks
- **XXPAND** (Register) shared via recipe(s): kickassembler-dysp
- **SPMC** (Register) shared via recipe(s): kickassembler-dysp
- **YXPAND** (Register) shared via recipe(s): kickassembler-dysp, kickassembler-sideborder-open
- **SCROLX** (Register) shared via recipe(s): kickassembler-dysp, kickassembler-sideborder-open, kickassembler-fli-image, kickassembler-tech-tech, kickassembler-eight-way-scroll
- **M3Y** (Register) shared via recipe(s): kickassembler-dysp
- **M3X** (Register) shared via recipe(s): kickassembler-dysp
- **M2Y** (Register) shared via recipe(s): kickassembler-dysp
- **M2X** (Register) shared via recipe(s): kickassembler-dysp
- **M1Y** (Register) shared via recipe(s): kickassembler-dysp
- **M1X** (Register) shared via recipe(s): kickassembler-dysp
- **DD0E** (Register) shared via recipe(s): oscar64-vehicle-control, kickassembler-fld
- **DD05** (Register) shared via recipe(s): oscar64-vehicle-control, kickassembler-fld
- **DD04** (Register) shared via recipe(s): oscar64-vehicle-control, kickassembler-fld
- **BGCOL3** (Register) shared via recipe(s): oscar64-vehicle-control
- **BGCOL2** (Register) shared via recipe(s): oscar64-vehicle-control
- **BGCOL1** (Register) shared via recipe(s): oscar64-vehicle-control
- **VMCSB** (Register) shared via recipe(s): oscar64-vehicle-control, kickassembler-fli-image, kickassembler-tech-tech, kickassembler-eight-way-scroll
- **DC0D** (Register) shared via recipe(s): kickassembler-fld, kickassembler-fli-image, kickassembler-stable-raster-irq, kickassembler-eight-way-scroll
- **DD00** (Register) shared via recipe(s): kickassembler-fli-image
- **DD0D** (Register) shared via recipe(s): kickassembler-eight-way-scroll
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.

```

What the warnings mean for this program:

- unit_contention (soft) irq_chain_table × raster_split_modes: one raster
  compare. The panel split is not a second interrupt: it is the last block of
  the road's code, line 203, inside the one chain (engine.asm). (Before
  c64-kb data 792 this pair read hard and the verdict INCOMPATIBLE.)
- unit_shared stable_raster_irq, double_irq, irq_chain_table,
  raster_split_modes: the same chain. irq_top (103) arms the sync IRQ (105),
  which runs the road's blocks and the split and re-arms irq_blank (251).
- shared_register $D016, $D018, $D021, $D011, $D012, $D019, $D01A: each has
  one writer per raster region. irq_blank writes the top's $D016, $D018,
  $D021 and the sprites; the road's blocks write $D016 and $D021 on lines
  107-202; line 203 writes the panel's $D018, $D016, $D021. The builder
  never writes a VIC-II register: it patches the copy not shown.
- frame_sync_loop × raster_profile_bars ($D020): the meter does not colour
  the border; only the verdict does, once.

## Budget

Command: `npx tsx src/cli.ts plan-budget pseudo_3d_road_raster stable_raster_irq double_irq irq_chain_table pal_ntsc_detection raster_split_modes screen_double_buffer_d018 unrolled_loops self_modifying_code mcm_text vic_bank_select charset_copy_rom_to_ram vehicle_control car_contact_response fixed_point_8_8 sid_voice_setup frame_sync_loop joystick_edge_detect decimal_print raster_profile_bars --region both --sprites 3 --sprite-lines 21`

```text
# Budget plan: undetermined

Techniques: pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, pal_ntsc_detection, raster_split_modes, screen_double_buffer_d018, unrolled_loops, self_modifying_code, mcm_text, vic_bank_select, charset_copy_rom_to_ram, vehicle_control, car_contact_response, fixed_point_8_8, sid_voice_setup, frame_sync_loop, joystick_edge_detect, decimal_print, raster_profile_bars

## play (PAL, 19656 cycles a frame): undetermined

Range 23409-38975 + 1264 fixed cycles; floor 0; weakest basis arithmetic; IRQ slots 6.

Summed:
- pseudo_3d_road_raster: 17975 (measured-vice, on kickassembler-pseudo-3d-road (PAL, the frame of each pair in which the table computation runs: the CPU is busy from line 0 to cycle 20 of line 285 at the latest, the fine chain included; see Cycle budget))
- stable_raster_irq: 310 (measured-vice, on kickassembler-stable-raster-irq (one double-IRQ entry through $0314 to the synced line, plus the re-arm and exit; screen on, badlines inside; NTSC, 262 on PAL))
- double_irq: 160 (arithmetic, on kickassembler-stable-raster-irq (one zero-jitter entry))
- irq_chain_table: 498 (measured-vice, on kickassembler-irq-chain (three slots with two-store handlers and an empty music call, frame-counter print left out, badline stalls left out))
- vehicle_control: 557-655 (measured-vice, on oscar64-vehicle-control (worst frame is a crash under braking while sliding left on the verge over its limit, one car, in the vertical blank))
- car_contact_response: 2081-17549 (measured-vice, on oscar64-car-contact (worst frame: a built frame, not a bound, eight cars packed so all 28 pairs are in contact and 7 get an impulse, with the tile probe, screen blanked; typical: the mean over one 256-frame pass of the six-car game, screen on, PAL))
- decimal_print: 1361 (measured-vice, on oscar64-print-number (one call, worst decimal case))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

To measure:
- pal_ntsc_detection: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-pal-ntsc-detect
- raster_split_modes: no **Cost:** line; no recipe yet
- screen_double_buffer_d018: no **Cost:** line; measure it on oscar64-double-buffer
- unrolled_loops: no **Cost:** line; no recipe yet
- self_modifying_code: no **Cost:** line; no recipe yet
- mcm_text: no **Cost:** line; no recipe yet
- vic_bank_select: no **Cost:** line; no recipe yet
- charset_copy_rom_to_ram: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on kickassembler-charset-copy-rom-to-ram
- fixed_point_8_8: no **Cost:** line; measure it on oscar64-fixed-point-jump
- sid_voice_setup: no **Cost:** line; measure it on oscar64-sid-music-player
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-joystick-input

Notes:
- Fixed losses 1264 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 189; arithmetic) charged because pseudo_3d_road_raster, double_irq, irq_chain_table, vehicle_control, car_contact_response, decimal_print, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: stable_raster_irq was measured with the screen on and already holds the stalls that fell inside it, so the charge is too high by that much and the over test counts 0.
- The low end, 23409 + 1264 = 24673, is over the 19656-cycle frame by 5017, but it is not a floor: the figures of pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, vehicle_control, car_contact_response, decimal_print, raster_profile_bars are a common frame or a real run's worst, and those frames need not fall together. pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, decimal_print, raster_profile_bars have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: pal_ntsc_detection, raster_split_modes, screen_double_buffer_d018, unrolled_loops, self_modifying_code, mcm_text, vic_bank_select, charset_copy_rom_to_ram, fixed_point_8_8, sid_voice_setup, frame_sync_loop, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.

## play (NTSC, 17095 cycles a frame): undetermined

Range 23409-38975 + 1264 fixed cycles; floor 0; weakest basis arithmetic; IRQ slots 6.

Summed:
- pseudo_3d_road_raster: 17975 (measured-vice, on kickassembler-pseudo-3d-road (PAL, the frame of each pair in which the table computation runs: the CPU is busy from line 0 to cycle 20 of line 285 at the latest, the fine chain included; see Cycle budget))
- stable_raster_irq: 310 (measured-vice, on kickassembler-stable-raster-irq (one double-IRQ entry through $0314 to the synced line, plus the re-arm and exit; screen on, badlines inside; NTSC, 262 on PAL))
- double_irq: 160 (arithmetic, on kickassembler-stable-raster-irq (one zero-jitter entry))
- irq_chain_table: 498 (measured-vice, on kickassembler-irq-chain (three slots with two-store handlers and an empty music call, frame-counter print left out, badline stalls left out))
- vehicle_control: 557-655 (measured-vice, on oscar64-vehicle-control (worst frame is a crash under braking while sliding left on the verge over its limit, one car, in the vertical blank))
- car_contact_response: 2081-17549 (measured-vice, on oscar64-car-contact (worst frame: a built frame, not a bound, eight cars packed so all 28 pairs are in contact and 7 get an impulse, with the tile probe, screen blanked; typical: the mean over one 256-frame pass of the six-car game, screen on, PAL))
- decimal_print: 1361 (measured-vice, on oscar64-print-number (one call, worst decimal case))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

To measure:
- pal_ntsc_detection: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-pal-ntsc-detect
- raster_split_modes: no **Cost:** line; no recipe yet
- screen_double_buffer_d018: no **Cost:** line; measure it on oscar64-double-buffer
- unrolled_loops: no **Cost:** line; no recipe yet
- self_modifying_code: no **Cost:** line; no recipe yet
- mcm_text: no **Cost:** line; no recipe yet
- vic_bank_select: no **Cost:** line; no recipe yet
- charset_copy_rom_to_ram: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on kickassembler-charset-copy-rom-to-ram
- fixed_point_8_8: no **Cost:** line; measure it on oscar64-fixed-point-jump
- sid_voice_setup: no **Cost:** line; measure it on oscar64-sid-music-player
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-joystick-input

Notes:
- Fixed losses 1264 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 189; arithmetic) charged because pseudo_3d_road_raster, double_irq, irq_chain_table, vehicle_control, car_contact_response, decimal_print, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: stable_raster_irq was measured with the screen on and already holds the stalls that fell inside it, so the charge is too high by that much and the over test counts 0.
- The low end, 23409 + 1264 = 24673, is over the 17095-cycle frame by 7578, but it is not a floor: the figures of pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, vehicle_control, car_contact_response, decimal_print, raster_profile_bars are a common frame or a real run's worst, and those frames need not fall together. pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, decimal_print, raster_profile_bars have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: pal_ntsc_detection, raster_split_modes, screen_double_buffer_d018, unrolled_loops, self_modifying_code, mcm_text, vic_bank_select, charset_copy_rom_to_ram, fixed_point_8_8, sid_voice_setup, frame_sync_loop, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

Sum 2118 over charset_copy_rom_to_ram (derived-listing); weakest basis derived-listing; a floor, since pseudo_3d_road_raster, stable_raster_irq, double_irq, irq_chain_table, raster_split_modes, screen_double_buffer_d018, unrolled_loops, self_modifying_code, mcm_text, vic_bank_select, vehicle_control, car_contact_response, fixed_point_8_8, sid_voice_setup, joystick_edge_detect, decimal_print, raster_profile_bars state no bytes.
- pal_ntsc_detection: 339 bytes left out, the whole program, not the technique
- frame_sync_loop: 985 bytes left out, the whole program, not the technique

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
- Sprites: 3 a line on 21 lines, (3 + 2 × 3) × 21 = 189 cycles of DMA a frame (3 + 2n measured in VICE x64sc for sprites numbered without gaps).

```

What the budget leaves open, and how it was settled (measured here, VICE
x64sc 3.10, the local Oscar64; README, "The measured frame"):

- pseudo_3d_road_raster's 17,975 is the recipe's whole frame (its fine
  chain, its table computation and its coarse redraw in one). Here the
  fine chain is 96 lines of the IRQ, about 6,300 cycles on PAL and 6,500 on
  NTSC every frame, and the rest is the builder, which is not a per-frame
  cost: it runs in whatever time the game's step and the IRQs leave, and a
  picture takes as many frames as it needs. The meter measures the step
  plus the IRQs (every frame's fixed work); the builder is measured as
  cycles per picture and frames per picture.
- car_contact_response's 17,549 is 28 car pairs; here three pairs, inside
  the cars' step.
- decimal_print's 1,361 is a five-digit number by division; the lap clock
  here counts digit by digit (hud.c) and the lap times are printed once a
  lap.
- Measured: the step and the IRQs, worst 10,358 / typical 8,816 cycles on
  PAL, 10,750 / 9,049 on NTSC (255 race frames from race frame 200). The
  builder: a row up to 3,293 cycles on PAL and 3,388 on NTSC, a picture's
  start up to 3,706, its end up to 1,674 (CIA1 timer A with interrupts
  off); a picture every 3.5 frames on PAL, 4.9 on NTSC.

## Memory and screen

- $0801-$087F Oscar64's start; $0880-$620C the KickAssembler blob
  (engine.asm, builder.asm, track.asm: the IRQs, the builder, the tables,
  and the two road copies of 96 blocks of 64 bytes at $2500 and $3E00);
  $6400-$BFFF the C program, its data and its stack.
- VIC bank 3: road screens A $C000 and B $C400 (rows 0-6 the sky and hills,
  7-18 the road), the panel's screen $C800 (rows 19-24), sprite blocks
  48-53 at $CC00 (the car at six sizes), road characters $E000, the ROM
  font copied to $E800. BASIC and KERNAL are banked out ($01 = $35).
- Zero page: Oscar64 $02-$6F; the builder $D0-$D3 and $E0-$FF.
- In AUTOPILOT builds the meter owns row 24, columns 20-39, in the ROM font;
  CIA2 timer A is the meter's, timer B times the IRQs for it.

## Autopilot and checks

- The bot (src/autopilot.h) presses fire on the title, holds the throttle
  from the lights, and steers each frame for a target across the road: the
  centre, away from a car close ahead, and twice on purpose elsewhere: into
  car 1 for its first 500 race frames (contact) and onto the right-hand
  grass in segments 17-19 of lap 1 (the verge).
- The verdict (src/verdict.h), two seconds after the finish: laps and place,
  the clock against the bot's own count, the panel's lap times against that
  count, contact, the verge, overtakes, no lost frame and every road chain's
  split on its line, the horizon's range, the bend's range, four or more car
  sizes drawn, the VIC-II's sprite registers equal to the set shown, the
  meter's 255 frames. $02FF and the border; the failed bits on row 24.
- Then a still: the camera in the left kink over the crest, car 1 near,
  car 2 far, the player right of centre.
- expect.json grades the still on both models: the verdict, the panel's
  text, the horizon's line, the kerbs on sample lines (and inside rows,
  line by line), the three cars' boxes, the road and the sky identical on
  PAL and NTSC, the meter. tools/roadcheck.py draws every road line from
  the machine's own splits and matches the shots pixel for pixel.
- Mutants (make mutants): each of seven faults fails a check.

## Decisions and open questions

- The recipe draws the road with the sprites off. Here sprites 0-2 fetch on
  road lines, and a fetch stalls the CPU by 5 + 2 * (last - first) cycles
  for the sprites on that line (vic-ii-reference, Sprite DMA). Each road
  line's code is one 64-byte block with a slide of CMP #$C9 bytes entered by
  a patched BVC; the builder pads each line by its sprites' stall
  (kickassembler-dysp's method). The sync constants and the badline's 43
  cycles were measured with the PROBE build (README, "The road's timing").
- The builder runs in the main loop's spare time, a row at a time, and the
  game steps once a frame when irq_blank's tick moves. A picture takes 3.5
  frames on PAL and 4.9 on NTSC over the race; the game and the lap clock
  run every frame.
- Open: the pseudo-3D road with sprites on its lines has no recipe in
  c64-kb; this starter's engine.asm is the first working form. c64-kb
  issue #77 asks for a standalone recipe.
