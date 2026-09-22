---
recipe: joystick-input
toolchain: oscar64
output_format: PRG
region: both
techniques: [joystick_edge_detect, joystick_autorepeat, keyboard_matrix_scan]
file_formats: [PRG]
uses_registers: [DC00, DC01, DC02, DC03, D012]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Joystick and Keyboard Input

## Synopsis

Reads control port 2 once per frame with the KERNAL IRQ off, turns the
level byte into new-press and held counts by comparing it with the
previous frame, runs a delayed auto-repeat counter on the RIGHT line, and
scans the keyboard matrix column by column to show whether SPACE is down.
Every value is printed as text so a screenshot proves it. Before the live
loop starts, the edge and repeat routines are run over their whole input
domains on the 6502 and folded into a 16-bit checksum shown with `PASS`
or `FAIL`, and the same fold in Python gives the expected values. Use it
as the input layer of a game that wants press events, held-key repeat and
chords, none of which `GETIN` provides. The techniques are
`joystick_edge_detect`, `joystick_autorepeat` and `keyboard_matrix_scan`
in `techniques/input.md`.

## Source

```c
// joystick-input.c
// Joystick edge detection, delayed auto-repeat and a bare keyboard matrix
// scan, all on CIA1 with the KERNAL IRQ switched off. The live values are
// printed as text every frame, and the edge and repeat routines are run
// over their whole input domain once at start-up and folded into a 16-bit
// checksum shown with PASS or FAIL, so a screenshot proves both.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)      // default text screen

#define JOY_MASK   0x1f              // bits 0-4: up, down, left, right, fire
#define JOY_UP     0x01
#define JOY_DOWN   0x02
#define JOY_LEFT   0x04
#define JOY_RIGHT  0x08
#define JOY_FIRE   0x10

#define REPEAT_DELAY 20              // frames held before the first repeat
#define REPEAT_RATE   4              // frames between repeats after that

// Expected checksums, computed by the same fold in Python (page text).
#define EXPECT_EDGE   0x1800
#define EXPECT_REPEAT 0xD1CC

// Screen codes for the sixteen hex digits: "0".."9", then "A".."F".
static const char hex_glyph[16] = {
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06
};

// --- edge detection ---------------------------------------------------------
// Port bytes are active low: a pressed switch reads 0. Comparing this frame's
// byte against last frame's splits the five lines into new, held and released.
struct JoyEvents { char newp, held, released; };

static void joy_edge(char prev, char cur, struct JoyEvents *e)
{
    char pressed = ~cur & JOY_MASK;
    e->newp     = pressed & prev;            // low now, high last frame
    e->held     = pressed & ~prev & JOY_MASK;// low now, low last frame
    e->released = cur & ~prev & JOY_MASK;    // high now, low last frame
}

// --- auto-repeat -------------------------------------------------------------
// One age counter per direction. Fires on the first frame of a press, again
// after REPEAT_DELAY frames, then every REPEAT_RATE frames while held.
// Returns 1 on a frame that fires.
static char repeat_step(char *age, bool pressed)
{
    if (!pressed) { *age = 0; return 0; }
    char a = *age + 1;
    if (a == REPEAT_DELAY + REPEAT_RATE) a = REPEAT_DELAY;
    *age = a;
    return (a == 1 || a == REPEAT_DELAY) ? 1 : 0;
}

// --- keyboard matrix scan ---------------------------------------------------
// Drive one column of $DC00 low at a time and read the eight rows on $DC01.
// A pressed key in that column pulls its row bit to 0.
static char kb_rows[8];

static void kb_scan(void)
{
    cia1.ddra = 0xff;                        // port A: column drive, output
    cia1.ddrb = 0x00;                        // port B: row read, input
    char col = 0xfe;
    for (char i = 0; i < 8; i++) {
        cia1.pra = col;
        kb_rows[i] = cia1.prb;
        col = (col << 1) | 1;
    }
    cia1.pra = 0xff;                         // no column selected afterwards
}

// --- checksums ---------------------------------------------------------------
static unsigned fold(unsigned crc, unsigned value)
{
    return (crc ^ value) * 5 + 1;
}

static unsigned check_edge(void)
{
    unsigned crc = 0;
    struct JoyEvents e;
    char prev = 0;
    do {
        char cur = 0;
        do {
            joy_edge(prev, cur, &e);
            crc = fold(crc, (unsigned)e.newp | ((unsigned)e.held << 5)
                             | ((unsigned)e.released << 10));
        } while (++cur != 0);
    } while (++prev != 0);
    return crc;
}

static unsigned check_repeat(void)
{
    unsigned crc = 0;
    char start = 0;
    do {
        for (char p = 0; p < 2; p++) {
            char age = start;
            char fire = repeat_step(&age, p != 0);
            crc = fold(crc, (unsigned)age | ((unsigned)fire << 8));
        }
    } while (++start != 0);
    return crc;
}

// --- text output -------------------------------------------------------------
static void put_text(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s) {
        char c = *s++;
        if (c >= 'A' && c <= 'Z') c -= 64;   // ASCII upper case to screen code
        *p++ = c;
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

static void put_dec(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col + 4;
    for (char i = 0; i < 5; i++) {
        *p-- = 0x30 + v % 10;
        v /= 10;
    }
}

static void put_bits(char row, char col, char v)
{
    // Five letters UDLRF; a pressed (low) line shows its letter, else '.'
    static const char name[5] = { 'U' - 64, 'D' - 64, 'L' - 64, 'R' - 64, 'F' - 64 };
    char *p = SCREEN + 40 * row + col;
    for (char i = 0; i < 5; i++)
        p[i] = (v & (1 << i)) ? 0x2e : name[i];
}

static void wait_frame(void)
{
    while (vic.raster == 250) ;
    while (vic.raster != 250) ;
}

int main(void)
{
    __asm { sei }                            // the KERNAL scanner stays out

    for (unsigned i = 0; i < 1000; i++) SCREEN[i] = 0x20;
    vic.color_border = 0;
    vic.color_back = 0;

    put_text(0, 0, "JOYSTICK INPUT  PORT 2 LIVE");
    put_text(2, 0, "RAW $DC00     :      DIRS");
    put_text(3, 0, "NEW PRESSES   :");
    put_text(4, 0, "FIRE HELD FRM :");
    put_text(5, 0, "RIGHT REPEATS :");
    put_text(7, 0, "MATRIX ROW COL7:      SPACE");
    put_text(10, 0, "EDGE CHECK 65536  :");
    put_text(11, 0, "REPEAT CHECK 512  :");
    put_text(13, 0, "FRAMES        :");

    unsigned e = check_edge();
    put_hex16(10, 20, e);
    put_text(10, 26, e == EXPECT_EDGE ? "PASS" : "FAIL");
    unsigned r = check_repeat();
    put_hex16(11, 20, r);
    put_text(11, 26, r == EXPECT_REPEAT ? "PASS" : "FAIL");

    char prev = 0xff;                        // nothing pressed before frame 0
    unsigned presses = 0, repeats = 0, frames = 0;
    char fire_held = 0, right_age = 0;
    struct JoyEvents ev;

    for (;;) {
        wait_frame();
        kb_scan();                           // leaves $DC00 = $FF

        char cur = cia1.pra;                 // port 2, raw byte
        joy_edge(prev, cur, &ev);
        prev = cur;

        char n = ev.newp;
        while (n) { presses += n & 1; n >>= 1; }

        if (!(cur & JOY_FIRE)) { if (fire_held < 255) fire_held++; }
        else fire_held = 0;

        repeats += repeat_step(&right_age, !(cur & JOY_RIGHT));

        put_hex8(2, 16, cur);
        put_bits(2, 27, cur);
        put_dec(3, 16, presses);
        put_dec(4, 16, fire_held);
        put_dec(5, 16, repeats);
        put_hex8(7, 17, kb_rows[7]);
        put_text(7, 29, (kb_rows[7] & 0x10) ? "UP  " : "DOWN");
        put_dec(13, 16, ++frames);
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=joystick-input.prg joystick-input.c
```

Oscar64 build 2026-05-19 produces a 1,721-byte PRG.

Pinned VICE run (both models, `docs/recipes/runs.json`):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 24000000 -exitscreenshot joystick-input.png \
      -autostart joystick-input.prg
```

Add `-model ntsc` for the second picture. 24,000,000 cycles rather than
the default 8,000,000 because the 65,536-case edge check runs before the
live loop starts; at 8,000,000 the screen is still the labels.

## Expected output

Black border, black background, light blue text (the program writes screen
codes only and leaves the colour RAM the KERNAL cleared it with; measured
in the PNG as RGB (115,133,255), VICE's colour 14). With no joystick and no key,
which is all a headless VICE run can hold, the picture is:

```
row  0  JOYSTICK INPUT  PORT 2 LIVE
row  2  RAW $DC00     : FF   DIRS  .....
row  3  NEW PRESSES   : 00000
row  4  FIRE HELD FRM : 00000
row  5  RIGHT REPEATS : 00000
row  7  MATRIX ROW COL7: FF   SPACE  UP
row 10  EDGE CHECK 65536  : 1800  PASS
row 11  REPEAT CHECK 512  : D1CC  PASS
row 13  FRAMES        : 00349
```

`recipes/oscar64/screenshots/joystick-input.png` (PAL, 384 by 272) and
`recipes/oscar64/screenshots/joystick-input-ntsc.png` (NTSC, 384 by 247)
were each produced twice by the pinned command and decoded by matching
every 8 by 8 cell against `chargen-901225-01.bin`; both runs of each
model gave the text above, with the frame count 349 on PAL and 387 on
NTSC (measured in VICE x64sc 3.10, rung 1). The other rows are blank.

What each line proves:

- `RAW $DC00: FF`. All five lines high, nothing pressed. It is `FF` and not
  the `7F` a main-loop read sees under the KERNAL (`pitfalls/input.md`)
  because the matrix scan leaves `$DC00` at `$FF` before the joystick
  read. The five dots are the direction letters U D L R F, each shown only
  while its bit is low.
- `NEW PRESSES 0`, `FIRE HELD FRM 0`, `RIGHT REPEATS 0`. No edge, no hold,
  no repeat in 349 frames with nothing on the port. A stick moved right
  and held for 100 frames would make `RIGHT REPEATS` read 22 (arithmetic
  and the Python model; not measured, VICE cannot hold a joystick
  headless).
- `MATRIX ROW COL7: FF  SPACE UP`. Column 7 driven low, all eight rows
  read high, SPACE (row 4) up. VICE's `-keybuf` feeds the KERNAL queue and
  never touches the matrix, so this run cannot show a key held; the scan's
  logic is the same as Oscar64's `keyb_poll()` and is not otherwise
  verified here.
- `EDGE CHECK 65536: 1800 PASS`. All 65,536 (prev, cur) pairs through
  `joy_edge`, folded by `crc = (crc ^ value) * 5 + 1` in 16 bits, where
  `value = newp | held << 5 | released << 10`. The Python model in the
  technique page's own words gives `1800`.
- `REPEAT CHECK 512: D1CC PASS`. All 256 ages by both levels through
  `repeat_step`, same fold with `value = age | fire << 8`. Python gives
  `D1CC`.

To put presses through `joy_edge` in a headless run, swap the port read
for a scripted byte behind a define, the pattern measured in
`recipes/oscar64/headless-verify.md`, section "Autopilot input".

A first version of the fold rotated the checksum by one bit and XORed the
case in; over the symmetric 65,536-pair domain that cancelled to `0000`, a
checksum that cannot fail. The multiply-and-add fold replaced it before
anything was measured.

## Why this works

`sei` at the top takes the KERNAL's jiffy IRQ out of the picture, so
SCNKEY never writes `$DC00` between the recipe's column write and row read,
and the frame clock is the raster instead: `wait_frame()` waits for
`$D012` to leave 250 and come back, which is once per frame on both
regions. The three counters then advance once per frame, which is what
gives the repeat constants their meaning in frames.

`joy_edge` is the previous-frame comparison. `pressed` is the inverted,
masked byte; `pressed & prev` keeps only lines that are low now and were
high last frame. `prev` starts at `$FF` so a button held from before the
program started is one press, not zero. `repeat_step` is the age counter
with the reset-to-`DELAY` trick that keeps it in a byte and makes the
domain small enough to check completely.

`kb_scan` writes the direction registers itself rather than trusting the
KERNAL's IOINIT values, walks a single 0 bit across `$DC00`, and reads
`$DC01` after each write; `kb_rows[7]` is the column that holds SPACE, so
bit 4 of it is the key. Leaving `$DC00` at `$FF` afterwards means the port
2 read that follows, and any port 1 read a two-player version added, sees
no keyboard column, which is the ordering rule in
`techniques/input.md`. The exhaustive checks use `do { } while (++x != 0)`
on a `char` so the loop covers 0 to 255 without a 16-bit counter; the
same fold in Python, over the same domain, is the oracle the `PASS` is
compared against.
