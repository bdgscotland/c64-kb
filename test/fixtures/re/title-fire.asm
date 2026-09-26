// A title loop that waits for fire the way Commando's does (LDA $DC00 at
// $0FB2, CMP #$6F at $0FB5): no key or joystick reaches a batch VICE run, so
// test/re-session.test.ts sets A = $6F at the CMP. After fire, a $0314
// raster handler on line 100 runs forever: the play state.
BasicUpstart2(title)

* = $0810 "title"
title:  lda $dc00           // $0810
        cmp #$6f            // $0813: the injection point
        bne title           // $0815
        jmp play            // $0817

* = $0900 "play"
play:   sei                 // $0900: the in-play PC
        lda #$7f
        sta $dc0d
        lda $dc0d
        lda #<irq
        sta $0314
        lda #>irq
        sta $0315
        lda #$1b
        sta $d011
        lda #100
        sta $d012
        lda #$ff            // clear a raster flag already pending, or it fires at once
        sta $d019
        lda #1
        sta $d01a
        cli
loop:   jmp loop

* = $0940 "irq"
irq:    lda #1              // $0940
        sta $d019
        inc $d020
        jmp $ea81
