---
recipe: wave-director
toolchain: oscar64
output_format: PRG
region: both
techniques: [wave_director, object_pool]
file_formats: [PRG]
uses_registers: [DC04, DC05, DC0E, D000, D001, D010, D011, D012, D015, D020, D021, D027]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 wave director: attack waves keyed to scroll position, with path bytecode

## Synopsis

A scrolling shooter's attack waves, driven by the level's scroll position
and not by a frame count. A scroll counter advances one position a frame on
autopilot, and holds still for 50 frames part-way to show that the waves
wait for it. A list of six wave records, sorted by trigger position, is read
through a cursor. Each record names a path, a count, a spawn spacing in
frames and a formation (start x and x step). Enemies are hardware sprites
in an eight-slot pool. Each runs one of three paths (dive, weave, swoop)
written as a small bytecode: MOVE n steps at (dx, dy), FIRE, LOOP, END. An
enemy leaves when its path ends or it crosses a screen edge; an autopilot
gun column kills what flies through it, and a wave whose enemies were all
killed scores a bonus. After the list the level loops, the cursor resets and
the spawn spacing halves. After 710 frames the program checks every trigger
against the table and against frames computed in Python, folds the slot
table into a checksum that the Python model also computes, prints PASS or
FAIL, and prints the interpreter's cost and a worst frame's, measured with
CIA1 timer A. It
implements `wave_director` (`techniques/logic.md`) on top of `object_pool`.

## Source

```c
// wave-director.c
// Attack waves keyed to scroll position. A level scroll counter advances
// one step a frame on autopilot and stops for 50 frames part-way. A wave
// list sorted by scroll position is read through a cursor; each record
// names a path, a count, a spawn spacing in frames and a formation. Each
// enemy is a hardware sprite that runs a small path bytecode: MOVE n
// steps at (dx, dy), FIRE, LOOP, END. An enemy leaves when its path ends
// or it crosses a screen edge; an autopilot gun column kills what flies
// through it, and a wave whose enemies were all killed earns a bonus.
// After the list the level loops and the spacing halves. The program logs
// each trigger, checks it against the table and a Python model, and times
// the path interpreter with CIA1 timer A.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN  ((char *)0x0400)
#define COLOUR  ((char *)0xd800)
#define SPRDATA ((char *)0x0340)   // sprite block 13
#define SPRPTR  ((char *)0x07f8)

#define NS        8                // enemy slots, one hardware sprite each
#define NWAVES    6
#define LEVEL_LEN 600              // scroll positions per loop of the level
#define STOP0     250              // the scroll holds still for frames
#define STOP1     300              //   STOP0 to STOP1 - 1
#define T_END     710              // frames the game runs before the check
#define Y_ENTRY   30               // spawn line, above the visible screen
#define GUN_X0    140              // autopilot gun column: sprite X 140-163,
#define GUN_X1    164              //   at sprite Y 150 and below
#define GUN_Y     150
#define EXPECT_CHK 0xEB12          // Python fold over the final slot table

// Path bytecode. A byte below $80 is MOVE: that many steps, then signed
// dx and dy per step. The others take no frame.
#define P_END   0x80               // leave: free the slot
#define P_LOOP  0x81               // count, target: jump back count-1 times
#define P_FIRE  0x82               // fire one shot (counted here)

static const char path_dive[] = {
    127, 0, 3,
    P_END };
static const char path_weave[] = {
    6, 2, 2,   12, 0xfe, 2,   6, 2, 2,      // offset 0: one sway, 24 steps
    P_FIRE,                                 // offset 9
    P_LOOP, 3, 0,                           // offset 10: three sways
    127, 0, 3,                              // then dive out of the bottom
    P_END };
static const char path_swoop[] = {
    16, 0, 3,   8, 1, 3,   8, 2, 2,         // dive, then bend right
    P_FIRE,
    8, 3, 1,   8, 3, 0,   127, 3, 0xfe,     // level out, climb off the side
    P_END };
static const char * const paths[3] = { path_dive, path_weave, path_swoop };
static const char path_colour[3] = { VCOL_YELLOW, VCOL_CYAN, VCOL_LT_RED };

// The wave list, sorted by trigger position. Enemy k of a wave spawns at
// x0 + k * xstep on line Y_ENTRY, one every `spacing` frames.
static const unsigned wave_pos[NWAVES]   = { 40, 130, 220, 310, 400, 490 };
static const char wave_path[NWAVES]      = {  0,   1,   2,   0,   1,   2 };
static const char wave_count[NWAVES]     = {  5,   6,   6,   4,   6,   6 };
static const char wave_spacing[NWAVES]   = {  6,  10,   8,  10,  10,   8 };
static const char wave_x0[NWAVES]        = { 60,  40,  30, 150, 120, 100 };
static const char wave_xstep[NWAVES]     = { 30,   0,  12,   0,   0,  12 };

// Expected trigger frames from the Python model: the scroll stop delays
// waves 3 to 5 by 50 frames, and loop 1 starts again at frame 650.
static const unsigned expect_tick[7] = { 39, 129, 219, 359, 449, 539, 689 };

// Enemy slots, parallel arrays indexed by slot = sprite number.
char e_live[NS], e_x[NS], e_y[NS], e_path[NS], e_pc[NS];
char e_n[NS], e_dx[NS], e_dy[NS], e_lc[NS], e_wave[NS];

// Director state.
unsigned scroll, tick;
char loop, cursor;
char sp_wave, sp_left, sp_timer;             // the one active spawner
char w_alive[NWAVES], w_kill[NWAVES], w_spawned[NWAVES];
char refused, bonus, escaped, kills, peak;
unsigned shots;

// Trigger log.
char log_n;
char log_wave[8], log_loop[8], log_spawn[8];
unsigned log_scroll[8], log_tick[8];

// ---- the path interpreter ------------------------------------------------

// One step of slot s. Returns 0 when the path has ended.
__noinline char path_step(char s)
{
    const char *p = paths[e_path[s]];
    while (e_n[s] == 0)
    {
        char pc = e_pc[s];
        char op = p[pc];
        if (op == P_END)
            return 0;
        if (op == P_FIRE)
        {
            shots++;
            e_pc[s] = pc + 1;
        }
        else if (op == P_LOOP)
        {
            if (e_lc[s] == 0)
                e_lc[s] = p[pc + 1];
            if (--e_lc[s] != 0)
                e_pc[s] = p[pc + 2];
            else
                e_pc[s] = pc + 3;
        }
        else
        {
            e_n[s]  = op;
            e_dx[s] = p[pc + 1];
            e_dy[s] = p[pc + 2];
            e_pc[s] = pc + 3;
        }
    }
    e_x[s] += e_dx[s];
    e_y[s] += e_dy[s];
    e_n[s]--;
    return 1;
}

// ---- the director --------------------------------------------------------

static void spawn(char w, char k)
{
    for (char s = 0; s < NS; s++)
    {
        if (!e_live[s])
        {
            e_live[s] = 1;
            e_x[s] = wave_x0[w] + k * wave_xstep[w];
            e_y[s] = Y_ENTRY;
            e_path[s] = wave_path[w];
            e_pc[s] = 0;
            e_n[s] = 0;
            e_lc[s] = 0;
            e_wave[s] = w;
            w_alive[w]++;
            w_spawned[w]++;
            log_spawn[log_n - 1]++;
            return;
        }
    }
    refused++;
}

static void gone(char s, char killed)
{
    char w = e_wave[s];
    e_live[s] = 0;
    w_alive[w]--;
    if (killed)
    {
        w_kill[w]++;
        kills++;
    }
    // The wave is over when none is alive and the spawner has finished it.
    if (w_alive[w] == 0 && w_spawned[w] == wave_count[w] &&
        !(sp_left != 0 && sp_wave == w))
    {
        if (w_kill[w] == wave_count[w])
            bonus++;
        else
            escaped++;
    }
}

// Start every wave whose position the scroll has reached. >= and not ==,
// so a scroll that moves more than one position a frame cannot skip one.
__noinline void director(void)
{
    while (cursor < NWAVES && scroll >= wave_pos[cursor])
    {
        char w = cursor;
        log_wave[log_n] = w;
        log_loop[log_n] = loop;
        log_scroll[log_n] = scroll;
        log_tick[log_n] = tick;
        log_spawn[log_n] = 0;
        log_n++;
        sp_wave = w;
        sp_left = wave_count[w];
        sp_timer = 0;
        w_alive[w] = 0;
        w_kill[w] = 0;
        w_spawned[w] = 0;
        cursor++;
    }
}

static void spawner(void)
{
    if (sp_left == 0)
        return;
    if (sp_timer == 0)
    {
        char w = sp_wave;
        spawn(w, wave_count[w] - sp_left);
        sp_left--;
        char gap = wave_spacing[w] >> loop;    // difficulty: loop 1 halves it
        if (gap == 0)
            gap = 1;
        sp_timer = gap - 1;
    }
    else
        sp_timer--;
}

// Every live enemy: one path step, the edge test, the gun column.
__noinline void update_enemies(void)
{
    for (char s = 0; s < NS; s++)
    {
        if (!e_live[s])
            continue;
        if (!path_step(s))
            gone(s, 0);
        else if (e_x[s] >= 250 || e_y[s] >= 250)   // off any edge: a byte
            gone(s, 0);                             //   that wrapped reads >= 250
        else if (e_x[s] >= GUN_X0 && e_x[s] < GUN_X1 && e_y[s] >= GUN_Y)
            gone(s, 1);
    }
}

static void game_tick(void)
{
    if (tick < STOP0 || tick >= STOP1)
    {
        scroll++;
        if (scroll == LEVEL_LEN)
        {
            scroll = 0;
            loop++;
            cursor = 0;
        }
    }
    director();
    spawner();
    update_enemies();
    char n = 0;
    for (char s = 0; s < NS; s++)
        n += e_live[s];
    if (n > peak)
        peak = n;
    tick++;
}

// Sprite X is the 8-bit enemy x, so the playfield is sprite X 0-249 and
// $D010 stays 0.
static void draw_sprites(void)
{
    char en = 0;
    for (char s = 0; s < NS; s++)
    {
        if (e_live[s])
        {
            vic.spr_pos[s].x = e_x[s];
            vic.spr_pos[s].y = e_y[s];
            vic.spr_color[s] = path_colour[e_path[s]];
            en |= 1 << s;
        }
    }
    vic.spr_enable = en;
}

// ---- timing subjects -----------------------------------------------------

// Each subject resets slot 0 and runs one step; `reset_only` is the
// baseline that does the reset without the step.
__noinline void reset_only(void)
{
    e_path[0] = 1; e_pc[0] = 9; e_n[0] = 100; e_lc[0] = 2;
}
__noinline void step_move(void)             // steps left: no fetch
{
    e_path[0] = 1; e_pc[0] = 9; e_n[0] = 100; e_lc[0] = 2;
    path_step(0);
}
__noinline void step_fetch(void)            // fetch one MOVE, then step
{
    e_path[0] = 1; e_pc[0] = 0; e_n[0] = 0; e_lc[0] = 2;
    path_step(0);
}
__noinline void step_fire_loop(void)        // FIRE, LOOP back, MOVE, step
{
    e_path[0] = 1; e_pc[0] = 9; e_n[0] = 0; e_lc[0] = 2;
    path_step(0);
}
__noinline void nothing(void)
{
}

// A frame's director work, spawner and path steps (no scroll, no drawing).
// Positions are reset each call, so nothing leaves or is shot.
// 8 moving: all eight slots mid-MOVE on the dive path, nothing due.
__noinline void reset8_only(void)
{
    for (char s = 0; s < NS; s++)
    {
        e_live[s] = 1; e_path[s] = 0; e_pc[s] = 0; e_n[s] = 0;
        e_x[s] = 100; e_y[s] = 100;
    }
}
static void frame_work(void)
{
    director();
    spawner();
    update_enemies();
}
__noinline void frame8_move(void)
{
    for (char s = 0; s < NS; s++)
    {
        e_live[s] = 1; e_path[s] = 0; e_pc[s] = 0; e_n[s] = 100;
        e_x[s] = 100; e_y[s] = 100;
    }
    frame_work();
}
// Worst frame: seven live enemies each on the weave path's FIRE, LOOP
// back and MOVE fetch, wave 0 due at scroll 40, and its first enemy
// spawned into the free slot 7, which then fetches its first MOVE.
__noinline void reset_worst(void)
{
    for (char s = 0; s < NS; s++)
    {
        e_live[s] = 1; e_path[s] = 1; e_pc[s] = 9; e_n[s] = 0; e_lc[s] = 2;
        e_x[s] = 100; e_y[s] = 100;
    }
    e_live[7] = 0;
    cursor = 0; scroll = 40; loop = 0; log_n = 0;
}
__noinline void frame_worst(void)
{
    for (char s = 0; s < NS; s++)
    {
        e_live[s] = 1; e_path[s] = 1; e_pc[s] = 9; e_n[s] = 0; e_lc[s] = 2;
        e_x[s] = 100; e_y[s] = 100;
    }
    e_live[7] = 0;
    cursor = 0; scroll = 40; loop = 0; log_n = 0;
    frame_work();
}

// CIA1 timer A: force-load $FFFF, count phi2 while fn runs `calls`
// times, read. The frame subjects run 20 or 10 times so the 16-bit
// count cannot wrap.
static unsigned time_loop(void (*fn)(void), char calls)
{
    cia1.cra = 0x00;
    cia1.ta = 0xffff;
    cia1.cra = 0x11;
    char i = calls;
    do
    {
        fn();
    } while (--i);
    cia1.cra = 0x00;
    return 0xffff - cia1.ta;
}

// ---- screen --------------------------------------------------------------

static void put_str(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
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

static const char hex_glyph[16] = {
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 1, 2, 3, 4, 5, 6 };

static void put_hex16(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hex_glyph[(v >> 12) & 15];
    p[1] = hex_glyph[(v >> 8) & 15];
    p[2] = hex_glyph[(v >> 4) & 15];
    p[3] = hex_glyph[v & 15];
}

// Net cycles per call to two decimals: (t - t0) / calls.
static void put_per_call(char row, char col, unsigned t, unsigned t0, char calls)
{
    unsigned n = t - t0;
    put_dec(row, col, n / calls, 4);
    SCREEN[40 * row + col + 4] = '.';
    put_dec(row, col + 5, (n % calls) * 100 / calls, 2);
}

static unsigned fold(unsigned cs, unsigned v)
{
    return (cs ^ v) * 5 + 1;
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
    for (char k = 0; k < 64; k++)                // an 8 by 8 square
        SPRDATA[k] = (k < 24 && k % 3 == 0) ? 0xff : 0x00;
    for (char s = 0; s < NS; s++)
        SPRPTR[s] = 13;
    vic.spr_msbx = 0;

    put_str(7, 0, "wave director  6 waves  3 paths");
    put_str(8, 0, "w lp pos tick spawn");

    // The game: one tick a frame, sprites written after the tick.
    char shown = 0;
    while (tick < T_END)
    {
        vic_waitFrame();
        draw_sprites();
        game_tick();
        while (shown < log_n)
        {
            char r = 9 + shown;
            put_dec(r, 0, log_wave[shown], 1);
            put_dec(r, 2, log_loop[shown], 1);
            put_dec(r, 5, log_scroll[shown], 3);
            put_dec(r, 9, log_tick[shown], 4);
            shown++;
        }
        put_str(8, 26, "scroll");
        put_dec(8, 33, scroll, 3);
    }
    draw_sprites();

    // Checks: every trigger at its table position, on the model's frame,
    // with the table's count spawned.
    bool pass = log_n == 7 && refused == 0;
    for (char i = 0; i < log_n; i++)
    {
        char w = log_wave[i];
        put_dec(9 + i, 16, log_spawn[i], 1);
        if (w != i % NWAVES || log_scroll[i] != wave_pos[w] ||
            log_tick[i] != expect_tick[i] || log_spawn[i] != wave_count[w])
            pass = false;
    }
    put_str(16, 0, "refused   peak   bonus   kills");
    put_dec(16, 8, refused, 1);
    put_dec(16, 15, peak, 1);
    put_dec(16, 23, bonus, 1);
    put_dec(16, 31, kills, 1);
    put_str(17, 20, "shots");
    put_dec(17, 26, shots, 2);

    unsigned chk = 0;
    for (char s = 0; s < NS; s++)
    {
        chk = fold(chk, e_live[s]);
        chk = fold(chk, e_x[s]);
        chk = fold(chk, e_y[s]);
        chk = fold(chk, e_pc[s]);
        chk = fold(chk, e_n[s]);
        chk = fold(chk, e_lc[s]);
    }
    put_str(17, 0, "chk      exp");
    put_hex16(17, 4, chk);
    put_hex16(17, 13, EXPECT_CHK);
    pass = pass && chk == EXPECT_CHK;

    // Timing. The picture and the checks are done, so the subjects may
    // overwrite the slots. Sprites off, interrupts off, screen blanked, so
    // no DMA or IRQ lands in a count.
    char en = vic.spr_enable;
    __asm { sei }
    vic.spr_enable = 0;
    vic.ctrl1 = 0x0b;
    vic_waitFrame();
    unsigned t0 = time_loop(nothing, 100);
    unsigned tb = time_loop(reset_only, 100);
    unsigned t_mv = time_loop(step_move, 100);
    unsigned t_fe = time_loop(step_fetch, 100);
    unsigned t_fl = time_loop(step_fire_loop, 100);
    unsigned t_di = time_loop(director, 100);    // cursor at 1: no trigger
    unsigned tb8 = time_loop(reset8_only, 20);
    unsigned t_f8m = time_loop(frame8_move, 20);
    unsigned tbw = time_loop(reset_worst, 10);
    unsigned t_w = time_loop(frame_worst, 10);
    vic.ctrl1 = 0x1b;
    vic.spr_enable = en;

    put_str(18, 0, "cycles          n    total  per call");
    put_str(19, 0, "step, move");
    put_dec(19, 16, 100, 3);
    put_dec(19, 21, t_mv, 5);
    put_per_call(19, 28, t_mv, tb, 100);
    put_str(20, 0, "step, fetch");
    put_dec(20, 16, 100, 3);
    put_dec(20, 21, t_fe, 5);
    put_per_call(20, 28, t_fe, tb, 100);
    put_str(21, 0, "fire+loop+move");
    put_dec(21, 16, 100, 3);
    put_dec(21, 21, t_fl, 5);
    put_per_call(21, 28, t_fl, tb, 100);
    put_str(22, 0, "director idle");
    put_dec(22, 16, 100, 3);
    put_dec(22, 21, t_di, 5);
    put_per_call(22, 28, t_di, t0, 100);
    put_str(23, 0, "8 moving");
    put_dec(23, 16, 20, 3);
    put_dec(23, 21, t_f8m, 5);
    put_per_call(23, 28, t_f8m, tb8, 20);
    put_str(24, 0, "worst frame");
    put_dec(24, 16, 10, 3);
    put_dec(24, 21, t_w, 5);
    put_per_call(24, 28, t_w, tbw, 10);

    put_str(7, 36, pass ? "pass" : "fail");
    vic.color_border = pass ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```
oscar64 -tm=c64 -O2 -o=wave-director.prg wave-director.c
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 180 x64sc -default -minimized -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 20000000 -exitscreenshot wave-director.png -autostart wave-director.prg
```

Add `-model ntsc` for the NTSC picture. 20,000,000 cycles is the pinned
run. The game runs 710 frames, about 14,000,000 cycles on PAL and
12,140,000 on NTSC (arithmetic: 19,656 and 17,095 cycles a frame). The PAL
screen was not yet complete at 16,000,000 and complete at 18,000,000; NTSC
was complete at 16,000,000 (measured in VICE x64sc 3.10). The PRG is 3,777
bytes.

## Expected output

Black screen, green border, five yellow 8 by 8 squares in a diagonal above
the text. Decoded from `screenshots/wave-director.png` (PAL) with the
character ROM; rows 0 to 6 hold no text:

```text
WAVE DIRECTOR  6 WAVES  3 PATHS     PASS
W LP POS TICK SPAWN       SCROLL 060
0 0  040 0039   5
1 0  130 0129   6
2 0  220 0219   6
3 0  310 0359   4
4 0  400 0449   6
5 0  490 0539   6
0 1  040 0689   5
REFUSED 0 PEAK 8 BONUS 1 KILLS 5
CHK EB12 EXP EB12   SHOTS 48
CYCLES          N    TOTAL  PER CALL
STEP, MOVE      100  14104  0080.00
STEP, FETCH     100  21904  0158.00
FIRE+LOOP+MOVE  100  35004  0289.00
DIRECTOR IDLE   100  08204  0045.00
8 MOVING        020  31044  1170.00
WORST FRAME     010  36704  3188.00
```

`screenshots/wave-director-ntsc.png` (`-model ntsc`) decodes to the same
text, and the cycle counts are identical on both models (the CIA counts phi2
cycles with the screen blanked). Each model's pinned run was made twice and
gave byte-identical PNGs (measured in VICE x64sc 3.10).

What each row states:

- Rows 9 to 15, the trigger log: wave, loop, scroll position at the
  trigger, frame of the trigger, enemies spawned. Every scroll position
  equals the table's, and every spawn count equals the table's count.
  Waves 0 to 2 trigger on frames 39, 129 and 219: frame 0 already moves
  the scroll to 1, and the director looks after the move. The scroll
  holds for frames 250 to 299, so waves 3 to 5 trigger 50 frames later
  than their position (359, 449, 539) and still at their position. The
  level loops at frame 650 and wave 0 starts again at frame 689.
- Row 16: no spawn found the pool full; at most 8 enemies were live at
  once; one wave (wave 3, four dives down the gun column at x 150) was
  killed whole and scored the bonus; 5 kills in all (wave 3's four and
  wave 0's enemy at x 150).
- Row 17: the fold over the 48 bytes of `e_live`, `e_x`, `e_y`, `e_pc`,
  `e_n` and `e_lc` is $EB12 on the 6510 and in Python; 48 FIRE opcodes ran.
- Rows 19 to 24: CIA1 timer A over N calls, total and net per call. The
  single-step rows subtract a subject that does the same slot reset without
  the step; the director row subtracts an empty call; each frame row
  subtracts a subject that does its slot reset without the frame's work.
  A frame row times the director, the spawner and every live enemy's
  step with its edge and gun tests. 8 moving: eight enemies mid-MOVE,
  nothing due. Worst frame: seven enemies on the weave path's FIRE, LOOP
  back and MOVE fetch in one step, a wave due, and its first enemy
  spawned into the last free slot, which fetches its first MOVE.

The sprites, measured with PIL on both pictures. They are loop 1's wave 0,
five dives spawned every 3 frames instead of 6, so they are 9 lines apart
where loop 0's were 18. Screenshot x is sprite X plus 8; the top raster
line is the sprite Y register plus 1:

| Sprite X, Y (Python model) | Screenshot x | PAL rows | NTSC rows | Raster lines |
|---|---|---|---|---|
| 60, 93 | 68 to 75 | 78 to 85 | 66 to 73 | 94 to 101 |
| 90, 84 | 98 to 105 | 69 to 76 | 57 to 64 | 85 to 92 |
| 120, 75 | 128 to 135 | 60 to 67 | 48 to 55 | 76 to 83 |
| 150, 66 | 158 to 165 | 51 to 58 | 39 to 46 | 67 to 74 |
| 180, 57 | 188 to 195 | 42 to 49 | 30 to 37 | 58 to 65 |

Every square is where the model puts it, to the pixel, on both models. The
model of the whole run:

```python
END, LOOP, FIRE = 0x80, 0x81, 0x82
PATHS = [[127, 0, 3, END],
         [6, 2, 2, 12, 0xfe, 2, 6, 2, 2, FIRE, LOOP, 3, 0, 127, 0, 3, END],
         [16, 0, 3, 8, 1, 3, 8, 2, 2, FIRE, 8, 3, 1, 8, 3, 0, 127, 3, 0xfe, END]]
WAVES = [(40, 0, 5, 6, 60, 30), (130, 1, 6, 10, 40, 0), (220, 2, 6, 8, 30, 12),
         (310, 0, 4, 10, 150, 0), (400, 1, 6, 10, 120, 0), (490, 2, 6, 8, 100, 12)]
NS = 8
live, x, y, pa, pc, n, dx, dy, lc, wv = ([0] * NS for _ in range(10))
g = dict(scroll=0, loop=0, cur=0, left=0, timer=0, sw=0, refused=0,
         bonus=0, kills=0, shots=0, peak=0)
alive, killed, spawned = [0] * 6, [0] * 6, [0] * 6
log = []

def step(s):
    p = PATHS[pa[s]]
    while n[s] == 0:
        op = p[pc[s]]
        if op == END:
            return False
        if op == FIRE:
            g['shots'] += 1; pc[s] += 1
        elif op == LOOP:
            if lc[s] == 0: lc[s] = p[pc[s] + 1]
            lc[s] -= 1
            pc[s] = p[pc[s] + 2] if lc[s] else pc[s] + 3
        else:
            n[s], dx[s], dy[s] = op, p[pc[s] + 1], p[pc[s] + 2]; pc[s] += 3
    x[s] = (x[s] + dx[s]) & 255; y[s] = (y[s] + dy[s]) & 255; n[s] -= 1
    return True

def gone(s, hit):
    w = wv[s]; live[s] = 0; alive[w] -= 1
    if hit: killed[w] += 1; g['kills'] += 1
    if alive[w] == 0 and spawned[w] == WAVES[w][2] and not (g['left'] and g['sw'] == w):
        g['bonus'] += killed[w] == WAVES[w][2]

for t in range(710):
    if not 250 <= t < 300:
        g['scroll'] += 1
        if g['scroll'] == 600:
            g['scroll'], g['cur'] = 0, 0; g['loop'] += 1
    while g['cur'] < 6 and g['scroll'] >= WAVES[g['cur']][0]:
        w = g['cur']; log.append([w, g['loop'], g['scroll'], t, 0])
        g['sw'], g['left'], g['timer'] = w, WAVES[w][2], 0
        alive[w] = killed[w] = spawned[w] = 0; g['cur'] += 1
    if g['left']:
        if g['timer'] == 0:
            w = g['sw']; pos, path, cnt, spc, x0, xs = WAVES[w]
            free = [s for s in range(NS) if not live[s]]
            if free:
                s = free[0]
                live[s], x[s], y[s], pa[s], pc[s], n[s], lc[s], wv[s] = \
                    1, (x0 + (cnt - g['left']) * xs) & 255, 30, path, 0, 0, 0, w
                alive[w] += 1; spawned[w] += 1; log[-1][4] += 1
            else:
                g['refused'] += 1
            g['left'] -= 1
            g['timer'] = max(1, spc >> g['loop']) - 1
        else:
            g['timer'] -= 1
    for s in range(NS):
        if not live[s]: continue
        if not step(s): gone(s, False)
        elif x[s] >= 250 or y[s] >= 250: gone(s, False)
        elif 140 <= x[s] < 164 and y[s] >= 150: gone(s, True)
    g['peak'] = max(g['peak'], sum(live))

chk = 0
for s in range(NS):
    for v in (live[s], x[s], y[s], pc[s], n[s], lc[s]):
        chk = ((chk ^ v) * 5 + 1) & 0xFFFF
print(log)
print(g['refused'], g['peak'], g['bonus'], g['kills'], g['shots'], hex(chk))
print([(x[s], y[s]) for s in range(NS) if live[s]])
```

It prints the seven log rows above as lists, `0 8 1 5 48 0xeb12`, and the five
positions in the table.

## Why this works

The trigger compares the scroll position, not the frame. The 50-frame hold
proves it: waves 3 to 5 start 50 frames late and at their exact positions,
so the enemies meet the same scenery they were placed against. A frame-keyed
table would have started them on frames 309, 399 and 489, while the scroll
stood still. The compare is `>=`, and the director loops while the next
record is due, so a scroll that jumps several positions in a frame starts
every wave it passed, in order, and never skips one. Because the list is
sorted, one compare against the record under the cursor is the whole idle
cost: 45 cycles a frame in C.

A path is data, so one interpreter moves every enemy. A MOVE costs a fetch
once and then a plain add per frame: 80 cycles a step with steps left, 158
on a step that fetches the next MOVE, 289 on one that also runs FIRE and a
LOOP back (all Oscar64 -O2, measured). The control opcodes take no frame,
so a path can fire and loop between two moves without a stall. Each enemy
carries only a path id, a program counter, a step count, a velocity and a
loop counter; the path bytes are shared by every enemy on that path.

The edge test is one compare per axis. x and y are bytes, and any byte at
250 or more is off screen: moving right past 249 or up or left past 0 both
land there, because a byte that goes below 0 wraps to 255. The price is a
playfield of sprite X 0 to 249, so `$D010` stays 0 and cannot be forgotten
(`sprite_x_high_bit_wrong_register`). A full-width game keeps a ninth x bit
per enemy and writes `$D010` from it.

The frame's director work with all eight slots live and mid-MOVE is 1,170
cycles, about 146 per enemy with the edge and gun tests. The worst frame
measured is 3,188: seven enemies each run FIRE, a LOOP back and a MOVE
fetch in one step (the longest step these paths have), a wave triggers,
and its first enemy is spawned into the last free slot. A frame budget has
to hold that figure. It leaves out the scroll advance, the live count and
the sprite writes, and `gone()` with its end-of-wave test, which runs only
when an enemy leaves. The step and frame figures move by a few cycles
with code layout. These are
C figures; hand-written assembly would be well under them.

The difficulty rule is one shift: the spacing is `spacing >> loop`, never
less than 1. Loop 1's wave 0 therefore spawns every 3 frames, and the
picture shows the five dives 9 lines apart where loop 0 had them 18 apart.
