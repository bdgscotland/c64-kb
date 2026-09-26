// main.c: FIREBASE, the run-and-gun starter (archetype vertical_run_and_gun).
//
// A soldier walks up a jungle map. The view moves only while he pushes past a
// line in the middle of the screen (threshold_scroll_v), one pixel a frame
// (soft_scroll_v), and every eighth pixel the playfield is redrawn whole from
// the raw row map (row_map_redraw). A black invalid-mode band sits over the
// fixed score panel (invalid_mode_band). Sixteen sprite slots go through a
// sorted multiplexer; free slots are parked (sprite_multiplex_game,
// sprite_slot_parking). Trees, rocks and walls stop him; the canopy covers
// him (char_attribute_flags). The loop wakes once a frame on a flag the frame
// IRQ sets (frame_sync_loop).
//
// Files: main.c (states, the frame loop, the autopilot, the meter, the
// verdict), scroll.c (map, scroll, attributes), soldier.c (the player),
// objects.c (slots, pool; enemies go here), weapons.c, collide.c (stubs for
// the next modules), flow.c (score, lives, how a game ends), front.c and
// hiscore.c (title, attract demo, game over, name entry, high-score table),
// display.c (VIC, text, panel), kernel.asm + mux.asm + sound.asm (IRQ chain,
// band, redraw, multiplexer, audio hooks). PLAN.md, "Modules", says who owns
// what.
//
// AUTOPILOT=1 replaces joystick port 2 with a script and grades the end state;
// FORCE_FAULT=1 starts the soldier 8 pixels to the right. FRONTEND=1 (make
// frontend) plays the front end instead; FORCE_OVER=1 ends every game in
// three forced deaths (flow.c).
#include "game.h"
#include "display.h"
#include "scroll.h"
#include "soldier.h"
#include "objects.h"
#include "weapons.h"
#include "collide.h"
#include "flow.h"
#include "front.h"
#include "hiscore.h"
#include "frame_meter.h"        // templates/_harness/meter
#include <string.h>

// ---- the kernel blob and the assets, each at its own address -------------------------
#pragma section( asmcode, 0 )
#pragma region( asmreg, ASM_ORG, 0x2000, , , { asmcode } )
#pragma region( main, 0x2000, 0x8000, , , { code, data, bss, heap, stack } )
#pragma section( gfxchars, 0 )
#pragma region( gfxcharsreg, 0x8800, 0x9000, , , { gfxchars } )
#pragma section( gfxmap, 0 )
#pragma region( gfxmapreg, 0x9000, 0x9f00, , , { gfxmap } )
#pragma section( gfxattr, 0 )
#pragma region( gfxattrreg, 0x9f00, 0xa000, , , { gfxattr } )
#pragma section( gfxspr, 0 )
#pragma region( gfxsprreg, 0xa000, 0xc000, , , { gfxspr } )

#pragma data( asmcode )
__export const char asm_blob[] = {
#embed "asm.bin"
};
#pragma data( gfxchars )
__export const char charset_bin[] = {
#embed "gen/charset.bin"
};
#pragma data( gfxmap )
__export const char map_bin[] = {
#embed "gen/map.bin"
};
#pragma data( gfxattr )
__export const char attr_bin[] = {
#embed "gen/attr.bin"
};
#pragma data( gfxspr )
__export const char sprites_bin[] = {
#embed "gen/sprites.bin"
};
#pragma data( data )

char state, state_next;
unsigned play_frames;
char ntsc;

static char sfx_arg;                    // a global: an absolute address for __asm

void sfx(char n)
{
    sfx_arg = n;
    __asm {
        php
        sei
        lda sfx_arg
        jsr ASM_SFX_REQUEST
        plp
    }
}

// ---- input: joystick port 2, or the autopilot's script ---------------------------------
#if AUTOPILOT
// { frames, port byte }, active low as $DC00 reads it. The title takes the
// first fire; the rest is play (PLAN.md, "Autopilot and checks"). Play frame 0
// is the second fire frame.
#ifdef MAPEND
// make mapend (-dMAPEND=1): the view starts 7 lines from the map's top with
// the soldier on the threshold. Up scrolls 7 lines, stops at the map's top,
// and he walks on through the fort's gate to SOLDIER_TOP_Y.
static const char script[][2] = {
    {   2, 0xff }, {   2, 0xef },
    { 120, 0xfe },
};
#define PLAY_FRAMES 100
#define FREEZE_YS   7
#elif defined(FRONTEND)
// make frontend (-dFRONTEND=1): the whole front end in one run. Fire on the
// title; up while flow.c's forced deaths (a death every 40 logic frames, 8,500
// points each) take the three lives; game over; the name DAB typed on the
// letter wheel; the table; the title, where it freezes and grades itself.
static const char script[][2] = {
    {   2, 0xff }, {   2, 0xef },       // title: fire starts the game
    { 130, 0xfe },                      // up: the game ends on about play frame 135
    { 200, 0xff },                      // game over (150 frames), then the entry, untouched
    {   1, 0xfe }, {   1, 0xff }, {   1, 0xfe }, {   1, 0xff }, {   1, 0xfe }, {   1, 0xff },
    {   1, 0xef }, {   1, 0xff },       // up three times, A to D; fire
    {   1, 0xef }, {   1, 0xff },       // A; fire
    {   1, 0xfe }, {   1, 0xff }, {   1, 0xef }, {   1, 0xff },   // B; fire: filed, the table
};
#define PLAY_FRAMES 60000               // never frozen in play: the title freezes it
#define FREEZE_YS   3
#else
static const char script[][2] = {
    {   2, 0xff }, {   2, 0xef },       // title: fire starts the game
    {  75, 0xfe },                      // up: 50 frames to the threshold, then the
                                        // map scrolls until the sandbags at map row 82
    {  70, 0xf7 },                      // right, past the sandbags' end, under the canopy's column
    { 250, 0xfe }, { 250, 0xfe },       // up: scroll, under the canopy
};
#define PLAY_FRAMES 236                 // freeze at the first YSCROLL 3 after this
#ifndef FREEZE_YS
#define FREEZE_YS   3                   // the text grid check.py reads (dy 0); make phases sets 0-7
#endif
#endif
#ifdef FRONTEND
#define METER_HOLD  100                 // the forced game over leaves about 120 logic frames
#define METER_ROW   19                  // under the title's verdict rows (row 20 is under the band)
#else
#define METER_HOLD  200                 // normal play frames the meter records
#endif
#define SCRIPT_LEN (sizeof(script) / 2)
static char ap_index, ap_used;

static char port_read(void)
{
    char out = 0xff;
    if (ap_index < SCRIPT_LEN) {
        out = script[ap_index][1];
        if (++ap_used == script[ap_index][0]) { ap_used = 0; ap_index++; }
    }
    return out;
}
#else
#define METER_HOLD 1
static char port_read(void)
{
    return cia1.pra;
}
#endif

#ifndef METER_ROW
#define METER_ROW 9
#endif

// ---- frames ---------------------------------------------------------------------------
// frame_sync_loop: the frame IRQ (line 250) applies what the last frame
// committed, then sets frame_flag. A frame whose commit is still pending when
// the flag comes (its work ran past line 250) waits one more frame: that is a
// lost frame, counted here and in LOST_FRAMES. The frame after a redraw starts
// late by design (the redraw ends at about line 135 on PAL, 181 on NTSC, in
// the recipe) and is not counted unless it too misses its line 250.
static char last_fc, wake_fc;
static unsigned overruns;
static char counting;
static unsigned lost_at;

static void wait_frame(void)
{
    for (;;) {
        while (!K_FRAME_FLAG) ;
        K_FRAME_FLAG = 0;
        if (!K_COMMIT)
            break;
    }
    char fc = K_FRAME_CNT;
    char lost = (char)(fc - last_fc) - 1;
    last_fc = wake_fc = fc;
#if FRAME_METER
    // The frame that records the meter's last frame also finds the median
    // (harness work, outside the brackets, longer than a frame): the count
    // stops with the recording.
    if (meter_frames >= METER_HOLD)
        counting = 0;
#endif
    if (counting && lost) {
        if (!overruns) lost_at = play_frames;
        overruns += lost;
        unsigned t = LOST_FRAMES + lost;
        LOST_FRAMES = t > 255 ? 255 : t;
    }
}

#if FRAME_METER
// The C loop's bracket is timed by CIA2 timer A (the harness meter), IRQs
// outside it by timer B (kernel.asm, every IRQ from its first instructions).
// A frame's figure is its bracket plus the IRQ time up to the next frame IRQ,
// so it is recorded one frame late. Only frames that run the game's logic are
// recorded; the redraw and the frame after it are measured apart (below).
static unsigned main_raw;
static char have_main;

static void meter_flush(void)
{
    __asm { sei }
    unsigned irq = K_IRQ_CYC - K_IRQ_CNT * K_IRQ_CAL;
    __asm { cli }
    if (have_main) {
        meter_add(main_raw);
        meter_add(irq + meter_zero);
        meter_frame();
    }
    have_main = 0;
}

static void meter_open(void)
{
    meter_flush();
    __asm { sei }
    METER_START;
    K_MTR_OPEN = 1;
    __asm { cli }
}

static void meter_close(void)
{
    __asm { sei }
    main_raw = meter_read();
    K_MTR_OPEN = 0;
    __asm { cli }
    have_main = 1;
}
#else
#define meter_flush()
#define meter_open()
#define meter_close()
#endif

// ---- the redraw ---------------------------------------------------------------------
// Row 20 of the playfield is fetched on line 208 at YSCROLL 0 (48 + 8 x 20), the
// last row the redraw writes; a row's lead over the beam shrinks row by row
// (recipe row-map-redraw), so the last row's is the smallest. rd_lead is that
// lead in lines, the smallest of the run; rd_cyc the most CIA1 timer B cycles
// one redraw took, interrupts that landed inside included.
static unsigned rd_count, rd_cyc, rd_end_line;
static int rd_lead;
static unsigned rd_late;
static char light;                      // 1: the frame after a redraw

// Where the work ended, in raster lines (9 bits). pre_end: the latest end of
// a frame's logic before a redraw, counted in lines after line 250; the
// redraw waits for the band's tick on line 224, so past 312 - 250 + 224 = 286
// (PAL) or 263 - 250 + 224 = 237 (NTSC) it starts late. light_end: the latest
// line the frame after a redraw ended on; past 250 it is lost.
static unsigned pre_end, light_end;

static unsigned raster_line(void)
{
    char hi, lo;
    do { hi = vic.ctrl1; lo = vic.raster; } while (hi != vic.ctrl1);
    return lo + ((unsigned)(hi & 0x80) << 1);
}

static void do_redraw(void)
{
    while (!K_BAND_TICK) ;              // line 224: row 20 was fetched on line 215 at the latest
    char f = K_FRAME_CNT;
    if (f != wake_fc)
        rd_late++;                      // the frame's logic ran past line 250: YSCROLL 0 already shows
    cia1.crb = 0x00;
    cia1.tb = 0xffff;
    cia1.crb = 0x11;                    // force load, start, count phi2
    scroll_redraw();
    cia1.crb = 0x00;
    unsigned c = 0xffff - cia1.tb;
    scroll_redraw_due = 0;
    light = 1;
    if (!counting)
        return;
    unsigned end = K_REDRAW_END;
    unsigned lines = ntsc ? 263 : 312;
    int lead = 208 - (int)end;
    char frames = K_REDRAW_FC - f;      // 1: it ended in the next frame, as planned
    if (frames == 0)
        lead += lines;
    else if (frames > 1)
        lead -= lines;
    rd_count++;
    if (c > rd_cyc)
        rd_cyc = c;
    if (rd_count == 1 || lead < rd_lead) {
        rd_lead = lead;
        rd_end_line = end;
    }
}

// ---- states -----------------------------------------------------------------------
// game_state_machine: ST_PLAY's entry routine is here; the front end's are in
// front.c (front_enter).
static void play_enter(void)
{
    while (!K_BAND_TICK) ;              // the redraw after the last playfield badline
    scroll_init(SCROLL_START_TOP, SCROLL_START_YS);
    playfield_colour();
    flow_new_game();
    panel_draw();
    soldier_reset();
#ifdef MAPEND
    scroll_init(0, 0);                  // map y 7 on line 55
    soldier_y = SOLDIER_THRESH;
#endif
    objects_reset();
    weapons_reset();
    play_frames = 0;
    light = 0;
    state = ST_PLAY;
    front_play_begun();                 // the demo's label; the trail in FRONTEND builds
#if FRAME_METER
    meter_init((unsigned)SCRATCH, METER_ROW, 1, PF_CRAM, METER_HOLD);
    have_main = 0;
#endif
}

// The entry routine of the state a module asked for (game_state_machine),
// before the next frame.
static void state_enter(char s)
{
    if (s == ST_PLAY)
        play_enter();
    else if (s == ST_FROZEN)
        state = ST_FROZEN;
    else
        front_enter(s);
    state_next = state;
}

static void actors_commit(char what)
{
    __asm {
        jsr ASM_MUX_SORT
        jsr ASM_MUX_BUILD
    }
    K_COMMIT = what;                    // one store: the frame IRQ applies both halves at once
}

// One frame of play. The order: the soldier (who may scroll the map), the
// objects on the new view, the weapons, the collisions, the rules; then every
// slot and the commit, which the frame IRQ applies at line 250 with YSCROLL.
static void play_frame(char joy)
{
    char top = scroll_top;
    soldier_update(joy);
    if (scroll_top != top)
        objects_rows(scroll_top);
    objects_update();
    weapons_update(joy);
    collide();
    flow_frame();
    soldier_draw();
    objects_draw();
    actors_commit(COMMIT_YS | COMMIT_MUX);
}

// The frame after a redraw starts late (the redraw ran over the top of the
// screen). It runs no game logic (row_map_redraw, "How" step 6): the scroll
// keeps its pace, and the sprite table stays as committed.
static void light_frame(void)
{
    soldier_repeat_step();
    objects_scroll();
    K_COMMIT = COMMIT_YS;
    light = 0;
}

#if AUTOPILOT
// ---- the verdict, after the script -----------------------------------------------------
// Expected values: PLAN.md, "Autopilot and checks", derives each one.
#define EXPECT_X        238
#define EXPECT_Y        SOLDIER_THRESH
#define EXPECT_WY       500             // map y on line 55: top 62, YSCROLL 3
#define EXPECT_BLOCKED  12
#define EXPECT_STEPS    107
#define EXPECT_REDRAWS  13
#define MIN_LEAD        8               // lines of margin over the beam the redraw must keep

static char verdict_code;

#define CHECK(c) if (!(c)) return n; n++;

static bool screen_is_map(void)
{
    return memcmp(SCREEN, MAP + 40 * scroll_top, 40 * PF_ROWS) == 0;
}

static char hw_d011;

#if defined(FRONTEND)
// make frontend: title, play, game over, entry, table, title; the table filed
// by rank; the panel followed the game; the front end shows no play sprite
// and no panel digits. PLAN.md, "Front end", derives each value.
static const char fe_expect_table[HS_TABLEN] = {
    'F' - 64, 'B' - 64, 'S' - 64, 0x05, 0x00, 0x00,
    'K' - 64, 'B' - 64, 'A' - 64, 0x04, 0x00, 0x00,
    'C' - 64, '6', '4',           0x03, 0x00, 0x00,
    'D' - 64, 'A' - 64, 'B' - 64, 0x02, 0x55, 0x00,    // the new row, fourth
    'S' - 64, 'I' - 64, 'D' - 64, 0x02, 0x00, 0x00,    // VIC's 10,000 dropped
};

static char panel_has_digit(void)
{
    for (unsigned i = 0; i < 3 * 40; i++)
        if (PANEL[i] >= '0' && PANEL[i] <= '9')
            return 1;
    return 0;
}

static char first_fail(void)
{
    char n = 1;
    CHECK(overruns == 0 && rd_late == 0)                    // 1 no play frame lost, no redraw late
    CHECK(memcmp(fe_trail, "TPOEHT", 7) == 0)               // 2 the states, in order
    CHECK(score[0] == 0x02 && score[1] == 0x55 && score[2] == 0 && lives == 0)   // 3 three deaths, 25,500
    CHECK(memcmp(fe_over_panel, "0255000", 7) == 0)         // 4 the panel showed it as the game ended
    CHECK(fe_rank == 3)                                     // 5 ranked fourth
    CHECK(memcmp(hs_table, fe_expect_table, HS_TABLEN) == 0)   // 6 filed there, the rows below shifted
    CHECK(K_MUX_SHOWN == 0)                                 // 7 the title shows no sprite
    CHECK(!panel_has_digit())                               // 8 and no score, lives or grenade digits
    CHECK((hw_d011 & 0x7f) == 0x13)                         // 9 the front end's YSCROLL 3
    return 0;
}

// The verdict under the title's logo, prompt and top score: rows 14-18, the
// meter on 19 (row 20 is under the band at YSCROLL 3).
static void verdict(void)
{
    char fail = first_fail();
    char ok = fail == 0;
    verdict_code = ok ? 1 : 2;
    RESULT = verdict_code;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    char *s = SCREEN;
    put_text(s, 14, 1, ok ? "RESULT 01 PASS   " : "RESULT 02 FAIL 00");
    if (!ok)
        put_dec(s + 14 * 40 + 16, fail, 2);
    put_text(s, 15, 1, "TRAIL ...... RANK 0 ... ......");
    for (char i = 0; i < 6 && fe_trail[i]; i++)
        s[15 * 40 + 7 + i] = fe_trail[i] - 64;
    s[15 * 40 + 19] = '1' + fe_rank;
    const char *row = hs_table + (fe_rank < HS_ROWS ? fe_rank : 0) * HS_ROWLEN;
    memcpy(s + 15 * 40 + 21, row, 3);
    put_bcd(s + 15 * 40 + 25, row + 3, 3);
    put_text(s, 16, 1, "PANEL ...... . SHOWN 0 LOST 00");
    memcpy(s + 16 * 40 + 7, fe_over_panel, 6);
    s[16 * 40 + 14] = fe_over_panel[6];
    put_dec(s + 16 * 40 + 22, K_MUX_SHOWN, 1);
    put_dec(s + 16 * 40 + 29, overruns, 2);
    put_text(s, 17, 1, "FE 00000 IN 00000 HS 00000 FL 00000");
    put_dec(s + 17 * 40 + 4, fe_frame_max, 5);
    put_dec(s + 17 * 40 + 13, fe_enter_max, 5);
    put_dec(s + 17 * 40 + 22, fe_hs_cyc, 5);
    put_dec(s + 17 * 40 + 31, fe_flow_max, 5);
    put_text(s, 18, 1, "AT");
    for (char i = 0; i < 6; i++)
        put_dec(s + 18 * 40 + 4 + 5 * i, fe_trail_at[i], 4);
    for (char r = 14; r < 20; r++)
        text_colour(r, 1, 38, TEXT_CRAM);
}
#elif defined(MAPEND)
static char first_fail(void)
{
    char n = 1;
    CHECK(overruns == 0 && rd_late == 0)                    // 1 no frame lost, no redraw late
    CHECK(scroll_wy == 0 && scroll_top == 0 && scroll_ys == 7)  // 2 the view stopped at the map's top
    CHECK(scroll_steps == 7)                                // 3 ... after 7 lines
    CHECK(soldier_y == SOLDIER_TOP_Y && soldier_x == 168)   // 4 he walked on to the top limit
    CHECK(soldier_blocked == 0)                             // 5 through the gate, nothing in his way
    CHECK(rd_count == 0)                                    // 6 YSCROLL 0 to 7: no wrap, no redraw
    CHECK(screen_is_map())                                  // 7 the screen holds map rows 0-20
    CHECK((hw_d011 & 0x7f) == 0x17 && K_CUR_YS == 7)        // 8 the frame IRQ applied YSCROLL 7
    return 0;
}
#else
static char first_fail(void)
{
    char n = 1;
    CHECK(overruns == 0 && rd_late == 0)                    // 1 no frame lost, no redraw late
    CHECK(soldier_x == EXPECT_X && soldier_y == EXPECT_Y)   // 2 the soldier where the script leaves him
    CHECK(scroll_wy == EXPECT_WY && scroll_steps == EXPECT_STEPS)   // 3 the scroll followed him
    CHECK(soldier_blocked == EXPECT_BLOCKED)                // 4 the sandbags stopped him
    CHECK(soldier_behind == 1 && SLOT_PRI[SLOT_SOLDIER])    // 5 under the canopy: behind
    CHECK(rd_count == EXPECT_REDRAWS)                       // 6 one redraw per 8 steps
    CHECK(rd_lead >= MIN_LEAD)                              // 7 every redraw beat the beam
    CHECK(screen_is_map())                                  // 8 the screen holds the map from scroll_top
    CHECK((hw_d011 & 0x7f) == 0x13 && K_CUR_YS == 3)        // 9 the frame IRQ applied YSCROLL 3
    CHECK(K_MUX_SHOWN == 1)                                 // 10 one sprite: every other slot parked
    return 0;
}
#endif

#ifndef FRONTEND
static void verdict(void)
{
    char fail = first_fail();
    char ok = fail == 0;
    verdict_code = ok ? 1 : 2;
    RESULT = verdict_code;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    char *s = SCREEN;
    put_text(s, 3, 1, ok ? "RESULT 01 PASS   " : "RESULT 02 FAIL 00");
    if (!ok)
        put_dec(s + 3 * 40 + 16, fail, 2);
    put_text(s, 4, 1, "X 000 Y 000 WY 000 ST 000");
    put_dec(s + 4 * 40 + 3, soldier_x, 3);
    put_dec(s + 4 * 40 + 9, soldier_y, 3);
    put_dec(s + 4 * 40 + 16, scroll_wy, 3);
    put_dec(s + 4 * 40 + 23, scroll_steps, 3);
    put_text(s, 5, 1, "BLK 00 BEHIND 00 RD 00");
    put_dec(s + 5 * 40 + 5, soldier_blocked, 2);
    put_dec(s + 5 * 40 + 15, soldier_behind_frames, 2);
    put_dec(s + 5 * 40 + 21, rd_count, 2);
    put_text(s, 6, 1, "RDC 00000 END 000 LD 000");
    put_dec(s + 6 * 40 + 5, rd_cyc, 5);
    put_dec(s + 6 * 40 + 15, rd_end_line, 3);
    put_dec(s + 6 * 40 + 22, rd_lead < 0 ? 0 : rd_lead, 3);
    put_text(s, 7, 1, "LOST 00 AT 000 LATE 00");
    put_dec(s + 7 * 40 + 6, overruns, 2);
    put_dec(s + 7 * 40 + 12, lost_at, 3);
    put_dec(s + 7 * 40 + 21, rd_late, 2);
    put_text(s, 8, 1, "SHOWN 0 PRE 000 LF 000");
    put_dec(s + 8 * 40 + 7, K_MUX_SHOWN, 1);
    put_dec(s + 8 * 40 + 13, pre_end, 3);
    put_dec(s + 8 * 40 + 20, light_end, 3);
    text_colour(3, 1, 17, TEXT_CRAM);
    text_colour(4, 1, 25, TEXT_CRAM);
    text_colour(5, 1, 22, TEXT_CRAM);
    text_colour(6, 1, 24, TEXT_CRAM);
    text_colour(7, 1, 22, TEXT_CRAM);
    text_colour(8, 1, 22, TEXT_CRAM);
    text_colour(9, 1, 20, TEXT_CRAM);
}
#endif
#endif

// PAL has 312 lines, NTSC 263: the largest line past 255 tells them apart.
static char is_ntsc(void)
{
    char top = 0;
    for (unsigned i = 0; i < 20000; i++) {
        if (vic.ctrl1 & 0x80) {
            char l = vic.raster;
            if (l > top) top = l;
        }
    }
    return top < 0x20;
}

int main(void)
{
    __asm { sei }
    ntsc = is_ntsc();
    cia1.pra = 0xff;                    // no keyboard column selected
    display_init();
    scroll_init(SCROLL_START_TOP, SCROLL_START_YS);
    front_init();
    flow_new_game();
    front_enter(ST_TITLE);
    state_next = ST_TITLE;
    LOST_FRAMES = 0;
#if FRAME_METER
    meter_init((unsigned)SCRATCH, METER_ROW, 1, PF_CRAM, METER_HOLD);
    K_MTR_OPEN = 0;                     // IRQs time themselves (timer B)
    K_BYTE(ASM_MTR_ON) = 1;             // the frame IRQ hands their sum to C
#else
    K_MTR_OPEN = 1;                     // no meter: IRQs never touch timer B
#endif
    __asm {
        jsr ASM_KERNEL_INIT
        cli
    }
    last_fc = K_FRAME_CNT;

    for (;;) {
        wait_frame();
        K_BAND_TICK = 0;
        char joy = port_read();
        switch (state) {
        case ST_PLAY:
            joy = front_play_joy(joy);  // the demo's recording in the attract demo
            counting = play_frames > 1;
#if AUTOPILOT
            counting = counting && play_frames < PLAY_FRAMES + 16;
#endif
#if AUTOPILOT
            // Freeze on the text grid's YSCROLL; a run that never gets there
            // (a fault build stopped by a trunk) freezes 40 frames later, red.
            if (play_frames >= PLAY_FRAMES && !light &&
                ((scroll_ys == FREEZE_YS && K_CUR_YS == FREEZE_YS) || play_frames >= PLAY_FRAMES + 40)) {
                state = state_next = ST_FROZEN;
                meter_flush();
                break;
            }
#endif
            if (light) {
                meter_flush();          // the frame before the redraw is recorded; this one is not
                light_frame();
                unsigned l = raster_line();
                if (counting && l < 250 && l > light_end)
                    light_end = l;
            } else {
                meter_open();
                play_frame(joy);
                meter_close();
                if (scroll_redraw_due && counting) {
                    unsigned l = raster_line();
                    l = l >= 250 ? l - 250 : l + (ntsc ? 263 : 312) - 250;
                    if (l > pre_end)
                        pre_end = l;
                }
                if (scroll_redraw_due)
                    do_redraw();
            }
            play_frames++;
            break;
#if AUTOPILOT
        case ST_FROZEN:
            if (!verdict_code) {
                hw_d011 = vic.ctrl1;    // the playfield's value until line 211
                verdict();
#ifdef PHASES
                // make phases: the soldier at the lowest Y a sprite may take
                // (last line 208), so the band's stores are checked with sprite
                // DMA on the lines just above them.
                soldier_y = SOLDIER_MAX_Y;
                soldier_draw();
                actors_commit(COMMIT_MUX);
#endif
            }
            memcpy(SCREEN + METER_ROW * 40 + 1, SCRATCH + METER_ROW * 40 + 1, 20);
            break;
#endif
        default:                        // ST_TITLE, ST_TABLE, ST_OVER, ST_ENTRY (front.c)
            front_frame(joy);
            actors_commit(COMMIT_YS | COMMIT_MUX);   // parked slots, the front end's YSCROLL
            break;
        }
        if (state_next != state)
            state_enter(state_next);
        if (state != ST_PLAY)
            meter_print();
    }
    return 0;
}
