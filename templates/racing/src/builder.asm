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

pad_nb:     .fill 8, 0          // BNE operand by sprite set: N blocks (rb_init)
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
back_pre:   .byte 0             // back_idx * PRE_SIZE: its entry block (PreBlock) from pre_a
row_mmax:   .byte 0             // the row's largest whole-column move (0: not sheared)
row_skey:   .byte 0             // (d + 33) * 4 + b when sheared, else 0: part of the row cache
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
rs_sk:      .fill 24, 0         // row_skey it was drawn with
rs_gtlo:    .fill 24, 0         // the template and shear its dynamic glyphs were built for
rs_gthi:    .fill 24, 0         // (0: none)
rs_gsk:     .fill 24, 0
rs_spr:     .fill 24, $ff       // sprites the row's pads were last written for ($FF: never)

// Slide cycles = remaining bytes R + 1 (R >= 1). For each kind of block,
// slide = LINE - its cycles - lost (a badline also - BADLOSS), and the
// operand skips its SLIDE - R bytes of the slide. By the set of sprites on
// the line (lost_set).
.macro PadFor(table, cyc, slide, lost) {
        lda rb_model
        beq !pal+
        lda #65 - cyc - 1
        bne !have+
!pal:   lda #63 - cyc - 1
!have:  sec
        sbc lost, x             // R
        bpl !+
        lda #$ff                // R = -1: no slide at all (a B block with 9 lost)
!:      sta zp_t1
        lda #slide
        sec
        sbc zp_t1
        cmp #slide + 1          // (the whole slide skipped: to the next block)
        bcc !+
        lda #slide
!:      sta table, x
}
rb_init:
        ldx #7
!:      PadFor(pad_nb, NB_CYC, NB_SLIDE, lost_set)
        PadFor(pad_fb, FB_CYC, FB_SLIDE, lost_set)
        PadFor(pad_lb, LB_CYC, LB_SLIDE, lost_set)
        PadFor(pad_bb, BB_CYC + BADLOSS, BB_SLIDE, lost_set)
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
        lda rb_hoff             // the copy's z * 8 table, when its horizon moved
        cmp zlc_h, x
        beq !zl+
        sta zlc_h, x
        tay
        lda zl_lo, y
        sta zlcp + 1
        lda zl_hi, y
        sta zlcp + 2
        lda zlc_off, x
        tax
        ldy #0
zlcp:   lda $ffff, y
        sta zlc_a, x
        inx
        iny
        cpy #ROAD_LINES
        bne zlcp
        ldx back_idx
!zl:
        lda back_idx
        beq !+
        lda #PRE_SIZE
!:      sta back_pre            // pre_b - pre_a: PreBlock's size
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
#if NOSPRITES
        lda #0
#endif
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

// rb_piece: one piece of the picture's rows, bottom up (C calls it until
// rb_state is 0 and zp_row is below rb_stop). Each piece is well under a
// frame, so the main loop's game step is never held past its tick:
//   row start   the row's centre, its lines' $D016 and pads, its set, and
//               the row cache: a row as this screen last got is done here
//   decode      the template into rowbuf
//   copy        a row whose lines fit XSCROLL: rowbuf to the screen
//   slots       a sheared row: its dynamic u's and their slots (rcode)
//   glyphs      four of its dynamic glyphs a piece
//   shcopy      rcode to the screen
rb_piece:
        ldx rb_state
        bne !+
        lda zp_row              // between rows: the next, if any
        cmp rb_stop
        bcs row_start
        rts
!:      lda st_hi - 1, x
        pha
        lda st_lo - 1, x
        pha
        rts
st_lo:      .byte <(st_decode - 1), <(st_copy - 1), <(st_slots - 1), <(st_glyphs - 1), <(st_shcopy - 1)
st_hi:      .byte >(st_decode - 1), >(st_copy - 1), >(st_slots - 1), >(st_glyphs - 1), >(st_shcopy - 1)
.const ST_DECODE = 1
.const ST_COPY   = 2
.const ST_SLOTS  = 3
.const ST_GLYPHS = 4
.const ST_SHCOPY = 5
rb_state:   .byte 0

row_done:
        dec zp_row
        lda #0
        sta rb_state
        rts

// codes: the count at (zp_src),Y, then that many codes, through emit1.
// Leaves Y past them.
codes:  lda (zp_src), y
        iny
        tax
        beq !none+
!code:  lda (zp_src), y
        iny
        jsr emit1
        dex
        bne !code-
!none:  rts
// emit1: code A at the left half's next index and its mirror at the right
// half's; the centre column's code (zp_t3 set) alone at 64. X and Y kept.
emit1:  pha
        lda zp_t3
        beq !+
        pla
        sta rowbuf + 64
        lda #0
        sta zp_t3
        inc zp_t1               // the right half starts at 65
        rts
!:      pla
        stx zp_t2
        ldx zp_t0
        sta rowbuf, x
        dec zp_t0
        eor #$80
        ldx zp_t1
        sta rowbuf, x
        inc zp_t1
        ldx zp_t2
        rts

row_start:
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
!dset:  and #3                  // pattern_s + (d + 32) * 32 + b * 8
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
        adc #<pattern_s
        sta zp_ramp
        lda zp_ramp + 1
        adc #>pattern_s
        sta zp_ramp + 1
        // sheared when the largest shift, b + |d|, is 8 or more: its lines
        // move by whole columns too (draw_row); mmax = that shift >> 3
        lda zp_t1               // b * 8
        lsr
        lsr
        lsr
        sta zp_t2               // b
        lda zp_t0               // |d|
        bpl !+
        eor #$ff
        clc
        adc #1
!:      clc
        adc zp_t2
        lsr
        lsr
        lsr
        sta row_mmax
        beq !+
        lda zp_t0               // the shear's key for the row cache
        clc
        adc #33                 // 1-65
        asl
        asl
        ora zp_t2
!:      sta row_skey            // 0 when not sheared
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
        cmp #0                  // in range: 0-59, or $FFE8-$FFFF (-24 to -1)
        bne !cneg+
        cpx #60
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
        // the row's eight $D016 bytes and shifts into the copy's tables
        lda zp_R
        asl
        asl
        asl
        ldy back_idx
        clc
        adc b96, y
        tax
    .for (var j = 0; j < 8; j++) {
        ldy #j
        lda (zp_ramp), y
        sta line_s + j, x
        and #7
        ora #D016_ROAD
        sta d016_a + j, x
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
        ldy #(j & 3) * 64 + LB_OPER
      } else {
        lda pad_nb, y
        ldy #(j & 3) * 64 + NB_OPER
      }
      .if (j < 4) { sta (zp_code), y } else { sta (zp_code2), y }
        inx
    }
!nopad:
        // the row's character set: its static set, or the back copy's dynamic
        // set when sheared; into the L block above (row 0: the copy's entry)
        lda row_mmax
        beq !st+
        ldy back_idx
        lda dyn_d018, y
        jmp !have+
!st:    ldx zp_R
        ldy glyph_rowset, x
        lda set_bits, y
        ldy back_idx
        ora scr_bits, y
!have:  ldx zp_R
        bne !up+
        ldx back_pre
        sta pre_a + PRE_LY, x
        jmp !done+
!up:    dec zp_code + 1
        ldy #$c0 + OFF_LY
        sta (zp_code), y
        inc zp_code + 1
!done:
        jmp draw_row

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
        lda row_skey
        cmp rs_sk, y
        bne !draw+
        jmp row_done
!draw:  lda zp_src
        sta rs_tlo, y
        lda zp_src + 1
        sta rs_thi, y
        lda zp_c
        sta rs_c, y
        lda row_skey
        sta rs_sk, y
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
!:      lda #ST_DECODE
        sta rb_state
        rts

st_decode:
        // The template straight into rowbuf: each code at the left half's
        // next index (63 down) and its mirror at the right half's (64 up); in
        // phase 1 the first code is the centre column's, at 64, alone. Runs
        // of road, then grass out to 40 and 87, are filled a side at a time.
        lda #63
        sta zp_t0               // the left half's next index
        lda #64
        sta zp_t1               // the right half's next index
        lda zp_p
        sta zp_t3               // 1: the next code is the centre column's
        ldy #0
        jsr codes               // n1 codes
        lda (zp_src), y         // L, the road run
        iny
        sty zp_t4               // (Y: the template index, kept over the fills)
        tax
        beq !n2+
        lda zp_t3
        beq !+
        lda #CH_ROAD            // (phase 1 and no n1: the centre column is road)
        jsr emit1
        dex
        beq !n2+
!:      stx zp_t2               // the run on each side
        ldy zp_t0
        lda #CH_ROAD
!:      sta rowbuf, y
        dey
        dex
        bne !-
        sty zp_t0
        ldx zp_t2
        ldy zp_t1
        lda #CH_ROAD | $80
!:      sta rowbuf, y
        iny
        dex
        bne !-
        sty zp_t1
!n2:    ldy zp_t4
        jsr codes               // n2 codes
        ldy zp_t0               // grass out to 40 and to 87
        lda #CH_GRASS
!:      cpy #40
        bcc !+
        sta rowbuf, y
        dey
        bne !-
!:      ldy zp_t1
        lda #CH_GRASS | $80
!:      cpy #88
        bcs !+
        sta rowbuf, y
        iny
        bne !-
!:
        lda row_mmax
        bne !+
        lda #ST_COPY
        sta rb_state
        rts
!:      lda #ST_SLOTS
        sta rb_state
        rts

st_copy:
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
        jmp row_done

// sheared: a row whose lines move by whole columns (row_mmax > 0). Line l
// shows the static row moved right by m(l) = shift(l) >> 3 columns (its
// XSCROLL adds shift & 7). Over the row's rowbuf indexes u, ascending: a u
// within mmax to the right of a glyph (not grass or road) is dynamic, and
// gets the next of the row's 20 slots in the back copy's dynamic set ($F000
// for A, $F800 for B), built from its sources' own lines; any other u keeps
// its code. rcode holds the result by u; the screen row is copied from it.
// The slots depend only on the template and the shear, so a row whose two
// are as this copy last built them keeps its glyphs (rs_gtlo/gthi/gsk).
st_slots:
        // m(l), and the lines of each move k: dlo[k] to dhi[k]
        ldx #4
        lda #$ff
!:      sta dlo, x
        dex
        bpl !-
        ldy #0
!:      lda (zp_ramp), y
        lsr
        lsr
        lsr
        sta mtab, y
        tax
        lda dlo, x
        bpl !+
        tya
        sta dlo, x
!:      tya
        sta dhi, x
        iny
        cpy #8
        bne !--
        // the dynamic u's and their slots, into rcode (and dynlist)
        ldx zp_R
        lda dslot, x
        sta zp_id
        ldx #0
        stx dyn_n
        stx zp_t4               // run count: dynamic while > 0
        ldx #40
!u:     cpx #88
        bcs !tail+
        ldy rowbuf, x
        lda gcls, y
        cmp #2
        bcc !tail+
        lda row_mmax            // a glyph: this u and the next mmax are dynamic
        sta zp_t4
        inc zp_t4
!tail:  lda zp_t4
        beq !keep+
        dec zp_t4
        ldy dyn_n
        cpy #20
        bcs !keep+              // out of slots: the static code
        txa
        sta dynlist, y
        lda zp_id
        sta rcode, x
        inc zp_id
        inc dyn_n
        jmp !nx+
!keep:  lda rowbuf, x
        sta rcode, x
!nx:    inx
        cpx #93
        bcc !u-
        // the glyphs, unless this copy's row has them already
        lda zp_R
        clc
        adc buf12
        tay
        lda zp_src              // (still the template: draw_row copies from rcode)
        cmp rs_gtlo, y
        bne !build+
        lda zp_src + 1
        cmp rs_gthi, y
        bne !build+
        lda row_skey
        cmp rs_gsk, y
        bne !build+
        lda #ST_SHCOPY
        sta rb_state
        rts
!build: lda #0                  // (half built if the tick interrupts: rebuilt next time)
        sta rs_gthi, y
        ldx zp_R
        lda dofs_lo, x
        sta zp_code
        ldy back_idx
        lda dofs_hi, x
        clc
        adc dyn_hi, y
        sta zp_code + 1
        ldy glyph_rowset, x     // the row's static set: its glyph data less 5 * 8
        lda glyph_lo, y
        sec
        sbc #GBASE * 8
        sta gb_lo
        lda glyph_hi, y
        sbc #0
        sta gb_hi
        lda #0
        sta dyn_i
        lda #ST_GLYPHS
        sta rb_state
        rts

st_glyphs:                      // four glyphs a piece
        lda #4
        sta dyn_q
!g:     ldy dyn_i
        cpy dyn_n
        bcs !done+
        dec dyn_q
        bmi !out+
        lda dynlist, y
        sta zp_u
        jsr dyn_glyph
        lda zp_code
        clc
        adc #8
        sta zp_code
        bcc !+
        inc zp_code + 1
!:      inc dyn_i
        jmp !g-
!out:   rts
!done:  lda zp_R
        clc
        adc buf12
        tay
        lda zp_src
        sta rs_gtlo, y
        lda zp_src + 1
        sta rs_gthi, y
        lda row_skey
        sta rs_gsk, y
        lda #ST_SHCOPY
        sta rb_state
        rts

st_shcopy:
        // the screen row from rcode: screen[x] = rcode[64 - c + x]
        lda #64
        sec
        sbc zp_c
        clc
        adc #<rcode
        sta zp_g
        lda #>rcode
        adc #0
        sta zp_g + 1
    .for (var x = 0; x < 40; x++) {
        ldy #x
        lda (zp_g), y
        sta (zp_scr), y
    }
        jmp row_done

// dyn_glyph: the glyph for rowbuf index zp_u into (zp_code): for each move
// k, its lines dlo[k]-dhi[k] from the glyph of rowbuf[zp_u - k].
dyn_glyph:
        ldx #0
!k:     lda dlo, x
        bmi !skip+
        stx zp_k
        lda zp_u
        sec
        sbc zp_k
        tay
        lda rowbuf, y           // the source code
        tay
        lda gcls, y
        beq !grass+
        cmp #1
        beq !road+
        cmp #2
        beq !left+
        tya                     // a mirror: the left glyph's bytes, mirrored
        and #$7f
        tay
        jsr gptr
        ldx zp_k
        ldy dlo, x
!:      lda (zp_g), y
        tax
        lda mirror_tab, x
        sta (zp_code), y
        iny
        ldx zp_k
        tya
        cmp dhi, x
        beq !-
        bcc !-
        jmp !skipk+
!left:  jsr gptr
        ldx zp_k
        ldy dlo, x
!:      lda (zp_g), y
        sta (zp_code), y
        iny
        tya
        cmp dhi, x
        beq !-
        bcc !-
        jmp !skipk+
!grass: lda #0
        .byte $2c
!road:  lda #$55
        sta zp_t4
        ldx zp_k
        ldy dlo, x
!:      lda zp_t4
        sta (zp_code), y
        iny
        tya
        cmp dhi, x
        beq !-
        bcc !-
!skipk: ldx zp_k
!skip:  inx
        cpx #5
        bne !k-
        rts

// gptr: zp_g = the row's glyph data for left id Y (5-127).
gptr:   lda gb_lo
        clc
        adc lo8, y
        sta zp_g
        lda gb_hi
        adc hi8, y
        sta zp_g + 1
        rts

gcls:       .fill 256, (i == 0 || i == $80) ? 0 : ((i == 1 || i == $81) ? 1 : (i < $80 ? 2 : 3))
lo8:        .fill 128, <(i * 8)
hi8:        .fill 128, >(i * 8)
// Row R's 20 slots: ids 2-121 for rows 0-5, 130-249 for rows 6-11 (0, 1,
// $80 and $81 are grass and road in both halves; 255 is under the vectors).
.function dslotOf(r) { .return r < 6 ? 2 + 20 * r : 130 + 20 * (r - 6) }
dslot:      .fill 12, dslotOf(i)
dofs_lo:    .fill 12, <(dslotOf(i) * 8)
dofs_hi:    .fill 12, >(dslotOf(i) * 8)
dyn_hi:     .byte >DYN_A, >DYN_B
dyn_d018:   .byte DYN_BITS_A, $10 | DYN_BITS_B
set_bits:   .fill SET_BITS.size(), SET_BITS.get(i)
scr_bits:   .byte $00, $10
b96:        .byte 0, 96
mtab:       .fill 8, 0
dyn_q:      .byte 0             // glyphs left in this piece
dyn_n:      .byte 0
dyn_i:      .byte 0
dynlist:    .fill 20, 0         // the row's dynamic u's, in slot order
rcode:      .fill 128, 0        // a sheared row's codes by u (grass either side)
dlo:        .fill 5, 0
dhi:        .fill 5, 0
zp_id:      .byte 0             // (absolute, not zero page: the builder's zero page is full)
zp_left:    .byte 0
zp_u:       .byte 0
zp_u2:      .byte 0
zp_x:       .byte 0
zp_k:       .byte 0
gb_lo:      .byte 0
gb_hi:      .byte 0

row40_lo:   .fill 12, <(i * 40)
row40_hi:   .fill 12, >(i * 40)

// k * 8, k * 28, k * 36 for k = -8..7 (index k + 8), 16-bit.
k8lo:       .fill 16, <((i - 8) * 8)
k8hi:       .fill 16, >((i - 8) * 8)
k28lo:      .fill 16, <((i - 8) * 28)
k28hi:      .fill 16, >((i - 8) * 28)
k36lo:      .fill 16, <((i - 8) * 36)
k36hi:      .fill 16, >((i - 8) * 36)

// The eight shifts of a row's lines from its content centre, in pixels, by
// the chord's d = bottom - top (-32..32, clamped) and the content centre's
// low two bits b (it is on a 4-pixel boundary): for d >= 0 the top line is
// at b, for d < 0 the bottom line is at b and the top at b - d. Line j is
// round(d * j / 7) from the top. A line's XSCROLL is its shift & 7; a shift
// of 8 or more is a whole-column move that only a sheared row can show.
pattern_s:
    .for (var d = -32; d <= 32; d++) {
        .for (var b = 0; b < 4; b++) {
            .var a = d >= 0 ? b : b - d
            .fill 8, a + round(d * i / 7)
        }
    }
// The bands from the low byte of position + z * 8: grass and road by bit 7,
// the kerb's stripes by bit 6.
// Odd entries are sky: band_pass writes 1 above the horizon, even values below.
// Page-aligned: the road's blocks index them with Y and count 4 cycles.
.align $100
grass_col:  .fill 256, (i & 1) != 0 ? C_SKY : ((i & $80) != 0 ? C_GRASS_B : C_GRASS_A)
road_col:   .fill 256, (i & 1) != 0 ? C_SKY : ((i & $80) != 0 ? C_ROAD_B : C_ROAD_A)
kerb_col:   .fill 256, (i & 1) != 0 ? C_SKY : ((i & $40) != 0 ? C_KERB_B : C_KERB_A)
// z * 8, low byte, per road line for each horizon offset.
zl_lo:      .fill HOFF_N, <(zltab + (i >> 1) * ROAD_LINES)
zl_hi:      .fill HOFF_N, >(zltab + (i >> 1) * ROAD_LINES)
zltab:
    .for (var h = 0; h < HOFF_N; h += 2) {
        .fill ROAD_LINES, zOf(h, i) == 0 ? 1 : (zOf(h, i) * 8) & $ff    // 1: sky (odd)
    }

