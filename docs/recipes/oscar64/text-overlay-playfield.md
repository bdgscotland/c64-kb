---
recipe: text-overlay-playfield
toolchain: oscar64
output_format: PRG
region: both
techniques: [text_mode_overlay_render]
file_formats: [PRG]
uses_registers: [D011, D012, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Text-Mode Playfield with a Moving-Piece Overlay

## Synopsis

A 10×20 playfield in text mode, drawn two characters wide per cell, with
one falling tetromino on top of it. The piece is never in the playfield
array: each frame the program repaints the piece's previous cells from
`field[][]` and then draws its current cells, eight cells in all. The whole
field is repainted only at start and when a piece locks. The program measures
both costs itself and prints them on the bottom row in raster lines, next to
a tick counter, so the budget argument in `text_mode_overlay_render` is on
the screen rather than in a comment; the KERNAL's 60 Hz interrupt is
switched off first, so that the two numbers are the paint and the overlay
and nothing else. There is no input and no random number generator: the
piece sequence is fixed, so the screen at any tick is predictable, which is
how the page was verified. Use it as the render shell for a Tetris-,
Sokoban- or board-game-shaped project; the game logic is a stub (spawn,
fall, lock, game over) and is meant to be replaced.

## Source

```c
// text-overlay-playfield.c
//
// A 10x20 text-mode playfield with one falling tetromino drawn as an
// overlay. Each frame repaints only the piece's previous cells (from
// field[][]) and its current cells. The whole field is repainted once at
// start and once per lock. Both costs are measured in raster lines and
// shown on the bottom row, next to a tick counter on the top row. The
// KERNAL's 60 Hz IRQ is switched off first: left running, its service
// routine lands inside the timed paths and adds four or five raster lines
// to whichever number it happens to hit.
//
// Deterministic: fixed piece sequence, no input, no RNG. The screen at any
// tick is predictable, which is how the recipe was verified.
//
// Build: oscar64 -tm=c64 -O2 -o=text-overlay-playfield.prg text-overlay-playfield.c
#include <c64/vic.h>

#define Screen ((char *)0x0400)
#define Color  ((char *)0xD800)
#define COLS   40

#define FIELD_W     10
#define FIELD_H     20
#define FIELD_COL0  10      // screen column of field x = 0; each cell is 2 chars
#define FIELD_ROW0   2      // screen row of field y = 0
#define GRAVITY      8      // ticks (frames) per row of fall
#define LINES_PER_FRAME 312 // PAL 6569; 263 for NTSC 6567R8 (timer display only)

#define ST_PLAY  0
#define ST_OVER  1

// Persistent playfield: 0 = empty, otherwise piece type + 1.
static char field[FIELD_H][FIELD_W];

// Seven tetrominoes, one orientation each: four (dx, dy) pairs in a 4x2 box.
static const char piece_cells[7][8] = {
    { 0,1, 1,1, 2,1, 3,1 },   // I
    { 1,0, 2,0, 1,1, 2,1 },   // O
    { 1,0, 0,1, 1,1, 2,1 },   // T
    { 2,0, 0,1, 1,1, 2,1 },   // L
    { 0,0, 0,1, 1,1, 2,1 },   // J
    { 1,0, 2,0, 0,1, 1,1 },   // S
    { 0,0, 1,0, 1,1, 2,1 },   // Z
};

// Colour per field value; index 0 is the empty cell (a space, colour unused).
static const char piece_color[8] = {
    VCOL_BLACK, VCOL_CYAN, VCOL_YELLOW, VCOL_PURPLE,
    VCOL_ORANGE, VCOL_LT_BLUE, VCOL_GREEN, VCOL_RED
};

// Fixed spawn sequence (type, x), repeated until a piece cannot spawn.
#define SEQ_LEN 8
static const char seq_type[SEQ_LEN] = { 1, 0, 2, 3, 4, 5, 6, 0 };
static const char seq_x[SEQ_LEN]    = { 0, 2, 6, 3, 0, 6, 3, 6 };

// The active piece, and where render_piece last drew it.
static char cur_type, cur_x, cur_y;
static char prev_type, prev_x, prev_y;
static bool have_prev;
static char seq_pos, gravity, state;

static char     tick_digits[5];    // tick counter, shown on row 0
static unsigned paint_lines;       // raster lines the last render_field took

// ----------------------------------------------------------------- timing

// Current raster line, 0..LINES_PER_FRAME-1, from $D012 and RST8 in $D011.
// Re-reads once if RST8 changed between the two reads.
static unsigned raster_line(void)
{
    char hi = vic.ctrl1;
    char lo = vic.raster;
    if ((vic.ctrl1 ^ hi) & VIC_CTRL1_RST8) {
        hi = vic.ctrl1;
        lo = vic.raster;
    }
    return (hi & VIC_CTRL1_RST8) ? 256 + lo : lo;
}

// ---------------------------------------------------------------- drawing

// Paint one field cell (two screen columns) from a field value.
static void paint_cell(char x, char y, char v)
{
    unsigned o = (unsigned)(FIELD_ROW0 + y) * COLS + FIELD_COL0 + 2 * x;
    char code = v ? 0xA0 : 0x20;
    char col  = piece_color[v];
    Screen[o] = code; Screen[o + 1] = code;
    Color[o]  = col;  Color[o + 1]  = col;
}

// Full paint of the persistent field: 200 cells, row pointers. Start and
// lock only. The raster is sampled once per row so a frame wrap during the
// paint is counted instead of folding the result back into 0..311.
static void render_field(void)
{
    char *s = Screen + FIELD_ROW0 * COLS + FIELD_COL0;
    char *c = Color  + FIELD_ROW0 * COLS + FIELD_COL0;
    const char *f = field[0];
    unsigned start = raster_line(), last = start, wraps = 0;

    for (char y = 0; y < FIELD_H; y++) {
        for (char x = 0; x < 2 * FIELD_W; x += 2) {
            char v    = *f++;
            char code = v ? 0xA0 : 0x20;
            char col  = piece_color[v];
            s[x] = code; s[x + 1] = code;
            c[x] = col;  c[x + 1] = col;
        }
        s += COLS; c += COLS;

        unsigned now = raster_line();
        if (now < last)
            wraps++;
        last = now;
    }
    paint_lines = last - start + wraps * LINES_PER_FRAME;
    have_prev = false;      // nothing left on screen that is not in field[][]
}

// Per-frame overlay: erase the previous position from field[][], then
// draw the current one. Eight cells, whatever the field size.
static void render_piece(void)
{
    if (have_prev) {
        const char *q = piece_cells[prev_type];
        for (char i = 0; i < 8; i += 2) {
            char x = prev_x + q[i], y = prev_y + q[i + 1];
            paint_cell(x, y, field[y][x]);
        }
    }
    const char *p = piece_cells[cur_type];
    for (char i = 0; i < 8; i += 2)
        paint_cell(cur_x + p[i], cur_y + p[i + 1], cur_type + 1);
    prev_type = cur_type; prev_x = cur_x; prev_y = cur_y;
    have_prev = true;
}

// White text at (col, row). The S"" prefix makes the literal screen codes;
// with lowercase s the letters come out as the shifted glyphs instead.
static void put_text(char col, char row, const char *s)
{
    unsigned o = (unsigned)row * COLS + col;
    while (*s) {
        Screen[o] = *s++;
        Color[o]  = VCOL_WHITE;
        o++;
    }
}

// Grey walls around the field so the empty cells read as a board.
static void draw_walls(void)
{
    char c0 = FIELD_COL0 - 1, c1 = FIELD_COL0 + 2 * FIELD_W;
    for (char r = FIELD_ROW0; r <= FIELD_ROW0 + FIELD_H; r++) {
        unsigned o = (unsigned)r * COLS;
        if (r == FIELD_ROW0 + FIELD_H) {
            for (char c = c0; c <= c1; c++) { Screen[o + c] = 0xA0; Color[o + c] = VCOL_MED_GREY; }
        } else {
            Screen[o + c0] = 0xA0; Color[o + c0] = VCOL_MED_GREY;
            Screen[o + c1] = 0xA0; Color[o + c1] = VCOL_MED_GREY;
        }
    }
}

// Advance and show the tick counter (row 0, columns 5..9).
static void show_tick(void)
{
    char i = 4;
    while (++tick_digits[i] == 10) {
        tick_digits[i] = 0;
        if (i == 0) break;
        i--;
    }
    for (char d = 0; d < 5; d++)
        Screen[5 + d] = 48 + tick_digits[d];
}

// Decimal digits of n, right-aligned in `width` cells at screen offset o.
static void show_number(unsigned o, char width, unsigned n)
{
    while (width--) {
        Screen[o + width] = 48 + (char)(n % 10);
        n /= 10;
    }
}

#define PAINT_DIGITS   (24 * COLS + 11)     // row 24: "FULL PAINT nnnn LINES"
#define OVERLAY_DIGITS (24 * COLS + 32)     // row 24: "OVERLAY nn LINES"

// ------------------------------------------------------------------- game

static bool fits(char type, char x, char y)
{
    const char *p = piece_cells[type];
    for (char i = 0; i < 8; i += 2) {
        char cy = y + p[i + 1];
        if (cy >= FIELD_H || field[cy][x + p[i]])
            return false;
    }
    return true;
}

static void spawn(void)
{
    cur_type = seq_type[seq_pos];
    cur_x    = seq_x[seq_pos];
    cur_y    = 0;
    gravity  = GRAVITY;
    if (++seq_pos == SEQ_LEN)
        seq_pos = 0;
    if (!fits(cur_type, cur_x, cur_y)) {
        state = ST_OVER;
        put_text(FIELD_COL0 + 5, FIELD_ROW0 + 1, S"GAME OVER");
    }
}

// The piece enters field[][]; that is the one persistent-state change,
// so it is the one place the full paint runs.
static void lock_piece(void)
{
    const char *p = piece_cells[cur_type];
    for (char i = 0; i < 8; i += 2)
        field[cur_y + p[i + 1]][cur_x + p[i]] = cur_type + 1;
    render_field();
    show_number(PAINT_DIGITS, 4, paint_lines);
    spawn();
}

static void tick(void)
{
    if (--gravity)
        return;
    gravity = GRAVITY;
    if (fits(cur_type, cur_x, cur_y + 1))
        cur_y++;
    else
        lock_piece();
}

int main(void)
{
    __asm { sei }                           // KERNAL IRQ off; see "Why this works"
    vic.color_border = VCOL_BLACK;
    vic.color_back   = VCOL_BLACK;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i]  = VCOL_BLACK;
    }
    draw_walls();
    put_text(0, 0, S"TICK 00000");
    put_text(0, 24, S"FULL PAINT ---- LINES");
    put_text(24, 24, S"OVERLAY -- LINES");

    render_field();                         // initial paint of the (empty) field
    show_number(PAINT_DIGITS, 4, paint_lines);
    spawn();

    for (;;) {
        vic_waitFrame();                    // returns when RST8 sets: line 256
        show_tick();
        if (state == ST_PLAY) {
            tick();                         // may lock, repaint, spawn, or end the game
            if (state == ST_PLAY) {         // gate the overlay on the state AFTER tick()
                unsigned t0 = raster_line();
                render_piece();
                show_number(OVERLAY_DIGITS, 2,
                            (raster_line() + LINES_PER_FRAME - t0) % LINES_PER_FRAME);
            }
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=text-overlay-playfield.prg text-overlay-playfield.c
```

Oscar64 build 2026-05-19, zero diagnostics; the PRG is 1,769 bytes. `-O2`
matters for the numbers below: the page's measurements were taken at that
level and nowhere else.

## Expected output

Black border and background. A medium-grey wall in the shape of a U: columns
9 and 30 from screen row 2 to 21, and a floor across columns 9–30 on row 22.
Inside it the playfield, 20 columns by 20 rows, starts empty. Row 0 reads
`TICK nnnnn` in white and counts up once per frame. Row 24 reads
`FULL PAINT 0275 LINES   OVERLAY 33 LINES` until the first lock at tick 152,
`FULL PAINT 0272 LINES` after it, `0273` after the second, third and fourth
locks, and `0277` when the board is full at the end. The overlay figure is
`33` on every frame except the first one and the frame of each lock, which
have no previous position to erase and read `17` (rung 1: a probe build of
this listing that keeps the minimum, the maximum and a histogram of the
overlay figure read, over its first 654 frames, 33 in 649 and 17 in 5, no
other value).

Pieces fall one field row every 8 frames and lock when they cannot fall
further. The sequence is fixed: O (yellow, column 0), I (cyan, column 2),
T (purple, column 6), L (orange, column 3), J (light blue, column 0),
S (green, column 6), Z (red, column 3), I (cyan, column 6), then repeats.
The first lock is at tick 152, the thirtieth at tick 2368; the piece that
should follow it cannot spawn, `GAME OVER` appears in white across field
row 1 (screen row 3, columns 15–23) and the overlay stops. The tick counter
keeps going.

![text-overlay-playfield](screenshots/text-overlay-playfield.png)

The picture is the 16,000,000-cycle capture, tick 654. Verified in VICE
x64sc 3.10 (PAL, 6569), headless, warp, with `+autostart-delay-random`.
That switch is not in the usual invocation and it matters here: without it
three identical runs at `-limitcycles 8000000` read ticks 249, 238 and 240,
because VICE adds a random delay before the autostart `RUN` by default;
with it, three runs read 250, 250, 250. Read the counter, never the cycle
count, to know which frame a capture shows.

Measured (rung 1, script over the PNG, not by eye): every one of the 40×25
cells was decoded by matching its 8×8 block against the glyphs of
`chargen-901225-01.bin`, with the 16 colours taken from a calibration run of
the same VICE build (a PRG that shows the 16 colours as reverse spaces), and
compared with a Python model of this listing run for the number of ticks on
screen. The cell origin was measured too: text row 0 begins at PNG row 35 and
column 0 at x 32, so a cell is the block at `(32 + 8·col, 35 + 8·row)`; the
grey wall's first pixel row is 51 and its first column x 104. The display
window's 200 lines therefore occupy PNG rows 35–234, which is raster 51–250
minus 16, not minus 14; the committed `kickassembler/screenshots/raster-bars.png`
has its window at the same rows. On the 384×247 NTSC capture text row 0
begins at PNG row 23 (raster 51 minus 28), column 0 at the same x 32.

| `-limitcycles` | tick | on screen | locked cells | cells matching the model |
|---|---|---|---|---|
| 5,000,000 | 99 | O (yellow) at field row 12, nothing locked yet; row 24 reads `0275` | 0 | 994 of 994 |
| 8,000,000 | 250 | I (cyan) at field row 12 after one lock (the O) | 4 | 994 of 994 |
| 16,000,000 | 654 | J (light blue) at field row 10 after four locks — the picture above | 16 | 994 of 994 |
| 60,000,000 | 2867 | `GAME OVER`, all nine characters intact, 30 locks — `screenshots/text-overlay-playfield-gameover.png` | 120 | 994 of 994 |
| 8,000,000, `-model ntsc` | 281 | as the 8 M PAL row; row 24 reads `0315` and `81` (see below) — `screenshots/text-overlay-playfield-ntsc.png` | 4 | 994 of 994 |

994 is 1,000 cells minus the six digit cells of the two on-screen
measurements, which are read from the picture rather than modelled. Per
capture the script asserts that (a) the four piece cells are solid `$A0` in
the piece's colour, (b) the cells of the piece's previous position hold
whatever `field[][]` holds there, (c) every locked cell is still on screen,
(d) nothing outside the field differs from the model, (e) every other field
cell is empty, and (f) every cell decodes to a character-ROM glyph. All pass
in all five. A capture that landed mid-frame while the piece moved would
fail (e) or (f); none did, and the piece had not moved on any captured tick
anyway (99, 250, 654 and 281 are not multiples of 8). One capture did land
mid-write: a 16 M NTSC run (tick 745) caught `show_number` between the two
overlay digits and the decoder refused that cell. It is not in the table,
and it is the reason the counter, not the cycle count, names a frame.
(Audit note, 2026-09-22, rung 1: `docs/recipes/runs.json` pins this
recipe at 16,000,000 cycles for *both* models, so `verify-recipes` renders
that same tick-745 NTSC frame — `OVERLAY 8?` with the units digit
half-written — and reports it as differing from the committed NTSC picture,
which is the 8 M capture at tick 281. The PAL arm matches pixel for pixel
at 16 M. Until the NTSC pin is 8,000,000 that mismatch is the pin, not the
listing.)

The two numbers on row 24 (rung 1, read from the same captures):

- `FULL PAINT 0272 LINES` with 4 cells filled, `0273` with 8 to 16, `0277`
  with 120, and `0275` for the empty field painted from `main` before the
  loop starts. At 63 cycles a line that is 17,100–17,450 cycles for 200
  cells, about 86 cycles a cell; badline stalls inside the paint are counted
  in, since this is wall time. (The spread is consistent with the
  `v ? 0xA0 : 0x20` branch costing a cycle more per filled cell, and with
  the first paint starting wherever `main` had got to rather than at line
  256 and so meeting a different number of badlines; neither was measured
  on its own.) It is nearly five times the 56 lines between the RST8 rise
  at line 256 and the wrap, and 2.5 times the 107 lines before the display
  window resumes at raster 51.
- `OVERLAY 33 LINES`, 2,079 cycles, for the eight `paint_cell` calls plus
  the two raster reads that bracket them. `render_piece` alone is 1,998
  cycles on CIA 2's timer A in a probe build; the two reads are the rest.

**Correction.** The first version of this page had no `sei`, and its row-24
figures — `FULL PAINT 0277` at 4 and at 16 cells, `0285` at 120,
`OVERLAY 33` — were the paint plus the KERNAL's interrupt. Oscar64's C64
start-up leaves the 60 Hz IRQ running (the one `sei` in its `crt.c` is under
the NES target, and the assembly it generated for that listing contained
none), and the service routine, four to five raster lines each time, landed
once or twice inside every paint and inside about one overlay in eight: the
same histogram probe with the interrupt on read 33 in 569 of 654 frames, 37
in 12, 17 in 3, and some other value in the remaining 70. The paint figure
also depended on where the interrupt fell — 277 in runs with
`+autostart-delay-random`, 281 in a run without it at tick 244, same lock,
same picture otherwise — and that page's "277 for the empty field" was
wrong twice over: 277 was the 4-cell paint after the first lock, and the
empty-field paint had never been captured (it is 275, tick 99 above). The
cycle figures derived from those numbers (17,450–17,950 cycles, 88 a cell)
were high by the same amount. With the interrupt off nothing else moves:
the 8 M, 16 M and 60 M captures land on the same ticks as before (250, 654,
2867) with the same 994 cells matching, so the lost frame per lock below
never depended on it.

And one number the counter gives for free: between the 8 M and 16 M captures
the emulated C64 ran 8,000,000 cycles, 407.0 PAL frames, and the counter
advanced 404. Three locks lie between those ticks (288, 440, 568), and 10 M
and 12 M captures (ticks 351 and 452) agree: one lock, one lost frame. The
lock frame is well over 312 lines of work counted from line 256: 272 of
paint, 19 for the four-digit display, 17 of overlay and 23 for its own
display come to 331 before the field writes, `spawn` and the wrap
arithmetic, and a probe bracket around the whole frame, with its own
instrumentation inside it, read 371 (each part on CIA 2's timer A in a
probe build). So it runs past line 256 of the following frame and
`vic_waitFrame` waits for the frame after that. The two controls below were measured the same way; their
pictures are in the same directory, and the digits on their row 24
(`OVERLAY 16` and `18`) are those builds' own numbers, not this listing's.

On NTSC (`-model ntsc`, 6567R8, 8,000,000 cycles, the same switches) the
capture is 384×247, the tick is 281, all 994 modelled cells match, and row
24 reads `FULL PAINT 0315 LINES   OVERLAY 81 LINES`. Both are 49 too high,
312 − 263, because `LINES_PER_FRAME` is still 312: the paint wraps once and
the wrap is counted as 312 lines, and the overlay begins after line 256 and
crosses the wrap, so the modulo adds a frame's worth. The true values are
266 and 32 lines — 17,290 and 2,080 cycles at 65 a line, against 17,136 and
2,079 on PAL — and the overlay itself has no region dependence. Set
`LINES_PER_FRAME` to 263 for a build whose display is right on NTSC. The
first version of this page said it had not been run on NTSC; the shipped
build of that version reads `0319` and `81` there, the interrupt inside the
paint again.

## Why this works

### Two passes and one invariant

`render_piece` does what `text_mode_overlay_render` prescribes: pass one
repaints the four cells the piece occupied last frame *from `field[][]`*,
pass two writes `$A0` in the piece's colour at the four cells it occupies
now. Nothing on screen is ever anything but `field[][]` plus the current
piece, and the erase pass needs no memory of what was under the piece
because the field array is that memory. When the piece locks it is written
into `field[][]` and `have_prev` is cleared, so the erase pass is skipped on
that frame and the new piece starts clean. `prev_type` is carried as well as
`prev_x, prev_y` for the general form of the technique, where the shape can
change between frames — a rotation, or a lock that does not repaint — and
erasing the new shape's cells at the old position would leave the old
shape's cells behind. In this listing it is redundant: `cur_type` changes
only in `spawn()`, which is reached only through `render_field()`, which
clears `have_prev`, so whenever the erase pass runs `prev_type == cur_type`.

### Why the full paint is not per frame

`render_field` is the honest cost of "just redraw everything": 272 raster
lines for this loop, which is already the fast form, with row pointers,
unrolled two-column stores and no per-cell multiply. The first draft of this
page routed the 200 cells through `paint_cell` and measured 707 lines, 2.3
frames, and lost two frames at every lock. The generated `paint_cell` is
about 60 instructions — shift-and-add for `(2 + y) × 40`, the `2·x` offset,
four indirect stores — and an opcode tally of the body Oscar64 emitted comes
to 173–175 cycles before the `JSR`/`RTS` and the caller's argument setup
(rung 3, from the rung-1 listing). Measured, it is about 250 cycles a call
as `render_piece` runs it (1,998 cycles for eight) and 707 × 63 / 200 ≈ 220
in that first draft's loop, interrupt included. The first version of this
page said "about 50 instructions, roughly 100 cycles a call", which its own
numbers contradicted. Fine eight times a frame, ruinous two hundred times.
That draft also displayed `83`, because the timer took the difference of two
raster reads modulo 312 and the true value was 83 + 2 × 312. The counter
caught it: the run lost 58 ticks over 29 locks. The `render_field` above
samples the raster after every row and counts the wraps, so its number
cannot alias unless a single row takes a whole frame.

The whole per-frame path — `show_tick`, `tick`, `render_piece` and the
overlay's own number display — measures 57 lines (rung 1: a probe build of
this listing that brackets the loop body instead of the overlay alone, tick
250, same VICE run parameters; 41 on the first frame, whose overlay is the
17-line kind, and up to 63 on some others — every eighth frame `tick` runs
`fits()` and moves the piece, which is the likely extra, not separately
measured). The parts, on CIA 2's timer A in the same
probe: `show_tick` 123 cycles, `tick` 22 on a frame with no move,
`render_piece` 1,998, and the display 1,445 — two raster reads at 57 each,
the two digits at 522, and 809 for the `% LINES_PER_FRAME`, which is a
16-bit division in Oscar64's runtime because 312 does not fit a byte. The
first version of this page gave 43 lines here, which is what the bracket
reads when that modulo falls outside it; the display is a real cost of this
listing and belongs inside. The eight cell writes are done within the first
35 of the 57 lines, inside the 56 between `vic_waitFrame`'s return and the
wrap; the digit arithmetic runs a line past the wrap and stores into row 24
while the beam is in the top border. The display window does not resume
until raster 51, so there are 107 lines of race-free time and the per-frame
work uses 53 % of them. The full paint at 272 lines cannot fit, and that is
the whole point of the technique: the redraw is reserved for the events that
change `field[][]`.

On the lock frame in this listing the paint is invisible: the overlay had
already drawn the piece where it locked, in the same code and colour, so
the 200 writes change nothing on screen. The one-frame stall is the only
symptom. A line clear, which this stub does not implement, would shift the
field and make the paint visible for one frame; the technique page calls
that tear acceptable, and it is, once per clear.

### The three pitfalls, by name

- `dirty_cell_skip_leaves_overlay_trail` — the trail appears whenever the
  cells the piece just left are not rewritten. Here they are rewritten
  unconditionally by the erase pass, from the field array. The control
  build with that pass deleted (`if (false)` in place of `if (have_prev)`)
  shows, at tick 250, the cyan I piece smeared over its twelve previous
  rows: 96 cells differ from the correct model, and zero differ from a
  model with the erase pass removed. Picture:
  `screenshots/text-overlay-playfield-notrail-control.png`.
- `render_during_state_transition_clobbers_banner` — `tick()` can flip
  `state` to `ST_OVER` and draw the banner in the same iteration; the
  overlay is gated on `state` *after* `tick()` returns, so the frame that
  ends the game draws nothing over the banner. The control build with that
  inner `if` removed paints the un-spawnable red Z over the banner on that
  one frame: four of the nine characters (`E OV`) become red cells and stay
  that way, since nothing repaints them, and the piece's upper two cells
  land on four empty cells of field row 0 above them — eight cells differ
  from the correct model, zero from a model with the gate removed. Picture:
  `screenshots/text-overlay-playfield-ungated-control.png`.
- `full_field_redraw_exceeds_vblank` — measured above: 272 lines against a
  56-line blank, one lost frame per lock even with the paint at its
  fastest. Call `render_field` per frame and every frame is that frame.
  The technique page's figure of about 18,400 cycles for this size of
  field came from a different program; this listing's 17,100–17,450 is
  the same number by a different instrument.

### Oscar64 details that cost time

- The KERNAL's IRQ is live in an Oscar64 program until you stop it. The
  C64 start-up in `crt.c` never executes `sei` (its one `sei` is under
  `OSCAR_TARGET_NES`), so without the `__asm { sei }` at the top of `main`
  the 60 Hz service routine — four to five raster lines each time — lands
  inside anything longer than a frame, and inside a 33-line bracket about
  one time in eight, and a raster-line timer reports it as the cost of
  whatever it interrupted. `__asm { sei }` is the spelling the `sprmux32.c`
  sample uses. A game built on this shell that needs the keyboard reads the
  matrix itself (`<c64/keyboard.h>`, `keyb_poll`) or installs its own
  interrupt; this listing needs neither.
- `% LINES_PER_FRAME` on an `unsigned` costs about 810 cycles, thirteen
  raster lines (rung 1, CIA 2 timer A): 312 does not fit a byte, so the
  expression goes through the runtime's 16-by-16-bit `divmod` loop. The
  two-digit `show_number` is 522 cycles by the same route on a smaller
  scale, one `divmod` per digit, and the four-digit one 1,209. None of it
  matters once a frame; all of it would in a loop of two hundred.
- `S"GAME OVER"` gives screen codes 7, 1, 13, 5, 32, 15, 22, 5, 18. The
  lowercase prefix `s"GAME OVER"` does not: it case-flips letters before the
  PETSCII-to-screen-code step, so uppercase ASCII becomes the shifted
  glyphs (`$47, $41, …`, graphics in the default font) and only `s"game
  over"` would give the letters. Capital `S` folds both cases to the
  unshifted letters. That is in the compiler's scanner, and the first build
  of this page printed its labels as graphics glyphs because of it.
- `vic_waitFrame()` from `<c64/vic.h>` spins on bit 7 of `$D011` twice:
  until RST8 is clear, then until it is set. It returns at the start of
  line 256, which is why the per-frame budget above is counted from there.
  `raster_line()` reads `$D011` and `$D012` itself, once more if RST8
  changed between the two reads; that is why those two registers are in
  the frontmatter, and `$D020`/`$D021` because `main` writes them.
- `bool`, `true` and `false` are built in; no `<stdbool.h>` is needed or
  included.
- The `Screen`/`Color` macros and the `Screen[40 * y + x]` idiom are the
  ones the Oscar64 game samples use; they read the same source, not the
  same code.

## Sources

- `docs/techniques/text-mode-render.md` (`text_mode_overlay_render`: the
  two-pass design, the erase-prev/draw-current variant, the frame-budget
  trap) and `docs/pitfalls/text-mode-render.md` (the three pitfalls named
  above), this repository.
- `docs/hardware/vic-ii-reference.md`, this repository, for the 25-row
  display window at raster 51–250 and the RST8 bit.
- Oscar64 (build 2026-05-19): `include/c64/vic.h` and `vic.c` for
  `vic_waitFrame`, `VIC_CTRL1_RST8` and the `vic` struct; `include/crt.c`
  for what the C64 start-up does and does not do about interrupts;
  `include/c64/cia.h` for the `cia2` struct the probe builds timed with;
  `oscar64.md`, section on PETSCII and string prefixes; `oscar64/Scanner.cpp`,
  the string-literal mode switch, for what `s` and `S` do to letter case;
  `samples/games/snake.c` for the screen/colour macro idiom and
  `samples/sprites/sprmux32.c` for `__asm { sei }`, read not copied.
- VICE 3.10, `x64sc -help`, for `+autostart-delay-random` and
  `-model ntsc`; the C64 character ROM `chargen-901225-01.bin` shipped
  with it, for the glyph matching; a 16-colour calibration PRG run in the
  same build for the palette.
- `docs/recipes/oscar64/simple-shmup.md`, this repository, for the recipe
  shape and the `Screen`/`Color` define style.
