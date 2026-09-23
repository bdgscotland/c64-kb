---
recipe: actor-activation-window
toolchain: oscar64
output_format: PRG
region: both
techniques: [actor_activation_window, object_pool]
file_formats: [PRG]
uses_registers: [DC04, DC05, DC0E, D000, D001, D010, D011, D015, D020, D021, D027]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 actor activation window: level-placed actors that wake near the view and keep their state

## Synopsis

Thirty-two actors are placed in a level 256 columns (2,048 pixels) wide.
Each has an entry in a level table: column, row, hit points and a flag
byte (facing, live, dead). A camera scrolls to the far end at 16 pixels a
tick and back at 8. Every tick the program examines eight table entries,
round robin, and wakes any that lie inside the view plus a margin of 8
columns into one of eight live slots. A live actor that leaves the view
plus margin plus 2 columns is written back to its entry and its slot is
freed. At camera 560 the script kills actors 9 and 11 and takes actor 10
down to 1 hit point. The program checks that the dead actors never wake
again, that actor 10 wakes on the way back where it was left and with 1
hit point, and that no living actor was ever inside the view while
dormant. It compares a checksum of the final table with a Python model,
prints PASS or FAIL, the peak live count and the cycle cost of each part
(CIA1 timer A), and draws the live actors at camera 0 as sprites. It
implements `actor_activation_window` (`techniques/logic.md`); the live
slots are an `object_pool`.

## Source

```c
// actor-activation-window.c
// Actors placed in the level data wake up when they come within a window
// around the view and go back to the level table when they leave it, so
// their position, hit points and direction survive. Killed actors are
// marked dead in the table and never wake again. A camera scrolls out to
// the far end of a 256-column level at 16 pixels a tick and back at 8;
// the level table is scanned 8 entries a tick, round robin. The program
// checks the result against a Python model, prints PASS or FAIL, the peak
// live count and the cycle cost of the scan, and draws the actors live at
// the end as sprites relative to the camera.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define SPRDATA ((char *)0x0340)   // sprite block 13

#define NLVL     32            // placed actors; a power of two for the wrap
#define NSLOT    8             // live slots, one hardware sprite each
#define SCAN_K   8             // level entries examined per tick
#define VIEW     40            // view width in columns
#define HYST     2             // extra columns before a live actor is dropped
#define NO_SLOT  0xff

#define LF_DIRL  0x01          // persistent: facing left
#define LF_LIVE  0x40          // in a slot now
#define LF_DEAD  0x80          // killed: never wakes again

#define EXPECT_CHK 0x1D54      // Python fold over the final level table

// ---- the level table: persistent, one byte per field per actor ----------
char lvl_x[NLVL];              // column (8-pixel block) in the level
char lvl_row[NLVL];            // character row
char lvl_hp[NLVL];
char lvl_flags[NLVL];
char lvl_home[NLVL];           // patrol centre, level data, never written

// ---- the live slots ------------------------------------------------------
char slot_lvl[NSLOT];          // level index, or NO_SLOT
unsigned slot_px[NSLOT];       // world x in pixels
char slot_hp[NSLOT];
char slot_dir[NSLOT];          // 1 = moving left

// ---- window state, set once per tick -------------------------------------
char win_lo, win_top;          // wake window: win_lo <= column <= win_top
char drop_lo, drop_top;        // drop window: keep while drop_lo <= column <= drop_top
char scan_pos;
char margin;
unsigned cam_px;

// ---- counters the scenario reads back ------------------------------------
char live_n, peak_n, refused;
unsigned wakes, popin;
char wake_n[NLVL];
bool hit_done;
char out_col = 0xff, out_hp;   // actor 10 when it went back to the table
unsigned back_px = 0xffff;     // actor 10 when it woke again
char back_hp;

__noinline void activate(char i)
{
    char s = 0;
    while (slot_lvl[s] != NO_SLOT)
    {
        if (++s == NSLOT)
        {
            refused++;
            return;
        }
    }
    slot_lvl[s] = i;
    slot_px[s]  = (unsigned)lvl_x[i] << 3;
    slot_hp[s]  = lvl_hp[i];
    slot_dir[s] = lvl_flags[i] & LF_DIRL;
    lvl_flags[i] |= LF_LIVE;
    if (++live_n > peak_n)
        peak_n = live_n;
    wakes++;
    wake_n[i]++;
    if (i == 10 && out_col != 0xff && back_px == 0xffff)
    {
        back_px = slot_px[s];
        back_hp = slot_hp[s];
    }
}

// Write the live state back to the level table and free the slot.
__noinline void deactivate(char s)
{
    char i = slot_lvl[s];
    lvl_x[i]  = (char)(slot_px[s] >> 3);
    lvl_hp[i] = slot_hp[s];
    lvl_flags[i] = (lvl_flags[i] & ~(LF_LIVE | LF_DIRL)) | slot_dir[s];
    if (i == 10 && hit_done && out_col == 0xff)
    {
        out_col = lvl_x[i];
        out_hp  = lvl_hp[i];
    }
    slot_lvl[s] = NO_SLOT;
    live_n--;
}

// Kill: mark the entry dead so no scan wakes it, and free the slot.
static void kill(char s)
{
    char i = slot_lvl[s];
    lvl_flags[i] = (lvl_flags[i] & ~LF_LIVE) | LF_DEAD;
    lvl_hp[i] = 0;
    slot_lvl[s] = NO_SLOT;
    live_n--;
}

// Both windows as inclusive column bounds clamped to 0..255, so every
// compare in the scan and the drop pass is one byte.
__noinline void set_window(void)
{
    int cc = cam_px >> 3;
    int lo = cc - margin;
    int hi = cc + VIEW + margin;        // first column past the wake window
    win_lo   = lo < 0 ? 0 : lo;
    win_top  = hi > 256 ? 255 : hi - 1;
    drop_lo  = lo - HYST < 0 ? 0 : lo - HYST;
    drop_top = hi + HYST > 256 ? 255 : hi + HYST - 1;
}

// Examine SCAN_K entries from where the last tick stopped.
__noinline void scan_step(void)
{
    char i = scan_pos;
    for (char k = 0; k < SCAN_K; k++)
    {
        if (!(lvl_flags[i] & (LF_LIVE | LF_DEAD)))
        {
            char c = lvl_x[i];
            if (c >= win_lo && c <= win_top)
                activate(i);
        }
        i = (i + 1) & (NLVL - 1);
    }
    scan_pos = i;
}

// The same test over the whole table, for comparison.
__noinline void scan_all(void)
{
    for (char i = 0; i < NLVL; i++)
    {
        if (!(lvl_flags[i] & (LF_LIVE | LF_DEAD)))
        {
            char c = lvl_x[i];
            if (c >= win_lo && c <= win_top)
                activate(i);
        }
    }
}

// The game's own actor logic, a stand-in: patrol three columns each
// side of home, one pixel a tick.
__noinline void move_live(void)
{
    for (char s = 0; s < NSLOT; s++)
    {
        char i = slot_lvl[s];
        if (i == NO_SLOT)
            continue;
        unsigned p = slot_px[s];
        if (slot_dir[s])
            p--;
        else
            p++;
        slot_px[s] = p;
        char c = p >> 3;
        if (c >= lvl_home[i] + 3)
            slot_dir[s] = 1;
        else if (c + 3 <= lvl_home[i])
            slot_dir[s] = 0;
    }
}

// Drop every live actor outside the drop window back into the table.
__noinline void drop_pass(void)
{
    for (char s = 0; s < NSLOT; s++)
    {
        if (slot_lvl[s] == NO_SLOT)
            continue;
        char c = slot_px[s] >> 3;
        if (c < drop_lo || c > drop_top)
            deactivate(s);
    }
}

// The technique's work per tick: window, scan slice, drop pass.
__noinline void window_tick(void)
{
    set_window();
    scan_step();
    drop_pass();
}

static void tick_logic(void)
{
    set_window();
    scan_step();
    move_live();
    drop_pass();
}

// Harness only: a dormant, living entry inside the view is a pop-in.
static void check_popin(void)
{
    char cc = cam_px >> 3;
    for (char i = 0; i < NLVL; i++)
    {
        if (!(lvl_flags[i] & (LF_LIVE | LF_DEAD)))
        {
            char c = lvl_x[i];
            if (c >= cc && c < cc + VIEW)
                popin++;
        }
    }
}

static char slot_of(char i)
{
    for (char s = 0; s < NSLOT; s++)
        if (slot_lvl[s] == i)
            return s;
    return NO_SLOT;
}

static void level_reset(void)
{
    for (char i = 0; i < NLVL; i++)
    {
        lvl_x[i] = lvl_home[i] = 4 + (i << 3);
        lvl_row[i] = 19 + (i & 3);
        lvl_hp[i] = 3;
        lvl_flags[i] = i & 1;
        wake_n[i] = 0;
    }
    for (char s = 0; s < NSLOT; s++)
        slot_lvl[s] = NO_SLOT;
    scan_pos = live_n = peak_n = refused = 0;
    wakes = popin = 0;
    hit_done = false;
    out_col = 0xff;
    back_px = 0xffff;
}

// Out to the far end at 16 px a tick, a scripted fight at camera 560,
// then back to 0 at 8 px a tick.
static bool kill_ok;
static char w9, w11;
static void scenario(char m)
{
    level_reset();
    margin = m;
    kill_ok = true;
    for (cam_px = 0; cam_px <= 1728; cam_px += 16)
    {
        tick_logic();
        check_popin();
        if (cam_px == 560)
        {
            char s = slot_of(9);
            if (s == NO_SLOT) kill_ok = false; else kill(s);
            s = slot_of(11);
            if (s == NO_SLOT) kill_ok = false; else kill(s);
            s = slot_of(10);
            if (s == NO_SLOT) kill_ok = false; else slot_hp[s] = 1;
            hit_done = true;
        }
    }
    w9 = wake_n[9];
    w11 = wake_n[11];
    cam_px = 1728;
    for (;;)
    {
        tick_logic();
        check_popin();
        if (cam_px == 0)
            break;
        cam_px -= 8;
    }
}

// ---- timing ---------------------------------------------------------------

__noinline void nothing(void)
{
}

__noinline void wake_and_drop(void)
{
    activate(0);
    deactivate(0);
}

// The worst tick: every slot free and the whole slice inside the wake
// window, so all 8 entries wake, then the drop pass runs over 8 live.
// Timed with the reset, less the reset alone.
__noinline void reset_slots(void)
{
    for (char s = 0; s < NSLOT; s++)
    {
        slot_lvl[s] = NO_SLOT;
        lvl_flags[s] = 0;
    }
    live_n = 0;
    scan_pos = 0;
}

__noinline void reset_only(void)
{
    reset_slots();
}

__noinline void worst_tick(void)
{
    reset_slots();
    window_tick();
}

// CIA1 timer A: force-load $FFFF, count phi2 while fn runs 20 times. The
// largest subject stays under 65,535 cycles in total, so the 16-bit timer
// does not wrap; a first build with 50 calls wrapped on the actor update.
static unsigned time_loop(void (*fn)(void))
{
    cia1.cra = 0x00;
    cia1.ta = 0xffff;
    cia1.cra = 0x11;
    char i = 20;
    do
    {
        fn();
    } while (--i);
    cia1.cra = 0x00;
    return 0xffff - cia1.ta;
}

// ---- screen ----------------------------------------------------------------

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

// Net cycles per call to two decimals: (t - t0) / 20 calls.
static void put_per_call(char row, char col, unsigned t, unsigned t0)
{
    unsigned long n = (unsigned long)(t - t0) * 5;  // hundredths per call
    put_dec(row, col, (unsigned)(n / 100), 4);
    SCREEN[40 * row + col + 4] = '.';
    put_dec(row, col + 5, (unsigned)(n % 100), 2);
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

    // Demonstration first: a margin of 1 column is too small at 16 px a tick.
    scenario(1);
    unsigned popin1 = popin;

    // The real run: margin 8 columns.
    scenario(8);

    unsigned chk = 0;
    for (char i = 0; i < NLVL; i++)
    {
        chk = fold(chk, lvl_x[i]);
        chk = fold(chk, lvl_hp[i]);
        chk = fold(chk, lvl_flags[i]);
    }

    put_str(0, 0, "actor window  32 placed  8 slots");
    put_str(1, 0, "margin 8  scan 8/tick  cam 16 out 8 back");
    put_str(2, 0, "kill 9 11 hit 10 at cam 560");
    put_str(3, 0, "wakes 9   before    after");
    put_dec(3, 17, w9, 1);
    put_dec(3, 26, wake_n[9], 1);
    put_str(4, 0, "wakes 11  before    after");
    put_dec(4, 17, w11, 1);
    put_dec(4, 26, wake_n[11], 1);
    put_str(5, 0, "10 out col     hp    in px      hp");
    put_dec(5, 11, out_col, 3);
    put_dec(5, 18, out_hp, 1);
    put_dec(5, 27, back_px, 4);
    put_dec(5, 35, back_hp, 1);
    put_str(6, 0, "popin    refused    peak   wakes");
    put_dec(6, 6, popin, 2);
    put_dec(6, 17, refused, 2);
    put_dec(6, 25, peak_n, 1);
    put_dec(6, 33, wakes, 3);
    put_str(7, 0, "chk      exp       margin 1 popin");
    put_hex16(7, 4, chk);
    put_hex16(7, 13, EXPECT_CHK);
    put_dec(7, 34, popin1, 3);

    bool pass = kill_ok && w9 == 1 && w11 == 1 && wake_n[9] == 1 &&
                wake_n[11] == 1 && wake_n[10] == 2 && wake_n[12] == 2 &&
                out_col == 86 && out_hp == 1 && back_px == 688 && back_hp == 1 &&
                popin == 0 && refused == 0 && peak_n == 8 && wakes == 56 &&
                chk == EXPECT_CHK && popin1 != 0;

    // Save the final table: the timing below overwrites it.
    char sv_lvl[NSLOT];
    unsigned sv_px[NSLOT];
    for (char s = 0; s < NSLOT; s++)
    {
        sv_lvl[s] = slot_lvl[s];
        sv_px[s] = slot_px[s];
    }

    // Cycle costs. Interrupts off and DEN off so nothing steals cycles.
    __asm { sei }
    vic.ctrl1 = 0x0b;
    vic_waitFrame();
    unsigned t0 = time_loop(nothing);

    // Scans with every entry dormant and an empty wake window.
    for (char i = 0; i < NLVL; i++)
        lvl_flags[i] = 0;
    win_lo = 1;
    win_top = 0;
    unsigned t_scan8 = time_loop(scan_step);
    unsigned t_scan32 = time_loop(scan_all);

    // Eight live actors (entries 0 to 7, columns 4 to 60), camera 0 and a
    // margin of 22: the drop window, columns 0 to 63, holds every patrol,
    // and the wake window, 0 to 61, holds no dormant entry.
    for (char s = 0; s < NSLOT; s++)
    {
        slot_lvl[s] = s;
        slot_px[s] = (unsigned)lvl_home[s] << 3;
        slot_dir[s] = 0;
        lvl_flags[s] = LF_LIVE;
    }
    cam_px = 0;
    margin = 22;
    set_window();
    unsigned t_drop = time_loop(drop_pass);
    unsigned t_tick = time_loop(window_tick);   // 20 calls: 5 laps of the table
    unsigned t_move = time_loop(move_live);

    // One wake into the free slot 0 and one drop back.
    slot_lvl[0] = NO_SLOT;
    live_n = 7;
    unsigned t_wd = time_loop(wake_and_drop);

    // Entries 0 to 7 sit in columns 4 to 60 after the run, inside the
    // wake window 0 to 61, so all 8 wake; worst_ok checks that they did.
    unsigned t_ro = time_loop(reset_only);
    unsigned t_worst = time_loop(worst_tick);
    bool worst_ok = live_n == 8 && refused == 0;
    vic.ctrl1 = 0x1b;

    put_str(9, 0,  "cycles x20            total   per call");
    put_str(10, 0, "empty call");
    put_dec(10, 22, t0, 5);
    put_str(11, 0, "scan 8, none wakes");
    put_dec(11, 22, t_scan8, 5);
    put_per_call(11, 30, t_scan8, t0);
    put_str(12, 0, "scan all 32");
    put_dec(12, 22, t_scan32, 5);
    put_per_call(12, 30, t_scan32, t0);
    put_str(13, 0, "drop pass, 8 live");
    put_dec(13, 22, t_drop, 5);
    put_per_call(13, 30, t_drop, t0);
    put_str(14, 0, "window+scan 8+drop");
    put_dec(14, 22, t_tick, 5);
    put_per_call(14, 30, t_tick, t0);
    put_str(15, 0, "patrol 8 (payload)");
    put_dec(15, 22, t_move, 5);
    put_per_call(15, 30, t_move, t0);
    put_str(16, 0, "wake + drop back");
    put_dec(16, 22, t_wd, 5);
    put_per_call(16, 30, t_wd, t0);

    put_str(17, 0, "scan 8 all wake+drop");
    put_dec(17, 22, t_worst, 5);
    put_per_call(17, 30, t_worst, t_ro);

    pass = pass && worst_ok;
    put_str(18, 0, pass ? "pass" : "fail");
    vic.color_border = pass ? VCOL_GREEN : VCOL_RED;

    // Draw the actors live at the end, camera 0, as sprites.
    for (char k = 0; k < 63; k++)
        SPRDATA[k] = 0xff;
    char en = 0, msb = 0;
    for (char s = 0; s < NSLOT; s++)
    {
        ((char *)0x07f8)[s] = 13;
        vic.spr_color[s] = VCOL_YELLOW;
        if (sv_lvl[s] == NO_SLOT || sv_px[s] >= VIEW * 8)
            continue;
        unsigned sx = sv_px[s] + 24;
        vic.spr_pos[s].x = (char)sx;
        vic.spr_pos[s].y = 50 + (lvl_row[sv_lvl[s]] << 3);
        if (sx & 0x100)
            msb |= 1 << s;
        en |= 1 << s;
    }
    vic.spr_msbx = msb;
    vic.spr_enable = en;
    for (;;)
        ;
    return 0;
}
```

## Build

```
oscar64 -tm=c64 -O2 -o=actor-activation-window.prg actor-activation-window.c
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 180 x64sc -default -minimized -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 -exitscreenshot actor-activation-window.png -autostart actor-activation-window.prg
```

Add `-model ntsc` for the NTSC picture. 8,000,000 cycles is the pinned
run. The screen was complete at 6,000,000 on both models (measured).
A build without the worst-tick row was blank at 5,000,000 (measured,
PAL).

## Expected output

Black screen, green border, five yellow sprites in the lower part of the
screen. Decoded from `screenshots/actor-activation-window.png` (PAL) with
the character ROM; rows 8 and 19 to 24 hold no text:

```text
ACTOR WINDOW  32 PLACED  8 SLOTS
MARGIN 8  SCAN 8/TICK  CAM 16 OUT 8 BACK
KILL 9 11 HIT 10 AT CAM 560
WAKES 9   BEFORE 1  AFTER 1
WAKES 11  BEFORE 1  AFTER 1
10 OUT COL 086 HP 1  IN PX 0688 HP 1
POPIN 00 REFUSED 00 PEAK 8 WAKES 056
CHK 1D54 EXP 1D54  MARGIN 1 POPIN 037

CYCLES X20            TOTAL   PER CALL
EMPTY CALL            00749
SCAN 8, NONE WAKES    09149   0420.00
SCAN ALL 32           23809   1153.00
DROP PASS, 8 LIVE     11329   0529.00
WINDOW+SCAN 8+DROP    22269   1076.00
PATROL 8 (PAYLOAD)    25249   1225.00
WAKE + DROP BACK      06029   0264.00
SCAN 8 ALL WAKE+DROP  60529   2809.00
PASS
```

`screenshots/actor-activation-window-ntsc.png` (`-model ntsc`) decodes to
the same text, and the cycle counts are identical on both models (the CIA
counts phi2 cycles with the screen blanked). Each model's pinned run was
made twice and gave byte-identical PNGs (measured in VICE x64sc 3.10).

The sprites, measured with PIL on both pictures. Screenshot x is world
pixel x plus 32, because the camera is at 0 and sprite X is world x plus
24; the top raster line is the character row's top line, one below the
sprite Y register:

| Level entry | World x (px) | Screenshot x | Raster lines | Text row, 19 + (entry AND 3) |
|---|---|---|---|---|
| 0 | 54 | 86 to 109 | 203 to 223 | 19 |
| 1 | 96 | 128 to 151 | 211 to 231 | 20 |
| 2 | 162 | 194 to 217 | 219 to 239 | 21 |
| 3 | 242 | 274 to 297 | 227 to 247 | 22 |
| 4 | 284 | 316 to 339 | 203 to 223 | 19 |

Entry 4 is at sprite X 308, past 255, so it needs its bit in `$D010`
(`sprite_x_high_bit_wrong_register`). Entry 5 is live at world x 358, in
the margin and outside the view, so it has no sprite. The world positions
are the Python model's; none of the five is at its placed position
(32 + 64 × entry) because each has patrolled since it woke.

What each row states:

- Rows 3 and 4: actors 9 and 11 each woke once on the way out; after the
  kill the count is still 1, so the dead flag kept them asleep while the
  camera passed them again.
- Row 5: actor 10 went back to the table at column 86 with 1 hit point
  (it was placed at column 84 with 3), and woke on the way back at pixel
  688 = 86 × 8 with 1 hit point.
- Row 6: no dormant, living entry was ever inside the view; no wake was
  refused for want of a slot; at most 8 slots were live at once; 56 wakes
  in all.
- Row 7: the fold over the 96 bytes of `lvl_x`, `lvl_hp` and `lvl_flags`
  is $1D54 on the 6510 and in Python. The same scenario run first with a
  margin of 1 column had 37 pop-ins (tick-entry pairs where a living
  actor was in view but dormant).
- Rows 10 to 17: CIA1 timer A over 20 calls, total and net per call.
  Row 17 is the worst tick: all slots free, and all 8 entries of the
  slice inside the wake window, so the tick wakes 8 and then runs the
  drop pass over 8 live. It is timed with a slot reset in each call; the
  net figure subtracts a call that only resets. The program checks that
  all 8 woke; PASS includes that check.

The Python model of the scenario. The C code clamps the window bounds to
0 to 255 and compares one byte; the model compares unclamped integers and
gives the same table:

```python
NLVL, NSLOT, K, VIEW, HYST = 32, 8, 8, 40, 2
LIVE, DEAD = 0x40, 0x80
home = [4 + 8 * i for i in range(NLVL)]

def run(margin):
    lx, hp, fl = list(home), [3] * NLVL, [i & 1 for i in range(NLVL)]
    sl, px, shp, sd = [None] * NSLOT, [0] * NSLOT, [0] * NSLOT, [0] * NSLOT
    st = dict(scan=0, live=0, peak=0, wakes=0, popin=0, hit=False, out=None, back=None)
    wn = [0] * NLVL

    def wake(i):
        if None not in sl:
            return
        s = sl.index(None)
        sl[s], px[s], shp[s], sd[s] = i, lx[i] * 8, hp[i], fl[i] & 1
        fl[i] |= LIVE
        st['live'] += 1; st['peak'] = max(st['peak'], st['live'])
        st['wakes'] += 1; wn[i] += 1
        if i == 10 and st['out'] and not st['back']:
            st['back'] = (px[s], shp[s])

    def drop(s):
        i = sl[s]
        lx[i], hp[i] = px[s] >> 3, shp[s]
        fl[i] = (fl[i] & ~(LIVE | 1)) | sd[s]
        if i == 10 and st['hit'] and not st['out']:
            st['out'] = (lx[i], hp[i])
        sl[s] = None; st['live'] -= 1

    def kill(i):
        s = sl.index(i)
        fl[i] = (fl[i] & ~LIVE) | DEAD; hp[i] = 0
        sl[s] = None; st['live'] -= 1

    def tick(cam):
        cc = cam >> 3
        lo, hi = cc - margin, cc + VIEW + margin
        i = st['scan']
        for _ in range(K):
            if not fl[i] & (LIVE | DEAD) and lo <= lx[i] < hi:
                wake(i)
            i = (i + 1) % NLVL
        st['scan'] = i
        for s in range(NSLOT):
            if sl[s] is None:
                continue
            px[s] += -1 if sd[s] else 1
            c = px[s] >> 3
            if c >= home[sl[s]] + 3: sd[s] = 1
            elif c + 3 <= home[sl[s]]: sd[s] = 0
        for s in range(NSLOT):
            if sl[s] is not None and not lo - HYST <= px[s] >> 3 < hi + HYST:
                drop(s)
        st['popin'] += sum(1 for i in range(NLVL)
                           if not fl[i] & (LIVE | DEAD) and cc <= lx[i] < cc + VIEW)

    for cam in range(0, 1729, 16):
        tick(cam)
        if cam == 560:
            kill(9); kill(11)
            shp[sl.index(10)] = 1
            st['hit'] = True
    for cam in range(1728, -1, -8):
        tick(cam)
    chk = 0
    for i in range(NLVL):
        for v in (lx[i], hp[i], fl[i]):
            chk = ((chk ^ v) * 5 + 1) & 0xFFFF
    return st, wn, hex(chk), [(sl[s], px[s]) for s in range(NSLOT) if sl[s] is not None]

st, wn, chk, live = run(8)
print(wn[9], wn[11], wn[10], wn[12], st['out'], st['back'])
print(st['popin'], st['peak'], st['wakes'], chk)
print(sorted(live))
print([run(m)[0]['popin'] for m in range(1, 9)])
```

It prints `1 1 2 2 (86, 1) (688, 1)`, `0 8 56 0x1d54`, the six live
slots with their pixel positions, and the pop-in count for margins 1 to
8: `[37, 25, 3, 3, 0, 0, 0, 0]`.

## Why this works

The level table is the only record of an actor while it is off screen. A
slot holds a copy while the actor is near the view, and the copy goes
back on the way out: column, hit points and facing. Sub-column position
is lost: the table stores `px >> 3`, and the actor wakes at `column × 8`.
Actor 10 was left somewhere between pixel 688 and 695 and woke at
688; a finer table entry costs a byte per actor. A dead entry is never deleted, only flagged, so
the scan skips it for the rest of the level with one `AND` of the flag
byte.

The margin is what hides the scan's latency. Eight entries a tick means
each entry is looked at every 4 ticks, and at 16 pixels a tick the camera
moves 8 columns in 4 ticks. An entry examined one column outside the
window can be 8 columns closer when it is next examined, so a margin of 8
columns is safe for any layout (arithmetic). It is not the least. The
scan runs before the pop-in check in the same tick, so an entry is
examined again on the tick it would first be in view; that leaves 3
ticks, 6 columns, to cover, and a margin of 6 is enough. A Python model
of the scan alone over adversarial layouts (every entry on one column,
every scan phase, and random layouts) gives worst pop-in counts of 15
at margin 5 and 0 at margins 6 to 9 (rung 3, a model; not run in VICE).
The measured run: 0 pop-ins with 8, 37 with 1. The recipe's Python model
shows this layout gets by with 5, because its actors are 8 columns
apart. The
drop window is 2 columns wider than the wake window, so an actor
patrolling on the edge is not dropped and woken on alternate ticks.

The costs are Oscar64 -O2 code and are larger than hand-written assembly
would be. The scan examines an entry in about 52 cycles when it slices
eight (420 per call) and about 36 when it walks all 32 in one loop (1,153
per call): the round-robin wrap costs an `AND` and a zero-page reload per
entry. The drop pass costs 529 cycles for 8 live actors, most of it the
16-bit shift from pixel to column. The window set-up, a scan slice and
the drop pass together cost 1,076 cycles a tick, an average over the 20
timed calls (five laps of the table) with entries 0 to 7 live, when
nothing wakes or drops. One wake and one drop add 264. The worst tick,
8 wakes and the drop pass over 8 live, costs 2,809 cycles, 14.3% of a
19,656-cycle PAL frame (arithmetic from the measured figure). A tick can
wake at most K entries, and wakes plus drops in one tick cannot exceed
the 8 slots, because a woken actor is inside the drop window. A variant
of this listing that drops all 8 in one tick, and wakes none, measured
1,850 cycles, so waking is the heavier case (VICE x64sc, PAL). The patrol row is
the demonstration's own actor logic and is not part of the technique.
Timing uses 20 calls per subject: a first build with 50 calls read 176.6
cycles for the update pass, a fraction from a loop that does the same
work every call, which is the 16-bit timer wrapping at 65,536.
