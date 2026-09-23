// glyph.asm: the character-bullet draw list, imported by kernel.asm.
// bullets.c moves the bullets and, for each one to draw, sets cb_r and cb_c
// (screen row and column), cb_glyph (its reserved code), cb_mask (the pixel
// pair) and cb_row / cb_n (the glyph rows to set), then calls cb_draw. That
// saves the code under the bullet, copies its glyph into the reserved one,
// ORs the pair into the rows, writes the reserved code into the cell, and
// notes the cell, the code it found and the map's code there on a list.
// cb_erase restores the list backwards; cb_check then compares every cell on
// it with the map's code. The same work in C cost about 380 cycles a bullet
// (PROFILE build, VICE x64sc 3.10). No zero page: the loops patch their
// own operands. Over open water (code 32, blank) nothing needs merging: the
// cell gets cb_fixed, one of the ready-made shot glyphs display.c builds,
// and the reserved glyph is left alone. Most shots are over the river.
//
// Before cb_begin, C sets cb_front (0 or 1: the screen now showing) and
// cb_top (the map row that screen shows in its row 0: cur_row + 20, 0-115).

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
cb_hi:    .byte 0

cb_lo:    .fill CB_MAX, 0       // the list: cell address, code found, map code
cb_hi_t:  .fill CB_MAX, 0
cb_under: .fill CB_MAX, 0
cb_map:   .fill CB_MAX, 0

pf_lo:    .fill 21, <($8000 + 40 * i)
          .fill 21, <($8400 + 40 * i)
pf_hi:    .fill 21, >($8000 + 40 * i)
          .fill 21, >($8400 + 40 * i)
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
        ldx #0                  // its glyph: CHARSET + code * 8
        stx cb_hi
        asl
        rol cb_hi
        asl
        rol cb_hi
        asl
        rol cb_hi
        sta cb_ld+1
        lda cb_hi
        clc
        adc #>CHARSET
        sta cb_ld+2
        lda #0                  // the reserved glyph
        sta cb_hi
        lda cb_glyph
        asl
        rol cb_hi
        asl
        rol cb_hi
        asl
        rol cb_hi
        sta cb_st+1
        sta cb_or+1
        sta cb_os+1
        lda cb_hi
        clc
        adc #>CHARSET
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
        lda eb_line,x           // t = line - 48 - YSCROLL
        sec
        sbc #48
        sec
        sbc cb_y
        tay
        lsr
        lsr
        lsr
        sta cb_r
        tya
        and #6
        sta cb_row
        lsr                     // the dot over water: G_DOTS + pair * 4 + row / 2
        sta cb_fixed
        lda eb_hx,x
        sec
        sbc #12
        and #3
        asl
        asl
        clc
        adc cb_fixed
        adc #G_DOTS
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
