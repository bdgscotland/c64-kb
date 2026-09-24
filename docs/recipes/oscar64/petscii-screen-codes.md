---
recipe: petscii-screen-codes
toolchain: oscar64
output_format: PRG
region: both
techniques: [petscii_screen_code_conversion]
file_formats: [PRG]
uses_registers: [DC04, DC05, DC0E, D011, D012, D018]
uses_kernal: [CHROUT, PLOT]
---

<!-- doc-type: recipe -->

# Oscar64 PETSCII and Screen Codes: the conversion both ways, measured against CHROUT

## Synopsis

Converts PETSCII to screen codes and back with range arithmetic and no
table, and proves the rule against the KERNAL itself: every PETSCII code
`$20` to `$FF` is sent through CHROUT at row 0, column 0 and the screen
RAM byte is read back, then `pet2scr()` is compared with that byte,
`scr2pet()` is checked as its inverse over every screen code, both are
folded into a checksum shown with `PASS` or `FAIL` against the value
Python computed, and a CIA1 timer A harness prints the cycle cost of one
call. Rows 2 to 4 show the same eighteen bytes written by CHROUT, by
`pet2scr()` into screen RAM, and poked raw, which is the wrong-glyph
symptom of `petscii_written_to_screen_ram`. It implements
`petscii_screen_code_conversion` (`techniques/text.md`).

## Source

```c
// petscii-screen-codes.c
// PETSCII to screen code and back without a table. The program first
// measures the rule itself: every PETSCII code $20-$FF goes through CHROUT
// at row 0, column 0, and the screen RAM byte and cursor column are read
// back. pet2scr() is checked against that measurement, scr2pet() is checked
// as its inverse over every screen code, both are folded into a checksum
// shown with PASS or FAIL against the value Python computed, and a CIA1
// timer A harness prints the cycle cost of one call. Rows 2 to 4 show one
// text written by CHROUT, by pet2scr() into screen RAM, and poked raw.
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/kernalio.h>

#define SCREEN ((char *)0x0400)      // default text screen
#define COLOUR ((char *)0xd800)      // colour RAM
#define CURSOR_COL (*(volatile char *)0xd3)
#define RVS_FLAG   (*(volatile char *)0xc7)
#define QUOTE_FLAG (*(volatile char *)0xd4)
#define INSERT_CNT (*(volatile char *)0xd8)
#define CUR_COLOUR (*(volatile char *)0x0286)

// Expected checksums, computed by the same fold in Python (page text).
#define EXPECT_P2S 0x085B            // fold over pet2scr(c), c = $20..$FF
#define EXPECT_S2P 0x2200            // fold over scr2pet(s), s = $00..$7F

// --- the routines under test ------------------------------------------------

// PETSCII to screen code. Printable codes are $20-$7F and $A0-$FF; a
// control code returns $FF, which no printable code maps to. Bit 7 of the
// result is never set: reverse video is the caller's state, not the code's.
__noinline char pet2scr(char c)
{
    if (c < 0x20) return 0xff;       // control codes
    if (c < 0x40) return c;          // space, digits, punctuation: unchanged
    if (c < 0x60) return c - 0x40;   // @, unshifted letters, [ ] and arrows
    if (c < 0x80) return c - 0x20;   // shifted letters and graphics
    if (c < 0xa0) return 0xff;       // control codes
    if (c == 0xff) return 0x5e;      // pi has two PETSCII codes; $FF is the alias
    return (c & 0x7f) | 0x40;        // $A0-$BF to $60-$7F, $C0-$FE to $40-$7E
}

// Screen code to PETSCII. Bit 7 (reverse video) is dropped. Screen codes
// $40-$7F each have two PETSCII spellings; this picks the ones the keyboard
// delivers, $C0-$DF for $40-$5F and $A0-$BF for $60-$7F, so a round trip
// through pet2scr() gives the screen code back.
__noinline char scr2pet(char s)
{
    s &= 0x7f;
    if (s < 0x20) return s + 0x40;
    if (s < 0x40) return s;
    if (s < 0x60) return s + 0x80;
    return s + 0x40;
}

__noinline char conv_null(char c)
{
    return c;                        // timing control: same call shape
}

// --- helpers ---------------------------------------------------------------

static char prow, pcol;

// KERNAL PLOT ($FFF0) with carry clear: set the cursor to row X, column Y.
static void plot(char row, char col)
{
    prow = row;
    pcol = col;
    __asm volatile {
        ldx prow
        ldy pcol
        clc
        jsr $fff0
    }
}

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

static const char hex_glyph[16] = {
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06
};

static void put_hex8(char row, char col, char v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hex_glyph[v >> 4];
    p[1] = hex_glyph[v & 15];
}

static void put_hex16(char row, char col, unsigned v)
{
    put_hex8(row, col, (char)(v >> 8));
    put_hex8(row, col + 2, (char)v);
}

static void put_dec(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    char d[5];
    char n = 0;
    do { d[n++] = 0x30 + v % 10; v /= 10; } while (v);
    while (n) *p++ = d[--n];
}

static unsigned fold(unsigned chk, char value)
{
    return (chk ^ value) * 5 + 1;
}

// --- timing harness: CIA1 timer A, force-loaded from $FFFF, phi2 ----------

static volatile char tval_p = 0xc1;      // volatile: the call cannot be folded
static volatile char tval_s = 0x41;

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

static volatile char sink;

static unsigned time_p2s(void)  { char v = tval_p; t_start(); sink = pet2scr(v);   return t_stop(); }
static unsigned time_s2p(void)  { char v = tval_s; t_start(); sink = scr2pet(v);   return t_stop(); }
static unsigned time_null(void) { char v = tval_p; t_start(); sink = conv_null(v); return t_stop(); }

// The demonstration text as PETSCII bytes: HELLO 123 [@] then shifted A,
// shifted B, pi and a graphics code from the $A0 range.
static const char demo[] = {
    0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x20, 0x31, 0x32, 0x33, 0x20,
    0x5b, 0x40, 0x5d, 0x20, 0xc1, 0xc2, 0xde, 0xa5, 0
};

int main(void)
{
    __asm { sei }                        // no KERNAL IRQ: no cursor blink, no timer reprogramming

    // Measure CHROUT over every code $20-$FF at row 0, column 0, and compare
    // pet2scr() with what the KERNAL put in screen RAM. The three editor
    // flags are cleared before each write so $12, $22 and $94 cannot colour
    // the next code's result.
    unsigned bad = 0;
    char c = 0x20;
    do
    {
        RVS_FLAG = 0; QUOTE_FLAG = 0; INSERT_CNT = 0;
        plot(0, 0);
        SCREEN[0] = 0x00;
        krnio_chrout(c);
        char want = CURSOR_COL ? SCREEN[0] : 0xff;   // no cursor step: a control code
        if (pet2scr(c) != want) bad++;
    } while (++c != 0);
    CUR_COLOUR = 14;                     // the loop passed colour codes; back to light blue

    // Shifted set select and the reverse flag, read straight after CHROUT.
    krnio_chrout(0x0e);
    char d018_lower = vic.memptr;
    krnio_chrout(0x8e);
    char d018_upper = vic.memptr;
    plot(0, 0);
    RVS_FLAG = 0;
    krnio_chrout(0x12);
    krnio_chrout(0x41);
    char rvs_a = SCREEN[0];
    krnio_chrout(0x92);

    // Colour RAM after a CHROUT with the current colour set to yellow.
    CUR_COLOUR = 7;
    plot(0, 0);
    krnio_chrout(0x42);
    char colour_b = COLOUR[0] & 0x0f;
    CUR_COLOUR = 14;

    // Round trip: every screen code through scr2pet() then pet2scr().
    unsigned bad_rt = 0;
    for (char s = 0; s < 0x80; s++)
        if (pet2scr(scr2pet(s)) != s) bad_rt++;

    // Checksums over both routines.
    unsigned chk_p2s = 0, chk_s2p = 0;
    c = 0x20;
    do { chk_p2s = fold(chk_p2s, pet2scr(c)); } while (++c != 0);
    for (char s = 0; s < 0x80; s++) chk_s2p = fold(chk_s2p, scr2pet(s));

    // Cycle costs, body only: the empty call is subtracted. Display off
    // while timing so no badline stalls the CPU; wait for a new frame first
    // (the VIC-II samples DEN once per frame, on line $30).
    vic.ctrl1 &= ~0x10;
    while (vic.raster != 0x80) ;
    while (vic.raster != 0x00) ;
    unsigned base = time_null();
    unsigned c_p2s = time_p2s();
    unsigned c_s2p = time_s2p();
    vic.ctrl1 |= 0x10;

    // Display. The measuring loop passed $93, $0E and colour codes, so clear
    // the screen, force the upper case set and light blue.
    vic.memptr = 0x15;
    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; COLOUR[i] = 14; }

    put_text(0, 0, "PETSCII AND SCREEN CODES");

    put_text(2, 0, "CHROUT      ");
    plot(2, 12);
    for (char i = 0; demo[i]; i++) krnio_chrout(demo[i]);
    put_text(3, 0, "PET2SCR     ");
    for (char i = 0; demo[i]; i++) SCREEN[3 * 40 + 12 + i] = pet2scr(demo[i]);
    put_text(4, 0, "RAW PETSCII ");
    for (char i = 0; demo[i]; i++) SCREEN[4 * 40 + 12 + i] = demo[i];

    put_text(6, 0, "CHROUT VS PET2SCR $20-$FF");
    put_text(6, 30, bad == 0 ? "PASS" : "FAIL");
    put_text(7, 0, "ROUND TRIP $00-$7F");
    put_text(7, 30, bad_rt == 0 ? "PASS" : "FAIL");
    put_text(8, 0, "P2S CHK      EXP      ");
    put_hex16(8, 8, chk_p2s); put_hex16(8, 17, EXPECT_P2S);
    put_text(8, 30, chk_p2s == EXPECT_P2S ? "PASS" : "FAIL");
    put_text(9, 0, "S2P CHK      EXP      ");
    put_hex16(9, 8, chk_s2p); put_hex16(9, 17, EXPECT_S2P);
    put_text(9, 30, chk_s2p == EXPECT_S2P ? "PASS" : "FAIL");

    put_text(11, 0, "$D018 AFTER $0E    AFTER $8E");
    put_hex8(11, 16, d018_lower); put_hex8(11, 29, d018_upper);
    put_text(12, 0, "$12 THEN $41 WRITES");
    put_hex8(12, 20, rvs_a);
    put_text(13, 0, "COLOUR RAM AFTER CHROUT, $0286=7:");
    put_hex8(13, 34, colour_b);

    put_text(15, 0, "CYCLES, BODY ONLY (CIA1 TIMER A)");
    put_text(16, 0, "PET2SCR $C1");
    put_dec(16, 14, c_p2s - base);
    put_text(17, 0, "SCR2PET $41");
    put_dec(17, 14, c_s2p - base);
    put_text(18, 0, "NULL CALL");
    put_dec(18, 14, base);

    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=petscii-screen-codes.prg petscii-screen-codes.c
```

Then run headless (PAL; add `-model ntsc` for NTSC):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 180 x64sc -default -minimized -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 6000000 -exitscreenshot petscii-screen-codes.png -autostart petscii-screen-codes.prg
```

## Expected output

`screenshots/petscii-screen-codes.png` (PAL) and
`screenshots/petscii-screen-codes-ntsc.png` (NTSC), both read cell by
cell against the character ROM, and each the same bytes on two runs of
the command above. Light blue text on the default blue screen:

```text
PETSCII AND SCREEN CODES

CHROUT      HELLO 123 [@] AB^#
PET2SCR     HELLO 123 [@] AB^#
RAW PETSCII (graphics glyphs, then four reversed cells)

CHROUT VS PET2SCR $20-$FF     PASS
ROUND TRIP $00-$7F            PASS
P2S CHK 085B EXP 085B         PASS
S2P CHK 2200 EXP 2200         PASS

$D018 AFTER $0E 17 AFTER $8E 15
$12 THEN $41 WRITES 81
COLOUR RAM AFTER CHROUT, $0286=7: 07

CYCLES, BODY ONLY (CIA1 TIMER A)
PET2SCR $C1   32
SCR2PET $41   22
NULL CALL     23
```

Rows 2 and 3 hold the same screen codes cell for cell (`08 05 0C 0C 0F
20 31 32 33 20 1B 00 1D 20 41 42 5E 65`, read from the PAL screenshot):
the last four are the shifted A and B glyphs, pi and a graphics
character, which the text rendering above can only sketch. Row 4 holds
the PETSCII bytes themselves (`48 45 4C 4C 4F ... C1 C2 DE A5`), so the
letters come out as graphics characters and the last four cells, whose
bit 7 is set, come out reversed.

The two checksums are the fold `chk = ((chk ^ byte) * 5 + 1) & 0xFFFF`
over the routine's output for every input, in order. In Python, with
the two functions transcribed from the listing:

```python
def fold(chk, v): return ((chk ^ v) * 5 + 1) & 0xffff
def p2s(c):
    if c < 0x20: return 0xff
    if c < 0x40: return c
    if c < 0x60: return c - 0x40
    if c < 0x80: return c - 0x20
    if c < 0xa0: return 0xff
    if c == 0xff: return 0x5e
    return (c & 0x7f) | 0x40
def s2p(s):
    s &= 0x7f
    if s < 0x20: return s + 0x40
    if s < 0x40: return s
    if s < 0x60: return s + 0x80
    return s + 0x40
chk = 0
for c in range(0x20, 0x100): chk = fold(chk, p2s(c))
print(hex(chk))            # 0x85b
chk = 0
for s in range(0x80): chk = fold(chk, s2p(s))
print(hex(chk))            # 0x2200
```

The first `PASS` says the rule in `pet2scr()`
agrees with what the KERNAL wrote to screen RAM for all 224 codes, on
this run, in VICE x64sc 3.10. The checksums pin the routines' output to
the Python transcription so a later edit that changes a boundary is
caught. The `$D018`, `$12` and colour RAM lines are read back from the
machine after the CHROUT calls named on them.

The cycle figures are CIA1 timer A after each call, less the 23 cycles of
the same sequence around an identity function, so they are the body of
the routine without its `JSR` and `RTS`; PAL and NTSC read the same
(rung 1, VICE x64sc 3.10). `$C1` takes the longest path through
`pet2scr()` (all six compares fail before the mask). The cycle limit is
6,000,000 because the CHROUT loop and the display are done well inside
it; the program then spins.

## Why this works

CHROUT to the screen ends in the editor's print path at `$E716`, where
the low half of the code is folded by two masks and the high half by a
mask and an OR (KERNAL 901227-03, read from the ROM image; the address
is named so the routine can be found, the listing above is not a copy
of it). `pet2scr()` states the same folds as ranges: `$20-$3F`
unchanged, `$40-$5F` less `$40`, `$60-$7F` less `$20`, and for `$A0`
and above the low seven bits with bit 6 set, which sends `$A0-$BF` to
`$60-$7F` and `$C0-$FE` to `$40-$7E`. `$FF` is the second PETSCII code
for pi and goes to `$5E`, the same cell as `$DE`. Control codes return
`$FF`; the measuring loop treats a code as a control code when the
cursor column at `$D3` is still 0 after the call, which is also how it
knows `$93` (clear screen) and `$94` (insert), which do leave `$20` in
the cell, printed nothing.

`scr2pet()` cannot be a true inverse because screen codes `$40-$7F`
each have two PETSCII spellings (`$60-$7F` and `$C0-$DF` for the first
block, `$A0-$BF` and `$E0-$FF` for the second). It picks `$C0-$DF` and
`$A0-$BF`, the codes the keyboard delivers for shifted letters and
Commodore-key graphics, and drops bit 7, which is reverse video and not
part of the character. The round-trip line checks that `pet2scr()` maps
each picked code back to the screen code it came from.

The three editor flags are cleared before every measured CHROUT because
they change the next code's result: `$12` sets the reverse flag at `$C7`
and every later printable code gets bit 7 set (the `$12 THEN $41` line
shows `81`); `$22` toggles quote mode at `$D4`, in which control codes
print as reversed glyphs instead of acting; `$94` counts an insert at
`$D8` with the same effect. The `$D018` line shows the shifted set is a
different thing again: `$0E` and `$8E` flip bit 1 of the register
(`$17` and `$15`) and change which 2 KB of the character ROM the VIC
reads, while the screen code in RAM stays the same. The colour RAM line
shows the cost of CHROUT a direct write does not pay: the KERNAL writes
the current colour from `$0286` into `$D800` alongside every character,
and a program that writes `$0400` itself has to write `$D800` itself, or
the cell keeps whatever colour it had.

The KERNAL IRQ is switched off with `sei` so the jiffy handler does not
blink the cursor into the cell under test or reprogram CIA1 timer A
during the timed calls. PLOT (`$FFF0`, carry clear) puts the editor's
cursor at row 0, column 0 before each measured write, and at row 2,
column 12 for the CHROUT demonstration row; the other two rows are
written to `$0400 + 40 * row + 12` directly.
