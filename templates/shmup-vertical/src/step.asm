// step.asm: one path step for every flying enemy, imported by kernel.asm.
// waves.c keeps the director, the spawner and the path bytecode; before
// en_step it fetches a new MOVE for each flying enemy whose count ran out,
// so every enemy flying here has en_n > 0. en_step subtracts one step,
// adds (en_dx, en_dy) to its X and Y in the multiplexer's actor table, and
// frees an enemy that left the screen (state 0, Y = OFF_Y), as waves.c's
// enemy_free does. In C this loop cost about 150 cycles an enemy.

.const EN_FREE   = 0            // waves.h E_FREE
.const EN_FLYING = 1            // waves.h E_FLYING
.const MAX_Y     = 187          // mux.asm MAX_SY: lower is off the playfield

en_state: .fill NE, 0
en_n:     .fill NE, 0           // steps left in the current MOVE
en_dx:    .fill NE, 0           // signed half X a step
en_dy:    .fill NE, 0           // signed lines a step

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
