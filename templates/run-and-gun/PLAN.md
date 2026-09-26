# Plan: run-and-gun (FIREBASE)

The first playable slice of a vertical run-and-gun starter, built from the
knowledge base only. The tool output below was produced on 2026-09-26 by
c64-kb 0.29.0 (KB data 843) against the branch's own graph
(`FALKOR_GRAPH=c64_rg QDRANT_COLLECTION=c64_docs_rg`), and pasted whole.
Where the KB was wrong, missing or misleading, `KB-GAPS.md` says so.

## Concept

A soldier on foot fights up a jungle map to a fort's gate. The screen scrolls
only while he pushes past a line in the middle, one pixel a frame, never
back. He walks in eight directions; trees, rocks and sandbag walls stop him,
and he passes under tree canopies, which draw over him. A three-row panel
under a black band holds SCORE, LIVES and GRENADES. PAL and NTSC.

This slice is the skeleton: the scroll, the redraw, the band and panel, the
multiplexer with parked slots, and the soldier. Enemies, weapons, collisions,
game flow and audio come next, each in its own module (below, "Modules").

## Briefing

Command: `node src/cli.ts game-briefing "vertical run and gun: a soldier on foot walks up a jungle map that scrolls down over a fixed score panel, 8-way movement, trees and walls block him, canopy draws over him, enemies from map rows through a sprite multiplexer, bullets along his facing, grenades lobbed, checkpoints, a gate at the area end, sound effects over a SID tune" --archetype vertical_run_and_gun`

It proposed 20 techniques: the archetype's fingerprint of 15 and five from
words in the brief. What this plan did with them:

- Kept, the whole fingerprint: `threshold_scroll_v`, `row_map_redraw`,
  `soft_scroll_v`, `invalid_mode_band`, `sprite_multiplex_game`,
  `sprite_slot_parking`, `object_pool`, `wave_director`,
  `char_attribute_flags`, `facing_turn_step`, `grenade_lob`,
  `checkpoint_respawn`, `area_end_gate_wave`, `sfx_voice_takeover`,
  `frame_sync_loop`.
- Added: `per_frame_hitbox` (it proposed it for the word "draw"; kept for
  the right reason: boxes between shots and enemies, which the fingerprint
  has no technique for).
- Dropped: `raycaster_grid_walls` (the word "walls"), `tile_map_render`
  (the word "map"; this map is raw screen codes, no tiles),
  `relocated_code_block` (the words "run" and "block"),
  `multi_sprite_object` (the soldier is one sprite). Brief words, not needs
  (KB-GAPS.md).
- Taken as they stand: its alternatives (invalid_mode_band over
  scroll_panel_split, row_map_redraw over char_scroll_buffer_v) and its
  toolchain split (Oscar64 primary; KickAssembler for invalid_mode_band,
  sprite_multiplex_game, sprite_slot_parking). The redraw is KickAssembler
  too: 14 cycles a byte needs the recipe's patched loop.
- Pitfalls it named that this program meets: `badline_cycle_loss`,
  `sprite_dma_overflow`, `decimal_mode_in_irq_handler`,
  `ecm_with_mcm_set_is_invalid_black_mode`, `raster_irq_first_line_jitter`,
  `raster_poll_equality_misses_under_dispatch_latency`,
  `irq_during_charen_window`, `sprite_x_high_bit_wrong_register`,
  `sprite_x_range_hidden_and_seam`, `vic_bank_visibility_collision`,
  `petscii_written_to_screen_ram`, `cia1_ddr_cleared_kills_keyboard`,
  `d012_wrap_around`, `raster_line_count_difference`,
  `sprite_registers_persist_across_state_change`, `sid_adsr_bug_8580`,
  `pal_ntsc_tempo_mismatch` (the last two for the audio module).

## Techniques

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| threshold_scroll_v | the view moves only when the soldier pushes past sprite Y 110 | kickassembler-threshold-scroll-v | badline_cycle_loss, d012_wrap_around, raster_line_count_difference (the rest it lists are FPP and linecrunch, reached through SCROLY: KB-GAPS.md) |
| row_map_redraw | the coarse step redraws 21 rows from the raw map, on the frame YSCROLL wraps | kickassembler-row-map-redraw | badline_cycle_loss, sei_in_main_spans_band_entry_line, scroll_phase_breaks_panel_split |
| soft_scroll_v | one line a step through YSCROLL 0-7 | kickassembler-row-map-redraw | full_field_redraw_exceeds_vblank, badline_cycle_loss |
| invalid_mode_band | nine black lines over the panel; the panel's stores get windows, not cycles | kickassembler-invalid-mode-band | ecm_with_mcm_set_is_invalid_black_mode, irq_during_charen_window, raster_poll_equality_misses_under_dispatch_latency, vic_bank_visibility_collision, petscii_written_to_screen_ram |
| sprite_multiplex_game | 16 slots on 8 sprites: sort, double-buffered table, zones, late guard | kickassembler-sprite-multiplex-game (as shmup-vertical's mux.asm) | sprite_dma_overflow, decimal_mode_in_irq_handler, sprite_x_high_bit_wrong_register, irq_row_armed_after_beam_passed |
| sprite_slot_parking | a free slot is data (blank block, X 356, Y 255), never tested in the IRQs | kickassembler-sprite-slot-parking | sprite_dma_overflow, sprite_registers_persist_across_state_change |
| object_pool | eleven pool slots for enemies, their shots and explosions (objects.c) | oscar64-object-pool | sprite_x_range_hidden_and_seam |
| wave_director | spawns keyed to map rows, fired as the view's top row reaches them (objects_rows) | oscar64-wave-director | sprite_x_high_bit_wrong_register |
| char_attribute_flags | attr[screen code]: bit 0 blocks, bit 1 draws behind, bit 2 kills | kickassembler-char-attribute-flags | sprite_registers_persist_across_state_change |
| facing_turn_step | a 16-step facing that turns one step a frame; the body frame is facing / 2 | kickassembler-facing-turn-step | cia1_ddr_cleared_kills_keyboard, joystick2_scan_phantom_press |
| grenade_lob | the weapons module: a straight throw, a height animation, a box blast | kickassembler-grenade-lob | none found (`pitfalls-for` answers nothing) |
| checkpoint_respawn | the flow module: restart rows per area | kickassembler-checkpoint-respawn | none found (`pitfalls-for` finds no entity: KB-GAPS.md) |
| area_end_gate_wave | the flow module: the scroll's stop, a counted wave, the walk into the gate | kickassembler-area-end-gate-wave | none found |
| sfx_voice_takeover | the audio module: effects take voices 1 and 2, the tune plays on 3 | kickassembler-sfx-voice-takeover | sid_adsr_bug_8580, sid_filter_chip_variation, sid_voice3_disable_silent_bit, sid_write_only_registers |
| frame_sync_loop | the main loop wakes on frame_flag from the line-250 IRQ | oscar64-frame-sync-loop | raster_irq_first_line_jitter, d012_wrap_around, pal_ntsc_tempo_mismatch, cia_timer_phi2_difference |
| per_frame_hitbox | the collision module: boxes per sprite frame | oscar64-per-frame-hitbox | sprite_dma_overflow, sprite_x_high_bit_wrong_register |

## Compatibility

Command: `node src/cli.ts check-compatibility threshold_scroll_v row_map_redraw soft_scroll_v invalid_mode_band sprite_multiplex_game sprite_slot_parking object_pool wave_director char_attribute_flags facing_turn_step grenade_lob checkpoint_respawn area_end_gate_wave sfx_voice_takeover frame_sync_loop per_frame_hitbox`

```text
# Compatibility: threshold_scroll_v + row_map_redraw + soft_scroll_v + invalid_mode_band + sprite_multiplex_game + sprite_slot_parking + object_pool + wave_director + char_attribute_flags + facing_turn_step + grenade_lob + checkpoint_respawn + area_end_gate_wave + sfx_voice_takeover + frame_sync_loop + per_frame_hitbox

**Verdict:** INCOMPATIBLE — not as combined; each hard conflict below says how to separate them.

Checked with 5 implied prerequisite(s): mob_priority, sid_play_routine_pattern, sid_voice_setup, tile_grid_collision, tile_map_render.

Unit claims are stated for 13 of 16 techniques; a unit conflict cannot be ruled out for: object_pool, wave_director, per_frame_hitbox, mob_priority (prerequisite), tile_grid_collision (prerequisite), tile_map_render (prerequisite). Recipes' zero-page bytes and required devices are compared as info (recipe_zero_page_overlap, recipe_device_conflict); the interrupt vector a recipe installs is not, since a combined program installs one handler either way.

## shared_register (soft): threshold_scroll_v × row_map_redraw
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): threshold_scroll_v × soft_scroll_v
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): threshold_scroll_v × invalid_mode_band
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): threshold_scroll_v × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): row_map_redraw × soft_scroll_v
**Shared:** vic_yscroll
soft_scroll_v owns vic_yscroll; row_map_redraw writes it under soft_scroll_v's protocol.
**Resolution:** row_map_redraw must follow soft_scroll_v's protocol: write after soft_scroll_v's write in the frame, or run inside soft_scroll_v's interrupt chain.

## shared_register (soft): row_map_redraw × soft_scroll_v
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): row_map_redraw × invalid_mode_band
**Shared:** vic_yscroll
row_map_redraw and invalid_mode_band both write vic_yscroll under an owner's protocol.
**Resolution:** Both must follow the owner's protocol, and in an order the owner sets: one after the other in the frame, or as successive entries in one interrupt chain.

## shared_register (soft): row_map_redraw × invalid_mode_band
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): row_map_redraw × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): soft_scroll_v × invalid_mode_band
**Shared:** vic_yscroll
soft_scroll_v owns vic_yscroll; invalid_mode_band writes it under soft_scroll_v's protocol.
**Resolution:** invalid_mode_band must follow soft_scroll_v's protocol: write after soft_scroll_v's write in the frame, or run inside soft_scroll_v's interrupt chain.

## shared_register (soft): soft_scroll_v × invalid_mode_band
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): soft_scroll_v × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): invalid_mode_band × sprite_multiplex_game
**Shared:** vic_raster_irq
Both invalid_mode_band and sprite_multiplex_game own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## shared_register (soft): invalid_mode_band × sprite_multiplex_game
**Shared:** RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): invalid_mode_band × sprite_slot_parking
**Shared:** vic_raster_irq
Both invalid_mode_band and sprite_slot_parking own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## shared_register (soft): invalid_mode_band × sprite_slot_parking
**Shared:** RASTER, VICIRQ, IRQMSK
Both techniques touch register(s) RASTER, VICIRQ, IRQMSK. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): invalid_mode_band × frame_sync_loop
**Shared:** vic_raster_irq
invalid_mode_band owns the raster compare; frame_sync_loop runs inside invalid_mode_band's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run frame_sync_loop as the entry of invalid_mode_band's handler or as one more entry in invalid_mode_band's chain, not as a second interrupt setup.

## shared_register (soft): invalid_mode_band × frame_sync_loop
**Shared:** SCROLY, RASTER
Both techniques touch register(s) SCROLY, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): sprite_multiplex_game × sprite_slot_parking
**Shared:** sprite_0-7, vic_raster_irq
Both sprite_multiplex_game and sprite_slot_parking own sprite_0-7, vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it; for the other units, give one technique different ones (another sprite range, another voice).

## shared_register (soft): sprite_multiplex_game × sprite_slot_parking
**Shared:** M0X, M0Y, MSIGX, RASTER, SPENA, VICIRQ, IRQMSK, SP0COL
Both techniques touch register(s) M0X, M0Y, MSIGX, RASTER, SPENA, VICIRQ, IRQMSK, SP0COL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): sprite_multiplex_game × char_attribute_flags
**Shared:** sprite_0-7
sprite_multiplex_game owns sprite_0-7; char_attribute_flags writes it under sprite_multiplex_game's protocol.
**Resolution:** char_attribute_flags must follow sprite_multiplex_game's protocol: write after sprite_multiplex_game's write in the frame, or run inside sprite_multiplex_game's interrupt chain.

## unit_shared (soft): sprite_multiplex_game × frame_sync_loop
**Shared:** vic_raster_irq
sprite_multiplex_game owns the raster compare; frame_sync_loop runs inside sprite_multiplex_game's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run frame_sync_loop as the entry of sprite_multiplex_game's handler or as one more entry in sprite_multiplex_game's chain, not as a second interrupt setup.

## shared_register (soft): sprite_multiplex_game × frame_sync_loop
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_multiplex_game × per_frame_hitbox
**Shared:** MSIGX
Both techniques touch register(s) MSIGX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): sprite_slot_parking × char_attribute_flags
**Shared:** sprite_0-7
sprite_slot_parking owns sprite_0-7; char_attribute_flags writes it under sprite_slot_parking's protocol.
**Resolution:** char_attribute_flags must follow sprite_slot_parking's protocol: write after sprite_slot_parking's write in the frame, or run inside sprite_slot_parking's interrupt chain.

## unit_shared (soft): sprite_slot_parking × frame_sync_loop
**Shared:** vic_raster_irq
sprite_slot_parking owns the raster compare; frame_sync_loop runs inside sprite_slot_parking's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run frame_sync_loop as the entry of sprite_slot_parking's handler or as one more entry in sprite_slot_parking's chain, not as a second interrupt setup.

## shared_register (soft): sprite_slot_parking × frame_sync_loop
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_slot_parking × per_frame_hitbox
**Shared:** MSIGX
Both techniques touch register(s) MSIGX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## recipe_zero_page_overlap (info): threshold_scroll_v × sprite_multiplex_game
**Shared:** $02-$08, $0E
Recipes that build them own the same zero-page bytes: kickassembler-threshold-scroll-v and kickassembler-sprite-multiplex-game ($02-$08, $0E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): threshold_scroll_v × object_pool
**Shared:** $02-$08, $0E
Recipes that build them own the same zero-page bytes: kickassembler-threshold-scroll-v and kickassembler-area-end-gate-wave ($02-$08, $0E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): threshold_scroll_v × facing_turn_step
**Shared:** $02-$07, $0E
Recipes that build them own the same zero-page bytes: kickassembler-threshold-scroll-v and kickassembler-facing-turn-step ($02-$07, $0E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): threshold_scroll_v × grenade_lob
**Shared:** $02-$08, $0E
Recipes that build them own the same zero-page bytes: kickassembler-threshold-scroll-v and kickassembler-grenade-lob ($02-$08, $0E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): threshold_scroll_v × area_end_gate_wave
**Shared:** $02-$08, $0E
Recipes that build them own the same zero-page bytes: kickassembler-threshold-scroll-v and kickassembler-area-end-gate-wave ($02-$08, $0E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): soft_scroll_v × sprite_multiplex_game
**Shared:** $02-$08, $0E, $20-$22, $24-$39
Recipes that build them own the same zero-page bytes: kickassembler-eight-way-scroll and kickassembler-sprite-multiplex-game ($20-$22, $24-$39); kickassembler-threshold-scroll-v and kickassembler-sprite-multiplex-game ($02-$08, $0E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): soft_scroll_v × object_pool
**Shared:** $02-$08, $0E
Recipes that build them own the same zero-page bytes: kickassembler-threshold-scroll-v and kickassembler-area-end-gate-wave ($02-$08, $0E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): soft_scroll_v × facing_turn_step
**Shared:** $02-$07, $0E
Recipes that build them own the same zero-page bytes: kickassembler-threshold-scroll-v and kickassembler-facing-turn-step ($02-$07, $0E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): soft_scroll_v × grenade_lob
**Shared:** $02-$08, $0E
Recipes that build them own the same zero-page bytes: kickassembler-threshold-scroll-v and kickassembler-grenade-lob ($02-$08, $0E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): soft_scroll_v × area_end_gate_wave
**Shared:** $02-$08, $0E
Recipes that build them own the same zero-page bytes: kickassembler-threshold-scroll-v and kickassembler-area-end-gate-wave ($02-$08, $0E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): sprite_multiplex_game × object_pool
**Shared:** $02-$1E
Recipes that build them own the same zero-page bytes: kickassembler-sprite-multiplex-game and kickassembler-area-end-gate-wave ($02-$1E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): sprite_multiplex_game × facing_turn_step
**Shared:** $02-$07, $0C-$0F
Recipes that build them own the same zero-page bytes: kickassembler-sprite-multiplex-game and kickassembler-facing-turn-step ($02-$07, $0C-$0F). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): sprite_multiplex_game × grenade_lob
**Shared:** $02-$09, $0E-$14
Recipes that build them own the same zero-page bytes: kickassembler-sprite-multiplex-game and kickassembler-grenade-lob ($02-$09, $0E-$14). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): sprite_multiplex_game × area_end_gate_wave
**Shared:** $02-$1E
Recipes that build them own the same zero-page bytes: kickassembler-sprite-multiplex-game and kickassembler-area-end-gate-wave ($02-$1E). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): object_pool × facing_turn_step
**Shared:** $02-$07, $0C-$0F
Recipes that build them own the same zero-page bytes: kickassembler-area-end-gate-wave and kickassembler-facing-turn-step ($02-$07, $0C-$0F). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): object_pool × grenade_lob
**Shared:** $02-$09, $0E-$14
Recipes that build them own the same zero-page bytes: kickassembler-area-end-gate-wave and kickassembler-grenade-lob ($02-$09, $0E-$14). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): char_attribute_flags × checkpoint_respawn
**Shared:** $FB-$FC
Recipes that build them own the same zero-page bytes: kickassembler-char-attribute-flags and kickassembler-checkpoint-respawn ($FB-$FC). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): facing_turn_step × grenade_lob
**Shared:** $02-$07, $0E-$0F
Recipes that build them own the same zero-page bytes: kickassembler-facing-turn-step and kickassembler-grenade-lob ($02-$07, $0E-$0F). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): facing_turn_step × area_end_gate_wave
**Shared:** $02-$07, $0C-$0F
Recipes that build them own the same zero-page bytes: kickassembler-facing-turn-step and kickassembler-area-end-gate-wave ($02-$07, $0C-$0F). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.

## recipe_zero_page_overlap (info): grenade_lob × area_end_gate_wave
**Shared:** $02-$09, $0E-$14
Recipes that build them own the same zero-page bytes: kickassembler-grenade-lob and kickassembler-area-end-gate-wave ($02-$09, $0E-$14). The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.
**Resolution:** Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.


## Not covered
- **object_pool**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **wave_director**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **tile_grid_collision** (prerequisite of char_attribute_flags): the graph has no registers, KERNAL routines or demands for it.
- **tile_map_render** (prerequisite of char_attribute_flags): the graph has no registers, KERNAL routines or demands for it.

## Shared Infrastructure (info)
- **mob_priority** (prerequisite, not in the set): required by char_attribute_flags; included in the check as implied. Set it up first.
- **sid_play_routine_pattern** (prerequisite, not in the set): required by sfx_voice_takeover; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sfx_voice_takeover; included in the check as implied. Set it up first.
- **tile_grid_collision** (prerequisite, not in the set): required by char_attribute_flags; included in the check as implied. Set it up first.
- **tile_map_render** (prerequisite, not in the set): required by char_attribute_flags; included in the check as implied. Set it up first.
- **DC06** (Register) shared via recipe(s): kickassembler-row-map-redraw, oscar64-platformer-scaffold
- **DC07** (Register) shared via recipe(s): kickassembler-row-map-redraw, oscar64-platformer-scaffold
- **DC0D** (Register) shared via recipe(s): kickassembler-row-map-redraw
- **DC0F** (Register) shared via recipe(s): kickassembler-row-map-redraw, oscar64-platformer-scaffold
- **DD0D** (Register) shared via recipe(s): kickassembler-row-map-redraw
- **SCROLY** (Register) shared via recipe(s): kickassembler-row-map-redraw, oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, oscar64-wave-director
- **RASTER** (Register) shared via recipe(s): kickassembler-row-map-redraw, oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, oscar64-wave-director, kickassembler-area-end-gate-wave
- **SCROLX** (Register) shared via recipe(s): kickassembler-row-map-redraw
- **VMCSB** (Register) shared via recipe(s): kickassembler-row-map-redraw
- **VICIRQ** (Register) shared via recipe(s): kickassembler-row-map-redraw, oscar64-platformer-scaffold
- **IRQMSK** (Register) shared via recipe(s): kickassembler-row-map-redraw, oscar64-platformer-scaffold
- **EXTCOL** (Register) shared via recipe(s): kickassembler-row-map-redraw, oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, oscar64-wave-director, kickassembler-area-end-gate-wave
- **BGCOL0** (Register) shared via recipe(s): kickassembler-row-map-redraw, oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, oscar64-wave-director, kickassembler-area-end-gate-wave
- **DC00** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-area-end-gate-wave
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
- **FRELO1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FREHI1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWLO1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWHI1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VCREG1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **ATDCY1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SUREL1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FRELO2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FREHI2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWLO2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWHI2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VCREG2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **ATDCY2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SUREL2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FRELO3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FREHI3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWLO3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWHI3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VCREG3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **ATDCY3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SUREL3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SIGVOL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **RANDOM** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **M0X** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, oscar64-wave-director, kickassembler-area-end-gate-wave
- **M0Y** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, oscar64-wave-director, kickassembler-area-end-gate-wave
- **MSIGX** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, oscar64-wave-director, kickassembler-area-end-gate-wave
- **SPENA** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, oscar64-wave-director, kickassembler-area-end-gate-wave
- **SP0COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, oscar64-wave-director, kickassembler-area-end-gate-wave
- **SP1COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **SP2COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **SP3COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **SP4COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-area-end-gate-wave
- **SP5COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-area-end-gate-wave
- **SP6COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, kickassembler-area-end-gate-wave
- **DD04** (Register) shared via recipe(s): kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **DD05** (Register) shared via recipe(s): kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **DD0E** (Register) shared via recipe(s): kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **M1X** (Register) shared via recipe(s): kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **M1Y** (Register) shared via recipe(s): kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **M2X** (Register) shared via recipe(s): kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **M2Y** (Register) shared via recipe(s): kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **M3X** (Register) shared via recipe(s): kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **M3Y** (Register) shared via recipe(s): kickassembler-threshold-scroll-v, kickassembler-area-end-gate-wave
- **DC04** (Register) shared via recipe(s): oscar64-wave-director
- **DC05** (Register) shared via recipe(s): oscar64-wave-director
- **DC0E** (Register) shared via recipe(s): oscar64-wave-director
- **M4X** (Register) shared via recipe(s): kickassembler-area-end-gate-wave
- **M4Y** (Register) shared via recipe(s): kickassembler-area-end-gate-wave
- **M5X** (Register) shared via recipe(s): kickassembler-area-end-gate-wave
- **M5Y** (Register) shared via recipe(s): kickassembler-area-end-gate-wave
- **M6X** (Register) shared via recipe(s): kickassembler-area-end-gate-wave
- **M6Y** (Register) shared via recipe(s): kickassembler-area-end-gate-wave
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.

```

What the warnings mean for this program:

- `unit_contention (hard)` invalid_mode_band x sprite_multiplex_game, x
  sprite_slot_parking, and sprite_multiplex_game x sprite_slot_parking, on
  `vic_raster_irq` (and `sprite_0-7`): one chain, as the tool says.
  kernel.asm owns `$D012`: the frame IRQ (line 250) writes the first eight
  sprites and arms the zones, the last zone arms the band IRQ (line 211),
  the band IRQ arms the frame IRQ. sprite_slot_parking is not a second
  multiplexer here: it is the slot policy of the one sprite_multiplex_game
  (mux.asm's header). The verdict stays INCOMPATIBLE for the list as named.
- `unit_shared` / `shared_register` SCROLY among threshold_scroll_v,
  row_map_redraw, soft_scroll_v, invalid_mode_band, frame_sync_loop: one
  writer each place. C computes YSCROLL (scroll.c) into `pend_ys`; the frame
  IRQ applies it; the band IRQ writes the band's and panel's `$D011` and puts
  nothing back (the frame IRQ rewrites the playfield's every frame).
- `unit_shared` char_attribute_flags with the multiplexer on `sprite_0-7`:
  the priority bit travels with the slot (`slot_pri`) and the multiplexer
  writes `$D01B` with each sprite's X and Y.
- `shared_register` MSIGX with per_frame_hitbox: only the multiplexer writes
  `$D010`.
- `recipe_zero_page_overlap` (info): none of the recipes' zero page is used;
  the kernel uses none, Oscar64 owns `$02`-`$5x`.
- object_pool, wave_director, tile_grid_collision, tile_map_render: the
  graph holds nothing for them. tile_map_render is implied as a
  prerequisite of char_attribute_flags; this map has no tiles (KB-GAPS.md).

## Budget

Command: `node src/cli.ts plan-budget threshold_scroll_v row_map_redraw soft_scroll_v invalid_mode_band sprite_multiplex_game sprite_slot_parking object_pool wave_director char_attribute_flags facing_turn_step grenade_lob checkpoint_respawn area_end_gate_wave sfx_voice_takeover frame_sync_loop per_frame_hitbox --region both --sprites 5 --sprite-lines 120`

```text
# Budget plan: undetermined

Techniques: threshold_scroll_v, row_map_redraw, soft_scroll_v, invalid_mode_band, sprite_multiplex_game, sprite_slot_parking, object_pool, wave_director, char_attribute_flags, facing_turn_step, grenade_lob, checkpoint_respawn, area_end_gate_wave, sfx_voice_takeover, frame_sync_loop, per_frame_hitbox

## play (PAL, 19656 cycles a frame): undetermined

Range 36916-47124 + 2635 fixed cycles; floor 0; weakest basis arithmetic; IRQ slots 23.

Summed:
- threshold_scroll_v: 340 (measured-vice, on kickassembler-threshold-scroll-v (worst tick of 132 frames: step applied, three objects moved, `$D011` and four sprite Y registers written, next step decided; in the lower border, no badline inside; the coarse redraw is not included))
- row_map_redraw: 13304 (measured-vice, on kickassembler-row-map-redraw (the redraw frame, 21 rows, CIA1 timer B, screen on, PAL: 13,916 measured, less the 546 cycles of per-row harness reads and the 66-cycle line-250 IRQ that `invalid_mode_band` already counts, arithmetic; 14,175 measured on NTSC; an earlier version said 14,673, measured with the copy loop across a page boundary and the harness included))
- invalid_mode_band: 918 (measured-vice, on kickassembler-invalid-mode-band (PAL, screen on; the split handler polls from line 211 to 224, the second IRQ runs on line 250 and, at 66 cycles, into 251; an earlier version said lines_active=15))
- sprite_multiplex_game: 8995-16600 (arithmetic, on kickassembler-sprite-multiplex-game (worst frame: arithmetic, a reversed sort, CPU cycles only; typical: the largest whole frame of sort, build and IRQs in 2,142 frames of play, timed wall-clock by a probe build, NTSC, screen on))
- sprite_slot_parking: 5334 (arithmetic, on kickassembler-sprite-slot-parking (worst frame, CPU cycles only: 16 slots in groups of 8, 4 and 4, group writes 414 + 218 measured with CIA2 timer A, screen off, group C taken as equal to B; 317 cycles of interrupt entry through $FF48, re-arm and $EA81 exit for the three parts by arithmetic; the insertion sort of 16 distinct Ys in reverse order, 4,155 measured, plus 12 for its JSR/RTS; the sprite DMA of parked slots not included, 358 more for the recipe's six at Y 0 on PAL))
- wave_director: 1170-3188 (measured-vice, on oscar64-wave-director (worst frame, screen blanked))
- char_attribute_flags: 700 (measured-vice, on kickassembler-char-attribute-flags (worst frame: three walkers, two probes each, the event log and the `$D01B` build, below the display))
- facing_turn_step: 93 (measured-vice, on kickassembler-facing-turn-step (worst frame of 40, port read, decode, eight-way move and turn, jsr and rts included))
- grenade_lob: 956 (measured-vice, on kickassembler-grenade-lob (worst tick: the first blast tick, 12 live targets of which 7 die, each kill a colour write; run from line 251, below the display))
- checkpoint_respawn: 743 (measured-vice, on kickassembler-checkpoint-respawn (worst of three respawns, one call after a death: restart row from 5 checkpoints, 8-slot pool freed, a 26-event list scanned from its start, 4 events pre-spawned, grenades topped up; CIA2 timers, screen blanked; the map redraw at the restart row is not included))
- area_end_gate_wave: 290-599 (measured-vice, on kickassembler-area-end-gate-wave (worst tick of 435 frames, a frame with spawns into a six-slot pool; typical is the most common wave frame; run from line 251, in the lower border, no badline inside; sprite register writes not included))
- sfx_voice_takeover: 66-342 (arithmetic, on kickassembler-sfx-voice-takeover (an effect's start frame and a step frame, each against the same frame of a build with no requests))
- frame_sync_loop: 314 (measured-vice, on oscar64-platformer-scaffold (the raster IRQ from entry to return, 291, plus the loop's tick bookkeeping, 23; PROFILE=1 build, PAL and NTSC; the budget bar's two stores are not inside))
- per_frame_hitbox: 3693 (measured-vice, on oscar64-per-frame-hitbox (eight boxes, 28 pairs of which the masks leave 10; an item is one tested pair that hits, over a base of eight boxes and no tested pair, see Cycle budget; 1,834 to test plus 1,859 to emit, from a build without the demo's pair counters and halved-X arrays; the recipe as shipped prints COLLIDE MAX 2,037 and EMIT MAX 2,148, which include them; in the vertical blank, PAL))

Left out:
- soft_scroll_v: not added, inside threshold_scroll_v's figure (Cost includes)
- object_pool: not added, inside wave_director's figure (Cost includes)

Notes:
- Fixed losses 2635 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 1560; arithmetic) charged because threshold_scroll_v, sprite_multiplex_game, sprite_slot_parking, wave_director, char_attribute_flags, facing_turn_step, grenade_lob, checkpoint_respawn, area_end_gate_wave, sfx_voice_takeover, frame_sync_loop, per_frame_hitbox are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: row_map_redraw, invalid_mode_band were measured with the screen on and already hold the stalls that fell inside them, so the charge is too high by that much and the over test counts 0.
- The low end, 36916 + 2635 = 39551, is over the 19656-cycle frame by 19895, but it is not a floor: the figures of threshold_scroll_v, row_map_redraw, invalid_mode_band, sprite_multiplex_game, sprite_slot_parking, wave_director, char_attribute_flags, facing_turn_step, grenade_lob, checkpoint_respawn, area_end_gate_wave, sfx_voice_takeover, frame_sync_loop, per_frame_hitbox are a common frame or a real run's worst, and those frames need not fall together. threshold_scroll_v, row_map_redraw, invalid_mode_band, sprite_slot_parking, char_attribute_flags, facing_turn_step, grenade_lob, checkpoint_respawn, frame_sync_loop, per_frame_hitbox have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.

## play (NTSC, 17095 cycles a frame): undetermined

Range 36916-47124 + 2635 fixed cycles; floor 0; weakest basis arithmetic; IRQ slots 23.

Summed:
- threshold_scroll_v: 340 (measured-vice, on kickassembler-threshold-scroll-v (worst tick of 132 frames: step applied, three objects moved, `$D011` and four sprite Y registers written, next step decided; in the lower border, no badline inside; the coarse redraw is not included))
- row_map_redraw: 13304 (measured-vice, on kickassembler-row-map-redraw (the redraw frame, 21 rows, CIA1 timer B, screen on, PAL: 13,916 measured, less the 546 cycles of per-row harness reads and the 66-cycle line-250 IRQ that `invalid_mode_band` already counts, arithmetic; 14,175 measured on NTSC; an earlier version said 14,673, measured with the copy loop across a page boundary and the harness included))
- invalid_mode_band: 918 (measured-vice, on kickassembler-invalid-mode-band (PAL, screen on; the split handler polls from line 211 to 224, the second IRQ runs on line 250 and, at 66 cycles, into 251; an earlier version said lines_active=15))
- sprite_multiplex_game: 8995-16600 (arithmetic, on kickassembler-sprite-multiplex-game (worst frame: arithmetic, a reversed sort, CPU cycles only; typical: the largest whole frame of sort, build and IRQs in 2,142 frames of play, timed wall-clock by a probe build, NTSC, screen on))
- sprite_slot_parking: 5334 (arithmetic, on kickassembler-sprite-slot-parking (worst frame, CPU cycles only: 16 slots in groups of 8, 4 and 4, group writes 414 + 218 measured with CIA2 timer A, screen off, group C taken as equal to B; 317 cycles of interrupt entry through $FF48, re-arm and $EA81 exit for the three parts by arithmetic; the insertion sort of 16 distinct Ys in reverse order, 4,155 measured, plus 12 for its JSR/RTS; the sprite DMA of parked slots not included, 358 more for the recipe's six at Y 0 on PAL))
- wave_director: 1170-3188 (measured-vice, on oscar64-wave-director (worst frame, screen blanked))
- char_attribute_flags: 700 (measured-vice, on kickassembler-char-attribute-flags (worst frame: three walkers, two probes each, the event log and the `$D01B` build, below the display))
- facing_turn_step: 93 (measured-vice, on kickassembler-facing-turn-step (worst frame of 40, port read, decode, eight-way move and turn, jsr and rts included))
- grenade_lob: 956 (measured-vice, on kickassembler-grenade-lob (worst tick: the first blast tick, 12 live targets of which 7 die, each kill a colour write; run from line 251, below the display))
- checkpoint_respawn: 743 (measured-vice, on kickassembler-checkpoint-respawn (worst of three respawns, one call after a death: restart row from 5 checkpoints, 8-slot pool freed, a 26-event list scanned from its start, 4 events pre-spawned, grenades topped up; CIA2 timers, screen blanked; the map redraw at the restart row is not included))
- area_end_gate_wave: 290-599 (measured-vice, on kickassembler-area-end-gate-wave (worst tick of 435 frames, a frame with spawns into a six-slot pool; typical is the most common wave frame; run from line 251, in the lower border, no badline inside; sprite register writes not included))
- sfx_voice_takeover: 66-342 (arithmetic, on kickassembler-sfx-voice-takeover (an effect's start frame and a step frame, each against the same frame of a build with no requests))
- frame_sync_loop: 314 (measured-vice, on oscar64-platformer-scaffold (the raster IRQ from entry to return, 291, plus the loop's tick bookkeeping, 23; PROFILE=1 build, PAL and NTSC; the budget bar's two stores are not inside))
- per_frame_hitbox: 3693 (measured-vice, on oscar64-per-frame-hitbox (eight boxes, 28 pairs of which the masks leave 10; an item is one tested pair that hits, over a base of eight boxes and no tested pair, see Cycle budget; 1,834 to test plus 1,859 to emit, from a build without the demo's pair counters and halved-X arrays; the recipe as shipped prints COLLIDE MAX 2,037 and EMIT MAX 2,148, which include them; in the vertical blank, PAL))

Left out:
- soft_scroll_v: not added, inside threshold_scroll_v's figure (Cost includes)
- object_pool: not added, inside wave_director's figure (Cost includes)

Notes:
- Fixed losses 2635 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 1560; arithmetic) charged because threshold_scroll_v, sprite_multiplex_game, sprite_slot_parking, wave_director, char_attribute_flags, facing_turn_step, grenade_lob, checkpoint_respawn, area_end_gate_wave, sfx_voice_takeover, frame_sync_loop, per_frame_hitbox are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: row_map_redraw, invalid_mode_band were measured with the screen on and already hold the stalls that fell inside them, so the charge is too high by that much and the over test counts 0.
- The low end, 36916 + 2635 = 39551, is over the 17095-cycle frame by 22456, but it is not a floor: the figures of threshold_scroll_v, row_map_redraw, invalid_mode_band, sprite_multiplex_game, sprite_slot_parking, wave_director, char_attribute_flags, facing_turn_step, grenade_lob, checkpoint_respawn, area_end_gate_wave, sfx_voice_takeover, frame_sync_loop, per_frame_hitbox are a common frame or a real run's worst, and those frames need not fall together. threshold_scroll_v, row_map_redraw, invalid_mode_band, sprite_slot_parking, char_attribute_flags, facing_turn_step, grenade_lob, checkpoint_respawn, frame_sync_loop, per_frame_hitbox have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

Sum 119 over facing_turn_step (derived-listing); weakest basis derived-listing; a floor, since threshold_scroll_v, row_map_redraw, soft_scroll_v, invalid_mode_band, sprite_multiplex_game, sprite_slot_parking, object_pool, wave_director, char_attribute_flags, grenade_lob, checkpoint_respawn, area_end_gate_wave, sfx_voice_takeover, frame_sync_loop, per_frame_hitbox state no bytes.

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
- Sprites: 5 a line on 120 lines, (3 + 2 × 5) × 120 = 1560 cycles of DMA a frame (3 + 2n measured in VICE x64sc for sprites numbered without gaps).

```

MEASURED: filled in below after the meter ran.
