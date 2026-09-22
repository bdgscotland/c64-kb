---
name: verify-listing
description: Build a recipe listing with its real toolchain, run it headless in VICE, and measure the screenshot against the page's "Expected output". Use when adding or changing any recipe, when a page claims a visual result, or when asked "does this actually work". Never mark a recipe verified without this.
---

# verify-listing — build, run, measure

Announce: "Using verify-listing to build and run <recipe> in VICE."

A recipe page is verified when (1) its listing builds with the named
toolchain, (2) the PRG runs headless in VICE, and (3) a script reads the
screenshot and finds what "Expected output" says. Looking at the picture
is step 4, not step 3.

## 1. Extract and build

```bash
mkdir -p /tmp/verify/<recipe>; cd /tmp/verify/<recipe>
python3 - <<'EOF'
import re,pathlib
md=pathlib.Path('<repo>/docs/recipes/<toolchain>/<recipe>.md').read_text()
lang,code=[(l,c) for l,c in re.findall(r"```(\w*)\n(.*?)```",md,re.S) if l in ('asm','c')][0]
pathlib.Path('src.'+('asm' if lang=='asm' else 'c')).write_text(code)
EOF
# KickAssembler
java -jar "$KICKASS_JAR" src.asm -o out.prg
# Oscar64
"$OSCAR64" -tm=c64 -O2 -o=out.prg src.c
# cc65
cl65 -t c64 -O -o out.prg src.c
```

Zero errors or stop here; the page is wrong.

## 2. Run headless

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
timeout 120 x64sc -default -warp +sound -autostartprgmode 1 \
  -limitcycles 8000000 -exitscreenshot out.png -autostart out.prg >/dev/null 2>&1
```

- `-autostartprgmode 1` injects the PRG into RAM; without it a large PRG is
  still LOADING when the limit hits.
- 8,000,000 cycles ≈ 8 s of C64 time after boot; raise it for programs
  that need to settle.
- `-model ntsc` for 6567R8 when a page claims NTSC behaviour.
- The exit screenshot can be taken mid-frame: a boundary that moves when
  you change `-limitcycles` is the beam, not the program.

## 3. Measure

Geometry: PAL 384×272, screenshot row = raster line − 16 (rows 0–271 are
lines 16–287); NTSC 384×247, row = line − 28, with rows 235–246 being
lines 0–11 of the next frame. x = 8 is VIC X 0; left border x 0–31, right
border 352–383, display x 32–351. An earlier version of this line said
− 14; both offsets are derived from three boundaries each in
`docs/recipes/kickassembler/topbottom-border-open.md`.

```python
from PIL import Image
im=Image.open('out.png').convert('RGB'); px=im.load(); w,h=im.size
# examples — write the check the page's Expected output implies:
col=[px[2,y] for y in range(h)]                       # border colour down the left edge
changes=[y for y in range(1,h) if col[y]!=col[y-1]]   # raster-split rows
rows=[y for y in range(h) if any(px[x,y]==(255,255,255) for x in range(w))]  # white bars
print(changes, rows[:10])
```

Turn the page's prose into one assertion per claim (boundary rows, colour
sequence, columns that must be grey, text present) and print pass/fail.
If a constant was found by trying values (`SYNC_PAD`, `LINE_PAD`,
`ENTRY_PAD`), run the neighbours too and record what the picture does when
it is off by one — that sensitivity is the evidence the constant is doing
the work.

## 4. Record

- Copy `out.png` to `docs/recipes/<toolchain>/screenshots/<recipe>.png` and
  point to it from "Expected output".
- State the instrument in the page: "Verified in VICE x64sc 3.9 (PAL,
  6569)". Do not write "verified on hardware"; nothing here was.
- If the run contradicted the page, the page changes, and it says what was
  wrong.
- Run `npm run check:listings` before committing; the hook already ran it
  on your file.
