// main.c: the brawler starter. The frame loop, the game's states, the
// autopilot hooks. Each subsystem lives in its own file (game.h lists
// them); this file runs them in order.
//
// One frame, from raster line 251 (below the last display line):
//   music, sfx      the tune (KickAssembler) and the effects on voice 3
//   the state       title, play, game over, street clear
//     play:         the hero's joystick, the enemies' AI, every fighter's
//                   move, the hits, the waves, the camera and the scroll
//   hud_draw        bars, score, stage, lives, when something changed
//   view_sprites    the three sprite bands, back half, depth-sorted
//   view_publish    the next picture's page, XSCROLL and sprite set, as one
// The IRQ chain in engine.asm writes them: line 251 the street's $D016 and
// $D018 and the sign band, line 76 the fighter band, line 212 the HUD's
// registers and the face band. In AUTOPILOT builds the meter brackets the
// play frames, and the IRQs that land outside the bracket are added in.
//
// AUTOPILOT=1 replaces the joystick with a bot (autopilot.h) that plays
// from the title; then the program grades itself ($02FF and the border,
// verdict.h). FORCE_FAULT=1 makes a punch worth 20: the verdict fails and
// the HUD score differs. FLICKER_DEMO=1 drops a fighter part (view.c) for
// tools/flickercheck.py to catch.
#include "game.h"
#include "asm.h"
#include "frame_meter.h"

// ---- memory: the KickAssembler blob at its own address, code from $1000 ----
#pragma section( asmcode, 0 )
#pragma region( asmreg, ASM_ORG, 0x1000, , , { asmcode } )
#pragma region( main, 0x1000, 0xa000, , , { code, data, bss, heap, stack } )
#pragma data( asmcode )
__export const char asm_blob[] = {
#embed "asm.bin"
};
#pragma data( data )

#define BLANK_TICKS (*(volatile char *)ASM_BLANK_TICKS)

// PROF=n (a build define) meters one subsystem instead of the whole frame:
// 1 hero, AI, moves and hits; 2 camera and scroll; 3 the sprite bands and
// publish; 4 music, effects and HUD; 6 the brute's cells and glyphs (the
// switch at the frame start, the build at the end); 5 the three IRQs alone (no main-loop
// bracket, so every IRQ times itself on CIA2 timer B). README.md has the
// figures. The whole-frame figure (PROF=0) holds the IRQs too.
#ifndef PROF
#define PROF 0
#endif
static bool metering;               // this frame is a recorded play frame
#define PON(n)  if (PROF == n && metering) METER_START;
#define POFF(n) if (PROF == n && metering) METER_PAUSE;

enum State { ST_TITLE, ST_PLAY, ST_OVER, ST_CLEAR, ST_GRADED };
static char state, timer, prev_joy;
unsigned events;
char hits_punch, hits_kick, hits_jkick, kos_thug, kos_brute, locks;
static unsigned frame;              // frames since power-on
static unsigned late;               // AUTOPILOT: play frames whose work ran past the next line 251
static unsigned slow;               // AUTOPILOT: play frames the whole loop overran (a blank missed)
static bool photo;                  // AUTOPILOT: the game is held for a picture (verdict.h)

#define PLAY_HOLD 255               // play frames the meter records (its maximum)
#define START_LIVES 3
#define HERO_X    60
#define HERO_Y    176

// ---- input -------------------------------------------------------------------------
#if AUTOPILOT
// The bot's byte for this frame, worked out at the end of the last one
// (main loop, after the meter): the bot is not the game's work.
static char ap_next = 0xff;
static char port_read(void)
{
    return ap_next;
}
#elif defined(JOY_SOURCE)
// Headless driving of the normal game (make joy, tools/drive.py): the port
// byte comes from RAM at JOY_SOURCE, which a VICE monitor writes. The
// windowless VICE's joyport commands do not reach $DC00.
static char port_read(void)
{
    return *(volatile char *)JOY_SOURCE;
}
#else
static char port_read(void)
{
    return cia1.pra;                // control port 2, active low
}
#endif

// The IRQ at line 251 counts the blanks (engine.asm); the frame starts
// when the count moves. Work that runs long skips a blank, never splits one.
static void wait_sync(void)
{
    char t = BLANK_TICKS;
    while (BLANK_TICKS == t) ;
}

// ---- states --------------------------------------------------------------------
static void street_start(void)
{
    camx = 0;
    view_cut();
    waves_reset();
    fighter_spawn(0, K_HERO, HERO_X, HERO_Y, FACE_RIGHT);
    face_enemy = 0xff;
    go_sign = false;
}

static void title(void)
{
    state = ST_TITLE;
    street_start();
    hud_clear();
    put_text(21, 7, "c64-kb beat-em-up starter");
    put_text(23, 15, "press fire");
    hud_hiscore();
}

static void new_game(void)
{
    for (char i = 0; i < 6; i++)
        score[i] = 0;
    lives = START_LIVES;
    hits_punch = hits_kick = hits_jkick = kos_thug = kos_brute = locks = 0;
    events = 0;
    street_start();
    hud_clear();
    hud_dirty = true;
    state = ST_PLAY;
}

// The hero's KO has run its course (fighter.c): a life, and up again where
// he fell, blinking and safe for two seconds, or the game is over.
void hero_hurt(void)
{
    lives--;
    events |= EV_LIFE_LOST;
    hud_dirty = true;
    if (lives)
    {
        fighter_spawn(0, K_HERO, fx[0], fy[0], fface[0]);
        finvuln[0] = 100;
        return;
    }
    fmode[0] = M_OFF;
    hud_draw();                     // LIVES 0 now: no HUD redraw may follow the message
    put_text(21, 15, "game over");
    state = ST_OVER;
    timer = 150;
}

static void play_frame(char joy, char pressed)
{
    PON(1)
    player_control(joy, pressed);
    enemies_update();
    fighters_step();
    hits_resolve();
    waves_update();
    POFF(1)
    PON(2)
    view_follow();
    POFF(2)
    if (stage_clear && stage == NSTAGE - 1 && state == ST_PLAY)
    {
        hud_draw();
        put_text(21, 13, "street clear");
        state = ST_CLEAR;
        timer = 150;
    }
}

static void end_game(void)
{
    for (char i = 0; i < 6; i++)
    {
        if (score[i] != hiscore[i])
        {
            if (score[i] > hiscore[i])
                for (char j = 0; j < 6; j++)
                    hiscore[j] = score[j];
            break;
        }
    }
    title();
}

// The IRQs that landed outside the meter's brackets since the last frame
// (engine.asm times them on CIA2 timer B). meter_add subtracts the empty
// C bracket once, so it is added back: timer B's own start-stop cost is a
// few cycles, not the C bracket's.
static unsigned fold_irq_time(bool add)
{
    __asm { sei }
    unsigned c = *(volatile unsigned *)ASM_IRQ_CYC;
    *(volatile unsigned *)ASM_IRQ_CYC = 0;
    *(volatile char *)ASM_IRQ_CNT = 0;
    __asm { cli }
    if (add && c)
        meter_add(c + meter_zero);
    return add ? c : 0;
}

// The worst frame of every metered play frame, not only the 255 the meter
// records: with -dMETER_WINDOW=4 every play frame is metered, and the
// verdict prints this on row 24 ("RUN nnnnn").
static unsigned run_worst;

#if AUTOPILOT
#include "autopilot.h"
#include "verdict.h"
#endif

int main(void)
{
    __asm { sei }                   // the IRQ chain is the only interrupt
    cia1.pra = 0xff;                // no keyboard column selected: $DC00 reads port 2
#if !AUTOPILOT && defined(JOY_SOURCE)
    *(volatile char *)JOY_SOURCE = 0xff;    // nothing pressed until the monitor says so
#endif
    street_init();
    art_build();                    // leaves $01 = $35: BASIC and KERNAL out
    brute_build();                  // his pictures at the four shifts
    __asm { jsr ASM_MUSIC_INIT }
    view_init();                    // bank 3, colours, the IRQ chain; CLI
    meter_init((unsigned)HUDPAGE, 24, 20, VCOL_WHITE, PLAY_HOLD);
#if FRAME_METER
    cia2.icr = 0x02;                // timer B's NMI masked (bit 7 clear: clear this bit only)
    cia2.crb = 0x00;
    cia2.tb = 0xffff;               // the latch the IRQs force-load
    *(volatile char *)ASM_IRQ_METER = 1;
#endif
#if AUTOPILOT
    *(volatile char *)ASM_SNAP_ON = 1;      // band 1's registers copied back each frame (verdict.h)
#endif
    for (char i = 0; i < 6; i++)
        hiscore[i] = 0;
    prev_joy = 0xff;
    title();

    for (;;)
    {
        wait_sync();
        char ticks = BLANK_TICKS;
        bool play = state == ST_PLAY && !photo;    // this frame began in play
#if AUTOPILOT
        metering = state == ST_PLAY && !photo && ap_recording();
#else
        metering = state == ST_PLAY;
#endif
        if (metering && !PROF)
            METER_START;

        PON(6)
        brute_draw();               // first: it must beat the beam to the brute's top row
        POFF(6)
        char joy = port_read();
        char pressed = prev_joy & ~joy;
        prev_joy = joy;
        switch (state)
        {
        case ST_TITLE:
            if (pressed & JOY_FIRE)
                new_game();
            break;
        case ST_PLAY:
            if (!photo)
                play_frame(joy, pressed);
            break;
        case ST_OVER:
        case ST_CLEAR:
            if (--timer == 0)
            {
                if (state == ST_OVER)
                    end_game();
                else
                {
                    street_start();         // the street again, score and lives kept
                    hud_clear();
                    hud_dirty = true;
                    state = ST_PLAY;
                }
            }
            break;
        }
        PON(4)
        __asm { jsr ASM_MUSIC_PLAY }
        sfx_update();
        POFF(4)
        PON(6)
        brute_prepare();            // the brute's next picture, half a frame at a time
        POFF(6)
        PON(4)
        if (state == ST_PLAY)       // game over and street clear keep their message
            hud_draw();
        POFF(4)
        PON(3)
        view_sprites();
        view_publish();
        POFF(3)
#if AUTOPILOT
        if (play && BLANK_TICKS != ticks)
            late++;                 // a play frame whose work ran past the next line 251
                                    // (not the frame fire starts a game: it draws both pages)
#endif

#if FRAME_METER
        if (metering)
        {
            unsigned sum = 0;
            if (!PROF)
            {
                unsigned r = meter_read();  // METER_PAUSE, keeping the figure
                meter_add(r);
                sum = r - meter_zero;       // the main loop's share
            }
            sum += fold_irq_time(!PROF || PROF == 5);  // the IRQs' share outside it
            if (sum > run_worst)
                run_worst = sum;
            meter_frame();          // the frame's own work ends here
        }
        else
            fold_irq_time(false);
#endif
#if AUTOPILOT
        if (BLANK_TICKS == ticks)   // (past the next blank the half just built may be the one shown)
            vic_compare();          // what the IRQ at line 76 wrote, read back (verdict.h)
        vic_expect();               // what the half just built must show, worked out on its own
        ap_next = autopilot_port(); // next frame's joystick byte
        autopilot_frame();          // grading and pictures are bookkeeping: outside the bracket
        if (!(frame & 31))
            meter_print();          // it divides: not every frame
#endif
#if AUTOPILOT
        if (play && BLANK_TICKS != ticks)
            slow++;                 // the loop, bookkeeping and all, missed a blank
#endif
        frame++;
    }
    return 0;
}
