// sprite.asm: the KickAssembler half of hello. The harness assembles it to
// build/asm.bin (raw bytes from $0900) and build/asm.h, which gives C
// ASM_ORG, ASM_END and ASM_<LABEL> for every top-level label below.
//
// Calling convention (this file's own, not Oscar64's): C writes the
// parameters into this blob's own bytes, then `jsr ASM_PUT_SPRITE` from an
// __asm block. The routine uses A and X and no zero page, so it cannot
// collide with Oscar64's registers.

* = $0900 "asm"

// Sprite 0 to (spr_x, spr_y). spr_x is 9-bit: its high byte sets bit 0 of $D010.
put_sprite:
        lda spr_x
        sta $d000
        lda $d010
        and #$fe
        ldx spr_x+1
        beq !+
        ora #$01
!:      sta $d010
        lda spr_y
        sta $d001
        rts

spr_x:  .word 0
spr_y:  .byte 0
