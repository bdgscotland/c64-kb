// KERNAL zero-page store trace (scripts/kernal-zp-trace.ts builds and runs
// this). Calls KERNAL routines one at a time, writing a marker number to
// $03FC before each, with every interrupt source masked, so the VICE store
// trace on $00-$FF can be cut into one segment per call and holds no IRQ.
// The marker numbers are the SEGMENTS table in kernal-zp-trace.ts; keep the
// two in step. Drive 8 holds a disk with a 3-block PRG named DATA.
.const MARK = $03fc
.macro mark(n) {
    lda #n
    sta MARK
}
BasicUpstart2(start)
start:
    sei
    lda #$7f
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #0
    sta $d01a
    // 1 SETLFS 2,8,2  (sequential read of DATA)
    mark(1)
    lda #2
    ldx #8
    ldy #2
    jsr $ffba
    mark(2)
    lda #fname_end-fname
    ldx #<fname
    ldy #>fname
    jsr $ffbd
    mark(3)
    jsr $ffc0          // OPEN
    mark(4)
    ldx #2
    jsr $ffc6          // CHKIN
    mark(5)
    ldy #0
rd: jsr $ffcf          // CHRIN from the file
    sta $c000,y
    iny
    cpy #20
    bne rd
    mark(6)
    jsr $ffb7          // READST
    mark(7)
    jsr $ffcc          // CLRCHN
    mark(8)
    lda #2
    jsr $ffc3          // CLOSE
    // LOAD "DATA",8,1
    mark(9)
    lda #1
    ldx #8
    ldy #1
    jsr $ffba
    lda #fname_end-fname
    ldx #<fname
    ldy #>fname
    jsr $ffbd
    mark(10)
    lda #0
    jsr $ffd5          // LOAD
    stx $c100
    sty $c101
    // CHROUT: clear, colours, reverse, insert/delete, long lines, scroll
    mark(11)
    ldx #0
pr: lda text,x
    beq prd
    jsr $ffd2
    inx
    bne pr
prd:
    ldy #30
pl: ldx #0
pl2: lda line,x
    beq pl3
    jsr $ffd2
    inx
    bne pl2
pl3: dey
    bne pl
    // GETIN from a keyboard buffer the harness fills
    ldx #0
kb: lda keys,x
    sta $0277,x
    inx
    cpx #4
    bne kb
    stx $c6
    mark(12)
    jsr $ffe4
    jsr $ffe4
    jsr $ffe4
    jsr $ffe4
    jsr $ffe4          // one more: buffer empty
    // CHRIN from the keyboard: the screen editor's line input
    ldx #0
kb2: lda keys2,x
    sta $0277,x
    inx
    cpx #6
    bne kb2
    stx $c6
    mark(13)
cin: jsr $ffcf
    cmp #13
    bne cin
    mark(14)
    ldx #5
    ldy #10
    clc
    jsr $fff0          // PLOT set
    sec
    jsr $fff0          // PLOT read
    mark(15)
    lda #1
    ldx #2
    ldy #3
    jsr $ffdb          // SETTIM
    mark(16)
    jsr $ffde          // RDTIM
    mark(17)
    jsr $ffe1          // STOP
    mark(18)
    jsr $ff9f          // SCNKEY
    mark(19)
    jsr $ffea          // UDTIM
    mark($ff)
done: jmp done

.encoding "petscii_upper"
fname: .text "DATA"
fname_end:
text: .byte $93, $05, $12
      .text "REVERSE"
      .byte $92, $0d, $1c
      .text "RED LINE LONGER THAN FORTY COLUMNS SO THE EDITOR LINKS TWO ROWS"
      .byte $0d, $94, $94, $14, $1d, $11, $91, $9d, $0d, $22
      .text "QUOTE"
      .byte $22, $0d, 0
line: .text "0123456789012345678901234567890123456789ABCDEFGHIJ"
      .byte $0d, 0
keys: .byte $41, $42, $43, $44
keys2: .byte $48, $49, $0d, $41, $42, $0d
