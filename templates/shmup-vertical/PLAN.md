# Plan: shmup-vertical

A vertically scrolling shoot-em-up starter. The tool output below was
produced on 2026-09-23 by c64-kb 0.14.0 (KB data 760) and pasted whole.

## Concept

A river scrolls down one line a frame through all eight YSCROLL phases above
a fixed five-row score panel. The ship is a multicolour sprite on joystick
port 2; it fires character bullets. Enemies come in waves keyed to how far
the river has scrolled, fly bytecode paths, and go through a sprite
multiplexer, so eleven or more sprites share the screen. Hits are boxes per
sprite frame. A three-voice tune plays with the effects inside it. Three
lives, a score, a high score saved to drive 8. Title, play, game over, back
to the title. PAL and NTSC.

## Briefing

Command: `npx tsx src/cli.ts game-briefing "vertically scrolling shoot-em-up: playfield scrolls down over a fixed score panel, player ship sprite, more than 8 enemy sprites via multiplexer, waves triggered by scroll distance, character bullets, hitbox collisions, sound effects over a SID tune, lives and score" --archetype vertical_shmup`

What it proposed and what this plan did with it:

- Kept: `scroll_panel_split`, `soft_scroll_v`, `wave_director`, `object_pool`,
  `sfx_in_player`, `sid_play_routine_pattern` (its SID group), `per_frame_hitbox`
  (named in the brief, not proposed).
- Replaced: `sprite_multiplex_24` and `sprite_multiplex_8` by
  `sprite_multiplex_game`, the recipe built for a game (sort, double-buffered
  table, zone IRQs, late guard). `double_irq`, `stable_raster_irq` and
  `raster_bars`: the panel split polls and uses a delay table instead of a
  stable raster, as its recipe does.
- Added: `screen_double_buffer_d018` (a downward scroll cannot move rows
  ahead of the beam), `char_bullets` (in the brief, not proposed),
  `joystick_edge_detect` (fire on the title).
- Dropped: `text_mode_overlay_render` (a falling-block renderer),
  `mixed_sprite_char_actors`, `multi_sprite_object`,
  `sprite_collision_detect` (boxes are tested in software),
  `goattracker_player_api` and `sfx_engine_beside_music` (the player here is
  our own with the effects inside it).
- Its header said "Compatibility: incompatible" while its Compatibility
  section listed only soft shared-register notes (a tool finding).
- Pitfalls it named that this program meets: `badline_cycle_loss`,
  `scroll_phase_breaks_panel_split`, `d016_unmasked_rmw_clobbers_csel_mcm`,
  `vic_bank_visibility_collision`, `sprite_dma_overflow`,
  `sprite_x_high_bit_wrong_register`, `pal_ntsc_tempo_mismatch`,
  `sid_write_only_registers`, `decimal_mode_in_irq_handler`,
  `raster_irq_during_serial_io`.

## Techniques

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| scroll_panel_split | the score panel under a playfield that scrolls through every YSCROLL phase | kickassembler-scroll-panel-split | scroll_phase_breaks_panel_split, badline_cycle_loss, d016_unmasked_rmw_clobbers_csel_mcm, vic_bank_visibility_collision, idle_fetch_byte_shows_in_gaps, xscroll_applies_to_all_rows |
| soft_scroll_v | one line a frame through YSCROLL 0-7 | kickassembler-scroll-panel-split | badline_cycle_loss, full_field_redraw_exceeds_vblank, scroll_phase_breaks_panel_split |
| screen_double_buffer_d018 | the rows move down at the carry: draw the next screen hidden, flip with $D018 | kickassembler-eight-way-scroll (the idea), level.c | full_field_redraw_exceeds_vblank, vic_bank_visibility_collision, charset_blit_overruns_grown_code |
| screen_ram_relocation | prerequisite of the above: screens at $8000, $8400, $8800 in VIC bank 2 | oscar64-double-buffer | vic_bank_visibility_collision |
| sprite_multiplex_game | the ship and up to twelve enemies on eight sprites | kickassembler-sprite-multiplex-game | sprite_dma_overflow, decimal_mode_in_irq_handler, sprite_x_high_bit_wrong_register, sprite_x_range_hidden_and_seam, vic_bus_takeover_on_dma, sprite_registers_persist_across_state_change |
| wave_director | waves start at map rows, not frame counts; path bytecode | oscar64-wave-director | sprite_x_high_bit_wrong_register |
| object_pool | twelve enemy slots | oscar64-object-pool (inside wave-director) | sprite_x_range_hidden_and_seam |
| char_bullets | the ship's bolts and the enemies' dots as characters, merged into reserved glyphs (or a ready-made glyph over open water) | oscar64-char-bullets | charset_blit_overruns_grown_code, full_field_redraw_exceeds_vblank, petscii_written_to_screen_ram |
| per_frame_hitbox | a box per sprite frame; only pairs that can hurt each other | oscar64-per-frame-hitbox | sprite_dma_overflow, sprite_x_high_bit_wrong_register |
| sfx_in_player | effects take voice 3 inside the player and hand it back | kickassembler-sfx-in-player | sid_adsr_bug_8580, sid_write_only_registers, sid_voice3_disable_silent_bit |
| sid_play_routine_pattern | init + play, once a frame from the raster IRQ | oscar64-sid-music-player | pal_ntsc_tempo_mismatch, sid_filter_chip_variation |
| sid_voice_setup | prerequisite of the two above | oscar64-sid-music-player | sid_adsr_bug_8580 |
| joystick_edge_detect | fire starts the game once per press | oscar64-joystick-input, oscar64-headless-verify | cia1_ddr_cleared_kills_keyboard, joystick2_scan_phantom_press |

## Compatibility

Command: `npx tsx src/cli.ts check-compatibility scroll_panel_split soft_scroll_v screen_double_buffer_d018 sprite_multiplex_game wave_director object_pool char_bullets per_frame_hitbox sfx_in_player sid_play_routine_pattern joystick_edge_detect`

```text
# Compatibility: scroll_panel_split + soft_scroll_v + screen_double_buffer_d018 + sprite_multiplex_game + wave_director + object_pool + char_bullets + per_frame_hitbox + sfx_in_player + sid_play_routine_pattern + joystick_edge_detect

**Verdict:** INCOMPATIBLE — not as combined; each hard conflict below says how to separate them.

Checked with 2 implied prerequisite(s): screen_ram_relocation, sid_voice_setup.

Unit claims are stated for 4 of 11 techniques; a unit conflict cannot be ruled out for: soft_scroll_v, screen_double_buffer_d018, wave_director, object_pool, char_bullets, per_frame_hitbox, sfx_in_player, screen_ram_relocation (prerequisite), sid_voice_setup (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## shared_register (soft): scroll_panel_split × soft_scroll_v
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): scroll_panel_split × screen_double_buffer_d018
**Shared:** VMCSB, SCROLY
Both techniques touch register(s) VMCSB, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): scroll_panel_split × sprite_multiplex_game
**Shared:** vic_raster_irq
Both scroll_panel_split and sprite_multiplex_game own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** There is one raster compare. Run both as handlers in one interrupt chain (irq_chain_table): one technique owns $D012 and the other's handler becomes a chain entry that shares it.

## shared_register (soft): scroll_panel_split × sprite_multiplex_game
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): scroll_panel_split × char_bullets
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): soft_scroll_v × screen_double_buffer_d018
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_double_buffer_d018 × char_bullets
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_multiplex_game × per_frame_hitbox
**Shared:** MSIGX
Both techniques touch register(s) MSIGX. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sfx_in_player × sid_play_routine_pattern
**Shared:** SIGVOL, RESON, CUTHI, CUTLO, SUREL3, ATDCY3, VCREG3, PWHI3, PWLO3, FREHI3, FRELO3, SUREL2, ATDCY2, VCREG2, PWHI2, PWLO2, FREHI2, FRELO2, SUREL1, ATDCY1, VCREG1, PWHI1, PWLO1, FREHI1, FRELO1
Both techniques touch register(s) SIGVOL, RESON, CUTHI, CUTLO, SUREL3, ATDCY3, VCREG3, PWHI3, PWLO3, FREHI3, FRELO3, SUREL2, ATDCY2, VCREG2, PWHI2, PWLO2, FREHI2, FRELO2, SUREL1, ATDCY1, VCREG1, PWHI1, PWLO1, FREHI1, FRELO1. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.


## Not covered
- **wave_director**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **object_pool**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.

## Shared Infrastructure (info)
- **screen_ram_relocation** (prerequisite, not in the set): required by screen_double_buffer_d018; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sfx_in_player, sid_play_routine_pattern; included in the check as implied. Set it up first.
- **CHRIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHROUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CLRCHN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKOUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CLOSE** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **OPEN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETNAM** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETLFS** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **DC0F** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-vehicle-control, kickassembler-eight-way-scroll
- **DC07** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-vehicle-control, kickassembler-eight-way-scroll
- **DC06** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-vehicle-control, kickassembler-eight-way-scroll
- **SP6COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **SP5COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **SP4COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **SP3COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **SP2COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **SP1COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **SP0COL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup, oscar64-vehicle-control, oscar64-wave-director
- **DC03** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **BGCOL0** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-vehicle-control, kickassembler-eight-way-scroll, kickassembler-scroll-panel-split, oscar64-wave-director
- **EXTCOL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-vehicle-control, kickassembler-eight-way-scroll, kickassembler-scroll-panel-split, oscar64-wave-director
- **IRQMSK** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup, kickassembler-eight-way-scroll, kickassembler-scroll-panel-split
- **VICIRQ** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup, kickassembler-eight-way-scroll, kickassembler-scroll-panel-split
- **SPENA** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup, oscar64-vehicle-control, oscar64-wave-director
- **RASTER** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup, kickassembler-eight-way-scroll, kickassembler-scroll-panel-split, oscar64-wave-director
- **SCROLY** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup, oscar64-vehicle-control, kickassembler-eight-way-scroll, kickassembler-scroll-panel-split, oscar64-wave-director
- **MSIGX** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup, oscar64-vehicle-control, oscar64-wave-director
- **M0Y** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup, oscar64-vehicle-control, oscar64-wave-director
- **M0X** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup, oscar64-vehicle-control, oscar64-wave-director
- **RANDOM** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SIGVOL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **SUREL3** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **ATDCY3** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **VCREG3** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **PWHI3** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **PWLO3** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **FREHI3** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **FRELO3** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **SUREL2** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **ATDCY2** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **VCREG2** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **PWHI2** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **PWLO2** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **FREHI2** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **FRELO2** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **SUREL1** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **ATDCY1** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **DC02** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC00** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VCREG1** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **PWHI1** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **PWLO1** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **FREHI1** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **FRELO1** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-simple-shmup
- **READST** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SP7COL** (Register) shared via recipe(s): oscar64-simple-shmup
- **SPBGCL** (Register) shared via recipe(s): oscar64-simple-shmup
- **SPSPCL** (Register) shared via recipe(s): oscar64-simple-shmup
- **SCROLX** (Register) shared via recipe(s): oscar64-simple-shmup, kickassembler-eight-way-scroll, kickassembler-scroll-panel-split
- **RESON** (Register) shared via recipe(s): oscar64-simple-shmup
- **CUTHI** (Register) shared via recipe(s): oscar64-simple-shmup
- **CUTLO** (Register) shared via recipe(s): oscar64-simple-shmup
- **DD0E** (Register) shared via recipe(s): oscar64-vehicle-control
- **DD05** (Register) shared via recipe(s): oscar64-vehicle-control
- **DD04** (Register) shared via recipe(s): oscar64-vehicle-control
- **BGCOL3** (Register) shared via recipe(s): oscar64-vehicle-control
- **BGCOL2** (Register) shared via recipe(s): oscar64-vehicle-control
- **BGCOL1** (Register) shared via recipe(s): oscar64-vehicle-control
- **VMCSB** (Register) shared via recipe(s): oscar64-vehicle-control, kickassembler-eight-way-scroll, kickassembler-scroll-panel-split
- **DD0D** (Register) shared via recipe(s): kickassembler-eight-way-scroll, kickassembler-scroll-panel-split
- **DC0D** (Register) shared via recipe(s): kickassembler-eight-way-scroll, kickassembler-scroll-panel-split
- **DC0E** (Register) shared via recipe(s): oscar64-wave-director
- **DC05** (Register) shared via recipe(s): oscar64-wave-director
- **DC04** (Register) shared via recipe(s): oscar64-wave-director
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.

```

What the warnings mean for this program:

- `unit_contention (hard)` scroll_panel_split x sprite_multiplex_game on
  `vic_raster_irq`: resolved as the tool says, one chain. kernel.asm owns
  `$D012`: the frame IRQ (line 252) arms the multiplexer's zones, the last
  zone arms the split (line 204), the split arms the frame IRQ. Adding
  `irq_chain_table` to the list, the tool's own resolution, adds two more
  hard conflicts instead of clearing this one (a tool finding), so it is
  not listed; the verdict stays INCOMPATIBLE for the combination as named.
- `shared_register` SCROLY and VMCSB between the scroll, the split and the
  double buffer: the frame IRQ writes the playfield's `$D011` and `$D018`
  from two bytes C sets; the split writes the panel's. No other writer.
- `shared_register` VMCSB with char_bullets: the bullets never write
  `$D018`; they write the character set's reserved glyphs.
- `shared_register` MSIGX (sprite_multiplex_game x per_frame_hitbox): only
  the multiplexer writes `$D010`; the boxes are in half X and never need it.
- SID registers (sfx_in_player x sid_play_routine_pattern): one player
  writes a shadow and copies it to `$D400-$D418` once a frame.
- wave_director and object_pool: the graph holds nothing for them.

## Budget

Command: `npx tsx src/cli.ts plan-budget scroll_panel_split soft_scroll_v screen_double_buffer_d018 sprite_multiplex_game wave_director object_pool char_bullets per_frame_hitbox sfx_in_player sid_play_routine_pattern joystick_edge_detect --region both --sprites 5 --sprite-lines 63`

```text
# Budget plan: undetermined

Techniques: scroll_panel_split, soft_scroll_v, screen_double_buffer_d018, sprite_multiplex_game, wave_director, object_pool, char_bullets, per_frame_hitbox, sfx_in_player, sid_play_routine_pattern, joystick_edge_detect

## play (PAL, 19656 cycles a frame): undetermined

Range 26691-28709 + 1894 fixed cycles; floor 0; weakest basis arithmetic; IRQ slots 20.

Summed:
- scroll_panel_split: 413 (measured-vice, on kickassembler-scroll-panel-split (two IRQs, screen on; not the carry frame))
- sprite_multiplex_game: 16600 (arithmetic, on kickassembler-sprite-multiplex-game (worst frame: a reversed sort))
- wave_director: 1170-3188 (measured-vice, on oscar64-wave-director (worst frame, screen blanked))
- char_bullets: 3995 (measured-vice, on oscar64-char-bullets (eight bullets, worst frame))
- per_frame_hitbox: 3693 (measured-vice, on oscar64-per-frame-hitbox (eight boxes, 28 pairs))
- sfx_in_player: 493 (arithmetic, on kickassembler-sfx-in-player (increment over the player, worst effect frame))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))

Left out:
- object_pool: not added, inside wave_director's figure (Cost includes)

To measure:
- soft_scroll_v: no **Cost:** line; measure it on kickassembler-eight-way-scroll
- screen_double_buffer_d018: no **Cost:** line; measure it on kickassembler-eight-way-scroll
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-attract-replay

Notes:
- Fixed losses 1894 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 819; arithmetic) charged because sprite_multiplex_game, wave_director, char_bullets, per_frame_hitbox, sfx_in_player, sid_play_routine_pattern are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: scroll_panel_split was measured with the screen on and already holds the stalls that fell inside it, so the charge is too high by that much and the over test counts 0.
- The low end, 26691 + 1894, passes the 19656-cycle frame, but it is not a floor: the figures of scroll_panel_split, sprite_multiplex_game, wave_director, char_bullets, per_frame_hitbox, sfx_in_player, sid_play_routine_pattern are a common frame or a real run's worst, and those frames need not fall together. scroll_panel_split, sprite_multiplex_game, char_bullets, per_frame_hitbox, sfx_in_player, sid_play_routine_pattern have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: soft_scroll_v, screen_double_buffer_d018, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.

## play (NTSC, 17095 cycles a frame): undetermined

Range 26691-28709 + 1894 fixed cycles; floor 0; weakest basis arithmetic; IRQ slots 20.

Summed:
- scroll_panel_split: 413 (measured-vice, on kickassembler-scroll-panel-split (two IRQs, screen on; not the carry frame))
- sprite_multiplex_game: 16600 (arithmetic, on kickassembler-sprite-multiplex-game (worst frame: a reversed sort))
- wave_director: 1170-3188 (measured-vice, on oscar64-wave-director (worst frame, screen blanked))
- char_bullets: 3995 (measured-vice, on oscar64-char-bullets (eight bullets, worst frame))
- per_frame_hitbox: 3693 (measured-vice, on oscar64-per-frame-hitbox (eight boxes, 28 pairs))
- sfx_in_player: 493 (arithmetic, on kickassembler-sfx-in-player (increment over the player, worst effect frame))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))

Left out:
- object_pool: not added, inside wave_director's figure (Cost includes)

To measure:
- soft_scroll_v: no **Cost:** line; measure it on kickassembler-eight-way-scroll
- screen_double_buffer_d018: no **Cost:** line; measure it on kickassembler-eight-way-scroll
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-attract-replay

Notes:
- Fixed losses 1894 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 819; arithmetic) charged because sprite_multiplex_game, wave_director, char_bullets, per_frame_hitbox, sfx_in_player, sid_play_routine_pattern are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: scroll_panel_split was measured with the screen on and already holds the stalls that fell inside it, so the charge is too high by that much and the over test counts 0.
- The low end, 26691 + 1894, passes the 17095-cycle frame, but it is not a floor: the figures of scroll_panel_split, sprite_multiplex_game, wave_director, char_bullets, per_frame_hitbox, sfx_in_player, sid_play_routine_pattern are a common frame or a real run's worst, and those frames need not fall together. scroll_panel_split, sprite_multiplex_game, char_bullets, per_frame_hitbox, sfx_in_player, sid_play_routine_pattern have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: soft_scroll_v, screen_double_buffer_d018, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

No member states a byte figure that can be summed.

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
- Sprites: 5 a line on 63 lines, (3 + 2 × 5) × 63 = 819 cycles of DMA a frame (3 + 2n measured in VICE x64sc for sprites numbered without gaps).

```

Measured by the meter (`make shot check`, VICE x64sc 3.10, the script's
240 play frames): worst 11,678 cycles and typical (the median) 8,379 on
PAL; worst 11,873 and typical 8,734 on NTSC (after #107; 11,681, 8,374,
11,875 and 8,733 before it). The bracket is the C main
loop's whole frame (CIA2 timer A) plus every IRQ outside it (CIA2 timer B,
summed by kernel.asm); badlines and sprite DMA inside either are in the
figures. The split IRQ starts timer B only after its panel writes, so C
adds its first 289 cycles on PAL, 296 on NTSC (the largest of 245-289 and
246-296 measured under the VICE monitor from the IRQ sequence to the start
write). Not in the figures: about 45 cycles per other IRQ taken outside the
main loop's bracket (the entry before timer B starts and the exit after it
stops; arithmetic from kernel.asm), one to four a frame, nor the loop's
head (the wait, `level_frame`, the stick) and `meter_open`'s own
bookkeeping. A frame can therefore be lost with the meter below the frame:
at 7974a7a the staged run lost one on NTSC with its worst at 16,122. A frame
far past the frame reads about 65,524, because timer A counts down from
65,535 and wraps: that reading is a wrap, not a size. The meter's
readout is printed only after the freeze: printed every frame it cost up
to 3,404 cycles outside the bracket (measured in the review) and made the
autopilot build drop frames the game does not.

Enemy fire (ported from the other #39 version's design, in this code's
structure) raised the typical frame by about 2,400 cycles and the staged
worst past the NTSC frame at first (17,882). Four changes brought it back,
each measured with `make stage`: the bullet draw list in `glyph.asm`, the
enemies' dots stepped there too, `hit.asm` for the enemy boxes, `step.asm`
for the path step, ready-made glyphs for shots over open water (no merge),
and a three-row copy of 32 cycles a column (the other version's copy3).

Lost frames are counted by `wait_frame` (main.c) before it waits: a frame
flag already set means the work ended after the next frame IRQ. The first
version counted at wake-up, when the frame IRQ count had moved by more
than one, which a single lost frame never does: the review's mutation M8a
(one play frame about 2,400 cycles late) passed with `OVERRUNS 00`. The
count is `overruns` in the verdict and `LOST_FRAMES` at `$02FD` in every
build, which `make joytest` and `make longplay` read.

With that count, play on NTSC lost frames at 7974a7a where the staged run
never looked: held fire and a sweep of the ship (the review's drive: 6 of
15 games, at play frame 465 in 5; a build with `-dWORKEND=1`, 4 of 4, at
play frames 282-321 and 454-477), when the row-48 saucers and row-56 darts
are on the screen with bolts, dots and kills. The staged run records play
frames 150-399. The heaviest play frame, 464, measured by `-dPROFILE=1`
(each step with IRQs held off, NTSC): 15,385 cycles of steps at 7974a7a
(bullets 4,925, collide 2,387, waves 3,252, actors 3,035, render 1,572),
13,357-13,395 after these cuts, each checked by `make check`:

- The bolts' loop moved from C to `glyph.asm` (`bb_run`, with their boxes):
  bullets at frame 464 from 4,925 to 4,491 (PROFILE).
- `cb_draw` takes glyph addresses from two 256-byte tables: 35 cycles less
  a merge (arithmetic). It notes the map's code under a bullet only when
  `cb_keep` is set, in AUTOPILOT builds, whose verdict checks it: about 40
  cycles a draw (arithmetic).
- The dots against the ship moved to `hit.asm` (`dot_scan`); a dot that
  hits still takes the ship's box off before the enemies are tested.
- The path bytecode runs in `step.asm` (`en_paths`, `en_fetch`, with the
  explosions' timers); C calls `on_enemy_fire` for each enemy it lists.
  The scan and reads in C cost about 330 cycles an enemy that needed a new
  MOVE (PROFILE).
- `hit_scan` passes over an enemy whose lines miss every box that is on,
  and walks a list of the boxes that are on; a box spent by an earlier
  enemy is checked only on a hit.
- The score's digits change once a frame (`panel_update`), not once a kill.
- The spawner reads its wave through a pointer and adds the formation step
  to X, where it indexed the table and multiplied.
- The SID copy is unrolled: 200 cycles against 350 (arithmetic).
- The multiplexer takes 13 actors, not 16 (3 were never used), and its
  build loop keeps the write place in X: about 20 cycles an actor less
  (arithmetic).
- `eb_run` takes the dot's ready-made glyph from a table: 14 cycles a dot
  less (arithmetic).
- The frame IRQ skips the meter's hand-over in builds without the meter:
  about 60 cycles a frame (arithmetic).

One change was tried and taken out: drawing the hidden screen in pieces
wherever a frame had time left, instead of three rows on each of YSCROLL
0-6. In the heaviest stretch no frame had time left, so the pieces piled
onto the last frames before the flip, and the extra calls cost more: 20 to
56 lost frames in 40 s where the fixed schedule lost 2 to 4 (NTSC, the
same runs).

After the cuts, with `-dWORKEND=1` (the raster when a frame's work ended,
counted in lines after line 252): in 4 games of 40 s with a ship that is
never lost (`-dGOD=1`), the latest end on NTSC was line 254-256 of 263, at
play frames 464-472, and no frame was lost; on PAL 230-243 of 312. The
staged run's latest end on NTSC is line 249. `make joytest`: 16 of 16 NTSC
games and 16 of 16 PAL lost no frame; `make longplay`: 4 games a model of
about 39,000 (PAL) and 44,000 (NTSC) play frames, none lost.

Against the plan: the tool's range, 26,691-28,709 plus 1,894 fixed, is
well above the worst frame measured. Where they differ:

- sprite_multiplex_game, 16,600 (arithmetic): its recipe's worst case, 24
  actors with the sort order reversed. Here 13 actors, and the persistent
  sort sees a few swaps a frame: sort and build 2,800-3,300 with DMA
  (PROFILE builds, IRQs off, the staged frame and play's heaviest).
- char_bullets, 3,995: eight bullets. Here up to 3 bolts and 6 dots: the
  erase, the restore check and the draw, 2,300 on the staged frame, 4,000
  on play's heaviest.
- per_frame_hitbox, 3,693: 28 pairs of every kind. Here 12 enemies x 5
  boxes in `hit.asm` plus 6 dots against the ship: 1,500-2,600.
- wave_director, 1,170-3,188: here 2,000-3,000, twelve slots.
- Not in the tool at all: drawing three rows of the hidden screen (about
  1,700-1,900) and the actor hand-off to the multiplexer.
- soft_scroll_v, screen_double_buffer_d018, joystick_edge_detect have no
  Cost line; the meter covers them.

The graded script's worst frame is not the game's worst case. `make stage`
(-dSTAGE=1) plays a script that brings 12 enemies onto the screen at once
(the parade and the row-32 swoop), waits, and fires up a parade column, so
bolts, dots and a kill share those frames, and meters play frames 150-399.
Swept over 16 timings (-dSD=0,8,16,24 x -dSX=8,16,24,32), its worst frame
is 15,064 cycles on PAL and 15,237 on NTSC, typical 9,280 and 9,967 (SD 24,
SX 16, which `make stage` runs), and no run lost a frame. After #107
moved the split up 8 lines, that variant measures 15,066 and 15,241,
typical 9,289 and 9,973; the sweep was not re-run. At 7974a7a the
same sweep gave 15,991 and 16,136. It is not play's heaviest frame (above):
`make longplay` covers that. Its verdict fails on an overrun or an unrestored bullet cell,
and stage-expect.json on a worst over the frame. Before enemy fire the
review's sweep found 14,575 and 15,066. Two things the first version of
this plan got wrong: four bolts never fly at once (one shot per 7 frames,
a bolt lives at most 16: three, arithmetic), and the carry frame (YSCROLL
7) is the cheapest phase, because `level_render` does nothing on it.

The bullet draw must end before the beam reaches each cell it changes.
`-dDRAWEND=1` records the smallest number of lines between the raster
and the first line of each cell drawn, read after all the bolts and again
after all the dots (a lower bound: the bolts are drawn in `glyph.asm` now):
on NTSC 19 for a dot in the graded run and 25 in the staged run, 26 for the
bolts in both; on PAL the bolts were all drawn before line 0 and the dots
had 69 or more. At 7974a7a, read after each cell: 17 and 28. Frames that start
late for the harness (the first, the one after a meter_init, the ones where
the median is found) are left out; the enemy fire window, sprite Y 72-140,
is what keeps the dots below the draw.

## Memory and screen

- `$0801-$087F` Oscar64 startup; `$0880-$1FFF` the KickAssembler blob
  (`src/kernel.asm` with `mux.asm`, `sound.asm`, `glyph.asm`, `hit.asm`
  and `step.asm`: 5,162 bytes, to `$1CA9`); `$2000-$7FFF` C code, data and
  stack (code and data end at `$3D0C` in the release build).
- VIC bank 2 (`$DD00` bits 0-1 = 01): playfield screens at `$8000` and
  `$8400`, the panel screen at `$8800`, sprite shapes from `$A000` (block
  128), characters at `$B800`. The VIC sees the character ROM at
  `$9000-$9FFF`, so the level map (98 rows of 40 codes) lives there.
- `$8C00` row 13: the meter's scratch readout in AUTOPILOT builds, copied
  onto the playfield after the verdict.
- Characters: `$C0-$CF` a dot, `$D0-$D3` a bolt, over open water (no
  merge); `$F2-$F7` the dots' and `$F8-$FB` the bolts' reserved glyphs;
  `$FF` blank (the idle byte).
- Colour RAM: rows 0-19 `$0F` (multicolour, yellow), rows 20-24 white:
  the panel shows rows 19-23, and the rule on row 19 shares the playfield's
  `$0F` (light grey in hires). Playfield row 20 is never shown. Text on
  the playfield sets its cells below 8 (hires).
- Zero page: Oscar64's `$02-$56` (measured by claims-watch); the kernel
  uses none. `$02FF` the verdict byte. CIA2 timer A the meter, timer B the
  IRQ time.

## Autopilot and checks

Script (frames, port byte): 2 idle, 2 fire (the title starts the game);
24 left + fire, 10 fire, 30 right, 24 still (the first dart's dot hits the
ship: one life lost); 16 left, 32 right, 16 left, all firing (the weave of
saucers); 20 still; 40 fire through the gap between two parade columns;
24 left, 3 down. 240 play frames (the second fire frame on the title is
play frame 0), then still. The meter records the first 240.

The game freezes on the first frame after that with YSCROLL 3 (play frame
243, 30 rows scrolled), then saves the high score to drive 8, loads it
back, and grades 18 facts (main.c `first_fail`): the showing screen equals
the map; one loss and two lives left; score = the points of what was shot;
score 450 and 5 kills; every wave the scroll reached has started; the frame
IRQ applied YSCROLL 3 and the right screen (read from `$D011` and
`$D018`); the multiplexer shows 11 sprites; the ten parade bugs are where
their paths end; the ship is where the script leaves it (X 120, Y 176, by
arithmetic); effects ran; the HISCORE round trip returned 45; no play frame
ran into the next; every bullet cell the last draw changed held the map's
code again after every erase (`bullets_restored`, each frame); 10 dots
fired (5 darts at Y 72, 5 saucers at Y 88, from the paths); and the loss
was a dot, not a ram. By play frame, from the `-dEVENTLOG=1` build, the
same on PAL and NTSC: a dart shot at 37, the dot at 71, saucers shot at 94,
113, 121 and 128. Before enemy fire the review's Python model matched the
same kills frame for frame, with a ram at 71.

Mutations, each run through its target (the review's are in its report):

| Mutation | Target | Result |
|---|---|---|
| The split's phase-5 delay 5 to 7 | `make check` | phases fail YSCROLL 5, PAL and NTSC; the graded shot alone passed |
| One play frame about 2,400 cycles late (M8a) | `make check` | verdict red, `OVERRUNS 02` PAL, `03` NTSC; the first count passed it with `00` |
| The same late frame in the joy build (M8b) | `make joytest` | lost frames counted, joytest fails |
| The erase skips the first cell (`if (p && i)` before, now `beq` after `dey` in cb_erase) | `make check` | verdict red (fact 16) |
| Enemies never fire (`on_enemy_fire` removed) | `make check` | verdict red, LIVES 3, the ship's end moves |
| Dots never hurt the ship (`on_ship_shot` removed) | `make check` | verdict red, LIVES 3 |
| The stage meter's hold back to PLAY_FRAMES | `make stage` | "Integer constant truncated", frames 144 not 250 |
| The stage leaves sprites over the readout | `make stage` | the meter check cannot read row 13 |
| The save writes no record | `make joytest` | the reboot never shows HI 000600 |
| No `hold_screen()` before the start-up read | a release shot at 6,000,000 cycles | the title text is gone (it was there) |

`make check` first runs `make phases`: the game frozen on each of the eight
YSCROLL phases, PAL and NTSC, with panel lines 207-246 compared to the
graded phase-3 shot.

`expect.json` checks the border and four text rows, the meter (240 frames,
worst within a frame), the ship's and all ten bugs' bounding boxes (so the
multiplexer shows eleven sprites), four pixels that place the river's banks
at 30 rows scrolled, the split (line 206 playfield, line 208 panel grey),
the panel's rule, a blank row, its fifth row whole and two lives, and the panel and playfield
identical on PAL and NTSC. FORCE_FAULT starts the ship 16 pixels right: it
shoots 4 instead of 5 (400 points), is rammed instead of shot, ends at X
136, and check.py fails the verdict, the text and the ship's box.

`make joytest` plays the normal game headless on PAL and NTSC, the stick
on `$DC00` through `harness/drive.py` (it was a build reading `$02FE` until
2026-09-24): a fresh disk's title shows HI 000000, a game with fire held
and the ship swept left and right runs to GAME OVER and saves, and a reboot
on the same disk shows that score as HI; then 15 more games a model, 4
machines at once. Every game fails on a lost frame (`LOST_FRAMES`). Each game
repeats exactly from run to run: the drive counts emulated frames (scores
varied while it stepped in wall-clock time). `make longplay` plays a
`-dGOD=1` build, whose ship is never lost, for 740 s of emulated time a
game (40 s of warp before), 4 games a model, through the level's later
loops, and fails on a lost frame.

## Decisions and open questions

- Oscar64 with a KickAssembler blob, not KickAssembler alone: the raster
  chain, the split's delay table, the multiplexer and the row copy need
  exact cycles and no zero page; waves, paths, bullets, collisions, states
  and the disk file are logic an agent extends, and the KB's recipes for
  them are Oscar64.
- The playfield scrolls down, so the carry moves every row down. In place,
  bottom row first, that is 20 rows at about 560 cycles each (the recipe's
  row copy), some 11,000 cycles, while the beam reaches the top row about
  4,300 cycles after line 252 on NTSC (arithmetic, not measured): the top
  rows would tear. Two screens and a `$D018` flip in the frame IRQ avoid
  it. Colour RAM cannot flip, so the map is characters only, every cell
  one colour RAM value.
- The panel split is the recipe's code and delays, with a multicolour
  40-column playfield, and two changes found by measuring. Entered through
  the common IRQ entry, its poll started about 30 cycles late; at YSCROLL 5
  on PAL the writes then reached cycle 1 of line 215 (numbering not
  recorded; Bauer's 2 if it was the exec trace's, as the figures below were) in 4 frames of every
  12 and the panel's first row showed playfield characters. The split now
  has its own vector entry, as short as the recipe's pushes. Its writes
  then start between cycle 57 of line 214 and cycle 1 of line 215 (the split before #107; PAL; 57
  to 65 on NTSC; Bauer's numbering, remeasured for c64-kb issue #82; an
  earlier version gave the exec trace's 58 to 0 and 58 to 64), and `$D016` goes last so `$D018` lands four cycles
  earlier. Freezing the game on each of the eight phases gave panel lines
  215-250 pixel-identical to YSCROLL 3 on PAL and NTSC, and 14 consecutive
  frames of each phase on each model showed a clean panel row.
- Before #107, sprites stopped at Y 187 (last line 208). Measured in the review of this
  starter (VICE x64sc 3.10, eight sprites pinned at one Y, scrolling, 16
  shots a Y spread over the phases): sprites ending on line 213 (Y 192)
  left the panel clean, 0 of 16 on each model; sprites on line 214 (Y 193)
  broke its first row, 16 of 16 on PAL and 4 of 16 on NTSC (one sprite
  there: 8 of 16 PAL, 0 NTSC). Their DMA moves the split's `$D011` store
  from cycles 58-0 to cycles 5-11 of line 215. So line 214 is the hazard;
  187 keeps 5 lines of margin. Enemies that fly lower vanish at line 208.
  The same run showed the panel clean at every phase met while scrolling.
- #107: the panel showed four rows. It started on line 215, so its fifth
  row started on badline 247 and only lines 247-250 of it were above the
  border (`RSEL` = 1 ends the display at 250), in every shot and in both
  #22 game-test runs. The split now runs 8 lines higher: the panel starts
  on line 207 (still YSCROLL 7, so the delay table is unchanged), shows
  screen rows 19-23 on lines 207-246, and sets `RSEL` = 0 so the border
  closes on 247 over row 24. A start 4 lines higher with YSCROLL 3 was
  tried first and failed `make phases` at YSCROLL 4-7: the forced badline
  on line 211 re-started row 19, which the playfield was still in, and the
  whole panel moved 8 lines down. The playfield ends on line 206; colour
  RAM row 20 is white, as the panel's score row. The sprite limit moved
  with the split, measured again with 8 sprites pinned in the game frozen
  on each phase: last line 205 (Y 184) clean on all 16, line 206 (Y 185)
  broken on 8 of 8 PAL and 4 of 8 NTSC. `MAX_SY` is 179 (last line 200),
  and 8 sprites there were clean on all 16; `P_MAX_Y` is 178.
- Bullets move up 7 lines a frame while the playfield moves down 1, so a
  bolt stays on rows 2-5 of its cell at every phase: one glyph per bullet.
- The meter cannot be read in the panel: check.py reads text on the
  YSCROLL 3 grid, and the panel is on YSCROLL 7 (a harness finding). The
  readout goes to the playfield after the freeze.
- Enemy fire is `P_FIRE` in the path bytecode, from the other #39
  version's design: a 6-dot pool, dots drifting towards where the ship was,
  and a fire window of sprite Y 72-140, so a dot's first cell starts on
  line 77 or lower and the draw is done before the beam gets there
  (measured margins above). The work that runs for every enemy or bullet
  every frame moved into KickAssembler (`glyph.asm`, `hit.asm`, `step.asm`)
  to keep the staged frame inside NTSC; C keeps the rules.
- Disk I/O stops the raster chain ($D01A = 0) and turns sprites off. With
  sprites on, the KERNAL's serial transfers hung (NTSC 3 of 3 runs, PAL 1
  of 3); the review isolated the cause with a minimal program: sprite DMA
  on badline lines during the transfer (hiscore.c has the detail). The
  start-up read shows the title first (`hold_screen`).
- A splat HISCORE (drive reply 60, a save cut off) is scratched and
  written again, like a missing one.
