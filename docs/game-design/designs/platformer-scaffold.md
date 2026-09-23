<!-- doc-type: game-design -->

# Game design: single-screen platformer scaffold (Oscar64)

The design of `recipes/oscar64/platformer-scaffold.md` as a whole game:
what runs in each phase, and what its frame measured. The phases come from
the listing's `main()`, not from the recipe's frontmatter.
`CONVENTIONS-game-designs.md` defines the lines.

## Single-screen platformer scaffold (Oscar64)

**Game design:** `platformer_scaffold_oscar64`
**Instance of:** single_screen_platformer
**Realised by:** oscar64-platformer-scaffold
**Region:** both
**Composes:** tile_map_render (init), lfsr_random (init), kernal_file_read_seq (init), error_channel_check (init), frame_sync_loop, joystick_edge_detect, joystick_autorepeat, object_pool, lfsr_random, tile_grid_collision, fixed_point_8_8, jump_arc_table, sid_play_routine_pattern, sfx_engine_beside_music, decimal_print, kernal_file_write_seq (transition), kernal_file_read_seq (transition), error_channel_check (transition)
**Measured frame:** play pal worst=8693 typical=4966; play ntsc worst=10287 typical=6628 (measured-vice, CIA1 timer B around the whole loop body in VICE x64sc 3.10, recipes/oscar64/platformer-scaffold.md "Expected output")

### Phases

| Phase | What the listing does |
|---|---|
| init | `map_decode_and_draw` draws the whole map once; `tile_map_render` does not run again. The LFSR is seeded from SID voice 3 noise. `hs_start` opens `HISCORE`, reads it and reads the error channel. |
| play | Per frame: wait for the raster IRQ's tick, read the stick (`joy_edge`, `repeat_step`), step the waves and enemies (`object_pool`, rows and directions from `rnd`), move the player against `map[]` (`tile_grid_collision`, 8.8 Y, the jump table), play the tune, let the effect re-poke voice 2, redraw the HUD fields that changed (`put_dec`). |
| transition | At game over `hs_game_over` scratches `HISCORE`, writes it, reads it back and reads the error channel, with the raster IRQ stopped. |

`tile_map_render` is in init, not play: an earlier plan for this page (the
#22 design) put it in play, which would charge a map redraw to every frame.

### What the measured frame holds

The timed region is the whole loop body, HUD included: CIA1 timer B is
started after the tick and stopped after `hud_draw`. The screen is on, so
badline stalls are inside the figures. A frame in which the KERNAL did
disk I/O is left out of `MAX`, because the KERNAL's serial code uses timer
B.

- `worst` is `MAX` at 40,000,000 cycles, 800 frames on each model, with no
  frame dropped.
- `typical` is one frame's `CYC` reading in the exit screenshot at
  18,000,000 cycles, where the HUD shows frame 622 (PAL) and 711 (NTSC);
  `CYC` is the previous frame's. It is not a mean. The page's own reading is "about 5,000 to 7,500 cycles a frame in
  play".
- The HUD alone costs 1,605 cycles (PAL) and 1,671 (NTSC) in the halted
  state, about a third of the typical reading (arithmetic).

The play phase was not timed in parts. Which technique takes the rest is
not measured here.
