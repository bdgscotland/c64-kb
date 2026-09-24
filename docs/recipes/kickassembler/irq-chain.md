---
recipe: irq-chain
toolchain: kickassembler
output_format: PRG
region: both
techniques: [irq_chain_table]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, D021, DC0D]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init)]
---

<!-- doc-type: recipe -->

# KickAssembler — Table-driven raster IRQ chain

## Synopsis

Three raster interrupts per frame from one dispatcher and a table of
(line, handler) pairs. The dispatcher behind `$0314` acknowledges `$D019`,
arms the next row's line in `$D012` and `$D011` bit 7, calls the current
row's handler through the table, and when the index wraps to 0 counts one
frame, calls a music stub and prints the counter. Each handler changes the
border colour and writes its own index to the screen, so the picture shows
three bands, the frame count and the slot that ran last. This is the
`irq_chain_table` technique with nothing else in it; use it as the skeleton
for a game or demo that needs several raster splits and one once-a-frame
point.

## Source

```asm
// irq-chain.asm: a table-driven raster IRQ chain, three slots.
// One dispatcher at $0314 walks a (line, handler) table. Each slot changes
// the border colour; the wrap back to slot 0 counts one frame and prints it.
// Build: java -jar KickAss.jar irq-chain.asm -o irq-chain.prg

BasicUpstart2(start)

.const SCREEN  = $0400
.const NSLOTS  = 3
.const LINE0   = 40                  // top border, before the first badline
.const LINE1   = 130                 // inside the display, not a badline
.const LINE2   = 260                 // below the display; needs RST8 = 1
.const TEXTROW = SCREEN + 12 * 40 + 10

* = $0810

// ---------------------------------------------------------------------------
// Install: KERNAL in, CIA1 timer IRQ off, first slot armed, dispatcher hooked.
// ---------------------------------------------------------------------------
start:
    sei
    lda #$7f
    sta $dc0d                // no CIA1 interrupts: only the raster reaches $0314
    lda $dc0d                // clear one already flagged

    ldx #0
!:  lda #$20                 // clear the screen, white text
    sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $300,x
    lda #1
    sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $db00,x
    inx
    bne !-
    ldx #18
!:  lda caption,x
    sta TEXTROW,x
    dex
    bpl !-

    lda #0
    sta slot
    sta frame_lo
    sta frame_hi
    sta $d020
    sta $d021

    lda #$1b                 // text mode, 25 rows, YSCROLL 3, RST8 compare 0
    sta $d011
    lda #LINE0
    sta $d012
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #$01
    sta $d01a                // raster interrupt on
    sta $d019                // and nothing pending from before
    cli
    jmp *

// ---------------------------------------------------------------------------
// Dispatcher. Order: acknowledge, arm the next slot, run this slot, advance.
// Arming before the call means a handler that overruns the next line makes
// the next slot late instead of losing it; the acknowledge is first so that
// a raster interrupt raised during the overrun stays pending.
// ---------------------------------------------------------------------------
irq:
    lda #$01
    sta $d019                // acknowledge this raster interrupt

    ldx slot
    inx
    cpx #NSLOTS
    bne !+
    ldx #0
!:  stx next
    lda line_lo,x            // arm the next slot's line, all nine bits
    sta $d012
    lda $d011
    and #$7f
    ora line_hi,x
    sta $d011

    ldx slot
    lda handler_lo,x         // call this slot's handler through the table
    sta call + 1
    lda handler_hi,x
    sta call + 2
call:
    jsr $ffff

    ldx next
    stx slot
    bne done                 // index wrapped to 0: one frame is complete
    inc frame_lo
    bne !+
    inc frame_hi
!:  jsr music_tick           // once per frame, from the wrap only
    jsr print_frame
done:
    jmp $ea81                // pla/tay/pla/tax/pla/rti; no KERNAL housekeeping

// ---------------------------------------------------------------------------
// The table. Lines and handlers are parallel arrays indexed by slot.
// ---------------------------------------------------------------------------
line_lo:    .byte <LINE0, <LINE1, <LINE2
line_hi:    .byte (LINE0 >> 8) << 7, (LINE1 >> 8) << 7, (LINE2 >> 8) << 7
handler_lo: .byte <slot0, <slot1, <slot2
handler_hi: .byte >slot0, >slot1, >slot2

// ---------------------------------------------------------------------------
// Slot handlers. Each must return before the next slot's line arrives.
// ---------------------------------------------------------------------------
slot0:
    lda #2                   // red from line 40
    sta $d020
    lda #'0'
    sta TEXTROW + 18
    rts

slot1:
    lda #5                   // green from line 130
    sta $d020
    lda #'1'
    sta TEXTROW + 18
    rts

slot2:
    lda #6                   // blue from line 260
    sta $d020
    lda #'2'
    sta TEXTROW + 18
    rts

music_tick:                  // put the SID player's play call here
    rts

// 16-bit frame counter as five decimal digits, by repeated subtraction.
print_frame:
    lda frame_lo
    sta value
    lda frame_hi
    sta value + 1
    ldy #0
digit:
    ldx #'0'
subtract:
    lda value
    sec
    sbc pow10_lo,y
    sta scratch
    lda value + 1
    sbc pow10_hi,y
    bcc place                // went below zero: this digit is done
    sta value + 1
    lda scratch
    sta value
    inx
    bne subtract
place:
    txa
    sta TEXTROW + 6,y
    iny
    cpy #5
    bne digit
    rts

pow10_lo: .byte <10000, <1000, <100, <10, <1
pow10_hi: .byte >10000, >1000, >100, >10, >1

caption:  .text "frame 00000  slot -"

slot:     .byte 0
next:     .byte 0
frame_lo: .byte 0
frame_hi: .byte 0
value:    .word 0
scratch:  .byte 0
```

## Build

```bash
java -jar KickAss.jar irq-chain.asm -o irq-chain.prg
```

## Expected output

A black screen with one line of white text on row 12, `FRAME nnnnn  SLOT 1`,
and a border in three bands: blue for the top 26 rows of the picture
(lines 16 to 41, left over from the previous frame's slot 2), red from
line 42, green from line 133, blue again from line 262 to the bottom and
on through the vertical blank into the next frame, where slot 0 turns it
red again. The table below gives the exact lines for both border columns.

Measured in VICE x64sc 3.10 from the exit PNG with PIL, 8,000,000 cycles,
raster line = PNG row + 16 on PAL and + 28 on NTSC:

| Slot | Table line | New colour at x = 380 (right border) from line | At x = 2 (left border) from line |
|---|---|---|---|
| 0 | 40 | 41 | 42 |
| 1 | 130 | 132 | 133 |
| 2 | 260 | 261 | 262 |

The same six lines on PAL and on NTSC. Every band starts one line below
its table entry, part-way across: the colour write completes about 111
cycles after the interrupt's line begins, which is cycle 48 of the next
line (counted from the listing; `irq_chain_table` has the breakdown). On
line 41, which is all border, the first red pixel is at x = 305 on PAL
(x = 304 is a single light grey pixel) and x = 281 on NTSC. Slot 1 is
armed at 130, so its write is a line later still: line 130 is the last
line of text row 9 (51 + 9 × 8 + 7), and 131, with 131 AND 7 = 3 =
YSCROLL, is a badline, which holds the store until the VIC gives the bus
back.

The frame counter reads `00254` on PAL and `00286` on NTSC. A PAL frame
is 312 × 63 = 19,656 CPU cycles and a 6567R8 frame 263 × 65 = 17,095
(settled), so the chain ran for between 254 × 19,656 = 4,992,624 and
5,012,280 cycles on PAL and between 286 × 17,095 = 4,889,170 and 4,906,265
on NTSC, and was installed about 3.0 million cycles into the PAL run and
about 3.1 million into the NTSC one; the rest is the KERNAL reset and the
autostart, and why they differ by about 100,000 cycles between the models
was not measured here. The prediction that can be checked without that
offset is the difference between two cycle counts: at 12,000,000 cycles
the PAL counter reads `00458`, 204 more, against 4,000,000 / 19,656 = 203.5
(measured, one extra run at 12,000,000; not pinned).

The slot cell always reads `1` in the picture, on both models. Slot 0 writes
its digit at line 40 and slot 1 at line 130, both before the beam draws row
12 at lines 147 to 154; slot 2 writes at 260, after it. The screen shows
what the cell held when the beam passed, not what it holds at the moment of
exit. A cell in any row of the display would read the same, because every
display row lies between line 130 and line 260.

Screenshots from the VICE runs this page describes: `screenshots/irq-chain.png`
(PAL) and `screenshots/irq-chain-ntsc.png` (NTSC).

## Why this works

`irq` is the only interrupt handler in the program. The install masks CIA1
(`$7F` to `$DC0D`, then a read to drop a flagged timer), so the KERNAL's
sixtieth-of-a-second interrupt never reaches `$0314` and every entry is a
raster match. The exit is `JMP $EA81`, the KERNAL's register restore and
`RTI`, so nothing of the KERNAL's own service runs; `TI$` stops and the
keyboard is dead, which is fine for this recipe and is what a game with its
own input code wants. To keep them alive, exit the wrap through `$EA31`
instead (`raster-bars.md` measures the cost).

The order inside the dispatcher is the point of the page. The acknowledge
comes first so that a raster match raised while a handler is still running
stays pending and is taken as soon as the dispatcher's `RTI` completes. The
next line is armed second, before the handler is called, so that the match
can be raised at all during an overrun. `irq_chain_table` reports the
measurement: with slot 1 padded to about 9,000 cycles, this order keeps the
frame counter at 254 and runs slot 2 late; moving the acknowledge to the end
of the dispatcher drops it to 127.

The table row for line 260 is what the `AND #$7F / ORA line_hi,x` on `$D011`
is for. `$D012` alone would arm line 4; the ORed bit 7 makes it 260, and the
seven low bits of `$D011` (the mode, DEN, RSEL and YSCROLL) are kept. The
same two instructions arm lines 40 and 130 with bit 7 clear, so the
dispatcher is the same whichever rows need the ninth bit.

The call through the table is a `JSR` whose operand is patched from
`handler_lo` and `handler_hi`. The 6510 has no `JMP (abs,X)`, and a patched
`JSR` lets every handler end in `RTS` and leave the exit to the dispatcher;
a `JMP (vector)` would need each handler to jump back. The wrap test is the
stored index: `ldx next / stx slot / bne done` falls through only when the
index has just gone back to 0, and that is the one place the frame counter
is incremented, the music stub is called and the counter is printed, all
below the display where the screen write cannot tear.

The decimal print is the subtract-powers loop from
`game-design/game-design-patterns.md` ("Printing numbers"), run over five
powers down to 1 rather than that page's four plus a remainder, so the
units come out of the same loop; five digits, leading zeros kept. `'0'` in KickAssembler is the screen code `$30`, and the
caption is written in lower case because the default `.text` encoding is
screen codes: `frame` assembles to `$06 $12 $01 $0D $05`, which the ROM's
upper-case set draws as `FRAME`. Upper case in the source would assemble
to `$46` upward and draw as graphics.
