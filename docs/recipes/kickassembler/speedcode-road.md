---
recipe: speedcode-road
toolchain: kickassembler
output_format: PRG
region: both
techniques: [speedcode_bitmap_road]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D011, D012, D015, D016, D018, D019, D01A, D020, D021, DC0D, DD00, DD04, DD05, DD06, DD07, DD0D, DD0E, DD0F]
uses_kernal: []
claims: [irq_vector_fffe (owns), nmi_vector_fffa (owns), vic_raster_irq (owns), cia2_vic_bank (owns), vic_matrix_base (owns), vic_char_base (owns), sprite_0-3 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), cia2_tod (init), zero_page $F0-$FB (owns)]
harness: [cia2_timer_a, cia2_timer_b, $0340-$034F, $02FF]
ram: [colour=$D800-$DBFF, speedcode=$4000-$A400, vic=$C000-$FFF9]
---

<!-- doc-type: recipe -->

# KickAssembler — Speedcode Bitmap Road

## Synopsis

A pseudo-3D road in a multicolour bitmap, drawn the way Simon Nicol's
unreleased 1989 racer is described: each road line is a run of
pre-generated `STA` instructions to its bitmap bytes, with the colour in
A, and an edge is moved by patching the code, not by redrawing it. Here
each of the 128 road lines (raster lines 123-250, under a text top) is 40
five-byte slots, `BIT $00` or `LDA #v`, then `STA` the byte. A picture
works out each line's six edges (the two kerbs' two sides and the centre
line), patches the slots where the colour changes, and runs all 128
lines. The grass bands are `$D021` written per line by a polling kernel,
as in the racing starter (`templates/racing/`); the kerbs' red and white
are in the bitmap. The program times itself with CIA2 and leaves its
figures at `$0340`, then shows a still of a bend. Use it to see what the
method costs; for a road with kerbs and a centre line it costs more than
the racing starter's character road (`char_row_road`, "Why this works").

## Source

```asm
// speedcode-road.asm   KickAssembler 5.25
//
// A pseudo-3D road in a multicolour bitmap drawn by speedcode: each road
// line (raster lines 123-250, under a text top) is 40 five-byte slots, one
// a bitmap byte: BIT $00 / STA byte (A kept) or LDA #v / STA byte (A set).
// A picture computes each line's six edges (kerbs, centre line), patches
// the slots where the colour changes (an edge's mixed byte and the fill
// after it) and runs all 128 lines. The grass bands are $D021 per line
// from a polling kernel; the kerbs' red and white are in the bitmap ($AA
// screen-RAM red, $FF colour-RAM white), so they change only with the
// picture.
//
// Results at $0340, 24-bit cycle counts over a 64-picture benchmark with
// interrupts off: +0 the patch's mean, +3 the run's mean, +6 the patch's
// maximum, +9 the run's maximum; then over 1,000 frames of the live phase
// (interrupts on, sprites 0-3 over the road): +12 pictures and +14 frames
// (words). $02FF = 1 when done; the screen then holds a still.

.const LINES   = 128
.const TOP     = 123
.const H       = 131            // the horizon (fixed here)
.const BITMAP  = $e000
.const BMSCR   = $c400          // the bitmap's colours: %01 high nibble, %10 low
.const TXTSCR  = $c000
.const CHARSET = $c800
.const SC      = $4000          // the speedcode: 200 bytes a line, to $A400
.const SLOT    = 5
.const ZB      = $f0            // zero page: $F0-$FF

.const zp_ptr  = ZB             // 2: the line's speedcode
.const zp_x    = ZB + 2         // 2: the centre, 8.8 dp
.const zp_dx   = ZB + 4         // 2: its step a line up
.const zp_t    = ZB + 6         // 2
.const zp_s    = ZB + 8         // the segment colour
.const zp_acc  = ZB + 9         // the byte being built
.const zp_pb   = ZB + 10        // its column ($FF none)
.const zp_n    = ZB + 11        // patches this line

.function isBad(line) { .return (line & 7) == 3 }
.const ZC = 45000
.function zOf(d) { .return d <= 0 ? 65535 : min(65535, round(ZC / d)) }

BasicUpstart2(start)

* = $0810 "code"
start:
        sei
        lda #$35
        sta $01
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda $dd0d
        lda $dd00
        and #$fc
        sta $dd00               // VIC bank 3
        lda #0
        sta $d020
        jsr clear
        jsr gen_code
        // sprites 0-3: blank pictures across the road lines (their DMA)
        lda #$0f
        sta $d015
        ldx #0
!:      lda #100
        sta $d000, x
        lda #150
        sta $d001, x
        inx
        inx
        cpx #8
        bne !-
        lda #(($cc00 - $c000) / 64)
        ldx #3
!:      sta BMSCR + $3f8, x
        sta TXTSCR + $3f8, x
        dex
        bpl !-
        // the benchmark: 64 pictures, interrupts off
        lda #0
        ldx #15
!:      sta $0340, x
        sta sums, x
        dex
        bpl !-
        lda #64
        sta bench_n
bench:  jsr step_road
        jsr t_start
        jsr patch_all
        jsr t_stop
        ldx #0
        jsr acc_stat
        jsr t_start
        jsr SC
        jsr t_stop
        ldx #3
        jsr acc_stat
        dec bench_n
        bne bench
        ldx #0                  // the means: sum / 64, 24 bits, to +0 and +3
        ldy #0
mean:   lda sums, y
        sta t_lo
        lda sums + 1, y
        sta t_hi
        lda sums + 2, y
        sta t_up
        lda sums + 3, y
        .for (var k = 0; k < 6; k++) {
            lsr
            ror t_up
            ror t_hi
            ror t_lo
        }
        lda t_lo
        sta $0340, x
        lda t_hi
        sta $0341, x
        lda t_up
        sta $0342, x
        inx
        inx
        inx
        iny
        iny
        iny
        iny
        cpy #8
        bne mean
        // the live phase: interrupts on, until 1,000 frames
        lda #<irq_top
        sta $fffe
        lda #>irq_top
        sta $ffff
        lda #<nmi
        sta $fffa
        lda #>nmi
        sta $fffb
        lda #$1b
        sta $d011
        lda #120
        sta $d012
        lda #$ff
        sta $d019
        lda #1
        sta $d01a
        cli
live:   jsr step_road
        jsr patch_all
        jsr SC
        inc $034c
        bne !+
        inc $034d
!:      lda frames + 1
        cmp #>1000
        bcc live
        lda frames
        sta $034e
        lda frames + 1
        sta $034f
        // the still: one picture of a left-hand bend, then only the kernel
        lda #40
        sta phase
        jsr patch_all
        jsr SC
        lda #1
        sta $02ff
!:      jmp !-
bench_n: .byte 0
nmi:    rti

// ---- timing: CIA2 timer A counts cycles, timer B its underflows --------
t_start:
        lda #0
        sta $dd0e
        sta $dd0f
        lda #$ff
        sta $dd04
        sta $dd05
        sta $dd06
        sta $dd07
        lda #$51
        sta $dd0f               // B: force load, start, count A's underflows
        lda #$11
        sta $dd0e               // A: force load, start
        rts
t_stop: lda #0
        sta $dd0e
        lda #$ff
        sec
        sbc $dd04
        sta t_lo
        lda #$ff
        sbc $dd05
        sta t_hi
        lda #$ff
        sec
        sbc $dd06               // underflows (a picture under 16.7M cycles)
        sta t_up
        lda #0
        sta $dd0f
        rts
t_lo:   .byte 0
t_hi:   .byte 0
t_up:   .byte 0
// acc_stat: X = 0 patch, 3 run. Adds t (24 bits) to its sum (32 bits, at
// sums + 4X/3) and keeps its maximum (at $0346 + X).
acc_stat:
        txa
        beq !+
        lda #4
!:      tay
        lda t_lo
        clc
        adc sums, y
        sta sums, y
        lda t_hi
        adc sums + 1, y
        sta sums + 1, y
        lda t_up
        adc sums + 2, y
        sta sums + 2, y
        bcc !+
        lda sums + 3, y
        adc #0
        sta sums + 3, y
!:      lda t_up                // the maximum: compare high to low
        cmp $0348, x
        bcc as_done
        bne as_set
        lda t_hi
        cmp $0347, x
        bcc as_done
        bne as_set
        lda t_lo
        cmp $0346, x
        bcc as_done
as_set: lda t_lo
        sta $0346, x
        lda t_hi
        sta $0347, x
        lda t_up
        sta $0348, x
as_done:
        rts
sums:   .fill 16, 0

// ---- the road's motion: a bend that swings, a car that sways ----------
step_road:
        lda pos
        clc
        adc #20                 // 20 units a picture
        sta pos
        bcc !+
        inc pos + 1
!:      inc phase
        rts
pos:    .word 0
phase:  .byte 0

// ---- patch_all: every road line's slots from its colours -----------------
// The centre starts on the bottom line at 80 dp plus a sway and goes up the
// screen with the per-line curve: dx += c, x += dx.
patch_all:
        ldx phase
        lda sway, x
        sta zp_x + 1
        lda #0
        sta zp_x
        sta zp_dx
        sta zp_dx + 1
        lda curve, x
        sta cur_c
        ldx #LINES - 1          // bottom up
pa_line:
        stx pa_l
        txa
        clc
        adc #TOP - H            // d
        bmi pa_far
        beq pa_far
        tay
        sty pa_d
        jsr line_patch
        // up a line: dx += c (signed, in 1/256 dp), x += dx
        lda cur_c
        bpl !+
        dec zp_dx + 1
!:      clc
        adc zp_dx
        sta zp_dx
        bcc !+
        inc zp_dx + 1
!:      lda zp_x
        clc
        adc zp_dx
        sta zp_x
        lda zp_x + 1
        adc zp_dx + 1
        sta zp_x + 1
        jmp pa_next
pa_far: jsr line_grass
pa_next:
        ldx pa_l
        dex
        bpl pa_line
        rts
pa_l:   .byte 0
pa_d:   .byte 0
cur_c:  .byte 0

// The line's six edges (dp, held to 0-160) into ed[0-5], its segment
// colours into sg[0-6], then the slots.
line_patch:
        ldx pa_l
        lda sc_lo, x
        sta zp_ptr
        lda sc_hi, x
        sta zp_ptr + 1
        ldy pa_d
        // kerb colour from the band: bit 6 of z + pos
        lda z_lo, y
        clc
        adc pos
        and #$40
        beq !+
        lda #$ff                // white (colour RAM)
        .byte $2c
!:      lda #$aa                // red (screen RAM low nibble)
        sta sg + 1
        sta sg + 5
        // edges from x (unsigned dp): x - w, x - (w - K), x - s/2, x - s/2 + s,
        // x + (w - K), x + w, each held to 0-160 and to the one before
        lda w_of_d, y
        sec
        sbc k_of_d, y
        sta el_wk
        lda zp_x + 1
        sec
        sbc w_of_d, y
        jsr clampl
        sta ed + 0
        lda zp_x + 1
        sec
        sbc el_wk
        jsr clampl
        sta ed + 1
        lda zp_x + 1
        sec
        sbc s_half, y
        jsr clampl
        cmp ed + 1
        bcs !+
        lda ed + 1
!:      sta ed + 2
        lda zp_x + 1
        sec
        sbc s_half, y
        bcs !+
        lda #0
!:      clc
        adc s_of_d, y
        jsr clampu
        cmp ed + 2
        bcs !+
        lda ed + 2
!:      sta ed + 3
        lda zp_x + 1
        clc
        adc el_wk
        jsr clampu
        cmp ed + 3
        bcs !+
        lda ed + 3
!:      sta ed + 4
        lda zp_x + 1
        clc
        adc w_of_d, y
        jsr clampu
        cmp ed + 4
        bcs !+
        lda ed + 4
!:      sta ed + 5
        // the same six edges and kerb colour as last time: nothing to do
        ldx pa_l
        lda sg + 1
        cmp le_k, x
        bne lp_new
        .for (var e = 0; e < 6; e++) {
            lda ed + e
            cmp le_e + e * LINES, x
            bne lp_new
        }
        rts
lp_new: lda sg + 1
        sta le_k, x
        .for (var e = 0; e < 6; e++) {
            lda ed + e
            sta le_e + e * LINES, x
        }
        jmp emit_line
el_wk:  .byte 0

// A = x - v with the carry of the SBC: 0 when it went below 0, else held to 160
clampl: bcs clampv
        lda #0
        rts
clampv: cmp #160
        bcc !+
        lda #160
!:      rts

// A = an unsigned sum with the carry of the ADC: held to 160
clampu: bcs !+
        cmp #160
        bcc cl_ok
!:      lda #160
cl_ok:  rts

// A line above the horizon: all grass (far land) = byte 0 only.
line_grass:
        ldx pa_l                // already all grass: nothing to do
        lda le_k, x
        cmp #$01
        beq lg_done
        lda #$01
        sta le_k, x
        ldx pa_l
        lda sc_lo, x
        sta zp_ptr
        lda sc_hi, x
        sta zp_ptr + 1
        lda #0
        sta zp_n
        tax
        lda #0
        jsr emit
        jmp apply
lg_done:
        rts

// unpatch: the line's last patches back to BIT $00.
unpatch:
        ldx pa_l
        lda ol_n, x
        beq up_done
        sta up_n
        lda ol_lo, x
        sta zp_t
        lda ol_hi, x
        sta zp_t + 1
up_lp:  dec up_n
        ldy up_n
        lda (zp_t), y
        tax
        lda col5, x
        tay
        lda #$24
        sta (zp_ptr), y
        lda up_n
        bne up_lp
up_done:
        rts
up_n:   .byte 0

// emit_line: the slots of this line from ed/sg (see the header).
emit_line:
        lda #0
        sta zp_n
        lda #$ff
        sta zp_pb
        lda sg + 0
        sta zp_s
        ldx #0                  // edge index
el_edge:
        lda ed, x
        cmp #160
        bcs el_end              // off the right: this and the rest
        sta el_p
        lsr
        lsr
        cmp zp_pb
        beq el_same
        pha                     // a new byte: flush the last
        ldy zp_pb
        cpy #$ff
        beq el_first
        stx el_x
        tya
        tax
        lda zp_acc
        jsr emit                // the last mixed byte
        ldx zp_pb
        inx
        pla
        pha
        sta el_cb
        cpx el_cb
        bcs el_nofill
        lda zp_s
        jsr emit                // the fill after it
el_nofill:
        ldx el_x
        jmp el_new
el_first:
        pla
        pha
        beq el_new
        stx el_x
        ldx #0
        lda zp_s
        jsr emit                // the fill from column 0
        ldx el_x
el_new: pla
        sta zp_pb
        lda zp_s
        sta zp_acc
el_same:
        // the byte's pixels from p on take the next segment's colour
        lda el_p
        and #3
        tay
        lda zp_acc
        and lmask, y
        sta zp_acc
        lda sg + 1, x
        sta zp_s
        and rmask, y
        ora zp_acc
        sta zp_acc
        inx
        cpx #6
        bne el_edge
el_end: ldy zp_pb
        cpy #$ff
        beq el_only
        stx el_x
        tya
        tax
        lda zp_acc
        jsr emit
        ldx zp_pb
        inx
        cpx #40
        bcs el_done
        lda zp_s
        jsr emit
        jmp el_done
el_only:
        ldx #0
        lda zp_s
        jsr emit
el_done:
        jmp apply
el_p:   .byte 0
el_x:   .byte 0
el_cb:  .byte 0
lmask:  .byte %00000000, %11000000, %11110000, %11111100
rmask:  .byte %11111111, %00111111, %00001111, %00000011

// emit: X = column, A = value: that slot becomes LDA #value; noted.
emit:   ldy zp_n
        sta nl_v, y
        txa
        sta nl_c, y
        inc zp_n
        rts

// apply: the new list against the old. The same columns: only the values
// (the LDA operands) are written. Else the old go back to BIT $00 and the
// new become LDA #v.
apply:  ldx pa_l
        lda ol_n, x
        cmp zp_n
        bne ap_full
        lda ol_lo, x
        sta zp_t
        lda ol_hi, x
        sta zp_t + 1
        ldy zp_n
        dey
ap_cmp: lda (zp_t), y
        cmp nl_c, y
        bne ap_full
        dey
        bpl ap_cmp
        ldx zp_n                // same columns: the operands
        dex
ap_ops: ldy nl_c, x
        lda col5, y
        tay
        iny
        lda nl_v, x
        sta (zp_ptr), y
        dex
        bpl ap_ops
        rts
ap_full:
        jsr unpatch
        ldx zp_n
        dex
ap_new: ldy nl_c, x
        lda col5, y
        tay
        lda #$a9
        sta (zp_ptr), y
        iny
        lda nl_v, x
        sta (zp_ptr), y
        dex
        bpl ap_new
        // this line's patches become its list for next time
save_list:
        ldx pa_l
        lda zp_n
        sta ol_n, x
        lda ol_lo, x
        sta zp_t
        lda ol_hi, x
        sta zp_t + 1
        ldy zp_n
        dey
        bmi sl_done
sl_lp:  lda nl_c, y
        sta (zp_t), y
        dey
        bpl sl_lp
sl_done:
        rts

ed:     .fill 6, 0
sg:     .byte $00, $aa, $55, $ff, $55, $aa, $00
nl_c:   .fill 16, 0
nl_v:   .fill 16, 0
.label le_e = le_k + LINES
col5:   .fill 40, i * SLOT

// ---- the speedcode ----------------------------------------------------------
// Line l, column c: BIT $00 (or LDA #v), STA the bitmap byte of raster line
// 123 + l, column c. One RTS after line 127.
gen_code:
        lda #<SC
        sta zp_ptr
        lda #>SC
        sta zp_ptr + 1
        ldx #0
gc_line:
        lda bm_lo, x
        sta zp_t
        lda bm_hi, x
        sta zp_t + 1
        ldy #0
gc_slot:
        lda #$24
        sta (zp_ptr), y
        iny
        lda #$00
        sta (zp_ptr), y
        iny
        lda #$8d
        sta (zp_ptr), y
        iny
        lda zp_t
        sta (zp_ptr), y
        iny
        lda zp_t + 1
        sta (zp_ptr), y
        iny
        lda zp_t
        clc
        adc #8
        sta zp_t
        bcc !+
        inc zp_t + 1
!:      cpy #40 * SLOT
        bne gc_slot
        lda zp_ptr
        clc
        adc #<(40 * SLOT)
        sta zp_ptr
        bcc !+
        inc zp_ptr + 1
!:      lda #0
        sta ol_n, x
        inx
        cpx #LINES
        bne gc_line
        ldy #0
        lda #$60
        sta (zp_ptr), y
        // slot 0 of every line must load: start every line with LDA #0
        ldx #0
!:      lda sc_lo, x
        sta zp_ptr
        lda sc_hi, x
        sta zp_ptr + 1
        ldy #0
        lda #$a9
        sta (zp_ptr), y
        inx
        cpx #LINES
        bne !-
        rts

// ---- screen set-up ----------------------------------------------------------
clear:
        lda #0
        tax
!:      .for (var p = 0; p < 31; p++) { sta BITMAP + p * 256, x }
        .for (var p = 0; p < 8; p++) { sta CHARSET + p * 256, x }
        inx
        bne !-
        ldx #$3f                // the bitmap's last $40 bytes: $FF00-$FF3F, not
!:      sta BITMAP + $1f00, x   // the vectors above them
        dex
        bpl !-
        ldx #0
        lda #$c2                // %01 grey (12), %10 red (2)
!:      sta BMSCR, x
        sta BMSCR + $100, x
        sta BMSCR + $200, x
        sta BMSCR + $2e8, x
        inx
        bne !-
        lda #1                  // %11 white
!:      sta $d800, x
        sta $d900, x
        sta $da00, x
        sta $dae8, x
        inx
        bne !-
        lda #0
!:      sta TXTSCR, x
        sta TXTSCR + $100, x
        sta TXTSCR + $200, x
        sta TXTSCR + $2e8, x
        inx
        bne !-
        ldx #63                 // the sprite picture at $CC00: blank
!:      sta $cc00, x
        dex
        bpl !-
        rts


// ---- the interrupts ---------------------------------------------------------
// line 120: wait for 122, then the bitmap from line 123 (row 9's badline);
// the blocks store $D021 per normal line, as the band of zlo + pos says
irq_top:
        pha
        txa
        pha
        tya
        pha
        ldx far_col             // lines 122 on: the far land
        lda #122
!:      cmp $d012
        bne !-
        stx $d021               // in the left border (cycle 13 at the latest)
        // then the bitmap, in an order whose every step shows row 8's last
        // line as $D021: multicolour first (a hires bitmap for a few cycles
        // drew it black from screen RAM on NTSC), then bitmap mode (still
        // reading a blank row), then the bitmap's own screen and base
        lda #$18                // multicolour, 38 columns
        sta $d016
        lda #$3b                // bitmap on, 25 rows, YSCROLL 3
        sta $d011
        lda #$18                // screen $C400, bitmap $E000
        sta $d018
        jmp road_code

// line 251: text on for the top of the next frame, the frame counted
kernel_exit:
        lda #$1b
        sta $d011
        lda #$02                // screen $C000, characters $C800
        sta $d018
        lda #$08
        sta $d016
        lda #14
        sta $d021               // the sky
        inc frames
        bne !+
        inc frames + 1
!:      lda pos
        sta pos_band
        lda #120
        sta $d012
        lda #$01
        sta $d019
        pla
        tay
        pla
        tax
        pla
        rti
frames: .word 0
pos_band: .byte 0
far_col: .byte 5

.macro PageSafe() {
    .var a = *
    .if (((a + 2) >> 8) != ((a + 6) >> 8)) {
        .fill 256 - ((a + 2) & 255), $ea
    }
}
.function nextNormal(j) { .return isBad(TOP + j + 1) ? j + 2 : j + 1 }
road_code:
    .for (var j = 0; j < LINES; j++) {
        .var line = TOP + j
        PageSafe()
        .if (isBad(line)) {
            lda #line
!:          cmp $d012
            bne !-
        } else {
            lda #line
!:          cmp $d012
            bne !-
            stx $d021
            lda #<(zOf(TOP + nextNormal(j) - H) - 1)
            adc pos_band
            and #$40
            tay
            ldx band_col, y
        }
    }
        PageSafe()
        lda #TOP + LINES
!:      cmp $d012
        bne !-
        jmp kernel_exit

.align $100
band_col:   .byte 13
            .fill $3f, 0
            .byte 5

// ---- tables -------------------------------------------------------------------
.const WK = 0.84
.function wOf(d) { .return round(WK * d) }
z_lo:       .fill 128, <zOf(i)
w_of_d:     .fill 128, min(127, wOf(i))
k_of_d:     .fill 128, max(1, min(8, round(wOf(i) * 0.08)))
s_of_d:     .fill 128, wOf(i) < 16 ? 0 : (wOf(i) < 40 ? 1 : (wOf(i) < 72 ? 2 : 3))
s_half:     .fill 128, floor((wOf(i) < 16 ? 0 : (wOf(i) < 40 ? 1 : (wOf(i) < 72 ? 2 : 3))) / 2)
// the bitmap byte of road line l, column 0
bm_lo:      .fill LINES, <(BITMAP + (9 + floor(i / 8)) * 320 + (i & 7))
bm_hi:      .fill LINES, >(BITMAP + (9 + floor(i / 8)) * 320 + (i & 7))
sc_lo:      .fill LINES, <(SC + i * 40 * SLOT)
sc_hi:      .fill LINES, >(SC + i * 40 * SLOT)
ol_lo:      .fill LINES, <(ol_c + i * 16)
ol_hi:      .fill LINES, >(ol_c + i * 16)
ol_n:       .fill LINES, 0
// the sway (dp, the bottom line's centre) and the bend (1/256 dp a line per line)
sway:       .fill 256, round(80 + 30 * sin(toRadians(i * 360 / 128)))
curve:      .fill 256, round(5 * sin(toRadians(i * 360 / 256 + 90))) & $ff
ol_c:       .fill LINES * 16, 0
le_k:       .fill LINES * 7, $ff    // per line: its kerb colour, then its six edges, last time
.assert "code below the speedcode", * <= SC, true
```

## Build

```bash
java -jar KickAss.jar speedcode-road.asm -o speedcode-road.prg
```

The build is `$0810-$2CC0` (`-showmem`: code, the kernel's 128 blocks
and the tables); the speedcode is written at start-up into
`$4000-$A400`, 25,601 bytes (128 lines × 200 + an `RTS`).

## Expected output

A still after about 1.3 s: blue sky over rows 0-8, then a road that
bends right into the distance from the bottom-left, red and white kerbs,
a white centre line, grass bands. The PNGs are
`screenshots/speedcode-road.png` (PAL) and
`screenshots/speedcode-road-ntsc.png`, pinned at 45,000,000 cycles; the
picture at 50,000,000 cycles is the same pixel for pixel on both models.

The figures, read from `$0340` after `$02FF` = 1 (VICE x64sc 3.10, PAL
`-default` and `-model ntsc`, measured):

| Figure | PAL | NTSC |
|---|---|---|
| Patching a picture, mean of 64, interrupts off | 194,037 | 196,130 |
| Patching, the largest of the 64 | 282,420 | 285,947 |
| Running the speedcode (128 lines × 40 bytes), mean | 37,634 | 38,017 |
| Running it, the largest | 37,859 | 38,461 |
| Live: pictures in 775 frames, interrupts on, sprites 0-3 over the road | 35 | 22 |
| Frames a picture | 22.1 | 35.2 |

The cycle figures move by a few cycles from one run to the next (where
the badlines and the sprites' fetches fall against the timed code);
these are one run's.

On each road line of the PAL still the left edge (the first pixel that is
not grass, colour 5 or 13) moves at most 6 pixels from the line above,
none 8 or more; the same on NTSC (measured from the PNGs).

## Why this works

**The run.** A slot is five bytes, so a line is 200 bytes and a line's
slot for column c is at 5c: a patch is a store through a pointer to the
line with `Y = 5c`. `BIT $00` is two bytes and three cycles and leaves A
alone, so a run of slots stores the same byte along the line; `LDA #v`
is two bytes and two cycles. A byte that holds an edge gets `LDA` with
the mixed value (the pixels left of the edge in the old colour, the
rest in the new: two mask tables), and the byte after it `LDA` with the
new colour. Every line's first slot always loads. Measured, the run is
37,634 cycles on PAL: 128 × 40 stores of seven cycles is 35,840, the
rest the badlines and the four sprites' DMA over it.

**The patch is the cost.** Each line has six edges. For each, the code
finds the byte (`edge / 4`), builds the mixed value, and notes two slots;
then the line's old slots go back to `BIT` and the new ones become
`LDA`, or, when the columns are the same as last time, only the values
are written. A line whose six edges and kerb colour are unchanged is
skipped. With the road bending and swaying every picture, every line
changes, and this listing takes about 1,600 cycles a road line, 194,037 a
picture. The floor for this kind of patcher is lower: two slots set and
two cleared per edge, about 12 cycles each through the pointer, is 290
cycles a line for the stores and about 200 for the edges (arithmetic
from the instruction table), about 63,000 a picture. With the run that
is about 100,000 cycles a picture, five frames of a PAL frame's 19,656
before anything else runs.

**Against the character road.** The racing starter draws the same road
in multicolour characters: each 8-line row has one set of edge
characters drawn line by line from ramp tables, and the band colours
(grass `$D021`, kerb `$D023`) are registers written per line. Its road
costs about 60,000 cycles a picture at speed (the starter's PROF build,
race frames only, VICE x64sc), double-buffered, with the kerb bands
moving every frame. The work per row of eight lines is what the bitmap
does per line. A bitmap has one register colour per line (`$D021`); the
kerb's red and white come from screen RAM and colour RAM per 8 × 8
cell, so they go into the bitmap and move only with the picture. Two
bitmaps would need two sets of speedcode (their `STA` addresses differ),
51,200 bytes, so the picture is drawn over the one on show: a run of
37,634 cycles lasts longer than the 128 lines it draws, and the beam
passes it.

**Memory.** The speedcode is 25,601 bytes and the bitmap 8,000
(`$E000-$FF3F`; its colour screen is `$C400`). With the kernel, the
patch lists and the tables (`$0810-$2CC0`), the road takes about 43,000
bytes. Nicol's road is reported to have used about 40 KB
(gamesthatwerent, below).

## What it does not establish

**A faster patcher.** The 63,000-cycle floor above is arithmetic, not a
build. It would still leave the method behind the character road for a
road with kerbs and a centre line: six edges a line, 128 lines.

**When it wins.** A road with two edges a line (no kerbs, no centre
line), or fewer lines, or edges that move less often than the picture,
patches less. Not measured here.

**Tearing.** The still is drawn once and holds. While the road moves,
the picture is drawn into the bitmap on show; this listing does not
chase the beam, and the moving frames tear. Not measured.

## Sources

- Simon Nicol's car game, "the best road system anyone had seen on the
  C64": https://www.gamesthatwerent.com/gtw64/car-game-2/ (the method
  and the 40 KB, as reported there; not measured here).
- Louis Gorenfeld, "Lou's Pseudo 3d Page":
  https://www.extentofthejam.com/pseudo/ (road geometry per line).
- C64 Lotus Esprit Turbo Challenge drew its road in characters, with
  expanded sprites over the red and white kerbs that the release dropped:
  https://www.gamesthatwerent.com/2015/11/lotus-esprit-turbo-challenge-early-proto/.
