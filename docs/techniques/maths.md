---
category: maths
chip: 6510
---

<!-- doc-type: technique-reference -->

# Maths: fixed point, table multiply, jump arcs

The 6510 has no multiply, no divide and no fraction. Game movement that
needs sub-pixel speeds or acceleration is done with fixed-point integers
and lookup tables. Every cycle figure on this page was measured in VICE
x64sc 3.10 with CIA1 timer B unless it says otherwise. The measuring
program is at the end of the page.

## fixed_point_8_8 — 8.8 fixed-point positions and velocities

**Complexity:** low
**Region:** both
**Uses registers:** (none)

### Why

A sprite register takes a whole pixel. A jump that accelerates by an
eighth of a pixel per frame cannot be expressed in whole pixels, and
rounding each frame drifts. Keeping eight extra bits of fraction gives
speeds down to 1/256 pixel per frame with no drift, at the cost of one
extra byte per coordinate and one extra add per update.

### How

A value is a 16-bit two's complement integer read as `whole * 256 +
fraction`. `$0100` is 1.0, `$0080` is 0.5, `$FFC0` is -0.25. The high
byte is the whole part and the low byte the fraction. Nothing on the CPU
knows this; the programmer does.

Adding two 8.8 values is a plain 16-bit add, low byte first, and the
carry moves the fraction overflow into the whole part:

```asm
        clc
        lda pos_lo
        adc vel_lo
        sta pos_lo
        lda pos_hi
        adc vel_hi
        sta pos_hi
```

Measured: 26 cycles with all six operands in absolute memory (100 calls
timed, 7,504 cycles less the 4,904 of the empty loop, display off so no
badline stole a cycle). With zero-page operands the same sequence is 20
cycles by the instruction table (rung 3, not measured here).

The pixel byte for a sprite register is the high byte, `pos_hi`. In
Oscar64 that is `(char)(y_fp >> 8)`; the compiler emits a byte move, not
eight shifts.

Signed values need no special add. A negative velocity is just a large
unsigned 16-bit number and the carry does the right thing. The sign
lives in bit 15, so `bmi` after `lda pos_hi` tests it, and a signed
comparison against a limit uses `sec / sbc / bvc / eor #$80` on the high
byte or, in C, an `int` compare. Where the whole part must stay
unsigned (a screen Y of 0 to 255) keep the position in an `unsigned`
and the velocity in an `int`; two's complement makes the add of the two
correct without a cast on the 6510.

### 16.8 when the range needs it

8.8 in a signed 16-bit word covers -128.00 to +127.99. A world
coordinate in a scrolling level, or a screen Y above 127 that must also
go negative, does not fit. 16.8 uses three bytes: two whole, one
fraction. The add gains one more `lda / adc / sta` (four cycles each
absolute, three zero page, rung 3). The pixel byte is the middle byte;
the top byte is the scroll or the sign. `c64-game-archetypes.md` names
8.8 and 16.8 as the standard for the scrolling platformer.

### Exhaustive check

The measuring program adds every pair `a = i * $0101`, `b = j * $0101`
for `i, j` in 0..255: 65,536 pairs, every low-byte pair once, with the
high-byte pair `(i, j)` added under the carry that low-byte pair
produces. Each 16-bit result is folded into a checksum (rotate left one,
exclusive-or the result, add 13) and compared with the compiler's own
`add_a + add_b`. Result on screen, PAL, 70,000,000 cycles:

```
add cs 8aa1 exp 8aa1 miss 00000
pass
```

Python over the same 65,536 pairs gives `0x8AA1`. Zero mismatches. A
first version of the harness ran two more sweeps meant to cover the
high-byte pairs under a forced carry of 0 and of 1; they left the
checksum unchanged, which means they did not run as written, so they
were removed and are not claimed here.

### Recipes

- `recipes/oscar64/fixed-point-jump.md`

## table_multiply_8x8 — Quarter-square table multiply

**Complexity:** medium
**Region:** both
**Uses registers:** (none)
**Cost:** cycles_per_frame=52, bytes_data=2048
**Cost basis:** arithmetic

### Why

A shift-and-add 8x8 multiply is a loop of eight iterations, around 100
to 150 cycles depending on the routine (rung 4, not measured here). A
table gives the product in a fixed 52 cycles. `effects-vector-3d.md`
budgets six table multiplies per rotated point on that basis.

### How

The identity is `a * b = q(a + b) - q(a - b)` with `q(n) = floor(n^2 / 4)`.
When `a + b` is odd, `a - b` is odd too and the two floors lose the same
quarter, so the result is exact.

Two tables of `q` are kept, each 512 entries split into a low-byte and a
high-byte table: `sqr[i] = q(i)` for `i` in 0..511, and `nsq[i] =
q(|i - 255|)`. That is 2,048 bytes, built at start-up in a loop of 512
steps using `q(i + 1) = q(i) + floor((i + 1) / 2)`, so no multiply is
needed to build the multiply table. Each table starts on a page
boundary.

The routine patches `a` into the low address byte of two reads into
`sqr` and `255 - a` (which is `a eor $ff`) into two reads into `nsq`,
then indexes all four with `Y = b`. `sqr + a` indexed by `b` is
`q(a + b)`; `nsq + 255 - a` indexed by `b` is `q(|b - a|)`.

```asm
        lda a
        sta m1 + 1
        sta m2 + 1
        eor #$ff
        sta m3 + 1
        sta m4 + 1
        ldy b
        sec
m1:     lda sqr_lo,y
m3:     sbc nsq_lo,y
        sta result
m2:     lda sqr_hi,y
m4:     sbc nsq_hi,y
        sta result + 1
```

### Cycle budget

Measured: 52 cycles for `a = b = 0` with `a`, `b` and `result` in
absolute memory (10,104 cycles for 100 calls less the 4,904 empty-loop
baseline; the call and return are in both figures and cancel). That is
exactly the instruction-table sum: six absolute stores and loads at 4,
one `eor #` and one `sec` at 2, four indexed reads at 4 and two stores
at 4. Each indexed read adds one cycle when `base + a + b` crosses a
page, so the worst case is 56 (rung 3). With `a`, `b` and the result in
zero page the fixed part drops by 4 to 48 (rung 3, not measured here);
only the two operand loads and the two result stores move, because the
four patch stores write into the routine's own code and stay absolute.
The page-aligned tables are what keep the patch to one byte: without
alignment the high address byte would need a carry as well.

### The optimiser will move the patched instructions

In Oscar64 the block above must be written `__asm volatile`. Without
`volatile` the assembler optimiser at `-O2` rewrote `ldy / lda ,y` as
`ldx / lda ,x`, duplicated the block, and left the four `sta m1 + 1`
stores pointing into the other copy. Every product came out as
`q(a + b) - q(b)`; the first version of the harness on this page read
`$C080` for `0 * 0`. `toolchains/oscar64-reference.md` (the assembler
optimizer paragraph) documents the switch; the symptom is recorded here because the compiled
listing looked right in the copy that was inspected first.

### Signed variant

For signed 8-bit operands, run the unsigned routine on the raw bytes and
correct: if `a` is negative subtract `b` from the high byte, if `b` is
negative subtract `a` from the high byte. That is two tests and at most
two `sbc` on the high byte (rung 3, not measured here). The other common
form biases both operands by 128 and uses a table built for the biased
range; it needs no correction but a different table.

### Exhaustive check

All 65,536 `(a, b)` pairs, `a` outer and `b` inner, each product folded
into the same checksum as the add and compared with Oscar64's own
`(unsigned)a * b`. Result on screen, PAL:

```
mul cs 0f09 exp 0f09 miss 00000
pass
```

Python over the same pairs in the same order gives `0x0F09`. Zero
mismatches.

### Recipes

- No recipe yet. The tables and the checking harness are the measuring
  program at the end of this page; `recipes/oscar64/fixed-point-jump.md`
  does not use a multiply.

## division_8_16bit — Shift-and-subtract division, reciprocals and divide by ten

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Cost:** cycles_per_frame=791
**Cost basis:** measured-vice

### Why

The 6510 has no divide. A game needs one for a tile coordinate from a
pixel position when the tile is not a power of two, for an average, a
percentage, a speed from a distance and a time, and for splitting a
number into decimal digits. A binary shift-and-subtract loop does any
of these in a few hundred cycles; a divisor that is known at assembly
time can be turned into a multiply or a table and costs a tenth of
that. The figures here were measured with CIA1 timer A in
`recipes/oscar64/divide-check.md` (rung 1, VICE x64sc 3.10), with the
operands in absolute memory; the zero-page and constant-divisor
figures are instruction-table arithmetic from those loops (rung 3).

### How

Long division in binary. Clear the remainder. Repeat once per dividend
bit: shift the dividend left, shifting its top bit into the bottom of
the remainder; if the remainder is now at least the divisor, subtract
the divisor from it and set the bit of the dividend that the shift
vacated. When the passes are done the dividend holds the quotient and
the remainder is the remainder. The loop for a 16-bit dividend and an
8-bit divisor, quotient in `dvd`, remainder in `rem`:

```
        lda #0
        sta rem
        ldx #16
loop:   asl dvd
        rol dvd+1
        rol rem         ; ninth bit of the remainder lands in C
        lda rem
        bcs sub         ; a nine-bit remainder always exceeds the divisor
        cmp dvs
        bcc next        ; remainder < divisor: quotient bit stays 0
sub:    sbc dvs         ; C is set on both paths, so sbc is exact
        sta rem
        inc dvd         ; the bit asl just vacated becomes 1
next:   dex
        bne loop
```

The 8/8 form drops `rol dvd+1` and runs eight passes. The 16/16 form
keeps a two-byte remainder, catches its 17th bit with the same `bcs`
after the second `rol`, compares high bytes first and falls through to
the low bytes only when they are equal, and subtracts two bytes.

The remainder is one bit wider than the divisor before the subtract:
it was less than the divisor, and it has just been doubled plus one.
That bit is the carry out of `rol rem`. Taking `bcs` straight to `sbc`
handles it, because a remainder with that bit set is at least any
divisor of the narrower width, and because `rol` left the carry set,
which is the state `sbc` needs. A loop without the `bcs` is right for
small divisors and wrong for every divisor of `$80` (8-bit) or `$8000`
(16-bit) and above; the recipe's sweep puts about half its 16-bit
divisors there.

A divisor of zero is not trapped. Every compare succeeds, so the
quotient comes out as all ones and the remainder as the dividend (its
low byte in the 16/8 form; rung 3, from the loop; not run). Test for
it before the call if the divisor can be zero.

Signed operands: divide the absolute values, negate the quotient if
the signs differed, and give the remainder the sign of the dividend.
The tests and negations are about 30 cycles on top of the unsigned
loop (rung 3, not measured here).

### Division by a constant

A divisor fixed at assembly time is a multiply by its reciprocal. Pick
a shift `k` and the multiplier `m = ceil(2^k / d)`; then
`q = (n * m) >> k` equals `n / d` for every `n` with `n * e < 2^k`,
where `e = m * d - 2^k` is the rounding error of the reciprocal, which
lies between 0 and `d - 1`. For ten, `m = 205` with `k = 11` has
`e = 2`, so the quotient is exact for `n` up to 1023; Python over all
of them agrees. `m = $CCCD` with `k = 19` has `e = 2` as well and is
exact for every 16-bit `n`, but the product is 32 bits wide. `6554`
with `k = 16` has `e = 4` and is exact only below 16,384: the first
wrong value is 16,389. Get the remainder as `n - q * d`.

For an 8-bit `n` the product `n * 205` is an 8x8 multiply, and
`table_multiply_8x8` above delivers it in 52 cycles; three `lsr` of
the high byte give the quotient, about 65 cycles with the loads
(rung 3, not measured here). The multiply then needs its 2 KB of
tables. A form with no multiply and no table does the same job in
shifts and adds and was measured:

```
        lda n
        lsr
        sta q           ; n/2
        lsr
        clc
        adc q           ; n/2 + n/4 = 0.75 n
        sta q
        lsr
        lsr
        lsr
        lsr
        clc
        adc q           ; 0.75 n + 0.75 n / 16 = 0.797 n
        lsr
        lsr
        lsr             ; 0.0996 n, equal to n/10 or one below it
        sta q
```

Then `r = n - 10 * q` is 0 to 11 (Python over 0..255; the recipe
checks every value), and one `cmp #10 / sbc #10 / inc q` fixes it.
79 cycles for quotient and remainder, any `n`, measured. The 16-bit
version of the same series adds a `q + q >> 8` term, leaves a
remainder of 0 to 13, and needs one fix as well (rung 3, Python; not
run on the machine).

### Division by ten and the decimal print

Splitting a 16-bit number into five digits by repeated 16/8 division
by ten costs four calls of the loop above, 2,793 cycles in the recipe
for 65,535 against 936 for the subtract-powers route that
`decimal_print` (`techniques/text.md`) uses on the same value, three
times as much. Moving the operands to zero page and writing the
divisor as an immediate brings a subtracting pass down from 49 to 39
cycles and a pass without a subtract from 36 to 30 (rung 3), which by
the same proportion puts the four calls near 2,200, still more than
double. The divide route gives the units digit first, which is what a
right-to-left field wants; the subtract route gives the most
significant digit first and is cheaper. A removed divide by ten should
be replaced with subtract-powers or a table, not left out.

### When a table wins

An 8-bit dividend and a constant divisor is a 256-byte table, or two
for quotient and remainder; the recipe's `div10_tab` reads both in 20
cycles, measured, and the tables build in a counting loop at start
with no divide. A tile column from a pixel X with 8-pixel tiles is a
shift, not a divide, and with 12 or 20-pixel tiles it is this table.
A variable 8-bit divisor cannot be a direct table (64 KB); the usual
compromise is a 256-byte table of `256 / d` and a multiply by it,
which is one less than the true quotient for some inputs and needs a
correction step (rung 4, not measured here).

### Cycle budget

Measured, body only, operands in absolute memory:

| Route | Cycles | Case |
|---|---|---|
| 8/8 loop | 351 | 255/1, a subtract on every pass |
| 8/8 loop | 260 | 255/255, one subtract |
| 16/8 loop | 791 | 65535/1, worst case |
| 16/8 loop | 674 | 65535/10 |
| 16/16 loop | 1,339 | 65535/1, worst case |
| 16/16 loop | 715 | 65535/$8000 |
| by 10, shift-add | 79 | any 8-bit value |
| by 10, two tables | 20 | any 8-bit value |
| five digits by four 16/8 divides | 2,793 | 65535 |
| five digits by subtract-powers | 936 | 65535 |

The loop figures are the instruction-table sums: a 16/8 pass with a
subtract is 49 cycles with the operands absolute (`asl`, `rol`, `rol`
and `inc` at 6, the loads, compare and stores at 4, the branches and
`dex` at 2 or 3), 36 without one, and 8 cycles of setup with the
remainder in absolute memory (7 in zero page); 65535/1 is
`8 + 16 * 49 - 1`, and the 8/8 figures close the same way: 255/1 is
`8 + 8 * 43 - 1` and 255/255 is `8 + 7 * 30 + 43 - 1`. In zero page the
same pass is 41 and 31, so the range is 502 to 662 for 16/8 and 214 to
294 for 8/8 (rung 3). An immediate divisor takes 1 off the compare and
1 off the subtract in zero page, so a pass there is 30 without a
subtract and 39 with one, or 36 when the `bcs` path was taken. The
Cost line
carries the measured 16/8 worst case; a routine called once a frame is
about 4 per cent of a PAL frame in its slowest form (791 of 19,656).

### Recipes

- `recipes/oscar64/divide-check.md` — the three loops, the shift-add
  and table divide by ten, checked over every 8-bit pair and a 16-bit
  sweep against Oscar64's `/` and `%` and against Python, with the
  cycle harness on screen.

## jump_arc_table — Gravity in 8.8 and a precomputed arc

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Requires:** fixed_point_8_8

### Why

A jump is a launch velocity and a constant downward acceleration. Done
in 8.8, each frame is two adds. Done as a table, each frame is one
indexed load, and the height at every frame is known before the game
runs, which is what a level designer needs to place a platform.

### How

Per frame, in this order: velocity gains gravity, then position gains
velocity, then the pixel byte goes to the sprite register. With a
launch of `-$0400` (4.0 pixels per frame upward) and gravity `+$0020`
(0.125 pixels per frame per frame) the sprite is back on the ground
after 63 updates; the apex is 62 pixels up and lasts frames 28 to 35.
These numbers come from running the update in Python and were confirmed
by the recipe, which runs the same update on the 6510 every frame and
turns the border red if the live value ever differs from the table (it
stayed green through 252 PAL and 283 NTSC frames in the pinned runs).

Update order matters. Gravity-then-position (semi-implicit Euler)
lands exactly at update 63 with these constants. Position-then-gravity
moves the full launch speed on the first step, lands after 65 updates
and differs from jump frame 4 onward (rung 3, from the same Python
integration). Pick one and generate the table from the same code.

Apex: the frame where the velocity crosses zero, here `$0400 / $0020 =
32` updates; the table's flat top is wider than one frame because the
position moves less than a pixel per frame there. Landing: the first
update where the position reaches or passes the ground. With these
constants the 63 velocity steps sum to exactly zero, so the landing is
exact and the clamp does nothing; keep the clamp for constants where
the last step would carry the sprite below the ground.

### The table

63 bytes of sprite Y, one per jump frame, generated off-line by the same
two adds. The recipe embeds it as `arc_y[]`. A game that stores only the
table needs no fixed point at all for the jump; it needs the table
length and a frame index.

### Divide by a constant

Converting 8.8 to pixels is a divide by 256, which is taking the high
byte. Halving a velocity is `cmp #$80 / ror hi / ror lo` (arithmetic
shift right of a 16-bit signed value, 2 + 5 + 5 = 12 cycles zero page,
rung 3). A divide by a constant that is not a power of two is a multiply
by its reciprocal in 8.8 using `table_multiply_8x8`, then the high byte:
`v / 3` is `v * $55 >> 8`, which is one part in 256 low because
`3 * $55 = 255`, so the result is up to one pixel short over `0..255`
(`255 * $55 >> 8` is 84, not 85). Use `$56` and accept an error the
other way, or a 16-bit reciprocal, if that matters (rung 3, checked in
Python over 0..255, not measured on the 6510).

### Region

The table is in frames. On NTSC the same table plays about 20 percent
faster in wall-clock time (60 frames per second against 50);
`game-design-patterns.md` notes that gravity and speeds are tuned per
region for that reason. The recipe keeps one table and shows the frame
number so the two pictures can be compared frame for frame.

### Variations

Velocity table, launch from any height. `arc_y[]` is absolute sprite Y
from one fixed ground, so a platformer cannot play it from a platform.
Store the per-frame velocity instead, `vy_tab[n] = V0 + (n + 1) * G`
clamped to a terminal velocity, and do `y += vy_tab[n]` from whatever
`y` the jump starts at; the caller decides what a landing is (a floor
under the sprite, a tile lookup). With `-$0380`, `+$0024` and terminal
`+$0210` the 52 entries sum to exactly zero, so a sprite that launches
from a floor is back on it exactly, and the terminal run at the end of
the table is what a longer fall holds. `recipes/oscar64/fixed-point-jump-velocity.md`
runs two sprites from floors 64 pixels apart off one table and checks
the exact landing on the 6510 every jump; the constants were picked in
Python for the zero sum, and the pair `-3.5` with `+$28` does not give
one for any terminal velocity from 1.5 to 4.0 in steps of 1/32.

### Recipes

- `recipes/oscar64/fixed-point-jump.md`
- `recipes/oscar64/fixed-point-jump-velocity.md`

### The measuring program

This section belongs to all three techniques above; it sits under the
last one only because the extractor reads every H2 as a technique. Not
built by the listing gate (technique pages are not compiled); it was
built and run by hand with the commands below. Both the multiply and the
add are `__noinline` functions whose body is `__asm volatile`, so the
timed and checked code is the instruction sequence shown above and not
the compiler's version of it.

```
oscar64 -tm=c64 -O2 -o=fpcheck.prg fpcheck.c
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 120 x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 70000000 -exitscreenshot fpcheck.png -autostart fpcheck.prg
```

Screen after the run, decoded from the PNG with the character ROM:

```
mul cs 0f09 exp 0f09 miss 00000
add cs 8aa1 exp 8aa1 miss 00000

cyc x100 empty 04904 mul 10104 add 07504

pass
```

Timing is CIA1 timer B, force-loaded from `$FFFF`, counting phi2, read
after 100 calls; `$D011` has DEN clear during the timed loops so no
badline or sprite fetch stalls the CPU (with the display on, the same
loops read 5,205 to 5,472 for the empty case depending on where the
loop sat relative to the badlines).

```c
// fpcheck.c -- exhaustive check of the quarter-square multiply and the
// 8.8 add, plus a CIA timer B cycle measurement of each core.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)

#define EXPECT_MUL 0x0F09   // from the Python fold over all 65,536 products
#define EXPECT_ADD 0x8AA1   // from the Python fold over all 65,536 sums

char sqr_lo[512], sqr_hi[512], nsq_lo[512], nsq_hi[512];
#pragma align(sqr_lo, 256)
#pragma align(sqr_hi, 256)
#pragma align(nsq_lo, 256)
#pragma align(nsq_hi, 256)

char mul_a, mul_b;
unsigned mul_r;
int add_a, add_b, add_r;

static void build_tables(void)
{
    unsigned q = 0;
    for (unsigned i = 0; i < 512; i++)
    {
        sqr_lo[i] = q & 0xff;
        sqr_hi[i] = q >> 8;
        q += (i + 1) >> 1;          // q(i+1) = q(i) + floor((i+1)/2)
    }
    for (unsigned i = 0; i < 512; i++)
    {
        unsigned k = i < 255 ? 255 - i : i - 255;
        nsq_lo[i] = sqr_lo[k];
        nsq_hi[i] = sqr_hi[k];
    }
}

__noinline void qmul(void)
{
    __asm volatile
    {
        lda mul_a
        sta m1 + 1
        sta m2 + 1
        eor #$ff
        sta m3 + 1
        sta m4 + 1
        ldy mul_b
        sec
    m1: lda sqr_lo, y
    m3: sbc nsq_lo, y
        sta mul_r
    m2: lda sqr_hi, y
    m4: sbc nsq_hi, y
        sta mul_r + 1
    }
}

__noinline void fpadd(void)
{
    __asm volatile
    {
        clc
        lda add_a
        adc add_b
        sta add_r
        lda add_a + 1
        adc add_b + 1
        sta add_r + 1
    }
}

static inline unsigned fold(unsigned cs, unsigned r)
{
    cs = (cs << 1) | (cs & 0x8000 ? 1 : 0);
    cs ^= r;
    return cs + 0x0d;
}

static const char hexg[16] = { 0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,1,2,3,4,5,6 };

static void put_hex(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hexg[(v >> 12) & 15]; p[1] = hexg[(v >> 8) & 15];
    p[2] = hexg[(v >> 4) & 15]; p[3] = hexg[v & 15];
}

static void put_dec(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    for (signed char i = 4; i >= 0; i--) { p[i] = 0x30 + v % 10; v /= 10; }
}

static void put_str(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s) { char c = *s++; p++[0] = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : (c == ' ' ? 0x20 : c); }
}

volatile char sink;

static unsigned time_loop(void (*fn)(void))
{
    cia1.crb = 0x00;
    cia1.tb = 0xffff;
    cia1.crb = 0x11;              // start, force load, count phi2
    for (char i = 0; i < 100; i++) { fn(); sink = i; }
    cia1.crb = 0x00;
    return 0xffff - cia1.tb;
}

void nothing(void) { }

int main(void)
{
    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; COLOUR[i] = 1; }
    vic.color_back = 0; vic.color_border = 0;
    __asm { sei }

    build_tables();

    unsigned cs = 0, miss = 0;
    mul_a = 0;
    do {
        mul_b = 0;
        do {
            qmul();
            if (mul_r != (unsigned)mul_a * mul_b) miss++;
            cs = fold(cs, mul_r);
        } while (++mul_b);
    } while (++mul_a);
    put_str(0, 0, "mul cs      exp      miss");
    put_hex(0, 7, cs); put_hex(0, 16, EXPECT_MUL); put_dec(0, 26, miss);
    bool ok = (cs == EXPECT_MUL) && miss == 0;

    cs = 0; miss = 0;
    unsigned i = 0;
    do {
        unsigned j = 0;
        do {
            add_a = i * 0x101; add_b = j * 0x101; fpadd();
            if (add_r != add_a + add_b) miss++;
            cs = fold(cs, add_r);
        } while (++j < 256);
    } while (++i < 256);
    put_str(1, 0, "add cs      exp      miss");
    put_hex(1, 7, cs); put_hex(1, 16, EXPECT_ADD); put_dec(1, 26, miss);
    ok = ok && (cs == EXPECT_ADD) && miss == 0;

    vic.ctrl1 = 0x0b;             // DEN off: no badlines while timing
    vic_waitFrame();
    unsigned t0 = time_loop(nothing);
    unsigned tm = time_loop(qmul);
    unsigned ta = time_loop(fpadd);
    vic.ctrl1 = 0x1b;
    put_str(3, 0, "cyc x100 empty       mul       add");
    put_dec(3, 15, t0); put_dec(3, 25, tm); put_dec(3, 35, ta);

    put_str(5, 0, ok ? "pass" : "fail");
    vic.color_border = ok ? 5 : 2;
    for (;;)
        ;
    return 0;
}
```

The Python side of the checksum:

```python
def fold(cs, r):
    cs = ((cs << 1) | (cs >> 15)) & 0xFFFF
    cs ^= r & 0xFFFF
    return (cs + 0x0D) & 0xFFFF

cs = 0
for a in range(256):
    for b in range(256):
        cs = fold(cs, a * b)          # -> 0x0F09
cs = 0
for i in range(256):
    for j in range(256):
        cs = fold(cs, (i * 0x101 + j * 0x101) & 0xFFFF)   # -> 0x8AA1
```

A plain rotate-and-xor fold was tried first and gave `0x0000` for the
add sweep: the domain is symmetric in `i` and `j` and the xor cancelled.
The `+ 13` breaks that. sim6502 was not used; `dotnet` runs on the
machine but the harness above answers the question in one VICE run and
its result is a screen the character ROM can decode.

## lfsr_random — Linear-feedback shift register random numbers

**Complexity:** low
**Region:** both
**Uses registers:** D41B, D412, D40E, D40F, D418, DC04, DC05, DC0E
**Cost:** cycles_per_frame=14, bytes_code=1947
**Cost basis:** arithmetic
**Claims:** sid_voice_3 (init), sid_voice_3_readback (init), sid_filter_volume (init), cia1_timer_a (reads)
**Claims basis:** derived-listing

### Why

A game needs cheap pseudo-random bytes for spawn positions, noise
pixels and starfields, and it needs the sequence to differ from one
play to the next. A linear-feedback shift register (LFSR) gives the
bytes in a dozen cycles with no table. The seed is what makes each game
different, and the C64 has three sources for it: SID voice 3 noise, a
CIA timer, and the moment the player first touches the controls.

### How

Galois form, shifting right. Shift the state right one bit; if the bit
that fell out was 1, XOR the tap mask into the state. The state after
each step is the output.

- 8-bit: taps `$B8` (x^8 + x^6 + x^5 + x^4 + 1). Period measured at 255
  from the three seeds the recipes ran (`$9219`, `$7A80`, `$BEEF`): the
  recipe walks the full cycle from its live seed and counts (rung 1,
  VICE x64sc 3.10). The full-cycle argument below covers the rest.
- 16-bit: taps `$B400` (x^16 + x^14 + x^13 + x^11 + 1). Period measured
  at 65535 the same way (rung 1).

```
step8:      lda s8          step16:     lsr s16+1
            lsr                         ror s16
            bcc +                       bcc +
            eor #$b8                    lda s16+1
+           sta s8                      eor #$b4
                                        sta s16+1
                                    +
```

Seeding from SID voice 3. Write `$FFFF` to voice 3's frequency
(`$D40E/$D40F`), gate the noise waveform (`$D412 = $81`), and set bit 7
of `$D418` (3OFF) so voice 3 is silent while the volume nibble a music
player owns is left alone; a game ORs the bit into its own `$D418`
shadow rather than storing a fresh value. Then read `$D41B` twice, a
few thousand cycles apart (the recipe calls an empty function 100 times
between the reads, about 3,700 cycles by its own timing figure of 9,476
cycles for 256 calls), for a 16-bit seed. In the recipe 255 of 255
consecutive `$D41B` read pairs differed (rung 1), the reads a C loop
iteration apart, so the register is moving at every read. In a headless
VICE run the two reads land on the same values every time (the seed was
`$9219` on PAL in every run, `$7A80` on NTSC), because the emulator's
noise register starts from a fixed state and the program runs the same
number of cycles to the read; that the seed varies on a real machine,
where power-on state and load timing differ, is not measured here
(rung 4). The seed is the noise register's state, not a clock, so it is
only as unpredictable as the time between power-on and the read.

Seeding from a CIA timer. `$DC04/$DC05` is CIA1 timer A, which the
KERNAL leaves free-running for its jiffy interrupt. Read it as a 16-bit
value and XOR it into the seed. Read at a fixed point after boot it is
as reproducible as the SID read (the recipe prints `$251C` on PAL every
run); read at a moment the player chose it is a good seed.

Seeding from player input. Step the LFSR once per frame, or count
frames, while the title screen waits for the first fire press
(`joystick_edge_detect` in `techniques/input.md` gives the press). The
count of frames the player took is the seed, and the timer read at that
moment adds sixteen bits of sub-frame phase. The recipe cannot show this
because a headless run has no player; the text here is the design, not
a measurement.

The all-zero state. A Galois LFSR maps state 0 to state 0: nothing falls
out, nothing is XORed in, and every output is zero for ever. Check the
seed and replace zero with a constant before the first step (the recipe
uses `$ACE1`, and `$01` for the 8-bit register when its byte is zero).
Two `$D41B` reads are both `$00` rarely, but the check costs four
instructions and the failure is a game that never varies again. See the
pitfall `lfsr_zero_state_lockup` in `pitfalls/cpu.md`.

### Why it works

The tap mask is a primitive polynomial over GF(2), so the shift-and-XOR
map is a permutation of the 2^n - 1 non-zero states in one cycle. That
is why the period is 255 and 65535 exactly and why a byte histogram over
one period is flat. The recipe counts the low byte of every 16-bit state
over the full period: each value 256 times, except `$00` 255 times,
because state `$0000` is the one that is never visited (rung 1; the
same figures come from the Python model). For the 8-bit register the
same argument gives every non-zero byte once and zero never.

A flat histogram is not independence. Successive states of a
right-shifting register are the previous state shifted right with the
taps folded into a few high bits, so the low byte of state n+1 is the
low byte of state n shifted right with one new bit at the top. The
recipe's first bytes show it: `86 43 A1 D0 E8 74 3A` is a right shift
each step. For a byte a player could not guess by eye, take the high
byte XOR the low byte, or step the register eight times per byte at
eight times the cost. Noise pixels and spawn tables do not care; the
recipe's mosaic paints the low nibble directly and every one of the 16
colours lands between 43 and 53 times over 760 cells (measured off the
PAL screenshot).

The SID noise source is itself a 23-bit LFSR clocked by voice 3's
oscillator; `hardware/sid-reference.md` (`$D41B`) has its readback
rules, including that a held TEST bit drifts it to all ones and never to
zero. `hardware/c64-registers-reference.md` lists the voice 3 and CIA
registers.

### Variations

- 8-bit only: the whole state is the byte, 13 to 14 cycles a step, 255
  bytes before repeating; enough for a starfield, not for a level
  generator.
- Fibonacci form (XOR several state bits into the new bit) gives the same
  sequences at a higher cost; on the 6510 the Galois form is the one to
  use because the feedback is a single `eor`.
- Step several times per read, or XOR two registers of coprime period,
  when the shift structure of consecutive bytes would show.

### Cycle budget

Measured with CIA1 timer A in the recipe: force-load `$FFFF`, 256 calls
through a function pointer, read the count, with DEN clear so no badline
interrupts the count (rung 1). Empty loop 9,476 cycles; 8-bit step
12,933; 16-bit step 14,441. Per step: 13.5 cycles for the 8-bit register
(13 without the tap, 14 with, absolute addressing) and 19.4 for the
16-bit one (15 without, 24 with; half the steps take the tap). In zero
page the same sequences cost 11 to 12 and 13 to 20 (rung 3, from the
instruction table, not measured).

### Recipes

- `recipes/oscar64/lfsr-random.md` — seed from `$D41B`, mosaic, period,
  checksum and histogram self-check, timing.
- `recipes/oscar64/lfsr-random-seed2.md` — the same listing with a
  fixed seed, to show a different seed gives a different picture.

The checksum fold in those pages is `chk = ((chk ^ value) * 5 + 1) &
0xFFFF`, folded from state 1 round the whole cycle so the expected
value does not depend on the live seed; it is not the rotate fold used
by `fpcheck.c` above.

## compare_16bit_and_signed — 16-bit, signed and ranged compares

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Cost:** cycles_per_frame=20
**Cost basis:** measured-vice

### Why

`CMP` compares one unsigned byte. A tile collision compares a 16-bit
world coordinate against a boundary, a fixed-point mover compares a
signed velocity against a limit, and a bounds check asks whether a
value lies inside a range. Each needs a sequence of instructions and a
particular flag read afterwards, and the obvious sequences are wrong
at the edges: a bare `BMI` after a subtract gives the wrong answer for
one pair in four. Every flag and cycle figure below was measured in
VICE x64sc 3.10 by `recipes/kickassembler/compare-16bit-signed.md`,
which prints the flags on the boundary pairs and checks every idiom
over full sweeps against a Python model.

### How

**Unsigned 16-bit.** Compare the high bytes; if they differ they decide,
otherwise compare the low bytes:

```asm
        lda a_hi
        cmp b_hi
        bne done          // high bytes differ: their flags are the answer
        lda a_lo
        cmp b_lo          // high bytes equal: the low bytes decide
done:                     // C clear: a < b.  C set: a >= b.  Z set: a == b
```

After the first `CMP`, `C` set means `a_hi >= b_hi` and `Z` set means
the high bytes are equal. `BNE` skips the low bytes when they are not.
At `done`, `Z` can only be set by the low-byte `CMP` after the high
bytes matched, so it means the whole words are equal. `$0100` against
`$00FF` ends with `C` set and `Z` clear from the first `CMP` alone;
`$00FF` against `$0100` ends with `N` set and `C` clear. For "`a > b`"
test `C` set and `Z` clear; for "`a <= b`" swap the operands.

**Signed 8-bit.** Subtract, then correct the sign when the subtract
overflowed:

```asm
        lda a
        sec
        sbc b
        bvc ok            // V clear: N is the sign of a - b
        eor #$80          // V set: the sign wrapped, flip it back
ok:                       // N set: a < b (signed).  N clear: a >= b
```

Measured flags on the boundary pairs (`N V Z C`, `.` for clear):

| a | b | after `SBC` | after fix-up | idiom says | bare `BMI` says | truth |
|---|---|---|---|---|---|---|
| `$80` (-128) | `$7F` (127) | `. V . C` | `N V . C` | less | not less | less |
| `$7F` (127) | `$80` (-128) | `N V . .` | `. V . .` | not less | less | not less |
| `$00` | `$00` | `. . Z C` | `. . Z C` | not less | not less | not less |
| `$FF` (-1) | `$00` | `N . . C` | `N . . C` | less | less | less |
| `$00` | `$FF` (-1) | `. . . .` | `. . . .` | not less | not less | not less |
| `$80` | `$80` | `. . Z C` | `. . Z C` | not less | not less | not less |
| `$7F` | `$7F` | `. . Z C` | `. . Z C` | not less | not less | not less |
| `$9C` (-100) | `$64` (100) | `. V . C` | `N V . C` | less | not less | less |

`-128 - 127` is `-255`, which does not fit in a byte; the byte result is
`$01`, `N` clear, and `V` set says so. `EOR #$80` makes it `$81` and
`EOR` sets `N` from its result, so `N` is the true sign. The bare `BMI`
is wrong on exactly the rows where `V` is set. Over all 65,536 pairs it
disagrees with the corrected form on 16,384, one quarter (measured;
the Python model gives the same count). A value that never crosses
the overflow boundary hides the fault: two positions within 127 of
each other compare correctly either way, and the bug appears the first
time a velocity or an offset is large and of the other sign.

**Signed 16-bit.** Set the borrow from the low bytes with `CMP`, then
subtract the high bytes and apply the same fix-up:

```asm
        lda a_lo
        cmp b_lo          // C = no borrow from the low bytes
        lda a_hi
        sbc b_hi
        bvc ok
        eor #$80
ok:                       // N set: a < b (signed)
```

Measured on the boundary pairs: `$7FFF` against `$8000` ends `. V . .`
with `N` clear (32,767 is not less than -32,768) where the unsigned
form ends `N . . .` with `C` clear (as unsigned, `$7FFF` is less);
`$8000` against `$7FFF` ends `N V . C`, less, where the unsigned form
says not less; equal values end `. . Z C` in both forms; `$0000`
against `$FFFF` ends `. . Z .`, not less, and shows that `Z` at the end
of the signed form is the high byte's alone, not equality. Test equality
with the unsigned form.

**Ranged, unsigned 8-bit.** Is `x` in `[lo, lo + w)`:

```asm
        lda x
        sec
        sbc lo
        cmp w             // C clear: inside.  C set: outside
```

`x - lo` modulo 256 is below `w` exactly when `lo <= x < lo + w`, as
long as `lo + w` does not exceed 256: an `x` below `lo` wraps to at
least `256 - lo`, which is at least `w`. One `BCC inside` acts on it.
Measured over every `x` against every `lo` with `w = 32` (clamped near
the top): matches the model. The two-compare form, `cmp lo / bcc out /
cmp hi / bcs out`, needs no width and no wrap condition, and is the
one to use when `hi` is what you hold.

### Why it works

`CMP` is a subtract that discards the result and does not touch `V`
(measured: the flag column after `CMP` alone shows the `V` the previous
instruction left, which is why the recipe clears it first). It sets `C`
when no borrow was needed, that is when `A >= operand` unsigned, and `Z`
when the two are equal; `N` after `CMP` is bit 7 of a discarded
difference and means nothing about order. `SBC` keeps the result and
does set `V`: the two's complement sign of `a - b` is the order only
when the difference fits in seven bits plus sign, and `V` is the
report that it did not. Flipping bit 7 when `V` is set restores the
sign because overflow in either direction flips it exactly once.

### The C compiler's view

Oscar64 (`-O2`, read from its `.asm` listing; the four functions were
marked `__noinline` so they stayed separate, since `-O2` had inlined
them into `main` and dropped three whose result was overwritten)
emits the same high-byte-first `CMP / BNE / CMP` chain for `unsigned
int` and turns the carry into a value with `LDA #0 / ROL / EOR #1`. For
`int` it uses the chain too, but when the high bytes differ it does not
use `SBC` and `V`: it exclusive-ors the two high bytes and tests the
sign of that. If the signs agree (`BPL`) the unsigned carry is the
answer; if they differ the negative one is the smaller, and the carry
from the unsigned compare already says which is negative. For `signed
char` it emits `CMP / BEQ / EOR b / BCC / BMI`, the same sign-agreement
test. For `x >= lo && x < hi` on `unsigned char` it emits `CMP lo / BCS
/ CMP hi` with the `LDA #0 / ROL / EOR #1` tail. A C `int` compare is
correct at the boundary; what costs is the value it materialises when
all you wanted was a branch, and `-O2` folds that away when the result
feeds an `if`.

### Variations

- **Three-byte and 16.8 compares** extend the unsigned chain one byte
  from the top, or carry the `CMP` borrow through two `SBC`s for the
  signed form (rung 3, not measured here).
- **Signed against a constant** needs no `SBC`: `lda v / cmp #lim` is
  correct when both are in the same half, and `eor #$80` on both sides
  (`lda v / eor #$80 / cmp #(lim ^ $80)`) turns any signed compare
  into an unsigned one, the trick the Oscar64 `signed char` code is
  a variant of.
- **Equality only** is `lda a_lo / cmp b_lo / bne no / lda a_hi / cmp
  b_hi / bne no`; the order of bytes does not matter for it.

### Cycle budget

One call, operands absolute, no result branch, net of an empty
`JSR / RTS`, identical on PAL and NTSC:

| Idiom | Cycles |
|---|---|
| unsigned 16-bit, high bytes differ | 11 |
| unsigned 16-bit, high bytes equal | 18 |
| signed 8-bit | 13 (no overflow) / 14 (overflow) |
| signed 16-bit | 19 (no overflow) / 20 (overflow) |
| range test | 14 |

Each equals its instruction-table sum. The two signed rows depend on
the path: when the subtract does not overflow the `BVC` is taken for 3
and the `EOR` is skipped; when it does, the `BVC` falls through for 2
and the `EOR #$80` costs 2 more. The recipe times the overflow pairs,
so its screen shows 14 and 20. Add the branch that acts on the
result: 2 not taken, 3 taken, 4 taken across a page (`pitfalls/cpu.md`,
`branch_page_cross_extra_cycle`). Zero-page operands save one cycle per
access (rung 3). The `**Cost:**` line carries the signed 16-bit figure,
the worst of the five, as one call per frame.

### Recipes

- `recipes/kickassembler/compare-16bit-signed.md` — every idiom over
  the boundary pairs with flags on screen, full sweeps against a
  Python checksum, the bare `BMI` miss count, and the timings.
