---
recipe: divide-check
toolchain: oscar64
output_format: PRG
region: both
techniques: [division_8_16bit, decimal_print]
file_formats: [PRG]
uses_registers: [DC04, DC05, DC0E, D011, D012]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Divide Check: shift-and-subtract division, checked and timed

## Synopsis

Three shift-and-subtract divide loops in `__asm`, 8/8, 16/8 and 16/16,
each giving quotient and remainder, plus two loop-free ways to divide a
byte by ten (a shift-add reciprocal and a 256-byte table). Every routine
is checked two ways in the same run: against Oscar64's own `/` and `%`
(a miss count) and against a 16-bit checksum Python computed. The 8/8
loop runs over every dividend and every non-zero divisor, the 16/8 loop
over every 16-bit dividend, the 16/16 loop over a sweep of 21,845 pairs.
A CIA1 timer A harness then prints the cycle cost of each route, and of
a five-digit decimal print done by repeated divide-by-ten beside the
subtract-powers print from `print-number.md`, so the screenshot settles
which to use. It implements `division_8_16bit` (`techniques/maths.md`)
and the comparison `decimal_print` (`techniques/text.md`) points at.

## Source

```c
// divide-check.c
// Shift-and-subtract division on the 6510: 8/8, 16/8 and 16/16, each an
// __asm loop, run over every 8-bit pair and a sweep of 16-bit values and
// checked two ways: against Oscar64's own / and % (a miss count) and
// against a 16-bit checksum Python computed. Divide by ten is then done
// four ways (general 16/8 divide, shift-add reciprocal, table lookup, and
// the subtract-powers digit route) and CIA1 timer A prints the cycle
// cost of every route.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)

// Expected checksums, computed by the same fold in Python (page text).
#define EXPECT_D8   0x7122           // 8/8: n = 0..255 outer, d = 1..255 inner, fold q then r
#define EXPECT_D16  0xBBC4           // 16/8: n = 0..65535, d = (n >> 8) + n, 0 -> 7, fold q lo, q hi, r
#define EXPECT_D32  0x6DA5           // 16/16: n = 0..65532 step 3, d = n * $9E37 + $1234, 0 -> 1, fold q lo, q hi, r lo, r hi
#define EXPECT_T10  0xAD4C           // by ten: n = 0..255, shift-add then table, fold q, r each
#define EXPECT_DEC  0x3D19           // five digits by divide: n = 0..65530 step 5, fold the five codes

// Operands and results, absolute memory so the asm reads them by name.
// volatile: the asm writes them, and without it Oscar64 -O2 kept the
// dividend it had just stored and compared that against itself.
volatile char dvs8, rem8;            // 8-bit divisor and remainder
volatile unsigned dvd;               // dividend in, quotient out (8/8 uses the low byte)
volatile unsigned dvs16, rem16;      // 16-bit divisor and remainder
volatile char q10, r10;              // divide-by-ten results

// --- the routines under test ------------------------------------------------

// 8-bit dividend / 8-bit divisor. Quotient replaces the dividend in dvd,
// remainder in rem8. Eight passes; the partial remainder never exceeds
// 9 bits, and the carry out of rol rem8 is that ninth bit.
__noinline void div8(void)
{
    __asm volatile
    {
        lda #0
        sta rem8
        ldx #8
    l8: asl dvd
        rol rem8
        lda rem8
        bcs s8
        cmp dvs8
        bcc n8
    s8: sbc dvs8
        sta rem8
        inc dvd
    n8: dex
        bne l8
    }
}

// 16-bit dividend / 8-bit divisor. Quotient in dvd, remainder in rem8.
// Sixteen passes of the same body with a 16-bit shift.
__noinline void div16_8(void)
{
    __asm volatile
    {
        lda #0
        sta rem8
        ldx #16
    l16: asl dvd
        rol dvd + 1
        rol rem8
        lda rem8
        bcs s16
        cmp dvs8
        bcc n16
    s16: sbc dvs8
        sta rem8
        inc dvd
    n16: dex
        bne l16
    }
}

// 16-bit dividend / 16-bit divisor. Quotient in dvd, remainder in rem16.
// The partial remainder reaches 17 bits when the divisor is $8000 or
// more; the bcs after the second rol catches that bit.
__noinline void div16_16(void)
{
    __asm volatile
    {
        lda #0
        sta rem16
        sta rem16 + 1
        ldx #16
    l32: asl dvd
        rol dvd + 1
        rol rem16
        rol rem16 + 1
        bcs s32
        lda rem16 + 1
        cmp dvs16 + 1
        bcc n32
        bne s32
        lda rem16
        cmp dvs16
        bcc n32
    s32: lda rem16
        sbc dvs16
        sta rem16
        lda rem16 + 1
        sbc dvs16 + 1
        sta rem16 + 1
        inc dvd
    n32: dex
        bne l32
    }
}

// 8-bit divide by ten with no loop: q = n * 0.1 approximated by shifts
// (1/2 + 1/4 = 0.75, then times 1 + 1/16 = 0.797, then /8 = 0.0996),
// remainder by subtracting q * 10, one fix-up when it lands at 10 or 11.
// Reads the low byte of dvd; results in q10 and r10.
__noinline void div10_8(void)
{
    __asm volatile
    {
        lda dvd
        lsr
        sta q10          // n/2
        lsr
        clc
        adc q10          // n/2 + n/4
        sta q10
        lsr
        lsr
        lsr
        lsr
        clc
        adc q10          // q + q/16
        lsr
        lsr
        lsr              // /8
        sta q10
        asl
        asl
        adc q10          // q * 5 (carry clear after the shifts, q < 32)
        asl              // q * 10
        sta r10
        lda dvd
        sec
        sbc r10          // r = n - q * 10, 0..11
        cmp #10
        bcc d10
        sbc #10
        inc q10
    d10: sta r10
    }
}

// 8-bit divide by ten by lookup: two 256-byte tables, built at start.
char tq10[256], tr10[256];
__noinline void div10_tab(void)
{
    __asm volatile
    {
        ldx dvd
        lda tq10, x
        sta q10
        lda tr10, x
        sta r10
    }
}

// 16-bit to five screen codes by repeated divide by ten (div16_8 with
// divisor 10), units digit first.
__noinline void fmt_dec_div(unsigned v, char *dst)
{
    dvd = v; dvs8 = 10;
    for (char i = 4; i > 0; i--)
    {
        div16_8();
        dst[i] = 0x30 + rem8;
    }
    dst[0] = 0x30 + (char)dvd;
    char lead = 1;
    for (char i = 0; i < 4; i++)
        if (dst[i] == 0x30 && lead) dst[i] = 0x20; else lead = 0;
}

// The subtract-powers route from print-number.md, for comparison.
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
    dst[4] = 0x30 + v;
}

__noinline void null_call(void)
{
    // timing control: same call shape, empty body
}

// --- helpers ---------------------------------------------------------------

static const char hex_glyph[16] = {
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06
};

static void put_text(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        if (c >= 'A' && c <= 'Z') c -= 64;
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

static void put_check(char row, const char *label, unsigned chk, unsigned exp, unsigned miss)
{
    put_text(row, 0, label);
    put_text(row, 12, "CHK");
    put_hex16(row, 16, chk);
    put_text(row, 21, "EXP");
    put_hex16(row, 25, exp);
    put_text(row, 30, chk == exp && miss == 0 ? "PASS" : "FAIL");
    fmt_dec_sub(miss, SCREEN + 40 * row + 35);
}

// --- timing harness: CIA1 timer A, force-loaded from $FFFF, phi2 ----------

static char tbuf[8];
static volatile unsigned tval = 65535;
static volatile char tval8 = 255;

static void t_start(void)
{
    cia1.cra = 0x00;
    cia1.ta = 0xffff;
    cia1.cra = 0x11;
}

static unsigned t_stop(void)
{
    cia1.cra = 0x00;
    return 0xffff - cia1.ta;
}

static void show_cycles(char row, const char *label, unsigned raw, unsigned base)
{
    put_text(row, 0, label);
    fmt_dec_sub(raw - base, SCREEN + 40 * row + 20);
}

int main(void)
{
    __asm { sei }
    for (unsigned i = 0; i < 1000; i++) SCREEN[i] = 0x20;
    put_text(0, 0, "DIVIDE CHECK");

    // Build the divide-by-ten tables by counting, no divide needed.
    {
        char q = 0, r = 0;
        for (unsigned i = 0; i < 256; i++)
        {
            tq10[i] = q; tr10[i] = r;
            if (++r == 10) { r = 0; q++; }
        }
    }

    // Cycle costs, body only, display off, from the start of a frame.
    vic.ctrl1 &= ~0x10;
    while (vic.raster != 0x80) ;
    while (vic.raster != 0x00) ;
    unsigned base, c;
    t_start(); null_call(); base = t_stop();

    dvd = tval8; dvs8 = 1;   t_start(); div8(); c = t_stop();
    show_cycles(11, "DIV8   255/1", c, base);
    dvd = tval8; dvs8 = 255; t_start(); div8(); unsigned c2 = t_stop();
    show_cycles(12, "DIV8   255/255", c2, base);
    dvd = tval; dvs8 = 1;    t_start(); div16_8(); c = t_stop();
    show_cycles(13, "DIV16/8  65535/1", c, base);
    dvd = tval; dvs8 = 10;   t_start(); div16_8(); c2 = t_stop();
    show_cycles(14, "DIV16/8  65535/10", c2, base);
    dvd = tval; dvs16 = 1;   t_start(); div16_16(); c = t_stop();
    show_cycles(15, "DIV16/16 65535/1", c, base);
    dvd = tval; dvs16 = 0x8000; t_start(); div16_16(); c2 = t_stop();
    show_cycles(16, "DIV16/16 65535/$8000", c2, base);
    dvd = tval8;             t_start(); div10_8(); c = t_stop();
    show_cycles(17, "DIV10 SHIFT-ADD 255", c, base);
    dvd = tval8;             t_start(); div10_tab(); c2 = t_stop();
    show_cycles(18, "DIV10 TABLE 255", c2, base);
    unsigned v = tval;       t_start(); fmt_dec_div(v, tbuf); c = t_stop();
    show_cycles(19, "DEC5 BY DIV10 65535", c, base);
    v = tval;                t_start(); fmt_dec_sub(v, tbuf); c2 = t_stop();
    show_cycles(20, "DEC5 BY SUB 65535", c2, base);
    v = 59999;               t_start(); fmt_dec_sub(v, tbuf); c2 = t_stop();
    show_cycles(21, "DEC5 BY SUB 59999", c2, base);
    show_cycles(22, "NULL CALL", base, 0);
    vic.ctrl1 |= 0x10;
    put_text(10, 0, "CYCLES, BODY ONLY (CIA1 TIMER A)");

    // Exhaustive and swept checks against Oscar64's own / and %.
    unsigned chk, miss;

    chk = 0; miss = 0;
    for (unsigned n = 0; n < 256; n++)
        for (unsigned d = 1; d < 256; d++)
        {
            dvd = n; dvs8 = d; div8();
            if (dvd != n / d || rem8 != n % d) miss++;
            chk = fold(chk, (char)dvd); chk = fold(chk, rem8);
        }
    put_check(2, "8/8 ALL", chk, EXPECT_D8, miss);

    chk = 0; miss = 0;
    unsigned n = 0;
    do
    {
        char d = (char)((n >> 8) + n);
        if (d == 0) d = 7;
        dvd = n; dvs8 = d; div16_8();
        if (dvd != n / d || rem8 != n % d) miss++;
        chk = fold(chk, (char)dvd); chk = fold(chk, (char)(dvd >> 8)); chk = fold(chk, rem8);
    } while (++n != 0);
    put_check(3, "16/8 ALL", chk, EXPECT_D16, miss);

    chk = 0; miss = 0;
    for (n = 0; n < 65533; n += 3)
    {
        unsigned d = n * 0x9e37 + 0x1234;
        if (d == 0) d = 1;
        dvd = n; dvs16 = d; div16_16();
        if (dvd != n / d || rem16 != n % d) miss++;
        chk = fold(chk, (char)dvd); chk = fold(chk, (char)(dvd >> 8));
        chk = fold(chk, (char)rem16); chk = fold(chk, (char)(rem16 >> 8));
    }
    put_check(4, "16/16 SWEEP", chk, EXPECT_D32, miss);

    chk = 0; miss = 0;
    for (n = 0; n < 256; n++)
    {
        dvd = n; div10_8();
        if (q10 != n / 10 || r10 != n % 10) miss++;
        chk = fold(chk, q10); chk = fold(chk, r10);
        dvd = n; div10_tab();
        if (q10 != n / 10 || r10 != n % 10) miss++;
        chk = fold(chk, q10); chk = fold(chk, r10);
    }
    put_check(5, "BY 10 ALL", chk, EXPECT_T10, miss);

    chk = 0; miss = 0;
    for (n = 0; n < 65535; n += 5)
    {
        char a[5], b[5];
        fmt_dec_div(n, a); fmt_dec_sub(n, b);
        for (char i = 0; i < 5; i++) { if (a[i] != b[i]) miss++; chk = fold(chk, a[i]); }
    }
    put_check(6, "DEC5 SWEEP", chk, EXPECT_DEC, miss);

    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=divide-check.prg divide-check.c
```

Then run headless (PAL; add `-model ntsc` for NTSC):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 180 x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 600000000 -exitscreenshot divide-check.png -autostart divide-check.prg
```

The cycle limit is 600,000,000 because the checks call Oscar64's own
16-bit divide and modulo twice for every one of the 152,000 or so test
divides, which costs more than the routines under test; at 300,000,000
the last row (`DEC5 SWEEP`) had not been written yet. About 30 s in
warp on this machine.

## Expected output

`screenshots/divide-check.png` (PAL) and `screenshots/divide-check-ntsc.png`
(NTSC), both read cell by cell against the character ROM. Light blue
text on the default blue screen:

```
DIVIDE CHECK

8/8 ALL     CHK 7122 EXP 7122 PASS     0
16/8 ALL    CHK BBC4 EXP BBC4 PASS     0
16/16 SWEEP CHK 6DA5 EXP 6DA5 PASS     0
BY 10 ALL   CHK AD4C EXP AD4C PASS     0
DEC5 SWEEP  CHK 3D19 EXP 3D19 PASS     0



CYCLES, BODY ONLY (CIA1 TIMER A)
DIV8   255/1          351
DIV8   255/255        260
DIV16/8  65535/1      791
DIV16/8  65535/10     674
DIV16/16 65535/1     1339
DIV16/16 65535/$8000  715
DIV10 SHIFT-ADD 255    79
DIV10 TABLE 255        20
DEC5 BY DIV10 65535  2793
DEC5 BY SUB 65535     936
DEC5 BY SUB 59999    1340
NULL CALL              17
```

The last column of each check row is the miss count against Oscar64's
`/` and `%`; `PASS` needs the checksum to match and the count to be
zero. The checksums are the fold `chk = ((chk ^ byte) * 5 + 1) & 0xFFFF`
over the bytes named in the `EXPECT_` comments, in that order. In
Python:

```python
def fold(chk, v): return ((chk ^ v) * 5 + 1) & 0xffff
chk = 0
for n in range(256):
    for d in range(1, 256):
        chk = fold(chk, n // d); chk = fold(chk, n % d)
print(hex(chk))                              # 0x7122
chk = 0
for n in range(65536):
    d = ((n >> 8) + n) & 0xff or 7
    q, r = n // d, n % d
    chk = fold(chk, q & 0xff); chk = fold(chk, q >> 8); chk = fold(chk, r)
print(hex(chk))                              # 0xbbc4
chk = 0
for n in range(0, 65533, 3):
    d = (n * 0x9e37 + 0x1234) & 0xffff or 1
    q, r = n // d, n % d
    chk = fold(chk, q & 0xff); chk = fold(chk, q >> 8)
    chk = fold(chk, r & 0xff); chk = fold(chk, r >> 8)
print(hex(chk))                              # 0x6da5
chk = 0
for n in range(256):
    for _ in range(2):
        chk = fold(chk, n // 10); chk = fold(chk, n % 10)
print(hex(chk))                              # 0xad4c
chk = 0
for n in range(0, 65535, 5):
    for b in str(n).rjust(5).encode('ascii'):
        chk = fold(chk, b)
print(hex(chk))                              # 0x3d19
```

The cycle figures are the value of CIA1 timer A after each call, less
the 17 cycles of the same sequence around an empty function, so they
are the body of the routine without its `JSR` and `RTS`. PAL and NTSC
give identical figures, and two runs of each model gave the same PNG
byte for byte (rung 1, VICE x64sc 3.10). The operands live in absolute
memory; the figures for a zero-page copy are worked out, not measured,
on the technique page.

The two operand pairs per loop are the two ends of its range. 255/1
subtracts on every pass and is the worst case for the 8/8 loop; 255/255
subtracts once. 65535/1 is the worst case for both 16-bit loops.
65535/$8000 is the divisor that needs the 17th remainder bit, and it is
in the sweep too: `n * $9E37 + $1234` lands above `$8000` for about
half the values.

## Why this works

Each loop is long division in binary. The dividend is shifted left one
bit at a time into a remainder register; after each shift, if the
remainder is at least the divisor, the divisor is subtracted and a 1 is
set in the bit of the dividend that was just vacated. After as many
passes as the dividend has bits, the dividend byte(s) hold the quotient
and the remainder register holds the remainder. Both come out of one
loop, which is what makes the same routine serve `/` and `%`.

The partial remainder can be one bit wider than the divisor: before the
subtract it is up to twice the divisor less one. `rol rem8` shifts that
extra bit into the carry, and `bcs` jumps straight to the subtract
without a compare, because a remainder with its ninth bit set is always
at least any 8-bit divisor. The carry is also already set, which is what
`sbc` needs. On the other path `cmp` leaves the carry set exactly when
the subtract should happen, so the two paths meet at `sbc` with the
carry right either way. The 16/16 loop does the same with a 17th bit and
a two-byte compare that stops early when the high bytes differ. A
routine that drops the `bcs` is wrong for every divisor of `$8000` or
more; the `65535/$8000` row and the sweep are there to catch that.

`div10_8` replaces the loop with an approximation of `n / 10` built
from shifts: `n/2 + n/4` is `0.75n`, adding a sixteenth of that gives
`0.797n`, and dividing by 8 gives `0.0996n`, always equal to or one
below the true quotient for `n` up to 255. The remainder `n - 10q` is
then 0 to 11 and one compare fixes it (Python over all 256 values
agrees, and the run checks it). The table route is two indexed loads.
The reciprocal multiply form, `(n * 205) >> 11`, is exact for the same
range and is on the technique page; it is not in this listing because
it needs a multiply.

The five-digit print by repeated division is three times the cost of
the subtract-powers print, 2,793 cycles against 936, and it is the
answer to the question of whether a HUD should divide by ten: it should
not, on this CPU, unless the digits are needed in the other order. The
divide route's advantage is the units digit first, which suits a
right-to-left field or a number of unknown width.

The globals the `__asm` blocks read and write are declared `volatile`.
Without it Oscar64 at `-O2` treated `div8()` as a call that does not
touch `dvd`, kept the dividend it had just stored in a zero-page
temporary, and compared that against `n / d`: the first build of this
page reported 64,770 misses for 8/8 with a listing for `div8` that was
correct to the byte. `__asm volatile` keeps the block in place; it does
not tell the compiler what the block writes.

The timing harness and screen writes are the ones in `print-number.md`:
timer A force-loaded from `$FFFF` and stopped before it is read, the
display blanked and the run started at the top of a frame so no badline
is inside the count, everything written as screen codes at `$0400`
under `sei`.
