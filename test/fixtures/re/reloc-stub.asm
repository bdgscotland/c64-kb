// A relocator that copies itself from the stack page ($0100) to $8000, then
// SEI and JMP ($8000): the way Gridrunner's stub does (copy $0900->$8000,
// SEI, JMP ($8000), docs/superpowers/plans/2026-09-24-re-step2-commando.md
// Task 5). Tests c64_re_load_map's writer grouping: a small "install" loop
// (not in the stack page) copies the relocator's own bytes into $0100; the
// relocator then runs from there (in_stack_page: true) copying $0900-$09FF
// to $8000-$80FF, storing its own return pointer within $0100-$01FF too (a
// second dest_range for the same writer); the jump target then runs from
// $8000, its own separate writer (storing to $D021), which is the proof the
// jump landed on the copy, not the original at $0900.
BasicUpstart2(start)

reloc_src:
.pseudopc $0100 {
reloc:
    ldx #$00
copyloop:
    lda $0900,x
    sta $8000,x
    inx
    bne copyloop
    lda #$00
    sta ptr
    lda #$80
    sta ptr+1
    sei
    jmp (ptr)
ptr: .word 0
}
reloc_end:
.var reloc_len = reloc_end - reloc_src

start:
    ldx #$00
install:
    lda reloc_src,x
    sta $0100,x
    inx
    cpx #reloc_len
    bne install
    jmp $0100

* = $0900 "payload"
landed:
    inc $d021
loop:
    inc $d021
    clc
    bcc loop
