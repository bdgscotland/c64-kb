// step.asm: the enemies' paths and one step for every flying enemy,
// imported by kernel.asm. waves.c keeps the director, the spawner and the
// path bytecode (its tables' addresses are in en_plo/en_phi). Each frame
// en_paths counts the explosions down and, for each flying enemy whose MOVE
// ran out, reads its path until the next MOVE (P_FIRE puts the enemy on
// en_fire for waves.c; P_END frees it). Then en_step moves every flying
// enemy one step. The scan and the path reads in C cost about 330 cycles an
// enemy that needed a MOVE, and 40 more for every enemy, on the frames with
// most enemies (PROFILE build, NTSC joystick play, VICE x64sc 3.10), where
// sprite DMA slows every cycle.

.const EN_FREE   = 0            // waves.h E_FREE
.const EN_FLYING = 1            // waves.h E_FLYING
.const EN_BOOM   = 2            // waves.h E_BOOM
.const F_BOOM2   = 5            // display.h: the second explosion frame
.const P_END     = $80          // waves.c: the path opcodes
.const P_LOOP    = $81
.const P_FIRE    = $82
.const MAX_Y     = 187          // mux.asm MAX_SY: lower is off the playfield

en_state: .fill NE, 0
en_n:     .fill NE, 0           // steps left in the current MOVE
en_dx:    .fill NE, 0           // signed half X a step
en_dy:    .fill NE, 0           // signed lines a step
en_timer: .fill NE, 0           // an explosion's frames left
en_path:  .fill NE, 0           // path number
en_pc:    .fill NE, 0           // offset of the next opcode
en_lc:    .fill NE, 0           // loop count left
en_plo:   .fill 6, 0            // each path's address (waves.c fills it)
en_phi:   .fill 6, 0
en_fire:  .fill NE, 0           // enemies whose path said FIRE this frame
en_nf:    .byte 0

en_paths:
        lda #0
        sta en_nf
        ldx #0
ep_loop:
        lda en_state,x
        cmp #EN_FLYING
        bne ep_boom
        lda en_n,x
        bne ep_next
        jsr en_fetch
        jmp ep_next
ep_boom:
        cmp #EN_BOOM
        bne ep_next
        dec en_timer,x
        lda en_timer,x
        beq ep_free
        cmp #8                  // half way: the second frame
        bne ep_next
        lda #SPR_BLOCK+F_BOOM2
        sta act_ptr+1,x
        jmp ep_next
ep_free:
        jsr en_free
ep_next:
        inx
        cpx #NE
        bne ep_loop
        rts

en_free:                        // as waves.c enemy_free
        lda #EN_FREE
        sta en_state,x
        lda #OFF_Y
        sta act_y+1,x
        rts

// Enemy X has no steps left: read opcodes until a MOVE, by waves.c's rules
// for the bytecode. Every read is `lda path,y` with the path's address
// patched in, y the offset.
en_fetch:
        ldy en_path,x
        lda en_plo,y
        sta ef_0+1
        sta ef_1+1
        sta ef_2+1
        sta ef_3+1
        sta ef_4+1
        lda en_phi,y
        sta ef_0+2
        sta ef_1+2
        sta ef_2+2
        sta ef_3+2
        sta ef_4+2
ef_loop:
        ldy en_pc,x
ef_0:   lda $ffff,y
        cmp #P_END
        beq en_free
        cmp #P_FIRE
        beq ef_fire
        cmp #P_LOOP
        beq ef_rep
        sta en_n,x              // MOVE n, dx, dy
        iny
ef_1:   lda $ffff,y
        sta en_dx,x
        iny
ef_2:   lda $ffff,y
        sta en_dy,x
        iny
        tya
        sta en_pc,x
        lda en_n,x              // a MOVE of 0 steps: read on
        beq ef_loop
        rts
ef_fire:
        ldy en_nf
        txa
        sta en_fire,y
        inc en_nf
        inc en_pc,x
        jmp ef_loop
ef_rep:                         // LOOP count, target
        lda en_lc,x
        bne !+
        iny
ef_3:   lda $ffff,y
        dey
        sta en_lc,x
!:      dec en_lc,x
        beq ef_out
        iny
        iny
ef_4:   lda $ffff,y             // back to the target
        sta en_pc,x
        jmp ef_loop
ef_out:
        tya                     // done: past the LOOP
        clc
        adc #3
        sta en_pc,x
        jmp ef_loop

en_step:
        ldx #0
es_loop:
        lda en_state,x
        cmp #EN_FLYING
        bne es_next
        dec en_n,x
        lda act_hx+1,x
        clc
        adc en_dx,x
        sta act_hx+1,x
        cmp #4                  // off the sides: below 4 or above 170 (a
        bcc es_free             // step left past 0 wraps high)
        cmp #171
        bcs es_free
        lda act_y+1,x
        clc
        adc en_dy,x
        sta act_y+1,x
        cmp #MAX_Y+1
        bcc es_next
es_free:
        lda #EN_FREE            // left the screen: no score
        sta en_state,x
        lda #OFF_Y
        sta act_y+1,x
es_next:
        inx
        cpx #NE
        bne es_loop
        rts
