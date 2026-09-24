---
recipe: sprite-dma-cost
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sprite_multiplex_24]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D011, D012, D015, D017, D019, D01A, D01C, D01D, D020, D021, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, DC0D, DD04, DD05, DD0D, DD0E]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), cia2_timer_b (init), cia2_tod (init), zero_page $FB-$FC (owns)]
harness: [cia2_timer_a]
ram: [colour=$D800-$DBE7, shape=$2000-$203E]
devices: []
---

<!-- doc-type: recipe -->

# KickAssembler — What Sprite DMA Costs a Frame, Measured Under 0, 8 and 17 Multiplexed Sprites

## Synopsis

A three-band sprite multiplexer shows 0, 8 or 17 sprites while a fixed
CPU loop is timed with CIA2 timer A. Band 1 holds eight sprites at Y 60,
band 2 eight at Y 110, band 3 sprite 0 alone at Y 160. The three raster
IRQs run and make the same writes in every case; only the `$D015` value
each writes changes, so the difference between two cases is sprite DMA
and nothing else. A fourth case blanks the screen with no sprites, which
removes the badlines. Window A times a loop across the whole frame;
window B times a short loop under band 1. The program prints the lowest
and highest count of eight frames per window and case. Use the figures
to check a frame budget's sprite-DMA charge, and to see why code under
a band of sprites runs about 40 % slower than the frame figure suggests.
The multiplexer is the banded form of `sprite_multiplex_24`
(`techniques/sprite.md`); `sprite-multiplex-24.md` is the full version.

## Source

```asm
// sprite-dma-cost.asm
// What sprite DMA takes from the CPU in a whole frame, and under a band of
// eight sprites, measured with CIA2 timer A. A three-band multiplexer shows
// 0, 8 or 17 sprites: eight in band 1 (Y 60), eight in band 2 (Y 110) and
// sprite 0 alone in band 3 (Y 160). Its three raster IRQs run in every case
// and write the same registers; only the $D015 value each one writes
// changes. So the time a fixed loop takes differs between the cases by the
// DMA and nothing else. A fourth case blanks the screen (DEN clear) with no
// sprites, which removes the badlines.
//
// Window A times a 14,112-cycle loop from line 20. On PAL and NTSC, in
// every case, it ends after the last badline (243) and before the next
// frame's line 20, so no case takes a badline or a sprite line the others
// miss. Window B times a 407-cycle loop from line
// 62, under band 1; it ends before line 75, so it holds one badline (67)
// in every case. Each window is timed on 8 frames; the lowest and highest
// counts are printed.
//
// Region: both.

BasicUpstart2(start)

.encoding "screencode_upper"

.const SCREEN   = $0400
.const PTRS     = SCREEN + $3f8
.const SHAPE    = $2000          // block 128
.const Y1       = 60             // band 1 draws lines 61-81
.const Y2       = 110            // band 2 draws lines 111-131
.const Y3       = 160            // band 3 draws lines 161-181
.const IRQ1     = 30
.const IRQ2     = 95
.const IRQ3     = 145
.const LINE_A   = 20
.const LINE_B   = 62
.const FRAMES   = 8
.const CASES    = 4
.label ptr      = $fb            // 2 bytes: the report's row pointer

* = $0810

start:
    sei
    lda #$7f
    sta $dc0d               // no CIA1 interrupts
    sta $dd0d               // no CIA2 NMIs: timer A is the stopwatch
    lda $dc0d
    lda $dd0d
    lda #0
    sta $d020
    sta $d021
    sta $d017
    sta $d01c
    sta $d01d
    sta $d010
    sta $d015
    ldx #0
clr:
    lda #$20
    sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $2e8,x
    lda #1
    sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $dae8,x
    inx
    bne clr
    ldx #62
    lda #$ff
shp:
    sta SHAPE,x             // a solid 24x21 block
    dex
    bpl shp
    ldx #7
spr:
    lda #SHAPE / 64
    sta PTRS,x
    lda xpos,x
    pha
    txa
    asl
    tay
    pla
    sta $d000,y
    lda colours,x
    sta $d027,x
    dex
    bpl spr

    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$1b
    sta $d011
    lda #IRQ1
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli

    ldx #0
caseloop:
    stx case
    lda mask1_t,x
    sta mask1
    lda mask2_t,x
    sta mask2
    lda mask3_t,x
    sta mask3
    lda d011_t,x
    sta $d011               // DEN is read on line $30: settle first
    jsr wait_a
    jsr wait_a

    lda #$ff                // window A: whole frame
    sta lo
    sta lo + 1
    lda #0
    sta hi
    sta hi + 1
    lda #FRAMES
    sta count
loop_a:
    jsr wait_a
    lda #11                 // 11 x (5 x 255 + 8) - 1 = 14,112 cycles
    ldy #255
    jsr timed
    jsr minmax
    dec count
    bne loop_a
    lda case
    asl
    asl
    tax
    jsr store               // resa + 4 x case: min, max

    lda #$ff                // window B: under band 1
    sta lo
    sta lo + 1
    lda #0
    sta hi
    sta hi + 1
    lda #FRAMES
    sta count
loop_b:
    jsr wait_b
    lda #1                  // 1 x (5 x 80 + 8) - 1 = 407 cycles
    ldy #80
    jsr timed
    jsr minmax
    dec count
    bne loop_b
    lda case
    asl
    asl
    clc
    adc #4 * CASES
    tax
    jsr store               // resb + 4 x case

    ldx case
    inx
    cpx #CASES
    beq done
    jmp caseloop
done:

    lda #$ff                // show the 17-sprite case, screen on
    sta mask1
    sta mask2
    lda #$01
    sta mask3
    lda #$1b
    sta $d011
    jsr report
    jmp *

// Wait for line 20 (A) or 62 (B) with RST8 clear.
wait_a:
    lda #LINE_A
    .byte $2c               // BIT abs: skip the next LDA
wait_b:
    lda #LINE_B
    sta target
w1: lda $d012               // leave the target line first
    cmp target
    beq w1
w2: lda $d012
    cmp target
    bne w2
    bit $d011
    bmi w2
    rts

// Time the loop: A = outer count, Y = inner count. The result is the
// number of cycles from the timer start to the timer stop.
timed:
    tax
    sty inner
    lda #$ff
    sta $dd04
    sta $dd05
    lda #%00011001          // force load, one-shot, start, count phi2
    sta $dd0e
w_o:
    ldy inner
w_i:
    dey
    bne w_i
    dex
    bne w_o
    lda #0
    sta $dd0e               // stop
    sec
    lda #$ff
    sbc $dd04
    sta cyc
    lda #$ff
    sbc $dd05
    sta cyc + 1
    rts

// lo = min(lo, cyc), hi = max(hi, cyc)
minmax:
    lda cyc
    cmp lo
    lda cyc + 1
    sbc lo + 1
    bcs mm1
    lda cyc
    sta lo
    lda cyc + 1
    sta lo + 1
mm1:
    lda hi
    cmp cyc
    lda hi + 1
    sbc cyc + 1
    bcs mm2
    lda cyc
    sta hi
    lda cyc + 1
    sta hi + 1
mm2:
    rts

store:
    lda lo
    sta res,x
    lda lo + 1
    sta res + 1,x
    lda hi
    sta res + 2,x
    lda hi + 1
    sta res + 3,x
    rts

// ---------------------------------------------------------------------------
// The multiplexer: three IRQs, the same writes in every case.
// ---------------------------------------------------------------------------
.macro Band(y, mask, line, next) {
    lda #y
    .for (var i = 0; i < 8; i++) {
        sta $d001 + i * 2
    }
    lda mask
    sta $d015
    lda #line
    sta $d012
    lda #<next
    sta $0314
    lda #>next
    sta $0315
    lda #$01
    sta $d019
    jmp $ea81               // restore Y, X, A and RTI; no KERNAL service
}

irq1: Band(Y1, mask1, IRQ2, irq2)
irq2: Band(Y2, mask2, IRQ3, irq3)
irq3: Band(Y3, mask3, IRQ1, irq1)

// ---------------------------------------------------------------------------
// Report: rows 18-23, five-digit decimals.
// ---------------------------------------------------------------------------
report:
    ldx #0
rl: lda labels,x
    sta SCREEN + 18 * 40,x
    lda labels + 120,x
    sta SCREEN + 21 * 40,x
    inx
    cpx #120
    bne rl
    ldx #0                  // x = case
rc: stx case
    lda rowlo,x
    sta ptr
    lda rowhi,x
    sta ptr + 1
    txa
    asl
    asl
    tax                     // res offset of window A
    ldy #6
    jsr dec2                // min A at column 6, max A at column 12
    lda case
    asl
    asl
    clc
    adc #4 * CASES
    tax
    ldy #20
    jsr dec2                // min B at column 20, max B at column 26
    ldx case
    inx
    cpx #CASES
    bne rc
    rts

// Two five-digit numbers from res,x and res+2,x at (ptr),y and (ptr),y+6.
dec2:
    jsr dec5
    inx
    inx
    tya
    clc
    adc #1
    tay
dec5:
    lda res,x
    sta num
    lda res + 1,x
    sta num + 1
    stx xsave
    ldx #0
d_digit:
    lda #'0'
    sta digit
d_sub:
    lda num
    sec
    sbc p10lo,x
    pha
    lda num + 1
    sbc p10hi,x
    bcc d_put
    sta num + 1
    pla
    sta num
    inc digit
    jmp d_sub
d_put:
    pla
    lda digit
    sta (ptr),y
    iny
    inx
    cpx #5
    bne d_digit
    ldx xsave
    rts

p10lo: .byte <10000, <1000, <100, <10, <1
p10hi: .byte >10000, >1000, >100, >10, >1
rowlo: .fill CASES, <(SCREEN + (20 + i) * 40)
rowhi: .fill CASES, >(SCREEN + (20 + i) * 40)

labels:
    .text "      WHOLE FRAME   UNDER BAND 1        "
    .text "CASE   MIN   MAX     MIN   MAX          "
    .text "0                                       "
    .text "8                                       "
    .text "17                                      "
    .text "OFF                                     "

xpos:    .byte 40, 70, 100, 130, 160, 190, 220, 250
colours: .byte 1, 7, 3, 5, 13, 14, 15, 10
mask1_t: .byte $00, $ff, $ff, $00
mask2_t: .byte $00, $00, $ff, $00
mask3_t: .byte $00, $00, $01, $00
d011_t:  .byte $1b, $1b, $1b, $0b

mask1:  .byte 0
mask2:  .byte 0
mask3:  .byte 0
case:   .byte 0
count:  .byte 0
target: .byte 0
inner:  .byte 0
cyc:    .word 0
lo:     .word 0
hi:     .word 0
num:    .word 0
digit:  .byte 0
xsave:  .byte 0
res:    .fill 8 * CASES, 0
```

## Build

```bash
java -jar KickAss.jar sprite-dma-cost.asm -o sprite-dma-cost.prg
```

KickAssembler 5.25: 1,127 bytes, code and tables at `$0810-$0C65`
(`-showmem`). The sprite image is written at run time to `$2000`.

## Expected output

Measured in VICE x64sc 3.10 (rung 1) from the exit screenshots of the
pinned runs, PAL (`screenshots/sprite-dma-cost.png`) and NTSC
(`screenshots/sprite-dma-cost-ntsc.png`), 8,000,000 cycles, text decoded
with PIL against the `chargen-901225-01.bin` glyphs. Two PAL runs gave
byte-identical PNGs.

Both models print the same table:

```text
      WHOLE FRAME   UNDER BAND 1
CASE   MIN   MAX     MIN   MAX
0     15573 15573   00455 00455
8     15972 15972   00645 00645
17    16476 16476   00645 00645
OFF   14498 14498   00412 00412
```

Every window gave the same count on all eight frames. The screen shows
the 17-sprite case: eight solid 24×21 blocks on raster lines 61-81, eight
on 111-131 and one on 161-181, 192 sprite pixels wide in the first two
bands and 24 in the third (PIL, PAL and NTSC). The table is on text rows
18 to 23, below the sprites.

What the counts show, each difference against the row above it or
against case 0:

| Difference | Cycles | Arithmetic |
|---|---|---|
| 0 sprites less screen off, window A | 1,075 | 25 badlines × 43 |
| 8 sprites less 0, window A | 399 | 21 lines × (3 + 2 × 8) |
| 17 sprites less 0, window A | 903 | 2 × 399 + 21 × (3 + 2 × 1) |
| 8 sprites less 0, window B | 190 | 10 lines × 19 |
| 0 sprites less screen off, window B | 43 | badline 67 |

The whole-frame figures are the per-line DMA summed over the sprite
lines, exactly, on PAL and NTSC. Eight of the 63 sprite lines are
badlines (67 and 75 in band 1; 115, 123 and 131 in band 2; 163, 171 and
179 in band 3). On them the badline's 43 cycles and the sprites' add
without overlap.

The screen-off row also checks the harness: 14,112 cycles of loop, three
IRQs of 127 cycles (7 to enter, 29 in the KERNAL's `$FF48` dispatcher,
69 in the handler, 22 in `$EA81`) make 14,493 (arithmetic from the
instruction table and the ROM bytes). The other 5 are the timer's start
and stop; window B's screen-off count, 407 cycles of loop plus 5, agrees.

## Why this works

A loop's time only shows what the VIC took from it if the window covers
the same lines in every case. Window A starts on line 20 and runs 14,112
cycles of work. With 17 sprites it takes 16,476 cycles and ends near PAL
line 281 or NTSC line 10 of the next frame; with none it ends near PAL
line 267 or NTSC line 259. All of those are past the last badline (243) and
the last sprite line (181), and before the next frame's line 20, so the
longer runs take no badline or sprite line the shorter ones miss. Window
B starts on line 62 and ends by line 73 in every case, so it holds
badline 67 and not 75.

The IRQs write eight Y registers, `$D015`, `$D012`, the vector and
`$D019` in every case. Only the value written to `$D015` changes. The
IRQ cost is therefore the same in all four cases and cancels in every
difference; the handlers exit through `$EA81`, not `$EA31`, so no
keyboard scan varies it. The window waits for its line before the timer
starts, so the wait's jitter is not counted.

The loop reads and never writes. The three BA lead-in cycles before
sprite 0's slot are usable by write cycles only (`hardware/vic-ii-reference.md`,
"Sprite DMA"), so a loop that writes loses slightly less than these
counts. These counts are the most the sprites can take.

Under a band of eight sprites a line has 44 CPU cycles of 63 on PAL
(46 of 65 on NTSC), so code there takes 1.43 (1.41) times as long.
Window B shows it: 645 cycles against 455 with the sprites off, 1.42
times. That is
the "about half again slower" the #22 game test saw under its 17 sprites (#96).
It is local. Over the frame the same sprites cost 903 cycles of 19,656
on PAL, 4.6 %.
