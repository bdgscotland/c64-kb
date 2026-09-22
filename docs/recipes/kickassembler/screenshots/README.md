# Screenshots

One PNG per KickAssembler recipe, and every one of them is reproducible:
`npm run verify:recipes` assembles the listing exactly as it appears in
the recipe page with KickAssembler 5.25, runs the PRG headless in VICE
x64sc 3.10 (PAL, 6569) with the parameters pinned in
`docs/recipes/runs.json`, and fails on any pixel that differs from the
picture here. The pinned run is:

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 -exitscreenshot out.png -autostart recipe.prg
```

`-autostartprgmode 1` injects the PRG into RAM instead of loading it
through the drive; `+autostart-delay-random` turns off the random delay
VICE otherwise inserts before the autostart `RUN`, so a given
`-limitcycles` lands on the same frame every run. On macOS with Homebrew
VICE, set `GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas` or
the GTK build aborts before it draws.

The animated recipes (`raster-bars`, `sine-scroller`, `sprite-multiplex-24`,
`cracktro-template`) show whatever frame 8,000,000 cycles lands on; the
pictures were re-captured at that pinned frame on 2026-09-22, when the
earlier ones, taken from unpinned runs and in `hello-world`'s case from a
disk load rather than injection, could not be reproduced. A listing change
that changes the picture is adopted with `verify:recipes --update` and
the page says what changed.

`stable-raster-irq-control.png` is the same source built with
`STABLE = 0`: the jittering bars the recipe exists to remove. It is not
pinned and not verified by the gate; its stagger depends on autostart
timing.

`palette-cells.png` / `-ntsc.png` are the sixteen colours painted into
known cells; they are the measurement behind the palette table in
`docs/runtime/vice-reference.md`, section "Reading the exit screenshot",
which also gives the pixel geometry and a decode snippet.
`file-io-roundtrip.png` / `-ntsc.png` are at 16,000,000 cycles against a
fresh `TEST,01` disk that `verify:recipes` formats with c1541 before the
run (`"disk"` in `runs.json`); true drive emulation is on, so the run
takes real C64 time.

The pictures are evidence about VICE, not about a 6569 on a bench. Where a
recipe's timing constant was found by measurement (`SYNC_PAD`, `LINE_PAD`,
`ENTRY_PAD`), the recipe text says so and says what the picture looks like
when the constant is off by one.
