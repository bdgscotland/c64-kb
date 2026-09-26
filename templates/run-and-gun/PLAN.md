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
multiplexer with parked slots, the soldier, the enemies (below, "Enemies")
and his weapons (below, "Weapons"). Collisions, game flow and audio come
next, each in its own module (below, "Modules").

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

Measured (VICE x64sc 3.10, `make shot check`; the autopilot's first 200
frames that run the game's logic):

| Frame | PAL | NTSC | Instrument |
|---|---|---|---|
| Logic frame, worst | 3,049 | 3,071 | harness meter: C's bracket (CIA2 timer A) plus every IRQ outside it (CIA2 timer B, kernel.asm) |
| Logic frame, typical (median) | 2,971 | 2,994 | the same |
| Redraw, most cycles | 14,100 | 14,317 | CIA1 timer B around `redraw`, wall time, IRQs that land inside included (main.c `do_redraw`) |
| Redraw ends on line (next frame) | 135 | 181 | `$D011`/`$D012` at its end (kernel.asm `redraw_end`) |
| Redraw's smallest lead over the beam | 73 lines | 27 lines | row 20 is fetched on line 208 at YSCROLL 0; 208 minus the end line |
| Logic before a redraw ends, lines after line 250 | 50 | 48 | limit 286 (PAL) and 237 (NTSC): the band's tick on line 224 |
| The frame after a redraw ends on line | 159 | 205 | limit 250, the frame IRQ |
| Lost frames | 0 | 0 | wait_frame's count; also 0 in a 2,500-frame drive of the normal build that scrolled 397 lines (49 redraws), each model |

The redraw frame against the recipe: 13,885-13,916 on PAL and 14,128-14,175
on NTSC there, with its harness's 546 cycles of row reads inside and no
game IRQ; here no row reads, and the frame IRQ (the multiplexer's first
eight sprites) lands inside it. The end lines are the recipe's (135, 181).
Not in the figures: about 40 cycles per IRQ taken outside C's bracket
(entry before timer B starts, exit after it stops; arithmetic from
kernel.asm), two or three a frame.

Against the plan: its range, 36,916-47,124 plus 2,635 fixed, is more than
ten times the measured logic frame. The redraw is summed into every frame
(KB-GAPS.md 1), the multiplexer twice (KB-GAPS.md 3), and every technique
at its recipe's worst. This slice runs one sprite and no enemies; the next
modules own the difference. What they must keep:

- A logic frame ends before line 250 of its frame, or the frame is lost.
  Room left: about 16,600 cycles on PAL and 14,000 on NTSC.
- The logic frame before a redraw ends before line 224 of the next
  display frame (286 lines after 250 on PAL, 237 on NTSC), or the redraw
  starts late and its lead shrinks one line for each line late.
- Every cycle an IRQ spends while the redraw runs comes off its lead:
  27 lines on NTSC is about 1,750 cycles. Enemy zones above row 20 are
  that budget. The music no longer is: it is held off the redraw frame
  ("Audio" below; the lead is still 27 lines on NTSC). An earlier version
  of this line gave the music a share of it. Measure the lead again (row
  6 of the verdict) after adding zones.
- The frame after a redraw runs no logic; it ends on NTSC line 205, 45
  lines before its deadline.

## Audio

`sfx_voice_takeover`, from the recipe kickassembler-sfx-voice-takeover
(its driver, in `src/sound.asm`). One driver step a frame plays an
original three-voice tune and five effects. An effect takes voices 1 and
2; the music keeps stepping them without writing the SID and plays on
voice 3. The last request wins. Not `sfx_in_player`: its 351-cycle shadow
copy every frame (its technique page) buys priority and a hand-back this
game does not need; its effects are short and its tune's notes are two to
sixteen ticks.

The tune, "Firebase March", is data from `tools/mktune.py` (`make assets`
writes `src/gen/tune.asm`): A minor, eight bars that loop, 768 frames
(15.4 s on PAL). Voice 1 bass in eighths, voice 2 noise drums, voice 3
the melody, so a fire-fight keeps the melody. On NTSC the driver copies an
NTSC frequency table over the PAL one and skips the tick count one frame
in six (pitfall `pal_ntsc_tempo_mismatch`), so pitch and tempo match PAL.
Nobody has listened to it: `+sound` is off in every run here.

| Effect | `sfx(n)` | Frames | Voices 1 and 2 |
|---|---|---|---|
| `SFX_SHOT` | 1 | 8 | noise falling C7-E6, a low pulse under it |
| `SFX_THROW` | 2 | 16 | triangle rising G4-B5, noise an octave down |
| `SFX_BLAST` | 3 | 48 | noise falling D4-D2, a stuttering pulse two octaves down |
| `SFX_KILL` | 4 | 18 | stuttering pulse falling E6-A#4, saw a fourth down |
| `SFX_DEATH` | 5 | 72 | triangle falling G5-G2, a stuttering pulse a fifth down |

The lengths are driver steps, one a frame. The tune skips one tick count in
six on NTSC; the effects do not, so on NTSC every effect runs a sixth
faster and shorter (SHOT: 160 ms on PAL, 133 ms on NTSC; arithmetic).

The numbers are `src/sound.h`. Weapons, objects and flow call `sfx()`;
until they exist, the AUTOPILOT build's script (`src/sound.c`) requests
SHOT, THROW, BLAST, KILL, SHOT, DEATH, SHOT, SHOT on play frames 10, 30,
52, 110, 120, 140, 222 and 224: KILL and the first of the last two SHOTs
are cut, so 8 effects start and 6 run to their end (verdict row 3, `SND
08 06`, and check 11).

**Where the step runs.** The frame IRQ (line 250) calls `audio_play`
after the sprites, as the Kernel's interface said. On the redraw frame
that IRQ lands inside the copy, where every cycle comes off the redraw's
lead over the beam. So main.c sets `aud_hold` before the redraw and clears
it after; under the hold the frame IRQ counts the step in `aud_owed` (15
cycles, tested in kernel.asm) and the next frame IRQ plays the owed step
before its own. A first version played the owed step at the end of the
redraw, in the light frame: that frame then ended on NTSC line 232, 18
lines before its deadline, and the step ran among badlines (868 cycles
instead of 782). The step is one frame late on 13 of 839 frames; the
tune's ticks are counted in steps, so its timing does not move (`make
audio`, the tempo check).

Measured (VICE x64sc 3.10, `make shot check` and `make audio`; step
cycles by CIA1 timer A around each step, in the frame IRQ, less the
stopwatch's 5):

| | PAL | NTSC | Instrument |
|---|---|---|---|
| One step, worst of the autopilot run | 769 | 777 | stopwatch (verdict row 3 `W`) |
| One step, typical (median) | 343 | 350 | the same (row 3 `T`) |
| One step, least | 235 | 242 | `make audio` log |
| An effect's start, the engine alone | 395-418 | 382-418 | `make audio`: the same step of the `NO_SFX` build subtracted |
| Worst step possible: a start on a three-note-on step | about 1,190 | about 1,200 | arithmetic from the two rows above; the MAPEND run met 1,000 on PAL |
| Frame IRQ after a redraw: the owed step and its own, worst of the run | 1,008 | 1,188 | `make audio`: VICE clock, first step's `aud_mark` store to the second's last log store (13 such IRQs in the logged steps) |
| Between the two steps of that IRQ | 158 | 158 | the same, less the two steps' stopwatch readings |
| Frame IRQ's audio, worst possible: the owed step with a start, then a three-note-on step | about 2,120 | about 2,140 | arithmetic: 1,200 + 782 + 158 on NTSC (PAL 1,192 + 774 + 158) |
| Frame IRQ under the hold (inside the redraw) | 15 | 15 | arithmetic from kernel.asm (the stub's `jsr`/`rts` was 12) |
| Redraw's smallest lead over the beam | 72 lines | 27 lines | verdict row 6 (before audio: 73, 27) |
| Logic frame, worst (IRQs in) | 4,068 | 4,108 | harness meter (before audio: 3,049, 3,071); the worst holds two steps |
| Logic frame, typical | 3,451 | 3,474 | the same (before: 2,971, 2,994) |
| Logic before a redraw ends, lines after line 250 | 59 | 57 | row 8 `PRE` (before: 50, 48; limits 286, 237) |
| The frame after a redraw ends on line | 161 | 205 | row 8 `LF` (before: 159, 205; limit 250) |
| Lost frames | 0 | 0 | row 7 |

The PAL lead reads 72 or 73 lines from build to build with the same
interrupt path: the redraw's end line moves with where C's `band_tick`
poll leaves it (an earlier build of this module read 73; arithmetic says
the hold path costs 3 cycles more than the stub).

**The worst frame IRQ.** The frame IRQ after a redraw's light frame runs
two steps back to back. The worst measured, 1,188 cycles on NTSC, is 19
lines; the worst possible, about 2,140 cycles, is 33 NTSC lines (34 on
PAL at 63 cycles a line). From line 250, after the sprites, that reaches
line 20 of the next NTSC frame (line 284 of 312 on PAL; arithmetic). The
frame IRQ arms the first multiplexer zone's line after the audio, so a
zone due before about line 25 on NTSC (line 20 plus the sprites' part
of the IRQ, which runs first) can be armed after its line has passed
and fire a frame late. The zones must start below that, or the zone
module must arm the first zone before the audio (it then runs late,
through the late guard). An earlier version of this paragraph gave
the worst as one step, about 1,190 cycles and 18 lines: it missed the
two-step IRQ.

`make audio` (run by `make check`): a store trace of `$D400-$D418`
proves the takeover. Both builds, 20,000,000 cycles (one whole loop of
the tune after the start-up), PAL then NTSC:

```text
PASS PAL   owned: 172 steps start with an effect running; music stores to voices 1-2 in them: 0
PASS PAL   voice3: effect stores 681, to $D40E-$D418 0; in the NOFX build 0
PASS PAL   same3: voice 3 music stores in 845 steps: 2106 and 2106, identical in step, register and value
PASS PAL   same12: voices 1-2 music stores in the 673 steps no effect owns: 769 and 769, identical
PASS PAL   tempo: voice 3 note-ons on 52 steps; the tune data gives 52; the same steps
PASS PAL   frames: from play's start (step 7), 839 steps in 839 frames, net drift 0; 13 steps a frame late; offsets outside 8..9: 0, a late step not caught up: 0, gaps outside 0-2 frames: 0
PASS PAL   sid: $D418 stores 2, set to $0F by audio_init and never changed: yes; voice 3 note-on pitches 52, off the PAL table: 0
PASS NTSC  owned: 172 steps start with an effect running; music stores to voices 1-2 in them: 0
PASS NTSC  voice3: effect stores 681, to $D40E-$D418 0; in the NOFX build 0
PASS NTSC  same3: voice 3 music stores in 966 steps: 2332 and 2332, identical in step, register and value
PASS NTSC  same12: voices 1-2 music stores in the 794 steps no effect owns: 805 and 805, identical
PASS NTSC  tempo: voice 3 note-ons on 50 steps; the tune data gives 50; the same steps
PASS NTSC  frames: from play's start (step 7), 960 steps in 960 frames, net drift 0; 13 steps a frame late; offsets outside 8..9: 0, a late step not caught up: 0, gaps outside 0-2 frames: 0
PASS NTSC  sid: $D418 stores 2, set to $0F by audio_init and never changed: yes; voice 3 note-on pitches 50, off the NTSC table: 0
```

`frames` is the only check that sees a lost or extra step: `same3`,
`same12` and `tempo` count in steps, and `sound_ok` compares two counters
the same frame IRQ increments. It wants each late step followed by its
frame's own and as many steps as frames at the end. An earlier version
only bounded the spread of frame minus step, which a step lost for good
passed.

`make audiotest` (run by `make selftest`), both models; each build must
exit 1 with a FAIL line for its check and no traceback:

- `AUDIO_FAULT`, whose music writes every voice during an effect, fails
  `owned` (221 stores on PAL, 137 on NTSC).
- `AUDIO_DROP`, which never plays the first owed step, fails `frames`
  (838 steps in 839 frames on PAL, 959 in 960 on NTSC) and passes the
  other six.

`make watch` (`SID_FRAMES` 300): the SID is written in at least 300
frames (324 measured on PAL, 370-371 on NTSC); the `NO_PLAYER` build in
2.

Two things the trace showed that no page said. Oscar64's start-up copies
the blob into place, so a trace of the blob's addresses sees three
"steps" before `audio_init`; the script counts only stores from sound.asm's
code. And the meter's calibration in `play_enter` (harness `meter_init`,
four waits for line 0 with interrupts off) drops two frame IRQs, so the
AUTOPILOT build loses two music steps at the start of play; the normal
build does not call `meter_init`. `sound_start` runs after `meter_init`,
so the gap falls before the counters and the trace's first timed step,
and `frames` sees every step after it (an earlier build called
`sound_start` first).

Memory: `src/sound.asm` and `src/gen/tune.asm` take `$11DE-$1A23` of the
blob: 830 bytes of data (two frequency tables of 190, three patterns of
321, five effects of 105), 778 of code and state, and the 510-byte step
log the stopwatch fills. CIA1 timer A is the stopwatch; nothing else here
uses it.

## Memory and screen

| Range | What |
|---|---|
| `$0801-$087F` | Oscar64 start-up |
| `$0880-$1A23` | the KickAssembler blob: kernel.asm, mux.asm, sound.asm with src/gen/tune.asm (build/asm.h `ASM_END`; `$11EA` before the audio module) |
| `$2000-$7FFF` | C code, data, stack |
| `$8000-$83E7` | the one screen: playfield rows 0-20, panel rows 21-23 (VIC bank 2) |
| `$83F8-$83FF` | sprite pointers |
| `$8400-$87FF` | scratch: the meter's readout row in AUTOPILOT builds, copied after the verdict |
| `$8800-$8FFF` | characters: 0-63 copied from the ROM at start-up, 64-255 the jungle (src/gen/charset.bin) |
| `$9000-$9EFF` | the raw row map, 96 rows x 40 (src/gen/map.bin); the VIC sees the character ROM here |
| `$9F00-$9FFF` | attr[screen code], page aligned (src/gen/attr.bin) |
| `$A000-$A83F` | sprites: soldier 8 x 4 frames, then the blank parking block (block 160) |
| `$A840-$B2FF` | sprites: rifleman 8 x 2, runner 2 x 2, grenadier 8 x 2, enemy bullet, grenade 3 sizes, blast 2, dust (blocks 161-203, `SPR_*` in `src/gen/assets.h`) |
| `$B300-$BDFF`, `$C000-$CFFF` | free: sprite blocks 204-247 in the bank; `$C000-$CFFF` is outside the VIC bank |
| `$BE00-$BFFF` | weapon sprites, blocks 248-255: bullet, grenade in three sizes, blast in two frames, two spare (src/gen/weapon_sprites.bin, tools/mkweapons.py) |

KERNAL and BASIC are banked out (`$01 = $35`); the IRQ and NMI vectors
are `$FFFE` and `$FFFA`. Oscar64's zero page is `$02` to about `$5x`; the
blob uses none and takes arguments through its own bytes (`ASM_<LABEL>`).
Colour RAM: playfield rows `$0D` (multicolour, green), panel rows white,
written once; the redraw never touches it. `$02FF` is the verdict,
`$02FD` the lost-frame count. CIA2 timer A is the meter's, timer B the IRQ
time's, CIA1 timer B the redraw's (AUTOPILOT builds read it).

Raster: frame IRQ line 250; multiplexer zones between; band IRQ line 211,
band lines 214-222, panel lines 223-246. Sprites end by line 208
(`MAX_SY` 187).

## Modules

Every module owns its files and talks to the others through `game.h` and
its own header. main.c calls each module once a frame in `play_frame`:
soldier, objects, weapons, collide, flow, then the draws and the commit.
A module never writes the VIC's sprite registers: it writes its slots
(objects.h `slot_show`, `slot_park`), and the multiplexer does the rest.

| Module | Files | Owns | Interface it must keep |
|---|---|---|---|
| Kernel | kernel.asm, mux.asm | `$D012` and the chain, the band, the redraw, the 16-slot multiplexer | `commit` bits (`COMMIT_YS`, `COMMIT_MUX`), `pend_ys`, `frame_flag`, `band_tick`, `redraw`, `mux_sort`, `mux_build`, the slot tables `slot_y/xl/xh/ptr/col/pri` |
| Scroll | scroll.c/h | the view: `scroll_top`, `scroll_ys`, `scroll_wy` | `scroll_step`, `scroll_can_step`, `map_x`, `map_y`, `attr_at`, `code_at`, `scroll_init(top, ys)` |
| Soldier | soldier.c/h | slot 0, the stick | `soldier_x`, `soldier_y`, `soldier_facing` (0-15), `soldier_behind`; `soldier_update(joy)`, `soldier_draw` |
| Objects and enemies | objects.c/h, spawns.h | slots 5-15, the pool, the spawn list | `obj_alloc`, `obj_free`, `objects_rows(top)` (wave_director: spawns keyed to map rows, fired as the top row reaches them), `objects_update` (writes the slots), `objects_draw` (empty), `objects_scroll` (returns 1 when main.c must rebuild); for collide: `kind_box`, `kind_flags`, `obj_kill(slot)`; objects keep map coordinates and draw at Y = my - scroll_wy + 54 |
| Weapons | weapons.c/h | slots 1-3 (bullets), 4 (grenade), decrements `grenades` | `weapons_update(joy)` (fire joy bit 4, throw `JOY_THROW` bit 5), `weapons_reset`; for collisions: `Box`, `box_hit`, `box_has`, `box_blast`, `weapons_bullet_box(i, &b)`, `weapons_bullet_spent(i)`, `weapons_blast_box(&b)` ("Weapons", below) |
| Collision (next) | collide.c/h | boxes | `collide()`, after objects and weapons moved; scenery is `attr_at` |
| Flow (next) | flow.c/h, main.c's states | score, lives, grenades, title, game over, high score | `flow_new_game`, `flow_frame`; checkpoint_respawn restarts through `scroll_init(row, 0)`, `objects_reset`, `objects_rows`; area_end_gate_wave starts when `scroll_can_step()` is 0; the gate is `G_GATE`, map rows 1-2, columns 18-21; `panel_update` after a change |
| Audio | sound.asm, sound.c/h, tools/mktune.py, main.c `sfx` | the SID, CIA1 timer A (stopwatch) | `audio_init`, `audio_play` (line-250 IRQ; held off the redraw frame by `sound_hold`/`sound_release` in `do_redraw`), `sfx_request` (A = effect); C calls `sfx(SFX_...)` from sound.h; sfx_voice_takeover: effects on voices 1 and 2, the tune on 3 ("Audio") |

Rules for every module:

- Park a slot with `slot_park`; show it with `slot_show`, every field in one
  frame. Nothing tests "in use" in the IRQs.
- No zero page in KickAssembler code; no `SEI` spanning line 211 in C
  (pitfall `sei_in_main_spans_band_entry_line`).
- A sprite below `MAX_SY` (187) is not shown: keep objects above it.
- New glyphs and their attributes go in tools/mkassets.py, never by hand
  in src/gen/; `make assetcheck` proves the committed files match.

## Autopilot and checks

Script (frames, port byte): 2 idle, 2 fire (the title starts the game);
75 up: 50 frames walk from sprite Y 160 to the threshold (110), 13 frames
scroll the map (map y on line 55 from 607 to 594), then the sandbags on
map row 82 stop him, 12 frames blocked; 70 right, from X 168 to 238, past
the sandbags' end at column 25, into the canopy's column; up: the map
scrolls again, 94 more lines. The game freezes at the first YSCROLL 3
after play frame 236: map y 500, 107 steps, 13 redraws, the soldier at
X 238, Y 110, his body centre on map row 70, the canopy's last row, so he
is behind it for 2 frames. Each figure is arithmetic from the map and the
script; the run printed the same on PAL and NTSC.

The verdict (main.c `first_fail`), `$02FF` = `$01` and a green border on
pass: no frame lost and no redraw late; the soldier's position; the
scroll's map y and steps; 12 frames blocked; the priority bit set under
the canopy; 13 redraws; every redraw's lead at least 8 lines; the screen
equals the map from `scroll_top` (840 bytes); `$D011` = `$13` (YSCROLL 3)
as the frame IRQ applied it; the multiplexer shows exactly the slots above
its cut (8 at the freeze: the soldier and seven pool objects; this check
said "exactly one sprite" before the enemies landed).

`expect.json` grades the border, the verdict rows, the meter (200
frames, worst inside a frame), the soldier's white bounding box (lines
121-127: the canopy hides his upper half), map features where 107 lines
of scroll put them (the trunk on line 124, the sandbags from line 211,
the rock on line 170), the band (lines 214-222 black), the panel's first
line and its text (SCORE, FIREBASE, LIVES, GRENADES), and the panel and
playfield identical on PAL and NTSC. FORCE_FAULT starts him 8 pixels
right: the trunk on column 29 stops him, the scroll never reaches YSCROLL
3 after frame 236, and the build freezes 40 frames later with a red
border.

`make phases` (run by `make check`): eight builds frozen on YSCROLL 0-7
with the soldier at sprite Y 187: line 213 is playfield, lines 214-222
black, the panel identical to phase 3, on both models (16 of 16). With
the band's badline-phase delay changed from 1 to 9 it failed YSCROLL 5 on
both models (the band started a line late). `make mapend`
(VERIFY_TARGETS): the view starts 7 lines from the map's top, stops at
map y 0 after 7 steps, and the soldier walks on through the gate to
sprite Y 52 (10 of 10).

`node scripts/verify-templates.ts --only run-and-gun --selftest` in c64-kb
(the starter made into a fresh project outside the repo): `make all`,
`make shot check` (45 of 45), `make disk`, `make selftest` and
`make mapend` (10 of 10) all pass; "verify-templates: 1 of 1 starters
passed".

## Enemies

The objects module (`src/objects.c`, `objects.h`, `src/spawns.h`), built
from the KB pages of `object_pool`, `wave_director`, `grenade_lob`,
`char_attribute_flags`, `sprite_slot_parking`, `checkpoint_respawn` (the
pre-spawn window) and `atan2_8bit` (its "Variations" for the aim).

- **Spawn list.** One event per enemy, `EV(map row, X / 2, kind,
  parameter)`, rows descending, 21 events from row 88 to row 4. An event
  fires when the view's top row is at or above its row (`>=`), in
  `objects_rows`; its enemy stands with its feet on the row's last line,
  so it walks out from under the top border. `objects_reset` spawns the
  events already in view (rows 75-95 at the start), as checkpoint_respawn
  pre-spawns its window. A full pool loses the event (`ost_lost`).
- **Rifleman** (cyan): walks toward the soldier's column and down until 56
  pixels above him, half a pixel a frame on each axis, stopped by `A_BLOCK`
  at his feet; faces him in 8 directions (octant from the signs, split at
  min * 2.5 < max, arithmetic from tan 22.5 = 0.414); fires an aimed shot
  every 64 frames while fully in view. The shot: 1.5 pixels a frame on an
  axis, 1 + 1 on a diagonal.
- **Runner** (orange): crosses the screen at 2 pixels a frame from under one
  border to the other.
- **Grenadier** (purple): stands, faces the soldier, throws every 80-120
  frames: `grenade_lob`'s enemy form from its Commando section, vx =
  trunc(dx / 64), vy = trunc(dy / 64) - 2, vy up by one every 16 frames,
  sizes small-middle-large-middle-small, a blast of 20 frames at age 80.
- **Terrain.** A shot ends on an `A_BLOCK` cell from age 4; a grenade bursts
  on one from age 16 (the brief's rule; Commando's player grenade ignores
  walls and the KB does not say what its enemy grenade does, KB-GAPS.md 17).
- **Scroll.** Objects keep map coordinates; Y = my - scroll_wy + 54. Each
  object thinks on every second frame (pool index against the frame count)
  and moves two frames' worth; on the other frame only its slot's Y follows
  the ground. This halved the objects' cost against thinking every frame
  (below).
- **The redraw frame.** `objects_scroll` moves every shown pool slot down
  the line the soldier's repeated step scrolled, and main.c builds the table
  without a new sort (`actors_rebuild`; Commando skips its sort on coarse
  frames too). It runs only if the frame begins by line 192 (`LFX_LAST`).
  With eight sprites up it ran after 13 of 13 redraws on PAL and 0 of 13 on
  NTSC, whose redraw ends on line 195: forced, the NTSC run lost 6 frames.
  So on NTSC the objects keep the slice's one-line lag for that frame.
- **For the collision module.** `kind_box[kind]` (sprite pixels from the
  slot's own registers), `kind_flags` (`KF_SHOOTABLE`, `KF_HURTS`), and
  `obj_kill(slot)`: an enemy turns to dust, freed 24 frames later; it
  returns the kind killed so the caller can score. A slot at `PARK_Y`, or a
  box outside VIC X 24-343, is not on screen.
- **Art.** `tools/mkassets.py` draws the three figures (cap and rifle, bare
  head and swinging arms, banded helmet and grenade), the bullet, three
  grenade sizes, two blast frames and the dust; `make assetcheck` passes.

Measured (VICE x64sc 3.10, `make shot check`; the same walk as before):

| | PAL before | PAL now | NTSC before | NTSC now |
|---|---|---|---|---|
| Logic frame, worst (cycles, IRQs included) | 3,049 | 8,200 | 3,071 | 8,397 |
| Logic frame, typical (median) | 2,971 | 5,586 | 2,994 | 5,819 |
| Redraw, most cycles | 14,100 | 14,506 | 14,317 | 15,231 |
| Redraw ends on line (next frame) | 135 | 143 | 181 | 195 |
| Redraw's smallest lead over the beam | 73 lines | 65 lines | 27 lines | 13 lines |
| The frame after a redraw ends on line | 159 | 207 | 205 | 234 |
| Sprites the multiplexer shows at the freeze | 1 | 8 | 1 | 8 |
| Lost frames | 0 | 0 | 0 | 0 |

`make enemies` (the same walk, `-dENEMYTEST=1`), CIA1 timer A around the
module's calls, wall time (an IRQ that lands inside is counted), the first
200 logic frames:

| | PAL | NTSC |
|---|---|---|
| Objects (`objects_rows` + `objects_update` + `objects_draw`), mean / most | 2,288 / 4,221 | 2,325 / 4,436 |
| Multiplexer sort + build, mean / most | 1,388 / 2,291 | 1,544 / 2,520 |
| The redraw frame's move + build (`LFX`), most | 2,553 | not run (after line 192) |
| Pool objects alive at once, most | 8 | 8 |

Where it goes: the VICE monitor's profiler (`prof`, rung 1) put
`objects_update` at 3,118 cycles a call with 4.7 objects alive while every
object thought every frame, about 600 cycles per thinking object in
Oscar64 C (`attr_at` about 60 of them); `mux_build` at 945 cycles a call and
`mux_sort` at 413 in the final build. Thinking on alternate frames brought
the mean from 2,767 to 2,288 (PAL, the ENEMYTEST readout). A full pool of
11 would cost about 5,500 at worst (arithmetic from the per-object figure,
not measured).

What that leaves (arithmetic from the table):

- The logic frame: NTSC's worst is 8,397 of the about 14,000 cycles C has
  before line 250; about 5,600 remain for weapons, collisions and flow.
- The pre-redraw rule: the logic frame before a redraw ended 129 lines
  after line 250 on NTSC (limit 237).
- The redraw's NTSC lead: 13 lines, 5 above the verdict's floor of 8. The
  copy took 914 cycles more (15,231 - 14,317) and lost 14 lines of lead.
  Eight sprites need no zone IRQ, so that is the sprites' DMA on the lines
  the copy runs over (inferred, not separated). The music's line-250 cost
  comes off the same 5 lines (KB-GAPS.md 14).

Proof, `make enemies` (in `VERIFY_TARGETS`, 24 of 24 on PAL and NTSC):
the verdict (`main.c first_fail_enemies`) wants no frame lost and the
redraw's lead at least 8 lines; the 6 due events spawned, each on the frame
its row reached the top, none lost; shots fired (5) and grenades thrown (2);
a shot ended on a blocking cell (2); on every frame no free slot unparked
and the multiplexer's count equal to the slots above its cut; shown slots
on their map cells, redraw frames included (or counted as skipped); and
`obj_kill` on the runner alive at frame 120, dust for 24 frames, then free.
`expect-enemies.json` reads those rows and grades the grenadier of map row
66 where the arithmetic puts him after 107 lines of scroll (sprite Y 515 -
500 + 54 = 69, his purple at VIC x 304-313, lines 74-84, both models). The
`-dENEMY_FAULT=1` build (spawns a row late, freed slots left unparked, no
redraw-frame move) must fail: it read `ROW 03`, `PARK 101`, `LAG 003`, a
red border. A 2,545-frame drive of the normal build (`make drive`, up,
right, up, diagonals) scrolled 461 lines, fired 16 of the 21 events and lost
0 frames on each model (`$02FD`). `make mapend` builds without spawns
(`MAPEND`): its verdict text sits where the enemies of rows 4-16 walk.

## Weapons

Techniques: `facing_turn_step` (the shot's direction), `char_attribute_flags`
("Projectiles": bit 0 ends a shot, bit 1 gives it the canopy's priority),
`grenade_lob`, and `joystick_edge_detect`'s previous-frame test for one shot
per press. Built from those pages and the grenade-lob recipe's corner test.

Rules (weapons.h has the constants):

- **Fire.** One shot per press: `prev & ~joy`, bit 4. `weapons_reset` sets
  `prev` to all pressed, so the title's fire press fires nothing. Up to three
  shots, slots 1-3; a press with three flying is lost. A shot leaves the
  body centre, two frames' travel ahead, along `soldier_facing` at the
  press, from `vel_x/vel_y[16]` = round(20 sin a), -round(20 cos a) in
  quarter pixels: 5 pixels a frame straight, 4.9 on the in-between facings
  (arithmetic). It is drawn at ages 0-19, 10 to 105 pixels from the body
  centre straight (arithmetic; an earlier version said a range of 100
  pixels), and ends early on an
  `A_BLOCK` cell (outside the map is `A_BLOCK`) or above sprite Y 30 or
  below 187. Position in map quarter pixels, so a shot keeps to the ground
  as the view scrolls.
- **Throw.** SPACE or port-1 fire (main.c `port_read`: `$DC00` = `$7F`,
  `$DC01` bit 4, then `$DC00` = `$FF`) folded into joy bit 5, active low.
  `port_read` is `__asm`: Oscar64 compiled the C version's volatile
  accesses as `LDA $DC00`, `STA $DC00` #$7F, `STA $DC00` #$FF, `LDA $DC01`
  (build/run-and-gun.asm), so `$DC01` was read with no column selected and
  SPACE could never throw; port-1 fire hid it, since it pulls bit 4 low
  whatever the column. Bits 5-7 of `$DC00` are set before the fold: under
  VICE's Joyport I/O simulation device (`make drive`) `$DC00` read `$1F`,
  so bit 5 read as a throw held for ever and no press threw. The `__asm`
  body is about 47 cycles a frame with the call (arithmetic from the
  opcodes); only the normal build runs it, the autopilot builds replace it.
  One throw per press, when `grenades` > 0 (checked first) and slot 4 is
  free. The grenade flies straight up the map 2 pixels a frame for 30
  frames over everything, drawn small, medium, large, medium, small (5
  frames each). It lands 60 pixels above the throw and is a still blast
  for 16 frames, yellow and white, behind the canopy on an `A_BEHIND` cell.
  The count starts at 5 (flow.h) and `panel_grenades` rewrites its two
  digits on a throw.
- **Boxes.** A `Box` is map pixels `x..x+w-1`, `y..y+h-1`. Bullet: its
  4 x 4 dot, the bullet's point minus 2. Blast: `-12 < dx <= +12`,
  `-10 < dy <= +10` around the landing point (24 x 20, the burst sprite's
  size), corner form. `box_hit` and `box_has` subtract in 16 bits and
  compare unsigned per axis, so a box across map x 256, or one whose corner
  wraps below 0, tests right. The KB's grenade_lob page measures the 8-bit
  defect this avoids; the 16 tests in `make weapons` cover the edges, x 256
  and a corner below 0.
- **Frames that run no logic.** The frame after a redraw does not call
  `weapons_update`: shots and the grenade hold still for it and their
  sprites lag the scroll one line, as enemies do. A one-frame press that
  falls on it is not seen (the autopilot's taps while scrolling are two
  frames long).

Measured, VICE x64sc 3.10, PAL C64C and `-model ntsc`:

| What | PAL | NTSC | Instrument |
|---|---|---|---|
| `weapons_update`, worst frame (3 shots flying and a blast) | 1,780 | 1,780 | CIA1 timer B around its body (`-dWEAPONS=1`); it runs right after the line-250 wake, where no IRQ comes with 8 or fewer sprites |
| `weapons_update` with nothing flying | +123 over the slice | +123 | `make shot check` meter: worst 3,172 / typical 3,094 PAL, 3,197 / 3,116 NTSC, against 3,049 / 2,971 and 3,071 / 2,994 before |
| Logic frame, worst / typical, `make weapons` | 4,870 / 3,093 | 5,024 / 3,115 | the harness meter, first 200 logic frames (every shot and throw of the script's first part) |
| Redraw, most cycles, `make weapons` | 14,509 | 14,662 | CIA1 timer B (main.c `do_redraw`), against 14,101 and 14,317 with the soldier alone |
| Redraw's smallest lead, `make weapons` | 65 lines | 21 lines | verdict row 6, against 73 and 27 with the soldier alone |
| Logic before a redraw ends, lines after 250 | 76 | 75 | limit 286 (PAL), 237 (NTSC) |
| The frame after a redraw ends on line | 166 | 210 | limit 250 |
| Lost frames, late redraws, the first 200 logic frames | 0 | 0 | verdict row 7 |
| Lost frames, play frames 2-539 (the scrolling part with shots and a blast in flight included) | 0 | 0 | verdict row 17, `lost_all`: wait_frame's count, not stopped by the meter hold; the one wake after the meter's median is exempt (it loses 3 frames: measured with the exemption removed, `ALL 03 AT 201`) |
| `box_hit`, one call through a `__noinline` wrapper, pointer arguments | 275 | 275 | CIA1 timer B, IRQs off, line 16, the empty bracket subtracted |
| `box_has`, the same | 93 | 93 | the same |
| `panel_update` (score as unsigned long, lives, grenades) | 12,694 | | CIA1 timer B, IRQs off; why a throw calls `panel_grenades` instead |

The weapons add no interrupt work. What they cost the redraw is sprite
DMA: with up to four more sprites on the playfield during a copy, the
NTSC lead fell from 27 to 21 lines (about 345 cycles, the redraw's own
figure). The enemies and the music now share about 21 NTSC lines, not 27.
A collision pass over 3 shots and 11 pool objects with `box_hit` would
be about 33 x 275 = 9,000 cycles (arithmetic): use `box_has` on a point,
or test inline on local copies, and measure it.

`make weapons` (`-dWEAPONS=1`, src/weapons_test.h: script and verdict,
graded by expect-weapons.json, 36 of 36 on PAL and NTSC). Each expected
figure, from the map and the script (play frame n is script entry n + 3):

- Shot 0, frame 5, facing 0: the body centre is map (156, 723) (view
  y 607, soldier at 168, 160), the muzzle 713; 5 pixels a frame meets the
  sandbags' row 82 (y 656-663) at 663 on its 10th frame: `E 2`, `A10`.
- Fire held on frames 6-35: no shot. Shot 1 is the next press, facing 4
  after four frames of right, `vel 20, 0`; it runs its 20 frames (`E 1`).
- Shot 2, facing 6 after two frames of down, `14, 14`: past sprite Y 187
  on its 6th frame (`E 3`).
- Facing 12 after six frames of left; presses on 54, 56, 58, 60. On 58 the
  three slots hold shots 1, 3 and 4 (shot 1 is 18 frames out): lost,
  `LO 1`. On 60 shot 1 ends at its 20th frame before the press is read, so
  shot 5 takes its slot.
- Shots: 6 in those presses, 3 while the throw is held (95, 97, 99), 12
  taps while scrolling (every 8 frames, 20-frame life: never more than
  three flying), one on 531: `SH 22`.
- Grenade 1: thrown on 62, lands on 92 (+30), gone on 108 (+16), 60 pixels
  up, 16 blast frames: `G 062 092 108 60 16`. Throw held to 110: no second
  throw. Throws on 112, 162, 212 and 504; the press on 130 finds grenade 2
  in the air (`B 1`); the press on 536 finds none left (`E 1`), and the
  count stays 0: `T 5`, `GRENADES 00`.
- The walk: from Y 162 the soldier takes 52 frames to the threshold, then
  13 scroll steps and 10 blocked frames at the sandbags; 70 right to X 236
  (he had moved 4 right and 6 left); 114 frames up: `WY 480`, `ST 127`,
  15 redraws.
- The freeze, frame 540 (539 the last run): the shot from 531 is 8 frames
  out, sprite Y 110 - 10 - 40 = 60, X 236. Grenade 5 was thrown on 504 at
  the threshold and the view scrolled 16 lines after it: sprite Y 110 + 10
  - 60 - 10 + 16 = 66. Its blast has run 539 - 504 - 30 - 2 light frames
  = 3 frames: the white phase. On screen: the shot's yellow dot at VIC x
  246-249, lines 69-72; the blast's white at x 236-257, lines 70-85.
- The collision accessors at the freeze (verdict row 17, `ACC 6`): the
  live shot's `weapons_bullet_box(0)` is its slot's point minus 12 + 2 in
  X and minus 44 + 2 in Y plus `scroll_wy`; bullets 1 and 2 have no box;
  `weapons_blast_box` is slot 4's point minus 12 + 11 and 44 + 9 plus
  `scroll_wy`, 24 x 20; after `weapons_bullet_spent(0)` bullet 0 has no box
  and its slot is parked (X 356, Y 255), and spending it again changes
  nothing. With the bullet box one pixel left and `weapons_bullet_spent` a
  no-op, the verdict read `ACC 2` and failed. The row-16 slot values are
  taken before the spend.
- `make weaponsfault` (`-dWEAPONS_FAULT=1`: fire on the level, an
  autofire): red border, `SH 33`, `F 000000`; check.py fails it.

In the normal build, `make drive` with fire held for 36 frames after a tap
showed slot 1 at Y 145 then 125 (5 a frame) and parked again, slot 2 never
used: one shot per press on the real `$DC00`. Port-1 fire was driven
through drive.py's `Vice` class with `-controlport1device 37` and the
monitor's joyport command on port 0: two 3-frame presses on the normal
build took the panel from `GRENADES 05` to 04, then 03. SPACE was not
measured: no instrument here presses a key in the matrix (the monitor's
keyboard feed and `-keybuf` fill the KERNAL queue, which this game never
reads). Its path rests on the emitted order in build/run-and-gun.asm
(`LDA #$7F`, `STA $DC00`, `LDA $DC01`, `AND #$10`, then `LDA #$FF`,
`STA $DC00`).

## Decisions and open questions

- Oscar64 with a KickAssembler blob, the shmup-vertical layout: the band,
  the multiplexer and the redraw need exact cycles and no zero page; the
  game's rules are C that the next modules extend. The briefing's split
  agrees, and adds the redraw here (KB-GAPS.md 8).
- The loop wakes at line 250, after the frame IRQ applied what the last
  frame committed. A commit is one store of two bits, YSCROLL and the
  sprite table, so the soldier and the ground move in the same frame.
  Waking at the band's tick (224) instead, as the redraw recipe's loop
  does, gives a frame 26 lines to commit before line 250.
- The redraw pair: the logic frame in which YSCROLL wraps commits YSCROLL
  0 with its sprites, waits for the band's tick on line 224 (row 20 was
  fetched by line 215 at YSCROLL 7), and calls `redraw`. The frame IRQ
  applies YSCROLL 0 during the copy. The next frame wakes late (the copy
  ends on line 135 or 181) and runs no logic: it repeats the scroll step
  if the soldier's up probe is still free and commits YSCROLL only. So the
  scroll keeps 1 line a frame, and objects on the ground lag one line for
  that one frame (Commando skips its sort on coarse frames too; the
  archetype page). `objects_scroll` is where the enemies module may fix
  that if it fits. It does on PAL and not on NTSC (section "Enemies").
- Sprites stop at Y 187 (last line 208), three lines above the band IRQ.
  The band's windows were measured in its recipe with one sprite across
  them, not eight; `make phases` checks one sprite at 187.
- Priority is one probe at the body centre (sprite pixel 12, 10); Commando
  takes one cell ahead (char_attribute_flags page). Blocking is the feet
  box's leading edge, X then Y, so a diagonal push slides along a wall.
- The facing turns one step a frame toward the stick (a tie turns
  clockwise); the body frame is the facing rounded to eight. The walk
  cycle steps every 6 moved frames.
- Open: the enemies' zones and the music both come out of the redraw's
  NTSC lead (27 lines). Measured after the enemies: 13 lines with eight
  sprites up (section "Enemies"), 5 above the verdict's 8-line floor. The
  music does not ("Audio"); an earlier version of this item said it did.
  The frame IRQ after a redraw can run its audio to about line 20 of the
  next NTSC frame ("The worst frame IRQ"): no zone may be due above that.
  The combined figures are in "Combined budget". A `DEADLINE_LINE`
  (harness `make watch`) of 224 would check the pre-redraw rule on every
  frame; it needs an `OVERRUN` build and is not wired yet.
- Open: the README gallery and the archetype page's `**Starter:**` line
  for this starter land with the merge (the README belongs to another
  session; the archetype line needs an ingest).
