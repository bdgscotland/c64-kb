---
recipe: sprite-stretcher
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [sprite_stretcher_d017]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D017, D019, D01A, D01B, D01C, D01D, D021, D027, DC04, DC05, DC0D, DC0E]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_b (init), cia1_tod (init)]
harness: [cia1_timer_a]
---

<!-- doc-type: recipe -->

# KickAssembler Sprite Stretcher

## Synopsis

The $D017 sprite stretcher: a sprite made taller than its data by writing
its Y-expand bit twice on every raster line, so that the VIC-II's
expansion flip-flop is left in the "repeat this row" state at the moment
the row counter would otherwise advance. One white sprite with numbered
rows sits at X 160, Y 100; a stable raster interrupt on line 99 (the
double-IRQ method of `stable-raster-irq.md`) is followed by straight-line
code for lines 100 to 180 that, on every line that is not a badline,
clears bit 0 of $D017 with a write landing on CPU cycle C-4 and sets it
again with a write landing on cycle C. The write cycle C is a build
symbol (`-define C48` to `-define C62`) so the whole range around the
flip-flop's inversion cycle can be swept; the pinned build is C=52.

Measured in VICE x64sc 3.10, PAL 6569 and NTSC 6567R8, on 2026-09-23.
The result: with C anywhere from 48 to 55 the sprite is 91 lines tall
instead of 21, every row from 1 to 9 drawn on eight consecutive lines,
and the row advancing only on the badlines, where the CPU is stalled and
cannot write. C=55 is the last CPU write cycle that completes before the
sprite's DMA stall (BA low from cycle 55); with C at 56 the write is
pushed to cycle 61, past the inversion, and the sprite is 24 lines. From
57 upwards the code runs long, the
writes drift into the crunch cycle of the following line, and the
result is the irregular, data-dependent lengthening of
`sprite_y_stretch_glitch`, not a stretch. The `NOSTRETCH` control, the
same code with both writes sent to a RAM byte, gives the plain 21 lines.

## Source

```asm
// sprite-stretcher.asm
// The $D017 sprite stretcher, measured. One white sprite whose 21 rows are
// numbered (row r holds the byte r+1 three times) sits at X=160, Y=100. A
// stable raster interrupt on line 99 (the double-IRQ method of
// stable-raster-irq.asm) is followed by straight-line code for lines 100 to
// 180 that, on every line that is not a badline, clears the sprite's
// Y-expand bit with a write landing on CPU cycle C-4 and sets it again with
// a write landing on cycle C. Between those two writes and the VIC's own
// inversion of the expansion flip-flop in cycle 56 the flip-flop ends every
// line in the "repeat this row" state, so the row the sprite is on is drawn
// again on the next line. On a badline the CPU cannot write in time, the
// row advances once, and the sprite comes out as rows held for eight lines
// each (measured: 91 lines tall for C from 48 to 55).
//
// Build variants (java -jar KickAss.jar sprite-stretcher.asm -o out.prg ...):
//   -define C<n>      CPU cycle of the setting write, C48 to C62 (default 52)
//   -define NOSTRETCH the same code with both writes sent to a RAM byte
//   -define CALIB     the same code with both writes sent to $D021, so the
//                     write cycle can be read off the screenshot as a colour edge
//   -define NTSC      two more read cycles per line for the 65-cycle line of
//                     the 6567R8 (the sync padding is the PAL one, unmeasured)

// KickAssembler 5.25 takes -define NAME as a preprocessor symbol only, so the
// write cycle is chosen by one of fifteen plain symbols, C48 to C62.
#if C48
.const WRITE_CYCLE = 48
#elif C49
.const WRITE_CYCLE = 49
#elif C50
.const WRITE_CYCLE = 50
#elif C51
.const WRITE_CYCLE = 51
#elif C52
.const WRITE_CYCLE = 52
#elif C53
.const WRITE_CYCLE = 53
#elif C54
.const WRITE_CYCLE = 54
#elif C55
.const WRITE_CYCLE = 55
#elif C56
.const WRITE_CYCLE = 56
#elif C57
.const WRITE_CYCLE = 57
#elif C58
.const WRITE_CYCLE = 58
#elif C59
.const WRITE_CYCLE = 59
#elif C60
.const WRITE_CYCLE = 60
#elif C61
.const WRITE_CYCLE = 61
#elif C62
.const WRITE_CYCLE = 62
#else
.const WRITE_CYCLE = 52
#endif
.print "WRITE_CYCLE = " + WRITE_CYCLE

#if NOSTRETCH
.const TARGET = dummy
#elif CALIB
.const TARGET = $d021
#else
.const TARGET = $d017
#endif

#if NTSC
.const EXTRA = 2
#else
.const EXTRA = 0
#endif
.const SYNC_PAD   = 11       // measured in stable-raster-irq.asm (VICE 3.10, PAL)
.const FIRST      = 100      // first toggled line; the sprite's Y
.const LAST       = 180      // last toggled line
.const YSCROLL    = 0        // badlines on 96, 104, ... 176: none on the sync line 99
.const SPRITE_X   = 160
.const SPRITE_Y   = 100
// Code cycles per line: the head (pad, STY, STX) ends with the write on
// cycle C; the rest of the line's 58 code cycles follow it as reads, so
// the sprite's DMA stall (BA low from cycle 55, CPU stopped on its next
// read, resumed at 60) falls inside them and the line comes to 63.
.const POST = (57 - WRITE_CYCLE) >= 2 ? (57 - WRITE_CYCLE) : 2

BasicUpstart2(start)

// Delay(n): emit exactly n cycles of straight-line code, n >= 2.
.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d                // CIA1 ICR: mask every CIA1 source
    lda $dc0d
    lda #$ff                 // CIA1 timer A latch = $FFFF, started later
    sta $dc04
    sta $dc05

    ldx #0
!:  lda #$20                 // clear the screen so the stripes sit on plain
    sta $0400,x              // background
    sta $0500,x
    sta $0600,x
    sta $0700,x
    inx
    bne !-

    ldx #0                   // row r of the sprite = byte r+1, three times
    ldy #1
row_fill:
    tya
    sta sprite_data,x
    sta sprite_data+1,x
    sta sprite_data+2,x
    inx
    inx
    inx
    iny
    cpx #63
    bne row_fill

    lda #(sprite_data / 64)
    sta $07f8                // sprite 0 pointer
    lda #SPRITE_X
    sta $d000
    lda #SPRITE_Y
    sta $d001
    lda #$01
    sta $d027                // white
    sta $d015                // sprite 0 on
    lda #$00
    sta $d010
    sta $d017                // no Y expansion to begin with
    sta $d01d
    sta $d01c
    sta $d01b
    lda #$06
    sta $d021

    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315

    lda #($18 | YSCROLL)     // DEN=1, RSEL=1, YSCROLL as above, RST8=0
    sta $d011
    lda #FIRST - 3
    sta $d012                // irq1 three lines above the first toggled line
    lda #$01
    sta $d01a
    sta $d019
    cli

main:
    inc $c000,x              // long instructions, as in stable-raster-irq.asm,
    inc $c100,x              // so irq1's entry jitter is the full 0 to 6
    inc $c200,x
    inx
    jmp main

// ---------------------------------------------------------------------------
// irq1: first half of the double IRQ (stable-raster-irq.asm, unchanged).
// ---------------------------------------------------------------------------
irq1:
    lda #<irq2
    sta $0314
    lda #>irq2
    sta $0315
    lda #FIRST - 1
    sta $d012                // irq2 on the sync line, 99
    lda #$01
    sta $d019
    tsx
    stx saved_sp
    cli
    .for (var i = 0; i < 40; i++) { nop }

// ---------------------------------------------------------------------------
// irq2: entered from inside a NOP; the two $D012 reads and the BEQ absorb
// the last cycle. The first instruction after the BEQ starts on cycle 4 of
// line 100. Measured with the CALIB build: the sprite's DMA pulls BA low
// from cycle 55 and the CPU stops on its next read, and the build whose
// setting write is the last one that can land before that stop is the one
// this file calls C=55 (an earlier draft assumed cycle 7 and was three
// cycles out).
// ---------------------------------------------------------------------------
irq2:
    ldx saved_sp
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+
!:
    // Line 100, from cycle 4. Start CIA1 timer A (2+4 cycles, part of the
    // padding), then pad to the writes. Head of every line: pad, then
    // STY (write at C-4), then STX (write at C); POST cycles of reads
    // follow, the DMA stop (cycles 55 to 59) falls among them, and the
    // next line's head starts on cycle 0.
    ldy #$00
    ldx #$01
    lda #$19
    sta $dc0e                // timer A: one-shot, force load, start
    Delay(WRITE_CYCLE - 21)
    sty TARGET
    stx TARGET
    Delay(POST + EXTRA)
.for (var line = FIRST + 1; line <= LAST; line++) {
    .if ((line & 7) == YSCROLL) {
        // Badline: the CPU is stopped from cycle 12 to 59 (badline DMA,
        // then the sprite's). Twelve cycles fill 0 to 11; no write can
        // land on C here, so none is attempted, and the tail runs 60 to 62.
        Delay(12)
        Delay(3 + EXTRA)
    } else {
        Delay(WRITE_CYCLE - 7)
        sty TARGET
        stx TARGET
        Delay(POST + EXTRA)
    }
}
    // Line 181, cycle 0: leave the bit clear so the rest of the sprite is
    // drawn unexpanded, then read the timer and flag the run as done.
    sty TARGET
    lda $dc04
    sta timer_lo
    lda $dc05
    sta timer_hi
    inc done

    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #FIRST - 3
    sta $d012
    lda #$01
    sta $d019
    pla
    tay
    pla
    tax
    pla
    rti

saved_sp:   .byte 0
dummy:      .byte 0

* = $2ff0                    // timer_lo, timer_hi, done: read with -moncommands
timer_lo:   .byte 0          // "m 2ff0 2ff2" on a store trace of $2ff2
timer_hi:   .byte 0
done:       .byte 0

* = $3000
sprite_data: .fill 64, 0
```

## Build

```bash
java -jar KickAss.jar sprite-stretcher.asm -o sprite-stretcher.prg
```

That is the pinned build, C=52. The sweep and the controls:

```bash
java -jar KickAss.jar sprite-stretcher.asm -o c48.prg -define C48       # any of C48 to C62
java -jar KickAss.jar sprite-stretcher.asm -o control.prg -define NOSTRETCH
java -jar KickAss.jar sprite-stretcher.asm -o calib.prg -define C55 -define CALIB
java -jar KickAss.jar sprite-stretcher.asm -o ntsc.prg -define C52 -define NTSC
```

KickAssembler 5.25 takes `-define NAME` as a preprocessor symbol only,
so the write cycle is chosen by one of fifteen plain symbols rather than
by `-define C=52` (`screen-dissolve.md` records the same trap). `-showmem`
reports one code block at $0900-$1343 (2,628 bytes, most of it the
unrolled 81 lines), three result bytes at $2FF0 and the 64-byte
sprite at $3000; the PRG is 10,305 bytes because the assembler pads the
gap between them.

## Expected output

Blue screen, light blue border, nothing on the character screen (the
program clears it). One white sprite whose rows are horizontal stripes:
row r holds the byte r+1 three times, so the stripe's pattern within each
8-pixel group reads as the row number plus one in binary (rows 0 and 1,
$01 and $02, have one dot per byte; row 2, $03, has two; row 20 is
00010101). An earlier version said row 1 had two dots. In the pinned PAL build the
sprite runs from raster line 101 to 191, 91 lines tall, and reading the
stripes top to bottom gives: row 0 on lines 101 to 105, then rows 1 to 9
on eight lines each (106 to 177), row 10 on four lines (178 to 181), and
rows 11 to 20 on one line each (182 to 191). The toggling stops on line
180 and the sprite finishes unexpanded.

Screenshots from the runs this page describes: `screenshots/sprite-stretcher.png`
(PAL) and `screenshots/sprite-stretcher-ntsc.png` (NTSC), both at the pinned
`-limitcycles 6000000`. The picture is the same on every frame after the
first (nothing moves and nothing is redrawn), so where the beam is at the
cycle limit does not matter; the limit is not in the blank on purpose.
The PAL run was made twice and the NTSC run twice; each pair's PNGs were
md5-identical. The screenshot's sprite left edge is at x 168 (VIC X 160
plus the page offset of 8 from `runtime/vice-reference.md`); row r of the
picture is raster line r+16 on PAL and r+28 on NTSC.

### The sweep

Fifteen PAL builds, one per write cycle, each run once at the pinned
command; the height and the row runs read off the stripes with a script
that decodes the 8-pixel group at x 168 on each white row. "r1x8" means
row 1 on eight consecutive lines.

| C | Height (lines) | Rows and how many lines each |
|---|---|---|
| 48, 49, 50, 51, 52, 53, 54, 55 | 91 | r0x5, r1x8, r2x8, r3x8, r4x8, r5x8, r6x8, r7x8, r8x8, r9x8, r10x4, then r11 to r20 once each. Identical in all eight builds. |
| 56 | 24 | r0 to r20 once each except r4, r11 and r18, which are doubled: the lines after the badlines 104, 112 and 120. |
| 57 | 44 | r4x2, r10x2, r11x8, r12x8, r13x6, r15x3, the rest once |
| 58 | 50 | r4x2, r7x5, r8x8, r9x3, r14x2, r16x6, r17x8, r18x3, the rest once |
| 59 | 47 | nineteen distinct rows, r6 and r20 never shown; r4x2, r7x6, r8x6, r10x3, r12x5, r13x7, r14x4, r17x3 |
| 60 | 94 | rows 0 to 20 with doublings, then rows 0 to 20 a second time: the sprite ran past its 63rd byte and wrapped |
| 61 | 53 | r3x2, r4x7, r5x3, r7x5, r8x4, r11x2, r14x6, r15x3, r16x5, r17x5 |
| 62 | 53 | r3x2, r4x6, r6x2, r7x7, r8x3, r9x5, r10x4, r13x2, r15x5, r17x2, r20x5 |
| control (`NOSTRETCH`, C=52) | 21 | r0 to r20 once each |

NTSC, `-define NTSC` builds (two more read cycles per line for the
65-cycle line, the PAL sync padding kept): C=48, C=52 and C=55 each give
the same 91-line picture as PAL, run for run. Other NTSC write cycles
were not built. The pinned PRG itself is PAL-timed, and on NTSC its line
loop is two cycles short per line: the writes walk earlier by two cycles
a line, cross the flip-flop's inversion cycle after the first badline and
then reach the crunch cycle, so the NTSC screenshot shows a 113-line
sprite (lines 101 to 213, screenshot y 73 to 185) that holds row 0 for
five lines, row 1 for eight and row 2 for three, then 76 lines (117 to
192) whose three stripe bytes no longer agree with each other, because
the crunch has left the data pointer off a row boundary and the line is
not any sprite row, then rows 0 to 20 once each on lines 193 to 213. (A
decoder reading only the first stripe byte reports the middle band as
rows; it is not.) That picture is deterministic (two runs, one md5) and
is what the pin records; it is not a stretch, which is why the page's
region is PAL.

### What the write cycle means

The cycle numbers are the VIC's, cycle 1 the first of the line, and the
figure the source calls C is the cycle in which the STX's write happens,
anchored on the sprite's own DMA. The `CALIB` build sends the same two
writes to $D021 instead, so each lands as a colour edge on the screen,
black at C-4 and white at C, 32 pixels apart. With C=55 the white edge is
at x 337 on line 100 and at x 329 on every line after it; with C=56 the
white edge is never inside the display and the black edge walks from
x 313 on line 100 to x 337 by line 103 and stays there. That is the
signature of the sprite's DMA: BA falls in cycle 55 while sprite 0 is
being fetched, the 6510 stops on its next read cycle and resumes in cycle
60. A write cycle is allowed to complete under BA low, so C=55 lands on
line 100; the read that follows it is then stopped, the line comes out a
cycle short, and from line 101 the write sits on cycle 54, where the
stop that follows it is the full five cycles and the line is 63 again.
At C=56 the STX's third read cycle is the one stopped, and the write
lands in cycle 61, past the inversion. So the edges pin the numbering:
C=55 is the last CPU write cycle that completes before the sprite-0 DMA
stall (BA low from 55), and the stopped read is cycle 55; one cycle
later the write is pushed to 61 and misses the inversion. What this
measures is that edge, not the inversion's own cycle: from the CPU side
the inversion can be anywhere from 56 to 61. An earlier draft of this file took the first
instruction after the sync to start on cycle 7 of line 100, from the
bar-edge position in `stable-raster-irq.md`; the calibration put it on
cycle 4, and the padding on line 100 was corrected by three.

### Cycle cost

CIA1 timer A, started by the `STA $DC0E` on line 100 (its write in cycle
13) and read by the `LDA $DC04` on line 181 (its read in cycle 7), counts
5,094 cycles in the pinned PAL run (the bytes at $2FF0/$2FF1 read $19
$EC, dumped with `-moncommands` on a store trace of $2FF2). Arithmetic
for that bracket is 81 lines of 63 less six cycles, 5,097; the three
missing counts are the timer's start latency, not measured separately
here. Per line the CPU executes 58 cycles of its own code when C is 55
or less (C-7 of padding, two 4-cycle stores, 57-C of padding) and is
stopped for five by the sprite's DMA; on the ten badlines it executes
fifteen and is stopped for 48. The whole line belongs to the effect.

## Why this works

The VIC-II keeps one expansion flip-flop per sprite (the "expansion
flip-flop that toggles each line" of `docs/hardware/vic-ii-reference.md`,
Expansion, which names it but not its cycle). While the sprite's $D017
bit is clear the flip-flop is held set; while the bit is set and the
sprite's DMA is on, the chip inverts it once per line in cycle 56, the
cycle VICE 3.10's PAL cycle table gives it, as cited under
`sprite_y_stretch_glitch` in `docs/techniques/sprite.md`. In cycle 16 of
the next line the sprite's row counter base advances to the next three
bytes only if the flip-flop is set; if it is clear, the same three bytes
are fetched again, which is how a Y-expanded sprite shows each row twice
(`sprite_y_stretch_glitch` has the counters by name). Clearing the bit
on cycle C-4 forces the flip-flop set; setting it again on cycle C,
before cycle 56, lets the inversion clear it; cycle 16 of the next line
then finds it clear and repeats the row. Do that every line and the row
never advances. Both writes must sit after cycle 16 and before the
inversion on the same line. The lower edge, C=17, is arithmetic from
that and was not built (nothing below C=48 was); the upper edge the
sweep shows exactly, and it is the CPU's, not the chip's: any C from 48
to 55 gives the same picture, and C=55 is the last write that completes
before the sprite's DMA stall, so C=56 (write pushed to cycle 61) gives
none.

The badlines are why the pinned picture is a staircase rather than one
row 81 lines tall. On a badline the CPU is stopped from cycle 12 to 59,
so no write can land in the window; the bit is still set from the
previous line, cycle 56 inverts the flip-flop back to set, and the next
line's cycle 16 advances the row once. With YSCROLL 0 the badlines fall
on 104, 112, ... 176, so each row is drawn on eight lines. The C=56
column shows the same mechanism in isolation: its setting write lands
after the inversion, so on ordinary lines the bit is clear at cycle 56
and the flip-flop stays set, and the only doubled rows are the three
that follow a badline, where the bit was left set across cycle 56.

The per-line block first exceeds the line's 58 code cycles at C=56, not
57: with the post-write padding clamped at two cycles it is 59 (`POST`
in the source). C=56 still comes out clean because the read the DMA
stops is released in cycle 60 whatever cycle it was stopped on, so what
has to fit is the code from the release on: at C=56 that is the released
read, the STX's write and two padding reads, cycles 60 to 63, and the
line stays 63.
From C=57 a further read of the STX precedes the write after the
release, the block runs past cycle 63, and the writes drift later by one
or more cycles a line and pass through cycle 15 of the following line,
the crunch cycle that changes the counter base once by a data-dependent
amount. The heights of 44 to 94 lines, the rows never shown at C=59 and
the wrapped sprite at C=60 are that effect; it is the one
`sprite_y_stretch_glitch` measured, and it is not a stretcher. The
`CALIB` C=56 build's black edge, which walks for three lines and then
holds, is the same re-locking seen from the clearing write.

## What it does not establish

- Anything about a physical VIC-II. Every figure is VICE 3.10 x64sc, a
  6569 for PAL and a 6567R8 for NTSC.
- The VIC's internal cycle of the inversion. What was measured is the CPU
  write cycle, anchored on the sprite DMA stop: C=55 lands, C=56 is
  pushed to 61. The inversion is placed in cycle 56 by VICE's PAL cycle
  table (cited under `sprite_y_stretch_glitch`), and the sweep is
  consistent with any inversion cycle from 56 to 61, not only 56.
- The lower edge of the write window. C=17 is arithmetic from the
  cycle-16 advance; no build below C=48 was made.
- NTSC beyond the three `-define NTSC` builds at C 48, 52 and 55, and the
  NTSC sync padding, which was left at the PAL value and happened to
  hold; the NTSC write cycles were not calibrated. The pinned PRG does
  not stretch on NTSC, which is why the page's region is PAL.
- A single row held for the whole region. That needs the badlines moved
  or removed inside the stretch (FLD, or a blanked screen with the
  sprite in the border), which this recipe does not do.
- The `sprite_y_stretch_glitch` crunch amounts at C 57 to 62, which are
  reported as read off the pictures and not analysed.
