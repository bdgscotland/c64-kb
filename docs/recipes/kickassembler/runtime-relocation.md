---
recipe: runtime-relocation
toolchain: kickassembler
output_format: PRG
region: both
techniques: [runtime_relocation]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD0E]
uses_kernal: [CHROUT]
claims: [vic_raster_irq (init), zero_page $22-$2D+$FB-$FE (owns)]
harness: [cia2_timer_a, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler — Run-Time Overlay Relocation

## Synopsis

One overlay (a stand-in for a level script or a boss routine) is
assembled twice in the same source, at logical origins `$3000` and
`$3100`, with `.pseudopc`. At start-up the program diffs the two images
into a relocation table: every byte that is exactly one higher in the
second image is the high byte of an address inside the overlay. It then
takes two blocks from a page heap, copies the `$3000` image into each
(standing in for a disk load), adds the page delta to every listed byte,
and calls both copies through the jump table at the overlay's offset 0.
Each copy fills its own buffer from its own table, sums the buffer
through an address word stored in the overlay, and returns the high byte
of its buffer from an immediate `#>buf`. Each of those paths fails if its
byte was not relocated. The program prints the overlay size, the number
of bytes relocated, the two load addresses, the cycles for the diff and
for one relocation, the cycles per relocated byte, and the verdict:
`$02FF` = `$01` and a green border on a pass, `$02FF` = `$02` and a red
border on a fail. In a shipped game the diff runs on the host (the
Python script under Build) and only the `$3000` image and the table go
on disk; the recipe does it on the C64 so that one listing builds and
checks the whole method.

## Source

```asm
// runtime-relocation.asm
// A code overlay is assembled twice inside this one source, at logical
// origins $3000 and $3100 (.pseudopc). At start-up the program diffs the
// two images: a byte that is one higher in the second image is the high
// byte of an address inside the overlay, and its offset goes into the
// relocation table. It then takes two blocks from a page heap, copies the
// $3000 image into each (standing in for a disk load), adds the page delta
// to every listed byte, and calls each copy through its jump table.
// Prints the table size, the two load pages, the relocation cost and the
// verdict: $02FF = $01 and a green border when both copies return the
// right checksums and buffer pages, $02FF = $02 and a red border otherwise.

BasicUpstart2(start)

.const CHROUT    = $ffd2
.const RESULT    = $02ff          // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const ORG_A     = $3000          // origin of the image that is shipped
.const ORG_B     = $3100          // second origin, one page up: diff only
.const HEAP_LO   = $40            // heap pages $40..$7F
.const HEAP_HI   = $80
.const BUFLEN    = 128
.const KEY1     = $00
.const KEY2     = $5a
.const FORCE_FAULT = 0            // 1: skip the last table entry (red case)

// zero page. The program never returns to BASIC, so $22-$2B is free.
.const pa   = $22                 // image A pointer (diff, copy source)
.const pb   = $24                 // image B pointer (diff)
.const pd   = $26                 // copy destination
.const rp   = $28                 // relocation byte pointer
.const vec  = $2a                 // entry-point vector for JMP (vec)
.const dpage = $2c                // page the overlay is being relocated to
.const delta = $2d                // dpage - >ORG_A
.const optr = $fb                 // pointer the overlay itself uses
.const sptr = $fd                 // puts pointer

// ---------------------------------------------------------------------------
// The overlay. Offsets 0, 3 and 6 are its jump table; nothing outside it
// knows any other address inside it.
//   entry 0 FILL  : A = key. buf[i] = tab[i] EOR key.
//   entry 1 SUM   : A/X = 16-bit sum of buf, read through the address word
//                   bufptr (a data table holding an internal address).
//   entry 2 WHERE : A = high byte of buf, from an immediate #>buf.
// ---------------------------------------------------------------------------
.macro Overlay() {
    jmp fill
    jmp sum
    jmp where
fill:
    sta key                      // absolute store into the overlay
    ldx #BUFLEN - 1
!:  lda tab,x                     // absolute,X read of its own table
    eor key
    sta buf,x
    dex
    bpl !-
    rts
sum:
    lda bufptr                    // pointer taken from an address table
    sta optr
    lda bufptr + 1
    sta optr + 1
    lda #0
    sta acc
    sta acc + 1
    tay
!:  lda (optr),y
    jsr add                       // absolute JSR inside the overlay
    iny
    cpy #BUFLEN
    bne !-
    lda acc
    ldx acc + 1
    rts
add:
    clc
    adc acc
    sta acc
    bcc !+
    inc acc + 1
!:  rts
where:
    lda #>buf                     // immediate high byte of an internal label
    rts
key:   .byte 0
acc:    .word 0
bufptr: .word buf
tab:    .fill BUFLEN, (i * 37 + 11) & $ff
buf:    .fill BUFLEN, 0
end:
}

// expected SUM results, worked out by the assembler
.function sumFor(s) {
    .var t = 0
    .for (var i = 0; i < BUFLEN; i++) {
        .eval t = t + (((i * 37 + 11) & $ff) ^ s)
    }
    .return t & $ffff
}
.const EXP1 = sumFor(KEY1)
.const EXP2 = sumFor(KEY2)

// Time(routine, slot): CIA2 timer A counts phi2 from $FFFF; 16-bit count.
.macro Time(routine, slot) {
    lda #$11                      // CRA: start, force load, count phi2
    sta $dd0e
    jsr routine
    lda #$00
    sta $dd0e                     // stop
    sec
    lda #$ff
    sbc $dd04
    sta slot
    lda #$ff
    sbc $dd05
    sta slot + 1
}

.macro Print(text) {
    ldx #<text
    ldy #>text
    jsr puts
}

start:
    sei
    lda #$00
    sta $dd0e
    lda #$ff                      // timer A latch = $FFFF
    sta $dd04
    sta $dd05
    lda $d011                     // screen off: no badlines in timed code
    and #$ef
    sta $d011
!:  lda $d011
    bpl !-
!:  lda $d011
    bmi !-

    lda #0
    sta fails
    Time(nothing, t_empty)
    Time(mktable, t_diff)

    // heap: two overlay-sized blocks
    lda #HEAP_LO
    sta hnext
    jsr alloc
    sta slot1
    jsr alloc
    sta slot2

    lda slot1
    jsr load
    lda slot1
    sta dpage
    Time(relocate, t_rel)
    lda slot2
    jsr load
    lda slot2
    sta dpage
    jsr relocate

    lda $d011                     // screen back on
    ora #$10
    sta $d011
    cli

    // exercise both copies: fill both, then read each back
    lda #0                        // entry 0 of copy 1: FILL
    ldx slot1
    ldy #KEY1
    jsr call
    lda #0
    ldx slot2
    ldy #KEY2
    jsr call
    lda #3                        // entry 1: SUM
    ldx slot1
    jsr call
    cmp #<EXP1
    bne bad1
    cpx #>EXP1
    beq !+
bad1: inc fails
!:  lda #3
    ldx slot2
    jsr call
    cmp #<EXP2
    bne bad2
    cpx #>EXP2
    beq !+
bad2: inc fails
!:  lda #6                        // entry 2: WHERE
    ldx slot1
    jsr call
    sec
    sbc slot1
    cmp #>(BUF_OFF)
    beq !+
    inc fails
!:  lda #6
    ldx slot2
    jsr call
    sec
    sbc slot2
    cmp #>(BUF_OFF)
    beq !+
    inc fails
!:  lda bad                       // a byte that moved by other than one
    beq !+
    inc fails
!:
    // net relocation cycles, then cycles per relocated byte
    sec
    lda t_rel
    sbc t_empty
    sta t_rel
    sta num
    lda t_rel + 1
    sbc t_empty + 1
    sta t_rel + 1
    sta num + 1
    sec
    lda t_diff
    sbc t_empty
    sta t_diff
    lda t_diff + 1
    sbc t_empty + 1
    sta t_diff + 1

    lda fails
    bne fail
    lda #CODE_PASS
    ldy #5                        // green
    bne verdict
fail:
    lda #CODE_FAIL
    ldy #2                        // red
verdict:
    sta RESULT
    sty BORDER

    Print(txt_size)
    lda #>OVL_SIZE
    jsr hexbyte
    lda #<OVL_SIZE
    jsr hexbyte
    lda #$0d
    jsr CHROUT
    Print(txt_bytes)
    lda rcount
    sta num
    lda #0
    sta num + 1
    jsr putdec
    Print(txt_slots)
    lda slot1
    jsr hexbyte
    lda #0
    jsr hexbyte
    lda #' '
    jsr CHROUT
    lda slot2
    jsr hexbyte
    lda #0
    jsr hexbyte
    lda #$0d
    jsr CHROUT
    Print(txt_diff)
    lda t_diff
    sta num
    lda t_diff + 1
    sta num + 1
    jsr putdec
    Print(txt_rel)
    lda t_rel
    sta num
    lda t_rel + 1
    sta num + 1
    jsr putdec
    Print(txt_per)
    jsr divide                    // quo = t_rel / rcount
    lda quo
    sta num
    lda #0
    sta num + 1
    jsr putdec
    Print(txt_res)
    lda RESULT
    jsr hexbyte
    lda RESULT
    cmp #CODE_PASS
    beq !+
    Print(txt_fail)
    jmp *
!:  Print(txt_pass)
    jmp *

nothing:
    rts

// ---------------------------------------------------------------------------
// mktable: walk both images; where B = A + 1, record the offset. A byte that
// differs by anything else is counted in bad (it cannot be page-relocated).
// ---------------------------------------------------------------------------
mktable:
    lda #0
    sta rcount
    sta bad
    sta off
    sta off + 1
    lda #<imgA
    sta pa
    lda #>imgA
    sta pa + 1
    lda #<imgB
    sta pb
    lda #>imgB
    sta pb + 1
    ldy #0
mt_loop:
    lda off
    cmp #<OVL_SIZE
    lda off + 1
    sbc #>OVL_SIZE
    bcs mt_done
    lda (pb),y
    sec
    sbc (pa),y
    beq mt_next
    cmp #1
    bne mt_bad
    ldx rcount
    lda off
    sta off_lo,x
    lda off + 1
    sta off_hi,x
    inc rcount
    jmp mt_next
mt_bad:
    inc bad
mt_next:
    inc pa
    bne !+
    inc pa + 1
!:  inc pb
    bne !+
    inc pb + 1
!:  inc off
    bne mt_loop
    inc off + 1
    jmp mt_loop
mt_done:
.if (FORCE_FAULT != 0) {
    dec rcount
}
    rts

// ---------------------------------------------------------------------------
// alloc: bump allocator by whole pages. Returns the first page in A.
// No bounds failure path here: two blocks fit by construction.
// ---------------------------------------------------------------------------
alloc:
    lda hnext
    pha
    clc
    adc #OVL_PAGES
    sta hnext
    pla
    rts

// load: copy OVL_SIZE bytes of image A to page A (stands in for a LOAD)
load:
    sta pd + 1
    lda #0
    sta pd
    lda #<imgA
    sta pa
    lda #>imgA
    sta pa + 1
    ldx #>OVL_SIZE                // whole pages first
    ldy #0
!:  cpx #0
    beq ld_tail
!:  lda (pa),y
    sta (pd),y
    iny
    bne !-
    inc pa + 1
    inc pd + 1
    dex
    jmp !--
ld_tail:
!:  cpy #<OVL_SIZE
    beq ld_done
    lda (pa),y
    sta (pd),y
    iny
    jmp !-
ld_done:
    rts

// ---------------------------------------------------------------------------
// relocate: for each table entry, (dpage:off) += dpage - >ORG_A.
// The destination is page-aligned, so an offset's low byte is the pointer's
// low byte and only the high byte needs an add.
// ---------------------------------------------------------------------------
relocate:
    sec
    lda dpage
    sbc #>ORG_A
    sta delta
    ldx #0
    ldy #0
    cpx rcount
    beq rl_done
rl_loop:
    lda off_lo,x                  // 4
    sta rp                        // 3
    lda off_hi,x                  // 4
    clc                           // 2
    adc dpage                     // 3 (dpage is in zero page)
    sta rp + 1                    // 3
    lda (rp),y                    // 5
    clc                           // 2
    adc delta                     // 3
    sta (rp),y                    // 6
    inx                           // 2
    cpx rcount                    // 4 (rcount is absolute)
    bne rl_loop                   // 3 taken
rl_done:
    rts

// call: entry offset in A, overlay page in X, argument in Y
call:
    sta vec
    stx vec + 1
    tya
    jmp (vec)

// divide: quo = t_rel / rcount (16 by 8, quotient fits in 8 bits here)
divide:
    lda #0
    sta quo
    lda t_rel
    sta num
    lda t_rel + 1
    sta num + 1
!:  sec
    lda num
    sbc rcount
    tax
    lda num + 1
    sbc #0
    bcc !+
    sta num + 1
    stx num
    inc quo
    jmp !-
!:  rts

// ---------------------------------------------------------------------------
// output helpers
// ---------------------------------------------------------------------------
puts:
    stx sptr
    sty sptr + 1
    ldy #0
!:  lda (sptr),y
    beq !+
    jsr CHROUT
    iny
    bne !-
!:  rts

putdec:                           // print the 16-bit value in num, decimal
    ldx #0
    stx lead
pd_digit:
    lda #'0' - 1
    sta dig
!:  inc dig
    sec
    lda num
    sbc pow10,x
    sta num
    lda num + 1
    sbc pow10 + 1,x
    sta num + 1
    bcs !-
    lda num
    adc pow10,x
    sta num
    lda num + 1
    adc pow10 + 1,x
    sta num + 1
    lda dig
    cmp #'0'
    bne pd_show
    cpx #4 * 2
    beq pd_show
    lda lead
    beq pd_next
    lda #'0'
pd_show:
    jsr CHROUT
    inc lead
pd_next:
    inx
    inx
    cpx #5 * 2
    bne pd_digit
    lda #$0d
    jmp CHROUT

hexbyte:
    pha
    lsr
    lsr
    lsr
    lsr
    jsr hexdigit
    pla
    and #$0f
hexdigit:
    cmp #10
    bcc !+
    adc #6
!:  adc #'0'
    jmp CHROUT

pow10:  .word 10000, 1000, 100, 10, 1

.encoding "petscii_upper"
txt_size:  .text "OVERLAY SIZE $"
           .byte 0
txt_bytes: .text "RELOC BYTES "
           .byte 0
txt_slots: .text "LOADED AT $"
           .byte 0
txt_diff:  .text "DIFF CYCLES "
           .byte 0
txt_rel:   .text "RELOC CYCLES "
           .byte 0
txt_per:   .text "PER BYTE "
           .byte 0
txt_res:   .text "RESULT "
           .byte 0
txt_pass:  .text " PASS"
           .byte $0d, 0
txt_fail:  .text " FAIL"
           .byte $0d, 0

hnext:   .byte 0
slot1:   .byte 0
slot2:   .byte 0
rcount:  .byte 0
bad:     .byte 0
fails:   .byte 0
quo:     .byte 0
off:     .word 0
num:     .word 0
dig:     .byte 0
lead:    .byte 0
t_empty: .word 0
t_diff:  .word 0
t_rel:   .word 0
off_lo:  .fill 256, 0             // the relocation table, built by mktable
off_hi:  .fill 256, 0

// the two images of the same overlay
imgA:
ovA: .pseudopc ORG_A { Overlay() }
imgB:
ovB: .pseudopc ORG_B { Overlay() }
imgEnd:

.label OVL_SIZE  = imgB - imgA
.label OVL_PAGES = (OVL_SIZE + 255) >> 8
.label BUF_OFF   = OVL_SIZE - BUFLEN   // buf is the last thing in the overlay
.assert "images are the same size", imgEnd - imgB, OVL_SIZE
```

## Build

```bash
java -jar KickAss.jar runtime-relocation.asm -o runtime-relocation.prg -showmem -symbolfile
```

Produces `runtime-relocation.prg`, 2,260 bytes, `$080e` to `$10d2`
(KickAssembler 5.25, `-showmem`). The two overlay images are the last
680 bytes: `imgA` at `$0e2b` and `imgB` at `$0f7f`, 340 bytes each
(`runtime-relocation.sym`). The relocation table (`off_lo`, `off_hi`)
is built in RAM at start-up.

For a shipped overlay, build the two images as separate binaries and
make the table on the host. This script does the same diff as `mktable`
and refuses a byte that moved by anything other than one. It was run
here on the two images cut out of the recipe's PRG with the symbol file
and reported `19 bytes to relocate in a 340-byte overlay`, the same
offsets the C64 found.

```python
# reloctable.py: diff two builds of one overlay, one page apart, into a
# relocation table. usage: python3 reloctable.py ovl_a.bin ovl_b.bin table.bin
import sys
a = open(sys.argv[1], 'rb').read()
b = open(sys.argv[2], 'rb').read()
if len(a) != len(b):
    sys.exit('images differ in length: %d vs %d' % (len(a), len(b)))
offsets = []
for i, (x, y) in enumerate(zip(a, b)):
    d = (y - x) & 0xff
    if d == 1:
        offsets.append(i)
    elif d != 0:
        sys.exit('offset $%04x moved by %d: not a page-relocatable byte' % (i, d))
if len(offsets) > 255:
    sys.exit('%d entries: the 8-bit count in the loader overflows' % len(offsets))
# table layout: count, then the low bytes, then the high bytes
out = bytes([len(offsets)]) + bytes(o & 0xff for o in offsets) + bytes(o >> 8 for o in offsets)
open(sys.argv[3], 'wb').write(out)
print('%d bytes to relocate in a %d-byte overlay' % (len(offsets), len(a)))
```

## Expected output

Border green. Screen rows 7 to 13:

```text
OVERLAY SIZE $0154
RELOC BYTES 19
LOADED AT $4000 4200
DIFF CYCLES 19077
RELOC CYCLES 855
PER BYTE 45
RESULT 01 PASS
```

Screenshots from the pinned run, 8,000,000 cycles:
`screenshots/runtime-relocation.png` (PAL) and
`screenshots/runtime-relocation-ntsc.png` (NTSC). Measured on both: the
seven lines above on rows 7 to 13, decoded from the screenshots against
the character ROM; border pixel (2, 100) = (98, 213, 50) on PAL and
(114, 189, 103) on NTSC, index 5 in both palettes of
`runtime/vice-reference.md`. The pinned command was run twice per model
and the two PNGs were identical bytes. The counts match on both models
because the timed code runs with the screen blanked and interrupts off,
so no cycles are stolen.

| Line | What was timed | Cycles | Per byte |
|---|---|---|---|
| `DIFF` | `mktable`: walk 340 bytes of both images, record 19 offsets | 19,077 | 56.1 per image byte; host-side work in a real game |
| `RELOC` | `relocate` for one copy: 19 entries | 855 | 45.0 per relocated byte, fixed cost included |

`RELOC` is exactly the arithmetic from the listing: 20 cycles before the
loop, 44 per entry (the cycle comments on `rl_loop`), less 1 for the
last untaken branch: 20 + 19 × 44 − 1 = 855. The harness cost (an empty
`JSR`/`RTS`, timed first) is subtracted from both counts. Keeping
`rcount` in zero page would make an entry 43 cycles.

The 19 bytes are: the three `JMP` operands of the jump table; fourteen
absolute operands in the code (`STA key`, `LDA tab,X`, `EOR key`,
`STA buf,X`, the two `LDA bufptr`, `JSR add` and seven accesses to
`acc`); the immediate `#>buf`; and the high byte of the `.word buf`
address table.

The red case, `.const FORCE_FAULT = 1`, was run once on PAL and not
pinned. It drops the last table entry, the high byte of `bufptr`, so
both copies' `SUM` read their buffer at `$30d4`, where nothing was
loaded. The screen showed `RELOC BYTES 18`, `RELOC CYCLES 811` and
`RESULT 02 FAIL` on row 13, border (175, 60, 88), index 2.

## Why this works

Assembling at `$3000` and `$3100` changes exactly the bytes that encode
the high half of an address inside the overlay, and changes each by one.
Low bytes do not change, because the two origins are a whole page apart.
Zero-page operands (`optr`), addresses outside the overlay and
constants do not change, so the diff leaves them alone
without being told. The diff also catches what an instruction
walker misses: the immediate `#>buf` and the high byte inside the data
word `bufptr`.

Relocation is then one add per listed byte: `delta` = destination page
− `$30`, added to the byte at destination page + offset. The heap hands
out whole pages (`alloc` is a bump pointer), so every overlay byte keeps
its offset within its page: page-aligned tables stay aligned and no
branch or indexed read gains or loses a page-crossing cycle. The host
knows only the overlay's page and the jump-table offsets 0, 3 and 6;
`call` builds the target in the zero-page word `vec` and jumps through
it, so the vector is never at `$xxFF`.

`mktable` counts a byte that moved by anything other than one in `bad`,
and a non-zero `bad` fails the run. That is where an expression such as
`buf / 64` would show up: it moves by some other amount, and page
relocation cannot fix it.
