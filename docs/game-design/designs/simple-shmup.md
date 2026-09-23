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

Every technique runs in play. The listing's bullets, enemy waves and
bounding-box collisions are its own code; no technique page describes
them, so none is named here.

No Measured frame line: the recipe does not time its loop. Timing it (a
CIA timer around the loop body, the harness of `platformer-scaffold.md`)
is what would give this design one.

The recipe's frontmatter also scaffolds `horizontal_shmup`, but the
listing scrolls vertically (`soft_scroll_v`), and a horizontal game
changes the scroll technique, so this design is an instance of
`vertical_shmup` only. An earlier version listed both archetypes.
