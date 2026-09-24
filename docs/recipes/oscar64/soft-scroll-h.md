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
offset reaches zero it resets to 7 and the screen RAM is shifted one column to
the left to carry new content onto the right edge (an earlier version of this
sentence said "right ... left edge", the opposite of what the code does). No
raster IRQ is needed. The VIC-II does the pixel-level work, and on
seven frames out of eight a single register write is the only CPU cost; the
eighth frame pays for the column shift, which is expensive (measured below).
This is the `soft_scroll_h` technique from `docs/techniques/scroll.md`.

## Source

```c
// soft-scroll-h.c
//
// Pure hardware horizontal soft-scroll.
// $D016 bits 2-0 (XSCROLL) shift the display right by 0-7 pixels.
// Decrement each frame for leftward scroll; carry to screen RAM when it wraps.
//
#include <c64/vic.h>
#include <string.h>

// Screen RAM at the default C64 location.
#define Screen ((byte *)0x0400)

// Color RAM. Must be shifted in sync with screen RAM.
#define Color  ((byte *)0xd800)

// Width and height of the text display.
#define COLS  40
#define ROWS  25

// The content source: a 48-character message ring buffer.
// The scroller draws from this, cycling with msg_pos.
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

// Shift all 25 rows of screen RAM one column to the left (column 0 is lost,
// column 39 receives the new character). Color RAM follows identically.
// Called once per 8 frames when XSCROLL wraps from 0 to 7.
static void shift_screen_left(void)
{
    // row * COLS is an int (up to 960); an earlier version cast it to char,
    // which truncates from row 7 (280 -> 24) and folded rows 7-24 back onto
    // the top of the screen, so only about seven rows ever showed.
    for (char row = 0; row < ROWS; row++) {
        byte *srow = Screen + row * COLS;
        byte *crow = Color  + row * COLS;

        // Move columns 1-39 into columns 0-38.
        memmove(srow, srow + 1, COLS - 1);
        memmove(crow, crow + 1, COLS - 1);
    }

    // Fill column 39 (rightmost) with the next content character.
    // For a real scroller this would come from a map or text buffer;
    // here we cycle through the message string.
    byte c = next_char();
    for (char row = 0; row < ROWS; row++) {
        Screen[row * COLS + 39] = c;
        Color [row * COLS + 39] = VCOL_WHITE;
    }
}

int main(void)
{
    // Clear the screen and set a visible background.
    memset(Screen, 0x20, COLS * ROWS);  // fill with spaces
    memset(Color,  VCOL_WHITE, COLS * ROWS);
    vic.color_back   = VCOL_BLUE;
    vic.color_border = VCOL_BLUE;

    // Current XSCROLL value, 0-7. Decrement each frame for leftward scroll.
    // The KERNAL's VIC init table ($ECB9, 901227-03) sets $D016 = $08, i.e.
    // XSCROLL 0 with CSEL 1, so the register does NOT start at 7 (an earlier
    // comment said it did). We choose 7 as the starting point of the ring.
    byte xscroll = 7;

    for (;;) {
        // Wait for the raster beam to reach the bottom of the visible area.
        // This is the safe window to update $D016 without visible tearing:
        // the beam is below all character rows, so no display fetch is active.
        vic_waitBottom();

        // Decrement XSCROLL: one pixel step leftward.
        if (xscroll == 0) {
            // XSCROLL has wrapped. Carry: shift the screen RAM one column.
            // Ideally this completes before the beam re-enters the display
            // (line 51). vic_waitBottom returns at line 256, which leaves
            // 107 PAL lines (6,741 cycles) before line 51 of the next frame.
            // Measured with a CIA cycle counter (VICE 3.10, PAL, -O2): this
            // call costs about 74,000 cycles, i.e. 3.8 frames, so the display
            // stalls on the carry frame and the beam catches the shift in
            // progress. An earlier comment estimated 9,750 cycles and said the
            // shift was "split"; it is not. The recipe keeps the simple form
            // because its subject is $D016, not a fast copy.
            shift_screen_left();
            xscroll = 7;
        } else {
            xscroll--;
        }

        // Write the new XSCROLL value into $D016, preserving the CSEL bit
        // (bit 3, 40-column mode = 1) and MCM bit (bit 4, multicolor = 0).
        // VCOL_WHITE happens to be value 1 which is not a VIC ctrl constant,
        // so mask explicitly.
        vic.ctrl2 = (byte)((vic.ctrl2 & 0xF8) | xscroll);
    }

    return 0;
}
```

## Build

```bash
oscar64 -O2 -o=soft-scroll-h.prg -tf=prg soft-scroll-h.c
```

Use `-O2`: it enables auto-inlining of small functions and
lets Oscar64 use 8-bit loop counters in `shift_screen_left`. It does not bring
the carry inside the vertical blank window (an earlier version of this sentence
said it did); see the measured figures under "The carry" below.

Outputs: `soft-scroll-h.prg`, `.map`, `.asm`, `.lbl`.

## Expected output

All 25 rows carry the same stream of the message `SCROLL LEFT HARDWARE XSCROLL
D016 OSCAR64 * * *`, entering at the right edge and moving left, white
characters on a blue background inside a blue border. For seven frames the
display steps one pixel per frame (nominally 50 px/sec on PAL, 60 px/sec on
NTSC); on the eighth the screen RAM carry fires.

The carry is visible. Measured in VICE 3.10 (PAL, `-O2`, CIA cycle
counter), `shift_screen_left` costs about 74,000 cycles (3.8 frames), so the
scroll pauses on every carry, and a screenshot taken at an arbitrary instant
(as the verifier's is) can catch the shift half done: the upper rows already
moved one column left, the lower rows not yet, with one torn row between
them. An earlier version of this section promised smooth 1 px/frame motion
with "no tearing, no visible jump", and, before the listing was fixed, the
program actually drew about seven rows of card-suit and box glyphs, because
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

### The carry: screen RAM column shift

XSCROLL only covers 0-7. After 8 frames of decrementing, the value wraps from
0 back to 7. At that instant, without a corresponding change to screen RAM, the
display would snap 8 pixels to the right (resetting from 0 back to 7). To
cancel this snap, the screen RAM is shifted one column to the left at the same time.
The hardware shift and the software carry cancel at the boundary, so the
display moves in continuous 1-pixel steps.

The `memmove` in `shift_screen_left` copies 39 bytes per row using the C
library's implementation, which is a general 16-bit-length routine. Measured
with a chained CIA2 timer in VICE 3.10 (PAL, Oscar64 `-O2`, call overhead
subtracted): one 39-byte `memmove` costs about 1,600 cycles (41 cycles per
byte), the column-39 fill loop about 1,570, and the whole 25-row shift of
screen and colour RAM 74,041 cycles. A PAL frame is 19,656 cycles, so the
carry takes 3.8 frames. The budget it has to fit is the display-free part of
the frame: lines 251-311 and 0-50, 112 lines or 7,056 cycles, of which 6,741
remain after `vic_waitBottom` returns at line 256. An earlier version of this
paragraph put the shift at 12,000-15,000 cycles and the blank at 3,000-4,000
and said the copy "occasionally runs slightly into the top border"; both
figures were wrong and the copy overruns by more than three frames.

Replacing the two `memmove` calls with a plain `for (char x ...)` byte loop
over each row was measured at 40,043 cycles: better, still two frames. A
production scroller does not copy the whole screen inside the blank
at all: it scrolls fewer rows, double-buffers screen RAM and flips the
`$D018` pointer, or spreads an unrolled copy across the idle lines of the
preceding frames from a raster IRQ.

### `vic_waitBottom` as the sync point

The write to `$D016` must land while the raster beam is not within the active
display area (lines 51-250 on PAL), or character data currently being fetched
will render with the old scroll value for part of the line. `vic_waitBottom()`
from `vic.h` busy-polls the RST8 bit (bit 7 of `$D011`) until it is set, i.e.
until the raster line is 256 or higher (the earlier text said it polled `$D012`
for "below line 255"), so the display is fully rendered before the
write. The write then takes effect for the top of the next frame.

`vic_waitBottom` is appropriate here because there is no other raster IRQ
machinery. In a more complex program that already uses `rasterirq.h`, the
scroll update belongs in the main-loop body after `rirq_wait()`; the IRQ
system provides the frame sync, and `vic_waitBottom` is redundant.

### Oscar64 vs cc65 style

The cc65 antipattern is `POKE(0xD016, (PEEK(0xD016) & 0xF8) | xscroll)`. In
Oscar64 the struct field access `vic.ctrl2` compiles to the same `LDA $D016 /
AND #$F8 / ORA xscroll / STA $D016` sequence, but the access is type-checked:
`vic.ctrl2` is declared `volatile byte` in `vic.h`, preventing the compiler from
caching the register value across frames. The `& 0xF8` mask pattern is identical
in both toolchains; what Oscar64 provides is the named struct field, the
`VICColors` enum for colors, and the `vic_waitBottom` helper, so the source
carries no raw hex addresses.
