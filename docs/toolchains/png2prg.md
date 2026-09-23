---
tool: png2prg
tool_kind: asset-converter
maintainer: staD020 (burg)
license: NOASSERTION
home_url: https://github.com/staD020/png2prg
version_verified: "1.12"
---

<!-- doc-type: toolchain-reference -->

# png2prg: PNG art to C64 bitmap, charset and sprite data

## Tool

png2prg converts a 320x200 PNG, GIF or JPEG that already obeys C64 colour
rules into C64 data: a Koala multicolour bitmap, a hires bitmap,
charsets (single-colour, multicolour, mixed, PETSCII, ECM), sprites, or a
multicolour interlace bitmap. It finds the palette and the background
colour itself. It does not reduce colours or dither: a full-colour picture
is refused, not converted. That makes it a build step for art an artist
or an agent drew to C64 rules, and it closes a loop: a VICE exit
screenshot converts back to the same bytes (measured below).

The repository has no LICENSE file (checked at commit `4cf8d5b`,
2025-05-10), so the frontmatter says `NOASSERTION`. Use it as a build
tool; do not vendor its source or its displayer binaries into a project.

Everything marked "run here" was done on 2026-09-23 with png2prg 1.12
(banner `png2prg 1.12 by burg`), built from commit `4cf8d5b` with Go 1.26.5
on macOS arm64:

```text
git clone https://github.com/staD020/png2prg
cd png2prg && go build -o png2prg ./cmd/png2prg
```

**Targets:** VIC-II

## Build pipeline

### .PNG — Portable Network Graphics image
**Consumed by:** png2prg

320x200, or a 384x272 VICE PAL screenshot, which png2prg crops at
x = 32, y = 35 (its README). A 384x247 VICE NTSC screenshot also
converted correctly here. Sprite-sized images become sprites.

### .PRG — Program file (executable)
**Produced by:** png2prg

For `-m koala` without `-d`: 10,003 bytes loading at `$2000`, the same
byte layout as a Koala `.kla` after its two-byte load address (bitmap,
1,000 screen bytes, 1,000 colour-RAM bytes, one background byte). The
README places the file at `$2000` bitmap, `$3F40` screen, `$4328` colour
RAM, `$4710` background (low nibble; the high nibble holds the border
colour). With `-d` the file is a self-running viewer packed with TSCrunch
(2,668 bytes for the test image here).

## Command line

```text
png2prg -m koala -o picture.prg picture.png        # data only
png2prg -m koala -d -o show.prg picture.png        # self-displaying PRG
png2prg -m koala -v -o picture.prg picture.png     # verbose: palette, colours per cell, clashes
```

| Flag | Meaning (from `png2prg -h` and the README) |
|---|---|
| `-m`, `-mode` | Force `koala`, `hires`, `mixedcharset`, `sccharset`, `mccharset`, `petscii`, `ecm`, `scsprites`, `mcsprites`; otherwise png2prg guesses |
| `-o`, `-out` | Output file; default is the input name with `.prg` |
| `-d`, `-display` | Include a displayer (png2prg's own display code plus the TSCrunch depacker) |
| `-bpc`, `-bitpair-colors` | Prefer these colours for the bit pairs, e.g. `-bpc 0,4,7,2` (source flag text: "prefer these colors in 2bit space"; the README uses "force" only for ECM's `$D021`-`$D024`) |
| `-sid file.sid` | Add a tune to the displayer |
| `-i`, `-interlace` | Treat two images as an interlace pair |
| `-no-crunch`, `-no-fade` | Displayer without TSCrunch, without the fade |
| `-v`, `-vv` | Verbose; `-vv` adds a memory map |
| `-sym` | Write a `.sym` file of the output's addresses |

Charset output is packed to unique characters by default; `-no-pack` turns
that off (README).

Use `-d` output for previews. It contains png2prg's displayer and the
TSCrunch depacker, and the png2prg repository has no licence, so a shipped
game should use data-only output and its own display code.

## Input rules

| Mode | Size | Colours per cell | Shared colours |
|---|---|---|---|
| koala | 160x200 double-wide pixels in a 320x200 image | 4 per 4x8 cell | background (`$D021`) |
| hires | 320x200 | 2 per 8x8 cell | none |
| mccharset, mixedcharset | 320x200 | 4 per cell | `$D021`, `$D022`, `$D023` |
| sccharset, petscii | 320x200 | 2 per cell | `$D021` |
| ecm | 320x200 | 2 per cell | 4 backgrounds, at most 64 characters |

The table is from the README; only the koala row was run here.

What happened here when the input broke the rules:

| Input | Result |
|---|---|
| One 4x8 cell with 5 colours | `amount of colors in char 410 (x=80, y=80) 5 > 4 : 0,1,5,11,15`, exit 1, no file |
| One pixel of (128, 0, 128), a 17th colour | `NewPalette failed: too many colors: 17 while the max is 16`, exit 1, no file |
| Every white pixel changed to (249, 249, 249) | Converted; output byte-identical to the unchanged image (nearest palette entry) |

The clash message names the cell by index and by top-left pixel, in
320-wide coordinates. Use `-v` to see it.

**Palette.** png2prg compares the image with a list of known palettes and
takes the nearest. The VICE 3.10 `-default` PAL palette (the triples in
[vice-reference](../runtime/vice-reference.md), "The default palette")
matched png2prg's entry "vice 3.7.1 internal" at distance 0. The NTSC
screenshot's nearest palette was "le funge", at distance 341. Drawing with the VICE PAL table is the
safe choice. Run here.

## Round trip, measured

1. A Python/PIL script drew a 160x200 test image, doubled to 320x200, in
   the VICE PAL palette: black background and three other colours in every
   4x8 cell, arranged so every cell uses all four bit pairs, and the colour
   triple varies from cell to cell.
2. `png2prg -m koala -v -o src.prg src.png`: exit 0, background found as
   colour 0, 10,003 bytes.
3. The file was decoded in Python with `%00` = `$D021`, `%01` = screen
   byte high nibble, `%10` = screen byte low nibble, `%11` = colour RAM.
   0 of 32,000 fat pixels differed from the source. With `%01` and `%10`
   swapped, 16,000 differed.
4. The bytes, with a `$6000` load address in front, were embedded in the
   Oscar64 1.32.271 build of
   [oscar64/bitmap-koala-viewer](../recipes/oscar64/bitmap-koala-viewer.md)
   with `USE_TEST_IMAGE 0`. The `#embed` line had to go on a line of its
   own (see "The viewer recipe's `#embed` line").
5. VICE x64sc 3.10, the pinned command, `-limitcycles 6000000`, PAL and
   `-model ntsc`, two runs each, byte-identical PNGs per model.
6. The display window (PAL x 32 to 351, y 35 to 234; NTSC y 23 to 222) was
   compared pixel by pixel with the source, using each model's palette
   table: 0 of 64,000 pixels differed on either model.
7. `png2prg -m koala` on the PAL exit screenshot and on the NTSC exit
   screenshot each produced a file byte-identical to step 2's.
8. `png2prg -m koala -d` on the source: the displayer PRG, run the same
   way at 6,000,000 and 12,000,000 cycles, also showed 0 differing pixels.

So for art drawn in the palette and within the cell rules, nothing is lost
in either direction. What png2prg decides for you is which colour goes in
which bit pair. `-bpc` states a preference, not a guarantee: when the game
needs a colour on a fixed pair (for example, the same `%11` colour-RAM value
everywhere so colour RAM can be filled once), pass `-bpc` and then check the
colour-RAM bytes in the output.

A test of the loop, as commands (the viewer build and the pixel compare are
the steps above; this is not a gate-built listing):

```text
python3 draw.py                                   # writes art.png, 320x200, VICE PAL colours
png2prg -m koala -o art.prg art.png
python3 -c "d=open('art.prg','rb').read(); open('image.kla','wb').write(b'\x00\x60'+d[2:])"
oscar64 -tm=c64 -O2 -o=viewer.prg bitmap-koala-viewer.c   # USE_TEST_IMAGE 0
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 6000000 -exitscreenshot shot.png -autostart viewer.prg
png2prg -m koala -o back.prg shot.png && cmp art.prg back.prg
```

## Not measured here

- Every mode other than koala, and `-bpc`, `-sid`, interlace and animation.
- A picture with more than one background candidate, where png2prg has to
  guess `$D021`.

## The viewer recipe's `#embed` line

`static const char koala_file[] = { #embed "image.kla" };` on one line
fails to compile (Oscar64 1.32.271: `error 3006: Term starts with invalid
token ''}''` in most runs here, `error 3037: Semicolon expected` in one). With `#embed` on a line
of its own it builds. The recipe ships with `USE_TEST_IMAGE 1`, so the
listing gate never compiles that line. Run here.

## Sources

- png2prg README and `-h` output: https://github.com/staD020/png2prg (commit `4cf8d5b`)
- TSCrunch, the displayer's packer, is named in the README; not examined here

## See also

- [asset-pipelines](../art/asset-pipelines.md), "Koala bitmap (.kla)" for the byte layout
- [art-production-reference](../art/art-production-reference.md), drawing to C64 rules
- [vice-reference](../runtime/vice-reference.md), "Reading the exit screenshot"
- [bitmap-modes](../techniques/bitmap-modes.md), `koala_format` and `multicolor_bitmap`
