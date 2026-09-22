---
recipe: text-input
toolchain: oscar64
output_format: PRG
region: both
techniques: [text_input_line]
file_formats: [PRG]
uses_registers: [D011]
uses_kernal: [GETIN]
---

<!-- doc-type: recipe -->

# Oscar64 Text Input: a name field with echo, DEL, RETURN and a blinking cursor

## Synopsis

Reads a name of up to eight characters through the KERNAL keyboard queue
with Oscar64's `getchx()`, echoes each accepted key into a fixed field as
a screen code, handles DEL and RETURN, drops every key the field does not
allow, and blinks a reverse-video cursor from a frame counter while it
waits. On RETURN it prints the accepted string, its length and a
checksum below the field. The filter is also run over all 256 possible
GETIN bytes and folded into a checksum shown with `PASS` or `FAIL`
against the value Python computed. The headless run types
`A B C DEL D RETURN` through VICE's `-keybuf`, so the picture shows the
field holding `ABD`. Use it for a high-score name, a password prompt or a
save-game name.

## Source

```c
#include <c64/vic.h>
#include <conio.h>

#define SCREEN   ((char *)0x0400)
#define MAXLEN   8
#define FIELD_X  6
#define FIELD_Y  3
#define CELL(i)  SCREEN[FIELD_Y * 40 + FIELD_X + (i)]

static char name[MAXLEN];
static char len;

// ASCII string literal to screen codes, written straight into screen RAM.
static void put_str(char x, char y, const char *s)
{
    char *p = SCREEN + 40 * y + x;
    while (*s) {
        char c = *s++;
        if (c >= 0x41 && c <= 0x5d) c -= 0x40;   // A-Z [ \ ] -> 1..29
        *p++ = c;                                // 0x20..0x3f unchanged
    }
}

static void put_hex(char x, char y, unsigned v)
{
    char *p = SCREEN + 40 * y + x;
    for (char i = 0; i < 4; i++) {
        char n = (v >> 12) & 15;
        p[i] = n < 10 ? 0x30 + n : n - 9;        // 0-9, then A=1..F=6
        v <<= 4;
    }
}

// PETSCII byte from GETIN to the screen code that echoes it,
// or 0 if the key is not accepted. Letters, digits and space only.
static char legal(char k)
{
    if (k >= 0x41 && k <= 0x5a) return k - 0x40;   // A-Z unshifted -> 1..26
    if (k >= 0x30 && k <= 0x39) return k;          // 0-9 -> same code
    if (k == 0x20) return 0x20;                    // space
    return 0;
}

static unsigned fold(unsigned chk, char v)
{
    return ((chk ^ v) * 5 + 1) & 0xffff;
}

int main(void)
{
    clrscr();
    put_str(0, 1, "TEXT INPUT");
    put_str(0, FIELD_Y, "NAME? ");
    CELL(MAXLEN + 1) = 0x1d;                      // ']' after the cursor's cell at the cap

    // Self-check of the filter over every possible GETIN byte.
    unsigned chk = 0;
    for (unsigned k = 0; k < 256; k++)
        chk = fold(chk, legal((char)k));
    put_str(0, 20, "FILTER 0-255 CHK      EXP 566E");
    put_hex(17, 20, chk);
    put_str(31, 20, chk == 0x566e ? "PASS" : "FAIL");

    char frames = 0;
    bool done = false;
    while (!done) {
        vic_waitFrame();
        frames++;
        char k = getchx();                        // GETIN; 0 when the queue is empty
        if (k == 0x0d || k == 0x0a) {             // RETURN: getchx delivers $0A
            done = true;
        } else if (k == 0x14) {                   // DEL
            if (len) {
                CELL(len) = 0x20;                 // take the cursor off the old cell
                len--;
            }
        } else if (k) {
            char sc = legal(k);
            if (sc && len < MAXLEN) {
                name[len] = k;
                CELL(len) = sc;                   // echo as a screen code
                len++;
            }
        }
        // Cursor: reverse the cell after the text on alternate 16-frame halves.
        CELL(len) = (frames & 16) ? 0xa0 : 0x20;
    }
    CELL(len) = 0x20;                             // cursor off once accepted

    put_str(0, 5, "GOT [        ]");
    for (char i = 0; i < len; i++)
        SCREEN[5 * 40 + 5 + i] = legal(name[i]);
    put_str(0, 6, "LEN  ");
    SCREEN[6 * 40 + 4] = 0x30 + len;
    chk = 0;
    for (char i = 0; i < len; i++)
        chk = fold(chk, name[i]);
    put_str(0, 7, "CHK     ");
    put_hex(4, 7, chk);

    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=text-input.prg text-input.c
```

Then run headless with the keys typed into the KERNAL queue (PAL; add
`-model ntsc` for NTSC):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -keybuf 'abc\x14d\x0d' -exitscreenshot text-input.png -autostart text-input.prg
```

The `-keybuf` string is quoted for the shell so that VICE sees the
backslashes. Its escape syntax was measured, not read from `-help`
(which says only "Put the specified string into the keyboard buffer"):
a probe that printed every raw GETIN byte, fed `aB\x14c\nd\re\\f\x0dg`
in VICE 3.10, received `41 C2 14 43 0A 44 52 45 5C 46 0D 47`. So a
lower-case ASCII letter arrives as the unshifted PETSCII letter (`a` is
`$41`), an upper-case one as the shifted letter (`B` is `$C2`, which
the filter rejects), `\xHH` is a raw hex byte, `\\` is one backslash,
`\n` delivers `$0A` and not `$0D`, and `\r` is not an escape at all: it
delivered `$52`, the letter `r`, with the backslash dropped. RETURN
therefore has to be typed as `\x0d` and DEL as `\x14`.

## Expected output

`screenshots/text-input.png` (PAL, 8,000,000 cycles) and
`screenshots/text-input-ntsc.png` (NTSC, `-model ntsc`, same cycles and
flags), both read cell by cell against the character ROM. Light blue
text on the default blue screen, the border light blue:

```
TEXT INPUT

NAME? ABD      ]

GOT [ABD     ]
LEN 3
CHK 1A96












FILTER 0-255 CHK 566E EXP 566E PASS
```

Row 3 is the field: `NAME? ` in columns 0 to 5, the eight-cell field in
columns 6 to 13, column 14 left free for the cursor when the field is
full, and `]` in column 15. The typed sequence `a b c DEL d
RETURN` leaves `ABD` in columns 6 to 8; `C` was echoed into column 8 and
then cleared by DEL before `D` took the cell. The cursor cell, column 9
of row 3, is a plain space after RETURN: all 64 of its pixels read the
background colour in both pictures (PAL (44, 61, 236), NTSC
(25, 73, 180)), because the loop writes `$20` over it once RETURN is
accepted. Rows 5 to 7 are the result: the same three characters
re-echoed from the stored PETSCII bytes, the length, and the checksum.

The bracket sits one cell past the cap because the cursor is drawn in
the cell after the last accepted character, which at eight characters is
column 14. An earlier build put `]` in column 14 and the cursor overwrote
it as soon as the field filled. The full field was measured in an
unpinned PAL run with `-keybuf 'abcdefghij\x0d'` at 8,000,000 cycles:
row 3 reads `NAME? ABCDEFGH ]` with the bracket intact in column 15, row
5 `GOT [ABCDEFGH]`, row 6 `LEN 8` and row 7 `CHK 1E70`, so `i` and `j`
were dropped at the cap and `1E70` is the fold over `$41` to `$48`.

`CHK 1A96` is the fold `chk = ((chk ^ byte) * 5 + 1) & 0xFFFF` over the
PETSCII bytes `$41 $42 $44`, and `566E` is the same fold over
`legal(k)` for `k` from 0 to 255. In Python:

```python
def fold(chk, v): return ((chk ^ v) * 5 + 1) & 0xffff
def legal(k):
    if 0x41 <= k <= 0x5a: return k - 0x40
    if 0x30 <= k <= 0x39: return k
    if k == 0x20: return 0x20
    return 0
chk = 0
for b in b'ABD': chk = fold(chk, b)
print(hex(chk))                                  # 0x1a96
chk = 0
for k in range(256): chk = fold(chk, legal(k))
print(hex(chk))                                  # 0x566e
```

The blink itself is not in the pinned picture, because RETURN turns the
cursor off. It was measured in two unpinned PAL runs with `-keybuf 'ab'`
and no RETURN: at 8,000,000 cycles the cursor cell (column 8, row 3)
had all 64 pixels light blue (115, 133, 255), a reversed space; at
8,314,496 cycles, sixteen PAL frames later (16 × 19,656 cycles), all 64
were the background blue. A run that lands on the wrong half of the
blink shows the other state, which is why the pinned run ends with
RETURN.

## Why this works

`getchx()` is Oscar64's non-blocking key fetch: `conio.c` defines `bsin`
as `$FFE4`, GETIN, and returns whatever GETIN put in A, `0` when the
queue at `$0277` is empty. `-keybuf` writes into that same queue, so the
headless run exercises exactly the path a real keypress takes after the
KERNAL's IRQ has scanned the matrix. The loop polls once per frame
behind `vic_waitFrame()`, which waits on bit 7 of `$D011` (raster line
256 and above) to clear and then set, so `frames` advances once per
frame on either model and the cursor's `frames & 16` gives sixteen
frames on, sixteen off.

RETURN is tested as `0x0d || 0x0a` because Oscar64's `convch()` turns
`$0D` into `$0A` under the default `IOCHM_ASCII` map
(`pitfalls/kernal-and-io.md`, `getchx_petscii_remaps_return`); the
program never calls `iocharmap()`, so `$0A` is what arrives. Letters
pass through `convch()` unchanged on that map, which is why `legal()`
can test the PETSCII ranges directly. The echo is a screen-code write:
unshifted letters `$41` to `$5A` become codes `$01` to `$1A`, digits and
space keep their value, and the cursor is a space with bit 7 set
(`$A0`), the reverse-video half of the character set, so no colour RAM
write and no second character set are needed.

DEL clears the cell the cursor occupied before shortening the string;
otherwise a reversed cursor could be left one cell to the right of the
new end. The stored bytes are PETSCII, not screen codes, so the result
lines re-echo them through `legal()`; a real game would write them to a
high-score table or a file in that form. An earlier draft of this
listing wrote the ASCII brackets `[` and `]` (`$5B`, `$5D`) straight
into screen RAM, where they are graphics characters; `put_str` now maps
`$41` to `$5D` down by `$40` so the brackets appear.
