---
recipe: soft-scroll-h
toolchain: oscar64
output_format: PRG
region: both
techniques: [soft_scroll_h]
file_formats: [PRG]
uses_registers: [D016]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Hardware Horizontal Soft-Scroll

## Synopsis

Hardware horizontal soft-scrolling with the VIC-II's
`$D016` XSCROLL field (bits 2-0). Each frame the XSCROLL offset is decremented
by one, shifting the displayed character grid one pixel to the left. When the
offset wraps from 0 to 7, the screen RAM is moved one column to the left to
carry new content onto the right edge (an earlier version of this sentence
said "right ... left edge", the opposite of what the code does). No raster
IRQ is needed. On seven frames out of eight the only CPU cost is one register
write; the eighth frame moves 975 bytes in 7,938 cycles, top row first, and
stays ahead of the beam (measured below). This is the `soft_scroll_h`
technique from `docs/techniques/scroll.md`.

## Source

```c
// soft-scroll-h.c
//
// Hardware horizontal soft-scroll with a coarse move that races the beam.
// $D016 bits 2-0 (XSCROLL) shift the display right by 0-7 pixels.
// Decrement once per frame for a leftward scroll; when it wraps, move the
// screen RAM one column left, top row first, starting in the vertical blank.
//
#include <c64/vic.h>
#include <string.h>

// Screen RAM at the default C64 location.
#define Screen ((byte *)0x0400)

// Color RAM. Every cell is white and stays white, so it is never moved.
#define Color  ((byte *)0xd800)

// Width and height of the text display.
#define COLS  40
#define ROWS  25

// The content source: a 48-character message ring buffer.
//
// The bytes go straight into screen RAM, so they must be SCREEN CODES, not
// PETSCII. Oscar64's s"" prefix emits screen codes, and its default charmap
// maps lowercase source letters to the unshifted (upper-case) glyphs, so
// s"scroll" is $13 $03 $12 $0F $0C $0C and displays as SCROLL. An earlier
// version used 'S','C',... character literals, which are PETSCII ($53 ...)
// and drew card suits and box graphics instead of letters.
static const char message[] = s"scroll left hardware xscroll d016 oscar64 * * * ";

// Position in the message ring.
static char msg_pos = 0;

// Return the next character from the message ring.
static byte next_char(void)
{
    byte c = message[msg_pos];
    if (c == 0) {
        msg_pos = 0;
        c = message[0];
    }
    msg_pos++;
    return c;
}

// Move all 25 rows of screen RAM one column left and put c in column 39.
// Both loops are unrolled at compile time, so every byte is one
// LDA abs / STA abs pair (8 cycles) with no pointer and no loop counter:
// 975 moves plus 25 stores, 7,938 cycles measured, 5,927 bytes of code.
// Rows go top to bottom, so each row is finished before the beam reaches it.
static void shift_screen_left(byte c)
{
#pragma unroll(full)
    for (char row = 0; row < ROWS; row++) {
#pragma unroll(full)
        for (char x = 0; x < COLS - 1; x++)
            Screen[row * COLS + x] = Screen[row * COLS + x + 1];
        Screen[row * COLS + COLS - 1] = c;
    }
}

int main(void)
{
    // Clear the screen and set a visible background.
    memset(Screen, 0x20, COLS * ROWS);  // fill with spaces
    memset(Color,  VCOL_WHITE, COLS * ROWS);
    vic.color_back   = VCOL_BLUE;
    vic.color_border = VCOL_BLUE;

    // Current XSCROLL value, 0-7. The KERNAL sets $D016 = $08 (XSCROLL 0,
    // CSEL 1); 7 is our chosen start.
    byte xscroll = 7;

    for (;;) {
        // Wait for the top of the screen, then for line 256: exactly one
        // pass per frame. vic_waitBottom alone returns at once while the
        // beam is still in lines 256-311.
        vic_waitFrame();

        // One pixel left per frame; on the wrap, carry one column.
        bool carry = (xscroll == 0);
        xscroll = (xscroll - 1) & 7;

        // Write XSCROLL first, while the beam is below the display.
        // The read-modify-write keeps CSEL (bit 3) and MCM (bit 4).
        vic.ctrl2 = (byte)((vic.ctrl2 & 0xF8) | xscroll);

        // Then the coarse move. It starts at line 256 and runs into the
        // next frame's display, but top row first and faster than the beam.
        if (carry)
            shift_screen_left(next_char());
    }

    return 0;
}
```

## Build

```bash
oscar64 -O2 -o=soft-scroll-h.prg -tf=prg soft-scroll-h.c
```

`#pragma unroll(full)` on both loops of `shift_screen_left` makes Oscar64
emit straight-line code: 975 absolute loads and 1,000 absolute stores, no
index register and no loop, 5,927 bytes (read from the `.asm` output of
Oscar64 1.32.271). That is 975 × 8 + 25 × 4 = 7,900 cycles of moves, close
to the 7,938 measured. `-O2` is not what makes the move fast; the unroll
is.

Outputs: `soft-scroll-h.prg`, `.map`, `.asm`, `.lbl`.

## Expected output

All 25 rows carry the same stream of the message `SCROLL LEFT HARDWARE XSCROLL
D016 OSCAR64 * * *`, entering at the right edge and moving left, white
characters on a blue background inside a blue border. The text moves exactly
one pixel per frame, 50 px/s on PAL and about 60 px/s on NTSC, with no jump at the
carry and no tear.

Measured in VICE x64sc 3.10 (PAL c64c and NTSC 6567R8): 18 exit screenshots
taken one frame apart (19,656 cycles PAL, 17,095 NTSC), so the sequence
crosses two carries. In every one all 25 character rows are the same
picture, and row 0 is one pixel further left than in the shot before, 17
moves out of 17 on each model. The committed screenshots
(`screenshots/soft-scroll-h.png`, `screenshots/soft-scroll-h-ntsc.png`) are
the 8,000,000-cycle shot on each model.

A shot taken with the beam mid-screen shows rows below the beam one pixel to
the right of the rows above. That is VICE's capture holding the previous
frame below the beam, not the program: the boundary sits at the same row in
every frame, and the offset is 1 px, not the 8 px of a column.

An earlier version of this section described the old listing. That listing
was measured to tear: its screenshot had rows 19-24 one column (8 px) behind
the rows above, and the boundary moved from shot to shot. Before that, the
page promised smooth 1 px/frame motion with "no tearing, no visible jump",
while the program drew about seven rows of card-suit and box glyphs, because
the message was stored as PETSCII and the row offset was truncated to a
byte.

## Why this works

### The XSCROLL field: $D016 bits 2-0

The VIC-II's `$D016` register carries three independent bit groups:

| Bits | Name  | Effect |
|------|-------|--------|
| 2-0  | XSCROLL | Fine horizontal scroll, 0-7 pixels right |
| 3    | CSEL  | 0 = 38-column mode, 1 = 40-column mode (default) |
| 4    | MCM   | 0 = hires, 1 = multicolor character mode |

Only bits 2-0 are used here. The read-modify-write `(vic.ctrl2 & 0xF8) | xscroll`
clears the XSCROLL field and OR's in the new value, leaving CSEL and MCM
untouched. Clobbering CSEL would toggle between 38- and 40-column modes each
frame, moving the left and right borders in and out.

XSCROLL = 0 means no pixel shift relative to the character grid. XSCROLL = 7
shifts the display seven pixels to the right (the content appears shifted seven
pixels to the right within each character cell: every character column starts
seven pixels later). An earlier version said "seven pixels earlier"; a larger
XSCROLL delays the display, which is why it moves right (`mci-interlace.md`
shifts its second frame right by one pixel the same way). Scrolling left
means decrementing XSCROLL each frame.

### The carry: one column, top row first, from line 256

XSCROLL only covers 0-7. After 8 frames of decrementing, the value wraps from
0 back to 7. Without a change to screen RAM, the display would snap 8 pixels
to the right. Moving the screen RAM one column to the left in the same frame
cancels the snap, so the display moves in continuous 1-pixel steps.

The move cannot fit in the vertical blank; it has to race the beam. The
display-free span on PAL is lines 251-311 and 0-50, 112 lines or 7,056
cycles, of which 6,741 remain after `vic_waitFrame` returns at line 256. On
NTSC (65 cycles × 263 lines) 58 lines, 3,770 cycles, remain. The fastest 6510
move is an unrolled `LDA abs` / `STA abs` at 8 cycles a byte, so 975 bytes
cost at least 7,800 cycles (arithmetic from the 6510 cycle table), more than
the PAL blank. Nothing that moves the whole screen fits.

What does fit is order. Row r is first displayed at line 51 + 8r. The move
starts at line 256, goes top to bottom, and each row costs 312 cycles, about
5 raster lines, while the beam needs 8 lines to pass a character row. So the
move gains on the beam and every row is finished before the beam reaches it.
Measured in VICE (raster line read after each row, third carry):

| | Rows finished before line 51 | Last row (24) finished | Row 24 displayed from |
|---|---|---|---|
| PAL | 0-18 | line 82 | line 243 |
| NTSC | 0-10 | line 127 | line 243 |

The closest row on NTSC is row 11: finished at line 55, displayed from line
139. The KERNAL's 60 Hz IRQ stays on and was running during the measurement.

`$D016` is written before the move, right after `vic_waitFrame`, so the new
XSCROLL is in place before line 51 whether or not a carry follows.

Cost of the move, measured with CIA2 timers A and B chained, IRQs off, the
display blanked, harness overhead subtracted: 7,938 cycles. The carry frame
still ends on time: the next pass starts one frame later, measured as 16
consecutive passes at 19,656 cycles each (PAL, with ±80 cycles of polling
and IRQ jitter) and 17,094 (NTSC).

Colour RAM is not moved. Every cell is white and stays white, so a copy
would change nothing. A scroller with per-cell colour has to move colour RAM
too, which doubles the cost to about 15,900 cycles (arithmetic). Each row
then takes about 10 raster lines of copy against the beam's 8, so the beam
gains on the move; whether it catches up before row 24 was not measured
here.

An earlier version of this listing did it differently, and it was measured
to fail. It moved screen and colour RAM with `memmove` (a general 16-bit
routine, about 41 cycles a byte) and the column-39 fill in a second loop:
74,041 cycles with the display on (the earlier audit's measurement) and
68,962 with it blanked (measured here), 3.8 PAL frames. The beam overtook
the move, which is the tear. The earlier text also put the
shift at 12,000-15,000 cycles and the blank at 3,000-4,000 cycles, and said
the copy "occasionally runs slightly into the top border"; all three were
wrong. The earlier audit also measured a plain `for (char x ...)` byte loop
over a row pointer, screen and colour RAM, at 40,043 cycles, still two
frames: indirect-indexed addressing and a loop counter cost more than the
move itself.

### `vic_waitFrame` as the sync point

`vic_waitFrame()` from `vic.h` busy-polls the RST8 bit (bit 7 of `$D011`)
until it is clear, then until it is set: it returns once per frame, at line
256. The earlier listing called `vic_waitBottom()`, which only waits for RST8
to be set. It returns at once while the beam is still in lines 256-311, so
the loop ran eight passes in one blank (measured: passes at lines 267-275 of
the same frame), stepped XSCROLL from 7 to 0 unseen, and then did the carry.
The picture never showed the fine scroll: it jumped 8 px every four frames
(measured: 8 px moves in shots 2, 6 and 10 of a one-frame-apart sequence,
0 px in between).

`vic_waitFrame` is appropriate here because there is no other raster IRQ
machinery. In a program that already uses `rasterirq.h`, the scroll update
belongs in the main-loop body after `rirq_wait()`; the IRQ system provides
the frame sync.

### Oscar64 vs cc65 style

The cc65 antipattern is `POKE(0xD016, (PEEK(0xD016) & 0xF8) | xscroll)`. In
Oscar64 the struct field access `vic.ctrl2` compiles to the same `LDA $D016 /
AND #$F8 / ORA xscroll / STA $D016` sequence, but the access is type-checked:
`vic.ctrl2` is declared `volatile byte` in `vic.h`, preventing the compiler from
caching the register value across frames. The `& 0xF8` mask pattern is identical
in both toolchains; what Oscar64 provides is the named struct field, the
`VICColors` enum for colors, and the `vic_waitFrame` helper, so the source
carries no raw hex addresses.
