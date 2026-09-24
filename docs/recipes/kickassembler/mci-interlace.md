---
recipe: mci-interlace
toolchain: kickassembler
output_format: PRG
region: both
techniques: [mci_interlace_bitmap]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D020, D021, DC04, DC05, DC0E, DD00]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Multicolour Interlace (MCI) Bitmap

## Synopsis

Two multicolour bitmaps are shown on alternate frames, the odd frame moved
right by one hires pixel through XSCROLL, so a display with persistence
averages them into a picture with twice the horizontal colour resolution
of one multicolour frame, at the cost of a flicker at half the frame rate.
The content is a test card the program draws itself at start-up: eight
vertical bands, each two colours in alternating multicolour pixels with the
two colours swapped between the frames, and one diagonal line present in
both bitmaps at the same multicolour position, which the odd frame shows one
hires pixel further right. After 300 toggling frames the program holds
frame A, so a static picture exists for the pin. This is the
`mci_interlace_bitmap` technique.

Verified in VICE x64sc: the static pin is byte-identical on two runs per
model, the two frames' diagonals are one hires pixel apart during the
toggling phase, and the control build with XSCROLL 0 on both frames puts
them on the same columns.

## Source

```asm
// mci-interlace.asm
// Two multicolour bitmaps shown on alternate frames, the odd frame moved
// right by one hires pixel with XSCROLL, so the eye averages them into a
// picture with twice the horizontal colour resolution of one frame. The
// content is a test card the program draws itself at start-up: eight
// vertical bands of two colours in alternating multicolour pixels, with
// the two colours swapped between the frames, and one diagonal line that
// is in both bitmaps at the same multicolour position, so the odd frame
// shows it one hires pixel to the right. After HOLD_FRAMES frames the
// program stops toggling and holds frame A, so a static picture exists.
//
// Two VIC banks: two 8000-byte bitmaps and two 1000-byte screens are
// 18,000 bytes and a bank is 16,384, so frame A is in bank 1 and frame B
// in bank 0. Colour RAM is one block and is shared by both frames.
//
// Region: both. The switch is made at raster line 251, below the display
// on PAL and NTSC. Nothing is cycle-exact.

.const XSHIFT      = 1            // XSCROLL for frame B; set 0 for the control run
.const HOLD_FRAMES = 300          // toggling frames before the static hold
.const BITMAP_A    = $6000        // bank 1, in-bank $2000
.const SCREEN_A    = $5C00        // bank 1, in-bank $1C00
.const BITMAP_B    = $2000        // bank 0, in-bank $2000
.const SCREEN_B    = $0400        // bank 0, in-bank $0400
.const D018_A      = (((SCREEN_A - $4000) / $400) << 4) | (((BITMAP_A - $4000) / $2000) << 3)   // $78
.const D018_B      = ((SCREEN_B / $400) << 4) | ((BITMAP_B / $2000) << 3)                       // $18
.const D016_A      = $D8          // MCM on, CSEL 40 columns, XSCROLL 0
.const D016_B      = $D8 | XSHIFT // the same with the half-pixel shift
.const PATTERN_A   = $66          // %01 %10 %01 %10
.const PATTERN_B   = $99          // %10 %01 %10 %01
.const LINE_COLOUR = 13           // colour RAM value: the %11 colour, light green
.const RECORD      = $02F0        // timer records, frame count and done byte

.const ptr   = $FB                // zero-page pointer pair
.const tmp   = $FD
.const acc   = $FE

.pc = $0801 "basic"
:BasicUpstart(start)

.pc = $0810 "code"
start:
    sei
    lda #$0B                      // display off while the card is drawn
    sta $D011
    lda #0
    sta $D020
    sta $D021
    lda $DD00                     // the two bank values, serial lines kept
    and #$FC
    ora #$03
    sta bank_b                    // bank 0
    and #$FC
    ora #$02
    sta bank_a                    // bank 1

    jsr fill_bitmaps
    jsr fill_screens
    jsr draw_diagonal

    lda #0
    sta frame
    sta frame + 1
    lda bank_a
    sta $DD00
    lda #D018_A
    sta $D018
    lda #D016_A
    sta $D016
    lda #$3B                      // bitmap mode, display on, 25 rows, YSCROLL 3
    sta $D011

// ---- frame loop: one switch per frame at raster line 251 ----------------
loop:
    lda #251
wait_251:
    cmp $D012
    bne wait_251
    lda #$FF                      // CIA1 timer A one-shot from $FFFF
    sta $DC04
    sta $DC05
    lda #$19
    sta $DC0E
    lda frame
    and #1
    bne odd_frame
    lda bank_a                    // even frame: A, no shift
    sta $DD00
    lda #D018_A
    sta $D018
    lda #D016_A
    sta $D016
    ldx #0
    jmp stamp
odd_frame:
    lda bank_b                    // odd frame: B, one hires pixel right
    sta $DD00
    lda #D018_B
    sta $D018
    lda #D016_B
    sta $D016
    ldx #2
stamp:
    lda $DC04                     // timer at the last store, per parity
    sta RECORD, x
    lda $DC05
    sta RECORD + 1, x
    inc frame
    bne !+
    inc frame + 1
!:  lda frame
    sta RECORD + 4
    lda frame + 1
    sta RECORD + 5
    cmp #>HOLD_FRAMES
    bne leave_251
    lda frame
    cmp #<HOLD_FRAMES
    beq hold
leave_251:
    lda $D012                     // let the raster leave 251 before waiting again
    cmp #251
    beq leave_251
    jmp loop

hold:                             // static: frame A for ever
    lda #251
wait_hold:
    cmp $D012
    bne wait_hold
    lda bank_a
    sta $DD00
    lda #D018_A
    sta $D018
    lda #D016_A
    sta $D016
    lda #1
    sta RECORD + 15               // done byte at $02FF
forever:
    jmp forever

// ---- test card -----------------------------------------------------------
fill_bitmaps:                     // 32 pages each; the 192 bytes past 8000 are unused
    lda #>BITMAP_A
    sta ptr + 1
    lda #PATTERN_A
    jsr fill_32_pages
    lda #>BITMAP_B
    sta ptr + 1
    lda #PATTERN_B
fill_32_pages:
    ldx #32
    ldy #0
    sty ptr
fill_page:
    sta (ptr), y
    iny
    bne fill_page
    inc ptr + 1
    dex
    bne fill_page
    rts

fill_screens:                     // 25 rows of the 40-byte band row, twice, and colour RAM
    lda #<SCREEN_A
    sta ptr
    lda #>SCREEN_A
    sta ptr + 1
    jsr fill_screen
    lda #<SCREEN_B
    sta ptr
    lda #>SCREEN_B
    sta ptr + 1
    jsr fill_screen
    lda #LINE_COLOUR
    ldx #0
colour_loop:
    sta $D800, x
    sta $D900, x
    sta $DA00, x
    sta $DB00, x
    inx
    bne colour_loop
    rts
fill_screen:
    ldx #25
screen_row:
    ldy #39
screen_cell:
    lda band_row, y
    sta (ptr), y
    dey
    bpl screen_cell
    lda ptr
    clc
    adc #40
    sta ptr
    bcc !+
    inc ptr + 1
!:  dex
    bne screen_row
    rts

draw_diagonal:                    // multicolour x = 4/5 of y, rows 0 to 199, both bitmaps
    lda #0
    sta acc
    sta xpos
    sta ypos
diag_row:
    lda ypos
    and #7
    sta tmp                       // line within the cell row
    lda ypos
    lsr
    lsr
    lsr
    tax                           // cell row 0 to 24
    lda xpos
    lsr
    lsr
    tay                           // cell column 0 to 39
    lda row_lo, x
    clc
    adc col_lo, y
    sta ptr
    lda row_hi, x
    adc col_hi, y
    sta ptr + 1                   // byte in bitmap A
    lda xpos
    and #3
    tax
    lda pair_mask, x
    ldy tmp
    ora (ptr), y
    sta (ptr), y                  // frame A
    lda ptr + 1
    sec
    sbc #>(BITMAP_A - BITMAP_B)
    sta ptr + 1
    lda pair_mask, x
    ora (ptr), y
    sta (ptr), y                  // frame B, same multicolour position
    lda acc                       // x advances 4 every 5 rows
    clc
    adc #4
    cmp #5
    bcc !+
    sbc #5
    inc xpos
!:  sta acc
    inc ypos
    lda ypos
    cmp #200
    bne diag_row
    rts

// ---- tables and variables ------------------------------------------------
band_row:                         // cell column c is band c/5; pair (k, k+1) as the two nibbles
    .fill 40, ((floor(i / 5)) << 4) | (floor(i / 5) + 1)
row_lo:
    .fill 25, <(BITMAP_A + i * 320)
row_hi:
    .fill 25, >(BITMAP_A + i * 320)
col_lo:
    .fill 40, <(i * 8)
col_hi:
    .fill 40, >(i * 8)
pair_mask:
    .byte $C0, $30, $0C, $03      // %11 in multicolour pixel 0, 1, 2, 3 of a byte

frame:  .word 0
bank_a: .byte 0
bank_b: .byte 0
xpos:   .byte 0
ypos:   .byte 0
```

## Build

```sh
java -jar KickAss.jar mci-interlace.asm -o out.prg
```

KickAssembler 5.25; the PRG is 620 bytes.

Pinned run, PAL and NTSC:

```sh
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 12000000 -exitscreenshot out.png -autostart out.prg
```

Add `-model ntsc` for the second picture. 12,000,000 cycles is past the
300th frame on both models, so the picture is the static hold of frame A
and the exit may land on any raster line: consecutive fields are the same.
To read the timer records back, add `-moncommands timer.mon` with a file
that traces the done byte and dumps the record:

```text
logname "/tmp/timer.log"
log on
trace store 02ff
command 1 "m 02f0 02ff"
```

For the two frames of the toggling phase, PAL only, run the same command
with `-limitcycles 4990300` (frame B) and `-limitcycles 5009956` (frame A).
The two counts are one PAL frame of 19,656 cycles apart, and each lands
about 1,490 cycles after the switch on raster line 251, that is on line
274 or so, in the vertical blank, so the display rows all belong to one
field. They were derived from the monitor: the hold's done byte is stored
at cycle 9,116,570 on PAL (the trace line prints the cycle), which is
frame 300's line 251, so frame n's switch is at 9,116,570 minus
(300 - n) x 19,656; n = 90 gives 4,988,810. A count that lands
mid-display splits the picture: 5,000,000 is 11,190 cycles after that
switch, around raster line 117, and its screenshot has rows 35 to 100
equal to frame A and rows 101 to 234 equal to frame B (measured; this is
the draw-buffer behaviour in `runtime/vice-reference.md`, "Reading the
exit screenshot").

The control run is the same source with `XSHIFT` set to 0, built and run
at the same two toggling counts.

## Expected output

Black border and background. Eight vertical bands each 40 hires pixels
wide, in fine two-pixel stripes: black and white, white and red, red and
cyan, cyan and purple, purple and green, green and blue, blue and yellow,
yellow and orange (colours 0 to 8, band k is the pair k and k + 1). One
light green diagonal from the top left corner of the display to the
bottom right corner, two hires pixels wide. Nothing is printed.

`recipes/kickassembler/screenshots/mci-interlace.png` (PAL, 384 by 272)
and `mci-interlace-ntsc.png` (NTSC, 384 by 247) were each produced twice
by the pinned command with identical bytes (md5 `1707650c...` PAL,
`09e6b4be...` NTSC). Counted with PIL, the display window (x 32 to 351,
rows 35 to 234 on PAL, 23 to 222 on NTSC) holds exactly 400 light green
pixels on both models: 200 rows, two pixels each. The light green is
(183, 255, 134) in VICE's PAL palette and (198, 255, 186) on NTSC.

### The static hold (frame A)

Diagonal columns at seven rows, identical on PAL and on NTSC twelve rows
higher (the NTSC display starts at row 23):

| PAL row | NTSC row | Light green columns |
|---|---|---|
| 35 | 23 | 32, 33 |
| 60 | 48 | 72, 73 |
| 100 | 88 | 136, 137 |
| 134 | 122 | 190, 191 |
| 150 | 138 | 216, 217 |
| 200 | 188 | 296, 297 |
| 234 | 222 | 350, 351 |

Band 0 on row 60, columns 32 to 39: black, black, white, white, black,
black, white, white. Band 2 on the same row, columns 112 to 119: red
(175, 60, 88), red, cyan (126, 243, 214), cyan, red, red, cyan, cyan.
Bitmap byte $66 is %01 %10 %01 %10, so the screen's high nibble colour
comes first in every byte.

### Frame B (PAL, 4,990,300 cycles)

`screenshots/mci-interlace-frame-b.png`, produced twice with identical
bytes (md5 `7a7153a2...`). Everything is one hires pixel to the right of
frame A: the diagonal is at 33 and 34 on row 35, 73 and 74 on row 60, 191
and 192 on row 134, and 351 alone on row 234, its second pixel being under
the right border, so the window holds 399 light green pixels. Column 32,
the leftmost, is black on every row: with XSCROLL 1 in 40-column mode the
first column shows the background colour. Band 0 on row 60, columns 32 to
39: black, white, white, black, black, white, white, black. Band 2,
columns 112 to 119: white (the last pixel of band 1, moved in), cyan, cyan,
red, red, cyan, cyan, red, so the bitmap byte $99 puts the low nibble
colour first and the shift moves the whole row one column right.

All 200 display rows differ between the two frames and no border row does.

### The half-pixel check

At row 134 the diagonal is on columns 190 and 191 in frame A and 191 and
192 in frame B: one hires pixel, half a multicolour pixel, apart. The
same one-pixel difference holds at every measured row.

Control, `XSHIFT = 0`: the frame B screenshot at 4,990,300 cycles has the
diagonal on 190 and 191 at row 134, and on 32 and 33, 72 and 73, 136 and
137, 216 and 217, 296 and 297 and 350 and 351 at the other six rows,
frame A's columns, with 400 light green pixels in the window. The
band stripes still swap between the frames, the diagonal does not move,
and column 32 is no longer blank. The frame A screenshot of the control
is byte-identical to the shifted build's.

### The average

`screenshots/mci-interlace-average.png` is the PIL `Image.blend` of the
two toggling-phase screenshots at weight 0.5, an arithmetic stand-in for
what a persistent display would show; it is not a VICE output and is not
pinned. Row 60, columns 112 to 120, frame A, frame B and the average:

| Column | Frame A | Frame B | Average |
|---|---|---|---|
| 112 | red (175, 60, 88) | white | (215, 157, 171) |
| 113 | red | cyan (126, 243, 214) | (150, 151, 151) |
| 114 | cyan | cyan | cyan |
| 115 | cyan | red | (150, 151, 151) |
| 116 | red | red | red |
| 117 | red | cyan | (150, 151, 151) |
| 118 | cyan | cyan | cyan |
| 119 | cyan | red | (150, 151, 151) |
| 120 | red | red | red |

So the average of a band is a one-pixel pattern of pure red, blend, pure
cyan, blend: four distinct columns per multicolour pixel pair where one
frame has two. Band 0 on the same row from column 32: black, (127, 127,
127), white, (127, 127, 127), black, (127, 127, 127).

### The frame loop's cost

The monitor dump on the done byte reads the same on both models:

```text
>C:02f0  dd ff df ff
>C:02f4  2c 01 00 00
>C:02f8  00 00 00 00
>C:02fc  00 00 00 01
```

CIA1 timer A, one-shot from $FFFF, started after the `cmp $D012` match
and read at the `lda $DC04` after the last register store: $FFDD for the
even frame, 34 cycles, and $FFDF for the odd frame, 32 cycles ($FFFF minus
the value; the count starts the cycle after `sta $DC0E` and includes the
reading instruction's own cycles up to its read). The even path is two
cycles longer because it takes a `jmp` over the odd path where the odd
path took its branch. The frame counter is $012C, 300, and the done byte
is 1. Adding the 16 cycles from the match to the timer start (arithmetic
from the instruction table: `lda #`, `sta`, `sta`, `lda #`, `sta`) gives
50 and 48 cycles from the raster match to the last store, well inside one
raster line. The whole frame loop, with its two polls of $D012, is under
two raster lines a frame; the rest of the frame is free.

## Why this works

### Two banks, because two frames do not fit in one

A multicolour bitmap is 8000 bytes and its screen 1000; two of each are
18,000 bytes and a VIC bank is 16,384, so the two frames cannot share a
bank (an earlier plan for this page put both in bank 1 and did not fit).
Frame A is bitmap $6000 and screen $5C00 in bank 1, $D018 = $78 (screen
at in-bank $1C00, bits 7 to 4 = 7; bitmap at in-bank $2000, bit 3 set).
Frame B is bitmap $2000 and screen $0400 in bank 0, $D018 = $18. Bank 0's
character ROM shadow at $1000 to $1FFF does not touch either, and the
program at $0810 ends below $0B00. The switch is therefore three stores,
$DD00, $D018 and $D016, and the `bank_a` and `bank_b` bytes are computed
once from $DD00 so the serial bus lines in its upper bits are kept.

Colour RAM is one block at $D800 whatever bank or $D018 is selected, so
the %11 colour of every cell is the same in both frames; here it is the
diagonal's light green everywhere. That is the limit of the technique: a
converter preparing an MCI pair chooses the two screen nibbles per frame
but one colour RAM nibble per cell for both.

### The half pixel

XSCROLL shifts the whole display in hires pixels, and a multicolour pixel
is two of them, so `$D016 = $D9` on the odd frame moves frame B half a
multicolour pixel right. $D8 keeps MCM (bit 4) and CSEL (bit 3) set and
bits 6 and 7 as they read back; the register is written whole, from a
constant, so the mode bits cannot be lost to a read-modify-write of the
scroll field (`pitfalls/scroll.md`, `d016_unmasked_rmw_clobbers_csel_mcm`).
The control build shows that without the shift the two frames' diagonals
coincide and only the band stripes alternate, which is a colour blend
without the resolution gain.

### Switching below the display

`lda #251 / cmp $D012 / bne` waits for raster line 251, one line below
the 200-line window on both models, so a frame is never shown with one
bank's bitmap above a line and the other's below. The switch is done
within the line, and `leave_251` then waits for $D012 to move on, because
the loop's 50 cycles are shorter than a 63-cycle line and the poll would
otherwise match the same line twice and switch twice in one frame. Both
frames are set up before the display is turned on, so the first visible
field is already frame A.

### Drawing the card

`band_row` is 40 bytes built by `.fill`: cell column c is band c / 5,
value (k << 4) | (k + 1), copied to all 25 rows of both screens. Frame A's
bitmap is $66 throughout and frame B's is $99: the same two nibbles read in
the other order, so the stripes swap between the frames without the
screens differing. The diagonal walks x forward by four multicolour
pixels every five rows (`acc`), computes the byte from a 25-entry row
table and a 40-entry column table, ORs a %11 pair into frame A's byte and
then into the byte $4000 lower, which is the same position in frame B.
ORing %11 over %01 or %10 gives %11, the colour RAM colour, which is why
the diagonal reads light green in both frames.

### What it does not establish

Whether a real CRT's persistence blends the two frames as the PIL average
does, or how visible the 25 Hz (PAL) or 30 Hz (NTSC) flicker is to a
viewer, neither of which VICE measures. Whether a real 6569 or 6567 places
the XSCROLL 1 frame exactly one hires pixel right, as VICE does here. The
NTSC toggling phase was not photographed, only its static hold; the timer
figures are the same on both models. Nothing here is a converted picture:
how well the technique serves real artwork is a question for a converter
and a viewer, not for this test card.
