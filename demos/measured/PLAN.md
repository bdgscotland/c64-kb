# Plan: measured

A five-part single-file demo, PAL and NTSC, built from c64-kb's techniques and
recipes and verified on the harness. Every tool output below was produced on
2026-09-23 by c64-kb 0.15.0 (KB data 764) and pasted whole. DESIGN.md holds
the part list, the lifecycle contract, the memory map and the sync plan.

## Concept

Five parts to one original tune, each ended by the tune's position: a logo
band that wobbles 62 pixels with a sprite scroller in the opened lower border;
a twister with depth-sorted vector balls; DYSP sprites in the open side border
over a text scroller; a colour-RAM fire dissolved in; and a sprites-only
screen with the vector balls and no badline anywhere. An end screen prints the
five parts' measured frame costs, the harness meter and the verdict. PAL and
NTSC.

## Briefing

Command: `npx tsx src/cli.ts demo-briefing "<the concept above>"`

The briefing proposed ten techniques. Kept: dysp_side_border_sprites,
sprite_border_scroller, vector_balls_sprites, sideborder_open (as dysp's
prerequisite), sprites_only_screen_mode, fire_effect, dypp_sprite_sine_scroller
in the form of sprite_border_scroller (the border scroller is the DYPP with the
border opened, and this demo uses that one). Dropped: multi_sprite_object (no
multi-sprite actor here), tile_map_render and char_scroll_buffer_h (the brief's
"scroller" is the sprite scroller and a soft_scroll_h text line; no tile map).
Added from the recipes the demo actually starts from: tech_tech_wobbler,
twister, soft_scroll_h, screen_dissolve_lfsr, colour_fade,
sid_play_routine_pattern, stable_raster_irq, topbottom_border_open,
irq_chain_table. The briefing's budget summed every part into one frame and
read "undetermined"; parts run one at a time, so the per-part budgets below are
the ones that bind. Pitfalls the briefing named that this program meets:
badline_cycle_loss, raster_irq_first_line_jitter, d012_wrap_around,
sprite_x_high_bit_wrong_register, sprite_x_range_hidden_and_seam,
vic_bus_takeover_on_dma, idle_fetch_byte_shows_in_gaps,
colour_ram_index_past_last_cell_hits_cia1, full_field_redraw_exceeds_vblank,
lfsr_zero_state_lockup, sprite_registers_persist_across_state_change (each part
re-establishes every sprite register in setup), d016_unmasked_rmw_clobbers_csel_mcm.

## Techniques

The first cell is the technique's snake_case name as the tools print it.

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| tech_tech_wobbler | part 1: the logo band, eight pre-shifted screens plus XSCROLL, 62 px of swing | kickassembler-tech-tech | badline_cycle_loss, charset_blit_overruns_grown_code, cia_timer_phi2_difference, colour_ram_index_past_last_cell_hits_cia1, d012_wrap_around, d016_unmasked_rmw_clobbers_csel_mcm, irq_during_charen_window, petscii_written_to_screen_ram, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, tape_bit_is_a_pulse_pair_not_a_pulse, tod_read_order_latch, vic_bank_visibility_collision, cia_revision_irq_one_cycle_late, ctm_embedded_whole_shifts_charset, ecm_with_mcm_set_is_invalid_black_mode, idle_fetch_byte_shows_in_gaps, raster_line_count_difference, sprite_priority_collision_silent, vic_colour_register_upper_nibble_reads_set, xscroll_applies_to_all_rows |
| sprite_border_scroller | part 1: the scroll text in the opened lower border | kickassembler-sprite-border-scroller | badline_cycle_loss, sprite_dma_overflow, d012_wrap_around, irq_during_charen_window, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, sprite_y_expand_double_register_write, ecm_with_mcm_set_is_invalid_black_mode, idle_fetch_byte_shows_in_gaps, raster_line_count_difference, sprite_priority_collision_silent, sprite_registers_persist_across_state_change, sprite_x_high_bit_wrong_register, sprite_x_range_hidden_and_seam, vic_bus_takeover_on_dma, vic_colour_register_upper_nibble_reads_set |
| twister | part 2: the column, a 128-line copy from assembly-time phase images | kickassembler-twister | badline_cycle_loss, charset_blit_overruns_grown_code, cia_timer_phi2_difference, colour_ram_index_past_last_cell_hits_cia1, d012_wrap_around, d016_unmasked_rmw_clobbers_csel_mcm, full_field_redraw_exceeds_vblank, petscii_written_to_screen_ram, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, tape_bit_is_a_pulse_pair_not_a_pulse, vic_bank_visibility_collision, cia_revision_irq_one_cycle_late, ctm_embedded_whole_shifts_charset, ecm_with_mcm_set_is_invalid_black_mode, idle_fetch_byte_shows_in_gaps, raster_line_count_difference, vic_colour_register_upper_nibble_reads_set, xscroll_applies_to_all_rows |
| vector_balls_sprites | parts 2 and 5: eight depth-sorted sprite balls | kickassembler-vector-balls | badline_cycle_loss, sprite_dma_overflow, d012_wrap_around, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, sprite_y_expand_double_register_write, raster_line_count_difference, sprite_registers_persist_across_state_change, sprite_x_range_hidden_and_seam, vic_bus_takeover_on_dma, vic_colour_register_upper_nibble_reads_set |
| dysp_side_border_sprites | part 3: sprites at different heights in the open side border, set-indexed delay table | kickassembler-dysp | badline_cycle_loss, sprite_dma_overflow, cia_timer_phi2_difference, colour_ram_index_past_last_cell_hits_cia1, d012_wrap_around, d016_unmasked_rmw_clobbers_csel_mcm, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, tape_bit_is_a_pulse_pair_not_a_pulse, cia_revision_irq_one_cycle_late, ecm_with_mcm_set_is_invalid_black_mode, idle_fetch_byte_shows_in_gaps, raster_line_count_difference, sprite_registers_persist_across_state_change, sprite_x_high_bit_wrong_register, sprite_x_range_hidden_and_seam, vic_bus_takeover_on_dma, vic_colour_register_upper_nibble_reads_set, xscroll_applies_to_all_rows |
| sideborder_open | part 3: the border trick dysp is built on (its prerequisite; listed because the tools name it) | kickassembler-sideborder-open | badline_cycle_loss, branch_page_cross_extra_cycle, d016_unmasked_rmw_clobbers_csel_mcm, ecm_with_mcm_set_is_invalid_black_mode, idle_fetch_byte_shows_in_gaps, raster_line_count_difference, sprite_x_range_hidden_and_seam, vic_bus_takeover_on_dma, vic_colour_register_upper_nibble_reads_set, xscroll_applies_to_all_rows |
| soft_scroll_h | part 3: the text scroller behind the border sprites | oscar64-soft-scroll-h (ported to KickAssembler) | d016_unmasked_rmw_clobbers_csel_mcm, ecm_with_mcm_set_is_invalid_black_mode, vic_colour_register_upper_nibble_reads_set, xscroll_applies_to_all_rows |
| fire_effect | part 4: the colour-RAM fire | kickassembler-fire-effect | badline_cycle_loss, cia_icr_read_clears_all_flags, cia_timer_phi2_difference, colour_ram_index_past_last_cell_hits_cia1, d012_wrap_around, full_field_redraw_exceeds_vblank, irq_during_charen_window, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, tape_bit_is_a_pulse_pair_not_a_pulse, cia_revision_irq_one_cycle_late, ecm_with_mcm_set_is_invalid_black_mode, idle_fetch_byte_shows_in_gaps, lfsr_zero_state_lockup, raster_line_count_difference, vic_colour_register_upper_nibble_reads_set |
| screen_dissolve_lfsr | transition into part 4 | kickassembler-screen-dissolve | badline_cycle_loss, colour_ram_index_past_last_cell_hits_cia1, d012_wrap_around, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, lfsr_zero_state_lockup, raster_line_count_difference |
| colour_fade | transitions out of parts 1, 2, 3 and 5 | kickassembler-colour-fade | badline_cycle_loss, colour_ram_index_past_last_cell_hits_cia1, d012_wrap_around, full_field_redraw_exceeds_vblank, pal_ntsc_tempo_mismatch, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, raster_line_count_difference, vic_colour_register_upper_nibble_reads_set |
| sprites_only_screen_mode | part 5: display off, borders open, no badlines, only sprites | kickassembler-sprites-only-screen | badline_cycle_loss, d012_wrap_around, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, ecm_with_mcm_set_is_invalid_black_mode, idle_fetch_byte_shows_in_gaps, raster_line_count_difference, sprite_x_high_bit_wrong_register, vic_bus_takeover_on_dma |
| raster_bars | named by the tools for part 5; DROPPED from the build (it and sprites_only_screen_mode both own vic_raster_irq); the part 5 background stays $D021 black | kickassembler-raster-bars (not used) | badline_cycle_loss, d012_wrap_around, irq_during_charen_window, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, raster_line_count_difference, sprite_priority_collision_silent, vic_colour_register_upper_nibble_reads_set |
| sid_play_routine_pattern | the music: one play call per frame from the sequencer interrupt at line 255 | kickassembler-sfx-in-player (the player, extended with an order list) | pal_ntsc_tempo_mismatch, sid_adsr_bug_8580, sid_filter_chip_variation, sid_voice3_disable_silent_bit, sid_write_only_registers |
| stable_raster_irq | the double-IRQ entry the cycle-locked bands (parts 1 and 3) reuse | kickassembler-stable-raster-irq | badline_cycle_loss, decimal_mode_in_irq_handler, sprite_dma_overflow, branch_page_cross_extra_cycle, d012_wrap_around, irq_during_charen_window, kernal_assumes_sei_cleared, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, sprite_y_expand_double_register_write, ecm_with_mcm_set_is_invalid_black_mode, idle_fetch_byte_shows_in_gaps, raster_irq_during_serial_io, raster_line_count_difference, sprite_priority_collision_silent, vic_colour_register_upper_nibble_reads_set |
| topbottom_border_open | part 1: the lower border the sprite scroller sits in | kickassembler-topbottom-border-open | badline_cycle_loss, d012_wrap_around, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, ecm_with_mcm_set_is_invalid_black_mode, idle_fetch_byte_shows_in_gaps, raster_line_count_difference |
| irq_chain_table | the sequencer dispatcher: one $0314 handler walking a per-part line table | kickassembler-irq-chain | badline_cycle_loss, decimal_mode_in_irq_handler, cia_icr_read_clears_all_flags, d012_wrap_around, irq_during_charen_window, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split, ecm_with_mcm_set_is_invalid_black_mode, idle_fetch_byte_shows_in_gaps, raster_line_count_difference, sprite_priority_collision_silent, vic_colour_register_upper_nibble_reads_set |

## Compatibility

Command: `npx tsx src/cli.ts check-compatibility tech_tech_wobbler sprite_border_scroller twister vector_balls_sprites dysp_side_border_sprites sideborder_open soft_scroll_h fire_effect screen_dissolve_lfsr colour_fade sprites_only_screen_mode raster_bars sid_play_routine_pattern stable_raster_irq topbottom_border_open irq_chain_table`

```text
# Compatibility: tech_tech_wobbler + sprite_border_scroller + twister + vector_balls_sprites + dysp_side_border_sprites + sideborder_open + soft_scroll_h + fire_effect + screen_dissolve_lfsr + colour_fade + sprites_only_screen_mode + raster_bars + sid_play_routine_pattern + stable_raster_irq + topbottom_border_open + irq_chain_table

**Verdict:** INCOMPATIBLE — not as combined; each hard conflict below says how to separate them.

Checked with 11 implied prerequisite(s): dot_3d_rotator, double_irq, dypp_sprite_sine_scroller, fixed_point_8_8, lfsr_random, pal_ntsc_detection, sid_voice_setup, sprite_sine_chain, standard_bitmap, table_generation, text_zoom.

Unit claims are stated for 9 of 16 techniques; a unit conflict cannot be ruled out for: tech_tech_wobbler, twister, vector_balls_sprites, soft_scroll_h, fire_effect, screen_dissolve_lfsr, colour_fade, dot_3d_rotator (prerequisite), fixed_point_8_8 (prerequisite), pal_ntsc_detection (prerequisite), sid_voice_setup (prerequisite), standard_bitmap (prerequisite), table_generation (prerequisite), text_zoom (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## cpu_vs_irq (hard): tech_tech_wobbler × sprite_border_scroller
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from sprite_border_scroller inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); sprite_border_scroller holds lines 20-46,249. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep sprite_border_scroller's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × sprite_border_scroller
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): tech_tech_wobbler × twister
**Shared:** DC0E, DC05, DC04, VMCSB, SCROLX, RASTER, SCROLY
Both techniques touch register(s) DC0E, DC05, DC04, VMCSB, SCROLX, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): tech_tech_wobbler × vector_balls_sprites
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_exclusive (hard): tech_tech_wobbler × dysp_side_border_sprites
**Shared:** cpu_every_line
Both need every CPU cycle on every raster line they cover; they cannot share a raster line. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); dysp_side_border_sprites holds lines 40-200. Only two stated, disjoint line bands clear this rule.
**Resolution:** Give each its own band of lines and switch between them in the border.

## cpu_vs_irq (hard): tech_tech_wobbler × dysp_side_border_sprites
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from dysp_side_border_sprites inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); dysp_side_border_sprites holds lines 40-200. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep dysp_side_border_sprites's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## cpu_vs_irq (hard): tech_tech_wobbler × dysp_side_border_sprites
**Shared:** cpu_every_line, midframe_raster_irqs
dysp_side_border_sprites needs every CPU cycle on its lines; a raster interrupt from tech_tech_wobbler inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); dysp_side_border_sprites holds lines 40-200. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep tech_tech_wobbler's interrupts on lines outside dysp_side_border_sprites's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × dysp_side_border_sprites
**Shared:** DC0E, DC05, DC04, SCROLX, RASTER, SCROLY
Both techniques touch register(s) DC0E, DC05, DC04, SCROLX, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_exclusive (hard): tech_tech_wobbler × sideborder_open
**Shared:** cpu_every_line
Both need every CPU cycle on every raster line they cover; they cannot share a raster line. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); sideborder_open's lines are chosen by the program (movable). Only two stated, disjoint line bands clear this rule.
**Resolution:** Give each its own band of lines and switch between them in the border.

## cpu_vs_irq (hard): tech_tech_wobbler × sideborder_open
**Shared:** cpu_every_line, midframe_raster_irqs
sideborder_open needs every CPU cycle on its lines; a raster interrupt from tech_tech_wobbler inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); sideborder_open's lines are chosen by the program (movable). Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep tech_tech_wobbler's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × sideborder_open
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): tech_tech_wobbler × soft_scroll_h
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): tech_tech_wobbler × fire_effect
**Shared:** DC0E, DC05, DC04, SCROLY
Both techniques touch register(s) DC0E, DC05, DC04, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): tech_tech_wobbler × screen_dissolve_lfsr
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): tech_tech_wobbler × colour_fade
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_vs_irq (hard): tech_tech_wobbler × sprites_only_screen_mode
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from sprites_only_screen_mode inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); sprites_only_screen_mode holds lines 40-256. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep sprites_only_screen_mode's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × sprites_only_screen_mode
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_vs_irq (hard): tech_tech_wobbler × raster_bars
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from raster_bars inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); raster_bars states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep raster_bars's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × raster_bars
**Shared:** VICIRQ, RASTER
Both techniques touch register(s) VICIRQ, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_vs_irq (hard): tech_tech_wobbler × stable_raster_irq
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from stable_raster_irq inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); stable_raster_irq states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep stable_raster_irq's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × stable_raster_irq
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_vs_irq (hard): tech_tech_wobbler × topbottom_border_open
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from topbottom_border_open inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); topbottom_border_open states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep topbottom_border_open's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × topbottom_border_open
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_vs_irq (hard): tech_tech_wobbler × irq_chain_table
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from irq_chain_table inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); irq_chain_table states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep irq_chain_table's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × irq_chain_table
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_border_scroller × twister
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_border_scroller × vector_balls_sprites
**Shared:** SP7COL, SP6COL, SP5COL, SP4COL, SP3COL, SP2COL, SP1COL, SP0COL, XXPAND, SPMC, SPBGPR, YXPAND, SPENA, RASTER, M7Y, M7X, M6Y, M6X, M5Y, M5X, M4Y, M4X, M3Y, M3X, M2Y, M2X, M1Y, M1X, M0Y, M0X
Both techniques touch register(s) SP7COL, SP6COL, SP5COL, SP4COL, SP3COL, SP2COL, SP1COL, SP0COL, XXPAND, SPMC, SPBGPR, YXPAND, SPENA, RASTER, M7Y, M7X, M6Y, M6X, M5Y, M5X, M4Y, M4X, M3Y, M3X, M2Y, M2X, M1Y, M1X, M0Y, M0X. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): sprite_border_scroller × dysp_side_border_sprites
**Shared:** sprite_0-3, vic_raster_irq
Both sprite_border_scroller and dysp_side_border_sprites own sprite_0-3, vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it; for the other units, give one technique different ones (another sprite range, another voice).

## cpu_vs_irq (hard): sprite_border_scroller × dysp_side_border_sprites
**Shared:** cpu_every_line, midframe_raster_irqs
dysp_side_border_sprites needs every CPU cycle on its lines; a raster interrupt from sprite_border_scroller inside that region breaks its cycle count. Raster bands: sprite_border_scroller holds lines 20-46,249; dysp_side_border_sprites holds lines 40-200. The bands overlap.
**Resolution:** Keep sprite_border_scroller's interrupts on lines outside dysp_side_border_sprites's region (the borders, or a separate band).

## shared_register (soft): sprite_border_scroller × dysp_side_border_sprites
**Shared:** SPENA, RASTER, SCROLY, MSIGX, M0Y, M0X
Both techniques touch register(s) SPENA, RASTER, SCROLY, MSIGX, M0Y, M0X. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): sprite_border_scroller × sideborder_open
**Shared:** sprite_0-7, vic_raster_irq
Both sprite_border_scroller and sideborder_open own sprite_0-7, vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it; for the other units, give one technique different ones (another sprite range, another voice).

## cpu_vs_irq (hard): sprite_border_scroller × sideborder_open
**Shared:** cpu_every_line, midframe_raster_irqs
sideborder_open needs every CPU cycle on its lines; a raster interrupt from sprite_border_scroller inside that region breaks its cycle count. Raster bands: sprite_border_scroller holds lines 20-46,249; sideborder_open's lines are chosen by the program (movable). Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep sprite_border_scroller's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## shared_register (soft): sprite_border_scroller × fire_effect
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_border_scroller × screen_dissolve_lfsr
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_border_scroller × colour_fade
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): sprite_border_scroller × sprites_only_screen_mode
**Shared:** vic_raster_irq
Both sprite_border_scroller and sprites_only_screen_mode own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## shared_register (soft): sprite_border_scroller × sprites_only_screen_mode
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): sprite_border_scroller × raster_bars
**Shared:** vic_raster_irq
Both sprite_border_scroller and raster_bars own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## shared_register (soft): sprite_border_scroller × raster_bars
**Shared:** VICIRQ, RASTER
Both techniques touch register(s) VICIRQ, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): sprite_border_scroller × stable_raster_irq
**Shared:** vic_raster_irq
sprite_border_scroller owns the raster compare; stable_raster_irq runs inside sprite_border_scroller's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of sprite_border_scroller's handler or as one more entry in sprite_border_scroller's chain, not as a second interrupt setup.

## shared_register (soft): sprite_border_scroller × stable_raster_irq
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_border_scroller × topbottom_border_open
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): sprite_border_scroller × irq_chain_table
**Shared:** vic_raster_irq
Both sprite_border_scroller and irq_chain_table own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** irq_chain_table is the host: rewrite sprite_border_scroller's raster handler(s) as entries in irq_chain_table's table, so the table alone programs $D012 and sprite_border_scroller runs inside it.

## shared_register (soft): sprite_border_scroller × irq_chain_table
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × vector_balls_sprites
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × dysp_side_border_sprites
**Shared:** DC0E, DC05, DC04, SCROLX, RASTER, SCROLY
Both techniques touch register(s) DC0E, DC05, DC04, SCROLX, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × sideborder_open
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × soft_scroll_h
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × fire_effect
**Shared:** DC0E, DC05, DC04, BGCOL0, EXTCOL, SCROLY
Both techniques touch register(s) DC0E, DC05, DC04, BGCOL0, EXTCOL, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × screen_dissolve_lfsr
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × colour_fade
**Shared:** BGCOL0, EXTCOL, RASTER
Both techniques touch register(s) BGCOL0, EXTCOL, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × sprites_only_screen_mode
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × raster_bars
**Shared:** BGCOL0, EXTCOL, RASTER
Both techniques touch register(s) BGCOL0, EXTCOL, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × stable_raster_irq
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × topbottom_border_open
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): twister × irq_chain_table
**Shared:** EXTCOL, RASTER, SCROLY
Both techniques touch register(s) EXTCOL, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): vector_balls_sprites × dysp_side_border_sprites
**Shared:** SPENA, RASTER, M0Y, M0X
Both techniques touch register(s) SPENA, RASTER, M0Y, M0X. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): vector_balls_sprites × screen_dissolve_lfsr
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): vector_balls_sprites × colour_fade
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): vector_balls_sprites × sprites_only_screen_mode
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): vector_balls_sprites × raster_bars
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): vector_balls_sprites × stable_raster_irq
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): vector_balls_sprites × irq_chain_table
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_exclusive (hard): dysp_side_border_sprites × sideborder_open
**Shared:** cpu_every_line
Both need every CPU cycle on every raster line they cover; they cannot share a raster line. Raster bands: dysp_side_border_sprites holds lines 40-200; sideborder_open's lines are chosen by the program (movable). Only two stated, disjoint line bands clear this rule.
**Resolution:** Give each its own band of lines and switch between them in the border.

## cpu_vs_irq (hard): dysp_side_border_sprites × sideborder_open
**Shared:** cpu_every_line, midframe_raster_irqs
sideborder_open needs every CPU cycle on its lines; a raster interrupt from dysp_side_border_sprites inside that region breaks its cycle count. Raster bands: dysp_side_border_sprites holds lines 40-200; sideborder_open's lines are chosen by the program (movable). Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep dysp_side_border_sprites's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## shared_register (soft): dysp_side_border_sprites × sideborder_open
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): dysp_side_border_sprites × soft_scroll_h
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): dysp_side_border_sprites × fire_effect
**Shared:** DC0E, DC05, DC04, SCROLY
Both techniques touch register(s) DC0E, DC05, DC04, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): dysp_side_border_sprites × screen_dissolve_lfsr
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): dysp_side_border_sprites × colour_fade
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): dysp_side_border_sprites × sprites_only_screen_mode
**Shared:** vic_raster_irq
Both dysp_side_border_sprites and sprites_only_screen_mode own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## cpu_vs_irq (hard): dysp_side_border_sprites × sprites_only_screen_mode
**Shared:** cpu_every_line, midframe_raster_irqs
dysp_side_border_sprites needs every CPU cycle on its lines; a raster interrupt from sprites_only_screen_mode inside that region breaks its cycle count. Raster bands: dysp_side_border_sprites holds lines 40-200; sprites_only_screen_mode holds lines 40-256. The bands overlap.
**Resolution:** Keep sprites_only_screen_mode's interrupts on lines outside dysp_side_border_sprites's region (the borders, or a separate band).

## shared_register (soft): dysp_side_border_sprites × sprites_only_screen_mode
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): dysp_side_border_sprites × raster_bars
**Shared:** vic_raster_irq
Both dysp_side_border_sprites and raster_bars own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## cpu_vs_irq (hard): dysp_side_border_sprites × raster_bars
**Shared:** cpu_every_line, midframe_raster_irqs
dysp_side_border_sprites needs every CPU cycle on its lines; a raster interrupt from raster_bars inside that region breaks its cycle count. Raster bands: dysp_side_border_sprites holds lines 40-200; raster_bars states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep raster_bars's interrupts on lines outside dysp_side_border_sprites's region (the borders, or a separate band).

## shared_register (soft): dysp_side_border_sprites × raster_bars
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_vs_irq (hard): dysp_side_border_sprites × stable_raster_irq
**Shared:** cpu_every_line, midframe_raster_irqs
dysp_side_border_sprites needs every CPU cycle on its lines; a raster interrupt from stable_raster_irq inside that region breaks its cycle count. Raster bands: dysp_side_border_sprites holds lines 40-200; stable_raster_irq states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep stable_raster_irq's interrupts on lines outside dysp_side_border_sprites's region (the borders, or a separate band).

## shared_register (soft): dysp_side_border_sprites × stable_raster_irq
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): dysp_side_border_sprites × topbottom_border_open
**Shared:** vic_raster_irq
Both dysp_side_border_sprites and topbottom_border_open own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## cpu_vs_irq (hard): dysp_side_border_sprites × topbottom_border_open
**Shared:** cpu_every_line, midframe_raster_irqs
dysp_side_border_sprites needs every CPU cycle on its lines; a raster interrupt from topbottom_border_open inside that region breaks its cycle count. Raster bands: dysp_side_border_sprites holds lines 40-200; topbottom_border_open states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep topbottom_border_open's interrupts on lines outside dysp_side_border_sprites's region (the borders, or a separate band).

## shared_register (soft): dysp_side_border_sprites × topbottom_border_open
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): dysp_side_border_sprites × irq_chain_table
**Shared:** vic_raster_irq
Both dysp_side_border_sprites and irq_chain_table own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** irq_chain_table is the host: rewrite dysp_side_border_sprites's raster handler(s) as entries in irq_chain_table's table, so the table alone programs $D012 and dysp_side_border_sprites runs inside it.

## cpu_vs_irq (hard): dysp_side_border_sprites × irq_chain_table
**Shared:** cpu_every_line, midframe_raster_irqs
dysp_side_border_sprites needs every CPU cycle on its lines; a raster interrupt from irq_chain_table inside that region breaks its cycle count. Raster bands: dysp_side_border_sprites holds lines 40-200; irq_chain_table states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep irq_chain_table's interrupts on lines outside dysp_side_border_sprites's region (the borders, or a separate band).

## shared_register (soft): dysp_side_border_sprites × irq_chain_table
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sideborder_open × soft_scroll_h
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): sideborder_open × sprites_only_screen_mode
**Shared:** vic_raster_irq
Both sideborder_open and sprites_only_screen_mode own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## cpu_vs_irq (hard): sideborder_open × sprites_only_screen_mode
**Shared:** cpu_every_line, midframe_raster_irqs
sideborder_open needs every CPU cycle on its lines; a raster interrupt from sprites_only_screen_mode inside that region breaks its cycle count. Raster bands: sideborder_open's lines are chosen by the program (movable); sprites_only_screen_mode holds lines 40-256. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep sprites_only_screen_mode's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## unit_contention (hard): sideborder_open × raster_bars
**Shared:** vic_raster_irq
Both sideborder_open and raster_bars own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## cpu_vs_irq (hard): sideborder_open × raster_bars
**Shared:** cpu_every_line, midframe_raster_irqs
sideborder_open needs every CPU cycle on its lines; a raster interrupt from raster_bars inside that region breaks its cycle count. Raster bands: sideborder_open's lines are chosen by the program (movable); raster_bars states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep raster_bars's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## unit_shared (soft): sideborder_open × stable_raster_irq
**Shared:** vic_raster_irq
sideborder_open owns the raster compare; stable_raster_irq runs inside sideborder_open's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of sideborder_open's handler or as one more entry in sideborder_open's chain, not as a second interrupt setup.

## cpu_vs_irq (hard): sideborder_open × stable_raster_irq
**Shared:** cpu_every_line, midframe_raster_irqs
sideborder_open needs every CPU cycle on its lines; a raster interrupt from stable_raster_irq inside that region breaks its cycle count. Raster bands: sideborder_open's lines are chosen by the program (movable); stable_raster_irq states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep stable_raster_irq's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## unit_contention (hard): sideborder_open × topbottom_border_open
**Shared:** vic_raster_irq
Both sideborder_open and topbottom_border_open own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## cpu_vs_irq (hard): sideborder_open × topbottom_border_open
**Shared:** cpu_every_line, midframe_raster_irqs
sideborder_open needs every CPU cycle on its lines; a raster interrupt from topbottom_border_open inside that region breaks its cycle count. Raster bands: sideborder_open's lines are chosen by the program (movable); topbottom_border_open states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep topbottom_border_open's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## unit_contention (hard): sideborder_open × irq_chain_table
**Shared:** vic_raster_irq
Both sideborder_open and irq_chain_table own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** irq_chain_table is the host: rewrite sideborder_open's raster handler(s) as entries in irq_chain_table's table, so the table alone programs $D012 and sideborder_open runs inside it.

## cpu_vs_irq (hard): sideborder_open × irq_chain_table
**Shared:** cpu_every_line, midframe_raster_irqs
sideborder_open needs every CPU cycle on its lines; a raster interrupt from irq_chain_table inside that region breaks its cycle count. Raster bands: sideborder_open's lines are chosen by the program (movable); irq_chain_table states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep irq_chain_table's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## shared_register (soft): fire_effect × colour_fade
**Shared:** BGCOL0, EXTCOL
Both techniques touch register(s) BGCOL0, EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): fire_effect × sprites_only_screen_mode
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): fire_effect × raster_bars
**Shared:** BGCOL0, EXTCOL
Both techniques touch register(s) BGCOL0, EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): fire_effect × stable_raster_irq
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): fire_effect × topbottom_border_open
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): fire_effect × irq_chain_table
**Shared:** EXTCOL, SCROLY
Both techniques touch register(s) EXTCOL, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_dissolve_lfsr × colour_fade
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_dissolve_lfsr × sprites_only_screen_mode
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_dissolve_lfsr × raster_bars
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_dissolve_lfsr × stable_raster_irq
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_dissolve_lfsr × irq_chain_table
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): colour_fade × sprites_only_screen_mode
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): colour_fade × raster_bars
**Shared:** BGCOL0, EXTCOL, RASTER
Both techniques touch register(s) BGCOL0, EXTCOL, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): colour_fade × stable_raster_irq
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): colour_fade × irq_chain_table
**Shared:** EXTCOL, RASTER
Both techniques touch register(s) EXTCOL, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): sprites_only_screen_mode × raster_bars
**Shared:** vic_raster_irq
Both sprites_only_screen_mode and raster_bars own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## shared_register (soft): sprites_only_screen_mode × raster_bars
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): sprites_only_screen_mode × stable_raster_irq
**Shared:** vic_raster_irq
sprites_only_screen_mode owns the raster compare; stable_raster_irq runs inside sprites_only_screen_mode's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of sprites_only_screen_mode's handler or as one more entry in sprites_only_screen_mode's chain, not as a second interrupt setup.

## shared_register (soft): sprites_only_screen_mode × stable_raster_irq
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprites_only_screen_mode × topbottom_border_open
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): sprites_only_screen_mode × irq_chain_table
**Shared:** vic_raster_irq
Both sprites_only_screen_mode and irq_chain_table own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** irq_chain_table is the host: rewrite sprites_only_screen_mode's raster handler(s) as entries in irq_chain_table's table, so the table alone programs $D012 and sprites_only_screen_mode runs inside it.

## shared_register (soft): sprites_only_screen_mode × irq_chain_table
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): raster_bars × stable_raster_irq
**Shared:** vic_raster_irq
raster_bars owns the raster compare; stable_raster_irq runs inside raster_bars's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of raster_bars's handler or as one more entry in raster_bars's chain, not as a second interrupt setup.

## shared_register (soft): raster_bars × stable_raster_irq
**Shared:** VICIRQ, RASTER
Both techniques touch register(s) VICIRQ, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): raster_bars × topbottom_border_open
**Shared:** vic_raster_irq
Both raster_bars and topbottom_border_open own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## unit_contention (hard): raster_bars × irq_chain_table
**Shared:** vic_raster_irq
Both raster_bars and irq_chain_table own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** irq_chain_table is the host: rewrite raster_bars's raster handler(s) as entries in irq_chain_table's table, so the table alone programs $D012 and raster_bars runs inside it.

## shared_register (soft): raster_bars × irq_chain_table
**Shared:** EXTCOL, VICIRQ, RASTER
Both techniques touch register(s) EXTCOL, VICIRQ, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × topbottom_border_open
**Shared:** vic_raster_irq
topbottom_border_open owns the raster compare; stable_raster_irq runs inside topbottom_border_open's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of topbottom_border_open's handler or as one more entry in topbottom_border_open's chain, not as a second interrupt setup.

## shared_register (soft): stable_raster_irq × topbottom_border_open
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × irq_chain_table
**Shared:** vic_raster_irq
irq_chain_table owns the raster compare; stable_raster_irq runs inside irq_chain_table's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of irq_chain_table's handler or as one more entry in irq_chain_table's chain, not as a second interrupt setup.

## shared_register (soft): stable_raster_irq × irq_chain_table
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): topbottom_border_open × irq_chain_table
**Shared:** vic_raster_irq
Both topbottom_border_open and irq_chain_table own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** irq_chain_table is the host: rewrite topbottom_border_open's raster handler(s) as entries in irq_chain_table's table, so the table alone programs $D012 and topbottom_border_open runs inside it.

## shared_register (soft): topbottom_border_open × irq_chain_table
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## prerequisite_conflict (hard): tech_tech_wobbler × dysp_side_border_sprites
**Via prerequisite(s):** text_zoom
**Rule:** cpu_vs_irq
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler requires text_zoom. dysp_side_border_sprites needs every CPU cycle on its lines; a raster interrupt from text_zoom inside that region breaks its cycle count. Raster bands: text_zoom states no raster band; dysp_side_border_sprites holds lines 40-200. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep text_zoom's interrupts on lines outside dysp_side_border_sprites's region (the borders, or a separate band).

## prerequisite_conflict (hard): tech_tech_wobbler × dysp_side_border_sprites
**Via prerequisite(s):** double_irq
**Rule:** cpu_vs_irq
**Shared:** cpu_every_line, midframe_raster_irqs
dysp_side_border_sprites requires double_irq (via sideborder_open). tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from double_irq inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); double_irq states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep double_irq's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## prerequisite_conflict (hard): tech_tech_wobbler × dysp_side_border_sprites
**Via prerequisite(s):** text_zoom, sideborder_open
**Rule:** cpu_vs_irq
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler requires text_zoom; dysp_side_border_sprites requires sideborder_open. sideborder_open needs every CPU cycle on its lines; a raster interrupt from text_zoom inside that region breaks its cycle count. Raster bands: text_zoom states no raster band; sideborder_open's lines are chosen by the program (movable). Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep text_zoom's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## prerequisite_conflict (hard): tech_tech_wobbler × sideborder_open
**Via prerequisite(s):** text_zoom
**Rule:** cpu_vs_irq
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler requires text_zoom. sideborder_open needs every CPU cycle on its lines; a raster interrupt from text_zoom inside that region breaks its cycle count. Raster bands: text_zoom states no raster band; sideborder_open's lines are chosen by the program (movable). Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep text_zoom's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## prerequisite_conflict (hard): tech_tech_wobbler × sideborder_open
**Via prerequisite(s):** double_irq
**Rule:** cpu_vs_irq
**Shared:** cpu_every_line, midframe_raster_irqs
sideborder_open requires double_irq. tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from double_irq inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); double_irq states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep double_irq's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## prerequisite_conflict (info): fire_effect × sid_play_routine_pattern
**Via prerequisite(s):** lfsr_random
**Rule:** init_order
**Shared:** sid_filter_volume, sid_voice_3
fire_effect requires lfsr_random. lfsr_random uses sid_filter_volume, sid_voice_3 once at start-up; sid_play_routine_pattern then uses it every frame.
**Resolution:** Run lfsr_random's use before sid_play_routine_pattern starts.

## prerequisite_conflict (info): screen_dissolve_lfsr × sid_play_routine_pattern
**Via prerequisite(s):** lfsr_random
**Rule:** init_order
**Shared:** sid_filter_volume, sid_voice_3
screen_dissolve_lfsr requires lfsr_random. lfsr_random uses sid_filter_volume, sid_voice_3 once at start-up; sid_play_routine_pattern then uses it every frame.
**Resolution:** Run lfsr_random's use before sid_play_routine_pattern starts.


## Not covered
- **fixed_point_8_8** (prerequisite of vector_balls_sprites): the graph has no registers, KERNAL routines or demands for it.
- **table_generation** (prerequisite of twister): the graph has no registers, KERNAL routines or demands for it.

## Shared Infrastructure (info)
- **dot_3d_rotator** (prerequisite, not in the set): required by vector_balls_sprites; included in the check as implied. Set it up first.
- **double_irq** (prerequisite, not in the set): required by dysp_side_border_sprites, sideborder_open; included in the check as implied. Set it up first.
- **dypp_sprite_sine_scroller** (prerequisite, not in the set): required by sprite_border_scroller; included in the check as implied. Set it up first.
- **fixed_point_8_8** (prerequisite, not in the set): required by vector_balls_sprites; included in the check as implied. Set it up first.
- **lfsr_random** (prerequisite, not in the set): required by fire_effect, screen_dissolve_lfsr; included in the check as implied. Set it up first.
- **pal_ntsc_detection** (prerequisite, not in the set): required by dysp_side_border_sprites; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sid_play_routine_pattern; included in the check as implied. Set it up first.
- **sprite_sine_chain** (prerequisite, not in the set): required by sprite_border_scroller; included in the check as implied. Set it up first.
- **standard_bitmap** (prerequisite, not in the set): required by twister; included in the check as implied. Set it up first.
- **table_generation** (prerequisite, not in the set): required by twister; included in the check as implied. Set it up first.
- **text_zoom** (prerequisite, not in the set): required by tech_tech_wobbler; included in the check as implied. Set it up first.
- **DC0D** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-eight-way-scroll
- **BGCOL0** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-eight-way-scroll, kickassembler-tech-tech, oscar64-raster-bars
- **EXTCOL** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-eight-way-scroll, kickassembler-tech-tech, oscar64-raster-bars
- **IRQMSK** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-sideborder-open, kickassembler-eight-way-scroll, kickassembler-dysp, kickassembler-tech-tech
- **VICIRQ** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-sideborder-open, kickassembler-eight-way-scroll, kickassembler-dysp, kickassembler-tech-tech, oscar64-raster-bars
- **VMCSB** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-eight-way-scroll, kickassembler-tech-tech
- **SCROLX** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-sideborder-open, kickassembler-eight-way-scroll, kickassembler-dysp, kickassembler-tech-tech
- **RASTER** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-sideborder-open, kickassembler-eight-way-scroll, kickassembler-dysp, kickassembler-tech-tech, oscar64-raster-bars
- **SCROLY** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-sideborder-open, kickassembler-eight-way-scroll, kickassembler-dysp, kickassembler-tech-tech
- **SIGVOL** (Register) shared via recipe(s): kickassembler-cracktro-template
- **DC00** (Register) shared via recipe(s): kickassembler-cracktro-template
- **SP0COL** (Register) shared via recipe(s): kickassembler-sideborder-open, kickassembler-dysp
- **YXPAND** (Register) shared via recipe(s): kickassembler-sideborder-open, kickassembler-dysp
- **SPENA** (Register) shared via recipe(s): kickassembler-sideborder-open, kickassembler-dysp
- **MSIGX** (Register) shared via recipe(s): kickassembler-sideborder-open, kickassembler-dysp
- **M0Y** (Register) shared via recipe(s): kickassembler-sideborder-open, kickassembler-dysp
- **M0X** (Register) shared via recipe(s): kickassembler-sideborder-open, kickassembler-dysp
- **DD0D** (Register) shared via recipe(s): kickassembler-eight-way-scroll
- **DC0F** (Register) shared via recipe(s): kickassembler-eight-way-scroll, kickassembler-tech-tech
- **DC07** (Register) shared via recipe(s): kickassembler-eight-way-scroll, kickassembler-tech-tech
- **DC06** (Register) shared via recipe(s): kickassembler-eight-way-scroll, kickassembler-tech-tech
- **DC0E** (Register) shared via recipe(s): kickassembler-dysp, kickassembler-tech-tech
- **DC05** (Register) shared via recipe(s): kickassembler-dysp, kickassembler-tech-tech
- **DC04** (Register) shared via recipe(s): kickassembler-dysp, kickassembler-tech-tech
- **SP3COL** (Register) shared via recipe(s): kickassembler-dysp
- **SP2COL** (Register) shared via recipe(s): kickassembler-dysp
- **SP1COL** (Register) shared via recipe(s): kickassembler-dysp
- **XXPAND** (Register) shared via recipe(s): kickassembler-dysp
- **SPMC** (Register) shared via recipe(s): kickassembler-dysp
- **M3Y** (Register) shared via recipe(s): kickassembler-dysp
- **M3X** (Register) shared via recipe(s): kickassembler-dysp
- **M2Y** (Register) shared via recipe(s): kickassembler-dysp
- **M2X** (Register) shared via recipe(s): kickassembler-dysp
- **M1Y** (Register) shared via recipe(s): kickassembler-dysp
- **M1X** (Register) shared via recipe(s): kickassembler-dysp
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

What the warnings mean for this program:

- Every hard conflict is a cpu_every_line or vic_raster_irq ownership between techniques that run in DIFFERENT PARTS or in disjoint raster bands of one part. Parts run one at a time, so the whole-set verdict is not the verdict that binds; the per-part outputs below are, and the one part-level hard conflict (part 5, sprites_only_screen_mode against raster_bars) was resolved by dropping raster_bars from the build.
- Part 1: tech_tech_wobbler's band is lines 109-162 and needs every cycle there; the sprite border scroller's interrupts are at lines 249 and 20 and its position update runs from line 20; the sequencer's interrupt is at 255; the three never share a line. One dispatcher (irq_chain_table) owns vic_raster_irq.
- Part 3: dysp_side_border_sprites requires sideborder_open; the tool sees both as cpu_every_line on the same lines because they are the same loop. Only dysp's loop exists in the build.
- shared_register warnings (SPENA, RASTER, SCROLY, SCROLX, EXTCOL and the sprite registers) are the parts writing the same registers in turn; setup re-establishes every one of them, and no two parts are resident together.

### Per part

```text
# Compatibility: tech_tech_wobbler + sprite_border_scroller + sid_play_routine_pattern + stable_raster_irq + topbottom_border_open

**Verdict:** INCOMPATIBLE — not as combined; each hard conflict below says how to separate them.

Checked with 4 implied prerequisite(s): dypp_sprite_sine_scroller, sid_voice_setup, sprite_sine_chain, text_zoom.

Unit claims are stated for 4 of 5 techniques; a unit conflict cannot be ruled out for: tech_tech_wobbler, sid_voice_setup (prerequisite), text_zoom (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## cpu_vs_irq (hard): tech_tech_wobbler × sprite_border_scroller
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from sprite_border_scroller inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); sprite_border_scroller holds lines 20-46,249. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep sprite_border_scroller's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × sprite_border_scroller
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_vs_irq (hard): tech_tech_wobbler × stable_raster_irq
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from stable_raster_irq inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); stable_raster_irq states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep stable_raster_irq's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × stable_raster_irq
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## cpu_vs_irq (hard): tech_tech_wobbler × topbottom_border_open
**Shared:** cpu_every_line, midframe_raster_irqs
tech_tech_wobbler needs every CPU cycle on its lines; a raster interrupt from topbottom_border_open inside that region breaks its cycle count. Raster bands: tech_tech_wobbler's lines are chosen by the program (movable); topbottom_border_open states no raster band. Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep topbottom_border_open's interrupts on lines outside tech_tech_wobbler's region (the borders, or a separate band).

## shared_register (soft): tech_tech_wobbler × topbottom_border_open
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): sprite_border_scroller × stable_raster_irq
**Shared:** vic_raster_irq
sprite_border_scroller owns the raster compare; stable_raster_irq runs inside sprite_border_scroller's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of sprite_border_scroller's handler or as one more entry in sprite_border_scroller's chain, not as a second interrupt setup.

## shared_register (soft): sprite_border_scroller × stable_raster_irq
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_border_scroller × topbottom_border_open
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × topbottom_border_open
**Shared:** vic_raster_irq
topbottom_border_open owns the raster compare; stable_raster_irq runs inside topbottom_border_open's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of topbottom_border_open's handler or as one more entry in topbottom_border_open's chain, not as a second interrupt setup.

## shared_register (soft): stable_raster_irq × topbottom_border_open
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.


## Shared Infrastructure (info)
- **dypp_sprite_sine_scroller** (prerequisite, not in the set): required by sprite_border_scroller; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sid_play_routine_pattern; included in the check as implied. Set it up first.
- **sprite_sine_chain** (prerequisite, not in the set): required by sprite_border_scroller; included in the check as implied. Set it up first.
- **text_zoom** (prerequisite, not in the set): required by tech_tech_wobbler; included in the check as implied. Set it up first.
- **DC0F** (Register) shared via recipe(s): kickassembler-tech-tech
- **DC0E** (Register) shared via recipe(s): kickassembler-tech-tech
- **DC07** (Register) shared via recipe(s): kickassembler-tech-tech
- **DC06** (Register) shared via recipe(s): kickassembler-tech-tech
- **DC05** (Register) shared via recipe(s): kickassembler-tech-tech
- **DC04** (Register) shared via recipe(s): kickassembler-tech-tech
- **BGCOL0** (Register) shared via recipe(s): kickassembler-tech-tech
- **EXTCOL** (Register) shared via recipe(s): kickassembler-tech-tech
- **IRQMSK** (Register) shared via recipe(s): kickassembler-tech-tech
- **VICIRQ** (Register) shared via recipe(s): kickassembler-tech-tech
- **VMCSB** (Register) shared via recipe(s): kickassembler-tech-tech
- **SCROLX** (Register) shared via recipe(s): kickassembler-tech-tech
- **RASTER** (Register) shared via recipe(s): kickassembler-tech-tech
- **SCROLY** (Register) shared via recipe(s): kickassembler-tech-tech
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

```text
# Compatibility: twister + vector_balls_sprites + sid_play_routine_pattern

**Verdict:** WARNINGS

Checked with 5 implied prerequisite(s): dot_3d_rotator, fixed_point_8_8, sid_voice_setup, standard_bitmap, table_generation.

Unit claims are stated for 1 of 3 techniques; a unit conflict cannot be ruled out for: twister, vector_balls_sprites, dot_3d_rotator (prerequisite), fixed_point_8_8 (prerequisite), sid_voice_setup (prerequisite), standard_bitmap (prerequisite), table_generation (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## shared_register (soft): twister × vector_balls_sprites
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.


## Not covered
- **fixed_point_8_8** (prerequisite of vector_balls_sprites): the graph has no registers, KERNAL routines or demands for it.
- **table_generation** (prerequisite of twister): the graph has no registers, KERNAL routines or demands for it.

## Shared Infrastructure (info)
- **dot_3d_rotator** (prerequisite, not in the set): required by vector_balls_sprites; included in the check as implied. Set it up first.
- **fixed_point_8_8** (prerequisite, not in the set): required by vector_balls_sprites; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sid_play_routine_pattern; included in the check as implied. Set it up first.
- **standard_bitmap** (prerequisite, not in the set): required by twister; included in the check as implied. Set it up first.
- **table_generation** (prerequisite, not in the set): required by twister; included in the check as implied. Set it up first.
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

```text
# Compatibility: dysp_side_border_sprites + sideborder_open + soft_scroll_h + sid_play_routine_pattern

**Verdict:** INCOMPATIBLE — not as combined; each hard conflict below says how to separate them.

Checked with 4 implied prerequisite(s): double_irq, pal_ntsc_detection, sid_voice_setup, stable_raster_irq.

Unit claims are stated for 3 of 4 techniques; a unit conflict cannot be ruled out for: soft_scroll_h, pal_ntsc_detection (prerequisite), sid_voice_setup (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## cpu_exclusive (hard): dysp_side_border_sprites × sideborder_open
**Shared:** cpu_every_line
Both need every CPU cycle on every raster line they cover; they cannot share a raster line. Raster bands: dysp_side_border_sprites holds lines 40-200; sideborder_open's lines are chosen by the program (movable). Only two stated, disjoint line bands clear this rule.
**Resolution:** Give each its own band of lines and switch between them in the border.

## cpu_vs_irq (hard): dysp_side_border_sprites × sideborder_open
**Shared:** cpu_every_line, midframe_raster_irqs
sideborder_open needs every CPU cycle on its lines; a raster interrupt from dysp_side_border_sprites inside that region breaks its cycle count. Raster bands: dysp_side_border_sprites holds lines 40-200; sideborder_open's lines are chosen by the program (movable). Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep dysp_side_border_sprites's interrupts on lines outside sideborder_open's region (the borders, or a separate band).

## shared_register (soft): dysp_side_border_sprites × sideborder_open
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): dysp_side_border_sprites × soft_scroll_h
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sideborder_open × soft_scroll_h
**Shared:** SCROLX
Both techniques touch register(s) SCROLX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## prerequisite_conflict (hard): dysp_side_border_sprites × sideborder_open
**Via prerequisite(s):** stable_raster_irq
**Rule:** cpu_vs_irq
**Shared:** cpu_every_line, midframe_raster_irqs
dysp_side_border_sprites requires stable_raster_irq. sideborder_open needs every CPU cycle on its lines; a raster interrupt from stable_raster_irq inside that region breaks its cycle count. Raster bands: stable_raster_irq states no raster band; sideborder_open's lines are chosen by the program (movable). Only two stated, disjoint line bands clear this rule.
**Resolution:** Keep stable_raster_irq's interrupts on lines outside sideborder_open's region (the borders, or a separate band).


## Shared Infrastructure (info)
- **double_irq** (prerequisite, not in the set): required by dysp_side_border_sprites, sideborder_open; included in the check as implied. Set it up first.
- **pal_ntsc_detection** (prerequisite, not in the set): required by dysp_side_border_sprites; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sid_play_routine_pattern; included in the check as implied. Set it up first.
- **stable_raster_irq** (prerequisite, not in the set): required by dysp_side_border_sprites; included in the check as implied. Set it up first.
- **DC0D** (Register) shared via recipe(s): kickassembler-cracktro-template
- **BGCOL0** (Register) shared via recipe(s): kickassembler-cracktro-template
- **EXTCOL** (Register) shared via recipe(s): kickassembler-cracktro-template
- **IRQMSK** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-dysp
- **VICIRQ** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-dysp
- **VMCSB** (Register) shared via recipe(s): kickassembler-cracktro-template
- **SCROLX** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-dysp
- **RASTER** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-dysp
- **SCROLY** (Register) shared via recipe(s): kickassembler-cracktro-template, kickassembler-dysp
- **SIGVOL** (Register) shared via recipe(s): kickassembler-cracktro-template
- **DC00** (Register) shared via recipe(s): kickassembler-cracktro-template
- **DC0E** (Register) shared via recipe(s): kickassembler-dysp
- **DC05** (Register) shared via recipe(s): kickassembler-dysp
- **DC04** (Register) shared via recipe(s): kickassembler-dysp
- **SP3COL** (Register) shared via recipe(s): kickassembler-dysp
- **SP2COL** (Register) shared via recipe(s): kickassembler-dysp
- **SP1COL** (Register) shared via recipe(s): kickassembler-dysp
- **SP0COL** (Register) shared via recipe(s): kickassembler-dysp
- **XXPAND** (Register) shared via recipe(s): kickassembler-dysp
- **SPMC** (Register) shared via recipe(s): kickassembler-dysp
- **YXPAND** (Register) shared via recipe(s): kickassembler-dysp
- **SPENA** (Register) shared via recipe(s): kickassembler-dysp
- **MSIGX** (Register) shared via recipe(s): kickassembler-dysp
- **M3Y** (Register) shared via recipe(s): kickassembler-dysp
- **M3X** (Register) shared via recipe(s): kickassembler-dysp
- **M2Y** (Register) shared via recipe(s): kickassembler-dysp
- **M2X** (Register) shared via recipe(s): kickassembler-dysp
- **M1Y** (Register) shared via recipe(s): kickassembler-dysp
- **M1X** (Register) shared via recipe(s): kickassembler-dysp
- **M0Y** (Register) shared via recipe(s): kickassembler-dysp
- **M0X** (Register) shared via recipe(s): kickassembler-dysp
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

```text
# Compatibility: fire_effect + screen_dissolve_lfsr + colour_fade + sid_play_routine_pattern

**Verdict:** WARNINGS

Checked with 2 implied prerequisite(s): lfsr_random, sid_voice_setup.

Unit claims are stated for 1 of 4 techniques; a unit conflict cannot be ruled out for: fire_effect, screen_dissolve_lfsr, colour_fade, sid_voice_setup (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## shared_register (soft): fire_effect × colour_fade
**Shared:** BGCOL0, EXTCOL
Both techniques touch register(s) BGCOL0, EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_dissolve_lfsr × colour_fade
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## prerequisite_conflict (info): fire_effect × sid_play_routine_pattern
**Via prerequisite(s):** lfsr_random
**Rule:** init_order
**Shared:** sid_filter_volume, sid_voice_3
fire_effect requires lfsr_random. lfsr_random uses sid_filter_volume, sid_voice_3 once at start-up; sid_play_routine_pattern then uses it every frame.
**Resolution:** Run lfsr_random's use before sid_play_routine_pattern starts.

## prerequisite_conflict (info): screen_dissolve_lfsr × sid_play_routine_pattern
**Via prerequisite(s):** lfsr_random
**Rule:** init_order
**Shared:** sid_filter_volume, sid_voice_3
screen_dissolve_lfsr requires lfsr_random. lfsr_random uses sid_filter_volume, sid_voice_3 once at start-up; sid_play_routine_pattern then uses it every frame.
**Resolution:** Run lfsr_random's use before sid_play_routine_pattern starts.


## Shared Infrastructure (info)
- **lfsr_random** (prerequisite, not in the set): required by fire_effect, screen_dissolve_lfsr; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sid_play_routine_pattern; included in the check as implied. Set it up first.
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

```text
# Compatibility: sprites_only_screen_mode + vector_balls_sprites + raster_bars + sid_play_routine_pattern

**Verdict:** INCOMPATIBLE — not as combined; each hard conflict below says how to separate them.

Checked with 4 implied prerequisite(s): dot_3d_rotator, fixed_point_8_8, sid_voice_setup, topbottom_border_open.

Unit claims are stated for 3 of 4 techniques; a unit conflict cannot be ruled out for: vector_balls_sprites, dot_3d_rotator (prerequisite), fixed_point_8_8 (prerequisite), sid_voice_setup (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## shared_register (soft): sprites_only_screen_mode × vector_balls_sprites
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): sprites_only_screen_mode × raster_bars
**Shared:** vic_raster_irq
Both sprites_only_screen_mode and raster_bars own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## shared_register (soft): sprites_only_screen_mode × raster_bars
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): vector_balls_sprites × raster_bars
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.


## Not covered
- **fixed_point_8_8** (prerequisite of vector_balls_sprites): the graph has no registers, KERNAL routines or demands for it.

## Shared Infrastructure (info)
- **dot_3d_rotator** (prerequisite, not in the set): required by vector_balls_sprites; included in the check as implied. Set it up first.
- **fixed_point_8_8** (prerequisite, not in the set): required by vector_balls_sprites; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sid_play_routine_pattern; included in the check as implied. Set it up first.
- **topbottom_border_open** (prerequisite, not in the set): required by sprites_only_screen_mode; included in the check as implied. Set it up first.
- **DC0D** (Register) shared via recipe(s): kickassembler-cracktro-template
- **BGCOL0** (Register) shared via recipe(s): kickassembler-cracktro-template
- **EXTCOL** (Register) shared via recipe(s): kickassembler-cracktro-template
- **IRQMSK** (Register) shared via recipe(s): kickassembler-cracktro-template
- **VICIRQ** (Register) shared via recipe(s): kickassembler-cracktro-template
- **VMCSB** (Register) shared via recipe(s): kickassembler-cracktro-template
- **SCROLX** (Register) shared via recipe(s): kickassembler-cracktro-template
- **RASTER** (Register) shared via recipe(s): kickassembler-cracktro-template
- **SCROLY** (Register) shared via recipe(s): kickassembler-cracktro-template
- **SIGVOL** (Register) shared via recipe(s): kickassembler-cracktro-template
- **DC00** (Register) shared via recipe(s): kickassembler-cracktro-template
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

## Budget

Command: `npx tsx src/cli.ts plan-budget tech_tech_wobbler sprite_border_scroller twister vector_balls_sprites dysp_side_border_sprites sideborder_open soft_scroll_h fire_effect screen_dissolve_lfsr colour_fade sprites_only_screen_mode raster_bars sid_play_routine_pattern stable_raster_irq topbottom_border_open irq_chain_table --region both`,
on the same techniques as check-compatibility.

```text
# Budget plan: undetermined

Techniques: tech_tech_wobbler, sprite_border_scroller, twister, vector_balls_sprites, dysp_side_border_sprites, sideborder_open, soft_scroll_h, fire_effect, screen_dissolve_lfsr, colour_fade, sprites_only_screen_mode, raster_bars, sid_play_routine_pattern, stable_raster_irq, topbottom_border_open, irq_chain_table

## play (PAL, 19656 cycles a frame): undetermined

Range 37207-38206 + 258 fixed cycles; floor 10401; weakest basis estimated; IRQ slots 29.

Summed:
- tech_tech_wobbler: 5446 (measured-vice, on kickassembler-tech-tech (the band interrupt, 3,405 cycles from irq1's entry on line 109 to the register restore after line 162, plus the table build of 2,041 in the vertical blank, PAL, screen on, the band's own forced badline stalls inside the figure; the NTSC band is 3,508; bytes_code is the code segment reported by -showmem, almost all of it the two unrolled bands; bytes_data the 384 bytes of tables and the eight 1,000-byte matrices; zp_bytes the two 48-byte register tables and the phase))
- sprite_border_scroller: 829-1586 (measured-vice, on kickassembler-sprite-border-scroller (both handlers' brackets summed per frame, above the display; worst frame is a real hand-off frame, typical is 182 of 300 frames))
- twister: 13561 (measured-vice, on kickassembler-twister (worst display-on frame, PAL, 128 lines of 8 bytes copied through a pointer; the blanked frame is 13,001 and the worst NTSC frame 13,819; bytes_code is the code segment reported by -showmem, almost all of it the unrolled copy; bytes_data is the 512-byte phase table))
- vector_balls_sprites: 1318-1389 (measured-vice, on kickassembler-vector-balls (worst is frame 1, the six swaps that settle the start order; typical is frame 300 with no swap; sprites per line is the most balls sharing a raster line over the 300 frames, counted from the tables))
- dysp_side_border_sprites: 10143 (measured-vice, on kickassembler-dysp (the 161-line band at 63 wall cycles a line, every `DEC $D016` traced on cycle 56, plus the CIA-timed table rebuild: 3,570 worst and 3,560 in 254 of 357 frames; the design's largest sprite set on one line is three), band lines × line)
- screen_dissolve_lfsr: 3032-3203 (measured-vice, on kickassembler-screen-dissolve (one frame of 20 cells with its LFSR pulls, the worst and the median of the 50 frames; bytes are the code block less its two captions))
- colour_fade: 400 (estimated, on kickassembler-colour-fade (per step))
- sprites_only_screen_mode: 756 (measured-vice, on kickassembler-sprites-only-screen (five handlers through $0314 with the KERNAL dispatcher, the recipe's meter latch included; 755 on NTSC))
- raster_bars: 990 (estimated, recipe not stated)
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- topbottom_border_open: 132 (arithmetic, on kickassembler-topbottom-border-open (two handlers, without the $EA31 exit))
- irq_chain_table: 273 (estimated, on kickassembler-irq-chain (three empty slots))

Left out:
- sideborder_open: not added, runs inside dysp_side_border_sprites's raster band
- stable_raster_irq: not added, runs inside dysp_side_border_sprites's raster band
- soft_scroll_h: 74041 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-soft-scroll-h)
- fire_effect: 27301 cycles, above one frame: a multi-frame operation, not summed (measured on kickassembler-fire-effect)

Notes:
- Fixed losses 258 cycles (badlines 6 × 43 = 258, lines 51-243 every eighth with YSCROLL 3; the 19 inside dysp_side_border_sprites's band are in its charge; arithmetic) charged because tech_tech_wobbler, sprite_border_scroller, twister, vector_balls_sprites, screen_dissolve_lfsr, colour_fade, sprites_only_screen_mode, raster_bars, sid_play_routine_pattern, topbottom_border_open, irq_chain_table are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- The low end, 37207 + 258, passes the 19656-cycle frame, but it is not a floor: the figures of tech_tech_wobbler, sprite_border_scroller, twister, vector_balls_sprites, screen_dissolve_lfsr, colour_fade, sprites_only_screen_mode, raster_bars, sid_play_routine_pattern, topbottom_border_open, irq_chain_table are a common frame or a real run's worst, and those frames need not fall together. tech_tech_wobbler, twister, colour_fade, sprites_only_screen_mode, raster_bars, sid_play_routine_pattern, topbottom_border_open, irq_chain_table have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 10401 and fits. A frame measured whole, with every member running, would settle it.
- Multi-frame: soft_scroll_h (74041), fire_effect (27301) are above one PAL frame of 19656 and not summed; spread the work over frames or budget it as its own phase.

## play (NTSC, 17095 cycles a frame): undetermined

Range 37529-38528 + 258 fixed cycles; floor 10723; weakest basis estimated; IRQ slots 29.

Summed:
- tech_tech_wobbler: 5446 (measured-vice, on kickassembler-tech-tech (the band interrupt, 3,405 cycles from irq1's entry on line 109 to the register restore after line 162, plus the table build of 2,041 in the vertical blank, PAL, screen on, the band's own forced badline stalls inside the figure; the NTSC band is 3,508; bytes_code is the code segment reported by -showmem, almost all of it the two unrolled bands; bytes_data the 384 bytes of tables and the eight 1,000-byte matrices; zp_bytes the two 48-byte register tables and the phase))
- sprite_border_scroller: 829-1586 (measured-vice, on kickassembler-sprite-border-scroller (both handlers' brackets summed per frame, above the display; worst frame is a real hand-off frame, typical is 182 of 300 frames))
- twister: 13561 (measured-vice, on kickassembler-twister (worst display-on frame, PAL, 128 lines of 8 bytes copied through a pointer; the blanked frame is 13,001 and the worst NTSC frame 13,819; bytes_code is the code segment reported by -showmem, almost all of it the unrolled copy; bytes_data is the 512-byte phase table))
- vector_balls_sprites: 1318-1389 (measured-vice, on kickassembler-vector-balls (worst is frame 1, the six swaps that settle the start order; typical is frame 300 with no swap; sprites per line is the most balls sharing a raster line over the 300 frames, counted from the tables))
- dysp_side_border_sprites: 10465 (measured-vice, on kickassembler-dysp (the 161-line band at 63 wall cycles a line, every `DEC $D016` traced on cycle 56, plus the CIA-timed table rebuild: 3,570 worst and 3,560 in 254 of 357 frames; the design's largest sprite set on one line is three), band lines × line)
- screen_dissolve_lfsr: 3032-3203 (measured-vice, on kickassembler-screen-dissolve (one frame of 20 cells with its LFSR pulls, the worst and the median of the 50 frames; bytes are the code block less its two captions))
- colour_fade: 400 (estimated, on kickassembler-colour-fade (per step))
- sprites_only_screen_mode: 756 (measured-vice, on kickassembler-sprites-only-screen (five handlers through $0314 with the KERNAL dispatcher, the recipe's meter latch included; 755 on NTSC))
- raster_bars: 990 (estimated, recipe not stated)
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- topbottom_border_open: 132 (arithmetic, on kickassembler-topbottom-border-open (two handlers, without the $EA31 exit))
- irq_chain_table: 273 (estimated, on kickassembler-irq-chain (three empty slots))

Left out:
- sideborder_open: not added, runs inside dysp_side_border_sprites's raster band
- stable_raster_irq: not added, runs inside dysp_side_border_sprites's raster band
- soft_scroll_h: 74041 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-soft-scroll-h)
- fire_effect: 27301 cycles, above one frame: a multi-frame operation, not summed (measured on kickassembler-fire-effect)

Notes:
- Fixed losses 258 cycles (badlines 6 × 43 = 258, lines 51-243 every eighth with YSCROLL 3; the 19 inside dysp_side_border_sprites's band are in its charge; arithmetic) charged because tech_tech_wobbler, sprite_border_scroller, twister, vector_balls_sprites, screen_dissolve_lfsr, colour_fade, sprites_only_screen_mode, raster_bars, sid_play_routine_pattern, topbottom_border_open, irq_chain_table are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- The low end, 37529 + 258, passes the 17095-cycle frame, but it is not a floor: the figures of tech_tech_wobbler, sprite_border_scroller, twister, vector_balls_sprites, screen_dissolve_lfsr, colour_fade, sprites_only_screen_mode, raster_bars, sid_play_routine_pattern, topbottom_border_open, irq_chain_table are a common frame or a real run's worst, and those frames need not fall together. tech_tech_wobbler, twister, colour_fade, sprites_only_screen_mode, raster_bars, sid_play_routine_pattern, topbottom_border_open, irq_chain_table have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 10723 and fits. A frame measured whole, with every member running, would settle it.
- Multi-frame: soft_scroll_h (74041), fire_effect (27301) are above one NTSC frame of 17095 and not summed; spread the work over frames or budget it as its own phase.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

Sum 25585 over tech_tech_wobbler, twister, fire_effect, screen_dissolve_lfsr, colour_fade, raster_bars; a floor, since sprite_border_scroller, vector_balls_sprites, dysp_side_border_sprites, sideborder_open, soft_scroll_h, sprites_only_screen_mode, sid_play_routine_pattern, stable_raster_irq, topbottom_border_open, irq_chain_table state no bytes.

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
```

The whole-set sum is not a frame this demo ever runs; each part's budget is:

```text
# Budget plan: fits

Techniques: tech_tech_wobbler, sprite_border_scroller, sid_play_routine_pattern, stable_raster_irq, topbottom_border_open

## play (PAL, 19656 cycles a frame): fits

Range 6858-7615 + 1075 fixed cycles; floor 1075; weakest basis arithmetic; IRQ slots 9.

Summed:
- tech_tech_wobbler: 5446 (measured-vice, on kickassembler-tech-tech (the band interrupt, 3,405 cycles from irq1's entry on line 109 to the register restore after line 162, plus the table build of 2,041 in the vertical blank, PAL, screen on, the band's own forced badline stalls inside the figure; the NTSC band is 3,508; bytes_code is the code segment reported by -showmem, almost all of it the two unrolled bands; bytes_data the 384 bytes of tables and the eight 1,000-byte matrices; zp_bytes the two 48-byte register tables and the phase))
- sprite_border_scroller: 829-1586 (measured-vice, on kickassembler-sprite-border-scroller (both handlers' brackets summed per frame, above the display; worst frame is a real hand-off frame, typical is 182 of 300 frames))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- stable_raster_irq: 124 (arithmetic, recipe not stated)
- topbottom_border_open: 132 (arithmetic, on kickassembler-topbottom-border-open (two handlers, without the $EA31 exit))

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because tech_tech_wobbler, sprite_border_scroller, sid_play_routine_pattern, stable_raster_irq, topbottom_border_open are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.

## play (NTSC, 17095 cycles a frame): fits

Range 6858-7615 + 1075 fixed cycles; floor 1075; weakest basis arithmetic; IRQ slots 9.

Summed:
- tech_tech_wobbler: 5446 (measured-vice, on kickassembler-tech-tech (the band interrupt, 3,405 cycles from irq1's entry on line 109 to the register restore after line 162, plus the table build of 2,041 in the vertical blank, PAL, screen on, the band's own forced badline stalls inside the figure; the NTSC band is 3,508; bytes_code is the code segment reported by -showmem, almost all of it the two unrolled bands; bytes_data the 384 bytes of tables and the eight 1,000-byte matrices; zp_bytes the two 48-byte register tables and the phase))
- sprite_border_scroller: 829-1586 (measured-vice, on kickassembler-sprite-border-scroller (both handlers' brackets summed per frame, above the display; worst frame is a real hand-off frame, typical is 182 of 300 frames))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- stable_raster_irq: 124 (arithmetic, recipe not stated)
- topbottom_border_open: 132 (arithmetic, on kickassembler-topbottom-border-open (two handlers, without the $EA31 exit))

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because tech_tech_wobbler, sprite_border_scroller, sid_play_routine_pattern, stable_raster_irq, topbottom_border_open are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

Sum 10722 over tech_tech_wobbler; a floor, since sprite_border_scroller, sid_play_routine_pattern, stable_raster_irq, topbottom_border_open state no bytes.

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
```

```text
# Budget plan: fits

Techniques: twister, vector_balls_sprites, sid_play_routine_pattern

## play (PAL, 19656 cycles a frame): fits

Range 15206-15277 + 1075 fixed cycles; floor 1075; weakest basis measured-vice; IRQ slots 1.

Summed:
- twister: 13561 (measured-vice, on kickassembler-twister (worst display-on frame, PAL, 128 lines of 8 bytes copied through a pointer; the blanked frame is 13,001 and the worst NTSC frame 13,819; bytes_code is the code segment reported by -showmem, almost all of it the unrolled copy; bytes_data is the 512-byte phase table))
- vector_balls_sprites: 1318-1389 (measured-vice, on kickassembler-vector-balls (worst is frame 1, the six swaps that settle the start order; typical is frame 300 with no swap; sprites per line is the most balls sharing a raster line over the 300 frames, counted from the tables))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because twister, vector_balls_sprites, sid_play_routine_pattern are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.

## play (NTSC, 17095 cycles a frame): fits

Range 15206-15277 + 1075 fixed cycles; floor 1075; weakest basis measured-vice; IRQ slots 1.

Summed:
- twister: 13561 (measured-vice, on kickassembler-twister (worst display-on frame, PAL, 128 lines of 8 bytes copied through a pointer; the blanked frame is 13,001 and the worst NTSC frame 13,819; bytes_code is the code segment reported by -showmem, almost all of it the unrolled copy; bytes_data is the 512-byte phase table))
- vector_balls_sprites: 1318-1389 (measured-vice, on kickassembler-vector-balls (worst is frame 1, the six swaps that settle the start order; typical is frame 300 with no swap; sprites per line is the most balls sharing a raster line over the 300 frames, counted from the tables))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because twister, vector_balls_sprites, sid_play_routine_pattern are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

Sum 9895 over twister; a floor, since vector_balls_sprites, sid_play_routine_pattern state no bytes.

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
```

```text
# Budget plan: undetermined

Techniques: dysp_side_border_sprites, sideborder_open, soft_scroll_h, sid_play_routine_pattern

## play (PAL, 19656 cycles a frame): undetermined

Range 10470 + 258 fixed cycles; floor 10401; weakest basis measured-vice; IRQ slots 4.

Summed:
- dysp_side_border_sprites: 10143 (measured-vice, on kickassembler-dysp (the 161-line band at 63 wall cycles a line, every `DEC $D016` traced on cycle 56, plus the CIA-timed table rebuild: 3,570 worst and 3,560 in 254 of 357 frames; the design's largest sprite set on one line is three), band lines × line)
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))

Left out:
- sideborder_open: not added, runs inside dysp_side_border_sprites's raster band
- soft_scroll_h: 74041 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-soft-scroll-h)

Notes:
- Fixed losses 258 cycles (badlines 6 × 43 = 258, lines 51-243 every eighth with YSCROLL 3; the 19 inside dysp_side_border_sprites's band are in its charge; arithmetic) charged because sid_play_routine_pattern is not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Multi-frame: soft_scroll_h (74041) is above one PAL frame of 19656 and not summed; spread the work over frames or budget it as its own phase.

## play (NTSC, 17095 cycles a frame): undetermined

Range 10792 + 258 fixed cycles; floor 10723; weakest basis measured-vice; IRQ slots 4.

Summed:
- dysp_side_border_sprites: 10465 (measured-vice, on kickassembler-dysp (the 161-line band at 63 wall cycles a line, every `DEC $D016` traced on cycle 56, plus the CIA-timed table rebuild: 3,570 worst and 3,560 in 254 of 357 frames; the design's largest sprite set on one line is three), band lines × line)
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))

Left out:
- sideborder_open: not added, runs inside dysp_side_border_sprites's raster band
- soft_scroll_h: 74041 cycles, above one frame: a multi-frame operation, not summed (measured on oscar64-soft-scroll-h)

Notes:
- Fixed losses 258 cycles (badlines 6 × 43 = 258, lines 51-243 every eighth with YSCROLL 3; the 19 inside dysp_side_border_sprites's band are in its charge; arithmetic) charged because sid_play_routine_pattern is not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Multi-frame: soft_scroll_h (74041) is above one NTSC frame of 17095 and not summed; spread the work over frames or budget it as its own phase.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

No member states a byte figure that can be summed.

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
```

```text
# Budget plan: undetermined

Techniques: fire_effect, screen_dissolve_lfsr, colour_fade, sid_play_routine_pattern

## play (PAL, 19656 cycles a frame): undetermined

Range 3759-3930 + 1075 fixed cycles; floor 1075; weakest basis estimated; IRQ slots 1.

Summed:
- screen_dissolve_lfsr: 3032-3203 (measured-vice, on kickassembler-screen-dissolve (one frame of 20 cells with its LFSR pulls, the worst and the median of the 50 frames; bytes are the code block less its two captions))
- colour_fade: 400 (estimated, on kickassembler-colour-fade (per step))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))

Left out:
- fire_effect: 27301 cycles, above one frame: a multi-frame operation, not summed (measured on kickassembler-fire-effect)

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because screen_dissolve_lfsr, colour_fade, sid_play_routine_pattern are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Multi-frame: fire_effect (27301) is above one PAL frame of 19656 and not summed; spread the work over frames or budget it as its own phase.

## play (NTSC, 17095 cycles a frame): undetermined

Range 3759-3930 + 1075 fixed cycles; floor 1075; weakest basis estimated; IRQ slots 1.

Summed:
- screen_dissolve_lfsr: 3032-3203 (measured-vice, on kickassembler-screen-dissolve (one frame of 20 cells with its LFSR pulls, the worst and the median of the 50 frames; bytes are the code block less its two captions))
- colour_fade: 400 (estimated, on kickassembler-colour-fade (per step))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))

Left out:
- fire_effect: 27301 cycles, above one frame: a multi-frame operation, not summed (measured on kickassembler-fire-effect)

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because screen_dissolve_lfsr, colour_fade, sid_play_routine_pattern are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Multi-frame: fire_effect (27301) is above one NTSC frame of 17095 and not summed; spread the work over frames or budget it as its own phase.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

Sum 4368 over fire_effect, screen_dissolve_lfsr, colour_fade; a floor, since sid_play_routine_pattern state no bytes.

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
```

```text
# Budget plan: fits

Techniques: sprites_only_screen_mode, vector_balls_sprites, raster_bars, sid_play_routine_pattern

## play (PAL, 19656 cycles a frame): fits

Range 3391-3462 + 1075 fixed cycles; floor 1075; weakest basis estimated; IRQ slots 16.

Summed:
- sprites_only_screen_mode: 756 (measured-vice, on kickassembler-sprites-only-screen (five handlers through $0314 with the KERNAL dispatcher, the recipe's meter latch included; 755 on NTSC))
- vector_balls_sprites: 1318-1389 (measured-vice, on kickassembler-vector-balls (worst is frame 1, the six swaps that settle the start order; typical is frame 300 with no swap; sprites per line is the most balls sharing a raster line over the 300 frames, counted from the tables))
- raster_bars: 990 (estimated, recipe not stated)
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because sprites_only_screen_mode, vector_balls_sprites, raster_bars, sid_play_routine_pattern are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.

## play (NTSC, 17095 cycles a frame): fits

Range 3391-3462 + 1075 fixed cycles; floor 1075; weakest basis estimated; IRQ slots 16.

Summed:
- sprites_only_screen_mode: 756 (measured-vice, on kickassembler-sprites-only-screen (five handlers through $0314 with the KERNAL dispatcher, the recipe's meter latch included; 755 on NTSC))
- vector_balls_sprites: 1318-1389 (measured-vice, on kickassembler-vector-balls (worst is frame 1, the six swaps that settle the start order; typical is frame 300 with no swap; sprites per line is the most balls sharing a raster line over the 300 frames, counted from the tables))
- raster_bars: 990 (estimated, recipe not stated)
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because sprites_only_screen_mode, vector_balls_sprites, raster_bars, sid_play_routine_pattern are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

Sum 600 over raster_bars; a floor, since sprites_only_screen_mode, vector_balls_sprites, sid_play_routine_pattern state no bytes.

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
```

The frame meter measures the real figure once the loop runs: worst, and
typical as the median of the autopilot's play frames. Record both here with
the model and the command (`make shot check` prints them).

Unknown in the budget: the music player's real cost (the tool's 327 cycles is
a stub tune's; the extended player with three voices and an order list is
measured by its own bracket and printed on the end screen); soft_scroll_h has
no Cost line (its per-frame work is a 40-byte row shift every eighth frame plus
a $D016 write, measured by part 3's bracket); part 4's fire is above one frame
by design (its half-screen pass is 27,301 cycles measured) and runs in the main
loop under a music interrupt, so its "frame" is four frames. Each part's own
CIA1 bracket (worst and typical) is printed on the end screen and the harness
meter covers part 5's first 200 frames. Meter figures: to be recorded here
after the first `make shot check`.

## Memory and screen

See DESIGN.md, "Memory": sequencer and shared routines $0810-$0FFF, music
$1000-$1FFF, part data in VIC bank 0 ($2000-$3FFF, $3FFF = 0) and bank 1
($4000-$7FFF, part 2), part code at $8000-$9FFF (parts 1 to 3) and
$C000-$CFFF (parts 4 and 5). In AUTOPILOT builds the harness meter owns
screen row 24, columns 20 to 39, on the end screen in the power-on character
set; CIA2 timer A belongs to the meter; CIA1 timer A is each part's own
stopwatch.

## Autopilot and checks

No input: the demo is deterministic and runs to its tune. The AUTOPILOT build
adds the harness meter and the grading; at the end screen the sequencer ANDs
the five parts' selfcheck results (each a register or table or screen cell read
back, as the recipes grade themselves), prints PARTS n/5, each part's worst and
typical cycles, the meter readout on row 24, and stores $02FF = $01 with a
green border, or $02 and red. FORCE_FAULT poisons part 2's depth table so its
selfcheck fails and a far ball is drawn over a near one. expect.json grades the
end screen (verdict, the PARTS line, the meter with frames 200, a same area);
expect-p1.json to expect-p5.json grade one pinned picture per part inside its
dwell (a rect, sprite or text check per feature), run by verify.sh.

## Decisions and open questions

- Music is the KB's own player from sfx-in-player, extended with an order
  list, not a GoatTracker export: the GoatTracker player is GPL and this demo
  is meant to be publishable under the repository's licence.
- The tune runs 1.2 times faster on NTSC (one call per frame on both models);
  accepted and stated; the parts' end positions are the same order indices on
  both, so NTSC runs shorter.
- Open: whether the sprites-only part's sprite DMA lines and the sequencer's
  line-255 interrupt coexist without the music call jittering more than the
  music_continuity pattern allows (5 to 10 percent); measured by the sequencer's
  own play-call spacing log.
