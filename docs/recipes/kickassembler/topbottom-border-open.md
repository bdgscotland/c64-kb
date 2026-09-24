---
recipe: topbottom-border-open
toolchain: kickassembler
output_format: PRG
region: both
techniques: [topbottom_border_open]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, D021, D000, D001, D015, D027, DC0D]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init)]
---

<!-- doc-type: recipe -->

# KickAssembler — Open the Top and Bottom Borders

## Synopsis

Opens the top and bottom borders for the whole frame with two plain raster
interrupts and no cycle counting. The VIC-II's vertical border flip-flop is
set in exactly one place (when the raster reaches the bottom comparison
line, 251 with RSEL=1 or 247 with RSEL=0) and reset in exactly one other,
the top comparison line (51 or 55) while DEN is set. Clear RSEL after line
247 has gone by and before line 251 arrives, and neither bottom comparison
ever matches: the flip-flop is never set, the rest of this frame is drawn as
background, and so is the top border of the next frame, because nothing
between the two can set the flip-flop again. There is no separate top-border
write, and no top-only or bottom-only form. An earlier version of the
technique page described both; a build that does what it said (RSEL cleared
on line 55) opens nothing, and is one of the controls below.

The target is a raster line, not a cycle, so an interrupt through $0314
with the KERNAL's 29-cycle dispatcher is precise enough; the stable entry of
`stable-raster-irq.md` is not needed. One solid sprite is parked in the
opened area so the picture shows more than a colour change.

Verified in VICE x64sc 3.10 (PAL C64C, VIC-II 8565, and NTSC 6567R8; an
earlier version said PAL 6569, but `x64sc -default` is the C64C): with the border
black and the background blue, the column at x=192 of the screenshot is
background on every row of the frame, the side borders are intact on every
row, the white sprite is visible in the bottom border, and the two control
builds keep both borders closed.

## Source

```asm
// topbottom-border-open.asm
// Opens the top and bottom borders for the whole frame with two plain
// raster interrupts. The VIC-II's vertical border flip-flop is SET only
// when the raster reaches the bottom comparison line -- 251 with RSEL=1,
// 247 with RSEL=0 -- and RESET only at the top comparison line (51/55)
// while DEN is set. Clear RSEL after line 247 has passed and before line
// 251 arrives, and neither bottom comparison ever matches: the flip-flop
// is never set, so the bottom border of this frame and the top border of
// the next are both drawn as background. There is no separate top-border
// write; the top opens because the bottom set never happened.
//
// One solid sprite stands in the opened area so the picture shows more
// than a colour change. Its Y register is 4: the sprite Y compare is
// eight bits wide, so it matches raster lines 4 and 260 and the sprite
// is drawn from 261 (bottom border) and again from 5 (top border).

.const OPEN_LINE    = 249    // 248, 249 and 250 all open; 247 and 251 do not (see text)
.const RESTORE_LINE = 0      // anywhere from 252 to 246 of the next frame
.const SPRITE_Y     = 4      // 260 & $FF
.const SPRITE_X     = 100

BasicUpstart2(start)

// A solid 24x21 sprite.
* = $0e00
sprite_block:
    .fill 63, $ff
    .byte 0

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d                // mask every CIA1 source
    lda $dc0d                // and drop a pending one

    lda #0
    sta $3fff                // the idle-state graphics byte; zero, so the
                             // opened area is plain background colour
    sta $d020                // border black
    lda #6
    sta $d021                // background blue

    lda #SPRITE_X
    sta $d000
    lda #SPRITE_Y
    sta $d001
    lda #sprite_block / 64
    sta $07f8
    lda #1
    sta $d027                // white
    lda #$01
    sta $d015                // sprite 0 on

    lda #<open
    sta $0314
    lda #>open
    sta $0315
    lda #$1b
    sta $d011                // DEN=1, RSEL=1, YSCROLL=3, RST8=0
    lda #OPEN_LINE
    sta $d012
    lda #$01
    sta $d01a                // raster source on
    sta $d019                // stale flag off
    cli
    jmp *

// Enters on cycle 39-45 of OPEN_LINE; the write lands about ten cycles
// later, well inside the line. RSEL goes to 0 with YSCROLL and DEN kept.
// Bit 7 is masked off too: on a read it is the raster's ninth bit, and
// written back set it would move the raster compare above line 255.
open:
    lda $d011
    and #%01110111
    sta $d011
    lda #RESTORE_LINE
    sta $d012
    lda #<restore
    sta $0314
    lda #>restore
    sta $0315
    lda #$01
    sta $d019
    jmp $ea81                // pla/tay/pla/tax/pla/rti

// RSEL back to 1 so next frame's line 247 is not a bottom comparison
// either. Exits through the full KERNAL service once per frame, which
// keeps the jiffy clock and the keyboard alive.
restore:
    lda $d011
    and #%01111111
    ora #%00001000
    sta $d011
    lda #OPEN_LINE
    sta $d012
    lda #<open
    sta $0314
    lda #>open
    sta $0315
    lda #$01
    sta $d019
    jmp $ea31
```

## Build

```bash
java -jar KickAss.jar topbottom-border-open.asm -o topbottom-border-open.prg
```

## Expected output

The BASIC start-up screen with a black frame that has no top and no bottom:
blue runs from the first line of the picture to the last, interrupted only
by the black side borders, which are untouched. A white 24×21 sprite stands
in the bottom border at X=100, and the bottom ten lines of a second copy of
it show at the top of the picture (the sprite's Y compare is eight bits
wide; see below). The text is where it always is.

Screenshot from the VICE run this page describes:
`screenshots/topbottom-border-open.png`. Measured on it, with every colour
value taken from a reference build's own pixels rather than from a palette
table (PAL C64C, VIC-II 8565, 384×272, screenshot row = raster line − 16; see the
geometry note at the end):

- x=192 is the background colour on all 272 rows. The rows that would be
    border, 0–34 (lines 16–50) and 235–271 (lines 251–287), are background.
- x=2 is the border colour on all 272 rows, and so is every pixel in
  columns 0–31 and 352–383 is the border colour. RSEL does not touch the
  side border.
- In rows 0–34 and 235–271, between x=32 and x=351, there is not one pixel
  that is neither background nor the sprite: no idle-state pattern, no
  stripe.
- Sprite-colour pixels occupy x 108–131 in rows 245–265 (21 rows, lines
  261–281) and rows 0–9 (lines 16–25; lines 5–15 of that copy lie above the
  picture's first line).
- Rows 35–234, the display area, are pixel-identical to the closed control
  build: opening the borders changes nothing inside them.

Two control builds, each one constant away from the listing:

- **`OPEN_LINE = 55`, the mechanism the earlier technique text gave for the
  top border** (RSEL=0 written on line 55, RSEL=1 restored on line 0, before
  line 51). Both borders closed: x=192 is border colour on rows 0–34 and
  231–271, and the sprite has zero visible pixels. The bottom border now
    starts on line 247 instead of 251: RSEL was 0 when line 247 came round,
  so that was the comparison that matched. The write on line 55 did
  nothing to the border at all.
- **`OPEN_LINE = 252`, the clear landing one line late.** An ordinary
  closed frame: border on rows 0–34 and 235–271, bottom border from line
  251, zero sprite pixels. The flip-flop was set at the left edge of line
  251 while RSEL was still 1, and nothing that happens afterwards can clear
  it before line 51.

If the picture shows both borders closed with the bottom one starting four
lines early, RSEL is 0 on line 247; if it is an ordinary frame, RSEL is
still 1 when line 251 begins. If the opened area is black rather than blue
on a machine or emulator whose RAM does not start zeroed, `$3FFF` is not
zero (see below); this listing writes it.

## Why this works

### The vertical border flip-flop

Bauer's article (§3.9) describes two flip-flops. The main border flip-flop
is what draws `$D020`: while it is set, the border colour has priority over
graphics and sprites alike. It is set when the beam reaches the right
comparison X and reset at the left one (the side-border mechanism of
`sideborder-open.md`). The vertical border flip-flop sits behind it: while
the vertical one is set, the main one cannot be reset at the left edge, and
the graphics sequencer puts out background colour instead of data. The
vertical flip-flop's comparison lines depend on RSEL:

| | RSEL=0 (24 rows) | RSEL=1 (25 rows) |
|---|---|---|
| top | 55 | 51 |
| bottom | 247 | 251 |

The rules that move it, paraphrased from the article's list: the raster is
checked against the bottom line in cycle 63 of every line and again when
the beam reaches the left comparison X; a match **sets** the flip-flop. It
is checked against the top line at the same two moments; a match **resets**
it, but only if DEN is set. That is the whole list. There is no set that
looks at the top line and no reset that looks at the bottom one, and no
frame-start event touches it. Bauer says the comparisons match only when
the value is reached exactly, never over an interval.

A normal frame therefore goes: reset at line 51 (display starts), set at
line 251 (border resumes), and nothing in between. The set on line 251
happens at the left comparison, early in the line, which is why the whole
visible width of line 251 is border, measured as row 235 in the closed
control, with the display area beginning on row 35, line 51.

### One write, both borders

RSEL is 1 while line 247 passes: both of that line's checks are looking for
251, and 247 is not 251. RSEL is 0 by the time line 251 arrives: both of
its checks are looking for 247, and 251 is not 247. Neither bottom
comparison matches, the flip-flop is not set, and the bottom border of
this frame is drawn as background from line 251 on. Then the frame runs
out through the vertical blank and into lines 0–50 of the next one with
the flip-flop still clear, because the only thing that could set it is a
bottom comparison and the next one of those is 200 lines away. The top
border is open too. At line 51 the top comparison fires a reset on a
flip-flop that is already clear, and the display carries on as usual.

That is why the listing does nothing anywhere near line 51: the top border
opens as a consequence of suppressing the set at the bottom, not because of
a second write. The earlier technique text asked for RSEL=0 on line 55 to
open the top border "symmetrically". Line 55 is a *top* comparison line
(with RSEL=0), and a top comparison can only reset; the first control build
does exactly that write and both borders stay closed. For the same reason
there is no "bottom border only" or "top border only": once the set on
251 has been suppressed, nothing can set the flip-flop again before 247 of
the next frame, and the two borders come as a pair. A demo that appears to
open only one of them is painting the other one back (`$D021` set to the
border colour over those lines from another raster interrupt), not closing
it.

The second interrupt puts RSEL back to 1 so that next frame's line 247 is
not a match either. It can land anywhere from 252 to 246 of the next frame;
the listing uses line 0, and both ends of that window were swept in VICE
(PAL). `RESTORE_LINE = 252` and `RESTORE_LINE = 246` each give a picture
pixel-identical to the listing's. `RESTORE_LINE = 251` closes the frame
again, with the bottom border beginning one line late, on 252 (row 236):
the left-edge check on line 251 saw RSEL=0 and did not match, but the
handler had put RSEL back to 1 before that line's cycle-63 check, which
then found 251. `RESTORE_LINE = 247` closes it with the 24-row geometry
(border on rows 0–38 and 231–271, display on lines 55–246) because RSEL was
still 0 when line 247's left-edge check ran, so 247 matched, and it had
been 0 at line 55 as well. The window is exact at both ends.

### Where the clearing write may land, measured

The interrupt handler is entered on cycle 39–45 of its line (the interrupt
sequence starts on cycle 3–9, then 7 cycles of sequence and 29 of KERNAL
dispatcher; measured in VICE, `techniques/raster.md`, `stable_raster_irq`
Cycle budget; an earlier version said 37–43, arithmetic, here and in the
listing comment), and the `LDA/AND/STA`
puts the new RSEL on the bus about ten cycles later, in the second half of
the line. With that latency, `OPEN_LINE` was swept in VICE:

| `OPEN_LINE` | result | bottom border begins |
|---|---|---|
| 247 | closed | line 248 |
| 248 | open | — |
| 249 | open | — |
| 250 | open | — |
| 251 | closed | line 251 |
| 252 | closed | line 251 |

247 fails because the write lands *before* that line's cycle-63 check, so
the check sees RSEL=0 and 247 matches; the border starts one line later
than in the `OPEN_LINE = 55` control because line 247's earlier check, at
the left edge, still saw RSEL=1. 251 fails although the write lands before
that line's cycle 63: the left-edge check at X=24 (roughly cycle 16, by
arithmetic from the X=344-on-cycle-56 figure in `sideborder-open.md`, not
measured here) has already set the flip-flop when the handler is entered
on cycle 39 or later (37 before the entry was measured). So with a plain raster interrupt the window is the
three whole lines 248–250, not "anything before the end of 251"; only a
write placed in the first dozen or so cycles of 251 could stretch it, and
nothing here needs that.

### The read-modify-write and bit 7

RSEL shares `$D011` with YSCROLL, DEN, BMM, ECM and RST8, so the handlers
read the register, change bit 3 and write it back. Bit 7 needs care: on a
read it is bit 8 of the *current raster line*, not the compare value that
was last written, and writing it back set moves the raster compare above
line 255. Both handlers mask it off. In this listing every interrupt line
is below 256, so the bit reads as 0 anyway; the mask covers a
`RESTORE_LINE` moved to 260. `d012_wrap_around` in
`pitfalls/raster-and-badline.md` has the general form.

### The idle display and `$3FFF`

After the last character row the VIC is in its idle state, in which the
graphics data comes from VIC address `$3FFF` (`$39FF` with ECM), that is
`$3FFF` of the current 16 KB video bank, so `$3FFF` in bank 0, which this
listing and the BASIC screen use, and `$7FFF`, `$BFFF` or `$FFFF` in the
others (Bauer §3.7.3.9 and the memory map in §2.4; not measured here). The
byte is displayed in the current graphics mode with the video-matrix data
taken as all zero. In a text mode, which is what this listing runs in,
that means every set bit is drawn in colour 0 (black) over the
background colour: the opened area shows the eight pixels of
`$3FFF` repeated across the line. With `$3FFF` zero the area is plain
background. With `$3FFF` non-zero it carries a black stripe pattern, and
since this recipe's border is also black, a forgotten `$3FFF` could make
an open border look closed. (In standard bitmap mode both pixel colours
come from the zeroed video-matrix nibbles, so the opened area is black
whatever `$3FFF` holds; from Bauer's colour rules in §3.7.3.3, not
measured here.) The listing writes zero there. In VICE 3.10 the write made
no difference: a build without it is pixel-identical, and a probe that
copies the byte into `$D020` (low nibble) and `$D021` (high nibble) shows
both black, so `$3FFF` reads back as `$00` in VICE's default configuration.
Power-on RAM contents on hardware are not something this page measured,
and the write costs three bytes, one `STA`; the `LDA #0` is needed for
`$D020` anyway.

### The sprite

The sprite's Y register is 4, not 260, because there is no 260: sprite Y is
eight bits and the VIC compares it against the low eight bits of the raster
line (Bauer §3.8.1), turning the sprite's DMA on in cycle 55 or 56 of a
matching line (the article's rule 3 makes the check in the first phase of
both cycles) and drawing its first row on the following line. Line 260 matches, so
the sprite is drawn on lines 261–281 (rows 245–265 of the picture), and
line 4 matches too, giving a second copy on lines 5–25, of which the picture
(which begins at line 16) shows rows 0–9. Both copies stand in what is
normally border. In the control builds the sprite has zero visible pixels
although it is enabled and positioned identically: the border has the
highest display priority and is drawn over it. Opening the border does not
make sprites render in new places; it stops the border covering them.

### Region

`region: both`. The comparison lines are the same on the 6567R8, and the
handler's entry cycle is the same on a 65-cycle line. Measured with
`-model ntsc` (VICE 3.10, 6567R8, 384×247 picture, screenshot row = raster
line − 28): the closed control has border colour at x=192 on rows 0–22 and
223–246, which puts line 51 on row 23 and line 251 on row 223; the open
build has background on all 247 rows at x=192 and border on all 247 rows at
x=2; the sprite occupies x 108–131 on rows 233–246, which is lines 261–262
and then 0–11 of the next frame, where the picture ends; the sprite's row
counter runs straight through the frame wrap. `OPEN_LINE = 251` closes the
border from row 223 on NTSC exactly as on PAL, and the rest of the sweep is
the same table: `OPEN_LINE = 247` closes it from row 220 (line 248), and
248 and 250 give pictures pixel-identical to the 249 build's.

### Screenshot geometry

The PAL offset used above, row = raster line − 16, was derived rather than
assumed: the closed control's bottom border begins on row 235 and the rules
above put it on line 251; its display begins on row 35, line 51; and a
reference build with the sprite at Y=150, first drawn on line 151 by
Bauer's rule, has its first sprite row at 135. Three independent facts
give 16. Earlier pages in this repository and its harness notes stated 14;
the committed `hello-world.png` and `raster-bars.png`, which
`screenshots/README.md` labels VICE 3.9, have their boundaries on rows 35,
235 and 40 (line 56, the first raster bar), so 16 is what the instrument
has done all along. The harness notes (`CLAUDE.md` and the
`verify-listing` skill) were corrected to 16 when this page landed. The
NTSC offset of 28 was derived the same way from the same three boundaries
(display rows 23–222, sprite at Y=150 first drawn on row 123).

## Sources

- Christian Bauer, *The MOS 6567/6569 video controller (VIC-II) and its
    application in the Commodore 64*, 28 August 1996: §3.9 (the two border
  flip-flops, the comparison values and the six switching rules), §3.8.1
  rule 3 (sprite Y compared against the low eight bits of the raster in the
  first phase of cycles 55 and 56, display from the following line),
  §3.7.3.9 (idle state: graphics from `$3FFF`/`$39FF` with the video-matrix
  data as zero), §3.7.3.1–3.7.3.3 (which nibble colours a "0" and a "1"
  pixel in each mode), §2.4 (the 16 KB bank), §3.10 (DEN gates the reset
  input only). https://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt
- VICE 3.10 x64sc, headless, `-model` default (PAL C64C: 8565, 8580, 8521;
  an earlier version said PAL 6569) and `ntsc` (6567R8); KickAssembler 5.25. All row, column and colour figures on this
  page are from those runs, measured with a script, none by eye.
- This repository: `recipes/kickassembler/stable-raster-irq.md` and
  `techniques/raster.md` (handler entry on cycle 39–45), `recipes/kickassembler/raster-bars.md` (the
  `$EA81`/`$EA31` exits), `pitfalls/raster-and-badline.md`
  (`d012_wrap_around`).
