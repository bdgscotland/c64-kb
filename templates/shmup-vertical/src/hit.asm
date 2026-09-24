// hit.asm: the enemies' boxes against the ship's and the bolts', imported by
// kernel.asm (technique per_frame_hitbox). hitbox.c writes the ship's and
// the bolts' boxes (hb_*, slot 0 the ship, 1-4 the bolts) where they are
// drawn; hit_scan reads each enemy from the multiplexer's actor table
// (actors 1-12: what the display showed), takes its box from its sprite
// frame (fb_*: an explosion's frame has none, a free enemy's Y is $FF), and
// tests it against every box still on. A hit is put on the list hit_e /
// hit_a (enemy, box slot) and that box goes off, so a bolt kills one enemy
// and the ship is lost once a frame. In C this scan cost 2,700-3,100 cycles
// on the staged heaviest frame (PROFILE build, VICE x64sc 3.10).
//
// Boxes are in half X and raster lines: four one-byte compares, no $D010.
// An enemy whose lines miss the lines of every box that is on is passed
// over before its X is worked out, and the boxes that are off are left out
// of the list each enemy walks: with twelve enemies flying this scan is
// much of the frame on NTSC.

.const HB_N      = 5            // hitbox.h: BOX_ENEMY
.const NE        = 12           // waves.h NE: actors 1-12
.const SPR_BLOCK = 128          // game.h

// Each sprite frame's box (display.h F_*): offset and size from the
// sprite's first pixel pair and first line. w = 0: no box.
fb_x:   .byte 3, 3, 1, 2, 0, 0
fb_y:   .byte 4, 2, 1, 2, 0, 0
fb_w:   .byte 6, 6, 10, 8, 0, 0    // the ship: its hull only
fb_h:   .byte 10, 8, 7, 9, 0, 0

hb_on:  .fill HB_N, 0
hb_l:   .fill HB_N, 0
hb_r:   .fill HB_N, 0               // exclusive
hb_t:   .fill HB_N, 0
hb_b:   .fill HB_N, 0               // exclusive

hit_n:  .byte 0
hit_e:  .fill NE, 0
hit_a:  .fill NE, 0

hs_e:   .byte 0
hs_t:   .byte 0
hs_b:   .byte 0
hs_l:   .byte 0
hs_r:   .byte 0
hs_lo:  .byte 0
hs_hi:  .byte 0
hs_nl:  .byte 0
hs_list: .fill HB_N, 0              // the slots on this frame, slot 0 last

// The enemies' dots against the ship's box (slot 0): dot_hit = the first
// dot inside it, or $FF. A dot is one pixel pair wide and two lines tall.
// The same test in C cost about 25 cycles a dot more.
dot_hit: .byte $ff

dot_scan:
        lda #$ff
        sta dot_hit
        lda hb_on
        beq ds_done
        ldx #0
ds_loop:
        lda eb_live,x
        beq ds_next
        lda eb_line,x           // y < b
        cmp hb_b
        bcs ds_next
        adc #2                  // t < y + 2 (carry clear here)
        cmp hb_t
        beq ds_next
        bcc ds_next
        lda eb_hx,x             // x < r
        cmp hb_r
        bcs ds_next
        adc #1                  // l < x + 1
        cmp hb_l
        beq ds_next
        bcc ds_next
        stx dot_hit
        rts
ds_next:
        inx
        cpx #NEB
        bne ds_loop
ds_done:
        rts

hit_scan:
        lda #0
        sta hit_n
        lda #$ff                    // the lines any box that is on covers:
        sta hs_lo                   // hs_lo to hs_hi (exclusive); and the
        lda #0                      // boxes that are on, slot 0 last
        sta hs_hi
        ldx #0
        ldy #HB_N-1
hs_rng: lda hb_on,y
        beq hs_rn
        tya
        sta hs_list,x
        inx
        lda hb_t,y
        cmp hs_lo
        bcs !+
        sta hs_lo
!:      lda hb_b,y
        cmp hs_hi
        bcc hs_rn
        sta hs_hi
hs_rn:  dey
        bpl hs_rng
        stx hs_nl
        txa
        bne !+
        rts                         // no box is on
!:      ldx #1                      // actor 1 = enemy 0
        bne hs_loop
hs_skip:
        jmp hs_next
hs_loop:
        lda act_y,x
        cmp #OFF_Y
        beq hs_skip
        ldy act_ptr,x
        lda fb_w-SPR_BLOCK,y
        beq hs_skip                 // an explosion: no box
        lda act_y,x
        sec                         // + 1: a sprite at Y starts on line Y + 1
        adc fb_y-SPR_BLOCK,y
        cmp hs_hi                   // below every box: next enemy
        bcs hs_skip
        sta hs_t
        clc
        adc fb_h-SPR_BLOCK,y
        cmp hs_lo                   // above every box
        bcc hs_skip
        beq hs_skip
        sta hs_b
        lda act_hx,x
        clc
        adc fb_x-SPR_BLOCK,y
        sta hs_l
        clc
        adc fb_w-SPR_BLOCK,y
        sta hs_r
        stx hs_e
        ldx hs_nl                   // the boxes that were on, the ship first
hs_box: dex
        bmi hs_done
        ldy hs_list,x
        lda hs_t                    // t < hb_b
        cmp hb_b,y
        bcs hs_box
        lda hb_t,y                  // hb_t < b
        cmp hs_b
        bcs hs_box
        lda hs_l                    // l < hb_r
        cmp hb_r,y
        bcs hs_box
        lda hb_l,y                  // hb_l < r
        cmp hs_r
        bcs hs_box
        lda hb_on,y                 // spent by an earlier enemy this frame
        beq hs_box
        lda #0                      // a hit: the box is spent
        sta hb_on,y
        tya
        ldy hit_n
        sta hit_a,y
        lda hs_e
        sec
        sbc #1
        sta hit_e,y
        inc hit_n
hs_done:
        ldx hs_e
hs_next:
        inx
        cpx #NE+1
        beq !+
        jmp hs_loop
!:      rts
