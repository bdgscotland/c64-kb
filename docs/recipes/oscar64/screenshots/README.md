# Screenshots

One PNG per Oscar64 recipe that has been run, taken from the run that
verified it: Oscar64 (build 2026-05-19) compiled the listing exactly as it
appears in the recipe page, `-tm=c64 -O2`, and VICE x64sc 3.10 ran the PRG
headless:

```bash
x64sc -default -warp +sound -autostartprgmode 1 +autostart-delay-random \
      -limitcycles 8000000 -exitscreenshot out.png -autostart recipe.prg
```

`-autostartprgmode 1` injects the PRG into RAM instead of loading it
through the drive. `+autostart-delay-random` turns off the random delay VICE
otherwise inserts before the autostart `RUN`; without it the frame a given
`-limitcycles` lands on wanders by about ten frames between runs (measured
on `text-overlay-playfield`: ticks 249, 238, 240 in three runs, then 250,
250, 250 with the switch). On macOS with Homebrew VICE, set
`GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas` or the GTK
build aborts before it draws.

- `pal-ntsc-detect-pal.png`, `pal-ntsc-detect-ntsc.png`,
  `pal-ntsc-detect-oldntsc.png` — the same PRG under the default model,
  `-model ntsc` and `-model oldntsc`; the recipe page says what border and
  digits each must show. The NTSC pictures are 384×247, not 384×272, and
  the same colour index has different RGB values in them.
- `text-overlay-playfield.png` — the recipe at tick 654 (16,000,000
  cycles). `-gameover` is the same program run to its end state;
  `-notrail-control` and `-ungated-control` are the same source with one
  thing removed, run to show the pitfall the recipe avoids. The page says
  what was removed and what each picture measures. `-ntsc` is the recipe
  under `-model ntsc` at 8,000,000 cycles (tick 281), 384×247.

Geometry of the PAL captures, measured rather than assumed: 384×272; text
row 0 of the 25-row display window begins at PNG row 35 and column 0 at
x 32, so a character cell is the 8×8 block at `(32 + 8·col, 35 + 8·row)`
and the window occupies rows 35–234 (raster 51–250 minus 16). The border
pixel at (2, 100) is a safe place to read the border colour.

The pictures are evidence about VICE, not about a 6569 on a bench. Where a
recipe quotes a number from a picture, the recipe text says how it was
measured.
