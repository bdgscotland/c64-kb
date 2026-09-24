---
recipe: gap-buffer-editor
toolchain: oscar64
output_format: PRG
region: both
techniques: [text_editor_gap_buffer_and_refresh]
file_formats: [PRG]
uses_registers: [D020, D021, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 gap-buffer editor core: scripted edits checked against a flat array, keystroke, jump and redraw timed

## Synopsis

The text store of an editor as a gap buffer in a 2 KB array. The program
types a 50-line document, then applies a scripted edit session (insert at
the start, forward delete, an inserted line, backspaces, a line added at
the end) to the gap buffer and to a flat array edited by shifting, and
compares the two texts byte for byte. It then jumps the cursor from the
end of the text to its start, in three ways: the safe byte-at-a-time move,
an ascending block copy of a move shorter than the gap, and an ascending
block copy of the whole jump. CIA1 timers A and B time one keystroke at
the start of the text in each store, the jump, and a redraw of one line
against a redraw of 16 rows. `$02FF` holds `01` and the border is green
when the script leaves the two stores equal, the safe jump and the short
block copy keep them equal and the long block copy does not; else `02`
and red. It implements `text_editor_gap_buffer_and_refresh`
(`techniques/text.md`) and measures `overlapping_copy_wrong_direction`
(`pitfalls/cpu.md`).

## Source

```c
// gap-buffer-editor.c
// The text store of an editor as a gap buffer: the text before the cursor
// at the bottom of a 2 KB array, the text after it at the top, and the
// free space (the gap) between. Typing writes one byte into the gap;
// moving the cursor moves bytes across the gap, one at a time, in the
// direction that cannot overwrite a byte not yet moved. A scripted edit
// session is applied to the gap buffer and, as the reference, to a flat
// array edited with memmove-style shifts; the two texts must be equal.
// The same cursor jump from the end of the text to the start is then made
// in a second gap buffer with an ascending block copy, which overwrites
// its own source once the jump is longer than the gap; a third buffer
// block-copies a move 3 bytes shorter than the gap, which is safe. CIA1 timers A and
// B time: one keystroke at the start of the text in each store, the jump
// to the start, and a redraw of one line against a redraw of the screen.
// $02FF holds 01 and the border is green when the two texts match, the
// safe jump and the short block copy keep them matching and the long
// block copy does not; else 02 and red.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)

#define BUFSZ 2048
#define ROWS 16                       // text rows on screen

struct GB
{
    char    *buf;
    unsigned gs, ge;                  // the gap is buf[gs..ge-1]
};

char store_a[BUFSZ], store_b[BUFSZ], store_c[BUFSZ];
char ref[BUFSZ];                      // the flat-array reference
unsigned ref_len, ref_cur;

// ---- gap buffer -----------------------------------------------------------

static void gb_init(struct GB *g, char *store)
{
    g->buf = store;
    g->gs = 0;
    g->ge = BUFSZ;
}

static unsigned gb_len(const struct GB *g) { return BUFSZ - (g->ge - g->gs); }

__noinline void gb_insert(struct GB *g, char c)
{
    if (g->gs < g->ge)
        g->buf[g->gs++] = c;
}

static void gb_backspace(struct GB *g) { if (g->gs > 0) g->gs--; }
static void gb_delete(struct GB *g) { if (g->ge < BUFSZ) g->ge++; }

// Cursor left: the byte before the gap goes to the top of the gap.
// Highest address first, so a move longer than the gap is still safe.
__noinline void gb_left(struct GB *g, unsigned k)
{
    if (k > g->gs)
        k = g->gs;
    char *s = g->buf + g->gs, *e = g->buf + g->ge;
    g->gs -= k;
    g->ge -= k;
    while (k--)
        *--e = *--s;
}

// Cursor right: the byte after the gap goes to the bottom of the gap.
static void gb_right(struct GB *g, unsigned k)
{
    unsigned after = BUFSZ - g->ge;
    if (k > after)
        k = after;
    char *s = g->buf + g->gs, *e = g->buf + g->ge;
    g->gs += k;
    g->ge += k;
    while (k--)
        *s++ = *e++;
}

// The same left move as one ascending block copy, as a memcpy would do it.
__noinline void gb_left_blockcopy(struct GB *g, unsigned k)
{
    if (k > g->gs)
        k = g->gs;
    const char *s = g->buf + g->gs - k;
    char *d = g->buf + g->ge - k;
    g->gs -= k;
    g->ge -= k;
    while (k--)
        *d++ = *s++;
}

static void gb_goto(struct GB *g, unsigned pos)
{
    if (pos < g->gs)
        gb_left(g, g->gs - pos);
    else
        gb_right(g, pos - g->gs);
}

static char gb_at(const struct GB *g, unsigned i)
{
    return i < g->gs ? g->buf[i] : g->buf[i + (g->ge - g->gs)];
}

// Logical index of the start of line n (0-based), or the length.
static unsigned gb_line(const struct GB *g, char n)
{
    unsigned len = gb_len(g);
    unsigned i = 0;
    while (n && i < len)
    {
        if (gb_at(g, i++) == '\n')
            n--;
    }
    return i;
}

// ---- flat-array reference ---------------------------------------------------

static void ref_insert(char c)
{
    for (unsigned i = ref_len; i > ref_cur; i--)
        ref[i] = ref[i - 1];
    ref[ref_cur++] = c;
    ref_len++;
}

static void ref_backspace(void)
{
    if (!ref_cur)
        return;
    for (unsigned i = ref_cur; i < ref_len; i++)
        ref[i - 1] = ref[i];
    ref_cur--;
    ref_len--;
}

static void ref_delete(void)
{
    if (ref_cur >= ref_len)
        return;
    for (unsigned i = ref_cur + 1; i < ref_len; i++)
        ref[i - 1] = ref[i];
    ref_len--;
}

// ---- both stores, driven by one script ---------------------------------------

struct GB ga, gb2, gb3;

// A second buffer in the same state as ga.
static void clone(struct GB *g, char *store)
{
    for (unsigned i = 0; i < BUFSZ; i++)
        store[i] = ga.buf[i];
    g->buf = store;
    g->gs = ga.gs;
    g->ge = ga.ge;
}

static void type_str(const char *s)
{
    while (*s)
    {
        gb_insert(&ga, *s);
        ref_insert(*s);
        s++;
    }
}

static void go_line(char n, unsigned col)
{
    unsigned p = gb_line(&ga, n) + col;
    gb_goto(&ga, p);
    ref_cur = p;
}

static unsigned compare(const struct GB *g)
{
    unsigned diff = gb_len(g) > ref_len ? gb_len(g) - ref_len : ref_len - gb_len(g);
    unsigned n = ref_len < gb_len(g) ? ref_len : gb_len(g);
    for (unsigned i = 0; i < n; i++)
        if (gb_at(g, i) != ref[i])
            diff++;
    return diff;
}

// ---- display -------------------------------------------------------------

static char screen_code(char c)
{
    if (c >= 'a' && c <= 'z')
        return c - 'a' + 1;
    if (c >= 'A' && c <= 'Z')
        return c - 'A' + 1;
    return c;
}

// Draw one text line from logical index `start` into screen row `row`,
// walking the physical array and stepping over the gap. Returns the
// logical index of the next line.
__noinline unsigned draw_line(const struct GB *g, char row, unsigned start)
{
    char *d = SCREEN + 40 * row;
    unsigned p = start < g->gs ? start : start + (g->ge - g->gs);
    char col = 0;
    unsigned i = start, len = gb_len(g);
    while (i < len)
    {
        if (p == g->gs)
            p = g->ge;
        char c = g->buf[p++];
        i++;
        if (c == '\n')
            break;
        if (col < 40)
            d[col++] = screen_code(c);
    }
    while (col < 40)
        d[col++] = ' ';
    return i;
}

__noinline void draw_all(const struct GB *g)
{
    unsigned i = 0;
    for (char r = 0; r < ROWS; r++)
        i = draw_line(g, r, i);
}

static void put_str(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
        *p++ = screen_code(*s++);
}

static void put_dec(char row, char col, unsigned long v, char width)
{
    char *p = SCREEN + 40 * row + col + width;
    do
    {
        *--p = '0' + (char)(v % 10);
        v /= 10;
    } while (--width);
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
    __asm { sei }
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;

    // A 50-line document, 34 bytes a line: 1,700 bytes in a 2,048 buffer.
    gb_init(&ga, store_a);
    ref_len = ref_cur = 0;
    for (char n = 0; n < 50; n++)
    {
        type_str("line ");
        gb_insert(&ga, '0' + n / 10); ref_insert('0' + n / 10);
        gb_insert(&ga, '0' + n % 10); ref_insert('0' + n % 10);
        type_str(" the quick brown fox jumps\n");
    }
    unsigned doc_len = gb_len(&ga);

    // One keystroke at the very start of the text, timed in each store.
    go_line(0, 0);
    timer_start();
    gb_insert(&ga, '>');
    unsigned long cyc_gap_key = timer_stop();
    timer_start();
    ref_insert('>');
    unsigned long cyc_flat_key = timer_stop();

    // The edit script.
    type_str(" ");
    go_line(2, 5);
    for (char i = 0; i < 3; i++) { gb_delete(&ga); ref_delete(); }
    type_str("edited");
    go_line(4, 0);
    type_str("an inserted line\n");
    go_line(8, 12);
    for (char i = 0; i < 6; i++) { gb_backspace(&ga); ref_backspace(); }
    go_line(60, 0);
    type_str("last line");
    unsigned diff_script = compare(&ga);

    // Copy the state into two more buffers. Block-copy one left by less
    // than the gap and the other to the start; move the first safely.
    clone(&gb2, store_b);
    clone(&gb3, store_c);
    unsigned jump = ga.gs, gap = ga.ge - ga.gs;
    unsigned short_move = gap - 3;
    gb_left_blockcopy(&gb3, short_move);
    unsigned diff_short = compare(&gb3);
    timer_start();
    gb_left(&ga, jump);
    unsigned long cyc_jump = timer_stop();
    ref_cur = 0;
    gb_left_blockcopy(&gb2, jump);
    unsigned diff_safe = compare(&ga);
    unsigned diff_block = compare(&gb2);

    // Refresh: one line against the whole text area.
    timer_start();
    draw_line(&ga, 0, 0);
    unsigned long cyc_line = timer_stop();
    timer_start();
    draw_all(&ga);
    unsigned long cyc_all = timer_stop();

    bool ok = diff_script == 0 && diff_safe == 0 && diff_short == 0 && diff_block > 0;

    put_str(17, 0, "doc      bytes  jump       gap");
    put_dec(17, 4, doc_len, 4);
    put_dec(17, 21, jump, 4);
    put_dec(17, 31, gap, 4);
    put_str(18, 0, "diff script      safe      block");
    put_dec(18, 12, diff_script, 4);
    put_dec(18, 22, diff_safe, 4);
    put_dec(18, 33, diff_block, 4);
    put_str(22, 0, "block copy of      bytes: diff");
    put_dec(22, 14, short_move, 4);
    put_dec(22, 31, diff_short, 4);
    put_str(19, 0, "key at start: gap       flat");
    put_dec(19, 18, cyc_gap_key, 5);
    put_dec(19, 29, cyc_flat_key, 6);
    put_str(20, 0, "jump to start");
    put_dec(20, 14, cyc_jump, 6);
    put_str(21, 0, "draw 1 line       16 lines");
    put_dec(21, 12, cyc_line, 5);
    put_dec(21, 27, cyc_all, 6);
    put_str(23, 0, ok ? "pass" : "fail");
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=gap-buffer-editor.prg gap-buffer-editor.c
```

Run headless. The flat-array reference is slow on purpose, so the run is
pinned at 16,000,000 cycles; at 8,000,000 the PAL run was still printing
its figures and the NTSC run had not drawn the text:

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 16000000 -exitscreenshot gap-buffer-editor.png -autostart gap-buffer-editor.prg
```

Add `-model ntsc` for the NTSC picture. The PRG is 3,852 bytes.

## Expected output

Rows 0 to 15 show the edited text in white on black: row 0 begins
`> line 00`, row 2 reads `line editedthe quick brown fox jumps`, row 4
is `an inserted line`, and row 8 reads `line 0quick brown fox jumps`.
Rows 17 to 23, with a green border. PAL,
`screenshots/gap-buffer-editor.png`:

```
doc 1700 bytes  jump 1725  gap 0323
diff script 0000 safe 0000 block 1239
key at start: gap 00101 flat 085058
jump to start 071522
draw 1 line 05095 16 lines 074594
block copy of 0320 bytes: diff 0000
pass
```

NTSC, `screenshots/gap-buffer-editor-ntsc.png`: the same text and
counts, with `flat 085565`, `jump to start 072097` and `draw 1 line
04880 16 lines 075505`. Read from both screenshots with a PIL decoder
against the character ROM (VICE x64sc 3.10).

## Why this works

A keystroke in the gap buffer is one store and an increment: 101 cycles
on both models, against 85,058 on PAL for the flat array, which shifts
every byte after the cursor up by one. The gap buffer moves bytes only
when the cursor moves, and only as many as the cursor passes: the jump
from the end of the 1,725-byte text to its start is 71,522 cycles on
PAL, about 41 a byte in Oscar64 C, paid once and not per key. The script
leaves the two stores with the same 1,725 bytes, which is the check that
insert, backspace, delete and both moves keep the text in order.

The left move copies downward, highest byte first. The block copy runs
upward. For a move shorter than the gap (320 of 323) the source and the
destination do not overlap and the result is right. For the whole jump
the destination begins 323 bytes above the source, so from the 324th byte
the copy reads bytes it has already written: 1,239 of the 1,725 bytes
differ from the reference.

`draw_line` walks the physical array from a line's first byte, jumps from
`gs` to `ge` when it reaches the gap, stops at the newline and pads the
row. One line is about 5,000 cycles; 16 rows are about 75,000, almost four
PAL frames (arithmetic from 19,656 a frame). Redrawing only the cursor's line after a key is
the saving the technique names.
