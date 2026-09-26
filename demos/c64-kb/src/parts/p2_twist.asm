// p2_twist.asm: part 2 of MEASURED, the TWIST. A port of two c64-kb recipes:
// docs/recipes/kickassembler/twister.md (kickassembler-twister) and
// docs/recipes/kickassembler/vector-balls.md (kickassembler-vector-balls).
//
// The twister: a square column seen side on, 64 pixels wide, 136 bitmap lines
// tall (rows 32 to 167: the recipe's 128 plus four above and four below, so
// the band is seventeen whole character rows), turning about its vertical
// axis. The four edges are
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
//   - HALF-COPY ON BOTH MODELS. The full copy (16,147 cycles) plus the music
//     interrupt and the fade overran the NTSC frame, and on PAL it left no
//     room for anything else, so both models redraw half the band a frame:
//     even frames rows 4 to 10 and row 20 (64 lines, blocks 0..6 and 16),
//     odd frames rows 11 to 19 (72 lines, blocks 7..15). The twist phase t
//     advances once a frame whichever half is drawn, so the halves are one
//     phase apart at their seams (rows 10/11 and 19/20): band line L holds
//     (t_even + L) & 63 in the even rows and (t_even + 1 + L) & 63 in the
//     odd ones. Row 20 rides with the top because 128 lines is two helix
//     periods: its phase is row 4's. The beam chases the top rows: the copy
//     starts after the line-255 music call and the ball pass (about line 32
//     on NTSC) and each block costs about 13 raster lines with the bar
//     interrupts against the 8 it is shown in, so the seven chased blocks
//     are done by about line 123 for a row shown from raster 131.
//     selfcheck's sc_phase knows the split.
//     Measured on the demo's end screen (whole run, both halves, the roll
//     and the bar interrupts inside the bracket): PAL worst 13,878, typical
//     13,237 of 19,656; NTSC worst 14,714, typical 14,126 of 17,095, which
//     leaves NTSC about 500 cycles after the music call and the two bar
//     entries that land after main. The run is deterministic, so that worst
//     is the worst. p2.region is set by prepare: 0 = PAL, 1 = NTSC.
//   - Bank 1: bitmap $6000, screen $5C00, $D018 = $78, $DD00 = $C6. The
//     recipe's bitmap was $2000 with screen $0400 in bank 0.
//   - The ball shapes sit at $7E00 and $7E40 (pointers $F8, $F9), which is
//     inside the bitmap's last character row (the bitmap is 8,000 bytes, to
//     $7F3F). Their bytes would show as ink in the sixteen cells of text row
//     24, columns 0 to 15, so those cells take their paper colour in both
//     nibbles whenever the roll writes row 24 and never show them. The
//     recipe kept its shapes at $2000.
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
//     as a 16-entry next-darker table. Every 8 frames the three ball colours
//     step one place down it and so does every entry of fmap, the 16-byte
//     colour map the roll and the bars read through; the roll then carries
//     the darker map onto the screen two rows a frame and the bars take it
//     at their next line. Done once two steps in a row have begun with the
//     map and the ball colours black (white takes 15 steps; 136 frames all
//     told). The recipe's 17 by 16 proportional table did not fit.
//   - THE COLOUR ROLL AND THE BARS (neither in the recipes). Screen RAM's
//     ink nibble runs light blue, cyan, light green, yellow, white and back
//     by row; the paper nibble black, blue, brown, red, purple and back along
//     a diagonal (row + column / 4); two rows are rewritten a frame, top to
//     bottom, and each sweep moves the pattern one row. $D020 takes a nine
//     colour ramp in BAR_N bands from BAR_N dispatcher entries BAR_STEP lines
//     apart, one band further on every second frame. Row 24's first sixteen
//     cells, over the ball shapes, take their paper in both nibbles.
//   - setup writes every VIC register the contract lists; cleanup restores
//     the contract's values after raster line 250 and stops the timer.
//
// Zero page: $10-$15 (dst, ptr, fptr); $16 = region (0=PAL, 1=NTSC);
// $17-$1B the colour roll's ink nibble, row counter, row pointer and column.
// Interrupts: BAR_N dispatcher entries, one per border bar, all bar_irq.

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
.const inkz = $17                 // roll_one's ink nibble for the row
.const rcnt = $18                 // roll_step's rows left this frame
.const srow = $19                 // screen RAM address of row `row`
.const roff = $1b                 // roll_one's column

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

// --- the colour roll and the bars: palettes in luminance order -----------
// tri(i, n) runs 0 .. n-1 .. 1 with period 2 (n - 1); five colours held two
// rows each give period 16, so a 16-entry table wraps clean under & 15.
.function tri(i, n) { .var m = mod(i, 2 * (n - 1)); .return (m < n) ? m : 2 * (n - 1) - m }
.var inkpal = List().add(14, 3, 13, 7, 1)      // light blue up to white: the twister's ink
.var pappal = List().add(0, 6, 9, 2, 4)        // black up to purple: the field behind it
.var barpal = List().add(0, 6, 11, 4, 14, 12, 3, 15, 1)   // nine steps: the border bars
.const ROLL_ROWS = 2              // character rows recoloured a frame
.const BAR_N     = 13             // border bars: one dispatcher entry each
.const BAR_FIRST = 10
.const BAR_STEP  = 20             // 10, 30, .. 250; 254 to 258 are the sequencer's

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
irq_count:   .byte BAR_N
irq_lines:   .fill BAR_N, BAR_FIRST + BAR_STEP * i
irq_hi:      .fill BAR_N, 0
irq_lo:      .fill BAR_N, <bar_irq
irq_hi_addr: .fill BAR_N, >bar_irq
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
fade_j:    .byte 0
faded:     .byte 0
blackn:    .byte 0                // fade steps that began with the map all black
// next darker colour down the colour-fade recipe's luminance order; black stays black
darker: .fill 16, (pos.get(i) == 0) ? 0 : lum.get(pos.get(i) - 1)
// The colour roll: ink_tab by (row - roll), pap_line by (row + roll + column / 4),
// both read through fmap, the fade's colour map (identity until the fade starts).
ink_tab:  .fill 16, inkpal.get(tri(floor(i / 2), 5))
pap_line: .fill 32, pappal.get(tri(floor(i / 2), 5))
fmap:     .fill 16, i
dup:      .fill 16, i * 17        // paper in both nibbles: row 24's shape cells
roll:     .byte 0                 // gradient offset, advances once a sweep
row:      .byte 0                 // next character row the sweep rewrites
// The bars: bar_tab[(entry - bpos) & 15] through fmap into $D020 at each
// entry's line; bpos advances every second frame. The handler leaves the
// table index and the colour it wrote for selfcheck to read back.
bar_tab:  .fill 16, barpal.get(tri(i, 9))
// band_tab[line / 8] = the band whose entry line the handler is running in
// (entries are 20 lines apart, the handler enters within a few lines).
band_tab: .fill 32, max(0, floor((8 * i + 7 - BAR_FIRST) / BAR_STEP))
bpos:     .byte 0
bar_idx:  .byte 0
bar_col:  .byte 0
// The standalone test's verdict is a border colour and the bars would paint
// over it, so its runner sets vmode after selfcheck: entries from line 130
// down then write vcol (the stub's verdict colour) and the bars keep the
// top. The demo never sets it.
vmode:    .byte 0
vcol:     .byte 0

// Bitmap row bases of the band, text rows 4 to 20 (seventeen blocks).
rowlo: .fill 17, <(BITMAP + (4 + i) * 320 + BAND_BYTE * 8)
rowhi: .fill 17, >(BITMAP + (4 + i) * 320 + BAND_BYTE * 8)

// selfcheck's three band lines (the recipe's measured rows): L, then the
// bitmap address of byte column 16 on that line.
chk_l:  .byte 0, 40, 100
chk_lo: .byte <(BITMAP + floor((TOP + 0) / 8) * 320 + mod(TOP + 0, 8) + BAND_BYTE * 8)
        .byte <(BITMAP + floor((TOP + 40) / 8) * 320 + mod(TOP + 40, 8) + BAND_BYTE * 8)
        .byte <(BITMAP + floor((TOP + 100) / 8) * 320 + mod(TOP + 100, 8) + BAND_BYTE * 8)
chk_hi: .byte >(BITMAP + floor((TOP + 0) / 8) * 320 + mod(TOP + 0, 8) + BAND_BYTE * 8)
        .byte >(BITMAP + floor((TOP + 40) / 8) * 320 + mod(TOP + 40, 8) + BAND_BYTE * 8)
        .byte >(BITMAP + floor((TOP + 100) / 8) * 320 + mod(TOP + 100, 8) + BAND_BYTE * 8)

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
    ldx #15
!:  txa
    sta fmap, x                 // the fade's map starts as the identity
    dex
    bpl !-
    lda #0
    sta roll
    sta row
    lda #<SCREEN
    sta srow
    lda #>SCREEN
    sta srow + 1
!:  jsr roll_one                // every cell at offset 0, row 24's shape cells included
    lda row
    bne !-
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
    sta blackn
    sta bpos
    sta vmode
    lda #1
    sta col_white
    lda #15
    sta col_lgrey
    lda #12
    sta col_grey
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
!:  lda t
    and #1
    bne !+
    inc bpos                    // the bars move one band every second frame
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
    jsr roll_step               // ROLL_ROWS character rows of colour

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
    // Both models take the half-copy path: even frames rows 4 to 10 and
    // row 20 (64 band lines), odd frames rows 11 to 19 (72). Rows 4 to 10
    // are the ones the beam chases, so they are the fewer; row 20 rides
    // with them because 128 lines is two helix periods, so its phase is
    // row 4's. The full PAL copy is gone; its room pays for the colour roll
    // and the bars. Band line L has phase (t + L) & 63 and the band starts
    // four lines above the recipe's, at L = -4.
    lda t
    lsr                         // carry = t & 1: 0 = even frame, 1 = odd
    bcs draw_bot
    lda t
    sec
    sbc #4
    and #$3f
    tax                         // X = phase of row 4, line 0
    lda #0
    sta blk
    lda #7
    jsr blocks_to               // blocks 0..6: rows 4 to 10
    txa
    clc
    adc #8
    and #$3f
    tax                         // back to block 0's phase for row 20
    lda #16
    sta blk
    lda #17
    bne blocks_to               // block 16: always taken

draw_bot:
    lda t
    clc
    adc #52
    and #$3f
    tax                         // X = phase of band line 52, row 11 line 0
    lda #7
    sta blk
    lda #16                     // blocks 7..15, rows 11 to 19, falling into blocks_to

// blocks_to: block_copy from blk until blk reaches A.
blocks_to:
    sta ytmp
!:  jsr block_copy
    lda blk
    cmp ytmp
    bne !-
    rts

// block_copy: load dst from rowlo/rowhi[blk], copy 8 lines (CopyLines(0,8,0)),
// advance X by 8, increment blk.
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


// ---------------------------------------------------------------------------
// fadeout: one fade step every 8 frames: fmap and the three ball colours one
// place darker; main's roll carries the map onto the screen and the bars.
// Returns A = 0 while fading, 1 once two steps have begun with the map black.
// ---------------------------------------------------------------------------
fadeout:
    lda faded
    beq !+
    lda #1
    rts
!:  lda fade_j
    bne fo_count
    lda fmap + 1                // white is the last colour to reach black
    ora col_white
    bne fo_step
    inc blackn                  // a step begun with everything black; the
    lda blackn                  // second means a whole sweep has been black
    cmp #2
    bne fo_count
    lda #1
    sta faded
    rts
fo_step:
    ldx #15
fo_map:
    ldy fmap, x
    lda darker, y
    sta fmap, x
    dex
    bpl fo_map
    ldx col_white
    lda darker, x
    sta col_white
    ldx col_lgrey
    lda darker, x
    sta col_lgrey
    ldx col_grey
    lda darker, x
    sta col_grey
fo_count:
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
    ldx #2
sc_line:
    lda chk_lo, x
    sta ptr
    lda chk_hi, x
    sta ptr + 1
    jsr sc_phase                // Y = phase check line X was last drawn with
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
    ldy ztmp                    // phase again for the next plane
    lda atmp
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
    // A cell of the row the roll wrote last (row - 1, or row 24 at offset
    // roll - 1 when the sweep has just wrapped): column 20, paper group 5.
    lda srow
    sec
    sbc #20
    sta ptr
    lda srow + 1
    sbc #0
    sta ptr + 1
    ldx row
    lda roll
    dex
    bpl sc_cell
    ldx #24
    sec
    sbc #1                      // A = roll - 1
    ldy #<(SCREEN + 24 * 40 + 20)
    sty ptr
    ldy #>(SCREEN + 24 * 40 + 20)
    sty ptr + 1
sc_cell:
    sta ztmp                    // the offset that row was written with
    stx atmp                    // the row
    jsr sc_expect               // A = the cell's expected value
    ldy #0
    cmp (ptr), y
    bne sc_fail2
    // The border: what is on $D020 is the byte the last bar entry wrote,
    // and that byte is the table's colour at the index it kept.
    php
    sei
    ldx bar_idx
    lda bar_col
    sta ytmp
    lda $d020
    plp
    and #$0f
    cmp ytmp
    bne sc_fail2
    ldy bar_tab, x
    lda fmap, y
    cmp ytmp
    bne sc_fail2
sc_done:
    lda #1
    rts
sc_fail2:
    lda #0
    rts

// sc_expect: A = screen RAM value of row atmp, column 20, at offset ztmp:
// ink ink_tab[(row - offset) & 15] over paper pap_line[((row + offset) & 15) + 5].
sc_expect:
    lda atmp
    sec
    sbc ztmp
    and #$0f
    tay
    ldx ink_tab, y
    lda fmap, x
    asl
    asl
    asl
    asl
    sta ytmp
    lda atmp
    clc
    adc ztmp
    and #$0f
    clc
    adc #5
    tay
    ldx pap_line, y
    lda fmap, x
    ora ytmp
    rts

// sc_phase: Y (and ztmp) = the phase check line X was last drawn with.
// Lines 0 and 40 sit in the top half, drawn on even t; line 100 in the
// bottom, drawn on odd t. With t_last = t - 1 the top's base is t_last
// with bit 0 clear and the bottom's is the last odd t at or before it.
sc_phase:
    lda t
    sec
    sbc #1                      // t_last
    cpx #2
    bcs sc_bot_ph
    and #$fe                    // top half: last even t
    bcc sc_add_ph               // carry clear from cpx: always
sc_bot_ph:
    sbc #1                      // carry set from cpx: t_last - 1
    ora #1                      // bottom half: last odd t
sc_add_ph:
    clc
    adc chk_l, x
    and #$3f
    sta ztmp
    tay
    rts

sc_plane_lo: .fill 8, <(PLANES + 128 * i)
sc_plane_hi: .fill 8, >(PLANES + 128 * i)

// ---------------------------------------------------------------------------
// roll_one: character row `row` (screen address srow) recoloured: ink
// ink_tab[(row - roll) & 15], paper pap_line[((row + roll) & 15) + column / 4],
// both through fmap; then row, srow and, past row 24, roll advance.
// ---------------------------------------------------------------------------
roll_one:
    lda row
    sec
    sbc roll
    and #$0f
    tay
    ldx ink_tab, y
    lda fmap, x
    asl
    asl
    asl
    asl
    sta inkz                    // the row's ink nibble, faded
    lda row
    clc
    adc roll
    and #$0f
    tax                         // paper index of column 0
    ldy #0
    sty roff
rr_grp:
    ldy pap_line, x             // this four-column group's paper
    lda fmap, y
    ora inkz
    ldy roff
    sta (srow), y
    iny
    sta (srow), y
    iny
    sta (srow), y
    iny
    sta (srow), y
    iny
    sty roff
    inx
    cpy #40
    bne rr_grp
    lda row
    cmp #24
    bne rr_adv
    ldx #15                     // row 24's shape cells: paper in both nibbles
rr_shape:
    lda SCREEN + 24 * 40, x
    and #$0f
    tay
    lda dup, y
    sta SCREEN + 24 * 40, x
    dex
    bpl rr_shape
rr_adv:
    inc row
    lda srow
    clc
    adc #40
    sta srow
    bcc !+
    inc srow + 1
!:  lda row
    cmp #25
    bne rr_done
    lda #0                      // past the bottom: the sweep restarts one
    sta row                     // offset further on
    lda #<SCREEN
    sta srow
    lda #>SCREEN
    sta srow + 1
    inc roll
rr_done:
    rts

// ---------------------------------------------------------------------------
// roll_step: ROLL_ROWS rows a frame down the screen; past row 24 the sweep
// restarts at row 0 with the offset one further on.
// ---------------------------------------------------------------------------
roll_step:
    lda #ROLL_ROWS
    sta rcnt
!:  jsr roll_one
    dec rcnt
    bne !-
    rts

// ---------------------------------------------------------------------------
// bar_irq: every bar entry. The band index comes from the raster line read
// on entry (band_tab by line / 8), never from a count, so a late or a
// repeated call still paints the right band. The band's colour is
// bar_tab[(index - bpos) & 15] through fmap; index and colour are kept.
// ---------------------------------------------------------------------------
bar_irq:
    lda $d012                   // the entry's line, up to a few lines late
    lsr
    lsr
    lsr
    tax
    lda band_tab, x             // which band that line is in
    tax
    lda vmode
    beq bar_band
    cpx #6                      // verdict mode: line 130 down shows vcol
    bcc bar_band
    lda vcol
    sta $d020
    rts
bar_band:
    txa
    sec
    sbc bpos
    and #$0f
    sta bar_idx
    tay
    ldx bar_tab, y
    lda fmap, x
    sta $d020
    sta bar_col
    rts
