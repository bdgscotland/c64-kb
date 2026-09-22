# Screenshots

One PNG per KickAssembler recipe, taken from the run that verified it:
KickAssembler 5.25 assembled the listing exactly as it appears in the
recipe page, and VICE x64sc (3.9, PAL, 6569) ran the PRG headless:

```bash
x64sc -default -warp +sound -autostartprgmode 1 -limitcycles 8000000 \
      -exitscreenshot out.png -autostart recipe.prg
```

(`-autostartprgmode 1` injects the PRG into RAM instead of loading it
through the drive; on macOS with Homebrew VICE, set
`GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas` or the GTK
build aborts before it draws.)

`stable-raster-irq-control.png` is the same source built with
`STABLE = 0`: the jittering bars the recipe exists to remove.

The pictures are evidence about VICE, not about a 6569 on a bench. Where a
recipe's timing constant was found by measurement (`SYNC_PAD`, `LINE_PAD`,
`ENTRY_PAD`), the recipe text says so and says what the picture looks like
when the constant is off by one.
