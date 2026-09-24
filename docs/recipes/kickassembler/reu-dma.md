---
recipe: reu-dma
toolchain: kickassembler
output_format: PRG
region: both
techniques: [reu_dma]
file_formats: [PRG]
uses_registers: [DF00, DF01, DF02, DF03, DF04, DF05, DF06, DF07, DF08, DF09, DF0A, D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D011, D012, D015, D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler — REU DMA: detect, stash, fetch, fill, swap, verify

## Synopsis

A test bench for a 17xx RAM Expansion Unit. It detects the REU, then
runs each transfer type once and checks the result with the CPU: stash a
4 KB block, fetch 1,000 bytes into screen RAM, fill colour RAM from one
REU byte (REU address fixed), swap two 4 KB blocks, verify two blocks,
and verify once more after changing one byte on purpose to read the
fault bit and the stop address. It fetches 4 KB into the RAM under I/O
with the `$FF00` trigger and stashes 64 KB from one C64 byte (C64
address fixed). Every transfer is timed with the CIA2 timers: with the
screen blanked, with the screen on, and with eight sprites on. The
program prints the counts, cycles per byte for the 4 KB and 64 KB
transfers, and a verdict: `$02FF` = `$01` and a green border when every
check passed, `$02FF` = `$02` and a red border otherwise. Last, it
fetches the pattern into screen rows 17 to 24 and colours them yellow
from the REU, so the screenshot shows both transfers. The technique is
`reu_dma` in `techniques/memory-banking.md`.

## Source

```asm
// reu-dma.asm
// Detects a 17xx REU, then drives each transfer type and checks it with
// the CPU: stash a 4 KB block, fetch 1,000 bytes into screen RAM, fill
// colour RAM from one REU byte (REU address fixed), swap two 4 KB blocks,
// verify a block (and report the fault bit on a byte changed on purpose),
// fetch 4 KB into the RAM under I/O with the $FF00 trigger, and stash
// 64 KB from one C64 byte (C64 address fixed) with the screen blanked and
// with it on. Each transfer is timed with the CIA2 timers. Prints the
// cycle counts, cycles per byte for the 4 KB and 64 KB transfers, and the
// verdict: $02FF = $01 and a green border when every check passed, $02FF
// = $02 and a red border otherwise. Then it fetches a pattern into the
// lower screen rows and colours them from the REU, so the screenshot
// shows both.

BasicUpstart2(start)

.const CHROUT   = $ffd2
.const RESULT   = $02ff
.const BORDER   = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const REU_STATUS = $df00
.const REU_CMD    = $df01
.const REU_C64    = $df02        // lo, hi
.const REU_REU    = $df04        // lo, hi, bank
.const REU_LEN    = $df07        // lo, hi; 0 = 65,536
.const REU_IMASK  = $df09
.const REU_ACTRL  = $df0a

// $DF01 command bytes. Bit 7 execute, bit 4 set = start now (clear = wait
// for a write to $FF00), bits 1-0 the transfer type.
.const STASH  = $90              // C64 -> REU
.const FETCH  = $91              // REU -> C64
.const SWAP   = $92
.const VERIFY = $93
.const FETCH_FF00 = $81          // REU -> C64, deferred to a write of $FF00

// $DF0A address control
.const NOFIX  = $00
.const FIXC64 = $80
.const FIXREU = $40

.const BLOCK_A = $3000           // 4 KB, pattern A
.const BLOCK_B = $4000           // 4 KB, pattern B = A EOR $FF
.const SCREEN  = $0400
.const COLRAM  = $d800
.const POKE_AT = $0abc           // offset of the byte changed before the failing verify
.const LOWROW  = 17              // first screen row of the final visible fetch
.const FILLCOL = 7               // yellow

.const ptr  = $fb
.const ptr2 = $fd

// Reu(c64, reuaddr, bank, len, ctrl): load the address, length and
// address-control registers. The command is written separately.
.macro Reu(c64, reuaddr, bank, len, ctrl) {
    lda #<c64
    sta REU_C64
    lda #>c64
    sta REU_C64+1
    lda #<reuaddr
    sta REU_REU
    lda #>reuaddr
    sta REU_REU+1
    lda #bank
    sta REU_REU+2
    lda #<len
    sta REU_LEN
    lda #>len
    sta REU_LEN+1
    lda #ctrl
    sta REU_ACTRL
}

// Time(routine, slot): CIA2 timer A counts phi2, timer B counts A's
// underflows; slot receives the 24-bit elapsed count.
.macro Time(routine, slot) {
    lda #$51
    sta $dd0f
    lda #$11
    sta $dd0e
    jsr routine
    lda #$00
    sta $dd0e
    sta $dd0f
    lda #$ff
    sbc $dd04
    sta slot
    lda #$ff
    sbc $dd05
    sta slot+1
    lda #$ff
    sbc $dd06
    sta slot+2
}

// Go(command, slot): time "write command to $DF01", net of the harness.
.macro Go(command, slot) {
    lda #command
    sta cmd
    Time(exec, slot)
    Net(slot)
}

.macro Net(slot) {
    sec
    lda slot
    sbc empty
    sta slot
    lda slot+1
    sbc empty+1
    sta slot+1
    lda slot+2
    sbc empty+2
    sta slot+2
}

.macro Fail(bit) {
    lda failmask
    ora #bit
    sta failmask
}

.macro Line(text, slot) {
    ldx #<text
    ldy #>text
    jsr puts
    ldx #<slot
    ldy #>slot
    jsr putdec
}

// Nl(): end the line
.macro Nl() {
    lda #$0d
    jsr CHROUT
}

// PerByte(slot, shift): print slot * 25 >> shift as d.dd; with shift 10
// that is cycles per byte of a 4,096-byte transfer, with 14 of a 65,536.
.macro PerByte(slot, shift) {
    ldx #<slot
    ldy #>slot
    lda #shift
    jsr perbyte
}

start:
    sei
    lda #$00
    sta failmask
    sta $dd0e
    sta $dd0f
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07
    lda #$93                     // clear the screen before anything lands on it
    jsr CHROUT

    // --- detection: write 1..7 to $DF02-$DF08, read them back; $DF06 is
    // compared on bits 2-0 only (bits 7-3 read back as 1 in VICE 512 KB)
    ldx #$00
!:  txa
    clc
    adc #$01
    sta REU_C64,x
    inx
    cpx #$07
    bne !-
    ldx #$00
!:  lda REU_C64,x
    sta seen,x
    inx
    cpx #$07
    bne !-
    ldx #$00
    stx found
!:  lda seen,x
    and detmask,x                // the bank register keeps only its low bits
    sta cmpv
    txa
    clc
    adc #$01
    cmp cmpv
    bne detected
    inx
    cpx #$07
    bne !-
    inc found                    // all seven read back
detected:
    lda found
    bne reu_present
    jsr showdet
    ldx #<noreutext
    ldy #>noreutext
    jsr puts
    lda #CODE_FAIL
    sta RESULT
    lda #2
    sta BORDER
    cli
    rts
reu_present:
    sei                          // CHROUT to the screen ends with CLI; mask again

    // --- patterns A at $3000 and B = A EOR $FF at $4000 ------------------
    ldx #$00
!:
.for (var p = 0; p < 16; p++) {
    txa
    eor #(p * 37 + 11) & $ff
    sta BLOCK_A + p * 256,x
    eor #$ff
    sta BLOCK_B + p * 256,x
}
    inx
    beq !+
    jmp !-
!:
    lda #$00
    sta REU_IMASK                // no REU interrupts
    lda REU_STATUS               // reading clears the fault bit (codebase64)

    // screen off; DEN is sampled on line $30, so wait for the next frame
    lda $d011
    and #$ef
    sta $d011
    jsr newframe

    Time(nothing, empty)

    // --- 1-byte stash: the fixed cost of one command -------------------
    Reu(colbyte, $0000, 2, 1, NOFIX)
    Go(STASH, t_one)             // REU 2:0000 = the fill colour, used below
    lda REU_STATUS
    sta status                   // after a completed stash

    // --- stash A to REU 0:0000 and B to REU 1:0000 ---------------------
    Reu(BLOCK_A, $0000, 0, $1000, NOFIX)
    Go(STASH, t_stash)
    Reu(BLOCK_B, $0000, 1, $1000, NOFIX)
    Go(STASH, t_tmp)

    // --- fetch 1,000 bytes of A into screen RAM -------------------------
    Reu(SCREEN, $0000, 0, 1000, NOFIX)
    Go(FETCH, t_fetch)
    ldx #<SCREEN
    ldy #>SCREEN
    lda #>BLOCK_A
    jsr cmp1000
    beq !+
    Fail($01)
!:

    // --- fill colour RAM from one REU byte (REU address fixed) ----------
    Reu(COLRAM, $0000, 2, 1000, FIXREU)
    Go(FETCH, t_fill)
    lda #>COLRAM
    sta ptr+1
    lda #<COLRAM
    sta ptr
    ldx #4                       // 4 x 250
    ldy #$00
!:  lda (ptr),y
    and #$0f
    cmp #FILLCOL
    bne fillbad
    iny
    cpy #250
    bne !-
    ldy #$00
    clc
    lda ptr
    adc #250
    sta ptr
    bcc !+
    inc ptr+1
!:  dex
    bne !--
    beq filled
fillbad:
    Fail($02)
filled:

    // --- swap C64 $3000 (A) with REU 1:0000 (B), check, swap back ------
    Reu(BLOCK_A, $0000, 1, $1000, NOFIX)
    Go(SWAP, t_swap)
    lda #>BLOCK_A
    ldx #>BLOCK_B
    jsr cmp4k                    // $3000 must now hold B
    beq !+
    Fail($04)
!:  Reu(BLOCK_A, $0000, 1, $1000, NOFIX)
    Go(SWAP, t_tmp)              // A back in C64, B back in REU bank 1

    // --- verify: A against REU 0, B against REU 1, then a changed byte --
    lda REU_STATUS
    Reu(BLOCK_A, $0000, 0, $1000, NOFIX)
    Go(VERIFY, t_verify)
    lda REU_STATUS
    and #$20
    beq !+
    Fail($08)
!:  Reu(BLOCK_B, $0000, 1, $1000, NOFIX)
    Go(VERIFY, t_tmp)
    lda REU_STATUS
    and #$20
    beq !+
    Fail($08)
!:  lda BLOCK_A + POKE_AT
    eor #$ff
    sta BLOCK_A + POKE_AT
    Reu(BLOCK_A, $0000, 0, $1000, NOFIX)
    Go(VERIFY, t_tmp)
    lda REU_STATUS
    sta vstatus
    lda REU_C64
    sta vaddr
    lda REU_C64+1
    sta vaddr+1
    lda BLOCK_A + POKE_AT        // put the byte back
    eor #$ff
    sta BLOCK_A + POKE_AT
    lda vstatus
    and #$20
    bne !+
    Fail($10)                    // the fault bit did not come up
!:

    // --- $FF00 trigger: fetch A into the RAM under I/O -------------------
    Reu($d000, $0000, 0, $1000, NOFIX)
    lda #FETCH_FF00
    sta REU_CMD                  // armed; nothing moves yet
    lda #$34                     // RAM at $D000-$DFFF (and $A000, $E000)
    sta $01
    lda $ff00                    // the write, not the value, starts the DMA
    sta $ff00
    lda #>$d000
    ldx #>BLOCK_A
    jsr cmp4k
    php
    lda #$37
    sta $01
    plp
    beq !+
    Fail($20)
!:

    // --- 64 KB stash from one C64 byte (C64 address fixed) -------------
    Reu(BLOCK_A, $0000, 3, $0000, FIXC64)
    Go(STASH, t_64off)
    lda REU_STATUS
    Reu(BLOCK_A, $0000, 3, $0000, FIXC64)
    Go(VERIFY, t_tmp)            // all 65,536 REU bytes equal BLOCK_A[0]
    lda REU_STATUS
    and #$20
    beq !+
    Fail($40)
!:
    lda $d011                    // screen on, then time the same stash
    ora #$10
    sta $d011
    jsr newframe
    Reu(BLOCK_A, $0000, 3, $0000, FIXC64)
    Go(STASH, t_64on)

    // sprite DMA on top: all eight sprites on lines 100-120, same stash
    lda #$ff
    sta $d015
    ldx #$0e
!:  txa
    asl
    asl
    asl
    adc #$30
    sta $d000,x                  // X = $30 + 16 * n
    lda #100
    sta $d001,x
    dex
    dex
    bpl !-
    jsr newframe
    Reu(BLOCK_A, $0000, 3, $0000, FIXC64)
    Go(STASH, t_64spr)
    lda #$00
    sta $d015

    // --- report ---------------------------------------------------------
    lda #$93
    jsr CHROUT
    jsr showdet
    ldx #<stattext
    ldy #>stattext
    jsr puts
    lda status
    jsr hexbyte
    Line(onetext, t_one)
    Nl()
    Line(stashtext, t_stash)
    PerByte(t_stash, 10)
    Nl()
    Line(fetchtext, t_fetch)
    Nl()
    Line(filltext, t_fill)
    Nl()
    Line(swaptext, t_swap)
    PerByte(t_swap, 10)
    Nl()
    Line(veritext, t_verify)
    PerByte(t_verify, 10)
    Nl()
    ldx #<errtext
    ldy #>errtext
    jsr puts
    lda vstatus
    jsr hexbyte
    ldx #<attext
    ldy #>attext
    jsr puts
    lda vaddr+1
    jsr hexbyte
    lda vaddr
    jsr hexbyte
    Nl()
    Line(offtext, t_64off)
    PerByte(t_64off, 14)
    Nl()
    Line(ontext, t_64on)
    PerByte(t_64on, 14)
    Nl()
    Line(sprtext, t_64spr)
    PerByte(t_64spr, 14)
    Nl()

    // --- visible: fetch A into rows 17-24, colour them from the REU -----
    Reu(SCREEN + LOWROW * 40, $0000, 0, (25 - LOWROW) * 40, NOFIX)
    lda #FETCH
    sta REU_CMD
    Reu(COLRAM + LOWROW * 40, $0000, 2, (25 - LOWROW) * 40, FIXREU)
    lda #FETCH
    sta REU_CMD

    lda failmask
    beq pass
    lda #CODE_FAIL
    ldy #2
    bne verdict
pass:
    lda #CODE_PASS
    ldy #5
verdict:
    sta RESULT
    sty BORDER
    ldx #<restext
    ldy #>restext
    jsr puts
    lda RESULT
    jsr hexbyte
    ldx #<passtext
    ldy #>passtext
    lda failmask
    beq !+
    ldx #<failtext
    ldy #>failtext
!:  jsr puts
    ldx #<masktext
    ldy #>masktext
    jsr puts
    lda failmask
    jsr hexbyte
    lda #$0d
    jsr CHROUT
    cli
    rts

// showdet: print the seven bytes read back and YES or NO
showdet:
    ldx #<dettext
    ldy #>dettext
    jsr puts
    ldx #$00
!:  lda seen,x
    jsr hexbyte
    lda #' '
    jsr CHROUT
    inx
    cpx #$07
    bne !-
    ldx #<yestext
    ldy #>yestext
    lda found
    bne !+
    ldx #<notext
    ldy #>notext
!:  jmp puts

exec:
    lda cmd
    sta REU_CMD
nothing:
    rts

newframe:                        // wait until the raster wraps to line 0
!:  lda $d011
    bpl !-
!:  lda $d011
    bmi !-
!:  lda $d012
    bne !-
    rts

// cmp1000: compare 1,000 bytes at Y:X with 1,000 from page A; Z set if equal
cmp1000:
    stx ptr
    sty ptr+1
    sta ptr2+1
    lda #$00
    sta ptr2
    ldx #3                       // three whole pages
    ldy #$00
!:  lda (ptr),y
    cmp (ptr2),y
    bne c1done
    iny
    bne !-
    inc ptr+1
    inc ptr2+1
    dex
    bne !-
!:  lda (ptr),y                  // then the last 232 bytes
    cmp (ptr2),y
    bne c1done
    iny
    cpy #1000 - 768
    bne !-
    lda #$00                     // Z set: equal
c1done:
    rts

// cmp4k: compare 16 pages starting at page A with 16 starting at page X;
// Z set if equal
cmp4k:
    sta c4a+2
    stx c4b+2
    ldx #16
    ldy #$00
c4a:
    lda $ff00,y
c4b:
    cmp $ff00,y
    bne c4done
    iny
    bne c4a
    inc c4a+2
    inc c4b+2
    dex
    bne c4a
c4done:
    rts

// perbyte: num = slot(Y:X) * 25 >> A, printed as d.dd
perbyte:
    sta shift
    stx ptr
    sty ptr+1
    ldy #$00
!:  lda (ptr),y
    sta num,y
    sta x1,y
    iny
    cpy #3
    bne !-
    ldx #3                       // num = x * 8
!:  asl num
    rol num+1
    rol num+2
    dex
    bne !-
    clc                          // x1 = x + 8x
    ldy #$00
    ldx #3
!:  lda x1,y
    adc num,y
    sta x1,y
    iny
    dex
    bne !-
    asl num                      // num = 16x
    rol num+1
    rol num+2
    clc                          // num = 25x
    ldy #$00
    ldx #3
!:  lda x1,y
    adc num,y
    sta num,y
    iny
    dex
    bne !-
    ldx shift
!:  lsr num+2
    ror num+1
    ror num
    dex
    bne !-
    lda #' '
    jsr CHROUT
    lda #1
    sta fix
    jsr putnum
    lda #0
    sta fix
    rts

// output helpers ---------------------------------------------------------
puts:
    stx ptr
    sty ptr+1
    ldy #$00
!:  lda (ptr),y
    beq !+
    jsr CHROUT
    iny
    bne !-
!:  rts

putdec:                          // print the 24-bit slot at Y:X
    stx ptr
    sty ptr+1
    ldy #$00
!:  lda (ptr),y
    sta num,y
    iny
    cpy #3
    bne !-
    jmp putnum

putnum:                          // print num in decimal; fix = 1: as d.dd
    ldx #$00
    stx lead
digit:
    lda #'0' - 1
    sta dig
!:  inc dig
    sec
    lda num
    sbc pow10,x
    sta num
    lda num+1
    sbc pow10+1,x
    sta num+1
    lda num+2
    sbc pow10+2,x
    sta num+2
    bcs !-
    lda num
    adc pow10,x
    sta num
    lda num+1
    adc pow10+1,x
    sta num+1
    lda num+2
    adc pow10+2,x
    sta num+2
    lda fix
    beq plain
    cpx #5 * 3                   // tens of hundredths: the point goes first
    bne !+
    lda #'.'
    jsr CHROUT
!:  cpx #4 * 3                   // units digit and after always print
    bcs show
plain:
    lda dig
    cmp #'0'
    bne show
    cpx #6 * 3
    beq show
    lda lead
    beq next
show:
    lda dig
    jsr CHROUT
    inc lead
next:
    inx
    inx
    inx
    cpx #7 * 3
    bne digit
    rts

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

pow10:  .byte <1000000, >1000000, 1000000 >> 16
        .byte <100000, >100000, 100000 >> 16
        .byte <10000, >10000, 0
        .byte <1000, >1000, 0
        .byte <100, >100, 0
        .byte <10, >10, 0
        .byte <1, >1, 0

colbyte:  .byte FILLCOL
cmd:      .byte 0
found:    .byte 0
seen:     .fill 7, 0
cmpv:     .byte 0
detmask:  .byte $ff, $ff, $ff, $ff, $07, $ff, $ff
status:   .byte 0
vstatus:  .byte 0
vaddr:    .word 0
failmask: .byte 0
num:      .byte 0, 0, 0
x1:       .byte 0, 0, 0
dig:      .byte 0
lead:     .byte 0
fix:      .byte 0
shift:    .byte 0

empty:    .byte 0, 0, 0
t_one:    .byte 0, 0, 0
t_stash:  .byte 0, 0, 0
t_fetch:  .byte 0, 0, 0
t_fill:   .byte 0, 0, 0
t_swap:   .byte 0, 0, 0
t_verify: .byte 0, 0, 0
t_64off:  .byte 0, 0, 0
t_64on:   .byte 0, 0, 0
t_64spr:  .byte 0, 0, 0
t_tmp:    .byte 0, 0, 0

.encoding "petscii_upper"
dettext:   .text "DETECT "
           .byte 0
yestext:   .text "YES"
           .byte $0d, 0
notext:    .text "NO"
           .byte $0d, 0
noreutext: .text "RESULT 02 NO REU"
           .byte $0d, 0
stattext:  .text "STATUS "
           .byte 0
onetext:   .byte $0d
           .text "1 BYTE     "
           .byte 0
stashtext: .text "STASH 4K   "
           .byte 0
fetchtext: .text "FETCH 1000 "
           .byte 0
filltext:  .text "FILL 1000  "
           .byte 0
swaptext:  .text "SWAP 4K    "
           .byte 0
veritext:  .text "VERIFY 4K  "
           .byte 0
errtext:   .text "VERIFY ERR "
           .byte 0
attext:    .text " AT "
           .byte 0
offtext:   .text "64K OFF    "
           .byte 0
ontext:    .text "64K ON     "
           .byte 0
sprtext:   .text "64K SPR    "
           .byte 0
restext:   .text "RESULT "
           .byte 0
passtext:  .text " PASS"
           .byte 0
failtext:  .text " FAIL"
           .byte 0
masktext:  .text " MASK "
           .byte 0
```

## Build

```bash
java -jar KickAss.jar reu-dma.asm -o reu-dma.prg
```

Produces `reu-dma.prg`, 3,506 bytes, `$0801` to `$15b0` (KickAssembler
5.25, `-showmem`). The REU is not part of the build; it is a VICE option
at run time:

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 8000000 -reu -reusize 512 -exitscreenshot reu-dma.png -autostart reu-dma.prg
```

`x64sc -help` in VICE 3.10 lists `-reu`/`+reu`, `-reusize <size in KiB>`,
`-reuimage <Name>`, `-reuimagerw` and `-cartreu <Name>`.

## Expected output

Border green. Rows 0 to 12, PAL:

```text
DETECT 01 02 03 04 FD 06 07 YES
STATUS 50
1 BYTE     9
STASH 4K   4104 1.00
FETCH 1000 1008
FILL 1000  1008
SWAP 4K    8200 2.00
VERIFY 4K  4104 1.00
VERIFY ERR 30 AT 3ABD
64K OFF    65544 1.00
64K ON     69414 1.05
64K SPR    71134 1.08
RESULT 01 PASS MASK 00
```

`READY.` on row 14. Rows 17 to 24 hold the first 320 bytes of the
pattern as screen codes, in yellow. NTSC shows the same text except two
lines: `64K ON     69844 1.06` and `64K SPR    71439 1.09`.

Screenshots from the pinned runs, 8,000,000 cycles, with `-reu -reusize
512`: `screenshots/reu-dma.png` (PAL) and `screenshots/reu-dma-ntsc.png`
(NTSC). Measured on both: rows 0 to 12 decoded against the character ROM
as above; border pixel (2, 100) = (98, 213, 50) on PAL and (114, 189,
103) on NTSC, index 5; the ink on rows 17 to 24 is (255, 255, 70) on PAL
and (255, 248, 141) on NTSC, index 7, 888 pixels per row; the text rows
are index 14 ink on index 6. The pinned command was run twice per model
and the two PNGs were identical bytes.

What the lines mean, measured in VICE x64sc 3.10. Every count is net of
the harness (an empty `JSR`/`RTS` is timed first and subtracted) and
still includes the `LDA abs` / `STA $DF01` that starts the transfer,
4 + 4 = 8 cycles.

| Line | Transfer | Cycles | Less the 8-cycle start |
|---|---|---|---|
| `1 BYTE` | stash 1 byte | 9 | 1 |
| `STASH 4K` | stash 4,096 bytes, screen blanked | 4,104 | 4,096 |
| `FETCH 1000` | 1,000 bytes into screen RAM, blanked | 1,008 | 1,000 |
| `FILL 1000` | 1,000 bytes into colour RAM, REU address fixed, blanked | 1,008 | 1,000 |
| `SWAP 4K` | swap 4,096 bytes, blanked | 8,200 | 8,192 |
| `VERIFY 4K` | verify 4,096 equal bytes, blanked | 4,104 | 4,096 |
| `64K OFF` | stash 65,536 bytes (length 0), C64 address fixed, blanked | 65,544 | 65,536 |
| `64K ON` | the same, text screen on, started on raster line 0 | 69,414 PAL, 69,844 NTSC | 69,406, 69,836 |
| `64K SPR` | the same, plus eight sprites on lines 100 to 120 | 71,134 PAL, 71,439 NTSC | 71,126, 71,431 |

So a stash, fetch or verify costs one cycle per byte and a swap two,
with no set-up cost beyond the store to `$DF01`. The per-byte column is
printed as `count × 25 >> 10` for 4,096 bytes and `>> 14` for 65,536,
which is count / length to two decimals, truncated. The blanked counts
are the same on both models. An earlier build of this program, laid out
differently, printed every blanked count one cycle higher (10, 4,105,
1,009, 1,009, 8,201, 4,105, 65,545). The cause of that one cycle was
not established; the REU's one cycle per byte is the same in both.

With the screen on, the 64 KB stash took 3,870 cycles longer on PAL
(5.9 %) and 4,300 on NTSC (6.6 %). It ran for 3.5 PAL frames (69,414 /
19,656) and 4.1 NTSC frames (69,844 / 17,095), which crosses about 88
and 102 badlines: roughly 42 to 44 cycles per badline (arithmetic from
the measured totals, not a per-line measurement). Eight sprites on 21
lines added 1,720 cycles on PAL and 1,595 on NTSC.

The other lines:

- `DETECT`: the seven bytes read back from `$DF02-$DF08` after writing
  1 to 7. `$DF06`, the bank register, reads `$FD` for a written 5: bits
  7 to 3 read as 1 with `-reusize 512`. The test therefore compares
  `$DF06` on bits 2 to 0 only.
- `STATUS 50`: `$DF00` after the 1-byte stash. Bit 6 (end of block) and
  bit 4 (the size bit, set for a 256 KB-chip REU such as the 1750 and
  1764 per codebase64) are set; the version bits read 0.
- `VERIFY ERR 30 AT 3ABD`: `$DF00` after a verify of `$3000-$3FFF`
  against the REU with the byte at `$3ABC` inverted. Bit 5 (fault) and
  bit 4 are set; bit 6 (end of block) is not. `$DF02/$DF03` read
  `$3ABD`, one past the differing byte, so the verify stopped there.
  Before that, both unchanged verifies left bit 5 clear.
- `MASK 00`: no check failed. Bit 0 is the screen fetch, bit 1 the
  colour fill, bit 2 the swap, bit 3 the two clean verifies, bit 4 a
  missing fault bit, bit 5 the `$FF00` fetch under I/O, bit 6 the 64 KB
  verify.

### Without an REU

The same PRG run with no `-reu` flag, once per model, not pinned: the
border is red and the screen shows

```text
DETECT 00 00 00 00 00 00 00 NO
RESULT 02 NO REU
```

on PAL, and `DETECT 00 00 00 00 FF 00 00 NO` on NTSC. With nothing at
`$DF00-$DFFF` a read returns open bus, the byte the VIC-II last fetched
(`hardware/c64-registers-reference.md`, the `$DE00-$DFFF` section), so
the values depend on the model and the moment, and a read-back pattern
of 1 to 7 does not survive.

## Why this works

### Driving a transfer

Each transfer is the same five steps: the C64 address to `$DF02/$DF03`,
the REU address and bank to `$DF04-$DF06`, the length to `$DF07/$DF08`
(0 means 65,536), the address-control bits to `$DF0A`, then the command
to `$DF01`. The command bytes used here are `$90` stash, `$91` fetch,
`$92` swap and `$93` verify: bit 7 executes, bit 4 set starts at once,
bits 1 to 0 pick the type. The REU halts the CPU for the transfer, so
the instruction after the store runs when the last byte has moved. The
autoload bit 5 is never set, so the address and length registers are
left pointing past the transfer, and every transfer reloads all of them
(the `Reu` macro).

### Fixed addresses

The colour fill sets `$DF0A` bit 6, which holds the REU address still:
all 1,000 bytes come from REU `2:0000`, which the 1-byte stash had set to
7. The 64 KB stash sets bit 7 instead, which holds the C64 address
still: 65,536 reads of `$3000` land in REU bank 3, and the verify with
the same setting finds no difference. The same bit on a fetch writes
every REU byte to one C64 address, which is the digi case (`$D418`);
this program does not play one.

### The $FF00 trigger

A transfer to the RAM under I/O cannot be started the plain way: the
store to `$DF01` needs I/O visible, and the DMA uses the memory
configuration in force while it runs. So the program writes `$81` to
`$DF01` (execute, bit 4 clear) with I/O visible, which arms the
transfer and moves nothing. It then sets `$01` = `$34` and writes to
`$FF00`; that write starts the DMA, which now sees RAM at `$D000`
(measured: the 4 KB compared equal at `$34`, and the program went on to
time and print normally, which it could not do after 4 KB of pattern
had been written over the VIC and CIA registers; codebase64 describes
the same use). The check runs at `$34` too. `LDA $FF00` / `STA $FF00` writes back the
byte already there, so the RAM under the KERNAL is not changed. A test
program that read `$C055` after arming and after a read of `$FF00` found
it unchanged both times; after the write it held the fetched byte.

### Interrupts stay masked

The transfers run under `SEI`, and it has to be set again after any
`CHROUT` to the screen: the KERNAL's screen output returns through
`$E6A8`, which ends `CLC` / `CLI` / `RTS` with the `CLI` at `$E6B4`
(ROM bytes; pitfall `kernal_assumes_sei_cleared`). A first draft printed
the detection line and then went on with interrupts enabled. The
KERNAL IRQ then fired at `$34`, took its vector from RAM at `$FFFE`, and
the machine ended in a `BRK` loop at `$0002`, found with the remote
monitor. An IRQ cannot be taken in the middle of a transfer, because the
CPU is halted; it lands between transfers (from the CPU being halted,
not measured here).

### Timing

The CIA2 harness is the one in `speedcode-generator.md`: timer B counts
timer A's underflows, both latches at `$FFFF`, 24 bits. Screen-off runs
start after `DEN` has been cleared and a new frame has begun, because
`DEN` is sampled once per frame. The screen-on and sprite runs start at
raster line 0, so the pinned counts are repeatable.

## What this recipe does not show

It does not use the REU interrupt (`$DF09`, written 0 here), autoload,
or the size test across banks that codebase64 recommends for finding
the real capacity. It does not measure a real 1700, 1750 or 1764, an
Ultimate or a 1541 Ultimate REU; every figure is VICE x64sc 3.10.

## Sources

- codebase64, "REU programming": https://codebase64.net/doku.php?id=base:reu_programming (register bits, the `$FF00` trigger, detection and the size test).
