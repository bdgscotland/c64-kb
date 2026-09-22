---
recipe: fli-image
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [fli_image, stable_raster_irq, double_irq]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, DD00]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — FLI Image Display

## Synopsis

FLI (Flexible Line Interpretation): a fresh video-matrix fetch on every one
of the 200 display lines, so each line gets its own screen-RAM colours
instead of sharing one set with the other seven lines of its character row.
Eight 1 KB screen pages hold the colours for lines 0, 1, ... 7 (mod 8). On
each line the code points $D018 at that line's page and then forces a
badline by writing YSCROLL = line & 7 into $D011, timed so the condition
arises on cycle 15 — late enough that the row counter is not reset, early
enough that only three character columns miss their fetch. That miss is the
FLI bug.

The listing displays a test pattern rather than a picture: the bitmap is
all %01 pixels, so every pixel takes its colour from the high nibble of
screen RAM, and page p is filled with colour p. A correct FLI therefore
shows eight one-line-tall colour stripes repeating down the whole screen,
with the three leftmost columns light grey. Replace the three `.fill`
blocks with converter output for a real image.

Verified in VICE x64sc: all 200 display rows are single-coloured across
columns 3-39, the colour sequence repeats with period 8, and columns 0-2
are light grey on every row.

## Source

```asm
// fli-image.asm
// FLI: a fresh video matrix fetch on every one of the 200 display lines,
// so each line gets its own screen-RAM colours. Eight 1 KB screen pages
// hold the colours for lines 0, 1, ... 7 (mod 8); on each line the code
// points $D018 at that line's page and then forces a badline by writing
// YSCROLL = line & 7 into $D011, timed so the write lands on cycle 15.
//
// The image here is a test pattern, not a picture: the bitmap is all %01
// pixels, so every pixel takes its colour from the high nibble of screen
// RAM, and page p is filled with colour p. A correct FLI shows eight
// one-line-tall colour stripes repeating down the screen, with the three
// leftmost character columns light grey: the FLI bug, see text. Replace
// the three .fill blocks with converter output for a real image.
//
// Region: pal. The per-line timing is 63-cycle arithmetic.

.const FIRST_LINE = 51       // first display line: the natural badline
.const LAST_LINE  = 250
.const SYNC_LINE  = 48       // stable raster here; 48 & 7 = 0, not a badline
.const SYNC_PAD   = 11       // as measured for stable-raster-irq
.const ENTRY_PAD  = 198      // from the sync to cycle 55 of FIRST_LINE (see text)
.const LINE_PAD   = 11       // cycles between the end of one line's stall and the next block

// VIC bank 1 ($4000-$7FFF): eight screen pages at $4000 + p*$400, bitmap at $6000.
.const BANK     = $4000
.const BITMAP   = BANK + $2000

BasicUpstart2(start)

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

// $D018 for page p: VM = p (bits 7-4), CB bit 3 set = bitmap at $2000 in the bank.
.function d018(p) { .return (p << 4) | $08 }
// $D011 for line l: BMM, DEN, RSEL, YSCROLL = l & 7.
.function d011(l) { .return $38 | (l & 7) }

// ---------------------------------------------------------------------------
// Test pattern
// ---------------------------------------------------------------------------
.for (var p = 0; p < 8; p++) {
    * = BANK + p * $400
    .fill 1000, (p << 4) | p       // high nibble = colour for %01 pixels
}
* = BITMAP
    .fill 8000, $55                // every pixel pair is %01

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d

    lda $dd00
    and #$fc
    ora #$02                 // VIC bank 1
    sta $dd00
    lda #0
    sta $d020
    sta $d021
    ldx #0                   // colour RAM black: the %11 colour, unused here
!:  sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $dae8, x
    inx
    bne !-

    lda #$d8                 // multicolour, 40 columns
    sta $d016
    lda #d018(FIRST_LINE & 7)
    sta $d018                // the page line 51's natural badline will fetch
    lda #$3b                 // multicolour bitmap on, YSCROLL 3
    sta $d011

    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #SYNC_LINE - 3
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// Double IRQ, as in stable-raster-irq.asm.
irq1:
    lda #<irq2
    sta $0314
    lda #>irq2
    sta $0315
    lda #SYNC_LINE - 1
    sta $d012
    lda #$01
    sta $d019
    tsx
    stx saved_sp
    cli
    .for (var i = 0; i < 40; i++) { nop }

irq2:
    ldx saved_sp
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+
!:
    // A known cycle of SYNC_LINE. Wait until cycle 55 of FIRST_LINE, which
    // is where the CPU stands after that line's natural badline; from here
    // every line looks the same to the code below.
    Delay(ENTRY_PAD)

    // One block per line. The block for line l starts on cycle 55 of line
    // l-1: LINE_PAD cycles of padding, then $D018, then $D011 with its
    // write on cycle 15 of line l. That write creates the badline
    // condition; the CPU is halted on its next read until cycle 55.
    .for (var l = FIRST_LINE + 1; l <= LAST_LINE; l++) {
        Delay(LINE_PAD)
        lda #d018(l & 7)
        sta $d018
        lda #d011(l)
        sta $d011
    }

    // Cycle 55 of LAST_LINE. Back to a normal $D011 so line 51 of the next
    // frame is a natural badline again, then re-arm.
    lda #$3b
    sta $d011
    lda #d018(FIRST_LINE & 7)
    sta $d018
    lda #SYNC_LINE - 3
    sta $d012
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$01
    sta $d019
    pla
    tay
    pla
    tax
    pla
    rti

saved_sp: .byte 0
```

## Build

```bash
java -jar KickAss.jar fli-image.asm -o fli-image.prg
```

The PRG is about 19 KB: 8 KB of screen pages, 8 KB of bitmap and 3.2 KB of
unrolled per-line code.

## Expected output

Black border. Inside the display, 200 horizontal stripes one raster line
tall in the sequence black, white, red, cyan, purple, green, blue, yellow,
repeating 25 times: the eight page colours, one line each. The three
leftmost character columns (24 pixels) are light grey on every line. With a
converted image in place of the fills, the picture, with the same grey band
down the left.

If every eighth line is wrong or the picture repeats one character row
down the screen, the $D011 write is landing on cycle 14 or earlier and
resetting the row counter. If the grey band is four columns wide and the
first column shows a stale colour, the write is landing on cycle 16; see
`LINE_PAD` below.

Screenshot from the VICE run this page describes: `screenshots/fli-image.png`.

## Why this works

### What FLI defeats

In bitmap mode the VIC-II reads 40 bytes of screen RAM (the c-accesses) on
each badline, the first line of each character row, into an internal
buffer, and uses those 40 colour pairs for all eight lines of the row. That
is the 8-line attribute grid. A badline is any line where `(line & 7) ==
YSCROLL` with DEN set (lines $30-$F7). FLI makes every line a badline by
setting YSCROLL to `line & 7` on every line, and points $D018 at a different
1 KB screen page each time, so the buffer is refilled from a different
page on every line.

### Why the write must be on cycle 15

The badline condition is evaluated every cycle. Two things depend on when
it first becomes true:

- In cycle 14 the VIC loads its video counter from the row base and, *if
  the condition holds in that cycle*, resets the row counter RC to 0. A
  reset every line would display line 0 of every character row eight
  times and never advance to the next row. So the condition must not be
  true in cycle 14; the previous line's YSCROLL is still in the register
  then, and it does not match.
- When the condition becomes true in cycles 15-53, BA goes low and the
  c-accesses begin three cycles later, one per cycle, for the columns whose
  slot has not yet passed. Columns whose slot passed before the accesses
  started read as $FF: colour nibbles of $F, light grey. A condition true
  from cycle 15 starts accesses on 18 and loses columns 0, 1 and 2. That is
  the FLI bug, and three columns is the minimum: one cycle earlier is cycle
  14 and the RC reset.

`LINE_PAD = 11` is the value at which VICE shows exactly that: three grey
columns and correct colours from column 3. With 12 the grey band moves one
column right and column 0 keeps the colour of line 51's fetch; with 13 it
moves two. The cycle numbers in the comments are the model; the padding is
the measurement, and a real 6569 should be checked against the picture in
the same way.

### Why the loop needs no per-line cycle count

After the write the CPU's next instruction fetch is a read, and the VIC
holds BA low until cycle 54, so the CPU is stalled until cycle 55 whatever
it was about to do. Each line's block therefore always begins on cycle 55
of the previous line, and only the code between there and the $D011 write
has to be counted: `LINE_PAD` cycles, `LDA #`/`STA $D018` (6),
`LDA #`/`STA $D011` (6). The 200 blocks are emitted unrolled by a `.for`
loop; a counted loop would need its own cycles inside a budget of about 20.

The same stall is what makes `ENTRY_PAD` uncritical: line 51 is a natural
badline (YSCROLL 3, 51 & 7 = 3), the CPU stalls there from cycle 12 until
55 no matter where the entry delay put it, and the first block starts on
cycle 55 of line 51 as intended. The double IRQ is still needed so the
delay arrives at line 51 at all, not two lines off; any value of
`ENTRY_PAD` from 196 to 200 gives the same picture.

### The 8-page layout and the bank

The eight pages have to be in the same 16 KB VIC bank as the bitmap, and
$0400-$1FFF in bank 0 is where BASIC's stub, this program and the KERNAL's
working storage live. So the whole display moves to bank 1: pages at
$4000-$5FFF, bitmap at $6000-$7F3F, `$DD00` bits 0-1 set to %10. $D018's
VM nibble selects the page (0-7) and its CB bit 3 selects the bitmap at
offset $2000 in the bank. Colour RAM is not banked and not paged: the %11
pixel colour is the same on all eight lines of a row, which is why FLI
converters put the least line-dependent colour there.

### Per-line cost

With 40 cycles of every line taken by the VIC and 12 by the two writes,
the CPU has about 11 cycles per line of its own for 200 lines: nothing.
Music, sprites and everything else happen in the 112 lines of border. A
sprite active in the FLI region would move the CPU's stall and break the
timing; FLI pictures with sprites time them into the budget deliberately.

### Region

`region: pal`. The NTSC 6567R8 line is 65 cycles and the badline stall
ends on a different cycle; the block structure is the same, `LINE_PAD` is
not.
