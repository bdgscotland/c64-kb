---
recipe: control-config
toolchain: oscar64
output_format: PRG
region: both
techniques: [control_config_screen, keyboard_matrix_scan]
file_formats: [PRG]
uses_registers: [D020, D021, DC00, DC01, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: [GETIN]
---

<!-- doc-type: recipe -->

# Oscar64 controls screen: keys chosen through GETIN, mapped to the matrix, read as an action byte

## Synopsis

A controls screen asks for a key for each of five actions: up, down,
left, right and fire. Keys arrive through the KERNAL queue with `GETIN`.
Each is turned back into its keyboard matrix position with the KERNAL's
own unshifted decode table at `$EB81`, whose index is column times 8
plus row. A key the table does not hold, or one already given to another
action, is refused and the prompt stays. The game then builds its action
byte, in the joystick's bit layout, by scanning only the five chosen
positions with the KERNAL interrupt off. The same decision run against a
synthetic matrix image, with up and fire held, checks the bit layout.
After the scan `$DC00` still selects the last key's column; the program
reads joystick 2 from `$DC00` straight away and again after writing
`$FF` there. CIA1 timers A and B time one scan. VICE's `-keybuf` types
`q`, `a`, `q` again, `o`, `p` and RETURN. `$02FF` holds `01` and the
border is green when the positions are Q, A, O, P and RETURN, one key was
refused, the synthetic matrix gives `$11`, the idle scan gives 0, and the
joystick read shows a phantom that the `$FF` write removes; else `02`
and red. It implements `control_config_screen` (`techniques/input.md`)
and measures `stale_column_select_reads_as_joystick2`
(`pitfalls/input.md`).

## Source

```c
// control-config.c
// A controls screen: the player presses a key for each of five actions
// (up, down, left, right, fire). Keys arrive through the KERNAL queue
// (GETIN); each is turned back into its keyboard matrix position with
// the KERNAL's own unshifted decode table at $EB81 (index = column * 8 +
// row, column = the $DC00 bit, row = the $DC01 bit). A key the table
// does not hold, or one already given to another action, is refused and
// the prompt stays. The game then reads its action byte, in the joystick
// bit layout, by scanning only the five chosen matrix positions with the
// KERNAL interrupt off. After that scan $DC00 still selects the last
// key's column; a joystick-2 read straight from $DC00 sees that column's
// bit as a direction, and a read after writing $FF there does not. CIA1
// timers A and B time one scan. The keys are typed by VICE's -keybuf:
// q, a, q again (refused), o, p, RETURN. $02FF holds 01 and the border is
// green when the five positions are Q, A, O, P and RETURN, one key was
// refused, a synthetic matrix with Q and RETURN held gives $11, the idle
// scan gives 0, and the stale-column joystick read shows the phantom
// that the $FF write removes; else 02 and red.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)
#define DECODE ((const char *)0xeb81)   // KERNAL: matrix index -> PETSCII

// Action bits, the joystick's layout, active high.
#define A_UP    0x01
#define A_DOWN  0x02
#define A_LEFT  0x04
#define A_RIGHT 0x08
#define A_FIRE  0x10

static const char *const action_name[5] = { "up", "down", "left", "right", "fire" };

static char key_col[5], key_row[5];     // the matrix position per action

// ---- screen --------------------------------------------------------------

static char *cur;

static void at(char row, char col) { cur = SCREEN + 40 * row + col; }

static void out(const char *s)
{
    while (*s)
    {
        char c = *s++;
        *cur++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : (c >= 'A' && c <= 'Z') ? c - 'A' + 1 : c;
    }
}

static const char hexd[16] = { '0', '1', '2', '3', '4', '5', '6', '7',
                               '8', '9', 1, 2, 3, 4, 5, 6 };

static void hex2(char v)
{
    *cur++ = hexd[v >> 4];
    *cur++ = hexd[v & 15];
}

static void dec(unsigned long v, char width)
{
    char *e = cur + width, *p = e;
    do
    {
        *--p = '0' + (char)(v % 10);
        v /= 10;
    } while (p > cur);
    cur = e;
}

// A key's name from its PETSCII code: the letter, or RET and SPC.
static void key_name(char k)
{
    if (k == 0x0d)
        out("ret");
    else if (k == 0x20)
        out("spc");
    else
    {
        *cur++ = (k >= 0x41 && k <= 0x5a) ? k - 0x40 : k;
        out("  ");
    }
}

// ---- configuration -----------------------------------------------------------

volatile char got;                      // GETIN's result, stored by the asm

static char getin(void)
{
    __asm volatile {
        jsr $ffe4
        sta got
    }
    return got;
}

// Wait for a key, return its matrix index, or 0xff if the table lacks it.
static char wait_key(char *pet)
{
    char k;
    do
        k = getin();
    while (k == 0);
    *pet = k;
    for (char i = 0; i < 64; i++)
        if (DECODE[i] == k)
            return i;
    return 0xff;
}

static char refused;

static void configure(void)
{
    refused = 0;
    for (char a = 0; a < 5; a++)
    {
        at(2 + a, 0);
        out("press a key for ");
        out(action_name[a]);
        for (;;)
        {
            char pet;
            char idx = wait_key(&pet);
            bool dup = false;
            for (char b = 0; b < a; b++)
                if (key_col[b] * 8 + key_row[b] == idx)
                    dup = true;
            if (idx != 0xff && !dup)
            {
                key_col[a] = idx >> 3;
                key_row[a] = idx & 7;
                at(2 + a, 23);
                key_name(pet);
                out(" col ");
                dec(key_col[a], 1);
                out(" row ");
                dec(key_row[a], 1);
                break;
            }
            refused++;
            at(8, 0);
            out("refused: ");
            key_name(pet);
            out(dup ? " in use" : " unknown");
        }
    }
}

// ---- the game's read -------------------------------------------------------------

// Scan only the five chosen positions: select the column on $DC00 (0 =
// selected), read the row on $DC01 (0 = pressed). $DC00 is left as the
// last column selected.
__noinline char read_actions(void)
{
    char act = 0;
    for (char a = 0; a < 5; a++)
    {
        cia1.pra = ~(1 << key_col[a]);
        if (!(cia1.prb & (1 << key_row[a])))
            act |= 1 << a;
    }
    return act;
}

// The same decision against a matrix image, for a scripted check:
// m[column] holds the $DC01 value that column would give.
static char actions_from_matrix(const char *m)
{
    char act = 0;
    for (char a = 0; a < 5; a++)
        if (!(m[key_col[a]] & (1 << key_row[a])))
            act |= 1 << a;
    return act;
}

static void timer_start(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    cia1.ta = 0xffff;
    cia1.tb = 0xffff;
    cia1.crb = 0x51;
    cia1.cra = 0x11;
}

static unsigned long timer_stop(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    return ((unsigned long)(0xffff - cia1.tb) << 16) + (0xffff - cia1.ta);
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
    at(0, 0);
    out("controls");

    configure();                        // KERNAL interrupt running: GETIN

    __asm { sei }                       // the game owns CIA1 from here
    timer_start();
    char idle = read_actions();
    unsigned long cyc = timer_stop();
    char stale = cia1.pra;              // $DC00 as the scan left it
    char joy_stale = ~cia1.pra & 0x1f;  // joystick 2, read straight away
    cia1.pra = 0xff;
    char joy_clean = ~cia1.pra & 0x1f;  // joystick 2 after deselecting

    char m[8];
    for (char i = 0; i < 8; i++)
        m[i] = 0xff;
    m[key_col[0]] &= ~(1 << key_row[0]);    // up held
    m[key_col[4]] &= ~(1 << key_row[4]);    // fire held
    char held = actions_from_matrix(m);

    at(10, 0);
    out("scan idle $");
    hex2(idle);
    out("  cycles ");
    dec(cyc, 4);
    at(11, 0);
    out("matrix up+fire: $");
    hex2(held);
    at(12, 0);
    out("after scan dc00 $");
    hex2(stale);
    out(" joy2 $");
    hex2(joy_stale);
    at(13, 0);
    out("after dc00=ff     joy2 $");
    hex2(joy_clean);

    bool keys = key_col[0] == 7 && key_row[0] == 6      // Q
             && key_col[1] == 1 && key_row[1] == 2      // A
             && key_col[2] == 4 && key_row[2] == 6      // O
             && key_col[3] == 5 && key_row[3] == 1      // P
             && key_col[4] == 0 && key_row[4] == 1;     // RETURN
    bool ok = keys && refused == 1 && held == (A_UP | A_FIRE) && idle == 0
           && joy_stale != 0 && joy_clean == 0;
    at(15, 0);
    out(ok ? "pass" : "fail");
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=control-config.prg control-config.c
```

Run headless with the keys in the KERNAL queue:

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 -keybuf 'qaqop\x0d' -exitscreenshot control-config.png -autostart control-config.prg
```

Add `-model ntsc` for the NTSC picture. The PRG is 2,003 bytes.

## Expected output

White text on black, green border. PAL,
`screenshots/control-config.png`:

```
controls

press a key for up     q   col 7 row 6
press a key for down   a   col 1 row 2
press a key for left   o   col 4 row 6
press a key for right  p   col 5 row 1
press a key for fire   ret col 0 row 1

refused: q   in use

scan idle $00  cycles 0253
matrix up+fire: $11
after scan dc00 $fe joy2 $01
after dc00=ff     joy2 $00

pass
```

NTSC, `screenshots/control-config-ntsc.png`: the same, with `cycles
0296`. Read from both screenshots with a PIL decoder against the
character ROM (VICE x64sc 3.10).

## Why this works

**From a character to a switch.** `GETIN` hands back PETSCII, not a
matrix position, and a game that steers with keys needs the position so
that it can test the key every frame while it is held. The KERNAL's
decode table does the inverse lookup: the byte at `$EB81 + column * 8 +
row` is the character that switch types unshifted. The ROM bytes give
`$51` (Q) at index 62, column 7 row 6, and `$0D` (RETURN) at index 1,
column 0 row 1, which is what the screen shows. A shifted or Commodore
key gives a character from another table (`$EBC2`, `$EC03`, the pointers
at `$EB79`), which this listing refuses as unknown (from the listing;
no shifted key was typed in this run).

**Duplicates.** The second `q` is refused because its index is already
up's. Two actions on one switch would always fire together.

**The read.** For each action, select the column (its bit low on
`$DC00`) and test the row (its bit on `$DC01`, low when closed). Five
positions take 253 cycles on PAL with the screen on and 296 on NTSC (the
difference was not isolated); `keyboard_matrix_scan` gives 288 for all
eight columns in Oscar64. With no key held the byte is 0; the synthetic
matrix with up and fire held gives `$11`, the joystick layout.

**The phantom.** The last action is fire on RETURN, column 0, so the scan
leaves `$DC00` = `$FE`. Port A's pins are outputs, and reading `$DC00`
returns the level on each pin, so bit 0 reads low whatever the joystick
does: a joystick-2 read there reports UP (`$01` after inverting and
masking). Writing `$FF` first deselects every column and the read is
`$00`. The KERNAL's own scan leaves `$7F`, whose low bit 7 is not a
joystick bit, so after the KERNAL's scan an idle joystick 2 reads clean;
after a scan that ends on columns 0 to 4 it does not.
