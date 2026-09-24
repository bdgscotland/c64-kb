---
recipe: dysp
toolchain: kickassembler
output_format: PRG
region: both
techniques: [dysp_side_border_sprites, sideborder_open, stable_raster_irq, double_irq, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D010, D011, D012, D015, D016, D017, D019, D01A, D01C, D01D, D027, D028, D029, D02A, DC04, DC05, DC0E]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_b (init), cia1_tod (init), zero_page $02 (owns)]
harness: [cia1_timer_a]
ram: [work=$02C0-$02FF]
---

<!-- doc-type: recipe -->

# KickAssembler: DYSP, sprites at different Y in the opened side border

## Synopsis

Four ring sprites stand in the right side border at X 344, each bobbing
on its own sine about Y 60, 90, 120 and 150 with an amplitude of 20, and
the border stays open on every line they cross. The side border opens
exactly as `sideborder-open.md` opens it: one `DEC $D016` per line whose
new value is written on cycle 56 (PAL). What that recipe could not do is
let the sprites sit at different heights, because the sprite DMA after
the write stalls the CPU for a length that depends on which sprites the
VIC fetches on that line, and a loop timed for one sprite set loses its
phase on the first line where the set changes. DYSP (different Y sprite
positions) rebuilds a per-line table every frame from the sprites' Y
positions and pads each line's code by the stall that line will not
have, so the write lands on cycle 56 whether the line carries no sprite,
one, or three.

Measured in VICE x64sc 3.10 on both models: with the per-line table the
right border is open on every line from 51 to 200 and all four sprites
are visible; with the sideborder recipe's fixed timing and the same four
sprites it is closed on every one of those lines and no sprite shows;
with a table built from a count of sprites rather than the set, the
border closes from the first line whose set does not contain sprite 0.
The sweep is in Expected output. Both models pin to one picture each,
byte-identical across two runs.

## Source

```asm
// dysp.asm
// DYSP: four sprites at different, moving Y positions inside the opened
// right side border. One write per line opens the border: DEC $D016 with
// its new value written on cycle 56 on both models (an earlier version
// said 57 on NTSC; the store trace prints 56 there too), as in
// sideborder-open.asm. Sprite DMA then stalls the CPU for a length that
// depends on WHICH sprites are fetched on that line, so the loop reads a
// per-line delay from a table rebuilt every frame from the sprites' Y
// positions, and pads each line's code to 63 (65) cycles less the stall.
//
// Per line, from the line's DEC onwards (see the text for the arithmetic):
//   dec $d016          51-56 (PAL), new value written on 56
//   inx / lda / sta $d011   reads only until the stall is over; YSCROLL
//                      is rewritten every line so no line is a badline
//   ldy mask,x         which sprites the VIC fetches after this DEC
//   lda odd16,y ; bne  one cycle when the compensation is odd
//   lda entry16,y ; sta jm+1 ; jm: jmp slide   into a slide of six NOPs
//   inc $d016          CSEL back to 1 for the next line's comparisons
//   cpx / bne / jmp loop
// Code cycles per line = 51 + extra (PAL; 53 + extra NTSC), with
// extra = 12 - lost, where lost is the CPU cycles the sprite DMA takes
// after the DEC on that line, from a 16-entry table indexed by the mask.
//
// Build variants (KickAssembler command line):
//   :ENTRYPAD=n      cycles from the sync to the first DEC (PAL default 45)
//   :ENTRYPADN=n     the same for NTSC (default 45)
//   :SYNCPADN=n      NTSC sync padding (default 12)
//   :MODEL=count :D=n :B=n   count model: lost = B + D * (sprites on the line)
//   -define FIXEDDELAY       control: the sideborder recipe's fixed
//                            sprite-free timing on every line

.var ENTRYPAD  = cmdLineVars.containsKey("ENTRYPAD")  ? cmdLineVars.get("ENTRYPAD").asNumber()  : 45
.var ENTRYPADN = cmdLineVars.containsKey("ENTRYPADN") ? cmdLineVars.get("ENTRYPADN").asNumber() : 45
.var SYNCPADN  = cmdLineVars.containsKey("SYNCPADN")  ? cmdLineVars.get("SYNCPADN").asNumber()  : 12
.var COUNTMODEL = cmdLineVars.containsKey("MODEL") && cmdLineVars.get("MODEL") == "count"
.var DPER = cmdLineVars.containsKey("D") ? cmdLineVars.get("D").asNumber() : 2
.var BLEAD = cmdLineVars.containsKey("B") ? cmdLineVars.get("B").asNumber() : 1

.const BAND_TOP   = 40      // first line with a DEC; sprite 0 reaches Y 40
.const BAND_LINES = 161     // lines 40..200
.const SYNC_PAD   = 11      // PAL, as in stable-raster-irq
.const EXTRA_MAX  = 12      // six NOPs; the odd cycle comes from the branch
.const FRAMES     = 300     // the sines stop here so the pin is static
.const NSPR       = 4

.const REG_FLAG = $02e1     // 0 = PAL, 1 = NTSC
.const CIA_TALO = $dc04
.const CIA_TAHI = $dc05
.const CIA_CRA  = $dc0e

// Tables, one page each, indexed by j = line - BAND_TOP + 1 (the loop's X
// after its INX). mask: bits 0..3, sprite s fetched on that line.
.const mask_tab  = $0c00
.const d011_tab  = $0f00
.const sine_tab  = $1000
.const lost16    = $02c0    // per-model, copied at boot: mask -> lost cycles
.const entry16   = $02d0    // mask -> slide entry low byte
.const odd16     = $02f0    // mask -> odd cycle
.const saved_sp  = $02e0
.const frame_lo  = $02e2
.const frame_hi  = $02e3
.const cia_lo    = $02e4    // builder cost, low/high, from CIA 1 timer A
.const cia_hi    = $02e5
.const phase     = $02e8    // 4 bytes
.const spr_y     = $02ec    // 4 bytes
.const sprite_block = $2000

BasicUpstart2(start)

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

// CPU cycles lost after the DEC to the sprite DMA of the sprites in mask.
// The p-access slots are 58, 60, 62, 1 (PAL) and 60, 62, 64, 1 (NTSC) for
// sprites 0..3; BA falls three cycles before the first and the CPU resumes
// two cycles after the last slot. DEC's writes on 55 and 56 (56 and 57 on
// NTSC) go through while BA is low, so a set holding sprite 0 costs less.
.function lostcycles(m, ntsc) {
    .if (m == 0) .return 0
    .var f = 0
    .while (((m >> f) & 1) == 0) .eval f++
    .var l = 3
    .while (((m >> l) & 1) == 0) .eval l--
    .if (f == 0) .return (ntsc ? 4 : 3) + 2 * l
    .return 5 + 2 * (l - f)
}
.function popcount(m) {
    .var c = 0
    .for (var b = 0; b < 4; b++) .eval c += (m >> b) & 1
    .return c
}
.function lostmodel(m, ntsc) {
#if FIXEDDELAY
    .return 0
#else
    .if (COUNTMODEL) {
        .if (m == 0) .return 0
        .var v = BLEAD + DPER * popcount(m)
        .return min(v, EXTRA_MAX)
    }
    .return lostcycles(m, ntsc)
#endif
}

// A 24x21 ring: an ellipse two to three pixels thick.
.function ringbyte(row, col) {
    .var v = 0
    .for (var b = 0; b < 8; b++) {
        .var x = col * 8 + b
        .var dx = (x - 11.5) / 11.5
        .var dy = (row - 10) / 10
        .var d = dx * dx + dy * dy
        .if (d <= 1.0 && d >= 0.5) .eval v = v | (128 >> b)
    }
    .return v
}

* = sprite_block
    .for (var r = 0; r < 21; r++) { .byte ringbyte(r, 0), ringbyte(r, 1), ringbyte(r, 2) }
    .byte 0

* = sine_tab
    .fill 256, (round(20 * sin(toRadians(i * 360 / 256))) + 256) & 255

* = d011_tab
    .fill 256, $18 | ((BAND_TOP + i + 4) & 7)

// The two per-model 16-entry conversions. Both loops keep their slide at
// the same low byte, so one entry table serves either.
* = $0bc0
conv_pal:
    .fill 16, lostmodel(i, false)
conv_ntsc:
    .fill 16, lostmodel(i, true)

spr_base:  .byte 60, 90, 120, 150
spr_speed: .byte 2, 3, 5, 7
spr_col:   .byte 1, 7, 3, 13

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    jsr detect_region        // sets REG_FLAG, leaves I clear
    sei

    // per-model conversion tables: mask -> lost cycles -> slide entry, odd
    ldx #15
conv_loop:
    lda conv_pal, x
    ldy REG_FLAG
    beq !+
    lda conv_ntsc, x
!:  sta lost16, x
    sta $02
    lda #EXTRA_MAX
    sec
    sbc $02                  // extra = 12 - lost
    lsr                      // A = extra / 2, C = the odd cycle
    sta $02
    lda #0
    adc #0
    sta odd16, x
    lda #<slide_pal + 6      // six NOPs less extra / 2
    sec
    sbc $02
    sta entry16, x
    dex
    bpl conv_loop

    .for (var s = 0; s < NSPR; s++) {
        lda #<344
        sta $d000 + s * 2
        lda spr_base + s
        sta $d001 + s * 2
        lda #sprite_block / 64
        sta $07f8 + s
        lda spr_col + s
        sta $d027 + s
        lda #0
        sta phase + s
    }
    lda #%00001111
    sta $d010                // all four past X 255
    sta $d015                // sprites 0..3 on
    lda #0
    sta $d017
    sta $d01d
    sta $d01c
    sta frame_lo
    sta frame_hi

    jsr build_tables         // first frame's tables before the first band

    lda #<vblank
    sta $0314
    lda #>vblank
    sta $0315
    lda #$1b
    sta $d011
    lda #$c8
    sta $d016                // CSEL=1, MCM=0, XSCROLL=0
    lda #210
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// ---- region detection, as in pseudo-3d-road.asm ----
detect_region:
    sei
!:  bit $d011
    bmi !-
!:  bit $d011
    bpl !-
!:  lda $d012
    bit $d011
    bpl !+
    tax
    jmp !-
!:  lda #0
    cpx #$10
    bcs !+
    lda #1
!:  sta REG_FLAG
    cli
    rts

// ---- per-frame work, below the band (line 210) ----
vblank:
    cld
    lda #$01
    sta $d019
    lda #$ff
    sta CIA_TALO
    sta CIA_TAHI
    lda #$11
    sta CIA_CRA              // count cycles

    lda frame_hi
    cmp #>FRAMES
    bne advance
    lda frame_lo
    cmp #<FRAMES
    bcs frozen
advance:
    inc frame_lo
    bne !+
    inc frame_hi
!:  .for (var s = 0; s < NSPR; s++) {
        lda phase + s
        clc
        adc spr_speed + s
        sta phase + s
    }
frozen:
    jsr build_tables

    lda #0
    sta CIA_CRA
    sec
    lda #$ff
    sbc CIA_TALO
    sta cia_lo
    lda #$ff
    sbc CIA_TAHI
    sta cia_hi

    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #BAND_TOP - 3
    sta $d012
    jmp $ea81

// Y from the sines, then the per-line tables: mask, then entry and odd.
build_tables:
    .for (var s = 0; s < NSPR; s++) {
        ldx phase + s
        lda sine_tab, x
        clc
        adc spr_base + s
        sta spr_y + s
        sta $d001 + s * 2
    }
    ldx #BAND_LINES
    lda #0
!:  sta mask_tab, x
    dex
    bne !-
    .for (var s = 0; s < NSPR; s++) {
        lda spr_y + s
        sec
        sbc #BAND_TOP - 1        // j = Y - BAND_TOP + 1
        tax
        ldy #21
    !:  lda mask_tab, x
        ora #1 << s
        sta mask_tab, x
        inx
        dey
        bne !-
    }
    rts

// ---- double IRQ, as in stable-raster-irq.asm ----
irq1:
    lda REG_FLAG
    bne !+
    lda #<irq2_pal
    sta $0314
    lda #>irq2_pal
    sta $0315
    jmp !++
!:  lda #<irq2_ntsc
    sta $0314
    lda #>irq2_ntsc
    sta $0315
!:  lda #BAND_TOP - 1
    sta $d012
    lda #$01
    sta $d019
    tsx
    stx saved_sp
    cli
    .for (var i = 0; i < 40; i++) { nop }
    jmp *                    // never reached: irq2 exits through irq1's frame

done:
    lda #$1b
    sta $d011                // normal display again
    lda #210
    sta $d012
    lda #<vblank
    sta $0314
    lda #>vblank
    sta $0315
    lda #$01
    sta $d019
    pla
    tay
    pla
    tax
    pla
    rti

// The PAL and NTSC loops share a layout, so slide_pal and slide_ntsc have
// the same low byte, which is what the entry table holds. Each model's
// stable entry follows its loop and jumps back to it.
* = $1100
loop_pal:
    dec $d016                // 51-56: writes on 55 and 56
    inx                      // reads only from here until the stall ends
    lda d011_tab, x
    sta $d011                // the next line's YSCROLL: no badline
    ldy mask_tab, x          // which sprites the VIC fetches after this DEC
    lda odd16, y
    bne !+                   // taken: one cycle more
!:  lda entry16, y
    sta jm_pal + 1
jm_pal:
    jmp slide_pal
slide_pal:
    nop
    nop
    nop
    nop
    nop
    nop
    inc $d016                // CSEL back to 1
    cpx #BAND_LINES
    bne !+                   // taken, 3 cycles, on every line but the last
    jmp done
!:  jmp loop_pal             // 51 + extra code cycles a line

irq2_pal:
    ldx saved_sp
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+
!:  ldx #0
    Delay(ENTRYPAD - 3)
    jmp loop_pal

* = $1200
loop_ntsc:
    dec $d016                // 52-57: writes on 56 and 57
    inx
    lda d011_tab, x
    sta $d011
    ldy mask_tab, x
    lda odd16, y
    bne !+
!:  lda entry16, y
    sta jm_ntsc + 1
jm_ntsc:
    jmp slide_ntsc
slide_ntsc:
    nop
    nop
    nop
    nop
    nop
    nop
    inc $d016
    cpx #BAND_LINES
    bne !+
    jmp done
!:  Delay(2)
    jmp loop_ntsc            // 53 + extra code cycles a line

irq2_ntsc:
    ldx saved_sp
    txs
    Delay(SYNCPADN)
    lda $d012
    cmp $d012
    beq !+
!:  ldx #0
    Delay(ENTRYPADN - 3)
    jmp loop_ntsc
```

## Build

```bash
java -jar KickAss.jar dysp.asm -o dysp.prg
```

Sweep and control builds used for the measurements below:

```bash
java -jar KickAss.jar dysp.asm -o dysp-count2.prg :MODEL=count :D=2 :B=1
java -jar KickAss.jar dysp.asm -o dysp-count3.prg :MODEL=count :D=3 :B=1
java -jar KickAss.jar dysp.asm -o dysp-count4.prg :MODEL=count :D=4 :B=1
java -jar KickAss.jar dysp.asm -o dysp-fixed.prg -define FIXEDDELAY
```

## Expected output

Pinned with `-limitcycles 10000000`, which is past the 300th frame on
either model (the program stops advancing its sines at frame 300; the
frame counter at `$02E2` reads 300 in the monitor dump on both), so the
picture is static.

**PAL (default machine).** `screenshots/dysp.png`, md5
`e932e372f4650703e7358ae47f1ae2e5` on two runs. From raster line 51 to
200 (screenshot rows 35 to 184) the light-blue side borders are gone on
both sides: the blue background runs from x 0 to x 383. Four rings sit
at x 352 to 375, which is X 344 to 367 in VIC coordinates, wholly inside
the right border: white with its Y at 77, yellow at 88, cyan at 105 and
light green at 169 (the four bytes at `$02EC`, monitor dump). The white
and yellow rings overlap; the cyan one starts as the white one ends.
Sprite pixels are on rows for lines 79 to 125 and 171 to 189; the ring's
first and last rows are empty, so a sprite at Y 77 first lights line 79.
Lines 40 to 50 are inside the upper border, which this write does not
open (see below): the white ring's top rows are hidden there whenever
its Y falls below 50. Inside the band the character display is idle and
blank, as in the sideborder recipe; below it the rest of the BASIC screen
is untouched.

**NTSC (`-model ntsc`).** `screenshots/dysp-ntsc.png`, md5
`8840e1407a45dedc052f9191aad8f2c9` on two runs. The same band, lines 51
to 200 (rows 23 to 172), the same four Y positions and the same sprite
rows, in the NTSC palette.

**Sweep: what the border does under each per-line model (PAL, frame
300, sprites at Y 77, 88, 105, 169).** Measured from the screenshot:
a band line counts as closed when all 32 pixels at x 352 to 383 are the
border colour. Lines 40 to 50 are left out because the upper border
closes them in every build.

| Build | Per-line delay model | Lines 51 to 200 with the right border closed | Sprites visible |
|---|---|---|---|
| `dysp.prg` | table by sprite set: lost = 3 + 2l with sprite 0 in the set, 5 + 2(l - f) without, 0 for none | 0 | all four (lines 79 to 125, 171 to 189) |
| `-define FIXEDDELAY` | none: the sideborder recipe's sprite-free 63-cycle line on every line | 150 (every line) | none |
| `:MODEL=count :D=2 :B=1` | 1 + 2 per sprite on the line | 102 (99 to 200) | sprite 0 only (79 to 98) |
| `:MODEL=count :D=3 :B=1` | 1 + 3 per sprite | 118 (78 to 99, 101 to 105, 110 to 200) | fragments of sprite 1 (100, 106 to 109) |
| `:MODEL=count :D=4 :B=1` | 1 + 4 per sprite | 123 (78 to 200) | none |

The count model with two cycles a sprite is right on every line whose
set contains sprite 0 (lines 77 to 97 here) and wrong by two on the
first line that does not (line 98, sprite 1 alone), and once the loop's
phase has slipped it does not come back, so the border is closed from
99 to the bottom of the band. Three and four cycles a sprite overshoot
on the very first sprite line (77) and close from 78; the few open lines
in the D=3 column are where the accumulating drift happened to pass
through cycle 56 again. There is no per-sprite constant that works: the
stall is set by the first and last sprite in the line's set, and by
whether the first is sprite 0.

**Write cycles (`trace store d016`, PAL, five frames from boot).** With
the pinned `ENTRYPAD` of 45, every `DEC $D016` in the band reports cycle
56 and every `INC $D016` cycle 42: 805 of 805 each, over lines that
carry no sprite, sprite 0 alone, sprites 0 and 1, 1 alone, 1 and 2, 2
alone, 2 and 3 and 3 alone as the sines moved. With `ENTRYPAD` 43, the
sideborder recipe's value, the sprite-free lines reported 54 and the
border stayed closed until the first sprite line, whose stall moved the
loop to 56; the sideborder recipe tolerated 41 to 45 because all its
lines had the stall, and this one has lines without it. On NTSC with
`ENTRYPADN` 45 every `DEC` reports 56 and every `INC` 40, 2,737 of
2,737; with 44 the sprite-free lines reported 55 and were closed. A
store trace prints the write's cycle in Bauer's numbering on both
models (`runtime/vice-reference.md`, "What the CYC column counts",
measured for issue #82), so the write that opens the border is cycle 56
on PAL and on NTSC. An earlier version left the two models' numbers
unreconciled.

**Cycles.** The band is 161 lines of 63 wall cycles on PAL (arithmetic:
10,143 cycles), 65 on NTSC; the code in each line is 51 cycles plus the
padding, 53 on NTSC, and the padding plus the stall is 12 on every line.
The per-frame table rebuild at line 210, timed with CIA 1 timer A,
costs 3,560 cycles in 254 of the 357 measured frames while the sprites
move, 3,570 at most, and 3,506 in the frozen frames; the same figures
on NTSC. The two interrupts' KERNAL entries and the double IRQ's slide
are outside the brackets.

## Why this works

### The stall after the write, per sprite set

`DEC $D016` started on cycle 51 reads on 51 to 54 and writes on 55 and
56, the new value on 56, between the X=335 and X=344 comparisons; that
is the sideborder recipe's mechanism unchanged. What follows the write
is the VIC's sprite fetch. `hardware/vic-ii-reference.md`, Sprite DMA,
gives the p-access slots as cycles 58, 60, 62, 1, 3, 5, 7, 9 for sprites
0 to 7 on PAL, states that BA falls three cycles before the first fetch
and that the CPU completes up to three write cycles after BA falls, and
measured that with sprites 0..k active the CPU resumes two cycles after
sprite k's slot. From those statements, for a set whose first sprite is
f and last is l (measured here only through the border, not with a CIA
timer per line):

- with sprite 0 in the set, BA falls on 55; the `DEC`'s two writes go
  through and the `INX` on 57 stalls until 60 + 2l, so the CPU loses
  3 + 2l cycles: 3, 5, 7 and 9 for the sets 0, 0-1, 0-2 and 0-3;
- without sprite 0, BA falls on 55 + 2f, after the write, and the first
  read after that stalls until 60 + 2l: 5 + 2(l - f) cycles, 5 for any
  single sprite, 7 for two neighbours;
- with no sprite, nothing.

A gap of one sprite inside the set costs the same as if the missing
sprite were present, because BA does not rise for a two-cycle gap; the
table treats {0, 2} as {0, 1, 2}. The sets here are always runs of
neighbours or nearly so, since each sprite's range overlaps only the
next one's.

So the stall is not a per-sprite price. A line with sprite 1 alone
costs five, a line with sprite 0 alone three, and the difference is the
two write cycles the `DEC` spends inside the lead-in when the lead-in
starts on 55. The count model's failure in the sweep is that
difference.

### The table and the loop

The per-frame builder writes `spr_y` from the sines, clears the 161-byte
`mask_tab`, and for each sprite ORs its bit into the 21 entries from its
Y line. Entry j stands for line 39 + j, which is the line the loop's X
holds after its `INX`. At boot a 16-entry conversion turns each mask
into the two things the loop needs: `entry16`, the low byte of where to
enter a slide of six `NOP`s, and `odd16`, whether to spend one more cycle
on a taken branch. Extra cycles = 12 minus the stall, so a sprite-free
line pads twelve, a line with sprite 0 alone nine, and a line with
sprites 0 to 3 three.

The loop keeps every read between the `DEC` and the end of the stall
window: `INX`, `LDA d011_tab,X` and the address bytes of `STA $D011`
whose write falls on cycle 3 at the earliest, which is where the
longest stall ends. Any write inside the window would be completed
during BA low and change the lost count. `INC $D016` restores CSEL on
cycles 37 to 42, well before the next line's cycle 55, which is the
window the sideborder recipe measured for the restore.

`$D011` is rewritten on every line with YSCROLL = (line + 4) & 7, the
sideborder recipe's device, so no line of the band is a badline; the
character display idles and the band is blank. The band starts on line
40, below any badline, and lines 40 to 50 get the write to no effect,
since the vertical border flip-flop is set there and the main border
flip-flop only matters once it clears on line 51.

### Entry, models, and what the sines may not do

The stable entry is the double IRQ from `stable-raster-irq.md`: `irq1`
at line 37, `irq2` at line 39, `SYNC_PAD` 11 on PAL. `ENTRYPAD` is the
cycles from the sync to the first `DEC` and its value, 45, was set from
the write-cycle trace above. `pal_ntsc_detection`'s method from the road
recipe sets a flag at boot; `irq1` selects the PAL or the NTSC loop by
it, the loops differ in the `Delay(2)` of the NTSC one and in their
stall tables (sprite 0's lead-in on NTSC starts on 57, one cycle after
the write, so a set with sprite 0 costs 4 + 2l there), and both loops
keep their slide at the same low byte so one entry table serves either.

The IRQ lines 37 to 39 must be free of sprite DMA, or the sync itself
is stalled by a length that changes with the frame. Sprite 0's lowest Y
is 40, so its first fetch is on line 40. That is why the band starts on
40 and not 50: with the interrupt at line 48 and the loop from 50, the
white ring would cross the sync line whenever its Y fell below 51. The
lower limit also puts the ring's top rows under the upper border for
part of its swing; a design that wants the whole ring visible keeps
Y above 50 or opens that border too (`topbottom_border_open`).

The sine table is 256 signed bytes of amplitude 20, which cannot wrap
(`sine_table_peak_wraps_to_zero` in `pitfalls/maths.md` is about
amplitude 128 about 128); the largest Y is 170 and the smallest 40.

## What it does not establish

- Real hardware. Every figure is VICE x64sc 3.10; the stall lengths are
  inferred from the border, not timed per line.
- The left border and sprites in it. The write opens both sides, and the
  screenshot shows the left open from line 52, but no sprite was put
  there.
- Eight sprites. The tables are four bits wide; with eight the largest
  stall is 19 and the slide would need to be longer than the sprite-free
  line's spare cycles allow without moving other work out of the loop.
- Sets with a gap of two or more sprites, where BA rises between the
  groups; the four sprites here never form one.
