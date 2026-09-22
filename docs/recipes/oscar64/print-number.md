---
recipe: print-number
toolchain: oscar64
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: [DC04, DC05, DC0E, D011, D012]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Print Number: binary to decimal and hex in screen RAM

## Synopsis

Turns a 16-bit binary value into five screen codes, right-aligned with
leading zeros shown as spaces, and an 8-bit value into `$xx`, and writes
them straight into screen RAM with no KERNAL call. Two decimal routes are
given: subtract-powers (`fmt_dec_sub`, the one to use from C) and a plain
C double-dabble (`fmt_dec_dab`, for comparison). Both are run over all
65,536 values and the hex route over all 256, each field folded into a
16-bit checksum shown with `PASS` or `FAIL` against the value Python
computed. A CIA1 timer A harness then prints the cycle cost of each
route, so the screenshot proves the digits and the figures. Use it for a
HUD score, timer, coordinate readout or a debugging display. The
`techniques` list is empty: no technique page covers number formatting;
the design-level notes are in `game-design/game-design-patterns.md`
under "Printing numbers".

## Source

```c
// print-number.c
// Binary to decimal and hexadecimal for a text HUD, written straight into
// screen RAM as screen codes with no KERNAL call. Two 16-bit decimal
// routes (subtract-powers and double-dabble) are run over all 65,536
// values and the 8-bit hex route over all 256, each folded into a 16-bit
// checksum shown with PASS or FAIL against the value Python computed.
// A CIA1 timer A harness then prints the cycle cost of each route.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)      // default text screen

// Expected checksums, computed by the same fold in Python (page text).
#define EXPECT_DEC 0x0EB2            // fold over str(n).rjust(5), n = 0..65535
#define EXPECT_HEX 0x263C            // fold over the 4-char hex field, n = 0..255

// Screen codes: digits are $30-$39 as in PETSCII; 'A'-'F' are $01-$06.
static const char hex_glyph[16] = {
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06
};

// --- the routines under test ------------------------------------------------

// Subtract-powers. Writes five screen codes to dst: the value right-aligned,
// leading zeros as spaces, so 0 becomes "    0" and 65535 fills the field.
__noinline void fmt_dec_sub(unsigned v, char *dst)
{
    static const unsigned pow10[4] = { 10000, 1000, 100, 10 };
    char lead = 1;
    for (char i = 0; i < 4; i++)
    {
        unsigned p = pow10[i];
        char d = 0x30;
        while (v >= p) { v -= p; d++; }
        if (d != 0x30 || !lead) { dst[i] = d; lead = 0; }
        else dst[i] = 0x20;
    }
    dst[4] = 0x30 + v;               // v is 0..9 here
}

// Double-dabble in plain C. Shifts the 16 bits into three packed BCD bytes,
// adding 3 to any nibble that is 5 or more before each shift, then unpacks
// with the same zero suppression as fmt_dec_sub. Same output bytes.
__noinline void fmt_dec_dab(unsigned v, char *dst)
{
    char b0 = 0, b1 = 0, b2 = 0;     // b2 ten-thousands, b1 thousands|hundreds, b0 tens|units
    for (char i = 0; i < 16; i++)
    {
        if ((b0 & 0x0f) >= 0x05) b0 += 0x03;
        if ((b0 & 0xf0) >= 0x50) b0 += 0x30;
        if ((b1 & 0x0f) >= 0x05) b1 += 0x03;
        if ((b1 & 0xf0) >= 0x50) b1 += 0x30;
        if (b2 >= 0x05) b2 += 0x03;
        b2 = (b2 << 1) | (b1 >> 7);
        b1 = (b1 << 1) | (b0 >> 7);
        b0 = (b0 << 1) | (char)(v >> 15);
        v <<= 1;
    }
    char n[5];
    n[0] = b2 & 0x0f; n[1] = b1 >> 4; n[2] = b1 & 0x0f; n[3] = b0 >> 4; n[4] = b0 & 0x0f;
    char lead = 1;
    for (char i = 0; i < 4; i++)
    {
        if (n[i] != 0 || !lead) { dst[i] = 0x30 + n[i]; lead = 0; }
        else dst[i] = 0x20;
    }
    dst[4] = 0x30 + n[4];
}

// Hex byte for debugging: "$" and two digits, right-aligned in four cells.
__noinline void fmt_hex8(char v, char *dst)
{
    dst[0] = 0x20;
    dst[1] = 0x24;                   // '$'
    dst[2] = hex_glyph[v >> 4];
    dst[3] = hex_glyph[v & 0x0f];
}

__noinline void fmt_null(unsigned v, char *dst)
{
    // timing control: same call shape, empty body
}

// --- helpers ---------------------------------------------------------------

static void put_text(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        if (c >= 'A' && c <= 'Z') c -= 64;   // ASCII upper case to screen code
        else if (c == '[') c = 0x1b;          // brackets: screen codes $1B, $1D
        else if (c == ']') c = 0x1d;
        *p++ = c;
    }
}

static void put_hex16(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hex_glyph[(v >> 12) & 15]; p[1] = hex_glyph[(v >> 8) & 15];
    p[2] = hex_glyph[(v >> 4) & 15];  p[3] = hex_glyph[v & 15];
}

static unsigned fold(unsigned chk, char value)
{
    return (chk ^ value) * 5 + 1;
}

// --- timing harness: CIA1 timer A, force-loaded from $FFFF, phi2 ----------

static char tbuf[8];
static volatile unsigned tval = 65535;   // volatile: the call cannot be folded
static volatile unsigned tval2 = 59999;  // worst case for subtract-powers (5+9+9+9 steps)

static void t_start(void)
{
    cia1.cra = 0x00;                     // stop timer A
    cia1.ta = 0xffff;                    // latch $FFFF
    cia1.cra = 0x11;                     // force load, start, count phi2
}

static unsigned t_stop(void)
{
    cia1.cra = 0x00;                     // stop before reading, so the two
    return 0xffff - cia1.ta;             // byte reads cannot straddle a borrow
}

static unsigned time_sub(void)  { unsigned v = tval; t_start(); fmt_dec_sub(v, tbuf);       return t_stop(); }
static unsigned time_sub2(void) { unsigned v = tval2; t_start(); fmt_dec_sub(v, tbuf);      return t_stop(); }
static unsigned time_dab(void)  { unsigned v = tval; t_start(); fmt_dec_dab(v, tbuf);       return t_stop(); }
static unsigned time_hex(void)  { unsigned v = tval; t_start(); fmt_hex8((char)v, tbuf);    return t_stop(); }
static unsigned time_null(void) { unsigned v = tval; t_start(); fmt_null(v, tbuf);          return t_stop(); }

static void show_cycles(char row, const char *label, unsigned raw, unsigned base)
{
    put_text(row, 0, label);
    fmt_dec_sub(raw - base, SCREEN + 40 * row + 12);
}

int main(void)
{
    __asm { sei }                            // no KERNAL IRQ during the checks
    for (unsigned i = 0; i < 1000; i++) SCREEN[i] = 0x20;

    put_text(0, 0, "PRINT NUMBER");

    // The four demonstration fields, each shown inside brackets.
    put_text(2, 0, "DEC 0      [     ]");
    fmt_dec_sub(0, SCREEN + 2 * 40 + 12);
    put_text(3, 0, "DEC 7      [     ]");
    fmt_dec_sub(7, SCREEN + 3 * 40 + 12);
    put_text(4, 0, "DEC 65535  [     ]");
    fmt_dec_sub(65535, SCREEN + 4 * 40 + 12);
    put_text(5, 0, "HEX $A5    [    ]");
    fmt_hex8(0xa5, SCREEN + 5 * 40 + 12);

    // Cycle costs for the value 65535, body only: the empty call is subtracted.
    // Display off while timing so no badline stalls the CPU. The VIC-II
    // samples DEN once per frame, on line $30 (VIC-II documentation, not
    // measured here), so wait for the next frame to start before timing;
    // what was measured is that without this wait the NTSC run read 9% higher.
    vic.ctrl1 &= ~0x10;
    while (vic.raster != 0x80) ;
    while (vic.raster != 0x00) ;
    unsigned base = time_null();
    unsigned c_sub = time_sub();
    unsigned c_sub2 = time_sub2();
    unsigned c_dab = time_dab();
    unsigned c_hex = time_hex();
    vic.ctrl1 |= 0x10;

    put_text(11, 0, "CYCLES, BODY ONLY (CIA1 TIMER A)");
    show_cycles(12, "SUB16 65535", c_sub, base);
    show_cycles(13, "SUB16 59999", c_sub2, base);
    show_cycles(14, "DAB16 65535", c_dab, base);
    show_cycles(15, "HEX8  $FF  ", c_hex, base);
    show_cycles(16, "NULL CALL  ", base, 0);


    // Exhaustive checks: every value through both decimal routes, all 256
    // bytes through the hex route, each field folded into a checksum.
    unsigned chk_sub = 0, chk_dab = 0, chk_hex = 0;
    char buf[5];
    unsigned n = 0;
    do
    {
        fmt_dec_sub(n, buf);
        for (char i = 0; i < 5; i++) chk_sub = fold(chk_sub, buf[i]);
        fmt_dec_dab(n, buf);
        for (char i = 0; i < 5; i++) chk_dab = fold(chk_dab, buf[i]);
    } while (++n != 0);
    for (unsigned h = 0; h < 256; h++)
    {
        fmt_hex8((char)h, buf);
        for (char i = 0; i < 4; i++) chk_hex = fold(chk_hex, buf[i]);
    }

    put_text(7, 0, "SUB 0-65535 CHK      EXP      ");
    put_hex16(7, 16, chk_sub); put_hex16(7, 25, EXPECT_DEC);
    put_text(7, 30, chk_sub == EXPECT_DEC ? "PASS" : "FAIL");
    put_text(8, 0, "DAB 0-65535 CHK      EXP      ");
    put_hex16(8, 16, chk_dab); put_hex16(8, 25, EXPECT_DEC);
    put_text(8, 30, chk_dab == EXPECT_DEC ? "PASS" : "FAIL");
    put_text(9, 0, "HEX 0-255   CHK      EXP      ");
    put_hex16(9, 16, chk_hex); put_hex16(9, 25, EXPECT_HEX);
    put_text(9, 30, chk_hex == EXPECT_HEX ? "PASS" : "FAIL");

    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=print-number.prg print-number.c
```

Then run headless (PAL; add `-model ntsc` for NTSC):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 120 x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 400000000 -exitscreenshot print-number.png -autostart print-number.prg
```

The cycle limit is 400,000,000 because the exhaustive loop runs both
decimal routes 65,536 times, about 4,000 cycles a pass with the checksum
folds (rung 3, from the measured routine costs); at 300,000,000 a first
version, which blanked the display for the whole check, exited with the
screen still blank.

## Expected output

`screenshots/print-number.png` (PAL) and `screenshots/print-number-ntsc.png`
(NTSC), both read cell by cell against the character ROM. Light blue
text on the default blue screen:

```
PRINT NUMBER

DEC 0      [    0]
DEC 7      [    7]
DEC 65535  [65535]
HEX $A5    [ $A5]

SUB 0-65535 CHK 0EB2 EXP 0EB2 PASS
DAB 0-65535 CHK 0EB2 EXP 0EB2 PASS
HEX 0-255   CHK 263C EXP 263C PASS

CYCLES, BODY ONLY (CIA1 TIMER A)
SUB16 65535   957
SUB16 59999  1361
DAB16 65535  2537
HEX8  $FF      74
NULL CALL      17
```

The three checksums are the fold `chk = ((chk ^ byte) * 5 + 1) & 0xFFFF`
over every byte of every field, in order. In Python:

```python
def fold(chk, v): return ((chk ^ v) * 5 + 1) & 0xffff
chk = 0
for n in range(65536):
    for b in str(n).rjust(5).encode('ascii'):
        chk = fold(chk, b)
print(hex(chk))            # 0xeb2
hexg = [0x30 + i for i in range(10)] + [1, 2, 3, 4, 5, 6]
chk = 0
for n in range(256):
    for b in [0x20, 0x24, hexg[n >> 4], hexg[n & 15]]:
        chk = fold(chk, b)
print(hex(chk))            # 0x263c
```

The decimal fold works on the ASCII bytes of `str(n).rjust(5)` because
screen codes for `0`-`9` and space are `$30`-`$39` and `$20`, the same
as ASCII. The hex fold has to spell the screen codes out, because `A`-`F`
are `$01`-`$06` on screen and not their ASCII values. Both decimal routes
reach the same checksum, which is the point of running two: they agree on
all 327,680 output bytes.

The cycle figures are the value of CIA1 timer A after each call, less
the 17 cycles of the same sequence around an empty function, so they are
the body of the routine without its `JSR` and `RTS`. The PAL and NTSC
runs give identical figures (rung 1, VICE x64sc 3.10). 59999 is the
worst case for subtract-powers (digit sum 5 + 9 + 9 + 9, thirty-two
subtractions); the double-dabble's cost does not depend on the value.
A build with different code placement read 953 and 2,533 for the first
and third lines, so treat the last few cycles as layout, not routine.

## Why this works

`fmt_dec_sub` walks the powers 10000, 1000, 100, 10 and counts how many
times each can be taken from the value; the count plus `$30` is the
digit's screen code, and what is left after the last power is the units
digit. `lead` stays set until the first non-zero digit, and while it is
set a zero writes `$20` instead of `$30`, which gives zero suppression and
right alignment in one move because the field width is fixed. The last
digit is written unconditionally so that 0 prints as `0`. For an
arcade-style score with leading zeros, drop the `lead` test.

`fmt_dec_dab` is the textbook double-dabble: shift the bits in from the
top, and before each shift add 3 to any BCD nibble that is 5 or more so
that the shift carries a 10 out of it. On the 6502 the same algorithm is
much cheaper in assembly with `SED`, where `adc` of a byte to itself
doubles a packed BCD pair and adjusts it for free; C cannot set decimal
mode, so the nibble version pays for every test and lands at 2.6 times
the cost of subtract-powers. Use `fmt_dec_sub` from C, and if a fixed
cost matters more than the average, call an assembly double-dabble
through `__asm` (the KickAssembler `dab_u16` listing under "Printing
numbers" in `game-design/game-design-patterns.md` measured 875 cycles for
any value).

The timing harness stops timer A, writes `$FFFF` to the latch, and
restarts it with a force load (`cra = $11`), so the count starts from a
known value; it stops the timer again before reading the two bytes so
the read cannot straddle a borrow from low to high. The display is
blanked during the timing, and the program then waits for the next frame
before starting, because the VIC-II samples the DEN bit once per frame,
on line `$30` (VIC-II documentation, not measured here; what was measured
is that the wait closes the 9 per cent NTSC gap): a first version that
blanked and timed at once read 9 per cent higher on NTSC, where the run
happened to start mid-frame and the badlines of that frame were still
stealing cycles. With the wait, PAL and NTSC agree to the cycle.

Everything is written as screen codes at `$0400` with no KERNAL call:
`put_text` folds ASCII upper case to screen codes by subtracting 64 and
maps `[` and `]` to `$1B` and `$1D`; digits and `$` need no translation.
The KERNAL IRQ is switched off with `sei` so the jiffy handler does not
run inside the timed region or reprogram the timer (the KERNAL uses CIA1
timer A for its 60 Hz tick).
