// A $0314 handler that is JMP ($033C); each of three parts re-arms $D012
// and points $033C/$033D at the next part before it returns.
.const ptr = $033c
BasicUpstart2(start)
start: sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    lda #<part1
    sta ptr
    lda #>part1
    sta ptr+1
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #$1b
    sta $d011
    lda #50
    sta $d012
    lda #$ff
    sta $d019
    lda #1
    sta $d01a
    cli
loop: jmp loop
irq: jmp (ptr)
part1: lda #1
    sta $d019
    lda #120
    sta $d012
    lda #<part2
    sta ptr
    lda #>part2
    sta ptr+1
    jmp $ea81
part2: lda #1
    sta $d019
    lda #200
    sta $d012
    lda #<part3
    sta ptr
    lda #>part3
    sta ptr+1
    jmp $ea81
part3: lda #1
    sta $d019
    lda #50
    sta $d012
    lda #<part1
    sta ptr
    lda #>part1
    sta ptr+1
    jmp $ea81
