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

This build has the scroll, the redraw, the band and panel, the multiplexer
with parked slots, the soldier, the enemies ("Enemies"), his weapons
("Weapons"), the tune and effects ("Audio"), the front end ("Front end"),
and since wave 2 the collisions ("Collisions"), death with checkpoint
restarts and a deadly swamp ("Death and checkpoints") and the area end:
the gate wave, the walk into the gate and the next area ("Area end").
"Combined budget" measures all of it together.

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
| Logic frame, worst | 3,097 | 3,120 | harness meter: C's bracket (CIA2 timer A) plus every IRQ outside it (CIA2 timer B, kernel.asm) |
| Logic frame, typical (median) | 3,016 | 3,039 | the same |
| Redraw, most cycles | 14,100 | 14,313 | CIA1 timer B around `redraw`, wall time, IRQs that land inside included (main.c `do_redraw`) |
| Redraw ends on line (next frame) | 135 | 181 | `$D011`/`$D012` at its end (kernel.asm `redraw_end`) |
| Redraw's smallest lead over the beam | 73 lines | 27 lines | row 20 is fetched on line 208 at YSCROLL 0; 208 minus the end line |
| Logic before a redraw ends, lines after line 250 | 51 | 50 | limit 286 (PAL) and 237 (NTSC): the band's tick on line 224 |
| The frame after a redraw ends on line | 161 | 205 | limit 250, the frame IRQ |
| Lost frames | 0 | 0 | wait_frame's count; also 0 in a 2,500-frame drive of the normal build that scrolled 397 lines (49 redraws), each model |

The logic frame rows were 3,049 / 3,071 worst and 2,971 / 2,994 typical
before the front end; its `flow_frame` (the panel's changed-field compare)
added 45 to 49 cycles a frame ("Front end", below). The redraw and its lead
did not move: the front end adds no IRQ work.

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
- The redraw frame ends its work before line 250, or the redraw is late.
  An earlier version of this rule said before line 224, when the redraw
  waited for the band's tick; it now starts at line 64 ("Combined budget").
- Every cycle an IRQ or sprite DMA spends while the redraw runs comes off
  its lead. The music is held off the redraw frame ("Audio" below).
  Measure the lead again (row 6 of the verdict, `make longplay`) after
  adding zones or work to the redraw pair.
- The frame after a redraw now runs the weapons, collisions and rules
  ("Combined budget"); an earlier version of this line said it ran no
  logic. It must end before line 250 (verdict row 8 `LF`).

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
| `$2000-$7FFF` | C code, data, stack. `#pragma heapsize(0)` and `stacksize(1024)` (main.c): nothing calls malloc, and with the default 8 KB heap and 4 KB stack the test builds' code no longer fitted ("Cannot place heap section"). Code, data and BSS end at `$522E` in the normal build and `$6C0B` in `make weapons`, the largest |
| `$8000-$83E7` | the one screen: playfield rows 0-20, panel rows 21-23 (VIC bank 2) |
| `$83F8-$83FF` | sprite pointers |
| `$8400-$87FF` | scratch: the meter's readout row in AUTOPILOT builds, copied after the verdict |
| `$8800-$8FFF` | characters: 0-63 copied from the ROM at start-up, 64-254 the jungle (116-117 the swamp, `A_DEADLY`), 255 the title logo's solid block `G_SOLID` (src/gen/charset.bin) |
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
written once; the redraw never touches it. The playfield's `$D021`,
`$D022` and `$D023` are bytes in the blob (`pf_bg`, `pf_mc1`, `pf_mc2`)
that the frame IRQ applies with the YSCROLL it commits, so an area's
colours change on the frame its view does (area.c `area_begin`); an
earlier version stored constants. `$02FF` is the verdict,
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
| Scroll | scroll.c/h | the view: `scroll_top`, `scroll_ys`, `scroll_wy` | `scroll_step`, `scroll_can_step`, `map_x`, `map_y`, `attr_at`, `code_at`, `scroll_init(top, ys)`, `scroll_restart(top)` (a restart's view, drawn by main.c's redraw path) |
| Soldier | soldier.c/h | slot 0, the stick | `soldier_x`, `soldier_y`, `soldier_facing` (0-15), `soldier_behind`, `soldier_deadly`, `soldier_state` (alive, dead, gone) and `soldier_t`; `soldier_update(joy)`, `soldier_draw` (the death animation: a spin, then dust), `soldier_walk(x, y)` (the gate walk) |
| Objects and enemies | objects.c/h, spawns.h | slots 5-15, the pool, the spawn list | `obj_alloc`, `obj_free`, `objects_rows(top)` (wave_director: spawns keyed to map rows, fired as the top row reaches them), `objects_update` (writes the slots), `objects_draw` (empty), `objects_hold` (the redraw pair: no think, slots follow the ground); for collide: `kind_box`, `kind_flags`, `obj_kill(slot)`; for the gate wave: `objects_spawn`, `objects_alive`, `objects_count`; `objects_on_time` (main.c: the deadline may act); objects keep map coordinates in whole pixels (quarter pixels before wave 2: every motion is whole pixels a tick, so the results are the same, `make enemies` 24 of 24) and draw at Y = my - scroll_wy + 54 |
| Weapons | weapons.c/h | slots 1-3 (bullets), 4 (grenade), decrements `grenades` | `weapons_update(joy)` (fire joy bit 4, throw `JOY_THROW` bit 5), `weapons_reset`; for collisions: `Box`, `box_hit`, `box_has`, `box_blast`, `weapons_bullet_box(i, &b)`, `weapons_bullet_spent(i)`, `weapons_blast_box(&b)`, and `weapons_live`, `weapons_bbox`, `weapons_bline` (each bullet's box as it is drawn, read without a call) ("Weapons", below) |
| Collision | collide.c/h | who hit whom | `collide_init()` once, `collide()` on logic frames after objects and weapons moved (never on the redraw frame); scores through `flow_add_score`, kills through `obj_kill`, deaths through `flow_player_died` ("Collisions") |
| Area | area.c/h | `area` (the counter), `area_phase`, the gate wave, the walk, the beat, the area's colours | `area_begin(n)`, `area_restart`, `area_frame` (play frames), `area_has_stick` (1 during the walk and the beat: no stick, no hit test) ("Area end") |
| Flow | flow.c/h | `score` (BCD, 3 bytes), `lives`, `grenades`, the death, the restarts, how a game ends | `flow_new_game`, `flow_frame` (the death's timer, then the panel fields whose value changed), `flow_add_score(bcd)`, `flow_player_died(cause)` (the death animation, then a life off and a checkpoint restart or game over), `flow_area_cleared` (a restart into the next area), `flow_restart` (main.c runs it as a redraw frame of its own when `flow_restart_due` is set), `flow_checkpoint(top)` ("Death and checkpoints"). An earlier version's hooks took a life at once and ended the game at the gate |
| Front end | front.c/h, hiscore.c/h | the front-end states (title, table, attract demo, game over, name entry), the high-score table | a module asks for a state in `state_next`; main.c runs its entry routine (`front_enter`, or `play_enter` for `ST_PLAY`) before the next frame; `demo` is 1 while `ST_PLAY` is the attract demo; `hs_rank`, `hs_place` |
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

Since collisions the graded walk runs with harm on: the rifleman of row 77
stops at the sandbags of row 82, which also stop his shots, and nothing
else reaches the soldier before the freeze (47 of 47 unchanged).

`node scripts/verify-templates.ts --only run-and-gun --selftest` in c64-kb
(the starter made into a fresh project outside the repo), after wave 2,
2026-09-26: `make all`, `make shot check` (47 of 47), `make disk`,
`make selftest`, and every `VERIFY_TARGETS` target: `mapend` (10), `enemies`
(24), `weapons` (36), `weaponsfault`, `audio`, `audiotest`, `frontend` (13,
17, 21 and 37), `fedrive`, `longplay`, `collide` (28), `death` (30), `area`
(10 and 22) and `fullpool` (10) pass; "verify-templates: 1 of 1 starters
passed". An earlier run (the front end) passed with 45 of 45 in the graded
shot.

## Front end

Built from `game_state_machine` and `front_end_and_attract`
(game-design/game-structure.md), `high_score_table_insert` (recipe
kickassembler/high-score-insert, ported to C in hiscore.c),
`decimal_print` (its BCD variation), `joystick_edge_detect`,
`joystick_autorepeat` and `attract_mode_input_replay`. Neither
game-design pattern lists this archetype, and the briefing proposed
none of them (KB-GAPS.md 13).

Command: `node src/cli.ts check-compatibility high_score_table_insert decimal_print joystick_edge_detect joystick_autorepeat attract_mode_input_replay frame_sync_loop`
said WARNINGS: `shared_register (soft)` on `DC00` between the three input
techniques and on `RASTER` with frame_sync_loop, the implied prerequisite
`lfsr_random`, and "not covered" for high_score_table_insert and
decimal_print. Here one read of `$DC00` a frame feeds all of them
(main.c `port_read`), and the demo is deterministic without a random
generator (KB-GAPS.md 15).

States (one byte, `state`; a module writes `state_next`; main.c runs the
entry routine before the next frame):

| State | Screen | Leaves |
|---|---|---|
| `ST_TITLE` | logo (rows 1-6), PUSH FIRE TO START, JOYSTICK PORT 2, the top score | fire: play; 500 frames idle: table, then the demo |
| `ST_TABLE` | HIGH SCORES, five rows, the new one yellow | fire: play; 400 frames idle: the demo (from the title) or the title (after an entry) |
| `ST_PLAY`, `demo` = 1 | the game fed a 485-frame recording, DEMO on the panel | a real fire press or the recording's end: title; nothing scored |
| `ST_OVER` | GAME OVER, the score | 150 frames (fire after 50): entry if `hs_rank` places the score, else title |
| `ST_ENTRY` | NEW HIGH SCORE, the score and its rank, three letters | three letters accepted, or 1,000 frames untouched (closed with the letters typed so far): table |

- The entry routine parks every slot, sets YSCROLL 3, clears the
  playfield and puts up the front end's panel (FIREBASE, no digits); the
  screen's text comes on the state's first frame, so neither half runs
  past the next frame IRQ. Every press waits for a release first (the
  latch), so the press that ended a state starts nothing.
- Name entry is a joystick letter wheel: up and down step A-Z and `.`,
  auto-repeat after 16 frames every 5; fire or right accepts; left goes
  back. The KB's `text_input_line` needs GETIN and the KERNAL, which is
  banked out here (KB-GAPS.md 14).
- The table: five rows of three screen codes and three BCD bytes, the
  recipe's layout and tie rule (an equal score goes below its holder),
  seeded at boot with original initials, 50,000 down to 10,000. Not saved.
- The score is BCD, three bytes, added in C a nibble at a time with no
  `SED` (pitfall `decimal_mode_in_irq_handler` cannot arise); printed a
  nibble a digit. `flow_frame` redraws a panel field only when its value
  differs from the one drawn.
- The logo is FIREBASE in a 3 x 5 block font with a drop shadow, drawn by
  tools/mkassets.py (`make_logo`, src/gen/logo.bin) from one new glyph,
  255, all pixels set, in hires cells (colour RAM below 8).

Measured (VICE x64sc 3.10, `make frontend`, CIA1 timer B wall time with
IRQs that land inside; its start/stop adds about 20 cycles):

| What | PAL | NTSC |
|---|---|---|
| `flow_frame`, worst (a death frame: 8,500 added, score and lives redrawn) | 836 | 836 |
| `flow_frame`, a frame with no change (the logic frame's rise over the slice, meter) | +45 to +48 | +45 to +49 |
| Play logic frame with forced deaths, worst / typical (meter, 100 frames) | 3,847 / 3,105 | 3,872 / 3,129 |
| A front-end frame, worst (the first, which draws the screen) | 7,955 | 8,211 |
| A front-end entry routine, worst | 8,090 | 8,350 |
| `hs_place` (rank 4 of 5: two rows shifted, one written) | 241 | 241 |
| IRQ cycles added | 0 | 0 |

The redraw's NTSC lead stays 27 lines (row 6 of `make shot check`'s
verdict). Before the split, one entry routine drew its screen too:
16,590 on PAL and 17,343 on NTSC, over the NTSC frame; the cell-by-cell
logo alone took 11,023 (a debug build timing each part) and `put_dec`'s
32-bit divide made `flow_frame`'s worst 2,095; both are replaced.

Checks (`VERIFY_TARGETS` runs both after selftest):

- `make frontend`: the `-dFRONTEND=1` autopilot build (`FORCE_OVER` on: a
  death every 40 logic frames, 8,500 points each) plays title, play,
  three deaths, game over, the name DAB, the table and the title, where it
  grades itself (main.c `first_fail`, FRONTEND): no play frame lost, the
  states in order (TPOEHT), score 025500 with no lives, the panel read
  025500 and 0 as the game ended, rank 4, the table equal to the expected
  one byte for byte (DAB fourth, SID fifth, VIC dropped), no sprite and no
  panel digit on the title, YSCROLL 3. expect-frontend.json grades that
  title (37 checks: the verdict rows, the prompt, the top score, the logo's
  colours and shadow by pixel, the band, the panel without digits);
  expect-fe-over.json (13), expect-fe-entry.json (17) and
  expect-fe-table.json (21) grade the game over, entry and table screens,
  each shot inside the same run at its own cycle count, in the middle of
  that screen's window on each model (a sweep of shots every 1,000,000
  cycles: game over PAL 6-8 million, NTSC 6-8; entry PAL 9-10, NTSC 9;
  table PAL 11-18, NTSC 10-16; title from NTSC 17). The FORCE_FAULT build
  files every score into row 0, the fault the technique names, and must
  fail expect-frontend.json (it does: RANK 1, border red).
- `make fedrive`: the `-dFORCE_OVER=1` normal build played by
  harness/drive.py on the real `$DC00`: the title idles into the table
  (505 frames) and the demo (400) and back to the title (485); fire; game
  over; DAB typed with taps; the table shows `4  025500  DAB`; the title;
  a second game ties 25,500, ranks 5 (below DAB: the tie rule), B is
  typed and the entry closes itself 995 frames later as `B..`.

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
- **The redraw frame.** Replaced at the merge ("Combined budget"): no
  object thinks on the redraw frame or the frame after it; `objects_hold`
  moves every shown slot with the ground on both, and main.c sorts. An
  earlier version moved them on the frame after only (`objects_scroll`,
  `actors_rebuild`, `LFX_LAST`), which did not fit on NTSC.
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
module's calls (timer B since the merge: the audio stopwatch in the frame
IRQ uses timer A), wall time (an IRQ that lands inside is counted), the first
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

## Collisions

Built from `per_frame_hitbox` (one box per kind, objects.h `kind_box`, from
the slot's own registers: what the last draw showed), `grenade_lob` (the
blast's corner box, tested every blast frame; a killed enemy is dust, no
longer shootable, so it dies once), `char_attribute_flags` (bit 2 under the
body centre kills) and `object_pool`. collide.c, once a logic frame after
the objects and weapons moved; never on the redraw frame (the budget split,
"Combined budget").

| Pair | Result |
|---|---|
| his bullet and a `KF_SHOOTABLE` object | the object dies (`obj_kill`), the bullet is spent; runner 150, rifleman 100, grenadier 200 |
| his grenade's blast and every `KF_SHOOTABLE` object in it | each dies, each scored |
| his body box (sprite pixels 8-15, rows 3-19) and a `KF_HURTS` object: an enemy (touch), an enemy shot, an enemy blast | `flow_player_died(DC_HIT)` |
| an `A_DEADLY` cell under his body centre (the swamp) | `flow_player_died(DC_TERRAIN)` |

No hit test runs on him while he is dead, during the gate walk and the beat
(`area_end_gate_wave`: "Skip the hit test"), or in `NO_HARM` builds (below).
A frame's kills are summed in tens and added once in BCD, with one
`SFX_KILL`; the attract demo scores nothing.

How a pair is tested, cheapest first: one byte of Y in sprite-line
coordinates (Y + row; every shown slot is at Y 0-187 and a box is at most 21
high, so the corner form cannot alias in 8 bits: arithmetic); one window of
lines that anything that hits covers, which drops most objects with one
compare; a 16-bit X corner test; then `box_hit` (weapons.h, the wrap-safe
corner form) confirms the pair. Half the pool is tested a frame, by pool
index against a frame count: an object is tested every second frame, in
which a bullet moves 10 pixels against the 17 lines a bullet and the
smallest shootable box (the runner, 13 rows) share, and an enemy shot 3
pixels against his 17 rows, so nothing passes through (arithmetic from the
speeds). The deadline: a pass that would start after line `COLLIDE_LATE`
(100) is skipped and its half kept for the next frame, so an object waits
three frames (15 pixels of a bullet, still under 17); never two skips in a
row.

Why it looks like this, each step measured on `make weapons` NTSC (the
densest scene: ten sprites, three shots, a blast, scrolling):

1. Every object, full 16-bit boxes, `box_hit` per pair: one call cost 1,379
   cycles with interrupts off at the freeze (10 objects, a bullet, a blast);
   16 frames lost from play frame 454, the frame after a redraw ending on
   line 241 against 197 before collisions.
2. Half the pool a frame: 778; the bullets' live mask and a skipped pass
   when nothing can hit: 568; each bullet's box kept by weapons.c as it is
   drawn (`weapons_bbox`), no call and no shifts: 1 frame lost.
3. The deadline, at line 170 with a whole-pool catch-up: still lost (the
   catch-up landed late in the next heavy frame); keeping the parity and
   skipping at 110, then 100: 0 lost.

The in-game stopwatch (`col_worst`, CIA1 timer B) is wall time: the zone
and band IRQs and the sprite DMA of the lines the pass runs over are in it,
which is why it reads 2,000-4,000 where the pass itself is a few hundred.
The VICE monitor's profiler (`prof on`, `prof flat` over the remote
monitor, rung 1) gives the pass's own share.

| collide() (VICE x64sc 3.10) | PAL | NTSC | Instrument |
|---|---|---|---|
| one pass, 4 pool objects, no bullet, interrupts off in the border | 465 | 465 | `make collide` verdict row 9 (`BENCH`) |
| average a frame, `make weapons` frames 416-533 | | 660 | profiler, 77,273 cycles over 117 frames |
| average a frame, `make fullpool` frames 268-464 | | 750 | profiler, 147,087 over 196 frames |
| worst wall time, `make weapons` / `make collide` / `make fullpool` | 2,541 / 3,215 / 3,451 | 2,383 / 3,494 / 3,086 | `col_worst`, IRQs and DMA inside |
| passes skipped by the deadline, `make weapons` / `make area` / `make fullpool` | 1 / 2 / 3 | 39 / 45 / 40 | `col_deferred` |

`make collide` (`-dCOLLIDETEST=1`, src/collide_test.h, expect-collide.json,
28 of 28 on PAL and NTSC): the normal start, harm on. Taps up while the
runner of row 88 crosses his column (150); right to X 300, up 8 to face up,
a grenade whose blast lands on the grenadier of row 84 (200, by the blast);
taps while the rifleman of row 77 follows him into them (100): `KILL 1 1 1
B 1`, `SCORE 000450`. Then up and standing: before the view moves (top 75)
the blast of a grenade the grenadier threw before he died bursts on him, a
hit (play frame 413 in VICE, not pinned: it moved a frame with the code's
layout); after `DEATH_FRAMES` the restart puts the view at row 75, the first
checkpoint at or behind 75, with the window's three events again, grenades
4 to 5, lives 2. The grenadier the blast killed is back on screen where the
arithmetic puts him (sprite X 312, Y 659 - 607 + 54 = 106: purple at VIC x
320-329, lines 112-121, both models).

`NO_HARM` (game.h): nothing kills the soldier in the forced-death builds
(`make frontend`, `make fedrive`: their score must be exact), `make weapons`
(its script stands under fire for 260 frames; pinned before collisions: it
lost two lives), `make area` and `make fullpool` (they grade the gate
sequence and the budget; an aimed shot killed him on play frame 78 of the
wave). Bullets and blasts still kill enemies in all of them; `make collide`
and `make death` prove the deaths.

## Death and checkpoints

Built from `checkpoint_respawn` (techniques/logic.md and its recipe) and
`char_attribute_flags` (the deadly bit).

- **The table.** tools/mkassets.py `CHECKPOINTS`: map rows 16, 40, 60 and 75
  (the area's start, last), written to src/gen/assets.h. The restart row is
  the first entry at or above the view's top row (the row counts down as he
  advances, so behind is larger). The soldier restarts at sprite (168, 160):
  mkassets asserts that each pad (rows +13 to +17, columns 17-21) holds
  nothing that blocks or kills.
- **The death.** `DEATH_FRAMES` 64 logic frames (Commando's is 80 frames,
  techniques/logic.md): the world keeps moving; he spins, a body frame
  every 2 frames, red and white by turns, for 40, then shows dust. No stick,
  no fire, no scroll. At the end a life is taken; at none, game over into
  the front end (the demo goes to the title).
- **The restart** (`flow_restart`) runs on its own frame, as a redraw frame:
  `scroll_restart(row)` commits YSCROLL 0 at the new row and main.c copies
  the view from line 64 with the redraw, which stays behind the beam, so
  the old view shows until the frame IRQ applies the new one and nothing is
  blanked. The pool is cleared and `objects_reset` re-spawns the window
  from the spawn list; the soldier stands at his start; the weapons are
  cleared; grenades are topped up to 5, never lowered; the gate phase starts
  over. Score and lives stay.
- **The swamp.** Glyphs 116-117, `A_DEADLY`, map rows 45-47, columns 7-14,
  placed after the scatter over floor cells only (mkassets asserts it), so
  no feature the autopilot scripts meet moved. Riflemen do not walk into it
  (objects.c `walk_blocked`); shots and grenades fly over it. The palette
  has no blue (one colour RAM value for the playfield): the water is black
  with light-green ripples.

| | PAL | NTSC | Instrument |
|---|---|---|---|
| `flow_restart`, worst of two | 1,480 | 1,480 | CIA1 timer B (`make death` row 17) |
| the restart's redraw: smallest lead | 231 lines | 189 lines | row 17 `LD` |
| lost frames, the whole run with three deaths and two restarts | 0 | 0 | row 16 |

`make death` (`-dDEATHTEST=1`, src/death_test.h, expect-death.json, 30 of 30
on PAL and NTSC): the view starts at checkpoint 40, no spawn-list enemies.
Two grenades (5 to 3); up 60 frames (50 to the threshold, 10 lines of
scroll: top 39, YSCROLL 2, his body centre on map row 47); left until his
body centre is on column 14 (X 131): dead on the swamp, cause 2. The
restart comes 64 frames later at row 40 (the first checkpoint at or behind
39), grenades 3 to 5, lives 2; the restart's redraw put map rows 40 and 60
on screen rows 0 and 20; he stands at (168, 160). One grenade, the same
walk: 4 to 5, lives 1. The third death ends the game: the build freezes as
the game asks for game over. The swamp's rows where the arithmetic puts
them at top 39, YSCROLL 2 (map y 317 on line 55: row 45 on line 98, row 47
on 114), his dust at VIC x 135-150, lines 115-126 (a sprite at X 131, Y 110).

The front end's forced deaths (`FORCE_OVER`) now run the death animation
and the restarts, so its game over comes on play frame 314, not about 135:
the `make frontend` script plays 340 frames of play and every pin moved 179
frames (3.5 million cycles on PAL, 3.1 on NTSC), each checked by a shot.
The script's counts are bytes: a first try with 340 and 300 wrapped to 84
and 44. A lost frame is now counted only in play: `counting` stayed set
when a game ended, and the front end's entry routine (up to 8,350 cycles)
counted as lost in `LOST_FRAMES` once deaths could end a driven game.

## Area end

Built from `area_end_gate_wave` (techniques/logic.md and its recipe),
`lfsr_random` (the recipe's 8-bit Galois LFSR, seed `$A5`, taps `$B8`) and
`object_pool`. area.c.

| Phase | Begins | What runs |
|---|---|---|
| scroll | the area's start, every restart | the game; the check `scroll_can_step() == 0` with the soldier alive |
| wave | the scroll stopped at map y 0 | `WAVE_N` = 6 + 2 x area (to 12) soldiers; each free pool slot rolls once a frame and spawns when `roll & 31` is 0 (the recipe's rule: a full pool slows the wave); a second roll gives X 132-194 and the kind (grenadier when its top two bits are set, else rifleman), feet on map row 4 under the gate |
| walk | `tospawn` 0 and `objects_alive()` 0, recounted from the pool every frame | no stick, no hit test, no terrain test: 1 pixel a frame to X 168, then up to Y 52, in the gate's opening |
| beat | the arrival | 2,000 points, the soldier gone (parked), AREA CLEARED and BONUS 2000 for 100 frames |
| next area | the beat's end: `flow_area_cleared` | a restart: the map from row 75, the next area's colours, fire and throw periods halved (to a quarter from area 2: Commando's per-area fire masks `$3F`, `$1F`, `$0F`), grenades topped up |

Colours: area 0 is the jungle (earth brown, highlights light green), area 1
the same map burnt (medium grey, light grey), area 2 the jungle again. A
death during the wave restarts at checkpoint 16 and the wave comes out
whole again (Commando resets its count at every respawn).

`make area` (`-dAREATEST=1`, src/area_test.h, expect-area.json, 22 of 22;
expect-area-beat.json, 10 of 10, on PAL and NTSC): 7 lines from the top,
the soldier on the threshold, no spawn-list enemies, `NO_HARM`. Up: map y 0
on play frame 7, the wave begins that frame; down to the sandbags of map
row 14 (Y 145), 8 frames up to face up (Y 137), taps. All 6 spawned, 6
riflemen shot; the walk begins as the last dies (frame 125 on PAL, 126 on
NTSC, one deferred collision pass) and arrives 86 frames later (85 pixels,
Y 137 to 52, and the arrival frame); the beat lasts 100. Score 2,600 (600
and the bonus). Area 1: the map from row 75, `pf_bg` 12, `pf_mc1` 15, the
soldier at his start, the screen equal to the map; the grey earth on map
row 91's floor cells (lines 176-183) and a canopy drawn only in black, green
and light grey (no light green left). The beat is shot inside the same run
at 8,600,000 cycles on PAL and 8,100,000 on NTSC, the middle of its window
(a sweep every 1,000,000 cycles), before the build draws its verdict:
`make cleared` keeps the PAL one for the README.

`make fullpool` (`-dFULLPOOL=1`, 10 of 10): area 3's wave (12, more than
the 11 slots) under the normal rule; he holds fire 250 frames while the
riflemen gather 56 pixels above him, then fires taps and throws a grenade
every 50 frames. The pool reached 11 of 11, all 12 were shot, and no frame
was lost on either model. The first version (every free slot spawning
every frame, 40 soldiers) is more than the game can produce and lost 20
NTSC frames; this is the game's own worst case.

## Combined budget

Measured at the merge of enemies, weapons, audio and the front end (VICE
x64sc 3.10). "Before" is the merge as it came together (5cdb017): the
redraw waited for the band's tick on line 224 and copied at 14 cycles a
byte, and the whole game's logic ran on the redraw frame. `make weapons`
is the heaviest run here: enemies spawning, shots and grenades, the music
and effects, and 15 redraws while firing.

| | PAL before | PAL now | NTSC before | NTSC now | Instrument |
|---|---|---|---|---|---|
| Logic frame, worst / typical, `make shot` | 9,598 / 6,354 | 9,401 / 6,323 | 9,739 / 6,636 | 9,816 / 6,662 | harness meter, first 200 logic frames (verdict row 9) |
| Logic frame, worst / typical, `make weapons` | 9,675 / 6,396 | 9,714 / 6,434 | 10,236 / 6,772 | 10,280 / 6,796 | the same |
| Redraw, most cycles, `make weapons` | 16,016 | 16,106 | 17,533 | 16,063 | CIA1 timer B, IRQs inside included (row 6) |
| Redraw's smallest lead, `make weapons` | 42 lines | 195 lines | 0 lines | 159 lines | row 6 `LD`: 208 minus the end line, per frame |
| Redraw's smallest lead, `make shot` | 65 lines | 221 lines | 13 lines | 180 lines | the same |
| The frame after a redraw ends, latest, `make weapons` | 246 | 135 | 245 | 197 | row 8 `LF`, limit 250 |
| Lost frames, `make weapons` (whole script) | 2 | 0 | 6 | 0 | row 17 `ALL` |
| `make longplay`: lead / lost frames | 58 / 0 | 211 / 0 | 4 / 0 | 168 / 0 | the normal build driven 2,700 frames, 607 lines, 75 redraws, 20 shots; RAM counters |

The meter covers the first 200 logic frames only: `make shot`'s include
13 redraws and no fire, `make weapons`' every shot and throw and no
scroll. The redraw pair itself is measured by rows 6 and 8 and by
`make longplay`. Before the change the NTSC lead in the longplay was 4
lines, under the verdict's floor of 8; `make weapons` lost frames on both
models.

Where the redraw frame's time went, before (NTSC, a raster-line trace of
each call on the redraw frames of `make weapons`, a scratch build, most
lines): soldier 13, spawns 9, `objects_update` 73, weapons 27, collisions
and rules 8, draws 9, sort and build 65. That logic ended on line 202 at
worst; the copy (17,533 cycles, 270 lines) then ran past line 208 of the
next frame. The CPU had idled from the logic's end to line 224.

What changed, each step measured on `make weapons` before the next:

1. **The redraw starts at line 64** (main.c `RD_FIRST`), not at the band's
   tick. A row may be rewritten once the beam has fetched it this frame;
   row 0's badline is line 55 at YSCROLL 7. The copy is slower than the
   beam (below), so it stays behind it. Alone this gave PAL 83 lines of
   lead and NTSC 0 with 11 lost frames: the logic still ended as late, and
   a copy longer than a frame met the band IRQ twice.
2. **The redraw pair splits the logic.** The redraw frame runs the
   soldier, the spawns and, when they end before line 64 (`HOLD_LINES`),
   the sprites' move with the ground and the sort; then the redraw. The
   frame after runs the repeat step, the move, the weapons, collisions,
   rules and the sort. No object thinks on either frame (`objects_hold`),
   so an object misses one think in eight frames while the map scrolls.
   After this: NTSC lead 79, 4 frames lost, the frame after ending on
   line 246.
3. **The copy moves two bytes a pass** (kernel.asm: bytes Y and Y + 20 of
   a row, 11.5 cycles a byte against the recipe's 14, 531 cycles a row
   with the patching). The redraw fell from 17,558 to 16,044 cycles in
   `make weapons` on NTSC, 16,132 to 14,802 in `make shot`.
4. **The sprites' move on the redraw frame only when it fits.** On NTSC
   the soldier's step ends about line 20, and the move and sort (up to 65
   lines) pushed the redraw and the frame after it as late. There the
   pool's slots keep last frame's lines for one frame and the frame after
   moves them two. After this the table above.

The trail over the beam: a scratch build stored each row's first raster
line (`$D011`, `$D012`) in the copy loop, and C took the least
`line - (55 + 8 x row)` over every row copied before line 250: 11 lines,
at row 0, on PAL and NTSC, in `make shot` and `make weapons` (220 to 242
rows traced a run). The copy never overtook the beam. By arithmetic the
rows fall further behind: 531 cycles a row is 8.2 NTSC lines against the
beam's 8, before badlines and sprite DMA.

The lead formula: an end on lines 250 to 311 (262), after the frame IRQ
that applied YSCROLL 0, still has that frame's line 208 ahead. main.c
took it as a frame late until this merge; a PAL copy started at line 64
ends there. Only the new start reaches it.

Not measured here: a 6569 (the PAL runs are the C64C model), and a full
pool of 11 with three shots and a blast on one redraw pair (no run here
arranges it).

Proof after the merge: `node scripts/verify-templates.ts --only run-and-gun
--selftest` in c64-kb made the starter a fresh project and passed `make
all`, `make shot check` (47 of 47), `make disk`, `make selftest`, and every
`VERIFY_TARGETS` target: `mapend` (10 of 10), `enemies` (24 of 24),
`weapons` (36 of 36), `weaponsfault`, `audio`, `audiotest`, `frontend` (13,
17, 21 and 37 of each), `fedrive` and `longplay`; "verify-templates: 1 of 1
starters passed".

### Wave 2: collisions, deaths, the area end

Measured with the three modules merged (VICE x64sc 3.10). "Before" is the
table above.

| | PAL before | PAL now | NTSC before | NTSC now | Instrument |
|---|---|---|---|---|---|
| Logic frame, worst / typical, `make shot` | 9,401 / 6,323 | 11,021 / 7,653 | 9,816 / 6,662 | 11,409 / 8,184 | harness meter, first 200 logic frames |
| Logic frame, worst / typical, `make weapons` | 9,714 / 6,434 | 11,722 / 7,192 | 10,280 / 6,796 | 11,198 / 7,696 | the same |
| Redraw, most cycles, `make weapons` | 16,106 | 16,054 | 16,063 | 16,089 | row 6 |
| Redraw's smallest lead, `make weapons` / `make longplay` | 195 / 211 | 200 / 226 | 159 / 168 | 159 / 178 | row 6, longplay |
| The frame after a redraw ends, latest, `make weapons` | 135 | 170 | 197 | 240 | row 8, limit 250 |
| Logic frame, worst / typical, `make fullpool` (11 of 11 slots) | | 13,691 / 11,517 | | 13,568 / 11,945 | its meter |
| Lost frames: shot, weapons, longplay, collide, death, area, fullpool | 0 | 0 | 0 | 0 | each verdict, `LOST_FRAMES` |

`make longplay` now drives the normal game with `START_LIVES` 99: the
soldier dies on the way (three lives ended it within 600 frames), and its
deaths and checkpoint restarts are inside the one game it measures. 2,700
frames: PAL 435 lines scrolled, 60 redraws; NTSC 376, 52.

What it took to keep NTSC's frames, each step measured:

- collide() as "Collisions" says: half the pool a frame, a Y window, the
  bullets' boxes kept by weapons.c, the deadline at line 100.
- Objects in whole pixels (behaviour unchanged): the mean of `make enemies`
  fell from 2,289 to 2,217 cycles on PAL (4,154 to 3,991 worst).
- The objects' deadline (objects.c `OBJ_LATE`, line 95): a thinking object
  whose tick would start later only follows the ground and thinks next
  tick, so under load the enemies slow down, not the frame. `make fullpool`
  lost 1 NTSC frame without it and none with it (60 ticks skipped, none on
  PAL). It acts only on frames that began on time (`objects_on_time`): the
  first frames after `play_enter` and the frame after the meter's median
  start anywhere, and there it changed the graded walk (43 of 47) for
  nothing.
- `objects_audit` (the enemies proof's per-frame checker, about 1,050 cycles
  a frame by the profiler) runs only in `make enemies`; it ran after the
  commit, so it lost no frame, but it is that build's instrument.

The NTSC margin is thin in `make weapons`: the frame after a redraw ended by
line 240. Work added to the logic frame should come with a deadline like
these two, or a measurement that it fits.

Proof after wave 2: `node scripts/verify-templates.ts --only run-and-gun
--selftest` (below, "Autopilot and checks").

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
- The redraw pair ("Combined budget"): the frame in which YSCROLL wraps
  runs the soldier and the spawns, moves and sorts the sprites if that
  ends before line 64, commits YSCROLL 0, and calls `redraw` at line 64.
  The frame after runs the soldier's repeat step, the weapons, collisions
  and rules. An earlier version waited for the band's tick on line 224,
  ran the whole game's logic before the redraw and none after it; with
  the four modules merged its NTSC lead fell to 0 lines.
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
  After the merge the redraw starts at line 64 and the NTSC lead is 159
  lines or more ("Combined budget"). A `DEADLINE_LINE`
  (harness `make watch`) of 224 would check the pre-redraw rule on every
  frame; it needs an `OVERRUN` build and is not wired yet.
- Open: the README gallery and the archetype page's `**Starter:**` line
  for this starter land with the merge (the README belongs to another
  session; the archetype line needs an ingest).
- Collisions run on the frame after a redraw, never on the redraw frame,
  as the weapons do; the pass tests half the pool a frame and skips itself
  past line 100 ("Collisions"). The objects skip ticks past line 95.
  Both make behaviour depend on time: two runs of one build are the same,
  but PAL and NTSC can differ by a frame (the area walk began on 125 and
  126). The checks grade counts and differences, not those frames.
- The gate walk ignores terrain, as Commando's is a script: from anywhere at
  the map's top he walks X first, then up; a tree in the way is walked
  through (rows 3-11 of the map keep columns 17-22 clear).
- The death takes a life at its end, not at the hit, so the panel and the
  game over follow the animation.
