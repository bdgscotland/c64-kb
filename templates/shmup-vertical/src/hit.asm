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

hit_scan:
        lda #0
        sta hit_n
        ldx #1                      // actor 1 = enemy 0
hs_loop:
        lda act_y,x
        cmp #OFF_Y
        beq hs_skip
        ldy act_ptr,x
        lda fb_w-SPR_BLOCK,y
        bne hs_box0
hs_skip:
        jmp hs_next                 // free, or an explosion
hs_box0:
        clc
        adc fb_x-SPR_BLOCK,y
        adc act_hx,x
        sta hs_r
        lda act_hx,x
        clc
        adc fb_x-SPR_BLOCK,y
        sta hs_l
        lda act_y,x
        sec                         // + 1: a sprite at Y starts on line Y + 1
        adc fb_y-SPR_BLOCK,y
        sta hs_t
        clc
        adc fb_h-SPR_BLOCK,y
        sta hs_b
        stx hs_e
        ldy #0
hs_box: lda hb_on,y
        beq hs_nb
        lda hs_t                    // t < hb_b
        cmp hb_b,y
        bcs hs_nb
        lda hb_t,y                  // hb_t < b
        cmp hs_b
        bcs hs_nb
        lda hs_l                    // l < hb_r
        cmp hb_r,y
        bcs hs_nb
        lda hb_l,y                  // hb_l < r
        cmp hs_r
        bcs hs_nb
        lda #0                      // a hit: the box is spent
        sta hb_on,y
        tya
        ldy hit_n
        sta hit_a,y
        txa
        sec
        sbc #1
        sta hit_e,y
        inc hit_n
        jmp hs_next
hs_nb:  iny
        cpy #HB_N
        bne hs_box
hs_next:
        inx
        cpx #NE+1
        beq !+
        jmp hs_loop
!:      rts
