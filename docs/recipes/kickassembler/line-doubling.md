---
recipe: line-doubling
toolchain: kickassembler
output_format: PRG
region: both
techniques: [line_doubling_and_colour_ram_double_buffer, linecrunch, fld_flexible_line_distance, stable_raster_irq, double_irq, badline_synchronization, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D018, D019, D01A, D020, D021, DC0D]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), vic_char_base (owns), zero_page $02-$0B (owns)]
ram: [state=$02E0, colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: doubled text rows, and the colour RAM double buffer they make possible

## Synopsis

Twelve text rows, each drawn 16 raster lines tall by making the VIC show
it twice, and two sets of colours for them in colour RAM, switched every
32 frames with no copy. On the last line of each row a `$D011` write on
cycle 56 restarts the row without a fetch (Bauer's doubled text lines).
The VIC still moves its row base on by 40 cells for each 8-line half, so
only every second row of screen and colour RAM is ever read: the even
rows, or the odd rows if the display starts one row on. The odd rows are
a second colour RAM. One raster line at the top picks the buffer: an FLD
line keeps row 0 (buffer 0, even rows), a linecrunch line skips it
(buffer 1, odd rows). While one buffer is on the screen the main loop
rewrites the other, one row a frame. Screen row r holds character r,
whose pixel row p is the byte 8r + p, and row j of a buffer has colour
(n + j) mod 15 + 1 for flip n, so the picture says which rows, which
pixel rows and which flip it shows. The technique is
`line_doubling_and_colour_ram_double_buffer` in `techniques/raster.md`.

## Source

```asm
// line-doubling.asm
// Doubled character rows, and a colour RAM double buffer that they make
// possible.
//
// On the last line of a character row (RC = 7), a $D011 write of
// YSCROLL = line & 7 on cycle 56 keeps the VIC in display state through
// its cycle-58 check, so RC wraps to 0 with no new row fetched and the row
// is drawn a second time from the pointers and colours already latched
// (Bauer's "doubled text lines"). A second write three lines later puts
// YSCROLL back so that the next row's badline comes 16 lines after the
// last: every row is 16 lines tall.
//
// The VIC still moves VCBASE on 40 cells at the end of each 8-line half,
// so a doubled row uses up two rows of screen and colour RAM and only
// every second row is ever fetched: rows 0, 2, 4 ... from VCBASE 0, or
// rows 1, 3, 5 ... if the display starts one row on. The unread rows are
// a second colour RAM, which cannot be bank-switched like the screen.
// One raster line picks the buffer: an FLD line (buffer 0, even rows) or
// a linecrunch line (buffer 1, odd rows), both drawn black. Either way the
// display starts on line 52 and shows 12 doubled rows, to line 243.
//
// Screen row r holds character r, whose pixel row p is the byte 8r + p,
// so every line says which row and pixel row it came from. Row j of
// buffer b (screen row 2j + b) is coloured (n + j) mod 15 + 1 for flip n.
// Every 32 frames the IRQ switches buffers; the main loop then rewrites
// the buffer just hidden, for the flip after next, one row a frame, so
// the rewrite is spread over many frames and never reaches a row the VIC
// is reading.
//
// :nodbl=1 aims the doubling write at $02FF instead of $D011.

.const ROWS   = 12              // doubled rows shown, 24 screen rows used
.const FLAG   = $02e0           // 0 = PAL, 1 = NTSC
.const frame  = $02
.const saved  = $03
.const nflip  = $04             // flips so far; buffer shown = nflip & 1
.const want   = $05             // main loop: 1 = refill the hidden buffer
.const ptr    = $06             // $06/$07, main loop and start-up only
.const col    = $08
.const slow   = $0b             // 0 during start-up: fill without waiting
.const tptr   = $09             // $09/$0a: the top table, IRQ only
.const PERIOD = 32              // frames per flip

// Delays found with a store trace; the page lists the sweeps.
.var SPP = cmdLineVars.containsKey("spp") ? cmdLineVars.get("spp").asNumber() : 12
.var SPN = cmdLineVars.containsKey("spn") ? cmdLineVars.get("spn").asNumber() : 14
.var EP = cmdLineVars.containsKey("ep") ? cmdLineVars.get("ep").asNumber() : 109
.var EN = cmdLineVars.containsKey("en") ? cmdLineVars.get("en").asNumber() : 111
.var T1P = cmdLineVars.containsKey("t1p") ? cmdLineVars.get("t1p").asNumber() : 442
.var T1N = cmdLineVars.containsKey("t1n") ? cmdLineVars.get("t1n").asNumber() : 458
.var T3P = cmdLineVars.containsKey("t3p") ? cmdLineVars.get("t3p").asNumber() : 354
.var T3N = cmdLineVars.containsKey("t3n") ? cmdLineVars.get("t3n").asNumber() : 370
.var T4P = cmdLineVars.containsKey("t4p") ? cmdLineVars.get("t4p").asNumber() : 341
.var T4N = cmdLineVars.containsKey("t4n") ? cmdLineVars.get("t4n").asNumber() : 356
.var NODBL = cmdLineVars.containsKey("nodbl") ? cmdLineVars.get("nodbl").asNumber() : 0
.const T2     = 150

BasicUpstart2(start)

.macro Delay(c) {
    .if (c == 1) .error "Delay cannot make 1 cycle"
    .if (c > 0) {
        .if ((c & 1) != 0) { bit $ea }
        .for (var i = 0; i < ((c & 1) != 0 ? c - 3 : c) / 2; i++) { nop }
    }
}

// Wait(c): exactly c cycles (c >= 12); Y is used.
.macro Wait(c) {
    .var n0 = floor((c - 3) / 5)
    .var n = (c - (5 * n0 + 1)) == 1 ? n0 - 1 : n0
    ldy #n
!:  dey
    bne !-
    Delay(c - (5 * n + 1))
}

// Lines 50 and 51: one $D011 write each on cycle 60, from the buffer's table.
.macro Top(LINE, ENTRY) {
    ldy #0
    Delay(ENTRY)
!loop:
    lda (tptr), y       // 5
    sta $d011           // 4: the write
    iny                 // 2
    cpy #2              // 2
    beq !done+          // 2 (3 taken)
    Delay(LINE - 18)
    jmp !loop-          // 3
!done:
}

// ROWS doubled rows. Row j's badline is B = 52 + 16j. On B + 7 (RC = 7),
// YSCROLL = (B + 7) & 7 on cycle 56 restarts the row; on B + 10,
// YSCROLL = B & 7 again, so B + 16 is the next row's badline. An
// iteration is 16 lines less the next badline's stall.
.macro Rows(T1, T3, T4) {
    ldx #ROWS
!row:
    Wait(T1)
    lda #$18 | ((52 + 7) & 7)
    .if (NODBL == 0) { sta $d011 } else { sta $02ff }
    Wait(T2)
    lda #$18 | (52 & 7)
    sta $d011
    dex
    beq !done+
    Wait(T3)
    jmp !row-
!done:
    Wait(T4)
    lda #$78 | (5 & 7)          // after line 243: no badline on 244, black
    sta $d011
}

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    jsr detect_region
    // Screen rows 0-24 hold character r.
    lda #<$0400
    sta ptr
    lda #>$0400
    sta ptr + 1
    ldx #0
!row:
    ldy #39
    txa
!:  sta (ptr), y
    dey
    bpl !-
    lda ptr
    clc
    adc #40
    sta ptr
    bcc !+
    inc ptr + 1
!:  inx
    cpx #25
    bne !row-
    lda #$18                    // screen $0400, charset $2000
    sta $d018
    lda #0
    sta $d021
    sta $d020
    sta nflip
    sta frame
    sta want
    sta slow
    lda #0                      // buffer 0 for flip 0
    jsr fillbuf
    lda #1                      // buffer 1 for flip 1
    jsr fillbuf
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$1b
    sta $d011
    lda #46
    sta $d012
    lda #1
    sta $d01a
    sta $d019
    cli
    lda #1
    sta slow
main:
    lda want
    beq main
    lda #0
    sta want
    lda nflip                   // the buffer just hidden, for flip n + 1
    clc
    adc #1
    jsr fillbuf
    jmp main

// fillbuf: A = flip m. Buffer m & 1 (screen rows 2j + (m & 1)) gets
// colour (m + j) mod 15 + 1 in row j.
fillbuf:
    sta col
    and #1
    beq !+
    lda #<($d800 + 40)
    ldx #>($d800 + 40)
    jmp !set+
!:  lda #<$d800
    ldx #>$d800
!set:
    sta ptr
    stx ptr + 1
    ldx #0                      // j
!r: txa
    clc
    adc col
!m: cmp #15
    bcc !+
    sbc #15
    jmp !m-
!:  clc
    adc #1
    ldy #39
!:  sta (ptr), y
    dey
    bpl !-
    lda ptr
    clc
    adc #80                     // the buffer's next row
    sta ptr
    bcc !+
    inc ptr + 1
!:  lda slow                    // after start-up, one row a frame: the
    beq !++                     // refill spans 12 frames, all while the
    lda frame                   // other buffer is on the screen
!:  cmp frame
    beq !-
!:  inx
    cpx #ROWS
    bne !r-
    rts

detect_region:
!wlo:
    bit $d011
    bmi !wlo-
!whi:
    bit $d011
    bpl !whi-
!track:
    lda $d012
    bit $d011
    bpl !over+
    tax
    jmp !track-
!over:
    lda #0
    cpx #$10
    bcs !+
    lda #1
!:  sta FLAG
    rts

// irq1 (line 46) and irq2p/irq2n (line 48): the double IRQ of
// stable-raster-irq.
irq1:
    lda #$1b
    sta $d011
    ldx #<irq2p
    ldy #>irq2p
    lda FLAG
    beq !+
    ldx #<irq2n
    ldy #>irq2n
!:  stx $0314
    sty $0315
    lda #48
    sta $d012
    lda #1
    sta $d019
    tsx
    stx saved
    lda nflip                   // this frame's buffer: its top table
    and #1
    tax
    lda toplo, x
    sta tptr
    lda tophi, x
    sta tptr + 1
    cli
    .for (var i = 0; i < 40; i++) { nop }

irq2p:
    ldx saved
    txs
    Delay(SPP)
    lda $d012
    cmp $d012
    beq !+
!:
    Top(63, EP)
    Rows(T1P, T3P, T4P)
    jmp done
irq2n:
    ldx saved
    txs
    Delay(SPN)
    lda $d012
    cmp $d012
    beq !+
!:
    Top(65, EN)
    Rows(T1N, T3N, T4N)
done:
    inc frame
    lda frame
    and #PERIOD - 1
    bne !+
    inc nflip                   // the other buffer from the next frame
    lda #1
    sta want
!:  lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #46
    sta $d012
    lda #1
    sta $d019
    jmp $ea81

toplo: .byte <top0, <top1
tophi: .byte >top0, >top1
// Buffer 0: line 50 writes (50 + 2) & 7 (FLD: line 51 is no badline and
// stays idle, black with ECM and BMM); line 51 writes 52 & 7.
top0: .byte $78 | ((50 + 2) & 7), $18 | (52 & 7)
// Buffer 1: line 50 writes 50 & 7 on cycle 60 (linecrunch: line 51 uses
// up row 0, black); line 51 writes 52 & 7.
top1: .byte $78 | (50 & 7), $18 | (52 & 7)

* = $2000
.for (var r = 0; r < 25; r++) {
    .for (var p = 0; p < 8; p++) { .byte r * 8 + p }
}
```

## Build

```bash
java -jar KickAss.jar line-doubling.asm -o line-doubling.prg
```

The doubling write swept one cycle at a time, keeping the 16-line period
(PAL; `:t1n=458+d :t3n=370-d` on NTSC), and the write turned off:

```bash
java -jar KickAss.jar line-doubling.asm :t1p=442+d :t3p=354-d -o s.prg   # d = -4 to 4: cycles 52 to 60
java -jar KickAss.jar line-doubling.asm :nodbl=1 -o nodbl.prg
```

`-showmem` reports `$0900` to `$0BBF` for the code and `$2000` to `$20C7`
for the 25 characters. The PRG is 6,345 bytes.

## Expected output

A black screen. Lines 51 and 244 to 250 are black. Lines 52 to 243 are
twelve bands 16 lines tall, one colour each, every band the eight pixel
rows of one character twice over: the pattern of character 2j + b in band
j, where b is the buffer shown. The colours step through the palette from
band to band and move one step every 32 frames, as the buffers swap.

Measured in VICE x64sc 3.10 with the pinned command, PAL c64c
(8565/8580/8521) and NTSC (`-model ntsc`, 6567R8). Each line from 51 to
250 was decoded with PIL (all 40 cells, lit pixels to a byte, byte to
row and pixel row, colour to palette index with the triples in
`runtime/vice-reference.md`) and compared with the model "line 52 + 16j +
q shows screen row 2j + b, pixel row q & 7, colour (n + j) mod 15 + 1":

| Run | Model | Buffer b | Flip n | Lines 52-243 matching | One colour per band | Lines 51, 244-250 black |
|---|---|---|---|---|---|---|
| 8,000,000 cycles | PAL | 1 (odd rows) | 7 | 192 of 192 | yes | yes |
| 8,000,000 cycles | NTSC | 0 (even rows) | 8 | 192 of 192 | yes | yes |
| `@later`, 8,300,000 cycles | PAL | 0 | 8 | 192 of 192 | yes | yes |
| `@later`, 8,300,000 cycles | NTSC | 1 | 9 | 192 of 192 | yes | yes |

A store trace of `$D011` over 8,000,000 cycles put the doubling write on
cycle 56 and the restoring write on cycle 23 (PAL) or 17 (NTSC) for every
row of every frame after the first: 3,036 of each on PAL (253 frames) and
3,420 on NTSC (285 frames). The two top writes are on cycle 60 of lines
50 and 51. Screenshots: `screenshots/line-doubling.png`,
`screenshots/line-doubling-ntsc.png`, `screenshots/line-doubling-later.png`
and `screenshots/line-doubling-later-ntsc.png`.

### The colour RAM stores

A store trace of `$D800`-`$DBFF`, with the flip counter `$04` read at
each store:

| Model | Stores by the program after start-up | To a row of the buffer on the screen | Made while the beam was on lines 52-243 | First to last store of one refill |
|---|---|---|---|---|
| PAL | 3,360 (7 refills of 480) | 0 | 0 | 11.0 frames |
| NTSC | 3,840 (8 refills) | 0 | 0 | 11.0 frames |

The 960 stores of the two start-up fills, made before the raster
interrupt is on, are left out. No store fell inside the display because
the interrupt holds the CPU from line 48 to 243 in every frame; the
refills run in the border, one row each frame, while the other buffer is
shown.

### The doubling write cycle

The doubling write moved with `:t1p`/`:t1n`, the period kept. Rows shown
in each 8-line half from line 52, PAL (NTSC shows the same pattern from
row 0):

| Write cycle | Rows, 8 lines each | What happens |
|---|---|---|
| 52, 53 (first row) | 16 broken lines, then 3, 3, 5, 5 ... | A late badline on the first row; its stall ends on cycle 54 and pulls every later row's write to 54 |
| 54 to 57 | 1, 1, 3, 3, 5, 5, 7, 7 | Each row restarted and drawn twice |
| 58 to 60 | 1, then pixel row 7 of row 1 once more and seven black lines, 3, ... | RC held at 7, the linecrunch write: one extra line, then the VIC idles until the next badline, which fetches row 3 |
| none (`:nodbl=1`) | 1, 2, 3, 4, 5, 6, 7, 8 | Ordinary 8-line rows, one after the other |

The last line shows why a doubled row costs two rows of screen memory:
without the write the rows after row 1 are 2, 3, 4; with it they are 3,
5, 7.

## Why this works

### The doubled row

Bauer (§3.14.5): the display of a row ends in cycle 58 of its last line,
where RC is 7 and the VIC goes idle. A badline condition made true on
cycles 54 to 57 of that line keeps it in display state, RC is
incremented and wraps to 0, and the next line starts the same row again
from the pointers and colours already latched; no c-access happens. The
write here sets YSCROLL to the line's own low bits on cycle 56. Three
lines later a second write puts YSCROLL back, so that no line in the
repeated half matches it and the next badline comes 16 lines after the
last. The VIC's cycle-58 step still loads VCBASE from VC after each half,
and VC has counted 40 cells in each half, so the next badline fetches the
row after next.

### Two colour RAMs in one

Colour RAM is one fixed kilobyte at `$D800`; `$D018` and the VIC bank move
the screen and the character set, never the colours. With every row
doubled the VIC reads colour RAM rows 0, 2, 4 ... 22 when the display
starts from VCBASE 0, and rows 1, 3 ... 23 when it starts from VCBASE 40.
One line picks which: on line 50 an FLD write (YSCROLL = 52 & 7, with ECM
and BMM set so the idle line is black) leaves VCBASE at 0; a linecrunch
write (YSCROLL = 50 & 7 on cycle 60, `linecrunch`) uses row 0 up on line
51. Either way line 52 is the first badline. A write to the buffer not
shown cannot tear the picture, however long it takes. The cost is half
the vertical colour and character resolution: 12 distinct rows of 16
lines.

### The timing

The double IRQ is the one in `stable-raster-irq`, at line 48, pad 12 on
PAL and 14 on NTSC as in `fpp`. Each row is one pass of a loop of three
waits and two stores; the next row's badline stall is part of the pass,
so the waits were set by trace until the pass was exactly 16 lines
(1,008 cycles on PAL, 1,040 on NTSC, stall included). A pass one cycle
longer moves the write one cycle later on every row; one cycle shorter
moves it earlier until it lands on cycle 52 or 53, where a late badline
stalls the CPU to 54 and holds it there.

### Sources

- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64" (1996), §3.7.2, §3.14.4, §3.14.5
  "Doubled text lines", §3.14.6: https://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt
- Codebase64, "Introduction to Vertical Tweaks", "Repeating char-line":
  https://codebase64.c64.org/doku.php?id=base:introduction_to_vertical_tweaks
