---
recipe: lfsr-random
toolchain: oscar64
output_format: PRG
region: both
techniques: [lfsr_random]
file_formats: [PRG]
uses_registers: [D40E, D40F, D412, D418, D41B, DC04, DC05, DC0E, D011, D020, D021]
uses_kernal: []
claims: [sid_voice_3 (init), sid_voice_3_readback (init), sid_filter_volume (init), cia1_timer_a (reads)]
claims_basis: derived-listing
---

<!-- doc-type: recipe -->

# Oscar64 LFSR random numbers seeded from SID noise, with a self-check

## Synopsis

An 8-bit and a 16-bit Galois LFSR seeded from SID voice 3 noise at
$D41B. The program prints the seed, the CIA1 timer A value read beside
it and how many of 255 consecutive $D41B read pairs differed; prints the
first eight output bytes; paints rows 6 to 24 with the 16-bit
generator's low nibble as a colour mosaic; then walks both generators
round their whole cycle, counting the period, folding every state into a
checksum, and building a byte histogram, and shows PASS only if all of
it matches the values compiled in from a Python model. CIA1 timer A
times 256 steps of each generator. The technique is `lfsr_random` in
`techniques/maths.md`. The companion `lfsr-random-seed2.md` is the
same listing with a fixed seed.

## Source

```c
// lfsr-random.c
// Two Galois LFSRs, an 8-bit one (taps $B8, period 255) and a 16-bit one
// (taps $B400, period 65535), seeded from SID voice 3 noise at $D41B.
// The screen shows the seed, the first eight output bytes, a mosaic
// painted by the 16-bit generator, then a self-check: both periods are
// walked on the 6510 and folded into a checksum that must match the value
// computed in Python and compiled in below. CIA1 timer A times each step.
// Define FIXED_SEED to ignore $D41B and use a constant seed instead; the
// companion page recipes/oscar64/lfsr-random-seed2.md does exactly that.
#include <c64/vic.h>
#include <c64/sid.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)

#define EXPECT_CS8  0x5F8B   // Python fold over the 255 states from state 1
#define EXPECT_CS16 0x6D9B   // Python fold over the 65535 states from state 1

static const char hex_glyph[16] = {
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 1, 2, 3, 4, 5, 6 };

// Generator state. Globals so the inline assembler can name them.
volatile char     s8;
volatile unsigned s16;
unsigned hist[256];

// 8-bit Galois LFSR, one step, right shift, taps $B8 (x^8+x^6+x^5+x^4+1).
__noinline void step8(void)
{
    __asm volatile {
        lda s8
        lsr
        bcc l1
        eor #$b8
    l1:
        sta s8
    }
}

// 16-bit Galois LFSR, one step, right shift, taps $B400 (x^16+x^14+x^13+x^11+1).
__noinline void step16(void)
{
    __asm volatile {
        lsr s16 + 1
        ror s16
        bcc l1
        lda s16 + 1
        eor #$b4
        sta s16 + 1
    l1:
    }
}

__noinline void nothing(void)
{
}

static void put_str(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

static void put_hex8(char row, char col, char v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hex_glyph[v >> 4];
    p[1] = hex_glyph[v & 15];
}

static void put_hex16(char row, char col, unsigned v)
{
    put_hex8(row, col, v >> 8);
    put_hex8(row, col + 2, v & 0xff);
}

static void put_dec(char row, char col, unsigned v, char width)
{
    char *p = SCREEN + 40 * row + col + width;
    do
    {
        *--p = '0' + v % 10;
        v /= 10;
    } while (--width);
}

static unsigned fold(unsigned cs, unsigned v)
{
    return (cs ^ v) * 5 + 1;
}

// CIA1 timer A: force-load $FFFF, count phi2 while fn runs 256 times, read.
static unsigned time_loop(void (*fn)(void))
{
    cia1.cra = 0x00;
    cia1.ta = 0xffff;
    cia1.cra = 0x11;
    char i = 0;
    do
    {
        fn();
    } while (++i);
    cia1.cra = 0x00;
    return 0xffff - cia1.ta;
}

int main(void)
{
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;

    // Voice 3 as a noise source: top frequency, noise gated, output muted
    // by bit 7 of $D418 so the volume nibble a music player owns is
    // left alone (a real game ORs the bit into its own $D418 shadow).
    sid.voices[2].freq = 0xffff;
    sid.voices[2].ctrl = SID_CTRL_NOISE | SID_CTRL_GATE;
    sid.fmodevol = SID_FMODE_3_OFF | 15;

    // Does $D41B move between reads? Count changes over 255 read pairs.
    char prev = sid.random, changes = 0;
    for (char i = 0; i < 255; i++)
    {
        char r = sid.random;
        if (r != prev)
            changes++;
        prev = r;
    }

    // Seed: two reads a little apart make the 16-bit seed. The timer
    // is read too, as the second source a game would mix in.
    unsigned seed = sid.random;
    for (char i = 0; i < 100; i++)
        nothing();
    seed = (seed << 8) | sid.random;
    unsigned timer = cia1.ta;
#ifdef FIXED_SEED
    // Fetched through a runtime index so the seed is never a compile-time
    // constant. With a bare constant here (or a volatile initialised to
    // one) Oscar64 folded the volatile compare in the period loop below
    // into an unconditional jump and dropped the rest of main.
    static unsigned fixed_seed[2] = { FIXED_SEED, FIXED_SEED };
    seed = fixed_seed[changes & 1];
#endif
    if (seed == 0)              // all-zero state never leaves zero
        seed = 0xACE1;
    char seed8 = (char)seed;
    if (seed8 == 0)
        seed8 = 0x01;

    put_str(0, 0, "seed      cia1 ta       d41b chg");
    put_hex16(0, 5, seed);
    put_hex16(0, 18, timer);
    put_dec(0, 33, changes, 3);

    // The first eight bytes and the mosaic come from the same run.
    s16 = seed;
    put_str(1, 0, "first");
    for (char i = 0; i < 8; i++)
    {
        step16();
        put_hex8(1, 6 + 3 * i, (char)s16);
    }
    s16 = seed;
    for (unsigned i = 240; i < 1000; i++)
    {
        step16();
        SCREEN[i] = 0xa0;
        COLOUR[i] = (char)s16 & 15;
    }

    // Period of the 8-bit generator from seed8, then its checksum from 1.
    unsigned p8 = 0;
    s8 = seed8;
    do
    {
        step8();
        p8++;
    } while (s8 != seed8);
    unsigned cs8 = 0;
    s8 = 1;
    do
    {
        step8();
        cs8 = fold(cs8, s8);
    } while (s8 != 1);
    put_str(2, 0, "p8     cs      exp       p16");
    put_dec(2, 3, p8, 3);
    put_hex16(2, 10, cs8);
    put_hex16(2, 19, EXPECT_CS8);

    // Period of the 16-bit generator from the seed, with a byte histogram
    // of its low byte, then its checksum from state 1.
    for (unsigned i = 0; i < 256; i++)
        hist[i] = 0;
    unsigned p16 = 0;
    s16 = seed;
    do
    {
        step16();
        p16++;
        hist[(char)s16]++;
    } while (s16 != seed);
    unsigned cs16 = 0;
    s16 = 1;
    do
    {
        step16();
        cs16 = fold(cs16, s16);
    } while (s16 != 1);
    unsigned hmin = 0xffff, hmax = 0;
    for (unsigned i = 0; i < 256; i++)
    {
        if (hist[i] < hmin) hmin = hist[i];
        if (hist[i] > hmax) hmax = hist[i];
    }
    put_dec(2, 29, p16, 5);
    put_str(3, 0, "cs16      exp      hist min     max");
    put_hex16(3, 5, cs16);
    put_hex16(3, 14, EXPECT_CS16);
    put_dec(3, 28, hmin, 3);
    put_dec(3, 36, hmax, 3);

    bool ok = p8 == 255 && cs8 == EXPECT_CS8 && p16 == 65535 &&
              cs16 == EXPECT_CS16 && hmin == 255 && hmax == 256 &&
              hist[0] == 255;

    // Cycle cost: 256 calls each, DEN off so no badline stalls the count.
    __asm { sei }
    vic.ctrl1 = 0x0b;
    vic_waitFrame();
    unsigned t0 = time_loop(nothing);
    unsigned t8 = time_loop(step8);
    unsigned t16 = time_loop(step16);
    vic.ctrl1 = 0x1b;
    put_str(4, 0, "cyc x256 empty       l8       l16");
    put_dec(4, 15, t0, 5);
    put_dec(4, 24, t8, 5);
    put_dec(4, 34, t16, 5);

    put_str(5, 0, ok ? "pass" : "fail");
    put_str(5, 6, "hist0");
    put_dec(5, 12, hist[0], 3);
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```
oscar64 -tm=c64 -O2 -o=lfsr-random.prg lfsr-random.c
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 120 x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 20000000 -exitscreenshot lfsr-random.png -autostart lfsr-random.prg
```

Add `-model ntsc` for the NTSC picture. 20,000,000 cycles is the pinned
run; at 12,000,000 the 16-bit period walk is still running: the P16
count on row 2 and all of rows 3 to 5 are blank and the border is still
black (measured in VICE x64sc 3.10).

## Expected output

Black screen, green border. Decoded from `screenshots/lfsr-random.png`
(PAL) with the character ROM:

```
SEED 9219 CIA1 TA 251C  D41B CHG 255
FIRST 0C 86 43 A1 D0 E8 74 3A
P8 255 CS 5F8B EXP 5F8B  P16 65535
CS16 6D9B EXP 6D9B HIST MIN 255 MAX 256
CYC X256 EMPTY 09476 L8 12933 L16 14441
PASS  HIST0 255
```

Rows 6 to 24 are a 40 by 19 mosaic of reversed spaces in all 16 colours;
each colour appears between 43 and 53 times over the 760 cells. Two PAL
runs of the same PRG gave pixel-identical PNGs.

`screenshots/lfsr-random-ntsc.png` (`-model ntsc`) reads the same on
rows 2 to 5 and differs on rows 0 and 1: `SEED 7A80 CIA1 TA 2627`,
`FIRST 40 A0 50 A8 D4 EA F5 7A`. Compared by colour index (each cell's
RGB mapped back to its nibble, because the PAL and NTSC PNGs use
different palettes and share only 5 of the 16 mosaic RGB values, so a
raw RGB comparison undercounts) its mosaic matches the PAL one in 38 of
760 cells, within noise of the 47.5 two unrelated 16-colour patterns
give by chance.

What the picture proves: on this emulator the $D41B read is moving
(255 of 255 pairs differed), both periods are the full 2^n - 1, the
whole-cycle checksums match the Python model, and the histogram is flat
but for the missing zero. What it does not prove: that the seed varies
from one run to the next on real hardware. A headless VICE run seeds
`$9219` every time because the noise register starts from a fixed state
and the read lands on the same cycle; the companion page changes the
seed by hand to show the picture depends on it. Nor does PASS say the
bytes are independent; the FIRST row shows each low byte is the previous
one shifted right.

The Python side of the checksum:

```python
def fold(chk, v):
    return ((chk ^ v) * 5 + 1) & 0xFFFF

def step8(s):
    c = s & 1; s >>= 1
    return s ^ 0xB8 if c else s

def step16(s):
    c = s & 1; s >>= 1
    return s ^ 0xB400 if c else s

s, n, cs = 1, 0, 0
while True:
    s = step8(s); n += 1; cs = fold(cs, s)
    if s == 1: break
print(n, hex(cs))                       # 255 0x5f8b

s, n, cs, hist = 1, 0, 0, [0] * 256
while True:
    s = step16(s); n += 1; cs = fold(cs, s); hist[s & 0xFF] += 1
    if s == 1: break
print(n, hex(cs), min(hist), max(hist), hist[0])   # 65535 0x6d9b 255 256 255
```

## Why this works

`step8` and `step16` are `__noinline` functions whose body is inline
assembler, so the timed and checked code is the six-instruction sequence
on the page and not the compiler's rendering of it. The state variables
are `volatile` because the first build was not: Oscar64 does not treat
inline assembler as writing the globals it names, kept `s16` in a
register across the call, and the screen read `FIRST C8 C8 C8 ...` and
`P8 001`. The cycle figures were right even then; only the C side read stale
state.

The period walk starts from the live seed and the checksum walk from
state 1. The period proves the seed is on the full cycle; a fold from a
fixed start makes the expected value independent of the seed, so one
compiled-in constant serves every run and the companion page. The
histogram is built during the period walk from the low byte of each
state.

Timing: `time_loop` stops CIA1 timer A, writes `$FFFF` to its latch,
force-loads and starts it counting phi2 (`cra = $11`), calls the
function 256 times through a pointer, stops the timer and reads it. The
empty function measures the call and loop; subtracting it gives 3,457
cycles for 256 8-bit steps (13.5 each) and 4,965 for 256 16-bit steps
(19.4 each). `sei` and DEN off keep the KERNAL interrupt and badlines out
of the count; the program never returns, so the jiffy clock it leaves
stopped does not matter.

The `#ifdef FIXED_SEED` block fetches its constant through a
runtime-indexed two-entry array. With `seed = FIXED_SEED;` the companion
build was 932 bytes instead of 1,949: Oscar64 folded the `volatile`
compare `s8 != seed8` into an unconditional jump and dropped everything
after the 8-bit period loop, and the run never printed row 2. A
`volatile` variable initialised to the constant, at block or file scope,
was folded the same way. The array with a runtime index is the form that
built the same code as the $D41B path (Oscar64 build 2026-05-19).
