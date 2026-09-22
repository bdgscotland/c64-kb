---
recipe: big-font-scroller
toolchain: kickassembler
output_format: PRG
region: both
techniques: [big_font_2x2, char_scroll_buffer_h, soft_scroll_h]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, DC04, DC05, DC0D, DC0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Big-Font 2x2 Scroller

## Synopsis

A message scrolls across two text rows in letters twice the normal size.
At start the program copies the upper-case ROM font out from under I/O and
expands each of its first 64 glyphs into four characters, one per 4x4
quadrant scaled by two, so a 2 KB charset at $3000 holds a 2x2 version of
every screen code from 0 to 63. Every frame a raster interrupt steps
$D016 XSCROLL down one pixel; every eighth frame it rotates both scroller
rows one cell left, appends the next half-letter and resets XSCROLL to 7.
The whole screen, the readout included, is drawn in the big font, so the
picture is its own proof that the charset was built correctly.

The program grades itself. CIA1 timer A times the rotate and append, the
raster is read straight after it, and after 200 frames `$02FF` is `$01`
with a green border if every carry finished while the raster was still on
lines 240 to 255 of the same frame, or `$02` with a red border if one did
not. Measured in VICE x64sc 3.10 on both models: the copy reads 708
cycles (a left-half carry; a right-half carry reads 715, and 43 of either
is the badline at line 243 that the copy crosses), it ends on line 253
(PAL) or 252 (NTSC), and the verdict is pass.

## Source

```asm
// big-font-scroller.asm
// A two-row scroller in 2x2 letters. At start the upper-case ROM font is
// copied out from under I/O and expanded into a 2 KB charset in which
// every source glyph 0-63 becomes four codes, one per 4x4 quadrant scaled
// by two. Screen code g draws as codes 4g, 4g+1 on the top row and 4g+2,
// 4g+3 on the row below. The whole screen, HUD included, uses that font.
//
// Every frame a raster IRQ at line 240 steps $D016 XSCROLL down one pixel.
// Every eighth frame it rotates both scroller rows one cell left, appends
// the next half-letter and resets XSCROLL to 7. CIA1 timer A times the
// rotate and append; the raster is read straight after it. Pass condition:
// on every carry the raster is still on lines 240-255 of the same frame
// ($D011 bit 7 clear, $D012 >= 240), a window of 16 lines that holds one
// badline (243). After FRAMES frames $02FF = $01 and the border is green
// if no carry missed the window, else $02FF = $02 and the border is red.
//
// Region: both. The window ends at line 255 so it does not wrap on NTSC
// (263 lines) and the test is one bit and one compare.

.const SCREEN     = $0400
.const COLOUR     = $d800
.const CHARSET    = $3000        // 2 KB in VIC bank 0: $D018 = $1C
.const ROM_FONT   = $d000        // upper-case set, first 2 KB of the char ROM
.const GLYPHS     = 64           // screen codes 0-63 -> big-font codes 0-255
.const ROW_A      = 11           // scroller top row
.const ROW_B      = 12
.const IRQ_LINE   = 240
.const FRAMES     = 200          // verdict after this many frames
.const RESULT     = $02ff        // verdict byte read by a harness
.const BIG_SPACE  = $80          // any quadrant of the space glyph is blank

.const zp_src  = $fb             // init: ROM font pointer; later: message pointer
.const zp_dst  = $fd             // init: charset pointer; later: HUD row pointer

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// CIA1 timer A as a stopwatch, phi2 clock, counting down from $FFFF.
// ---------------------------------------------------------------------------
.macro t_start() {
    lda #$00
    sta $dc0e
    lda #$ff
    sta $dc04
    sta $dc05
    lda #$11                     // force load, start, count phi2
    sta $dc0e
}
.macro t_stop(addr) {
    lda #$00
    sta $dc0e
    sec
    lda #$ff
    sbc $dc04
    sta addr
    lda #$ff
    sbc $dc05
    sta addr + 1
}

// Draw a screen-code string in big letters: top-left cell at (row, col).
.macro draw_big(str, len, row, col) {
    lda #<(SCREEN + row * 40 + col)
    sta zp_dst
    lda #>(SCREEN + row * 40 + col)
    sta zp_dst + 1
    ldx #0
!:  txa
    asl
    tay                          // cell offset = 2 * index
    lda str, x
    jsr put_big
    inx
    cpx #len
    bne !-
}

* = $0810
start:
    sei
    lda #$7f
    sta $dc0d                    // no CIA1 interrupts: timer A is the stopwatch
    lda $dc0d

    // Blank the screen with the space glyph's quadrant and colour the rows.
    lda #BIG_SPACE
    ldx #0
!:  sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $2e8, x
    inx
    bne !-
    ldx #39
!:  lda #7                       // title: yellow
    sta COLOUR + 1 * 40, x
    sta COLOUR + 2 * 40, x
    lda #1                       // scroller top row: white
    sta COLOUR + ROW_A * 40, x
    lda #3                       // scroller bottom row: cyan
    sta COLOUR + ROW_B * 40, x
    lda #15                      // HUD: light grey
    sta COLOUR + 5 * 40, x
    sta COLOUR + 6 * 40, x
    sta COLOUR + 14 * 40, x
    sta COLOUR + 15 * 40, x
    sta COLOUR + 17 * 40, x
    sta COLOUR + 18 * 40, x
    sta COLOUR + 20 * 40, x
    sta COLOUR + 21 * 40, x
    dex
    bpl !-

    t_start()
    jsr build_font
    t_stop(font_count)

    draw_big(t_title, 12, 1, 8)
    draw_big(t_font, 4, 5, 3)
    draw_big(t_cycles, 6, 5, 25)
    draw_big(t_copy, 4, 14, 3)
    draw_big(t_cycles, 6, 14, 25)
    draw_big(t_raster, 6, 17, 3)
    draw_big(t_frame, 5, 20, 3)

    // Stopwatch overhead: an empty start/stop pair.
    t_start()
    t_stop(null_count)
    sec
    lda font_count
    sbc null_count
    sta num
    lda font_count + 1
    sbc null_count + 1
    sta num + 1
    lda #<(SCREEN + 5 * 40 + 13)
    sta zp_dst
    lda #>(SCREEN + 5 * 40 + 13)
    sta zp_dst + 1
    jsr print_big5

    lda #<message
    sta zp_src
    lda #>message
    sta zp_src + 1

    lda #$1c                     // screen $0400, charset $3000
    sta $d018
    lda #$1b
    sta $d011
    lda $d016
    and #$f0                     // CSEL = 0 (38 columns), XSCROLL = 0
    ora #7
    sta $d016
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #IRQ_LINE
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// ---------------------------------------------------------------------------
// Expand the ROM font: glyph g, source row s (0-7), high nibble -> left
// quadrant, low nibble -> right quadrant; each nibble becomes two rows of a
// pixel-doubled byte. Quadrant order 0 TL, 1 TR, 2 BL, 3 BR, 8 bytes each.
// ---------------------------------------------------------------------------
build_font:
    lda $01
    and #$f8
    ora #$03                     // CHAREN = 0: char ROM at $D000, I/O out
    sta $01
    lda #<ROM_FONT
    sta zp_src
    lda #>ROM_FONT
    sta zp_src + 1
    lda #<CHARSET
    sta zp_dst
    lda #>CHARSET
    sta zp_dst + 1
    lda #GLYPHS
    sta glyph_left
glyph:
    ldy #0
row:
    sty srow
    lda (zp_src), y
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda dbl, x                   // high nibble doubled
    ldy srow
    ldx off_left, y
    stx srow_off
    ldy srow_off
    sta (zp_dst), y
    iny
    sta (zp_dst), y
    pla
    and #$0f
    tax
    tya
    clc
    adc #7                       // same rows in the right-hand quadrant
    tay
    lda dbl, x                   // low nibble doubled
    sta (zp_dst), y
    iny
    sta (zp_dst), y
    ldy srow
    iny
    cpy #8
    bne row
    lda zp_src
    clc
    adc #8
    sta zp_src
    bcc !+
    inc zp_src + 1
!:  lda zp_dst
    clc
    adc #32
    sta zp_dst
    bcc !+
    inc zp_dst + 1
!:  dec glyph_left
    bne glyph
    lda $01
    and #$f8
    ora #$07                     // I/O back
    sta $01
    rts

// ---------------------------------------------------------------------------
// Once per frame.
// ---------------------------------------------------------------------------
irq:
    inc frames
    bne !+
    inc frames + 1
!:  dec xscroll
    bpl set_x
    lda #7
    sta xscroll
    jsr carry
set_x:
    lda $d016
    and #$f8
    ora xscroll
    sta $d016

    lda frames + 1
    cmp #>FRAMES
    bne done
    lda frames
    cmp #<FRAMES
    bne done
    lda fails
    beq pass
    lda #$02
    sta RESULT
    lda #2                       // red
    sta $d020
    draw_big(t_fail, 4, 20, 27)
    jmp done
pass:
    lda #$01
    sta RESULT
    lda #5                       // green
    sta $d020
    draw_big(t_pass, 4, 20, 27)
done:
    lda #$01
    sta $d019
    jmp $ea31

// Every eighth frame: rotate both rows one cell left, append the next
// half-letter, read the raster, update the HUD.
carry:
    t_start()
    .for (var i = 0; i < 39; i++) {
        lda SCREEN + ROW_A * 40 + i + 1
        sta SCREEN + ROW_A * 40 + i
    }
    .for (var i = 0; i < 39; i++) {
        lda SCREEN + ROW_B * 40 + i + 1
        sta SCREEN + ROW_B * 40 + i
    }
    ldy #0
    lda (zp_src), y
    bpl !+                       // $FF ends the message: wrap
    lda #<message
    sta zp_src
    lda #>message
    sta zp_src + 1
    lda (zp_src), y
!:  asl
    asl
    ora half                     // 0: left half, 1: right half
    sta SCREEN + ROW_A * 40 + 39
    ora #2
    sta SCREEN + ROW_B * 40 + 39
    lda half
    eor #1
    sta half
    bne !+                       // right half done: next letter
    inc zp_src
    bne !+
    inc zp_src + 1
!:  t_stop(raw_count)

    lda $d011
    bmi miss                     // line 256 or later
    lda $d012
    sta line_seen
    cmp #IRQ_LINE
    bcs hud                      // 240-255: inside the window
miss:
    lda #1
    sta fails
hud:
    sec
    lda raw_count
    sbc null_count
    sta num
    lda raw_count + 1
    sbc null_count + 1
    sta num + 1
    lda #<(SCREEN + 14 * 40 + 13)
    sta zp_dst
    lda #>(SCREEN + 14 * 40 + 13)
    sta zp_dst + 1
    jsr print_big5
    lda line_seen
    sta num
    lda #0
    sta num + 1
    lda #<(SCREEN + 17 * 40 + 17)
    sta zp_dst
    lda #>(SCREEN + 17 * 40 + 17)
    sta zp_dst + 1
    jsr print_big5
    lda frames
    sta num
    lda frames + 1
    sta num + 1
    lda #<(SCREEN + 20 * 40 + 15)
    sta zp_dst
    lda #>(SCREEN + 20 * 40 + 15)
    sta zp_dst + 1
    jsr print_big5
    rts

// A = screen code 0-63, Y = cell offset of the left cell; zp_dst = top row.
put_big:
    asl
    asl
    sta big_tmp
    sta (zp_dst), y
    iny
    ora #1
    sta (zp_dst), y
    tya
    clc
    adc #39                      // the row below, left cell
    tay
    lda big_tmp
    ora #2
    sta (zp_dst), y
    iny
    ora #1
    sta (zp_dst), y
    rts

// num (16-bit) as five big digits from (zp_dst), leading zeros as spaces.
print_big5:
    lda #0
    sta col_off
    sta lead                     // no digit shown yet
    ldx #0
digit:
    lda #$30                     // screen code '0'
    sta dig
sub:
    lda num
    sec
    sbc pow_lo, x
    tay
    lda num + 1
    sbc pow_hi, x
    bcc emit
    sta num + 1
    sty num
    inc dig
    jmp sub
emit:
    lda dig
    cmp #$30
    bne show
    cpx #4
    beq show                     // the units digit is always shown
    lda lead
    bne show
    lda #$20                     // leading zero: a space
    bne put                      // always
show:
    lda #1
    sta lead
    lda dig
put:
    ldy col_off
    jsr put_big
    inc col_off
    inc col_off
    inx
    cpx #5
    bne digit
    rts

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
dbl:        .fill 16, ((i >> 3) & 1) * $c0 + ((i >> 2) & 1) * $30 + ((i >> 1) & 1) * $0c + (i & 1) * $03
off_left:   .byte 0, 2, 4, 6, 16, 18, 20, 22
pow_lo:     .byte <10000, <1000, <100, <10, <1
pow_hi:     .byte >10000, >1000, >100, >10, >1

.encoding "screencode_upper"
t_title:    .text "2X2 BIG FONT"
t_copy:     .text "COPY"
t_font:     .text "FONT"
t_cycles:   .text "CYCLES"
t_raster:   .text "RASTER"
t_frame:    .text "FRAME"
t_pass:     .text "PASS"
t_fail:     .text "FAIL"
message:    .text "HELLO FROM A 2X2 SCROLLER ... EVERY LETTER IS FOUR CELLS OF ONE CHARSET ... "
            .byte $ff

xscroll:    .byte 7
half:       .byte 0
frames:     .word 0
fails:      .byte 0
raw_count:  .word 0
null_count: .word 0
font_count: .word 0
line_seen:  .byte 0
num:        .word 0
dig:        .byte 0
col_off:    .byte 0
lead:       .byte 0
big_tmp:    .byte 0
srow:       .byte 0
srow_off:   .byte 0
glyph_left: .byte 0
```

## Build

```bash
java -jar KickAss.jar big-font-scroller.asm -o big-font-scroller.prg
```

`-showmem` reports one segment, $0810 to $0E5A: 1,611 bytes of code, tables
and text. The 2 KB charset at $3000 is built at run time and is not in the
PRG.

## Expected output

A blue screen whose every character is 16 pixels square. Rows 1 and 2 hold
the title `2X2 BIG FONT` in yellow. Rows 11 and 12 are the scroller, top
row white and bottom row cyan: `HELLO FROM A 2X2 SCROLLER ...` enters from
under the right border one pixel a frame and leaves under the left one.
Rows 5 and 6, 14 and 15, 17 and 18, and 20 and 21 are the readout in light
grey:

| Rows | Text | PAL | NTSC |
|---|---|---|---|
| 5-6 | `FONT n CYCLES` | 57757 | 58061 |
| 14-15 | `COPY n CYCLES` | 708 | 708 |
| 17-18 | `RASTER n` | 253 | 252 |
| 20-21 | `FRAME n PASS` | 248 | 280 |

`FONT` is the charset build, measured once at start with the display on,
so it includes the badlines it ran across; `COPY` is the last carry's
rotate and append, net of the stopwatch overhead the program measures for
itself at start (5 cycles, read from memory with a `-moncommands` dump).
Both pinned frames caught a left-half carry, which reads 708; a
right-half carry, which also advances the message pointer, reads 715 (PAL,
one carry later at `-limitcycles 8157248`). Both figures include the
43-cycle badline at line 243; with the interrupt moved to line 251 the
same carries read 665 and 672. `RASTER` is `$D012` read straight after
that copy;
`FRAME` is the frame the last carry ran in. The verdict word appears at
frame 200: `PASS` with the border green, `FAIL` with it red. At the pinned
8,000,000 cycles the border is green on both models, `$02FF` holds `$01`
(a `-moncommands` store trace shows the KERNAL's page-2 clear writing `00`
at cycle 5,305 and the program's `STA $02FF` writing `01` at cycle
6,977,550 on PAL), and the frame the picture caught had XSCROLL at 4.

Screenshots from the pinned runs: `screenshots/big-font-scroller.png`
(PAL) and `screenshots/big-font-scroller-ntsc.png` (NTSC). Two runs of
each pinned command produced byte-identical files.

## Why this works

### One glyph, four codes

The character generator reads eight bytes per screen code at charset base
plus code times 8. A glyph scaled by two is 16 rows of 16 pixels, which is
four ordinary cells: the top-left cell shows source rows 0 to 3, high
nibble, each row twice and each pixel twice. `build_font` walks the 64
source glyphs and for each source row `s` writes the high nibble's
doubled byte to rows `2(s&3)` and `2(s&3)+1` of quadrant `s/4 * 2` and
the low nibble's to the quadrant beside it (`off_left` is that offset
table, `dbl` the 16-entry nibble-to-byte table). Code `4g` is therefore
the top-left of glyph `g`, `4g+1` top-right, `4g+2` bottom-left and
`4g+3` bottom-right, which is why `put_big` shifts a screen code left
twice and ORs 1, 2 and 3. Sixty-four glyphs fill all 256 codes; the
screen is blanked with `$80`, the space glyph's top-left, because there is
no plain space in this charset.

The ROM font is only visible to the CPU with CHAREN clear: `$01` is
read-modify-written to `$33` under SEI, the copy runs, and it goes back to
`$37` before any interrupt is enabled (`pitfalls/banking.md`,
`charset_under_io_invisible_to_cpu`). `$D018 = $1C` points the VIC at
$0400 for the screen and $3000 for the charset inside bank 0. The build
took 57,757 cycles on PAL with the display on, about three frames.

### The scroller

Each carry moves 78 bytes: columns 1 to 39 of each of the two rows go to
columns 0 to 38, fully unrolled as 78 `lda abs` / `sta abs` pairs, then
column 39 of both rows takes the next half of the next letter (`half`
alternates 0 and 1; the message pointer advances after the right half).
This is `char_scroll_buffer_h` applied to two rows at once, with the
screen itself as the buffer. `$D016` is read, masked to bits 3 to 7 and
ORed with XSCROLL, so CSEL stays at 0 (38 columns hide the ragged edge;
`d016_unmasked_rmw_clobbers_csel_mcm`). The rows that are not the
scroller shift too (`xscroll_applies_to_all_rows`); here they are static
text and the readout, and the 7-pixel snap every eighth frame that
pitfall describes applies to them (not measured here). A second interrupt that sets XSCROLL for the scroller rows only
is the fix on that pitfall's page and was left out to keep this page to
one interrupt.

### The verdict

The interrupt is at line 240, inside the display but below any row that
holds anything after row 21. The rows the copy writes were fetched at
lines 139 and 147 and are next fetched at those lines of the following
frame, so the
real budget is wide; the test uses a tighter and simpler one: after the
copy, `$D011` bit 7 is clear and `$D012` is at least 240, that is the
raster is still on lines 240 to 255 of this frame. Sixteen lines from 240
end at 255 on both models, so no line in the window needs the ninth bit
and the test is one branch and one compare; from line 250 the same window
would wrap past line 262 on NTSC (`d012_wrap_around`). The window holds
one badline, 243, which costs 43 cycles of it (`badline_cycle_loss`); the
copy is running when it comes, so the stall is inside the `COPY` figure.

Measured in VICE x64sc: the raster reads 253 on PAL and 252 on NTSC after
the copy, two and three lines inside the window. That is the KERNAL's
36-cycle entry, the frame counter and XSCROLL step, the stopwatch start
and the copy, 708 cycles on the pinned frame and 715 on the alternate
carry, badline included. There is not room to add work to the
carry and keep this window; moving `IRQ_LINE` up widens it, and any line
from 155 to 238 keeps the copy clear of the scroller rows' fetch.

### Region

`region: both`. The mechanism is the same on NTSC; the message moves 20 %
faster, the font build took 58,061 cycles (304 more, from the different
badline count in three NTSC frames; not analysed further), and the copy
ends one line earlier because an NTSC line is 65 cycles.
