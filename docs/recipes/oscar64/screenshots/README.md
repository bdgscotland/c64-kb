# Screenshots

One PNG per Oscar64 recipe, and every one of them is reproducible:
`npm run verify:recipes` compiles the listing exactly as it appears in the
recipe page with Oscar64 (build 2026-05-19), `-tm=c64 -O2`, runs the PRG
headless in VICE x64sc 3.10 with the parameters pinned in
`docs/recipes/runs.json`, and fails on any pixel that differs from the
picture here. The default pinned run is:

```bash
x64sc -default -minimized -warp +sound -autostartprgmode 1 +autostart-delay-random \
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
  cycles, pinned in `runs.json`). `-ntsc` is the recipe under
  `-model ntsc` at the same 16,000,000 cycles (tick 745), 384×247; an
  earlier picture was taken at 8,000,000 cycles (tick 281) and could not
  be reproduced by the pinned run. `-gameover` is the same program run to
  its end state; `-notrail-control` and `-ungated-control` are the same
  source with one thing removed, run to show the pitfall the recipe
  avoids. The page says what was removed and what each picture measures.
  These three are not pinned and not verified by the gate.
- The other pictures were adopted on 2026-09-22 after each was looked at
  against its page's "Expected output"; before that these recipes had no
  committed screenshot at all.
- `joystick-input.png` / `-ntsc.png` are at 24,000,000 cycles (pinned in
  `runs.json`): the recipe runs two exhaustive self-checks before its live
  loop and 8,000,000 cycles does not reach the loop. `frame-sync-loop.png`
  / `-ntsc.png` are the budget-bar loop at 8,000,000 cycles and
  `frame-sync-loop-overrun.png` is the same listing built with a workload
  that does not fit, at 8,050,000 cycles so the wrapped bar and the
  non-zero dropped counter are both in frame. `fixed-point-jump.png` /
  `-ntsc.png` are the jump arc at 8,000,000 cycles; the page quotes the
  table value and the sprite Y measured from the picture at that frame.
- `tile-map-render.png` / `-ntsc.png` at 8,000,000 cycles: the decoded
  metatile map, compared cell by cell (screen code and colour) against a
  Python render of the same source data. `print-number.png` / `-ntsc.png`
  at 400,000,000 cycles: the pinned run is long because the listing first
  renders every value from 0 to 65535 through both decimal routes and
  folds the digits into the checksums it prints. `lfsr-random.png` /
  `-ntsc.png` at 20,000,000 cycles and `lfsr-random-seed2.png` (the same
  listing with a fixed compile-time seed) show that a different seed gives
  a different picture; the headless run seeds identically every time, so
  the seed variation itself is stated on the page, not shown.

Geometry of the PAL captures, measured rather than assumed: 384×272; text
row 0 of the 25-row display window begins at PNG row 35 and column 0 at
x 32, so a character cell is the 8×8 block at `(32 + 8·col, 35 + 8·row)`
and the window occupies rows 35–234 (raster 51–250 minus 16). The border
pixel at (2, 100) is a safe place to read the border colour.

- `object-pool.png` / `-ntsc.png` at 8,000,000 cycles: the scripted
  spawn, despawn and respawn scenario with its checksum and PASS line and
  the per-call cycle figures.
- `double-buffer.png` / `-ntsc.png` at 8,000,000 cycles: the visible page
  at that frame (A on PAL, B on NTSC, as the pages' frame counters
  predict) with the sprite intact; `double-buffer-nomirror.png` is the
  same listing without the sprite-pointer mirror and shows the corrupted
  sprite. `save-load-seq-file.png` / `-ntsc.png` at 16,000,000 cycles on
  a fresh `TEST,01` disk with the drive's RPM wobble off (the verifier
  pins both), so the elapsed cycle figures on screen repeat run to run.
  `text-input.png` / `-ntsc.png` at 8,000,000 cycles with
  `-keybuf "abc\x14d\x0d"`: the entry loop after A, B, C, DEL, D, RETURN.
- `high-score-persist.png` / `-ntsc.png` at 24,000,000 cycles on a fresh
  `TEST,01` disk: the first-run path (62, defaults written), the rewrite
  by scratch-then-write with the scratch reply read, and the read-back,
  all in one run because every verifier run starts from an empty disk.
  `sfx-engine.png` / `-ntsc.png` at 8,000,000 cycles: the priority and
  borrow counters and the register-write checksum; nobody has listened to
  it. `memory-layout.png` / `-ntsc.png` at 8,000,000 cycles: the worked
  layout's charset, sprite and printed addresses. `headless-verify.png` /
  `-ntsc.png` at 8,000,000 cycles: the green (pass) case of the
  result-byte pattern.

The pixel geometry, the palette RGB triples per model and a decode snippet
are in `docs/runtime/vice-reference.md`, section "Reading the exit
screenshot". The pictures are evidence about VICE, not about a 6569 on a
bench. Where a recipe quotes a number from a picture, the recipe text says
how it was measured.
