// joyprobe: a joystick-only program for `make joyprobe` (harness/drive.py's self-test).
// It counts frames until fire on control port 2 reads pressed on $DC00, then
// writes "FIRE AT FRAME " and the count as four hex digits on row 0 and turns
// the border green. Then it waits for fire on control port 1 ($DC01 bit 4),
// writes "PORT 1 FIRE" on row 1, turns the border blue, and stops. Nothing but
// those two bits moves it on; a port 1 that reads fire held from power-on
// turns the border blue before drive.py presses it.
BasicUpstart2(start)

start:  sei
        lda #$ff
        sta $dc02               // CIA1 port A all output: no keyboard column selected
        sta $dc00
        lda #0
        sta $dc03               // port B input
        sta count
        sta count + 1
        lda #2
        sta $d020
frame:  lda $d012               // one frame: line 255 comes, then goes
        cmp #255
        bne frame
!:      lda $d012
        cmp #255
        beq !-
        inc count
        bne !+
        inc count + 1
!:      lda $dc00
        and #$10
        bne frame
        ldx #0
!:      lda message,x
        sta $0400,x
        inx
        cpx #14
        bne !-
        lda count + 1
        jsr hex2
        lda count
        jsr hex2
        lda #5
        sta $d020
!:      lda $dc01               // port 1: $DC00 is $FF, so no keyboard column pulls a row
        and #$10
        bne !-
        ldx #0
!:      lda message1,x
        sta $0428,x
        inx
        cpx #11
        bne !-
        lda #6
        sta $d020
done:   jmp done

hex2:   pha                     // A as two screen-code hex digits at $0400,x
        lsr
        lsr
        lsr
        lsr
        tay
        lda digits,y
        sta $0400,x
        inx
        pla
        and #$0f
        tay
        lda digits,y
        sta $0400,x
        inx
        rts

count:   .word 0
message: .text "fire at frame "        // lower case: screen codes 1-26, the upper-case glyphs
message1: .text "port 1 fire"
digits:  .text "0123456789abcdef"
