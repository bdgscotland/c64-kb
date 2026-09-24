// glyph.asm: the character bullets, imported by kernel.asm. bb_run moves
// and draws the ship's bolts, eb_run the enemies' dots (bullets.c fires
// them and keeps the rules). For each bullet they set cb_r and cb_c (screen
// row and column), cb_glyph (its reserved code), cb_mask (the pixel pair)
// and cb_row / cb_n (the glyph rows to set), then call cb_draw. That saves
// the code under the bullet, copies its glyph into the reserved one, ORs the
// pair into the rows, writes the reserved code into the cell, and notes the
// cell and the code it found on a list. cb_erase restores the list
// backwards; cb_check then compares every cell on it with the map's code,
// which cb_draw notes only when C sets cb_keep (the autopilot build, whose
// verdict runs the check every frame). The same work in C cost about 380
// cycles a bullet (PROFILE build, VICE x64sc 3.10). No zero page: the loops
// patch their own operands. Over open water (code 32, blank) nothing needs
// merging: the cell gets cb_fixed, one of the ready-made shot glyphs
// display.c builds, and the reserved glyph is left alone. Most shots are
// over the river.
//
// Before cb_begin, C sets cb_front (0 or 1: the screen now showing), cb_top
// (the map row that screen shows in its row 0: cur_row + 20, 0-115) and
// cb_y (the YSCROLL showing).

.const CHARSET    = $b800
.const LEVEL_RAM  = $9000       // level.c: map row m at LEVEL_RAM + 40 * (95 - m)
.const LEVEL_ROWS = 96
.const CB_MAX     = 10          // bullets.h NB + NEB
.const G_WATER    = 32          // display.h: open water, a blank cell
.const G_DOTS     = $c0         // display.h: 16 dots, $C0 + pair * 4 + row / 2
.const G_BOLTS    = $d0         // display.h: 4 bolts, $D0 + pair

cb_front: .byte 0
cb_top:   .byte 0
cb_r:     .byte 0
cb_c:     .byte 0
cb_glyph: .byte 0
cb_mask:  .byte 0
cb_row:   .byte 0
cb_n:     .byte 0
cb_dn:    .byte 0               // cells on the list
cb_fault: .byte 0               // cb_check: 1 when a cell is not the map's
cb_fixed: .byte 0               // the ready-made glyph for this shot over open water
cb_keep:  .byte 0               // 1: note the map's code for cb_check (about 40 cycles a draw)

cb_lo:    .fill CB_MAX, 0       // the list: cell address, code found, map code
cb_hi_t:  .fill CB_MAX, 0
cb_under: .fill CB_MAX, 0
cb_map:   .fill CB_MAX, 0

pf_lo:    .fill 21, <($8000 + 40 * i)
          .fill 21, <($8400 + 40 * i)
pf_hi:    .fill 21, >($8000 + 40 * i)
          .fill 21, >($8400 + 40 * i)
cg_lo:    .fill 256, <(CHARSET + 8 * i)     // each code's glyph address: shifting
cg_hi:    .fill 256, >(CHARSET + 8 * i)     // it cost 35 cycles more a draw
map_lo:   .fill LEVEL_ROWS, <(LEVEL_RAM + 40 * (LEVEL_ROWS - 1 - i))
map_hi:   .fill LEVEL_ROWS, >(LEVEL_RAM + 40 * (LEVEL_ROWS - 1 - i))

cb_begin:
        lda #0
        sta cb_dn
        rts

cb_draw:
        ldx cb_r                // the cell: row r of the showing screen, column c
        lda cb_front
        beq !+
        txa
        clc
        adc #21
        tax
!:      lda pf_lo,x
        clc
        adc cb_c
        sta cb_rd+1
        sta cb_wr+1
        lda pf_hi,x
        adc #0
        sta cb_rd+2
        sta cb_wr+2
        ldy cb_dn               // on the list
        lda cb_rd+1
        sta cb_lo,y
        lda cb_rd+2
        sta cb_hi_t,y
        lda cb_keep             // only for cb_check (the autopilot's verdict)
        beq cb_rd
        lda cb_top              // the map's code: map row cb_top - r, wrapped
        sec
        sbc cb_r
        cmp #LEVEL_ROWS
        bcc !+
        sbc #LEVEL_ROWS
!:      tax
        lda map_lo,x
        sta cb_mp+1
        lda map_hi,x
        sta cb_mp+2
        ldx cb_c
cb_mp:  lda $ffff,x
        sta cb_map,y
cb_rd:  lda $ffff               // the code under the bullet
        sta cb_under,y
        inc cb_dn
        cmp #G_WATER            // open water: a ready-made glyph, no merge
        bne cb_merge
        lda cb_fixed
        jmp cb_wr
cb_merge:
        tax                     // its glyph: CHARSET + code * 8, from tables
        lda cg_lo,x
        sta cb_ld+1
        lda cg_hi,x
        sta cb_ld+2
        ldx cb_glyph            // the reserved glyph
        lda cg_lo,x
        sta cb_st+1
        sta cb_or+1
        sta cb_os+1
        lda cg_hi,x
        sta cb_st+2
        sta cb_or+2
        sta cb_os+2
        ldx #7
cb_ld:  lda $ffff,x
cb_st:  sta $ffff,x
        dex
        bpl cb_ld
        ldx cb_row
        ldy cb_n
cb_or:  lda $ffff,x
        ora cb_mask
cb_os:  sta $ffff,x
        inx
        dey
        bne cb_or
        lda cb_glyph
cb_wr:  sta $ffff
        rts

// Restore the list backwards, so bullets sharing a cell unwind.
cb_erase:
        ldy cb_dn
        beq cb_e_done
cb_e:   dey
        lda cb_lo,y
        sta cb_ew+1
        lda cb_hi_t,y
        sta cb_ew+2
        lda cb_under,y
cb_ew:  sta $ffff
        cpy #0
        bne cb_e
cb_e_done:
        rts

// After cb_erase: every cell on the list holds the map's code again. Reads
// the screen back, so an erase that skipped a cell or ran in the wrong order
// leaves a reserved code and sets cb_fault.
cb_check:
        ldy cb_dn
        beq cb_c_done
cb_cl:  dey
        lda cb_lo,y
        sta cb_cr+1
        lda cb_hi_t,y
        sta cb_cr+2
cb_cr:  lda $ffff
        cmp cb_map,y
        beq !+
        lda #1
        sta cb_fault
!:      cpy #0
        bne cb_cl
cb_c_done:
        rts

// ---- the ship's bolts ------------------------------------------------------
// bullets.c fires them (bb_live/bb_hx/bb_line); bb_run, called once a frame
// before eb_run with cb_y = the YSCROLL showing, moves each bolt 7 lines up,
// drops it once its top row is in screen row 0 (half hidden) or it left
// row 19, draws it with cb_draw on rows 2-5 of its cell, and writes its box
// (hit.asm hb_*, slot 1 + bolt). In C this loop cost about 250 cycles a
// bolt more (PROFILE build, VICE x64sc 3.10).
.const NB       = 4             // bullets.h NB
.const G_BULLET = $f8           // display.h: $F8-$FB, one per bolt

bb_live:  .fill NB, 0
bb_hx:    .fill NB, 0           // half X of the bolt's pixel pair
bb_line:  .fill NB, 0           // raster line of the bolt's top row
bb_j:     .byte 0

bb_run:
        ldx #0
bb_loop:
        lda bb_live,x
        bne !+
        jmp bb_next
!:
        lda bb_line,x
        sec
        sbc #7
        sta bb_line,x
        sec                     // t = line - 50 - YSCROLL = 8 * row
        sbc #50
        sec
        sbc cb_y
        tay
        sec                     // row 0 (t < 8) or past row 19 (t >= 160,
        sbc #8                  // or below 0, which wraps high): gone
        cmp #152
        bcc !+
        jmp bb_kill
!:      tya
        lsr
        lsr
        lsr
        sta cb_r
        lda #2
        sta cb_row
        lda #4
        sta cb_n
        lda bb_hx,x             // x = hx - 12: column x / 4, pair x & 3
        sta hb_l+1,x            // the box: one pixel pair, four lines
        tay
        iny
        tya
        sta hb_r+1,x
        lda bb_line,x
        sta hb_t+1,x
        clc
        adc #4
        sta hb_b+1,x
        lda #1
        sta hb_on+1,x
        lda bb_hx,x
        sec
        sbc #12
        tay
        lsr
        lsr
        sta cb_c
        tya
        and #3
        tay
        lda eb_mask,y
        sta cb_mask
        tya
        clc
        adc #G_BOLTS            // the bolt over open water
        sta cb_fixed
        txa
        clc
        adc #G_BULLET
        sta cb_glyph
        stx bb_j
        jsr cb_draw
        ldx bb_j
        jmp bb_next
bb_kill:
        lda #0
        sta bb_live,x
        sta hb_on+1,x
bb_next:
        inx
        cpx #NB
        beq !+
        jmp bb_loop
!:      rts

// ---- the enemies' bullets --------------------------------------------------
// bullets.c fires them (eb_live/eb_hx/eb_line/eb_dx) and calls eb_run once a
// frame after the bolts, with cb_y = the YSCROLL showing. eb_run moves each
// dot 2 lines down and eb_dx pixel pairs across, drops it past line EB_LAST
// or the screen's sides, and draws it with cb_draw: rows (t & 6) and the next
// of its cell, t = line - 48 - YSCROLL.
.const NEB       = 6            // bullets.h NEB
.const G_EBULLET = $f2          // $F2-$F7
.const EB_LAST   = 206          // a dot below line 206 is gone (screen row 19)

eb_live:  .fill NEB, 0
eb_hx:    .fill NEB, 0          // half X of the dot's pixel pair
eb_line:  .fill NEB, 0          // raster line of the dot's top row
eb_dx:    .fill NEB, 0          // -1, 0 or 1 pixel pair a frame
cb_y:     .byte 0
eb_j:     .byte 0
eb_mask:  .byte $c0, $30, $0c, $03
eb_p4:    .byte G_DOTS, G_DOTS + 4, G_DOTS + 8, G_DOTS + 12

eb_run:
        ldx #0
eb_loop:
        lda eb_live,x
        bne !+
        jmp eb_next
!:
        lda eb_line,x
        clc
        adc #2
        sta eb_line,x
        cmp #EB_LAST+1
        bcc !+
        jmp eb_kill
!:
        lda eb_hx,x
        clc
        adc eb_dx,x
        sta eb_hx,x
        cmp #12
        bcc eb_kill
        cmp #172
        bcs eb_kill
        sec                     // x = hx - 12: column x / 4, pair x & 3
        sbc #12
        tay
        lsr
        lsr
        sta cb_c
        tya
        and #3
        tay
        lda eb_mask,y
        sta cb_mask
        lda eb_p4,y             // the dot over water: G_DOTS + pair * 4 + row / 2
        sta cb_fixed
        lda eb_line,x           // t = line - 48 - YSCROLL (line >= 84: no borrow
        sec                     // from the first subtraction)
        sbc #48
        sbc cb_y
        tay
        lsr
        lsr
        lsr
        sta cb_r
        tya
        and #6
        sta cb_row
        lsr
        clc
        adc cb_fixed
        sta cb_fixed
        lda #2
        sta cb_n
        txa
        clc
        adc #G_EBULLET
        sta cb_glyph
        stx eb_j
        jsr cb_draw
        ldx eb_j
        jmp eb_next
eb_kill:
        lda #0
        sta eb_live,x
eb_next:
        inx
        cpx #NEB
        beq !+
        jmp eb_loop
!:      rts
