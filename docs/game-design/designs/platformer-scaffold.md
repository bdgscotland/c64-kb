<!-- doc-type: game-design -->

# Game design: single-screen platformer scaffold (Oscar64)

The design of `recipes/oscar64/platformer-scaffold.md` as a whole game:
what runs in each phase and what its frame measured. The phases come from
the listing's `main()`, not from the recipe's frontmatter.
`CONVENTIONS-game-designs.md` defines the lines.

## Single-screen platformer scaffold (Oscar64)

**Game design:** `platformer_scaffold_oscar64`
**Instance of:** single_screen_platformer
**Realised by:** oscar64-platformer-scaffold
**Region:** both
**Composes:** tile_map_render (init), lfsr_random (init), kernal_file_read_seq (init), error_channel_check (init), frame_sync_loop, joystick_edge_detect, joystick_autorepeat, object_pool, lfsr_random, tile_grid_collision, fixed_point_8_8, jump_arc_table, sid_play_routine_pattern, sfx_engine_beside_music, decimal_print ×2-7, kernal_file_write_seq (transition), kernal_file_read_seq (transition), error_channel_check (transition), decimal_print (transition)
**Measured frame:** play pal worst=8693 typical=4966; play ntsc worst=10287 typical=6628 (measured-vice, CIA1 timer B around the whole loop body in VICE x64sc 3.10, recipes/oscar64/platformer-scaffold.md "Expected output")

### Phases

| Phase | What the listing does |
|---|---|
| init | `map_decode_and_draw` draws the whole map once; `tile_map_render` does not run again. The LFSR is seeded from SID voice 3 noise. `hs_start` opens `HISCORE`, reads it and reads the error channel. |
| play | Per frame: wait for the raster IRQ's tick, read the stick (`joy_edge`, `repeat_step`), step the waves and enemies (`object_pool`, rows and directions from `rnd`), move the player against `map[]` (`tile_grid_collision`, 8.8 Y, the jump table), play the tune, let the effect re-poke voice 2, redraw the HUD fields that changed (`put_dec`). |
| transition | At game over `hs_game_over` scratches `HISCORE`, writes it, reads it back and reads the error channel, with the raster IRQ stopped. |

`hud_draw` calls `put_dec` for the frame counter and the cycle count
every frame, and for score, lives, high score, `MAX` and `DROP` only in
a frame where they changed: two calls at least, seven at most, so
`decimal_print ×2-7`. Until #37 the line had no count and a budget
charged the HUD one call. `hs_game_over` prints the read-back score
once, so `decimal_print` is in transition too.

`tile_map_render` is in init. An earlier plan for this page (the
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

### What each part costs

Until #37 the play phase was timed only whole, and its measured worst,
8,693 on PAL, was 34 % above the prediction's top of 5,760: five members
had no figure and `decimal_print` was charged one call. The profile
builds of the recipe (`recipes/oscar64/platformer-scaffold.md`, "Profile
builds") time each part alone. Each figure is that part's largest in 800
frames with the screen on, the timer's 18 cycles subtracted; measured in
VICE x64sc 3.10.

| Part | Members | Predicted, PAL | Measured, PAL | Measured, NTSC |
|---|---|---|---|---|
| tick bookkeeping, raster IRQ | `frame_sync_loop` | 314 | 23 + 291 | 23 + 291 |
| `joy_edge` | `joystick_edge_detect` | 76 | 76 | 76 |
| `repeat_step` | `joystick_autorepeat` | 73 | 73 | 73 |
| `wave_step`, `update_enemies` | `object_pool`, `lfsr_random` | 394 | 2,748 | 2,768 |
| `player_update` | `tile_grid_collision`, `fixed_point_8_8`, `jump_arc_table` | 2,442 | 1,870 | 1,989 |
| `tune_play` | `sid_play_routine_pattern` | 779-1,198 | 368 | 416 |
| `sfx_update` | `sfx_engine_beside_music` | 50-258 | 122 | 165 |
| `hud_draw` | `decimal_print ×2-7` | 2,722-9,527 | 3,802 | 3,971 |
| `autopilot_port` | none | none | 685 | 657 |
| hit test, invulnerability, score | none | none | 707 | 797 |
| `player_draw` | none | none | 143 | 161 |
| KERNAL CIA IRQ, per hit | none | none | 235 | 235 |

What the table shows:

- **Sprite writes are in no member.** `update_enemies` sets image,
  colour, position and visibility of six sprites through `sprites.h`
  every frame. With the pool and the LFSR at 394 predicted, the part
  measured 2,748: about 2,350 cycles no Composes member states.
  `player_draw` does the same for one sprite, 143.
- **This listing's own code is in no member.** The autopilot (685) is
  the test driver; a build that reads the port instead spends about ten
  cycles there. The hit test and score (707) are the game's own rules.
- **The HUD was undercounted.** It measured 3,802, inside the ×2-7 range
  the Composes line now states; charged one call, it was 1,361.
- **Two members measured below their figures.** The tune is a stub,
  368 against a real player's 779-1,198. `player_update` is 1,870
  against 2,442: `tile_grid_collision`'s 2,345 is another recipe's worst
  frame.
- **The KERNAL's 60 Hz interrupt is left running** (`rirq_init(true)`)
  and costs 235 cycles each time it lands, inside the timed region or
  not. No member states it.
- The raster IRQ lands at line 251 while the loop waits, so it is not in
  `MAX`.

With the missing figures and the call count in, `c64_plan_budget`
predicts 6,888-14,320 cycles plus 1,075 of badlines for play (6,850-14,282
while joystick_edge_detect's figure was the 76-cycle split alone; the
technique's line is 114, port read included); the measured
worst, 9,055 PAL and 9,775 NTSC in the 40,000,000-cycle runs, lies
inside (8,693 and 10,287 before #93 changed the listing's start-up
read and so the game the autopilot plays). The parts not in any
member (about 3,900 cycles on PAL) are covered by the members that
measured below their figures and by the range's width, not by a member.
