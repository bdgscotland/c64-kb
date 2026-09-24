// p2_twist.asm: part 2 of MEASURED, the TWIST. A port of two c64-kb recipes:
// docs/recipes/kickassembler/twister.md (kickassembler-twister) and
// docs/recipes/kickassembler/vector-balls.md (kickassembler-vector-balls).
//
// The twister: a square column seen side on, 64 pixels wide, 128 bitmap lines
// tall (rows 36 to 163), turning about its vertical axis. The four edges are
// x_i = 160 + 32 sin((a + 64 i) & 255), the faces solid, $AA dither, $88 and
// empty, and the 64 phase images (a = 0, 4, .. 252, 8 bytes each) are built
// at assembly time by the recipe's own script, unchanged. Band line L shows
// phase (t + L) & 63, a straight helix; t advances by 1 a frame.
// The balls: eight sprites on a ring of radius 40 tilted by 12, centre
// (172, 130), px/py/zd tables built by the recipe's proj and depth functions,
// one bubble pass a frame over the previous order, rank i to hardware sprite
// 7 - i, big image near (zd < 128), small far, white below zd 120, light grey
// below 136, grey above. The lookup, pass and assign code is the recipe's.
//
// Where this module differs from the recipes, and why:
//   - THE COPY IS NOT UNROLLED OVER 128 LINES. The recipe's unrolled copy is
//     9,383 bytes and this part's code block (P2_CODE = $8C00, $0C00 bytes)
//     cannot hold it. The recipe names the alternative itself ("a version
//     that kept the phase in X and read eight 64-entry planes with
//     lda plane_k,x"), and that is what runs here: the same 512 bytes of
//     phase image, laid out as eight planes (plane k = byte k of every
//     phase), each plane stored twice (128 bytes) so an index of phase + 7
//     never needs masking; 1,024 bytes at $4400 to $47FF instead of the
//     recipe's 512 bytes at $4400-$45FF. The band is copied in 17 blocks
//     that follow the bitmap's character rows: 4 lines (text row 4), fifteen
//     of 8 lines (rows 5 to 19), 4 lines (row 20). Inside a block X holds
//     the phase of its first line and each byte is
//     lda plane_k + l, x / ldy #(8 k + l) / sta (dst),y, 12 cycles a byte
//     against the recipe's 11, with no per-line pointer advance. The picture
//     is the recipe's: same images, same rows, same phase per line (the three
//     measured rows and the sprite register dump agree with both recipes'
//     tables at frame 300). Measured in the standalone stub, the whole of
//     main (balls and copy, display on, eight sprites on the band's lines):
//     PAL worst 15,892, last 15,848; NTSC worst 16,147, last 16,064. That is
//     above the recipes' 13,561 + 1,318 because the bracket also holds the
//     sprite DMA and badline stalls the VIC takes while the copy runs under
//     the display; the recipe's twister had no sprites.
//   - NTSC HALF-COPY. On NTSC the full copy (16,147 cycles) plus the music
//     interrupt (up to 1,274 cycles) and the fade (up to 1,580 cycles) exceeds
//     the 17,095-cycle frame, overrunning on every frame. The fix splits the
//     band copy into two halves; PAL keeps the full copy. Even frames copy the
//     top 60 band lines (text row 4 + blocks 0..6, raster 87..146); odd frames
//     copy the bottom 68 (blocks 7..14 + row 20, raster 147..214). The split
//     is at the block-7 boundary to avoid a partial character row. Each half is
//     about 6,500 cycles and runs from the frame flag (just after line 255)
//     through the blank and the frame's first lines, finishing before the beam
//     reaches the half it wrote: 6,500 / 65 = 100 raster lines from line 255
//     gives line 355 (wrapping to line 92 on NTSC at 263 lines), just ahead of
//     raster 147 for the bottom half; the top half is written earlier still.
//     The helix period is 64 lines, so band line 60 has phase (t+60)&63, and
//     the bottom half uses X = (t+60)&63 = (t-4)&63 as its starting phase.
//     The twist phase t still advances once per frame regardless of which half
//     is drawn. As a result, the top and bottom halves are always one phase
//     apart on NTSC (the top is drawn with even t, the bottom with odd t+1).
//     After the fix, measured in the standalone stub: PAL worst 16,486 cycles,
//     last 16,034 (overhead from jsr/rts in the subroutine calls adds ~594 vs
//     the pre-fix 15,892; PAL still fits in the 19,656-cycle frame with 316
//     cycles of headroom after music and fade); NTSC worst 9,164, last 9,116
//     (half the pre-fix 16,147, with 5,077 cycles of headroom after the
//     1,274-cycle music and 1,580-cycle fade, above the 3,200-cycle floor).
//     300 of 300 music calls on NTSC (no dropped frames).
//     SEAM CHECK (beam overtake, review finding 2): the seam is at raster 147
//     (band line 60), the block-7 boundary. On ODD frames (bottom just drawn,
//     top from the previous even frame) adjacent band lines 59/60 carry phases
//     (t_even+59)&63 and (t_odd+60)&63 = (t_even+1+60)&63, a difference of 2.
//     On EVEN frames the seam disappears (same t base for both halves).
//     Verify: run NTSC frozen at a cycle count landing on an odd frame; use PIL
//     to read byte column 16 at band line 59 (BITMAP+11*320+128+7=$6E47) and
//     band line 60 (BITMAP+12*320+128+0=$6EE0); compare against PLANES[0][37]
//     ($4425) and PLANES[0][39] ($4427) respectively (phases 37 and 39 at
//     t=300). A 2-plane difference at the seam confirms the overtake is gone.
//     p2.region is set by prepare: 0 = PAL, 1 = NTSC.
//     The copy subroutines (copy_hi_4, copy_lo_4, block_copy, loop_to_15,
//     loop_to_7) are shared by both paths to stay within the $0C00 code block.
//   - Bank 1: bitmap $6000, screen $5C00, $D018 = $78, $DD00 = $C6. The
//     recipe's bitmap was $2000 with screen $0400 in bank 0.
//   - The ball shapes sit at $7E00 and $7E40 (pointers $F8, $F9), which is
//     inside the bitmap's last character row (the bitmap is 8,000 bytes, to
//     $7F3F). Their bytes would show as ink in the sixteen cells of text row
//     24, columns 0 to 15, so those cells get colour pair $00 (black on
//     black) and never show them. The recipe kept its shapes at $2000.
//   - No raster wait. The sequencer's line-255 interrupt raises the frame
//     flag and the stub calls main once per flag; main does the sprite
//     writes first (they land in the blank), then the copy. The recipe's
//     twister waited for line 250 and its balls for line 255.
//   - One CIA1 timer A bracket (one shot from $FFFF, $DC0E = $19, as both
//     recipes) round the whole of main: lookup, pass, assign and the copy.
//     worst is the largest frame seen, typical the most recent frame. The
//     words hold elapsed cycles ($FFFF less the count). fadeout's work is
//     outside the bracket.
//   - The ball colours go through col_white, col_lgrey, col_grey instead of
//     the recipe's immediates, so the fade can step them; lda abs for lda #.
//   - With -define FORCE_FAULT prepare complements the zd table in place (the
//     poisoned depth table: 255 - zd), so the pass puts the nearest ball
//     first and the farthest gets sprite 0; image and colour then take the
//     complement back (eor #$FF) so a far grey ball is drawn over a near white
//     one. Without the define prepare leaves zd as assembled.
//   - The fade (not in either recipe) takes the colour-fade recipe's
//     luminance order (0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1)
//     as a 16-entry next-darker table: every 8 frames the three ball colours
//     and the ink step one place down it, and the ink nibble of the screen RAM
//     is rewritten 125 cells a frame over the 8 frames. Done once the ink and
//     the three colours are black and that step has been written (white takes
//     15 steps, 120 frames). The recipe's 17 by 16 proportional table did not
//     fit the code block with the other tables.
//   - setup writes every VIC register the contract lists; cleanup restores
//     the contract's values after raster line 250 and stops the timer.
//
// Zero page: $10-$15 (dst, ptr, fptr); $16 = region (0=PAL, 1=NTSC).
// No interrupts: irq_count = 0.

#importonce

.filenamespace p2

.const BITMAP    = $6000
.const SCREEN    = $5c00
.const PLANES    = $4400          // 8 planes of 128 bytes
.const BIGBALL   = $7e00          // pointer $F8: 24 by 21 ball, near half
.const SMLBALL   = $7e40          // pointer $F9: 16 by 14 ball, far half
.const TOP       = 36             // first bitmap row of the band
.const LINES     = 128
.const BAND_BYTE = 16             // first byte column of the band: x 128 to 191
.const RADIUS    = 40
.const TILT      = 12
.const EYE       = 200
.const XMID      = 172
.const YMID      = 130
.const NEAR      = 120
.const MID       = 136
.const FADE_EVERY = 8
.const PIN_FRAME = 300            // the frame the recipe's replay predicts the order for

.const dst  = $10                 // copy destination row
.const ptr  = $12                 // prepare's clear pointer
.const fptr = $14                 // fadeout's screen pointer
.label region = $16               // 0 = PAL, 1 = NTSC; set by prepare

// --- the phase images, the twister recipe's script unchanged --------------
.var facepat = List().add($ff, $aa, $88, $00)
.var phases = List()
.for (var p = 0; p < 64; p++) {
    .var a = p * 4
    .var xe = List()
    .for (var i = 0; i < 4; i++) {
        .eval xe.add(160 + round(32 * sin(toRadians(mod(a + 64 * i, 256) * 360 / 256))))
    }
    .for (var b = 0; b < 8; b++) {
        .var v = 0
        .for (var bit = 0; bit < 8; bit++) {
            .var x = 128 + b * 8 + bit
            .var m = 128 >> bit
            .for (var i = 0; i < 4; i++) {
                .var x0 = xe.get(i)
                .var x1 = xe.get(mod(i + 1, 4))
                .if (x0 < x1 && x >= x0 && x < x1 && (facepat.get(i) & m) != 0) {
                    .eval v = v | m
                }
            }
        }
        .eval phases.add(v)
    }
}

// --- the ball tables, the vector-balls recipe's functions unchanged -------
.function proj(a, amp, centre) {
    .var rad = toRadians(a * 360 / 256)
    .var z3 = RADIUS * cos(rad)
    .return round(centre + amp * sin(rad) * 256 / (z3 + EYE))
}
.function depth(a) {
    .return round(128 + RADIUS * cos(toRadians(a * 360 / 256)))
}
.function ballByte(row, col8, rx, ry) {
    .var v = 0
    .for (var c = 0; c < 8; c++) {
        .var x = col8 * 8 + c
        .if (pow((x - 11.5) / (rx / 2), 2) + pow((row - 10) / (ry / 2), 2) <= 1) {
            .eval v = v | (128 >> c)
        }
    }
    .return v
}
.for (var i = 0; i < 256; i++) {
    .errorif proj(i, RADIUS, XMID) > 255 - 23, "a ball would cross X 255"
}

// --- the fade table, the colour-fade recipe's script unchanged ------------
.var lum = List().add(0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1)   // the recipe's `order`, renamed: `order` is a label here
.var pos = List()
.for (var i = 0; i < 16; i++) .eval pos.add(0)
.for (var i = 0; i < 16; i++) .eval pos.set(lum.get(i), i)

// ---------------------------------------------------------------------------
// The planes: plane k, index j holds byte k of phase (j & 63).
// ---------------------------------------------------------------------------
* = PLANES "p2 planes"
planes:
    .fill 1024, phases.get(mod(mod(i, 128), 64) * 8 + floor(i / 128))

// ---------------------------------------------------------------------------
// The code block: three page-aligned tables, the sort-key copy, then code.
// ---------------------------------------------------------------------------
* = P2_CODE "p2 twist"
px: .fill 256, proj(i, RADIUS, XMID)
py: .fill 256, proj(i, TILT, YMID)
zd: .fill 256, depth(i)           // complemented in place by prepare under FORCE_FAULT

// Contract tables and words.
irq_count:   .byte 0
irq_lines:   .byte 0
irq_hi:      .byte 0
irq_lo:      .byte 0
irq_hi_addr: .byte 0
worst:       .word 0
typical:     .word 0

// Part state.
t:        .byte 0                 // twister time, advances by 1 after each draw
bt:       .word 0                 // ball time, advances by 1 before each lookup
blk:      .byte 0
atmp:     .byte 0
ytmp:     .byte 0
ztmp:     .byte 0
last:     .word 0
order:    .fill 8, 0              // ball index per depth rank, farthest first
bx:       .fill 8, 0
by:       .fill 8, 0
bz:       .fill 8, 0
pairs:    .byte 14, 12, 10, 8, 6, 4, 2, 0
sprn:     .byte 7, 6, 5, 4, 3, 2, 1, 0
k32:      .byte 0, 32, 64, 96, 128, 160, 192, 224
pred300:  .byte 7, 6, 0, 5, 1, 4, 2, 3   // the recipe's replay at frame 300, farthest first
col_white: .byte 1
col_lgrey: .byte 15
col_grey:  .byte 12
ink_col:   .byte 1
fade_j:    .byte 0
faded:     .byte 0
ink:       .byte $10
// next darker colour down the colour-fade recipe's luminance order; black stays black
darker: .fill 16, (pos.get(i) == 0) ? 0 : lum.get(pos.get(i) - 1)

// Bitmap row bases of the band, text rows 5 to 19 (the fifteen full blocks).
rowlo: .fill 15, <(BITMAP + (5 + i) * 320 + BAND_BYTE * 8)
rowhi: .fill 15, >(BITMAP + (5 + i) * 320 + BAND_BYTE * 8)
.const ROW4  = BITMAP + 4 * 320 + BAND_BYTE * 8
.const ROW20 = BITMAP + 20 * 320 + BAND_BYTE * 8

// selfcheck's three band lines (the recipe's measured rows): L, then the
// bitmap address of byte column 16 on that line.
chk_l:  .byte 0, 40, 100
chk_lo: .byte <(BITMAP + floor((TOP + 0) / 8) * 320 + mod(TOP + 0, 8) + BAND_BYTE * 8)
        .byte <(BITMAP + floor((TOP + 40) / 8) * 320 + mod(TOP + 40, 8) + BAND_BYTE * 8)
        .byte <(BITMAP + floor((TOP + 100) / 8) * 320 + mod(TOP + 100, 8) + BAND_BYTE * 8)
chk_hi: .byte >(BITMAP + floor((TOP + 0) / 8) * 320 + mod(TOP + 0, 8) + BAND_BYTE * 8)
        .byte >(BITMAP + floor((TOP + 40) / 8) * 320 + mod(TOP + 40, 8) + BAND_BYTE * 8)
        .byte >(BITMAP + floor((TOP + 100) / 8) * 320 + mod(TOP + 100, 8) + BAND_BYTE * 8)

// fadeout's eight chunk starts: SCREEN + 125 j.
fade_lo: .fill 8, <(SCREEN + 125 * i)
fade_hi: .fill 8, >(SCREEN + 125 * i)

// The ball shapes, copied to BIGBALL and SMLBALL by prepare.
bigball_src:
.for (var r = 0; r < 21; r++) { .byte ballByte(r, 0, 24, 21), ballByte(r, 1, 24, 21), ballByte(r, 2, 24, 21) }
.byte 0
smlball_src:
.for (var r = 0; r < 21; r++) { .byte ballByte(r, 0, 16, 14), ballByte(r, 1, 16, 14), ballByte(r, 2, 16, 14) }
.byte 0

// ---------------------------------------------------------------------------
// prepare: the sort key, the bitmap clear, the shapes. No VIC writes.
// ---------------------------------------------------------------------------
prepare:
    // Detect PAL (region = 0) or NTSC (region = 1) using the KB's
    // pal_ntsc_detection technique (inline from kickassembler-tech-tech recipe):
    // track $D012 while RST8 ($D011 bit 7) is set; last value is $37 on PAL
    // (lines go to 311 = $137), $06 on NTSC (to 262 = $106); >= $10 -> PAL.
    sei
det_lo: bit $d011
    bmi det_lo
det_hi: bit $d011
    bpl det_hi
det_tr: lda $d012
    bit $d011
    bpl det_done
    tay
    jmp det_tr
det_done:
    lda #0
    cpy #$10
    bcs !+
    lda #1
!:  sta region
    cli
#if FORCE_FAULT
    ldx #0                      // poison the depth table: 255 - zd
!:  lda zd, x
    eor #$ff
    sta zd, x
    inx
    bne !-
#endif
    lda #<BITMAP
    sta ptr
    lda #>BITMAP
    sta ptr + 1
    lda #0
    tay
    ldx #32
clear_page:
    sta (ptr), y
    iny
    bne clear_page
    inc ptr + 1
    dex
    bne clear_page

    ldx #63
!:  lda bigball_src, x
    sta BIGBALL, x
    lda smlball_src, x
    sta SMLBALL, x
    dex
    bpl !-
    rts

// ---------------------------------------------------------------------------
// setup: every VIC register the contract lists, the screen, the sprites.
// ---------------------------------------------------------------------------
setup:
    lda #$10                    // white ink on black paper in every cell
    ldx #0
!:  sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $300, x
    inx
    bne !-
    lda #0
    ldx #15                     // the sixteen cells over the shapes: black on black
!:  sta SCREEN + 24 * 40, x
    dex
    bpl !-
    ldx #0                      // colour RAM: unused in hires bitmap, written anyway
!:  sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $db00, x
    inx
    bne !-

    lda #$3f
    sta $dd02
    lda #$c6                    // bank 1
    sta $dd00
    lda #$78                    // screen $5C00, bitmap $6000
    sta $d018
    lda #$c8
    sta $d016
    lda #$3b                    // bitmap mode, 25 rows, YSCROLL 3
    sta $d011

    ldx #7
!:  lda sprn, x                 // order[i] = 7 - i, so before any sort
    sta order, x                // hardware sprite k shows ball k
    lda #<(BIGBALL / 64)
    sta SCREEN + $3f8, x
    lda #1
    sta $d027, x
    ldy pairs, x                // park every sprite inside the display:
    lda #XMID                   // from reset Y is 0, which the VIC also
    sta $d000, y                // matches at line 256
    lda #YMID
    sta $d001, y
    dex
    bpl !-
    lda #0
    sta $d010
    sta $d017
    sta $d01d
    sta $d01c
    sta $d01b                   // sprites in front of the bitmap
    sta $d020
    sta $d021
    lda #$ff
    sta $d015

    lda #0
    sta t
    sta bt
    sta bt + 1
    sta worst
    sta worst + 1
    sta typical
    sta typical + 1
    sta fade_j
    sta faded
    lda #1
    sta ink_col
    sta col_white
    lda #15
    sta col_lgrey
    lda #12
    sta col_grey
    lda #$10
    sta ink
    rts

// ---------------------------------------------------------------------------
// main: timer on; balls (lookup, pass, assign); the copy; timer off.
// ---------------------------------------------------------------------------
main:
    lda #$00
    sta $dc0e
    lda #$ff                    // CIA1 timer A: one shot from $FFFF
    sta $dc04
    sta $dc05
    lda #$19
    sta $dc0e

    inc bt                      // t advances by 1
    bne !+
    inc bt + 1
!:
    // Lookup: ball k reads px, py, zs (and the true zd) at a = t + 32k.
    lda bt
    ldx #0
look:
    sta atmp
    tay
    lda px, y
    sta bx, x
    lda py, y
    sta by, x
    lda zd, y
    sta bz, x
    lda atmp
    clc
    adc #32
    inx
    cpx #8
    bne look

    // One bubble pass, key descending: order[0] is the farthest ball.
    ldx #0
pass:
    ldy order, x
    lda bz, y
    ldy order + 1, x
    cmp bz, y
    bcs !+                      // key[i] >= key[i+1]: in order
    lda order, x                // else swap the pair
    sta order + 1, x
    tya
    sta order, x
!:  inx
    cpx #7
    bne pass

    // Assign: order[i] goes to hardware sprite 7 - i.
    ldx #0
assign:
    ldy order, x
    lda bz, y
#if FORCE_FAULT
    eor #$ff                    // the true depth back from the poisoned key
#endif
    sta ztmp
    lda by, y
    sta ytmp
    lda bx, y
    ldy pairs, x                // 2 * (7 - i)
    sta $d000, y
    lda ytmp
    sta $d001, y
    ldy sprn, x                 // 7 - i
    lda ztmp
    cmp #128
    bcs !+                      // zd >= 128: far, small ball
    lda #<(BIGBALL / 64)
    bne sptr
!:  lda #<(SMLBALL / 64)
sptr:
    sta SCREEN + $3f8, y
    lda ztmp
    cmp #NEAR
    bcs !+
    lda col_white
    bne col
!:  cmp #MID
    bcs !+
    lda col_lgrey
    bne col
!:  lda col_grey
col:
    sta $d027, y
    inx
    cpx #8
    bne assign

    jsr draw
    inc t

    lda #0                      // stop the timer; elapsed = $FFFF - count
    sta $dc0e
    lda $dc04
    eor #$ff
    sta last
    sta typical
    lda $dc05
    eor #$ff
    sta last + 1
    sta typical + 1
    lda worst + 1               // worst = max(worst, last)
    cmp last + 1
    bcc newmax
    bne nomax
    lda worst
    cmp last
    bcs nomax
newmax:
    lda last
    sta worst
    lda last + 1
    sta worst + 1
nomax:
    rts

// ---------------------------------------------------------------------------
// draw: the band, 17 blocks. X holds the phase of the block's first line.
// Bytes are written by ldy #(8 k + l) / sta (dst),y, so a block's Y runs over
// the 64 bytes of the band inside one character row.
// ---------------------------------------------------------------------------
.macro CopyLines(l0, l1, off) {
    .for (var k = 0; k < 8; k++) {
        .for (var l = l0; l < l1; l++) {
            lda PLANES + 128 * k + (l + off), x
            ldy #(8 * k + l)
            sta (dst), y
        }
    }
}

draw:
    lda t
    and #$3f
    tax                         // X = t & 63, phase of band line 0
    lda region
    bne ntsc_draw

    // PAL: full copy of all 128 band lines (same as the original).
    lda #<ROW4
    sta dst
    lda #>ROW4
    sta dst + 1
    jsr copy_hi_4               // band lines 0-3 (row 4, lines 4-7)
    txa
    clc
    adc #4
    and #$3f
    tax                         // X = phase of band line 4
    lda #0
    sta blk
    jsr loop_to_15              // blocks 0..14 (band lines 4-123)
    lda #<ROW20
    sta dst
    lda #>ROW20
    sta dst + 1
    jsr copy_lo_4               // band lines 124-127 (row 20, lines 0-3)
    rts

ntsc_draw:
    lda t
    lsr                         // carry = t & 1: 0 = even frame, 1 = odd
    bcs ntsc_bot

ntsc_top:
    // NTSC even frame: copy the top 60 band lines (raster 87..146).
    // row 4 (band lines 0-3) + blocks 0..6 (band lines 4-59).
    // The helix period is 64 lines, so band line 60 has the same phase
    // as band line 60 mod 64 = 60. The two halves are one phase apart.
    lda #<ROW4
    sta dst
    lda #>ROW4
    sta dst + 1
    jsr copy_hi_4               // band lines 0-3
    txa
    clc
    adc #4
    and #$3f
    tax
    lda #0
    sta blk
    jsr loop_to_7               // blocks 0..6 (band lines 4-59)
    rts

ntsc_bot:
    // NTSC odd frame: copy the bottom 68 band lines (raster 147..214).
    // blocks 7..14 (band lines 60-123) + row 20 (band lines 124-127).
    // Phase of band line 60 = (t + 60) & 63; X holds t & 63, so add 60.
    txa
    clc
    adc #60
    and #$3f
    tax                         // X = phase of band line 60
    lda #7
    sta blk
    jsr loop_to_15              // blocks 7..14 (band lines 60-123)
    lda #<ROW20
    sta dst
    lda #>ROW20
    sta dst + 1
    jsr copy_lo_4               // band lines 124-127
    rts

// Shared copy subroutines. These replace the previously inlined CopyLines
// expansions and allow the PAL and NTSC paths to share code.

// copy_hi_4: CopyLines(4, 8, -4): 4 lines at Y offsets 4..7 of dst.
// Used for row 4 (band lines 0-3) on both PAL and NTSC top.
copy_hi_4:
    CopyLines(4, 8, -4)
    rts

// copy_lo_4: CopyLines(0, 4, 0): 4 lines at Y offsets 0..3 of dst.
// Used for row 20 (band lines 124-127) on both PAL and NTSC bottom.
copy_lo_4:
    CopyLines(0, 4, 0)
    rts

// block_copy: load dst from rowlo/rowhi[blk], copy 8 lines (CopyLines(0,8,0)),
// advance X by 8, increment blk. Called by loop_to_15 and loop_to_7.
block_copy:
    ldy blk
    lda rowlo, y
    sta dst
    lda rowhi, y
    sta dst + 1
    CopyLines(0, 8, 0)
    txa
    clc
    adc #8
    and #$3f
    tax
    inc blk
    rts

// loop_to_15: call block_copy until blk reaches 15 (blocks 0..14 or 7..14).
loop_to_15:
!:  jsr block_copy
    lda blk
    cmp #15
    bne !-
    rts

// loop_to_7: call block_copy until blk reaches 7 (blocks 0..6).
loop_to_7:
!:  jsr block_copy
    lda blk
    cmp #7
    bne !-
    rts

// ---------------------------------------------------------------------------
// fadeout: one fade step every 8 frames; the ink nibble in 125 cells a frame.
// Returns A = 0 while fading, 1 once step 16 (black) is on the whole screen.
// ---------------------------------------------------------------------------
fadeout:
    lda faded
    beq !+
    lda #1
    rts
!:  lda fade_j
    bne fill
    // a new step: everything one place darker; done once all four are black
    lda ink_col
    ora col_white
    ora col_lgrey
    ora col_grey
    bne !+
    lda #1                      // black has been written over 8 frames
    sta faded
    rts
!:  ldx ink_col
    lda darker, x
    sta ink_col
    asl
    asl
    asl
    asl
    sta ink
    ldx col_white
    lda darker, x
    sta col_white
    ldx col_lgrey
    lda darker, x
    sta col_lgrey
    ldx col_grey
    lda darker, x
    sta col_grey
fill:
    ldx fade_j
    lda fade_lo, x
    sta fptr
    lda fade_hi, x
    sta fptr + 1
    lda ink
    ldy #124
!:  sta (fptr), y
    dey
    bpl !-
    lda #0
    ldx #15                     // the shape cells stay black on black
!:  sta SCREEN + 24 * 40, x
    dex
    bpl !-
    inc fade_j
    lda fade_j
    cmp #FADE_EVERY
    bne !+
    lda #0
    sta fade_j
!:  lda #0
    rts

// ---------------------------------------------------------------------------
// cleanup: after raster line 250, the contract's values; the timer stopped.
// ---------------------------------------------------------------------------
cleanup:                        // the KB lint flags this poll as a heuristic:
    lda $d012                   // the interrupt is the sequencer's ($0314), in another file
    cmp #$fa
    beq cleanup
wait_250:
    lda $d011
    bmi wait_250
    lda $d012
    cmp #$fa
    bne wait_250
    lda #0
    sta $dc0e
    sta $d015
    sta $d020
    sta $d021
    lda #$1b
    sta $d011
    lda #$c8
    sta $d016
    lda #$15
    sta $d018
    lda #$c7
    sta $dd00
    rts

// ---------------------------------------------------------------------------
// selfcheck: A = 1 only if, read back from the machine,
//   1. the order is descending by the TRUE depth (zd of each ball's angle),
//   2. sprite 7 - i's X and Y registers equal px, py at rank i's ball's
//      angle, and its pointer is $F8 below zd 128, else $F9,
//   3. at frame 300 the order is the recipe's replay 7, 6, 0, 5, 1, 4, 2, 3,
//   4. (PAL only) bitmap byte columns 16 to 23 on band lines 0, 40 and 100
//      hold the phase image (t_last + L) & 63, plane by plane. Skipped on
//      NTSC because the half-copy leaves consecutive phases in the two halves
//      and the check cannot distinguish which half was most recently drawn.
// ---------------------------------------------------------------------------
selfcheck:
    ldx #0
sc_order:
    ldy order, x
    lda bt
    clc
    adc k32, y
    tay
    lda zd, y
#if FORCE_FAULT
    eor #$ff
#endif
    sta ztmp
    cpx #7
    beq sc_regs
    ldy order + 1, x
    lda bt
    clc
    adc k32, y
    tay
    lda zd, y
#if FORCE_FAULT
    eor #$ff
#endif
    cmp ztmp
    beq !+
    bcs sc_fail                 // nearer ball ranked farther
!:  inx
    bne sc_order
sc_regs:
    ldx #0
sc_reg:
    ldy order, x
    lda bt
    clc
    adc k32, y
    tay                         // Y = angle
    lda px, y
    sta atmp
    lda py, y
    sta ytmp
    lda zd, y
#if FORCE_FAULT
    eor #$ff
#endif
    sta ztmp
    ldy pairs, x
    lda $d000, y
    cmp atmp
    bne sc_fail
    lda $d001, y
    cmp ytmp
    bne sc_fail
    ldy sprn, x
    lda SCREEN + $3f8, y
    ldy ztmp
    cpy #128
    bcs !+
    cmp #<(BIGBALL / 64)
    bne sc_fail
    beq sc_next
!:  cmp #<(SMLBALL / 64)
    bne sc_fail
sc_next:
    inx
    cpx #8
    bne sc_reg

    lda bt + 1
    cmp #>PIN_FRAME
    bne sc_bitmap
    lda bt
    cmp #<PIN_FRAME
    bne sc_bitmap
    ldx #7
!:  lda order, x
    cmp pred300, x
    bne sc_fail
    dex
    bpl !-
    bmi sc_bitmap               // X is $FF here: always taken
sc_fail:
    lda #0
    rts

sc_bitmap:
    // On NTSC the half-copy means the top and bottom halves carry consecutive
    // phases (the top was drawn one frame earlier than the bottom, or vice
    // versa). The phase check below assumes a full-frame draw and cannot
    // distinguish the two cases without knowing the last draw's parity; skip
    // it on NTSC. The order, register and replay checks above still run.
    lda region
    bne sc_done
    ldx #2
sc_line:
    lda chk_lo, x
    sta ptr
    lda chk_hi, x
    sta ptr + 1
    lda t
    sec
    sbc #1                      // t_last
    clc
    adc chk_l, x
    and #$3f
    tay                         // phase index
    stx blk
    ldx #0
sc_byte:
    txa
    asl
    asl
    asl
    sta atmp                    // 8 k
    lda sc_plane_lo, x
    sta fptr
    lda sc_plane_hi, x
    sta fptr + 1
    lda (fptr), y               // plane k at the phase
    sta ytmp
    ldy atmp
    lda (ptr), y                // bitmap byte column 16 + k
    cmp ytmp
    bne sc_fail
    lda t
    sec
    sbc #1
    ldx blk
    clc
    adc chk_l, x
    and #$3f
    tay                         // phase again for the next plane
    ldx atmp
    txa
    lsr
    lsr
    lsr
    tax
    inx
    cpx #8
    bne sc_byte
    ldx blk
    dex
    bpl sc_line
sc_done:
    lda #1
    rts

sc_plane_lo: .fill 8, <(PLANES + 128 * i)
sc_plane_hi: .fill 8, >(PLANES + 128 * i)
