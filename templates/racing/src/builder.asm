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

pad_nb:     .fill 8, 0          // BVC operand by sprite set: N blocks (rb_init)
pad_fb:     .fill 8, 0          // F blocks
pad_lb:     .fill 8, 0          // L blocks
pad_bb:     .fill 8, 0          // B blocks (the badline)
lost_set:   .fill 8, lostSet(i) // CPU cycles sprites 0-2 take, by the set on a line
back_code:  .word 0             // the back copy's first block
back_scr:   .word 0             // the back screen's row 7, less one (Y = column + 1)
buf12:      .byte 0             // the back screen's index into rs_*: 0 or 12
spr_first:  .fill 3, $c0        // each sprite's first fetch line (index), back set; $C0 off
row_spr:    .fill 12, 0         // the same per row (any line of it)
back_idx:   .byte 0             // the back copy: 0 A, 1 B
back_pre:   .byte 0             // back_idx * 10: its entry block (PreBlock) from pre_a
bprev:      .byte 0             // the band byte of the line above the row
bnd:        .fill 8, 0          // the row's band bytes, z * 8 + position
kbuf:       .fill 24, 0         // a template decoded, from the centre outward
rowbuf:     .fill 128, 0        // a row, column x at 64 + x - c (grass either side)
zmid:       .byte 0
pmid:       .byte 0
cb_lo:      .byte 0             // the row's bottom and top centres, pixels
cb_hi:      .byte 0
ct_lo:      .byte 0
ct_hi:      .byte 0

// What each screen was last drawn from per row: [screen * 12 + row]: the
// template's address and the centre column. A high byte of 0 is no template.
rs_tlo:     .fill 24, 0
rs_thi:     .fill 24, 0
rs_c:       .fill 24, 0
rs_spr:     .fill 24, $ff       // sprites the row's pads were last written for ($FF: never)

// Slide cycles = remaining bytes R + 1 (R >= 1). For each kind of block,
// slide = LINE - its cycles - lost (a badline also - BADLOSS), and the
// operand skips its SLIDE - R bytes of the slide. By the set of sprites on
// the line (lost_set).
.macro PadFor(table, cyc, slide) {
        lda rb_model
        beq !pal+
        lda #65 - cyc - 1
        bne !have+
!pal:   lda #63 - cyc - 1
!have:  sec
        sbc lost_set, x         // R
        sta zp_t1
        lda #slide
        sec
        sbc zp_t1
        sta table, x
}
rb_init:
        ldx #7
!:      PadFor(pad_nb, NB_CYC, NB_SLIDE)
        PadFor(pad_fb, FB_CYC, FB_SLIDE)
        PadFor(pad_lb, LB_CYC, LB_SLIDE)
        PadFor(pad_bb, BB_CYC + BADLOSS, BB_SLIDE)
        dex
        bmi !+
        jmp !-
!:      rts

rb_begin:
        lda rb_hoff             // the glyphs exist for even offsets only
        and #$fe
        sta rb_hoff
        asl                     // the row templates for this offset: tpl_lo + hoff * 12
        asl
        sta zp_t0               // hoff * 4 (at most 88)
        asl                     // hoff * 8 (at most 176)
        clc
        adc zp_t0
        sta zp_t0               // hoff * 12, low byte
        lda #0
        rol
        sta zp_t1
        lda #<tpl_lo
        clc
        adc zp_t0
        sta tpl_ldlo + 1
        lda #>tpl_lo
        adc zp_t1
        sta tpl_ldlo + 2
        lda #<tpl_hi
        clc
        adc zp_t0
        sta tpl_ldhi + 1
        lda #>tpl_hi
        adc zp_t1
        sta tpl_ldhi + 2
        lda rb_front
        eor #1
        tax
        stx back_idx
        txa
        asl
        sta back_pre
        asl
        asl
        clc
        adc back_pre
        sta back_pre            // 10 per copy: PreBlock's size
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
        sta zp_c
        tya
        clc
        adc #20
        lsr
        lsr
        lsr
        sta zp_p
        ldy zp_c
!:      lda row_spr, y
        ora zp_t1
        sta row_spr, y
        iny
        cpy zp_p
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
        lda rs_thi, x           // (0: this screen's row never drawn)
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
        sta zp_code2 + 1
        inc zp_code2 + 1
        lda #0
        sta zp_code
        sta zp_code2

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
        stx zp_t4               // (k + 8, kept a moment)
        Pix(zp_cx, zp_cx + 1)
        sta cb_lo
        sty cb_hi
        Pix(zp_t2, zp_t3)
        sta ct_lo
        sty ct_hi
        ldx zp_t4
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

        // ---- content centre, phase, column; the row's eight $D016 bytes ----
        // The content centre is the lesser of the bottom and top centres on a
        // 4-pixel boundary; each line's XSCROLL is its centre less that.
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
        and #$fc
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
        and #$fc
        sta zp_cref
        lda cb_hi
        sta zp_cref + 1
        lda cb_lo
!dset:  and #3                  // pattern4 + (d + 32) * 32 + bit * 8
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
    .for (var n = 0; n < 5; n++) {
        asl
        rol zp_ramp + 1
    }
        clc
        adc zp_t1
        bcc !+
        inc zp_ramp + 1
!:      clc
        adc #<pattern4
        sta zp_ramp
        lda zp_ramp + 1
        adc #>pattern4
        sta zp_ramp + 1
        lda zp_R                // the row's content centre, for C and the checks
        asl
        tax
        lda zp_cref
        sta row_cref, x
        lda zp_cref + 1
        sta row_cref + 1, x
        // phase = bit 2 of cref; column = cref >> 3, clamped: off -24..63 the
        // row is all grass (its road is wholly off the window)
        lda zp_cref
        lsr
        lsr
        and #1
        sta zp_p
        lda zp_cref             // cref >> 3, signed: t0 the low byte, A the high
        sta zp_t0
        lda zp_cref + 1
    .for (var n = 0; n < 3; n++) {
        cmp #$80
        ror
        ror zp_t0
    }
        ldx zp_t0
        stx zp_c
        cmp #0                  // in range: 0-63, or $FFE8-$FFFF (-24 to -1)
        bne !cneg+
        cpx #64
        bcc !con+
        bcs !coff+
!cneg:  cmp #$ff
        bne !coff+
        cpx #$e8
        bcs !con+
!coff:  lda #0
        sta zp_c
        lda #<tpl_data          // the blank template
        sta zp_src
        lda #>tpl_data
        sta zp_src + 1
        jmp !pat+
!con:
        lda zp_R
        asl
        ora zp_p
        tay
tpl_ldlo: lda tpl_lo, y         // patched by rb_begin: tpl_lo + hoff * 12
        sta zp_src
tpl_ldhi: lda tpl_hi, y
        sta zp_src + 1
!pat:
        // line 0 (B): its $D016 into the loads above it, the L block of the
        // row above, or the copy's entry for row 0
        ldy #0
        lda (zp_ramp), y
        ldx zp_R
        bne !up+
        ldx back_pre
        sta pre_a + 1, x
        jmp !l1+
!up:    dec zp_code + 1
        ldy #$c0 + OFF_NA
        sta (zp_code), y
        inc zp_code + 1
!l1:
        // the row's band bytes, z * 8 + position, lines 8R - 1 (bprev) to 8R + 7
        lda zp_R
        asl
        asl
        asl
        tay
        dey
        lda (zp_zl), y          // (row 0: y = $FF, a byte past the table's start: replaced below)
        clc
        adc rb_pos
        sta bprev
    .for (var j = 0; j < 8; j++) {
        iny
        lda (zp_zl), y
        clc
        adc rb_pos
        sta bnd + j
    }
        lda zp_R
        bne !+
        lda bnd + 2             // row 0: line 109 is the first to store a band
        sta bprev
        tax
        ldy back_idx
        lda road_col, x         // irq_blank sets $D022 and $D023 for the top
        sta top_road, y
        lda kerb_col, x
        sta top_kerb, y
!:
        // line 1 (F): its own $D016 and grass
        ldy #1
        lda (zp_ramp), y
        ldy #64 + OFF_FD
        sta (zp_code), y
        ldy #1
        lda (zp_ztrow), y
        beq !sky+
        ldx bnd + 1
        lda grass_col, x
        .byte $2c
!sky:   lda #C_SKY
        ldy #64 + OFF_FC
        sta (zp_code), y
    .for (var j = 2; j < 8; j++) {
        // line j (N or L): $D016 (A), grass (X) and a road band or kerb
        // colour (Y) into block j - 1's loads; which of the two into block
        // j's STY. The road band wins when it changed since the last line
        // that stored one (line j - 1; for line 2, the row above's line 7).
        .var zpa = (j - 1) < 4 ? zp_code : zp_code2
        .var zpb = j < 4 ? zp_code : zp_code2
        .var offA = (j - 1) == 1 ? OFF_FA : OFF_NA
        .var offX = (j - 1) == 1 ? OFF_FX : OFF_NX
        .var offY = (j - 1) == 1 ? OFF_FY : OFF_NY
        ldy #j
        lda (zp_ramp), y
        ldy #((j - 1) & 3) * 64 + offA
        sta (zpa), y
        ldy #j
        lda (zp_ztrow), y
        beq !sky+
        ldx bnd + j
        lda grass_col, x
        .byte $2c               // BIT abs: skips the LDA #
!sky:   lda #C_SKY
        ldy #((j - 1) & 3) * 64 + offX
        sta (zpa), y
        ldx bnd + j
        lda bnd + j
        eor (j == 2) ? bprev : bnd + j - 1
        bmi !road+
        lda kerb_col, x
        ldx #$23
        bne !put+
!road:  lda road_col, x
        ldx #$22
!put:   ldy #((j - 1) & 3) * 64 + offY
        sta (zpa), y
        txa
        ldy #(j & 3) * 64 + OFF_STY
        sta (zpb), y
    }

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
      } else .if (j == 1) {
        lda pad_fb, y
        ldy #64 + FB_OPER
      } else .if (j == 7) {
        lda pad_lb, y
        ldy #(j & 3) * 64 + NB_OPER
      } else {
        lda pad_nb, y
        ldy #(j & 3) * 64 + NB_OPER
      }
      .if (j < 4) { sta (zp_code), y } else { sta (zp_code2), y }
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
// From the row's template (zp_src), phase (zp_p) and centre column (zp_c):
// the template's codes from the centre outward into kbuf, then the left half
// into rowbuf (column x of the row is rowbuf[64 + x - c]) and the right half
// as mirror ids ($80 up), then 40 bytes into the back screen's row. A row
// whose template and column are what this screen last got is kept.
draw_row:
        ldx zp_R
        txa
        clc
        adc buf12
        tay
        lda zp_src
        cmp rs_tlo, y
        bne !draw+
        lda zp_src + 1
        cmp rs_thi, y
        bne !draw+
        lda zp_c
        cmp rs_c, y
        bne !draw+
        rts
!draw:  lda zp_src
        sta rs_tlo, y
        lda zp_src + 1
        sta rs_thi, y
        lda zp_c
        sta rs_c, y
        lda back_scr            // the screen row: back_scr is row 7 less one
        clc
        adc row40_lo, x
        sta zp_scr
        lda back_scr + 1
        adc row40_hi, x
        sta zp_scr + 1
        inc zp_scr
        bne !+
        inc zp_scr + 1
!:
        // decode: n1 codes, L road, n2 codes, grass to 24. Y is stepped
        // before each read, so a branch after the load sees the byte's flags.
        ldx #0
        ldy #$ff
        iny
        lda (zp_src), y
        sta zp_t4
        beq !run+
!:      iny
        lda (zp_src), y
        sta kbuf, x
        inx
        dec zp_t4
        bne !-
!run:   iny
        lda (zp_src), y
        sta zp_t4
        beq !n2+
        lda #CH_ROAD
!:      sta kbuf, x
        inx
        dec zp_t4
        bne !-
!n2:    iny
        lda (zp_src), y
        sta zp_t4
        beq !fill+
!:      iny
        lda (zp_src), y
        sta kbuf, x
        inx
        dec zp_t4
        bne !-
!fill:  lda #CH_GRASS
!:      cpx #24
        bcs !emit+
        sta kbuf, x
        inx
        bne !-
        // emit: phase 0, left k = 1-23 at 63 down, right at 64 up; phase 1,
        // k = 0 (its own mirror) at 64, then left at 63 down, right at 65 up
!emit:  ldx #0
        ldy #64
        lda zp_p
        beq !+
        lda kbuf
        sta rowbuf + 64
        inx
        iny
!:      sty zp_t4               // the right half's first index
        txa
        pha
        ldy #63
!:      lda kbuf, x
        sta rowbuf, y
        inx
        dey
        cpy #40
        bcs !-
        pla
        tax
        ldy zp_t4
!:      lda kbuf, x
        eor #$80
        sta rowbuf, y
        inx
        iny
        cpy #88
        bcc !-
        // copy: screen[x] = rowbuf[64 - c + x]
        lda #64
        sec
        sbc zp_c
        clc
        adc #<rowbuf
        sta zp_src
        lda #>rowbuf
        adc #0
        sta zp_src + 1
    .for (var x = 0; x < 40; x++) {
        ldy #x
        lda (zp_src), y
        sta (zp_scr), y
    }
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
// clamped) and the low two bits of the centre the content is drawn around
// (it is drawn on a 4-pixel boundary): for d >= 0 the top line is at bit + 0,
// for d < 0 the bottom line is at bit and the top at bit - d. Line j's offset
// is round(d * j / 7) from the top, clamped to 0-7.
pattern4:
    .for (var d = -32; d <= 32; d++) {
        .for (var b = 0; b < 4; b++) {
            .var a = d >= 0 ? b : b - d
            .fill 8, D016_ROAD | min(max(a + round(d * i / 7), 0), 7)
        }
    }
// The bands from the low byte of position + z * 8: grass and road by bit 7,
// the kerb's stripes by bit 6.
grass_col:  .fill 256, (i & $80) != 0 ? C_GRASS_B : C_GRASS_A
road_col:   .fill 256, (i & $80) != 0 ? C_ROAD_B : C_ROAD_A
kerb_col:   .fill 256, (i & $40) != 0 ? C_KERB_B : C_KERB_A
// z * 8, low byte, per road line for each horizon offset.
zl_lo:      .fill HOFF_N, <(zltab + (i >> 1) * ROAD_LINES)
zl_hi:      .fill HOFF_N, >(zltab + (i >> 1) * ROAD_LINES)
zltab:
    .for (var h = 0; h < HOFF_N; h += 2) {
        .fill ROAD_LINES, (zOf(h, i) * 8) & $ff
    }
