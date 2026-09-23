// main.c: shmup-vertical, a vertically scrolling shoot-em-up starter.
//
// The river scrolls down through all eight YSCROLL phases above a fixed
// score panel. The ship is a sprite; up to twelve enemies and the ship go
// through a sprite multiplexer; waves start at map rows; bullets are
// characters; hits are boxes; effects play inside the tune; the high score
// is kept on drive 8.
//
// Files: main.c (states, the ship, the frame loop, the autopilot and its
// verdict), level.c (map and scroll), waves.c (waves, paths, enemy pool),
// bullets.c (character bullets), hitbox.c (collision), display.c (art, text,
// panel), hiscore.c (the file), kernel.asm + mux.asm + sound.asm (IRQ chain,
// panel split, multiplexer, music and effects, in KickAssembler).
//
// AUTOPILOT=1 replaces joystick port 2 with a script and grades the end
// state; FORCE_FAULT=1 starts the ship 16 pixels to the right, so its shots,
// its score and its end position all change.
#include "game.h"
#include "display.h"
#include "level.h"
#include "waves.h"
#include "bullets.h"
#include "hitbox.h"
#include "hiscore.h"
#include "frame_meter.h"        // templates/_harness/meter
#include <string.h>

// ---- the kernel blob at its own address --------------------------------------
#pragma section( asmcode, 0 )
#pragma region( asmreg, ASM_ORG, 0x2000, , , { asmcode } )
#pragma region( main, 0x2000, 0x8000, , , { code, data, bss, heap, stack } )
#pragma data( asmcode )
__export const char asm_blob[] = {
#embed "asm.bin"
};
#pragma data( data )

char state;
char lives, deaths;
unsigned score, hiscore;
unsigned play_frames;

#define JOY_UP    0x01
#define JOY_DOWN  0x02
#define JOY_LEFT  0x04
#define JOY_RIGHT 0x08
#define JOY_FIRE  0x10

// ---- the ship ------------------------------------------------------------------
#define P_START_HX (84 + 8 * FORCE_FAULT)   // half X: sprite X 168
#define P_START_Y  170
#define P_MIN_HX   12
#define P_MAX_HX   160
#define P_MIN_Y    110
#define P_MAX_Y    180                      // below MAX_SY (187)
#define P_SAFE     100                      // frames the ship is safe after a loss
#define P_COOL     6                        // frames between shots

static char p_hx, p_y, p_safe, p_cool;

static void ship_reset(void)
{
    p_hx = P_START_HX;
    p_y = P_START_Y;
    p_cool = 0;
}

static void ship_update(char joy)
{
    if (!(joy & JOY_LEFT)  && p_hx > P_MIN_HX) p_hx--;
    if (!(joy & JOY_RIGHT) && p_hx < P_MAX_HX) p_hx++;
    if (!(joy & JOY_UP)    && p_y > P_MIN_Y)   p_y -= 2;
    if (!(joy & JOY_DOWN)  && p_y < P_MAX_Y)   p_y += 2;
    if (p_cool)
        p_cool--;
    else if (!(joy & JOY_FIRE) && bullet_fire(p_hx + 6, p_y)) {
        p_cool = P_COOL;
        sfx(1);
    }
    if (p_safe)
        p_safe--;
}

// ---- hits (hitbox.c reports them) ---------------------------------------------------
void on_enemy_shot(char e, char bullet)
{
    bullet_kill(bullet);
    add_score(enemy_points(e));
    enemy_explode(e);
    sfx(2);
}

void on_player_hit(char e)
{
    box_off(BOX_PLAYER);                    // one loss a frame at most
    enemy_explode(e);
    deaths++;
    lives--;
    sfx(3);
    if (lives == 0) {
        state = ST_OVER;
        return;
    }
    ship_reset();
    p_safe = P_SAFE;
}

void add_score(char tens)
{
    score += tens;
    if (score > hiscore)
        hiscore = score;
    panel_add(tens);
}

static char sfx_arg, ntsc_arg;             // globals: absolute addresses for __asm

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

// ---- the multiplexer's actor table, and the boxes where they are drawn -----------------
// Actor 0 is the ship; actors 1-12 are the enemies, which waves.c writes in
// place. The ship's box is emitted here, where it is handed to the display;
// collide() reads the enemies' boxes from the same table next frame, so it
// tests what was on screen.
static void actors_draw(void)
{
    bool ship = state == ST_PLAY || state == ST_FROZEN;
    ACT_Y[0] = ship && !(p_safe & 4) ? p_y : OFF_Y;         // blinks while safe
    ACT_HX[0] = p_hx;
    if (ship && !p_safe)
        box_ship(p_hx, p_y);
    else
        box_off(BOX_PLAYER);
    __asm {
        jsr ASM_MUX_SORT
        jsr ASM_MUX_BUILD
    }
}


// ---- input: joystick port 2, or the autopilot's script ---------------------------------
#if AUTOPILOT
// { frames, port byte }, active low as $DC00 reads it. The title takes the
// first fire; the rest is play. See PLAN.md "Autopilot and checks".
#define PLAY_FRAMES 240
#ifdef LOOP_TEST
// Test only (-dLOOP_TEST=1): start, then hold fire without moving, so the
// game scores, runs to GAME OVER, saves the high score and returns to the
// title. It never freezes, so there is no verdict.
static const char script[][2] = {
    {   2, 0xff }, {   2, 0xef }, { 250, 0xef }, { 250, 0xef }, { 250, 0xef },
    { 250, 0xef }, { 250, 0xef }, { 250, 0xef }, { 250, 0xef }, { 250, 0xef }
};
#define FREEZE_Y 8
#else
static const char script[][2] = {
    {   2, 0xff }, {   2, 0xef },               // title: fire starts the game
    {  24, 0xeb }, {  10, 0xef },               // left and fire: shoot the darts there
    {  24, 0xf7 }, {  30, 0xff },               // back to the start, hold fire: a dart rams
    {  16, 0xeb }, {  32, 0xe7 }, { 16, 0xeb }, // fire and sweep left, right, back
    {  20, 0xff },                              // hold fire: the parade comes down
    {  40, 0xef },                              // fire through the gap between two columns
    {  24, 0xfb }, {   3, 0xfd },               // move left, then down
};
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
#define PLAY_FRAMES 1
static char port_read(void)
{
    return cia1.pra;
}
#endif

// ---- frames ------------------------------------------------------------------------
static void wait_frame(void)
{
    while (!K_FRAME_FLAG) ;
    K_FRAME_FLAG = 0;
}

#if FRAME_METER
// The C main loop's bracket is timed by CIA2 timer A (the harness meter);
// IRQs outside it by timer B (kernel.asm). A frame's figure is the loop's
// bracket plus the IRQ time up to the next frame IRQ, so it is recorded one
// frame late, when that IRQ has handed its sum over.
static unsigned main_raw;
static char have_main;

// The split IRQ runs from its vector to its timer B start untimed, to keep
// the recipe's timing: 245-289 cycles on PAL and 246-296 on NTSC, from the
// IRQ sequence to the start write, measured under the VICE monitor over a
// whole autopilot run. The larger figure is added for every frame in which
// the split timed itself.
#define SPLIT_PRE_PAL  289
#define SPLIT_PRE_NTSC 296

static void meter_open(void)
{
    __asm { sei }
    unsigned irq = K_IRQ_CYC - K_IRQ_CNT * K_IRQ_CAL;
    char split = K_SPLIT_PREV;
    __asm { cli }
    if (split)
        irq += ntsc_arg ? SPLIT_PRE_NTSC : SPLIT_PRE_PAL;
    if (have_main) {
        meter_add(main_raw);
        meter_add(irq + meter_zero);
        meter_frame();
    }
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
#define meter_open()
#define meter_close()
#endif

// ---- states -----------------------------------------------------------------------
static void title_enter(void)
{
    state = ST_TITLE;
    bullets_erase();
    bullets_reset();
    waves_reset();
    level_show(0, 3);
    memset(COLOUR, PF_CRAM, 21 * 40);           // no text left from a game over
    char *s = level_screen();
    put_text(s, 6, 11, " DELTA  PATROL ");
    put_text(s, 9, 9, " PUSH FIRE TO START ");
    put_text(s, 12, 11, " JOYSTICK PORT 2 ");
    text_colour(6, 11, 15, VCOL_YELLOW);
    text_colour(9, 9, 20, TEXT_CRAM);
    text_colour(12, 11, 17, VCOL_LT_GREY);
}

static void play_enter(void)
{
    memset(COLOUR, PF_CRAM, 21 * 40);           // every playfield cell multicolour
    score = 0;
    lives = START_LIVES;
    deaths = 0;
    play_frames = 0;
    panel_draw();
    p_safe = 0;
    ship_reset();
    bullets_reset();
    waves_reset();
    level_show(0, 0);
    state = ST_PLAY;
#if FRAME_METER
    meter_init((unsigned)SCRATCH, 13, 10, PF_CRAM, PLAY_FRAMES);
#endif
}

static char over_timer;

static unsigned disk_hi;                        // the high score the file holds

// The raster chain stops during file I/O, so first set one screen that
// needs no IRQ: the playfield at YSCROLL 3, 25 rows, no sprites.
static void hold_screen(void)
{
    __asm { sei }
    vic.ctrl1 = 0x1b;
    vic.memptr = cur_front ? D018_PF1 : D018_PF0;    // the screen the text went to
    vic.ctrl2 = 0xd8;
    vic.spr_enable = 0;
    vic.color_back = PF_BG_COL;
}

static void over_enter(void)
{
    char *s = level_screen();
    put_text(s, 9, 14, " GAME OVER ");
    text_colour(9, 14, 11, TEXT_CRAM);
    if (disk_on && hiscore > disk_hi) {
        put_text(s, 11, 12, " SAVING HI SCORE ");
        text_colour(11, 12, 17, TEXT_CRAM);
        hold_screen();
        hiscore_save();                         // a second or two; the chain restarts after
        disk_hi = hiscore;
        put_text(s, 11, 12, "                 ");
    }
    over_timer = 150;
    state = ST_OVER;
}

#ifdef PROFILE
// Debug only (-dPROFILE=1): the largest cost of each step, CIA1 timer B, at $0340.
#define PROF ((volatile unsigned *)0x0340)
#define P0 { __asm { sei } cia1.crb = 0x00; cia1.tb = 0xffff; cia1.crb = 0x11; }
#define P1(k) { cia1.crb = 0; unsigned t = 0xffff - cia1.tb; __asm { cli } if (t > PROF[k]) PROF[k] = t; }
#else
#define P0
#define P1(k)
#endif

// One frame of play. The order matters: bullets first, drawn into the showing
// screen before the beam reaches the playfield; collisions next, on the
// boxes of what is on screen now; then the moves that show next frame.
static void play_frame(char joy)
{
    P0; bullets_erase(); bullets_move_draw(); P1(0);
    P0; collide(); P1(1);
    P0; ship_update(joy); P1(2);
    P0; waves_update(cur_row); P1(3);
    P0; actors_draw(); P1(4);
    P0; level_render(); P1(5);
    P0; level_advance(); panel_update(); P1(6);
#ifdef PROFILE
    if (play_frames > 1) { unsigned t = K_IRQ_CYC - K_IRQ_CNT * K_IRQ_CAL; if (t > PROF[7]) PROF[7] = t; }
#endif
    play_frames++;
}

#if AUTOPILOT
// The graded run freezes on YSCROLL 3, where playfield rows sit on the text
// grid check.py reads. -dFREEZE_Y=0..7 freezes on another phase (the verdict
// then fails check 8): the panel split was compared across all eight so.
#ifndef FREEZE_Y
#define FREEZE_Y 3
#endif

// ---- the verdict, after the script -------------------------------------------------
// The script's own arithmetic and the model's: see PLAN.md. EXPECT_SCORE and
// EXPECT_KILLS were read from the first passing run; the rest follow from
// the script and the tables.
#define EXPECT_DEATHS 1
#define EXPECT_SCORE  45                // 450 points: 1 dart, 4 saucers
#define EXPECT_KILLS  5
#define EXPECT_SHOWN  11                // 10 parade bugs and the ship
#define END_HX        (P_START_HX - 24) // after the loss: 24 frames left
#define END_Y         (P_START_Y + 6)   // and 3 frames down, 2 lines each

static char verdict_code;

static bool parade_in_place(void)
{
    char n = 0;
    for (char e = 0; e < NE; e++) {
        if (e_state[e] != E_FLYING || e_ptr[e] != SPR_BLOCK + F_BUG)
            continue;
        char k = (e_hx[e] - 30) / 24;
        if (e_hx[e] != 30 + 24 * k || k > 4 || (e_y[e] != 72 && e_y[e] != 102))
            return false;
        n++;
    }
    return n == 10;
}

// The number of the first check that fails, 0 when all pass. The number is
// printed after FAIL, so a red run says which fact was wrong.
#define CHECK(c) if (!(c)) return n; n++;

static char hw_d011, hw_d018;          // read right after the frame IRQ, before the split
static bool disk_round_trip;

// Save the high score, clear it, load it back: drive 8 must answer 00 and
// return the same number. Runs before the checks; the screen holds still.
static void disk_test(void)
{
    unsigned h = hiscore;
    hiscore_save();
    hiscore = 0;
    hiscore_load();
    disk_round_trip = disk_on && disk_code == 0 && hiscore == h && h == EXPECT_SCORE;
    hiscore = h;
}

static char first_fail(void)
{
    char kills = kills_by_type[0] + kills_by_type[1] + kills_by_type[2];
    unsigned sum = kills_by_type[0] * 5 + kills_by_type[1] * 10 + kills_by_type[2] * 15;
    char n = 1;
    CHECK(level_intact())                               // 1 bullets restored every cell
    CHECK(deaths == EXPECT_DEATHS)                      // 2 the script's one ram
    CHECK(lives == START_LIVES - EXPECT_DEATHS)         // 3
    CHECK(score == sum)                                 // 4 score = points of what was shot
    CHECK(score == EXPECT_SCORE)                        // 5
    CHECK(kills == EXPECT_KILLS)                        // 6
    CHECK(waves_started == waves_due(cur_pos))          // 7 every wave the scroll reached
    CHECK((hw_d011 & 7) == 3 && cur_y == 3)             // 8 the frame IRQ applied YSCROLL 3
    CHECK((hw_d018 & 0xfe) == (cur_front ? D018_PF1 : D018_PF0)) // 9 ... and the screen (bit 0 reads 1)
    CHECK(K_MUX_SHOWN == EXPECT_SHOWN)                  // 10 the multiplexer shows 11
    CHECK(parade_in_place())                            // 11 ten bugs where the paths end
    CHECK(p_hx == END_HX && p_y == END_Y)               // 12 the ship where the script ends
    CHECK(K_SFX_TAKEN != 0)                             // 13 effects ran in the player
    CHECK(disk_round_trip)                              // 14 HISCORE written and read back
    return 0;
}

static void verdict(void)
{
    char fail = first_fail();
    char ok = fail == 0;
    verdict_code = ok ? 1 : 2;
    RESULT = verdict_code;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    char *s = level_screen();
    char kills = kills_by_type[0] + kills_by_type[1] + kills_by_type[2];
    put_text(s, 9, 1, ok ? "RESULT 01 PASS   " : "RESULT 02 FAIL 00");
    if (!ok)
        put_dec(s + 9 * 40 + 16, fail, 2);
    put_text(s, 10, 1, "SCORE 000000 KILLS 00 LIVES 0");
    put_dec(s + 10 * 40 + 7, score, 5);
    put_dec(s + 10 * 40 + 20, kills, 2);
    put_dec(s + 10 * 40 + 29, lives, 1);
    put_text(s, 11, 1, "SHOWN 00 WAVES 00 SHIP 000 000 K 0 0 0");
    put_dec(s + 11 * 40 + 7, K_MUX_SHOWN, 2);
    put_dec(s + 11 * 40 + 16, waves_started, 2);
    put_dec(s + 11 * 40 + 24, p_hx, 3);
    put_dec(s + 11 * 40 + 28, p_y, 3);
    put_dec(s + 11 * 40 + 34, kills_by_type[0], 1);     // darts, saucers, bugs
    put_dec(s + 11 * 40 + 36, kills_by_type[1], 1);
    put_dec(s + 11 * 40 + 38, kills_by_type[2], 1);
    text_colour(9, 1, 17, TEXT_CRAM);
    text_colour(10, 1, 29, TEXT_CRAM);
    text_colour(11, 1, 38, TEXT_CRAM);
    text_colour(13, 10, 20, TEXT_CRAM);
}
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
    ntsc_arg = is_ntsc();
    cia1.pra = 0xff;                            // no keyboard column selected
    level_init();
    display_init();
    ACT_PTR[0] = SPR_BLOCK + F_SHIP;
    ACT_COL[0] = VCOL_LT_BLUE;
    title_enter();                              // on screen while the disk works
#if AUTOPILOT
    hiscore_forget();                           // every graded run starts from no file
#endif
    hiscore_load();                             // banks the KERNAL in for the calls only
    disk_hi = hiscore;
    panel_draw();
#if FRAME_METER
    // The readout goes to a scratch row until the verdict copies it onto the
    // playfield; play_enter starts the recording again.
    meter_init((unsigned)SCRATCH, 13, 10, PF_CRAM, PLAY_FRAMES);
    K_MTR_OPEN = 0;                            // IRQs time themselves (timer B)
#else
    K_MTR_OPEN = 1;                             // no meter: IRQs never touch timer B
#endif
    __asm {
        lda ntsc_arg
        jsr ASM_KERNEL_INIT
        cli
    }

    char prev = 0xff;
    for (;;) {
        wait_frame();
        level_frame();
        char joy = port_read();
        switch (state) {
        case ST_TITLE:
            actors_draw();
            if (!(joy & JOY_FIRE) && (prev & JOY_FIRE))
                play_enter();
            break;
        case ST_PLAY:
#if AUTOPILOT
            if (play_frames > PLAY_FRAMES && cur_y == FREEZE_Y) {
                bullets_erase();                // freeze on YSCROLL 3: nothing
                bullets_reset();                // moves after this frame
                state = ST_FROZEN;
                break;
            }
#endif
            meter_open();
            play_frame(joy);
            meter_close();
            if (state == ST_OVER)
                over_enter();
            break;
        case ST_OVER:
            actors_draw();
            if (--over_timer == 0)
                title_enter();
            break;
#if AUTOPILOT
        case ST_FROZEN:
            if (!verdict_code) {
                hw_d011 = vic.ctrl1;            // the playfield's values until line 212
                hw_d018 = vic.memptr;
                disk_test();
                verdict();
            }
            actors_draw();
            memcpy(level_screen() + 13 * 40 + 10, SCRATCH + 13 * 40 + 10, 20);
            break;
#endif
        }
        prev = joy;
        meter_print();
    }
    return 0;
}
