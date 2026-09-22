# Screenshots

One PNG per cc65 recipe, reproducible by `npm run verify:recipes`: the
listing is compiled exactly as it appears in the recipe page with
`cl65 -t c64 -O`, run headless in VICE x64sc 3.10 (PAL, 6569) with the
parameters pinned in `docs/recipes/runs.json` (default: 8,000,000 cycles,
`+autostart-delay-random`, `-autostartprgmode 1`), and the picture must
match pixel for pixel. Adopted 2026-09-22 after being looked at against
the page's "Expected output". `memory-layout.png` / `-ntsc.png` are the
worked layout from `docs/toolchains/memory-layout-planning.md` built with
cc65's linker configuration, pinned on both models.

The pictures are evidence about VICE, not about a 6569 on a bench.
