---
recipe: text-window-menu
toolchain: oscar64
output_format: PRG
region: both
techniques: [text_window_and_menu]
file_formats: [PRG]
uses_registers: [D012, D020, D021, DC00, DD04, DD05, DD0E]
uses_kernal: [GETIN]
---

<!-- doc-type: recipe -->

# Oscar64 Text-Mode Window with a Table-Driven Menu

## Synopsis

A pause window opened over a busy text-mode background. Opening it
saves the screen and colour cells under it, draws a box with the PETSCII
line-drawing glyphs and puts a five-item menu inside. The highlight is a
row of colour RAM, moved by joystick 2 or the cursor keys; fire or
RETURN calls the handler in the item's table row. Closing it puts the
saved cells back. The program keeps a copy of the whole screen from
before the open, compares it byte for byte after the close, times the
open and the close on CIA 2 timer A, and reports the verdict three ways:
`$02FF` (`01` pass, `02` fail), the border colour, and three rows of
text. By default a script drives the joystick (down, down, fire), so a
headless run picks the third item; built with `-dAUTOPILOT=0` it reads
the real port and was driven with the cursor keys through `-keybuf`.

## Source

```c
// text-window-menu.c
//
// A text-mode window over a busy background. Opening it saves the screen
// and colour cells under it, draws a PETSCII box with the line-drawing
// glyphs and a five-item table-driven menu inside; the highlight is moved
// by joystick 2 (up, down) or the cursor keys, and fire or RETURN picks the
// item. Closing it restores the saved cells. The program keeps a copy of
// the whole screen taken before the window opened and compares it byte for
// byte after the close, times the open, each menu step and the close on
// CIA 2 timer A, and reports
// the verdict at $02FF (01 pass, 02 fail), in the border colour and on the
// bottom rows.
//
// AUTOPILOT=1 (the default) replaces the joystick read with a script:
// down, down, fire, so the expected selection is item 3. Build with
// -dAUTOPILOT=0 to read the real port and drive it with the cursor keys.
//
// Build: oscar64 -tm=c64 -O2 -o=text-window-menu.prg text-window-menu.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <conio.h>

#ifndef AUTOPILOT
#define AUTOPILOT 1
#endif

#define Screen ((char *)0x0400)
#define Color  ((char *)0xD800)
#define COLS   40
#define ROWS   25
#define CELLS  (COLS * ROWS)

#define RESULT     (*(volatile char *)0x02ff)
#define CODE_PASS  0x01
#define CODE_FAIL  0x02

// The window: outer frame position and size, in cells.
#define WIN_X  10
#define WIN_Y   7
#define WIN_W  20
#define WIN_H   9
#define WIN_CELLS (WIN_W * WIN_H)

// Box glyphs as screen codes: PETSCII $B0 $AE $AD $BD less $40, $C0 $DD less $80.
#define GL_TL  0x70
#define GL_TR  0x6E
#define GL_BL  0x6D
#define GL_BR  0x7D
#define GL_H   0x40
#define GL_V   0x5D

#define WIN_INK   VCOL_WHITE
#define WIN_HILITE VCOL_YELLOW
#define WIN_FRAME VCOL_LT_BLUE

#define EXPECTED_ITEM 2          // third item, 0-based

// Joystick bits, active low in $DC00.
#define JOY_UP    0x01
#define JOY_DOWN  0x02
#define JOY_FIRE  0x10
#define JOY_MASK  0x1f

// ------------------------------------------------------------ menu table

typedef void (*Handler)(void);

static char picked = 0xff;

static void act_resume(void)  { picked = 0; }
static void act_restart(void) { picked = 1; }
static void act_sound(void)   { picked = 2; }
static void act_options(void) { picked = 3; }
static void act_quit(void)    { picked = 4; }

struct MenuItem {
    const char *label;           // screen codes, NUL-terminated
    Handler     handler;
};

#define ITEMS 5
static const struct MenuItem menu[ITEMS] = {
    { S"RESUME GAME",  act_resume  },
    { S"RESTART",      act_restart },
    { S"SOUND ON/OFF", act_sound   },
    { S"OPTIONS",      act_options },
    { S"QUIT",         act_quit    },
};

// -------------------------------------------------------------- buffers

static char under_scr[WIN_CELLS];   // save-under: screen codes
static char under_col[WIN_CELLS];   // save-under: colour nibbles
static char snap_scr[CELLS];        // whole-screen copy taken before open
static char snap_col[CELLS];

static char cursor;                 // highlighted item, 0..ITEMS-1

// --------------------------------------------------------------- timing

static void t_start(void)
{
    cia2.cra = 0x00;                 // stop timer A
    cia2.ta  = 0xffff;               // latch $FFFF
    cia2.cra = 0x11;                 // force load, start, count phi2
}

static unsigned t_stop(void)
{
    cia2.cra = 0x00;                 // stop before the two byte reads
    return 0xffff - cia2.ta;
}

// --------------------------------------------------------------- output

static void put_text(char row, char col, const char *s, char ink)
{
    unsigned o = (unsigned)row * COLS + col;
    while (*s) {
        Screen[o] = *s++;
        Color[o]  = ink;
        o++;
    }
}

static void put_dec(char row, char col, unsigned v, char ink)
{
    char buf[6];
    char n = 0;
    do { buf[n++] = '0' + v % 10; v /= 10; } while (v);
    unsigned o = (unsigned)row * COLS + col;
    while (n) { Screen[o] = buf[--n]; Color[o] = ink; o++; }
}

// ----------------------------------------------------------- background

// A tile pattern: four glyphs and a colour that walks with the cell, so
// every cell under the window differs from its neighbours.
static void draw_background(void)
{
    static const char tile[4] = { 0x66, 0x5B, 0x51, 0x7B };
    unsigned o = 0;
    for (char y = 0; y < ROWS; y++)
        for (char x = 0; x < COLS; x++) {
            Screen[o] = tile[(x + y) & 3];
            Color[o]  = (x * 3 + y * 5) & 15;
            o++;
        }
}

static void snapshot(void)
{
    for (unsigned i = 0; i < CELLS; i++) {
        snap_scr[i] = Screen[i];
        snap_col[i] = Color[i] & 15;
    }
}

static bool snapshot_matches(void)
{
    for (unsigned i = 0; i < CELLS; i++)
        if (snap_scr[i] != Screen[i] || snap_col[i] != (Color[i] & 15))
            return false;
    return true;
}

// --------------------------------------------------------------- window

static void highlight(char item, char ink)
{
    unsigned o = (unsigned)(WIN_Y + 2 + item) * COLS + WIN_X + 1;
    for (char x = 0; x < WIN_W - 2; x++)
        Color[o + x] = ink;
}

// Save the cells under the window, then draw the frame, the title, the
// items and the highlight.
static void window_open(void)
{
    char *s = Screen + WIN_Y * COLS + WIN_X;
    char *c = Color  + WIN_Y * COLS + WIN_X;
    char *us = under_scr, *uc = under_col;

    for (char y = 0; y < WIN_H; y++) {
        for (char x = 0; x < WIN_W; x++) {
            us[x] = s[x];
            uc[x] = c[x];
            s[x] = 0x20;
            c[x] = WIN_INK;
        }
        s[0] = GL_V;  s[WIN_W - 1] = GL_V;
        c[0] = WIN_FRAME; c[WIN_W - 1] = WIN_FRAME;
        us += WIN_W; uc += WIN_W;
        s += COLS; c += COLS;
    }

    s = Screen + WIN_Y * COLS + WIN_X;
    c = Color  + WIN_Y * COLS + WIN_X;
    char *b = s + (WIN_H - 1) * COLS;
    char *bc = c + (WIN_H - 1) * COLS;
    for (char x = 1; x < WIN_W - 1; x++) {
        s[x] = GL_H; b[x] = GL_H;
        c[x] = WIN_FRAME; bc[x] = WIN_FRAME;
    }
    s[0] = GL_TL; s[WIN_W - 1] = GL_TR;
    b[0] = GL_BL; b[WIN_W - 1] = GL_BR;
    c[0] = WIN_FRAME; c[WIN_W - 1] = WIN_FRAME;
    bc[0] = WIN_FRAME; bc[WIN_W - 1] = WIN_FRAME;

    put_text(WIN_Y, WIN_X + 6, S" PAUSED ", WIN_INK);
    for (char i = 0; i < ITEMS; i++)
        put_text(WIN_Y + 2 + i, WIN_X + 3, menu[i].label, WIN_INK);
    highlight(cursor, WIN_HILITE);
}

// Put the saved cells back.
static void window_close(void)
{
    char *s = Screen + WIN_Y * COLS + WIN_X;
    char *c = Color  + WIN_Y * COLS + WIN_X;
    const char *us = under_scr, *uc = under_col;

    for (char y = 0; y < WIN_H; y++) {
        for (char x = 0; x < WIN_W; x++) {
            s[x] = us[x];
            c[x] = uc[x];
        }
        us += WIN_W; uc += WIN_W;
        s += COLS; c += COLS;
    }
}

// ---------------------------------------------------------------- input

#if AUTOPILOT
// { frames, port byte } as $DC00 reads it, active low.
static const char script[7][2] = {
    { 40, 0xff }, { 4, 0xfd }, { 30, 0xff }, { 4, 0xfd },
    { 30, 0xff }, { 4, 0xef }, { 30, 0xff }
};
static char ap_index, ap_used;

static char port_read(void)
{
    char out = 0xff;
    if (ap_index < 7) {
        out = script[ap_index][1];
        if (++ap_used == script[ap_index][0]) { ap_used = 0; ap_index++; }
    }
    return out;
}
#else
static char port_read(void)
{
    cia1.pra = 0xff;                 // no keyboard column selected
    return cia1.pra;                 // control port 2, active low
}
#endif

static void wait_frame(void)
{
    while (vic.raster == 250) ;
    while (vic.raster != 250) ;
}

// One step of the menu: returns true when an item has been chosen.
static bool menu_step(char *prev)
{
    char cur = port_read();
    char newp = ~cur & *prev & JOY_MASK;     // pressed now, not pressed before
    *prev = cur;

    char k = getchx();                        // 0 with no key waiting
    if (k == 0x11) newp |= JOY_DOWN;          // cursor down
    if (k == 0x91) newp |= JOY_UP;            // cursor up (shifted)
    if (k == 0x0d || k == 0x0a) newp |= JOY_FIRE;   // RETURN, either code

    if (newp & JOY_DOWN) {
        highlight(cursor, WIN_INK);
        cursor = (cursor + 1 < ITEMS) ? cursor + 1 : 0;
        highlight(cursor, WIN_HILITE);
    } else if (newp & JOY_UP) {
        highlight(cursor, WIN_INK);
        cursor = cursor ? cursor - 1 : ITEMS - 1;
        highlight(cursor, WIN_HILITE);
    }
    if (newp & JOY_FIRE) {
        menu[cursor].handler();
        return true;
    }
    return false;
}

// ----------------------------------------------------------------- main

int main(void)
{
    unsigned t_open, t_close, t_step = 0, t;
    char prev = 0xff;

    vic.color_border = VCOL_BLACK;
    vic.color_back   = VCOL_BLACK;
    draw_background();
    snapshot();

    cursor = 0;
    wait_frame();                    // time from raster line 250 on both models
    __asm { sei }
    t_start();
    window_open();
    t_open = t_stop();
    __asm { cli }

    for (;;) {
        wait_frame();                // time each step from line 250 too
        __asm { sei }
        t_start();
        bool done = menu_step(&prev);
        t = t_stop();
        __asm { cli }
        if (t > t_step) t_step = t;  // keep the worst frame
        if (done)
            break;
    }

    wait_frame();
    __asm { sei }
    t_start();
    window_close();
    t_close = t_stop();
    __asm { cli }

    bool same = snapshot_matches();
    char code = (same && picked == EXPECTED_ITEM) ? CODE_PASS : CODE_FAIL;

    RESULT = code;
    vic.color_border = (code == CODE_PASS) ? VCOL_GREEN : VCOL_RED;

    // Report on the bottom rows, after the compare has been made.
    put_text(22, 0, S"RESTORE ", VCOL_WHITE);
    put_text(22, 8, same ? S"EXACT   " : S"DIFFERS ", VCOL_WHITE);
    put_text(22, 17, S"PICKED ", VCOL_WHITE);
    put_dec(22, 24, picked + 1, VCOL_WHITE);
    put_text(23, 0, S"OPEN  ", VCOL_WHITE);
    put_dec(23, 6, t_open, VCOL_WHITE);
    put_text(23, 12, S"CLOSE ", VCOL_WHITE);
    put_dec(23, 18, t_close, VCOL_WHITE);
    put_text(23, 24, S"STEP ", VCOL_WHITE);
    put_dec(23, 29, t_step, VCOL_WHITE);
    put_text(24, 0, S"RESULT ", VCOL_WHITE);
    put_text(24, 7, code == CODE_PASS ? S"01 PASS " : S"02 FAIL ", VCOL_WHITE);

    for (;;) ;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=text-window-menu.prg text-window-menu.c
```

Produces `text-window-menu.prg`, 2,098 bytes (Oscar64 1.32.271 local
build). `-dAUTOPILOT=0` gives the real-port build, 2,069 bytes.

## Expected output

Pinned command, both models:

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 4250000 [-model ntsc] -exitscreenshot text-window-menu.png \
  -autostart text-window-menu.prg
```

Screenshots: `screenshots/text-window-menu.png` (PAL) and
`screenshots/text-window-menu-ntsc.png`. Both were made twice and the
two files were byte-identical each time.

At 4,250,000 cycles the window is open and the script has pressed down
once, so the picture is:

- black border and background, and every cell of the 40 by 25 screen
  carrying one of four glyphs (screen codes `$66`, `$5B`, `$51`, `$7B`)
  in a colour that walks with the cell;
- the window at columns 10 to 29, rows 7 to 15, its frame in light blue:
  corners `$70`, `$6E`, `$6D`, `$7D`, sides `$5D`, top and bottom `$40`.
  Each of the six frame cells was matched bit for bit against the
  character ROM glyph of its code in both screenshots;
- the title ` PAUSED ` on the top frame row, five labels on rows 9 to
  13 in white, and the second label, `RESTART`, in yellow across the
  window's inner width (columns 11 to 28). The label ink measured by a
  PIL script is white (255, 255, 255) on rows 9, 11, 12 and 13 and
  yellow on row 10: (255, 255, 70) PAL, (255, 248, 141) NTSC.

The screenshot lands inside a 30-frame hold of the script (frames 44 to
74 after the menu starts), so consecutive fields draw the same thing; at
3,500,000 cycles the highlight was still on the first row and at
4,000,000 and 4,500,000 on the second.

An unpinned run at 16,000,000 cycles shows the end state: the
background restored, the border green, and rows 22 to 24 reading

```text
RESTORE EXACT    PICKED 3
OPEN  14916 CLOSE 5759  STEP 833
RESULT 01 PASS
```

on PAL, and `OPEN  15175 CLOSE 5931  STEP 833` on NTSC. The border pixel at
(2, 100) is (98, 213, 50) PAL and (114, 189, 103) NTSC, index 5 in both
palettes. `RESTORE EXACT` is the byte-for-byte compare of 1,000 screen
codes and 1,000 colour nibbles against the copy taken before the open;
`PICKED 3` is the third handler, the one two downs and a fire reach.

The keyboard path was run once, unpinned, PAL, with the
`-dAUTOPILOT=0` build and `-keybuf '\x11\x11\x0d'` (cursor down twice
and RETURN through the KERNAL queue): `RESTORE EXACT PICKED 3`,
`OPEN  14916 CLOSE 5759  STEP 864`, `RESULT 01 PASS`, border green. The
step is 31 cycles more than the script build's because `port_read` there
writes and reads CIA 1 instead of indexing a table. Cursor up (`$91`) is
handled by the same line and was not exercised.

### The three costs

All three figures are CIA 2 timer A counting phi2 with interrupts
disabled, started after a wait for raster line 250, so each timed
section begins at the same place in the frame on every run. They
include the badline stalls the section crosses, which is why two of
them differ between models:

- Step, 833 cycles on both models: the worst frame of the menu loop,
  which is `menu_step` from the port read through `getchx()` to the
  two `highlight` passes of 18 colour writes each on a move. The
  program keeps the largest step of the run, so the figure is the move
  frame; the idle frames and the fire frame do less and were not
  timed separately. From line 250, 833 cycles is about thirteen lines
  (arithmetic), all of them in the lower border or above the display,
  so no badline is inside it and PAL and NTSC agree. This is the
  per-frame cost of the technique while the window is open.
- Close, PAL, 5,759 cycles for 180 cells, 32 cycles a cell. From line
  250 there are 113 lines (250 to 311 and 0 to 50) before the first
  badline on line 51, which is 7,119 cycles at 63 a line (arithmetic),
  so the close finishes with no badline in it and the figure is pure
  CPU. On NTSC the same window is 64 lines at 65 cycles, 4,160 cycles,
  so the last 1,771 cycles of the close cross the display area and the
  figure is 172 higher.
- Open, PAL, 14,916 cycles: the save of 180 cells, the clear, the
  frame, the title, five labels and the highlight. Its last 7,797
  cycles run in the display area, about 124 lines (arithmetic), so
  fifteen or sixteen badlines at 40 to 43 cycles each are inside the
  figure; the CPU work alone is about 14,300 cycles, not measured
  separately.

The first build timed the open from wherever the program happened to be
in the frame and gave 14,880, 14,962 and 15,136 for the same code on
three runs. That spread is badline count, not the routine; the wait for
line 250 removed it.

## Why this works

- **The save-under is sized by the window, not the screen.** `under_scr`
  and `under_col` are `WIN_W * WIN_H` bytes each; the open copies each
  window row from screen and colour RAM before it writes the row, and
  the close copies them back with the same row stride (`COLS` on the
  screen side, `WIN_W` on the buffer side). Nothing else about the
  screen is touched, so the compare against the whole-screen copy
  passes on all 1,000 cells, including the 820 outside the window.
- **Colour RAM is four bits wide.** The RAM at `$D800` stores only a
  low nibble (`hardware/c64-memory-map.md`, "Color RAM (4 bits wide)"),
  so the upper four bits of a read are not the value that was written.
  The snapshot and the compare both mask with `& 15`. Without the mask
  the compare can fail on cells the program never wrote.
- **The box glyphs are screen codes, not PETSCII.** The corner and line
  characters are PETSCII `$B0`, `$AE`, `$AD`, `$BD`, `$C0` and `$DD`;
  stored in screen RAM they must be the screen codes `$70`, `$6E`,
  `$6D`, `$7D`, `$40` and `$5D` (the PETSCII `$A0` to `$BF` corners map
  down by `$40` and the `$C0` to `$DF` bars map down by `$80`;
  `petscii_screen_code_conversion` in
  `techniques/text.md`). The labels use Oscar64's `S"..."` literal,
  which gives screen codes directly; the lowercase `s"..."` prefix
  case-flips first and prints uppercase ASCII as the shifted graphics
  glyphs (`recipes/oscar64/text-overlay-playfield.md`, "Why this
  works").
- **The menu is a table.** `menu[]` holds a label pointer and a handler
  per item; `menu_step` moves `cursor` and, on fire, calls
  `menu[cursor].handler()`. Adding an item is one row and one function.
  The handlers here only record which was called; a game's handlers
  change its state and the caller closes the window afterwards.
- **The highlight is a row of colour RAM.** Moving it writes eighteen
  colour bytes for the old row and eighteen for the new; the screen
  codes do not change. A reverse-video highlight would flip bit 7 of
  the screen codes instead and need its own restore.
- **Joystick and keyboard land in one event byte.** The port read is
  edge-detected against the previous frame's byte
  (`~cur & prev & 0x1F`: pressed now, not pressed before), then
  `getchx()` (GETIN, `$FFE4`) is folded in: PETSCII `$11` is cursor
  down, `$91` cursor up, and RETURN arrives as `$0D` from the KERNAL or
  `$0A` under Oscar64's default character map
  (`pitfalls/kernal-and-io.md`, `getchx_petscii_remaps_return`). The
  menu code below that line does not know which device the event came from.
- **The KERNAL IRQ stays on for the keyboard, off for the timer.** The
  keyboard queue needs SCNKEY, so the IRQ runs during the menu. Each
  timed section (the open, every menu step, the close) does `sei`
  first so that a jiffy interrupt does not land inside the count, and
  `cli` after it, so the interrupt is delayed by the length of the
  section, never lost. They time on CIA 2's timer A, which the KERNAL
  does not use; CIA 1 timer A is the jiffy clock and stopping it would
  stop the keyboard scan.
- **`-keybuf` reaches the program.** VICE feeds the string into the
  KERNAL keyboard queue after the autostart's `RUN`, so the menu's
  `getchx()` reads the three keys once it is polling. That is the same
  route `recipes/oscar64/text-input.md` uses.

The autopilot script, like the one in `recipes/oscar64/headless-verify.md`,
runs each press for four frames and each pause for thirty. Four frames of
a held direction produce one event, because the edge detector fires only
on the frame the bit goes low.
