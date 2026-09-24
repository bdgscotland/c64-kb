// builder.asm: the road builder, imported by engine.asm (its constants,
// zero page and tables). C calls rb_init once, then for each picture
// rb_begin and rb_rows (rows from 18 up to rb_stop; C may split the rows
// over frames), then sets rb_ready.
//
// Per row, bottom up: the curve in closed form. The builder keeps the road
// centre cx and its slope dx (10.6 pixels) at the row's bottom line. With
// the curvature k of the segment under the row's middle line, eight lines
// up the slope grows by 8k and the centre moves 8dx + 36k; the row's top
// line is at 7dx + 28k (the per-line rule dx += k, cx += dx, summed). Inside
// the row each line's centre is on the chord from bottom to top: the curve
// is at most k * 6 / 64 of a pixel off it (arithmetic, k <= 4: under half
// a pixel). The row's characters are drawn around a content centre, the
// lesser of the top and bottom centres made even; a line's XSCROLL is its
// centre minus that, 0-7 (clamped when a row's centre moves 8 or more).
//
// Per line (unrolled over a row's eight): the $D016 byte, the $D021 byte
// (sky above the horizon, else the grass band from bit 7 of position + z *
// 8) and the pad for the sprites on the line, into the back copy's block.
// The row's characters change only where the kerbs or the dash moved: each
// screen keeps what it shows per row (rs_* below) and draw_row rewrites the
// columns between the old and the new kerbs.

.const zp_ztrow = $f9           // 2: z table from the row's top line
.const zp_ramp  = $fb           // 2: this row's eight $D016 bytes (pattern)
.const zp_R     = $ea           // row index 0-11
.const zp_zl    = $d0           // 2: this frame's z * 8 low bytes (per horizon offset)
.const zp_zlrow = $d2           // 2: the same from the row's top line

pad_nb:     .fill 8, 0          // BVC operand by sprite set, normal line (rb_init)
pad_bb:     .fill 8, 0          // the same for a badline
lost_set:   .fill 8, lostSet(i) // CPU cycles sprites 0-2 take, by the set on a line
back_code:  .word 0             // the back copy's first block
back_scr:   .word 0             // the back screen's row 7, less one (Y = column + 1)
buf12:      .byte 0             // the back screen's index into rs_*: 0 or 12
spr_first:  .fill 3, $c0        // each sprite's first fetch line (index), back set; $C0 off
row_spr:    .fill 12, 0         // the same per row (any line of it)
row_blank:  .byte 0
zmid:       .byte 0
pmid:       .byte 0
cb_lo:      .byte 0             // the row's bottom and top centres, pixels
cb_hi:      .byte 0
ct_lo:      .byte 0
ct_hi:      .byte 0

// What each screen shows per row: [screen * 12 + row]. Columns are stored
// plus one (0: off the window's left, 41: off its right).
rs_blank:   .fill 24, 1         // both screens start with grass on rows 7-18
rs_cl:      .fill 24, 0
rs_cr:      .fill 24, 0
rs_cd:      .fill 24, $ff
rs_spr:     .fill 24, $ff       // sprites the row's pads were last written for ($FF: never)
zp_lc:      .byte 0             // the new row's left and right kerb characters
zp_rc:      .byte 0

// Slide cycles = remaining bytes R + 1 (R >= 1). A normal line: slide =
// LINE - NB_CYC - lost; a badline: slide = LINE - BB_CYC - BADLOSS - lost.
// The operand skips NB_SLIDE - R (BB_SLIDE - R) bytes of the slide.
rb_init:
        ldx #7
!:      lda rb_model
        beq !pal+
        lda #65 - NB_CYC - 1
        bne !have+
!pal:   lda #63 - NB_CYC - 1
!have:  sec
        sbc lost_set, x         // R
        sta zp_t1
        lda #NB_SLIDE
        sec
        sbc zp_t1
        sta pad_nb, x
        lda rb_model
        beq !pal+
        lda #65 - BB_CYC - BADLOSS - 1
        bne !have+
!pal:   lda #63 - BB_CYC - BADLOSS - 1
!have:  sec
        sbc lost_set, x
        sta zp_t1
        lda #BB_SLIDE
        sec
        sbc zp_t1
        sta pad_bb, x
        dex
        bpl !-
        rts

rb_begin:
        lda rb_front
        eor #1
        tax
        lda road_lo, x
        sta back_code
        lda road_hi, x
        sta back_code + 1
        lda scr_row7_lo, x
        sta back_scr
        lda scr_row7_hi, x
        sta back_scr + 1
        lda set12, x
        sta buf12
        ldy rb_hoff
        lda zt_lo, y
        sta zp_zt
        lda zt_hi, y
        sta zp_zt + 1
        lda zl_lo, y
        sta zp_zl
        lda zl_hi, y
        sta zp_zl + 1
        lda rb_cx0
        sta zp_cx
        lda rb_cx0 + 1
        sta zp_cx + 1
        lda rb_dx0
        sta zp_dx
        lda rb_dx0 + 1
        sta zp_dx + 1
        // the sprites' first lines (index 0-95; $C0 when off) and their rows
        lda #0
        ldy #11
!:      sta row_spr, y
        dey
        bpl !-
        lda set3, x
        sta zp_t2               // set * 3
        lda spr_en, x
        sta zp_t3               // enable bits
        ldx #0                  // sprite s
!spr:   lda #$c0
        sta spr_first, x
        lsr zp_t3
        bcc !next+
        txa
        clc
        adc zp_t2
        tay
        lda spr_y, y            // fetches on lines Y to Y + 20; C keeps Y in 107-182
        sec
        sbc #ROAD_TOP
        sta spr_first, x
        tay
        lda bit_of, x
        sta zp_t1
        tya                     // rows (Y >> 3) to ((Y + 20) >> 3)
        lsr
        lsr
        lsr
        sta zp_cl
        tya
        clc
        adc #20
        lsr
        lsr
        lsr
        sta zp_cr
        ldy zp_cl
!:      lda row_spr, y
        ora zp_t1
        sta row_spr, y
        iny
        cpy zp_cr
        bcc !-
        beq !-
!next:  inx
        cpx #3
        bne !spr-
        lda #18
        sta zp_row
        rts

bit_of:     .byte 1, 2, 4
set12:      .byte 0, 12
scr_row7_lo: .byte <(SCREEN_A + 7 * 40 - 1), <(SCREEN_B + 7 * 40 - 1)
scr_row7_hi: .byte >(SCREEN_A + 7 * 40 - 1), >(SCREEN_B + 7 * 40 - 1)

// cx >> 6 of a 16-bit 10.6 value in (lo, hi) to A (low byte) and Y (high).
.macro Pix(lo, hi) {
        ldy hi
        lda sh6_lo_hi, y
        ldx lo
        ora sh6_lo_lo, x
        pha
        lda sh6_hi, y
        tay
        pla
}

rb_rows:
!row:   lda zp_row
        cmp rb_stop
        bcs !go+
        rts
!go:
#if ROWTIME
        lda #0                  // (debug) will this row draw every column?
        sta row_full
        lda zp_row
        sec
        sbc #7
        tax
        asl
        asl
        asl
        tay
        lda (zp_zt), y
        beq !+
        txa
        clc
        adc buf12
        tax
        lda rs_blank, x
        sta row_full
!:
#endif
#if ROWTIME
        sei                     // (debug: a row's cycles with no IRQ in them)
        lda #0
        sta $dc0e
        lda #$ff
        sta $dc04
        sta $dc05
        lda #$11
        sta $dc0e
#endif
        lda zp_row
        sec
        sbc #7
        sta zp_R
        asl
        asl
        asl                     // i0, the row's top line
        sta zp_t0
        clc
        adc zp_zt
        sta zp_ztrow
        lda zp_zt + 1
        adc #0
        sta zp_ztrow + 1
        lda zp_t0
        clc
        adc zp_zl
        sta zp_zlrow
        lda zp_zl + 1
        adc #0
        sta zp_zlrow + 1
        lda zp_R                // the row's blocks: two pages from back_code
        asl
        clc
        adc back_code + 1
        sta zp_code + 1
        lda #0
        sta zp_code

        // ---- the curvature under the middle line, its dash phase ----
        ldy #4
        lda (zp_ztrow), y
        sta zmid
        beq !flat+
        tax
        lda m8lo, x
        clc
        adc rb_pos
        sta pmid
        lda m8hi, x
        adc rb_pos + 1
        and #63
        tax
        lda curv_lo, x
        jmp !have+
!flat:  lda #0
!have:  clc
        adc #8
        tax                     // k + 8

        // ---- the row's bottom and top centres; the next row's cx, dx ----
        lda zp_dx               // t0:t1 = 8 dx
        asl
        sta zp_t0
        lda zp_dx + 1
        rol
        sta zp_t1
        asl zp_t0
        rol zp_t1
        asl zp_t0
        rol zp_t1
        lda zp_cx               // t2:t3 = cx + 8dx - dx + 28k: the top line
        clc
        adc zp_t0
        sta zp_t2
        lda zp_cx + 1
        adc zp_t1
        sta zp_t3
        lda zp_t2
        sec
        sbc zp_dx
        sta zp_t2
        lda zp_t3
        sbc zp_dx + 1
        sta zp_t3
        lda zp_t2
        clc
        adc k28lo, x
        sta zp_t2
        lda zp_t3
        adc k28hi, x
        sta zp_t3
        stx zp_cl               // (k + 8, kept a moment)
        Pix(zp_cx, zp_cx + 1)
        sta cb_lo
        sty cb_hi
        Pix(zp_t2, zp_t3)
        sta ct_lo
        sty ct_hi
        ldx zp_cl
        lda zp_cx               // cx += 8dx + 36k, dx += 8k
        clc
        adc zp_t0
        sta zp_cx
        lda zp_cx + 1
        adc zp_t1
        sta zp_cx + 1
        lda zp_cx
        clc
        adc k36lo, x
        sta zp_cx
        lda zp_cx + 1
        adc k36hi, x
        sta zp_cx + 1
        lda zp_dx
        clc
        adc k8lo, x
        sta zp_dx
        lda zp_dx + 1
        adc k8hi, x
        sta zp_dx + 1

        // ---- content centre and the row's eight $D016 bytes ----
        ldy #0
        lda (zp_ztrow), y
        bne !road+
        lda #1                  // top line on or above the horizon: no road drawn,
        sta row_blank           // XSCROLL 0 on every line
        lda #<(pattern + 32 * 16)
        sta zp_ramp
        lda #>(pattern + 32 * 16)
        sta zp_ramp + 1
        jmp !pat+
!road:  lda #0
        sta row_blank
        lda cb_lo               // d = bottom - top, clamped to -32..32
        sec
        sbc ct_lo
        sta zp_t0
        lda cb_hi
        sbc ct_hi
        bmi !neg+
        bne !big+
        lda zp_t0
        cmp #33
        bcc !dpos+
!big:   lda #32
        sta zp_t0
!dpos:  lda ct_lo               // bottom right of top: content centre from the top
        and #$fe
        sta zp_cref
        lda ct_hi
        sta zp_cref + 1
        lda ct_lo
        jmp !dset+
!neg:   cmp #$ff
        bne !small+
        lda zp_t0
        cmp #$e0                // >= -32
        bcs !dneg+
!small: lda #$e0
        sta zp_t0
!dneg:  lda cb_lo               // bottom left of top: content centre from the bottom
        and #$fe
        sta zp_cref
        lda cb_hi
        sta zp_cref + 1
        lda cb_lo
!dset:  and #1                  // pattern (d + 32) * 16 + bit * 8
        asl
        asl
        asl
        sta zp_t1
        lda zp_t0
        clc
        adc #32
        sta zp_t2
        lda #0
        sta zp_ramp + 1
        lda zp_t2
        asl
        rol zp_ramp + 1
        asl
        rol zp_ramp + 1
        asl
        rol zp_ramp + 1
        asl
        rol zp_ramp + 1
        clc
        adc zp_t1
        bcc !+
        inc zp_ramp + 1
!:      clc
        adc #<pattern
        sta zp_ramp
        lda zp_ramp + 1
        adc #>pattern
        sta zp_ramp + 1
        lda zp_R                // the row's content centre, for C and the checks
        asl
        tax
        lda zp_cref
        sta row_cref, x
        lda zp_cref + 1
        sta row_cref + 1, x
!pat:
    .for (var j = 0; j < 8; j++) {
        ldy #j
        lda (zp_ramp), y
        ldy #(j & 3) * 64 + OFF_D016
        .if (j == 4) { inc zp_code + 1 }
        sta (zp_code), y
    }
        dec zp_code + 1

        // ---- the colours: a road row has no sky line ----
        lda row_blank
        bne !mixed+
    .for (var j = 1; j < 8; j++) {
        ldy #j
        lda (zp_zlrow), y
        clc
        adc rb_pos
        tax
        lda coltab, x
        ldy #(j & 3) * 64 + OFF_COL
        .if (j == 4) { inc zp_code + 1 }
        sta (zp_code), y
    }
        jmp !cols+
!mixed:
    .for (var j = 1; j < 8; j++) {
        ldy #j
        lda (zp_ztrow), y
        beq !sky+
        lda (zp_zlrow), y
        clc
        adc rb_pos
        tax
        lda coltab, x
        .byte $2c               // BIT abs: skips the LDA #
!sky:   lda #C_SKY
        ldy #(j & 3) * 64 + OFF_COL
        .if (j == 4) { inc zp_code + 1 }
        sta (zp_code), y
    }
!cols:  dec zp_code + 1

        // ---- the pads, when this row's sprites or this copy's last ones ask ----
        lda zp_R
        tax
        clc
        adc buf12
        tay
        lda row_spr, x
        ora rs_spr, y
        beq !nopad+
        lda row_spr, x
        sta rs_spr, y
        txa
        asl
        asl
        asl
        tax                     // the row's top line index
    .for (var j = 0; j < 8; j++) {
        jsr line_mask
        tay
      .if (j == 0) {
        lda pad_bb, y
        ldy #BB_OPER
      } else {
        lda pad_nb, y
        ldy #(j & 3) * 64 + NB_OPER
      }
        .if (j == 4) { inc zp_code + 1 }
        sta (zp_code), y
        inx
    }
!nopad:
        jsr draw_row
#if ROWTIME
        lda #0
        sta $dc0e
        lda #$ff                // cycles = $FFFF - timer; keep the largest
        sec
        sbc $dc04
        tax
        lda #$ff
        sbc $dc05
        ldy row_full
        beq !+
        ldy #2
!:      stx zp_t0
        cmp row_max + 1, y
        bcc !keep+
        bne !new+
        lda zp_t0
        cmp row_max, y
        bcc !keep+
        lda row_max + 1, y      // (equal high bytes)
!new:   sta row_max + 1, y
        lda zp_t0
        sta row_max, y
!keep:  cli
#endif
        dec zp_row
        jmp !row-
row_max:    .word 0, 0          // (ROWTIME) the costliest row, and the costliest full one
row_full:   .byte 0             // (ROWTIME) this row draws every column

// line_mask: which of sprites 0-2 fetch on road line X (index 0-95), in A.
// X is kept.
line_mask:
        ldy #0
        txa
        sec
        sbc spr_first
        cmp #21
        bcs !+
        iny                     // bit 0
!:      txa
        sec
        sbc spr_first + 1
        cmp #21
        bcs !+
        iny                     // bit 1
        iny
!:      txa
        sec
        sbc spr_first + 2
        cmp #21
        bcs !+
        tya
        ora #4
        tay
!:      tya
        rts

// ---- the row's characters ----------------------------------------------------------------
draw_row:
        ldx zp_R
        lda back_scr
        clc
        adc row40_lo, x
        sta zp_scr
        lda back_scr + 1
        adc row40_hi, x
        sta zp_scr + 1
        lda row_blank
        beq !road+
        lda #0
        sta row_w, x
        txa
        clc
        adc buf12
        tax
        lda rs_blank, x
        bne !done+              // blank already
        lda #1
        sta rs_blank, x
        lda #CH_GRASS
        ldy #40
!:      sta (zp_scr), y
        dey
        bne !-
!done:  rts

!road:  ldy zmid                // half-width from the middle line's z
        lda w_of_z, y
        sta row_w, x
        sta zp_t0
        lda zp_cref             // xl = cref - w, xr = cref + w
        sec
        sbc zp_t0
        sta zp_xl
        lda zp_cref + 1
        sbc #0
        sta zp_xl + 1
        lda zp_cref
        clc
        adc zp_t0
        sta zp_xr
        lda zp_cref + 1
        adc #0
        sta zp_xr + 1
        lda zp_xl
        ldy zp_xl + 1
        jsr col_of
        sta zp_cl
        lda zp_xr
        ldy zp_xr + 1
        jsr col_of
        sta zp_cr
        lda #$ff
        sta zp_cd
        lda pmid                // the dash on alternate stretches: bit 6 of p
        and #$40
        bne !+
        lda zp_cref
        ldy zp_cref + 1
        jsr col_of
        sta zp_cd
!:      lda zp_xl
        and #7
        lsr
        clc
        adc #CH_LEFT
        sta zp_lc
        lda zp_xr
        and #7
        lsr
        clc
        adc #CH_RIGHT
        sta zp_rc

        lda zp_R
        clc
        adc buf12
        tax                     // this screen's record of the row
        lda rs_blank, x
        beq !incr+
        lda #1                  // the row was blank: every column
        sta zp_t1
        lda #40
        sta zp_t2
        jsr runs
        jmp !save+

!incr:  lda rs_cl, x            // the left kerb's old and new columns, and between
        ldy zp_cl
        jsr span
        lda rs_cr, x            // the right kerb's
        ldy zp_cr
        jsr span
        lda rs_cd, x            // the old dash and the new
        tay
        jsr span
        lda zp_cd
        tay
        jsr span
!save:  lda #0
        sta rs_blank, x
        lda zp_cl
        sta rs_cl, x
        lda zp_cr
        sta rs_cr, x
        lda zp_cd
        sta rs_cd, x
        rts

// span: columns min(A, Y) to max(A, Y) (plus one), inside 1-40, redrawn.
// X is kept.
span:   sty zp_t1
        cmp zp_t1
        bcs !+                  // A >= Y: from Y to A
        sta zp_t1               // from A to Y
        tya
!:      cmp #41                 // the end, at most 40
        bcc !+
        lda #40
!:      sta zp_t2
        lda zp_t1               // the start, at least 1
        bne !+
        lda #1
        sta zp_t1
!:      cmp zp_t2
        beq runs
        bcc runs
        rts

// runs: columns zp_t1 to zp_t2 (plus one, 1-40) as the new row shows them,
// as runs: grass, the left kerb, road, the right kerb, grass; then the dash.
// X is kept.
runs:   ldy zp_t1
        inc zp_t2               // the end, exclusive
        lda zp_cl               // grass up to the left kerb
        cmp zp_t2
        bcc !+
        lda zp_t2
!:      sta zp_t3
        lda #CH_GRASS
!:      cpy zp_t3
        bcs !+
        sta (zp_scr), y
        iny
        bne !-
!:      cpy zp_t2
        bcs !dash+
        cpy zp_cl
        bne !+
        lda zp_lc               // the left kerb
        sta (zp_scr), y
        iny
!:      lda zp_cr               // road up to the right kerb
        cmp zp_t2
        bcc !+
        lda zp_t2
!:      sta zp_t3
        lda #CH_ROAD
!:      cpy zp_t3
        bcs !+
        sta (zp_scr), y
        iny
        bne !-
!:      cpy zp_t2
        bcs !dash+
        cpy zp_cr
        bne !+
        lda zp_rc               // the right kerb
        sta (zp_scr), y
        iny
!:      lda #CH_GRASS           // grass to the end
!:      cpy zp_t2
        bcs !dash+
        sta (zp_scr), y
        iny
        bne !-
!dash:  ldy zp_cd               // the dash, strictly between the kerbs, if in range
        cpy zp_t1
        bcc !out+
        cpy zp_t2
        bcs !out+
        cpy zp_cl
        bcc !out+
        beq !out+
        cpy zp_cr
        bcs !out+
        lda #CH_DASH
        sta (zp_scr), y
!out:   rts

// col_of: A = low, Y = high byte of a signed pixel x. Returns x >> 3, plus
// one: 0 when x < 0, 41 when x >= 320.
col_of:
        cpy #$80
        bcs !neg+
        cpy #0
        beq !small+
        cpy #1
        bne !big+
        cmp #64                 // 256 + 64 = 320
        bcs !big+
        lsr
        lsr
        lsr
        clc
        adc #33
        rts
!small: lsr
        lsr
        lsr
        clc
        adc #1
        rts
!big:   lda #41
        rts
!neg:   lda #0
        rts

row40_lo:   .fill 12, <(i * 40)
row40_hi:   .fill 12, >(i * 40)

// k * 8, k * 28, k * 36 for k = -8..7 (index k + 8), 16-bit.
k8lo:       .fill 16, <((i - 8) * 8)
k8hi:       .fill 16, >((i - 8) * 8)
k28lo:      .fill 16, <((i - 8) * 28)
k28hi:      .fill 16, >((i - 8) * 28)
k36lo:      .fill 16, <((i - 8) * 36)
k36hi:      .fill 16, >((i - 8) * 36)

// The eight $D016 bytes of a row, by the chord's d = bottom - top (-32..32,
// clamped) and the low bit of the centre the content is drawn around: for
// d >= 0 the top line is at bit + 0, for d < 0 the bottom line is at bit
// and the top at bit - d. Line j's offset is round(d * j / 7) from the top.
pattern:
    .for (var d = -32; d <= 32; d++) {
        .for (var b = 0; b < 2; b++) {
            .var a = d >= 0 ? b : b - d
            .fill 8, D016_ROAD | min(max(a + round(d * i / 7), 0), 7)
        }
    }
// The grass band from the low byte of position + z * 8: bit 7.
coltab:     .fill 256, (i & $80) != 0 ? C_GRASS_B : C_GRASS_A
// z * 8, low byte, per road line for each horizon offset.
zl_lo:      .fill HOFF_N, <(zltab + i * ROAD_LINES)
zl_hi:      .fill HOFF_N, >(zltab + i * ROAD_LINES)
zltab:
    .for (var h = 0; h < HOFF_N; h++) {
        .fill ROAD_LINES, (zOf(h, i) * 8) & $ff
    }
