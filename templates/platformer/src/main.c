// main.c: the platformer starter. The frame loop, the game's states, the
// autopilot and its verdict. Each subsystem lives in its own file (game.h
// lists them); this file only runs them in order.
//
// One frame, from raster line 251 (below the last display line):
//   view_apply    the sprites for the picture about to be drawn
//   music, sfx    the tune (KickAssembler) and the effects on voice 3
//   the state     title, play, dying, game over, level clear
//   hud_draw      score, coins, lives, high score on the HUD page
//   view_publish  the next picture's page and XSCROLL, as one pair
// Two raster IRQs in engine.asm set the registers: at line 212 the HUD's
// $D016 and $D018, at line 251 the published playfield pair. In AUTOPILOT
// builds the meter brackets every play frame.
//
// AUTOPILOT=1 replaces the joystick with a script that plays from the
// title; after it the program grades itself ($02FF and the border).
// FORCE_FAULT=1 makes a coin worth 20, so the score is wrong: the verdict
// fails and the HUD shows a different score. TEAR_DEMO=1 scrolls the old
// way, in place (view.c), for tools/tearcheck.py to catch.
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
// 1 player, 2 actors, 3 camera and scroll, 4 sprites + music + effects,
// 5 HUD + sprite shadows. Each is a METER_START ... METER_PAUSE section,
// summed per frame by meter_frame. README.md has the figures.
#ifndef PROF
#define PROF 0
#endif
static bool metering;               // this frame is a play frame
#define PON(n)  if (PROF == n && metering) METER_START;
#define POFF(n) if (PROF == n && metering) METER_PAUSE;

enum State { ST_TITLE, ST_PLAY, ST_DYING, ST_OVER, ST_CLEAR, ST_GRADED };
static char state, timer, prev_joy;
unsigned events;
char stomps;
bool goal_reached;
static char hurts;
static unsigned frame;              // frames since power-on
static unsigned late;               // play frames whose work ran past the next frame's line 251

#define PLAY_HOLD 255               // play frames the meter records (its maximum)
#define START_LIVES 3

// ---- input -------------------------------------------------------------------------
#if AUTOPILOT
#include "autopilot.h"
static char ap_step, ap_used;
static char port_read(void)
{
    char out = 0xff;
    if (ap_step < SCRIPT_STEPS)
    {
        out = script[ap_step][1];
        if (++ap_used == script[ap_step][0])
        {
            ap_used = 0;
            ap_step++;
        }
    }
    return out;
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
static void title(void)
{
    state = ST_TITLE;
    level_reset();
    actors_reset();
    camx = 0;
    view_cut();
    player_reset(start_x, start_y);
    pinvuln = 0xff;                 // hidden on the title
    hud_clear();
    put_text(21, 7, "c64-kb platformer starter");
    hud_hiscore();
    put_text(24, 0, "press fire");
}

// A level from its start: the first, or again after the flag.
static void level_start(void)
{
    goal_reached = false;
    level_reset();
    actors_reset();
    camx = 0;
    view_cut();
    player_reset(start_x, start_y);
    pinvuln = 0;
    hud_clear();
    hud_labels();
    state = ST_PLAY;
}

static void new_game(void)
{
    for (char i = 0; i < 6; i++)
        score[i] = 0;
    lives = START_LIVES;
    coins = stomps = hurts = 0;
    events = 0;
    level_start();
}

// Called by the player (a pit) and the actors (a touch).
void player_hurt(void)
{
    if (state != ST_PLAY)
        return;
    lives--;
    hurts++;
    hud_dirty = true;
    events |= EV_HURT;
    sfx_play(SFX_HURT);
    anim_set(&panim, an_hurt);
    pjump = 4;                      // a hop, then down through everything
    state = ST_DYING;
    timer = 90;
}

static void play_frame(char joy, char pressed)
{
    PON(1)
    player_update(joy, pressed);
    POFF(1)
    if (state != ST_PLAY)
        return;
    PON(2)
    actors_update();
    actors_collide();
    POFF(2)
    PON(3)
    view_follow();
    POFF(3)
    if (goal_reached)
    {
        score_add(10, 0);           // 1,000 for the flag
        put_text(21, 14, "level clear");
        state = ST_CLEAR;
        timer = 120;
    }
}

static void dying_frame(void)
{
    char fy = py >> 8;
    if (fy < 220)                   // the death hop, through the level
    {
        py += vy_tab[pjump];
        if (pjump < JUMP_LEN - 1)
            pjump++;
    }
    if (--timer)
        return;
    if (lives == 0)
    {
        put_text(21, 15, "game over");
        state = ST_OVER;
        timer = 150;
        return;
    }
    player_reset(safe_x, safe_y);
    pinvuln = 120;
    events |= EV_RESPAWN;
    state = ST_PLAY;
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

#if AUTOPILOT
#include "verdict.h"
#endif

int main(void)
{
    __asm { sei }                   // the split IRQ is the only interrupt
    cia1.pra = 0xff;                // no keyboard column selected: $DC00 reads port 2
    art_build();                    // leaves $01 = $35: BASIC and KERNAL out
    __asm { jsr ASM_MUSIC_INIT }
    view_init();                    // bank 3, colours, the split IRQ; CLI
    meter_init((unsigned)HUDPAGE, 24, 20, VCOL_WHITE, PLAY_HOLD);
    for (char i = 0; i < 6; i++)
        hiscore[i] = 0;
    prev_joy = 0xff;
    title();

    for (;;)
    {
        wait_sync();
#if AUTOPILOT
        autopilot_blank();          // the camera of the picture now drawn, on the HUD
#endif
        metering = state == ST_PLAY;
        char ticks = BLANK_TICKS;
        if (metering && !PROF)
            METER_START;

        PON(4)
        view_apply();
        __asm { jsr ASM_MUSIC_PLAY }
        sfx_update();
        POFF(4)

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
            play_frame(joy, pressed);
            break;
        case ST_DYING:
            dying_frame();
            break;
        case ST_OVER:
        case ST_CLEAR:
            if (--timer == 0)
            {
                if (state == ST_OVER)
                    end_game();
                else
                    level_start();  // the same level again, score and lives kept
            }
            break;
        }
        PON(5)
        if (state != ST_TITLE)
            hud_draw();
        view_sprites();
        view_publish();
        POFF(5)

        if (metering)
        {
            if (BLANK_TICKS != ticks)
                late++;             // this frame's work ran past the next line 251
            if (PROF)
                meter_frame();
            else
                METER_STOP;             // the frame's own work ends here
        }
#if AUTOPILOT
        autopilot_frame();          // grading is bookkeeping: outside the bracket
        if (!(frame & 31))
            meter_print();          // it divides: not every frame
#endif
        frame++;
    }
    return 0;
}
