// hud.c: the panel under the road, rows 19-24 of the HUD page ($C800) in
// the ROM font, hires. Text is screen codes, not PETSCII (c64-kb
// petscii_written_to_screen_ram): lower-case letters in the source become
// the ROM's upper-case glyphs.
//
//   row 19   a solid bar (its lines show no background: engine.asm's split)
//   row 20   LAP 1/2   TIME 0:00.0   POS 4/4
//   row 21   SPEED 000   L1 -:--.-   L2 -:--.-
//   row 22   messages
//   row 24   AUTOPILOT: the verdict (columns 0-19) and the meter (20-39)
#include "game.h"

char fps = 50;

static char shown_lap, shown_place, shown_speed, shown_times;
static unsigned clk_frames;             // the lap clock: frames shown so far
static char clk_div, clk[4];            // frames into this tenth; M, S tens, S, tenths

void hud_text(char row, char col, const char *s)
{
    char *p = HUDPAGE + row * 40 + col;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

void hud_clear_row(char row)
{
    memset(HUDPAGE + row * 40, 32, 40);
}

void hud_dec(char row, char col, unsigned v, char digits)
{
    char *p = HUDPAGE + row * 40 + col + digits;
    while (digits--)
    {
        *--p = '0' + v % 10;
        v /= 10;
    }
}

// M:SS.T from a frame count: tenths = frames / fpt (5 frames a tenth on
// PAL, 6 on NTSC). fpt is a variable, not fps / 10 in the expression: the
// local Oscar64 compiled `frames / (fps / 10)` as frames / frames (its
// divmod proxy took the divisor from ACCU after the dividend was loaded
// there; build/racing-auto.asm, hud_draw), so the clock read 0:00.1.
char fpt = 5;

void hud_time(char row, char col, unsigned frames)
{
    unsigned tenths = frames / fpt;
    char *p = HUDPAGE + row * 40 + col;
    unsigned secs = tenths / 10;
    p[0] = '0' + secs / 60;
    p[1] = ':';
    hud_dec(row, col + 2, secs % 60, 2);
    p[4] = '.';
    p[5] = '0' + tenths % 10;
}

void hud_init(void)
{
    memset(HUDPAGE, 32, 1000);
    for (char c = 0; c < 40; c++)
    {
        HUDPAGE[19 * 40 + c] = 160;     // reversed space: solid
        COLOUR[19 * 40 + c] = VCOL_DARK_GREY;
    }
    for (unsigned i = 20 * 40; i < 1000; i++)
        COLOUR[i] = VCOL_WHITE;
    for (char c = 0; c < 40; c++)
        COLOUR[22 * 40 + c] = VCOL_YELLOW;
    hud_text(20, 1, "lap 1/2");
    hud_text(20, 12, "time 0:00.0");
    hud_text(20, 28, "pos 4/4");
    hud_text(21, 1, "speed 000");
    hud_text(21, 14, "l1 -:--.-");
    hud_text(21, 26, "l2 -:--.-");
    shown_lap = shown_place = shown_speed = 0xff;
    shown_times = 0;
    clk_frames = clk_div = clk[0] = clk[1] = clk[2] = clk[3] = 0;
}

// The lap clock on row 20 follows lap_frames a frame at a time, digit by
// digit (c64-kb decimal_print): no division in a frame. A new lap
// (lap_frames back below the count) starts it again from 0:00.0.
static void clock_put(void)
{
    char *p = HUDPAGE + 20 * 40 + 17;
    p[0] = '0' + clk[0];
    p[2] = '0' + clk[1];
    p[3] = '0' + clk[2];
    p[5] = '0' + clk[3];
}

static void clock_follow(void)
{
    if (lap_frames < clk_frames)
    {
        clk_frames = clk_div = clk[0] = clk[1] = clk[2] = clk[3] = 0;
        clock_put();
    }
    while (clk_frames < lap_frames)
    {
        clk_frames++;
        if (++clk_div < fpt)
            continue;
        clk_div = 0;
        if (++clk[3] == 10)
        {
            clk[3] = 0;
            if (++clk[2] == 10)
            {
                clk[2] = 0;
                if (++clk[1] == 6)
                {
                    clk[1] = 0;
                    clk[0]++;
                }
            }
        }
        clock_put();
    }
}

// Only what changed: most frames that is the clock, every fifth or sixth.
void hud_draw(void)
{
    char lap = car_lap[0] < LAPS ? car_lap[0] : LAPS - 1;
    if (lap != shown_lap)
    {
        shown_lap = lap;
        HUDPAGE[20 * 40 + 5] = '1' + lap;
    }
    while (shown_times < LAPS && lap_time[shown_times])
    {
        hud_time(21, 17 + 12 * shown_times, lap_time[shown_times]);
        shown_times++;
    }
    if (place != shown_place)
    {
        shown_place = place;
        HUDPAGE[20 * 40 + 32] = '0' + place;
    }
    char sp = car_speed[0] >> 8;
    if (sp != shown_speed)
    {
        shown_speed = sp;
        hud_dec(21, 7, sp * 48, 3);     // "km/h", in steps of 48: 11 values
    }
    if (!finished)
        clock_follow();
}
