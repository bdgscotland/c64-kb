---
recipe: sprite-border-scroller
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sprite_border_scroller]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D011, D012, D015, D017, D019, D01A, D01B, D01C, D01D, D020, D021, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, DC04, DC05, DC0D, DC0E]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_b (init), cia1_tod (init)]
harness: [cia1_timer_a]
---

<!-- doc-type: recipe -->

# KickAssembler Sprite Border Scroller

## Synopsis

A text scroller of eight hardware sprites that runs in the lower border,
underneath the display, so the forty by twenty-five character screen is
left whole for whatever else the program wants to show. The border is
opened every frame the way `topbottom-border-open.md` does it: a raster
interrupt on line 249 clears RSEL, so neither of the VIC-II's bottom
comparison lines is ever matched and the vertical border flip-flop is
never set; a second interrupt on line 20 of the next frame puts RSEL
back. That second interrupt also moves the sprites. Every sprite has
Y 254, so its 21 rows are drawn from raster line 255 down, in what is
normally border; a shared 9-bit scroll position `p` steps down by 2 a
frame and sprite `k` sits at `X = (p + 48k) mod 384`, enabled only while
X is 0 to 343. When a sprite reaches X 4 its glyph is wholly under the
left border and it takes the next character of the text, rendered from
the character ROM into its own 64-byte slot exactly as
`dypp-sprite-scroller.md` renders it. After 300 frames `p` is frozen and
the picture is static. Both interrupt handlers are timed with CIA 1
timer A and logged to RAM. This is the `sprite_border_scroller`
technique.

Verified in VICE x64sc: at the pinned cycle count the white glyph rows
sit on screenshot rows 241 to 254 on PAL (raster lines 257 to 270) and
229 to 242 on NTSC, every one of them below the line-251 border edge,
and the two runs per model are byte-identical. A control build with the
RSEL write left out has no white pixel anywhere below the display: the
border covers the sprites.

## Source

```asm
// sprite-border-scroller.asm
// A text scroller of eight hardware sprites standing in the opened lower
// border. Two plain raster interrupts through $0314 open the border the way
// topbottom-border-open.asm does: RSEL is cleared on line 249, after line
// 247's bottom comparison has passed and before line 251's arrives, so the
// vertical border flip-flop is never set and the rest of the frame is drawn
// as background. RSEL is put back on line 20 of the next frame, and that
// same interrupt moves the sprites: a shared 9-bit scroll position p steps
// down by 2 a frame; sprite k sits at X = (p + 48k) mod 384 and every sprite
// has Y = 254, so its 21 rows are drawn from raster line 255, below the
// display. A sprite is enabled only while X is 0..343; when X reaches 4 its
// glyph is wholly under the left border, so it takes the next character of
// the text and re-renders it from the character ROM into its own 64-byte
// slot (a 2x2 block per glyph pixel, sprite rows 2..17, columns 4..19),
// as dypp-sprite-scroller.asm does. After FRAMES frames p is frozen and the
// picture is static. $3FFF is written to zero because the VIC fetches its
// idle-state graphics from there and would draw its set bits over the
// opened area.
//
// Both handlers are timed with CIA 1 timer A (one-shot from $FFFF) and
// logged to RAM for a -moncommands dump. Build with -define NOOPEN for the
// control: the line-249 handler runs but leaves RSEL alone, so the border
// stays closed and covers the sprites.
// Region: both.

.const SCREEN       = $0400
.const SPRBASE      = $2000         // eight 64-byte slots $2000..$21c0, pointers $80..$87
.const XSTEP        = 48            // pixels between adjacent columns
.const SPRITE_Y     = 254           // first row drawn on raster line 255
.const OPEN_LINE    = 249           // 248, 249 and 250 open; 247 and 251 do not
.const RESTORE_LINE = 20            // anywhere from 252 to 246 of the next frame
.const FRAMES       = 300           // updates before p is frozen
.const OLOG         = $3000         // open handler time per frame, 2 bytes each ($ffff - timer)
.const RLOG         = $3400         // restore handler time per frame, 2 bytes each
.const DONE         = $02ff         // 1 from the frame the picture is frozen
.const CAPLEN       = 27            // the caption's length, centred on row 12
.const CAPCOL       = (40 - CAPLEN) / 2

.const ptr = $fb                    // zero page: sprite slot pointer
.const src = $fd                    // zero page: character ROM pointer

// Each glyph bit becomes two sprite bits: dbl(b) is the 16-bit doubling of
// byte b. Glyph column gx lands on sprite columns 4+2gx and 5+2gx, so
// byte 0 of the sprite row takes the top 4 bits of dbl, byte 1 the middle 8
// and byte 2 the bottom 4 shifted into its high nibble.
.function dbl(b) {
    .var e = 0
    .for (var i = 0; i < 8; i++) {
        .if (((b >> i) & 1) == 1) .eval e = e | (3 << (2 * i))
    }
    .return e
}

.pc = $0801 "basic"
:BasicUpstart(start)

.pc = $0810 "code"
start:
    sei
    lda #$7f
    sta $dc0d                       // mask every CIA1 source
    lda $dc0d                       // and drop a pending one

    lda #0
    sta $3fff                       // idle-state graphics byte: zero, so the
                                    // opened area is plain background
    sta $d020                       // border black
    sta $d021                       // background black
    sta frame
    sta frame+1
    sta tidx
    sta rcount
    sta DONE
    lda #<6                         // p starts at 6: sprite 0 reaches X 4 on frame 1
    sta pos
    lda #>6
    sta pos+1

    ldx #0                          // clear the screen and the eight slots
    lda #$20
clr:
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    inx
    bne clr
    lda #0
clr2:
    sta SPRBASE,x
    sta SPRBASE+$100,x
    inx
    bne clr2

    ldx #CAPLEN-1                   // the caption on row 12, white
cap:
    lda caption,x
    sta SCREEN+12*40+CAPCOL,x
    lda #1
    sta $d800+12*40+CAPCOL,x
    dex
    bpl cap

    ldx #7                          // pointers $80+k, white, Y 254, no expansion
setup:
    txa
    clc
    adc #SPRBASE/64
    sta SCREEN+$3f8,x
    lda #1
    sta $d027,x
    lda #SPRITE_Y
    ldy pairs,x
    sta $d001,y
    dex
    bpl setup
    lda #0
    sta $d017
    sta $d01d
    sta $d01c
    sta $d01b
    sta $d010
    sta $d015                       // enabled per sprite by the update

    lda #<open
    sta $0314
    lda #>open
    sta $0315
    lda #$1b
    sta $d011                       // DEN=1, RSEL=1, YSCROLL=3, RST8=0
    lda #OPEN_LINE
    sta $d012
    lda #$01
    sta $d01a                       // raster source on
    sta $d019                       // stale flag off
    cli
    jmp *

// Line OPEN_LINE, entered on cycle 37-43: RSEL to 0 with YSCROLL and DEN
// kept, bit 7 masked off (on a read it is the raster's ninth bit).
open:
    cld                             // the log arithmetic must be binary
    lda #$ff                        // start the stopwatch
    sta $dc04
    sta $dc05
    lda #$19
    sta $dc0e
#if !NOOPEN
    lda $d011
    and #%01110111
    sta $d011                       // the control build omits this write
#endif
    lda #RESTORE_LINE
    sta $d012
    lda #<restore
    sta $0314
    lda #>restore
    sta $0315
    lda #$01
    sta $d019
    lda #$08                        // stop the stopwatch, log it at OLOG + 2*frame
    sta $dc0e
    lda #<OLOG
    sta ptr
    lda #>OLOG
    sta ptr+1
    jsr logtime
    jmp $ea81                       // pla/tay/pla/tax/pla/rti

// Line RESTORE_LINE: RSEL back to 1 so next frame's line 247 is not a
// bottom comparison either; then the position update and any hand-off,
// while no sprite is being drawn on either model.
restore:
    cld
    lda #$ff                        // start the stopwatch
    sta $dc04
    sta $dc05
    lda #$19
    sta $dc0e
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

    lda frame+1                     // frozen after FRAMES updates
    cmp #>FRAMES
    bne go
    lda frame
    cmp #<FRAMES
    bne go
    lda #1
    sta DONE
    jmp done
go:
    lda pos                         // p = (p - 2) mod 384
    sec
    sbc #2
    sta pos
    lda pos+1
    sbc #0
    sta pos+1
    bpl !+
    lda pos
    clc
    adc #<384
    sta pos
    lda pos+1
    adc #>384
    sta pos+1
!:
    lda #0
    sta msb
    sta ena
    sta pend
    lda pos                         // running X = p + 48k, 16-bit
    sta xl
    lda pos+1
    sta xh
    ldx #0
next:
    lda xh                          // X >= 384 ? X -= 384
    beq inrange
    cmp #1
    bne sub384
    lda xl
    cmp #<384
    bcc inrange
sub384:
    lda xl
    sec
    sbc #<384
    sta xl
    lda xh
    sbc #>384
    sta xh
inrange:
    lda xh
    beq onscreen                    // X < 256: on screen, no MSB
    lda xl
    cmp #344-256
    bcs offscreen                   // X 344..383: sprite off this frame
    lda bits,x                      // X 256..343: MSB set
    ora msb
    sta msb
onscreen:
    lda bits,x
    ora ena
    sta ena
offscreen:
    lda xh                          // X == 4: glyph wholly under the left border
    bne nohand
    lda xl
    cmp #4
    bne nohand
    inx                             // pend = k + 1
    stx pend
    dex
nohand:
    ldy pairs,x
    lda xl
    sta $d000,y
    clc                             // next column: X += 48
    adc #XSTEP
    sta xl
    bcc !+
    inc xh
!:  inx
    cpx #8
    bne next
    lda msb
    sta $d010
    lda ena
    sta $d015

    lda pend                        // a sprite reached X 4: hand it the next character
    beq nohandoff
    tax
    dex
    ldy tidx
    lda text,y
    cmp #$ff
    bne !+
    ldy #0
    sty tidx
    lda text
!:  sta code
    inc tidx
    jsr render
    inc rcount
nohandoff:
    lda #$08                        // stop the stopwatch, log it at RLOG + 2*frame
    sta $dc0e
    lda #<RLOG
    sta ptr
    lda #>RLOG
    sta ptr+1
    jsr logtime
    inc frame
    bne !+
    inc frame+1
!:  jmp $ea31                       // full KERNAL service once a frame
done:
    lda #$08
    sta $dc0e
    jmp $ea31

// Store $ffff - timer at (ptr) + 2*frame, ptr pointing at a log base.
logtime:
    lda frame
    asl
    sta off
    lda frame+1
    rol
    sta off+1
    lda off
    clc
    adc ptr
    sta ptr
    lda off+1
    adc ptr+1
    sta ptr+1
    ldy #0
    lda $dc04
    eor #$ff
    sta (ptr),y
    iny
    lda $dc05
    eor #$ff
    sta (ptr),y
    rts

// Render screen code `code` into sprite slot X (0..7). The eight glyph
// bytes are copied out of the character ROM with $01 = $33, then each is
// expanded through three tables into two identical sprite rows.
render:
    lda slotlo,x
    sta ptr
    lda slothi,x
    sta ptr+1
    lda #0
    sta src+1
    lda code                        // ROM address = $d000 + code * 8
    asl
    rol src+1
    asl
    rol src+1
    asl
    rol src+1
    sta src
    lda src+1
    ora #$d0
    sta src+1
    lda #$33
    sta $01
    ldy #7
!:  lda (src),y
    sta gbuf,y
    dey
    bpl !-
    lda #$37
    sta $01
    .for (var r = 0; r < 8; r++) {
        ldx gbuf+r
        lda t0,x                    // sprite rows 2+2r and 3+2r, bytes 0..2
        ldy #6*r+6
        sta (ptr),y
        ldy #6*r+9
        sta (ptr),y
        lda t1,x
        ldy #6*r+7
        sta (ptr),y
        ldy #6*r+10
        sta (ptr),y
        lda t2,x
        ldy #6*r+8
        sta (ptr),y
        ldy #6*r+11
        sta (ptr),y
    }
    rts

caption: .text "sprites in the lower border"   // lowercase: .text is screen codes
bits:   .byte 1, 2, 4, 8, 16, 32, 64, 128
pairs:  .byte 0, 2, 4, 6, 8, 10, 12, 14
slotlo: .fill 8, <(SPRBASE + i * 64)
slothi: .fill 8, >(SPRBASE + i * 64)

// The message: screen codes, $ff ends it and it wraps.
text:   .text "the border is open and the words walk through it    "
        .byte $ff

.align $100
t0:   .fill 256, dbl(i) >> 12
t1:   .fill 256, (dbl(i) >> 4) & $ff
t2:   .fill 256, (dbl(i) & $0f) << 4

.pc = $3800 "state" virtual
msb:    .byte 0                     // $d010 as written
ena:    .byte 0                     // $d015 as written
pend:   .byte 0                     // sprite number + 1 due a hand-off, or 0
frame:  .word 0
pos:    .word 0                     // p, 0..383
tidx:   .byte 0                     // next character of text
rcount: .byte 0                     // renders so far
xl:     .byte 0
xh:     .byte 0
code:   .byte 0
off:    .word 0                     // 2*frame, the log offset
gbuf:   .fill 8, 0
```

## Build

```bash
java -jar KickAss.jar sprite-border-scroller.asm -o sprite-border-scroller.prg
```

For the control, which runs the same two interrupts but never clears
RSEL:

```bash
java -jar KickAss.jar sprite-border-scroller.asm -define NOOPEN -o sprite-border-scroller-noopen.prg
```

## Expected output

A black screen and a black border, with `SPRITES IN THE LOWER BORDER` in
white on character row 12, centred. Below the display, where the bottom
border would be, white capital letters 16 pixels wide and 14 tall (each
glyph pixel a 2 by 2 block; the ROM capitals use seven of their eight
rows) walk left two pixels a frame, 48 pixels apart. The message is
`THE BORDER IS OPEN AND THE WORDS WALK THROUGH IT`, followed by four
spaces, repeating. The first character enters at the right edge about
twenty frames in; before that the sprites are blank. At most seven
glyphs are visible at once; for twenty frames in every twenty-four the
eighth sprite is disabled between X 344 and X 383, carrying the next
character, and for the other four it is enabled under the left border at
X 0 to 6. Nothing else moves; there is no frame counter on this page's
screen.

At frame 300 the picture freezes and holds. It shows, left to right,
`O R D E R`, a blank column, and `I`.

Screenshots from the runs this page describes:
`screenshots/sprite-border-scroller.png` (PAL) and
`screenshots/sprite-border-scroller-ntsc.png` (NTSC), both at
10,000,000 cycles.

### The pinned frame: 10,000,000 cycles, frame 300 frozen

`p` after 300 steps of 2 from 6 is `(6 - 600) mod 384 = 174`, the same
frozen position as the DYPP recipe, because the position rule is the
same. Hand-off `n` gives character `n` of the message; sprite `k` was
handed characters `k` and `k + 8`, sprites 0 to 4 twice and 5 to 7
once, thirteen hand-offs in all. The VIC registers were read back with a
`-moncommands` store trace on `$02FF` (`m d000 d015`), and the same
dump is what the cycle logs below came from.

| Sprite | Character | X | On screen | $D010 bit | Predicted first lit column | Measured columns, both models |
|---|---|---|---|---|---|---|
| 5 | `O` (char 5) | 30 | yes | 0 | 44 | x 44 to 55 |
| 6 | `R` (char 6) | 78 | yes | 0 | 92 | x 92 to 103 |
| 7 | `D` (char 7) | 126 | yes | 0 | 140 | x 140 to 151 |
| 0 | `E` (char 8) | 174 | yes | 0 | 188 | x 188 to 199 |
| 1 | `R` (char 9) | 222 | yes | 0 | 236 | x 236 to 247 |
| 2 | space (char 10) | 270 | yes, blank | 1 | no ink | none |
| 3 | `I` (char 11) | 318 | yes | 1 | 334 | x 334 to 341 |
| 4 | `S` (char 12) | 366 | no, disabled | 0 | not drawn | none |

`$D010` reads `$0C` and `$D015` reads `$EF`; the eight Y registers all
read 254; the X low bytes read 174, 222, 14, 62, 110, 30, 78, 126. A
sprite pixel column `c` of a sprite at X lands on screenshot column
`X + c + 8` (the display's X 24 is screenshot column 32), so a glyph
whose ROM bitmap starts at column `g` first lights at `X + 2g + 12`:
`g = 1` for `O`, `R`, `D` and `E`, `g = 2` for `I`.

The white rows, measured on the screenshot with a script:

- **PAL** (384 by 272, screenshot row = raster line minus 16): white
  pixels below the display on rows 241 to 254, raster lines 257 to 270,
  and on no other row past 235 (line 251). That is sprite rows 2 to 15:
  the render puts glyph row `gy` on sprite rows `2 + 2gy` and
  `3 + 2gy`, and the ROM capitals leave glyph row 7 blank, so sprite
  rows 16 and 17 carry no ink. Sprite rows 0 and 1 and 18 to 20 are
  margin. All 21 sprite rows, lines 255 to 275, are inside the PAL
  frame; 632 white pixels lie below line 251, and 591 above it, which is
  the caption.
- **NTSC** (384 by 247, screenshot row = raster line minus 28): white
  pixels on rows 229 to 242, the same fourteen row counts as PAL row for
  row (56, 56, 40, 40, 40, 40, 48, 48, 40, 40, 40, 40, 52, 52), 632
  pixels. The NTSC frame ends at line 262, so rows 229 to 234 are lines
  257 to 262 of the frame the sprite started in and rows 235 to 242 are
  lines 0 to 7 of the next frame: the sprite's row counter runs straight
  through the frame wrap, as `topbottom-border-open.md` measured for its
  parked sprite. Of the 21 sprite rows, rows 0 to 19 (lines 255 to 262,
  then 0 to 11) are in the picture and row 20 falls on line 12, one past
  the picture's last row 246; it is a blank margin row, so no ink is
  lost. Whether line 12's row is visible on a real NTSC set is not
  measured here.

The cycle count was chosen for a static picture, not for a beam
position: `DONE` (`$02FF`) is first stored with 1 at cycle 8,885,887 on
PAL (raster line 21, inside the restore handler) and 8,241,204 on NTSC,
so at 10,000,000 the picture has held for about 56 PAL frames or 102
NTSC frames (arithmetic from 19,656 and 17,095 cycles a frame), and the
exit lands in a frame identical to the one before it whichever row the
beam is on. Two runs per model gave byte-identical PNGs (md5
`f26f8d902cd2bf17f7cde1c21b66699c` PAL, `19d0a6defa458180dc6084155546e348`
NTSC).

### Mid-motion, not pinned: 6,000,000 cycles

About 154 frames in on PAL. Seven hand-offs have happened (frames 1, 25,
49, 73, 97, 121 and 145) and the picture shows `T H E`, a gap, `B O`,
white pixels on the same rows 241 to 254 spanning columns 98 to 349; the
`R` handed over at frame 145 is still in the disabled gap and re-enters
at frame 168. On NTSC the same rows 229 to 242, columns 68 to 319, a few
frames further on because NTSC frames are shorter. A picture taken while
`p` is moving is not pinned: the exit screenshot is the draw buffer at
the cycle limit, and a limit that lands inside lines 255 to 275 would
show the previous frame's rows below the beam.

### The control: RSEL never cleared

`-define NOOPEN` leaves out the three instructions that clear RSEL and
changes nothing else: the same two interrupts run, the same sprites are
positioned and enabled, the same `$D010` and `$D015` are written. Both
models: zero white pixels on any row from line 251 down (screenshot rows
235 to 271 on PAL, 223 to 246 on NTSC), 591 white pixels in the whole
picture, all of them the caption. The sprites are there, enabled, at
Y 254; the border is drawn over them.

### Cycle costs, CIA 1 timer A

Each handler loads timer A with `$FFFF`, starts it one-shot
(`$DC0E = $19`), stops it (`$DC0E = $08`) at the end of its own work and
stores `$FFFF` minus the reading, two bytes per frame, at `$3000` (the
line-249 handler) and `$3400` (the line-20 handler); 300 entries each,
read back with the same `-moncommands` dump. PAL and NTSC logs are
identical to the cycle. The figures are raw: the bracket's own
`LDA/STA/LDA` after the start and `LDA #$08 / STA` before the stop are
inside them.

- **Line 249, the open**: 39 cycles in all 300 frames. It is the
  read-modify-write of `$D011`, the next raster compare, the vector
  swap and the acknowledge.
- **Line 20, the restore and the position update**: 790 cycles in 182
  of the 300 frames; minimum 734 (4 frames), maximum 811 (2 frames)
  when no sprite is handed a character, the other values being 757
  (21), 767 (36), 775 (8) and 798 (34). The spread is the per-column
  branches: how many of the eight need the 384 subtracted, how many are
  past 255, whether one is off, whether one is at X 4. In the thirteen
  hand-off frames the handler costs 1,506 (2), 1,539 (9) or 1,547 (2),
  which is the update plus the render.
- **Both handlers together**, frame by frame: 829 cycles in 182 frames,
  minimum 773, maximum 1,586, the worst frame being a hand-off. That is
  about 25 PAL raster lines, from line 20 to about line 46, all above
  the display and below the last sprite row on either model. The
  `$EA31` exit and the KERNAL's 29-cycle entry are outside the brackets.

## Why this works

### The border flip-flop and the sprites under it

`topbottom-border-open.md` has the mechanism in full: the vertical
border flip-flop is set only when the raster reaches the bottom
comparison line, 251 with RSEL set or 247 with it clear, and reset only
at the top one while DEN is set. RSEL is 1 while line 247 goes by and 0
by the time line 251 arrives, so no bottom comparison matches, the
flip-flop stays clear, and everything from line 251 to the end of the
frame and on through the next frame's top border is drawn as
background. `OPEN_LINE` is that recipe's 249, the middle of the three
lines 248 to 250 it measured as working with a plain `$0314`
interrupt; `RESTORE_LINE` is 20, inside the 252-to-246 window it swept,
chosen here so that the same handler can move the sprites at a moment
when none of them is being drawn on either model (the last sprite row
is line 275 on PAL and line 12 of the following frame on NTSC).

While the flip-flop is set the border colour has priority over sprites
and graphics alike, which is what the control build shows: seven
enabled sprites at Y 254 and not one white pixel. Opening the border
does not put the sprites anywhere new; it stops the border being drawn
over the place they already were. `$3FFF` is written to zero because the
VIC is in its idle state below the display and fetches its graphics
from the last byte of the video bank: with a text mode and a zero
byte the opened area is plain background, and with a non-zero byte it
would carry that byte's set bits as a black stripe pattern, invisible
against this page's black background but drawn over a sprite pixel
where the two coincide. In VICE 3.10 `$3FFF` reads back as zero before
the write (its default RAM pattern is `00 00 ff ff ff ff 00 00`, so the
neighbouring bytes are not); hardware need not.

### Sprite Y 254

Sprite Y is compared against the low eight bits of the raster line, and
a match turns the sprite's DMA on with its first row drawn on the
following line. 254 matches line 254 and the sprite occupies lines 255
to 275 on PAL, all inside the frame's 312 lines and all below the
display, which ends on line 250. It would also match line 510 if there
were one; there is not, so unlike the topbottom recipe's Y 4, which
draws twice, this sprite is drawn once a frame. On NTSC the 21 rows run
past the frame's last line, 262, and continue on lines 0 to 12 of the
next frame, so the letters straddle the frame boundary and still come
out whole in the emulator's picture, less the one blank row past its
edge.

### The X rule, the mask and the hand-off

These are the DYPP recipe's, unchanged: a 16-bit running sum steps 48
per column and drops 384 once, the low byte goes to `$D000 + 2k`, a
high byte of 1 with a low byte under 88 sets the sprite's `$D010` bit,
and a low byte of 88 or more with the high byte set disables the sprite
in `$D015` for the frame. `$D010` and `$D015` are written once each
after the eight low bytes, inside the same handler, so no frame shows a
mask that disagrees with a low byte. A sprite passes X 4 exactly once a
lap because every X is even; there its columns 4 to 19 are at X 8 to 23,
under the left border, so the re-render is invisible, and it comes back
in at X 342 twenty-three frames later carrying the new character. The
render itself, character ROM under `$01 = $33`, three doubling tables,
sixteen rows of three bytes, is the DYPP recipe's `render` verbatim.

Both handlers begin with `CLD`: the log arithmetic and the position sum
are binary, and an interrupt inherits the D flag of whatever it broke
into. The one difference from the DYPP recipe is where the update runs. That
recipe polls `$D012` for line 255 in a main loop; here the sprites
themselves sit on lines 255 to 275, so the update moves to the line-20
interrupt instead, which is also the handler that restores RSEL. Two
interrupts a frame, no main-loop work at all: the main program is a
`jmp *`.

## What it does not establish

Nothing here was run on hardware; the border behaviour, the row
positions, the NTSC frame-wrap drawing and the cycle counts are VICE
x64sc 3.10 figures, and whether an NTSC set shows the rows that fall on
lines 0 to 12 of the next frame is a question for a monitor, not an
emulator. The glyphs are single-colour doublings of the ROM capitals;
multicolour or hand-drawn fonts are not tried, and the upper border,
which this method opens as well, is left empty. The sprites are drawn
at one fixed Y; bobbing them inside the border is described on the
technique page and not built. The 300-frame freeze is for the pin, not
part of the technique.
