<!-- doc-type: game-design -->

# Game design: vertical shoot-'em-up (Oscar64)

The design of `recipes/oscar64/simple-shmup.md` as a whole game.
`CONVENTIONS-game-designs.md` defines the lines.

## Simple vertical shmup (Oscar64)

**Game design:** `simple_shmup_oscar64`
**Instance of:** vertical_shmup
**Realised by:** oscar64-simple-shmup
**Region:** both
**Composes:** sprite_multiplex_8, soft_scroll_v, sid_play_routine_pattern
**Measured frame:** play pal worst=8178 typical=4619; play ntsc worst=8474 typical=4911 (measured-vice, CIA1 timer B around the loop body in VICE x64sc 3.10, recipes/oscar64/simple-shmup.md "Expected output")

Every technique runs in play. The listing's bullets, enemy waves and
bounding-box collisions are its own code; no technique page describes
them, so none is named here.

### What the measured frame holds

CIA1 timer B runs from `rirq_wait()` to `rirq_sort()`: the whole loop
body, the score HUD when it changes included, the timer's own figures
drawn after it stops. The screen is on and the KERNAL's 60 Hz interrupt
runs, so badline stalls and any KERNAL interrupt that lands inside are in
the figures.

- `worst` is `M` at 40,000,000 cycles; the pinned 8,000,000-cycle
  pictures read 8,147 (PAL) and 8,453 (NTSC).
- `typical` is one frame's `C` reading in the pinned pictures. It is not
  a mean.

Until #37 the recipe did not time its loop and this design had no
Measured frame line. `soft_scroll_v` had no Cost line either; it is now
measured on the same listing, 46 cycles a frame.

The listing's own code is in no member, so the prediction leaves it out
and the measured frame holds it: the bullets, the collisions, the wave
code, and the starfield's carry, 3,525 to 3,802 cycles once in eight
frames.

The recipe's frontmatter also scaffolds `horizontal_shmup`, but the
listing scrolls vertically (`soft_scroll_v`). A horizontal game
changes the scroll technique, so this design is an instance of
`vertical_shmup` only. An earlier version listed both archetypes.
