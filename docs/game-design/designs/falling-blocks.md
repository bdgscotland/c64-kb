<!-- doc-type: game-design -->

# Game design: falling-block puzzle (Oscar64)

The design of `recipes/oscar64/falling-blocks.md` as a whole game. The
phases come from the listing's `main()`. `CONVENTIONS-game-designs.md`
defines the lines.

## Falling-block puzzle (Oscar64)

**Game design:** `falling_blocks_oscar64`
**Instance of:** action_puzzle
**Realised by:** oscar64-falling-blocks
**Region:** both
**Composes:** pal_ntsc_detection (init), frame_sync_loop, joystick_edge_detect, joystick_autorepeat, falling_block_rules, lfsr_random, text_mode_overlay_render
**Measured frame:** play pal worst=6276; play ntsc worst=6491 (measured-vice, CIA1 timer A around game_step, spawn and render in VICE x64sc 3.10, recipes/oscar64/falling-blocks.md "Why this works")

### Phases

| Phase | What the listing does |
|---|---|
| init | `detect_pal` polls for raster line 280 and picks the NES PAL or NTSC gravity and DAS tables. |
| play | Per frame: `wait_frame` polls for raster line 250, the stick byte goes to `game_step` (fire rotates on a press, left and right repeat by DAS, down soft-drops), a lock spawns the next piece from the 7-bag (`lfsr_random`), and `render` erases and redraws the piece and any collapsed rows. |

The recipe's frontmatter named four techniques until this page was
written. The listing also runs `frame_sync_loop` (`wait_frame` polls
`$D012`), `joystick_edge_detect` (`prev_joy` makes fire a press, not a
hold) and `pal_ntsc_detection` (`detect_pal`); the frontmatter now names
all seven.

### What the measured frame holds

CIA1 timer A runs from `t_start` to `t_stop` with the KERNAL IRQ off, so
no jiffy handler is inside the figure. The screen is on and each frame
starts at raster line 250, so badline stalls are inside. The HUD is
printed after `t_stop` and is not counted.

- `worst` is the dearest frame of the scripted five-piece game: its
  four-line clear, rules and render together, six rows redrawn.
- No `typical` is given. The page's other figure, `MOVE MAX` 2,113 on both
  models, is the dearest frame without a lock, not a common frame.
- The page also times a constructed frame the game cannot reach: a
  twenty-row stack, a four-line clear, sixteen rows collapsed. Rules 5,717
  (PAL) and 5,888 (NTSC), render 9,311 and 9,394, 15,028 and 15,282 in
  all. That is an upper bound, not a measured frame of this game, so it is
  not a Measured frame line. At 15,028 cycles from line 250 it runs about
  240 lines, into the next frame's display
  (`full_field_redraw_exceeds_vblank`).

`text_mode_overlay_render` has no Cost line, so a budget of this design
lists it as unknown. Its recipes redraw differently: the whole field every
frame from an Oscar64 loop (17,100-19,400 cycles, `techniques/text-mode-render.md`)
or only the rows that changed (up to 9,394 here). Which one the technique's Cost
line should state is not settled.
