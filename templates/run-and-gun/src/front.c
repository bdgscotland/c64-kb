// front.c: see front.h.
#include "front.h"
#include "display.h"
#include "hiscore.h"
#include "objects.h"
#include "flow.h"
#include "area.h"
#include <string.h>

char demo;

static const char logo[] = {
#embed "gen/logo.bin"
};
// The logo's rows, top to bottom: five letter rows and the shadow's (hires colours: below 8).
static const char logo_colour[LOGO_H] = { VCOL_WHITE, VCOL_YELLOW, VCOL_YELLOW, VCOL_RED, VCOL_RED, VCOL_BLACK };

#define FRONT_YS 3                      // YSCROLL of every front-end screen: the usual text grid

static unsigned st_frames;              // frames in the current state
static char prev_joy;                   // last frame's port byte (joystick_edge_detect)
static char armed;                      // 0 until every line is released after an entry
static char table_then;                 // ST_TABLE's idle exit: 1 the demo, 0 the title
static char table_mark;                 // the row just entered, drawn yellow; HS_ROWS none
static char rank;                       // hs_rank of the game that just ended
static char name[3], cursor, held, hold_count;
static unsigned idle;

#if AUTOPILOT && defined(FRONTEND)
char fe_trail[TRAIL_MAX + 1], fe_trail_len;
unsigned fe_trail_at[TRAIL_MAX];
char fe_over_panel[7];
char fe_rank = 0xff;
unsigned fe_frame_max, fe_enter_max, fe_hs_cyc, fe_flow_max;
static unsigned fe_clock;

static void trail(char c)
{
    if (fe_trail_len < TRAIL_MAX) {
        fe_trail_at[fe_trail_len] = fe_clock;
        fe_trail[fe_trail_len++] = c;
    }
}
#else
#define trail(c)
#endif

// The demo's recording: { frames, port byte } as $DC00 reads it, active low;
// a count of 0 ends it (attract_mode_input_replay). Up to the sandbags, round
// them, up under the canopy, a step left, up again.
static const char demo_rec[][2] = {
    { 75, 0xfe }, { 70, 0xf7 }, { 150, 0xfe }, { 40, 0xfb }, { 150, 0xfe }, { 0, 0xff },
};
static char demo_i, demo_used;


// ---- drawing -----------------------------------------------------------------------
// Spaces only: a space has no pixel set, so its colour RAM does not show and
// is left as it was; every text sets its own cells' colours (text_at), and
// main.c's play_enter puts the playfield's back.
static void clear_playfield(void)
{
    for (char i = 0; i < PF_ROWS * 5; i++) {    // eight stores a pass: 840 cells
        SCREEN[i] = ' ';
        SCREEN[i + PF_ROWS * 5] = ' ';
        SCREEN[i + PF_ROWS * 10] = ' ';
        SCREEN[i + PF_ROWS * 15] = ' ';
        SCREEN[i + PF_ROWS * 20] = ' ';
        SCREEN[i + PF_ROWS * 25] = ' ';
        SCREEN[i + PF_ROWS * 30] = ' ';
        SCREEN[i + PF_ROWS * 35] = ' ';
    }
}

static void text_at(char row, char col, const char *t, char colour)
{
    put_text(SCREEN, row, col, t);
    text_colour(row, col, strlen(t), colour);
}

// The logo as screen codes and colours, built once from logo.bin, then copied
// a column at a time: constant bases, every access abs,X (the cell-by-cell
// test of logo.bin took 11,023 cycles, measured; this copy is in PLAN.md).
#define LOGO_AT (1 * 40 + 4)            // row 1, column 4
static char logo_chr[LOGO_H * LOGO_W], logo_col[LOGO_H * LOGO_W];

static void logo_build(void)
{
    for (char y = 0; y < LOGO_H; y++)
        for (char x = 0; x < LOGO_W; x++) {
            char v = logo[y * LOGO_W + x];
            logo_chr[y * LOGO_W + x] = v ? G_SOLID : ' ';
            logo_col[y * LOGO_W + x] = v == 1 ? logo_colour[y] : VCOL_BLACK;
        }
}

#define LOGO_CELL(y) \
    SCREEN[LOGO_AT + (y) * 40 + x] = logo_chr[(y) * LOGO_W + x]; \
    COLOUR[LOGO_AT + (y) * 40 + x] = logo_col[(y) * LOGO_W + x];

static void draw_logo(void)
{
    for (char x = 0; x < LOGO_W; x++) {
        LOGO_CELL(0) LOGO_CELL(1) LOGO_CELL(2) LOGO_CELL(3) LOGO_CELL(4) LOGO_CELL(5)
    }
}

void front_init(void)
{
    hs_seed();
    logo_build();
    prev_joy = 0xff;
}

// "1  050000  FBS" from a table row.
static void draw_hs_row(char row, char col, char r, char colour)
{
    const char *t = hs_table + r * HS_ROWLEN;
    char *s = SCREEN + row * 40 + col;
    s[0] = '1' + r;
    put_bcd(s + 3, t + 3, 3);
    s[11] = t[0];
    s[12] = t[1];
    s[13] = t[2];
    text_colour(row, col, 14, colour);
}

static void title_draw(void)
{
    draw_logo();
    text_at(9, 11, "PUSH FIRE TO START", VCOL_WHITE);
    text_at(11, 12, "JOYSTICK PORT 2", VCOL_CYAN);
    text_at(13, 13, "TOP 000000 ...", VCOL_YELLOW);
    put_bcd(SCREEN + 13 * 40 + 17, hs_table + 3, 3);
    memcpy(SCREEN + 13 * 40 + 24, hs_table, 3);
}

static void table_draw(void)
{
    text_at(2, 14, "HIGH SCORES", VCOL_CYAN);
    for (char r = 0; r < HS_ROWS; r++)
        draw_hs_row(5 + 2 * r, 13, r, r == table_mark ? VCOL_YELLOW : VCOL_WHITE);
    text_at(17, 15, "PUSH FIRE", VCOL_WHITE);
}

static void over_draw(void)
{
    text_at(9, 15, "GAME OVER", VCOL_WHITE);
    text_at(11, 14, "SCORE 000000", VCOL_WHITE);
    put_bcd(SCREEN + 11 * 40 + 20, score, 3);
}

static void entry_letters(void)
{
    for (char i = 0; i < 3; i++) {
        SCREEN[12 * 40 + 17 + 2 * i] = name[i];
        SCREEN[13 * 40 + 17 + 2 * i] = i == cursor ? '-' : ' ';
        COLOUR[12 * 40 + 17 + 2 * i] = i == cursor ? VCOL_YELLOW : VCOL_WHITE;
    }
}

static void entry_draw(void)
{
    text_at(3, 13, "NEW HIGH SCORE", VCOL_YELLOW);
    text_at(6, 10, "SCORE 000000  RANK 0", VCOL_WHITE);
    put_bcd(SCREEN + 6 * 40 + 16, score, 3);
    SCREEN[6 * 40 + 29] = '1' + rank;
    text_at(9, 10, "ENTER YOUR INITIALS", VCOL_WHITE);
    text_colour(13, 17, 5, VCOL_YELLOW);
    text_at(16, 3, "UP/DOWN LETTER  FIRE OK  LEFT BACK", VCOL_CYAN);
    entry_letters();
}

// ---- entry routines ----------------------------------------------------------------
void front_enter(char st)
{
#if AUTOPILOT && defined(FRONTEND)
    cyc_start();
#endif
    state = st;
    st_frames = 0;
    armed = 0;                          // the press that ended the last state starts nothing
    idle = 0;
    slots_park_all();                   // no play sprite on a front-end screen
    area_begin(0);                      // the first area's colours (a game may end in another)
    K_PEND_YS = FRONT_YS;               // committed with the parked slots (main.c)
#if AUTOPILOT && defined(FRONTEND)
    if (st == ST_OVER) {                // what flow_frame left on the panel
        memcpy(fe_over_panel, SCREEN + PANEL_ROW * 40 + 8, 6);
        fe_over_panel[6] = SCREEN[(PANEL_ROW + 2) * 40 + 8];
    }
#endif
    clear_playfield();
    panel_front();
    switch (st) {                       // the screen is drawn on the state's first frame
    case ST_TITLE:
        demo = 0;
        trail('T');
        break;
    case ST_TABLE:
        trail('H');
        break;
    case ST_OVER:
        trail('O');
        rank = hs_rank(score);
        break;
    case ST_ENTRY:
        trail('E');
        name[0] = 'A' - 64;
        name[1] = name[2] = '.';
        cursor = 0;
        held = 0;
        break;
    }
#if AUTOPILOT && defined(FRONTEND)
    unsigned c = cyc_stop();
    if (c > fe_enter_max)
        fe_enter_max = c;
#endif
}

void front_play_begun(void)
{
    if (demo) {
        demo_i = demo_used = 0;
        armed = 0;
        put_text(SCREEN, PANEL_ROW + 1, 18, "DEMO");
        text_colour(PANEL_ROW + 1, 18, 4, VCOL_YELLOW);
    }
    trail(demo ? 'D' : 'P');
}

// ---- per frame ---------------------------------------------------------------------
// joystick_edge_detect: lines low now and high last frame. Nothing counts
// until every line has been seen released since the state began.
static char new_presses(char joy)
{
    char pressed = ~joy & 0x1f;
    char fresh = pressed & prev_joy;
    prev_joy = joy;
    if (!armed) {
        armed = pressed == 0;
        return 0;
    }
    return fresh;
}

static void start_game(void)
{
    demo = 0;
    state_next = ST_PLAY;
}

// The file: the typed letters into the row at the rank, the rows below
// shifted (hiscore.c), then the table with that row marked.
static void entry_close(void)
{
    for (char i = cursor; i < 3; i++)   // closed early: the letters typed so far
        name[i] = '.';
#if AUTOPILOT && defined(FRONTEND)
    fe_rank = rank;
    cyc_start();
#endif
    hs_place(rank, score, name);
#if AUTOPILOT && defined(FRONTEND)
    fe_hs_cyc = cyc_stop();
#endif
    table_mark = rank;
    table_then = 0;
    state_next = ST_TABLE;
}

// The letter wheel: A-Z then '.', up for the next, down for the one before;
// a held direction repeats after REPEAT_DELAY frames every REPEAT_RATE.
static char wheel(char c, char up)
{
    if (up)
        return c == '.' ? 1 : (c == 26 ? '.' : c + 1);
    return c == 1 ? '.' : (c == '.' ? 26 : c - 1);
}

static void entry_frame(char joy, char fresh)
{
    char ud = ~joy & (JOY_UP | JOY_DOWN);
    char step = 0;
    if (!armed)
        ud = 0;
    if (ud && ud == held) {
        if (++hold_count >= REPEAT_DELAY) {
            hold_count = REPEAT_DELAY - REPEAT_RATE;
            step = 1;
        }
    } else {
        held = ud;
        hold_count = 0;
        step = ud != 0;
    }
    if (fresh || ud)
        idle = 0;
    else if (++idle >= ENTRY_IDLE) {
        entry_close();
        return;
    }
    if (step && (ud == JOY_UP || ud == JOY_DOWN))
        name[cursor] = wheel(name[cursor], ud == JOY_UP);
    if (fresh & (JOY_FIRE | JOY_RIGHT)) {
        if (++cursor == 3) {
            entry_close();
            return;
        }
        name[cursor] = 'A' - 64;
    } else if ((fresh & JOY_LEFT) && cursor) {
        name[cursor] = '.';
        cursor--;
    }
    entry_letters();
}

void front_frame(char joy)
{
#if AUTOPILOT && defined(FRONTEND)
    fe_clock++;
    cyc_start();
#endif
    char fresh = new_presses(joy);
    if (st_frames++ == 0) {
        // The entry routine cleared the screen; its text comes a frame later,
        // so neither half runs past the next frame IRQ (PLAN.md, "Front end").
        switch (state) {
        case ST_TITLE: title_draw(); break;
        case ST_TABLE: table_draw(); break;
        case ST_OVER:  over_draw();  break;
        case ST_ENTRY: entry_draw(); break;
        }
        fresh = 0;
    }
    switch (state) {
    case ST_TITLE:
        if (fresh & JOY_FIRE)
            start_game();
        else if (st_frames >= TITLE_IDLE) {
            table_mark = HS_ROWS;
            table_then = 1;
            state_next = ST_TABLE;
        }
#if AUTOPILOT && defined(FRONTEND)
        if (fe_trail_len >= 3 && st_frames >= 40)
            state_next = ST_FROZEN;     // back on the title after a game: the verdict
#endif
        break;
    case ST_TABLE:
        if (fresh & JOY_FIRE)
            start_game();
        else if (st_frames >= TABLE_IDLE) {
            if (table_then) {
                demo = 1;
                state_next = ST_PLAY;
            } else
                state_next = ST_TITLE;
        }
        break;
    case ST_OVER:
        if (st_frames >= OVER_FRAMES || (st_frames >= OVER_MIN && (fresh & JOY_FIRE)))
            state_next = rank < HS_ROWS ? ST_ENTRY : ST_TITLE;
        break;
    case ST_ENTRY:
        entry_frame(joy, fresh);
        break;
    }
#if AUTOPILOT && defined(FRONTEND)
    unsigned c = cyc_stop();
    if (c > fe_frame_max)
        fe_frame_max = c;
#endif
}

// ST_PLAY's stick. In the demo the recording drives the soldier and the port
// only ends it: a fresh fire press, or the recording's end, goes to the title.
char front_play_joy(char joy)
{
#if AUTOPILOT && defined(FRONTEND)
    fe_clock++;
#endif
    if (!demo)
        return joy;
    char fresh = new_presses(joy);
    if ((fresh & JOY_FIRE) || demo_rec[demo_i][0] == 0) {
        state_next = ST_TITLE;
        return 0xff;
    }
    char out = demo_rec[demo_i][1];
    if (++demo_used == demo_rec[demo_i][0]) {
        demo_used = 0;
        demo_i++;
    }
    return out;
}
