// main.c: the racing starter. The frame loop, the states, the meter.
//
// One game step for each tick of line 251 (engine.asm's irq_blank):
//   the state     title, grid (the start lights), race, finish
//     race:       the player's car, the opponents, contact, laps (cars.c)
//   hud_draw      what changed on the panel
//   sound_frame   the engine note
// and between steps, the next picture a piece at a time (road.c, road_work:
// camera, horizon, the sprites, then engine.asm's builder writes the road
// copy and screen not shown; a finished picture is taken at line 203 or
// 251). The IRQ chain draws the road: lines 103 and 105 synchronise,
// 107-202 are one block of code each ($D016 and $D021 per line), 203 splits
// to the panel. In AUTOPILOT builds the meter brackets each step and adds
// the IRQs that land outside it.
//
// AUTOPILOT=1 replaces the joystick with a bot (autopilot.h) that drives two
// laps from the title; then the program grades itself ($02FF and the
// border, verdict.h) and holds the last picture. FORCE_FAULT=1 records the
// first lap one frame long: the verdict fails and the panel's L1 differs.
#include "game.h"
#include "frame_meter.h"

// ---- memory: the KickAssembler blob at its own address, C above it -----------
#pragma section( asmcode, 0 )
#pragma region( asmreg, ASM_ORG, 0x6400, , , { asmcode } )
#pragma region( main, 0x6400, 0xc000, , , { code, data, bss, heap, stack } )
#pragma data( asmcode )
__export const char asm_blob[] = {
#embed "asm.bin"
};
#pragma data( data )

#if ASM_END > 0x6400
#error "the KickAssembler blob runs past $6400: move the C region up"
#endif

#define TICK B(ASM_TICK)

char state;
unsigned frame;
char model;
static char timer;
static unsigned late;               // race steps lost or run past the next line 251
static unsigned slow;               // frames the AUTOPILOT bookkeeping covered
static bool metering;
static unsigned run_worst;          // the worst metered frame of the run
static unsigned last_sum;           // the frame being metered, so far
static bool meter_shown, meter_due;

// PROF=n (a build define) meters one part of the step instead of the whole
// frame: 2 the cars, 3 the panel and the sound. (The builder runs between
// steps and is not in the meter: README, "The measured frame".)
#ifndef PROF
#define PROF 0
#endif
#define PON(n)  if (PROF == n && metering) METER_START;
#define POFF(n) if (PROF == n && metering) METER_PAUSE;

#define PLAY_HOLD 255               // play frames the meter records (its maximum)

// ---- input -------------------------------------------------------------------------
#if AUTOPILOT
static char ap_next = 0xff;
static char port_read(void)
{
    return ap_next;
}
#else
static char port_read(void)
{
    return cia1.pra;                // control port 2, active low
}
#endif

// ---- states --------------------------------------------------------------------
static void title(void)
{
    state = ST_TITLE;
    cars_reset();
    hud_init();
    hud_text(22, 8, "c64-kb racing starter");
    hud_text(23, 14, "press fire");
    sound_off();
}

static void grid(void)
{
    state = ST_GRID;
    cars_reset();
    hud_init();
    timer = 0;
}

// The start lights: three beeps a second apart, then GO.
static void grid_frame(void)
{
    timer++;
    char step = fps;
    if (timer == step || timer == 2 * step || timer == 3 * step)
    {
        char n = 3 - (timer / step) + 1;
        hud_clear_row(22);
        HUDPAGE[22 * 40 + 19] = '0' + n;
        sound_beep(0);
    }
    else if (timer == 4 * step)
    {
        hud_clear_row(22);
        hud_text(22, 18, "go!");
        sound_beep(1);
        state = ST_RACE;
    }
}

static void finish(void)
{
    state = ST_FINISH;
    timer = 0;
    hud_clear_row(22);
    hud_text(22, 13, "finished");
    HUDPAGE[22 * 40 + 22] = '0' + finished;
    static const char suffix[5][3] = { "", "st", "nd", "rd", "th" };
    hud_text(22, 23, suffix[finished]);
    hud_draw();
}

// ---- the meter's share of the IRQs (as the beat-em-up starter) ----------------------
static unsigned fold_irq_time(bool add)
{
    __asm { sei }
    unsigned c = W(ASM_IRQ_CYC);
    W(ASM_IRQ_CYC) = 0;
    B(ASM_IRQ_CNT) = 0;
    __asm { cli }
    if (add && c)
        meter_add(c + meter_zero);
    return add ? c : 0;
}

#if AUTOPILOT
#include "autopilot.h"
#include "verdict.h"
#endif

static void video_init(void)
{
    vic.spr_enable = 0;
    cia2.pra = cia2.pra & 0xfc;         // VIC bank 3: $C000-$FFFF
    vic.ctrl1 = 0x1b;                   // display on, 25 rows, YSCROLL 3
    vic.ctrl2 = 0x18;
    vic.memptr = 0x08;
    vic.color_border = VCOL_BLACK;
    vic.color_back = 14;
    vic.color_back1 = VCOL_DARK_GREY;   // the road
    vic.color_back2 = VCOL_WHITE;       // the kerb
    vic.spr_mcolor0 = VCOL_BLACK;
    vic.spr_mcolor1 = VCOL_LT_RED;
    vic.spr_multi = 0x07;
    vic.spr_expand_x = 0;
    vic.spr_expand_y = 0;
    vic.spr_priority = 0;
    art_sky(SCREEN_A);
    art_sky(SCREEN_B);
    memset(SCREEN_A + 7 * 40, 0, 12 * 40);
    memset(SCREEN_B + 7 * 40, 0, 12 * 40);
    for (unsigned i = 0; i < 7 * 40; i++)
        COLOUR[i] = 0x08 | VCOL_BLUE;   // multicolour; 11 is the hills
    for (unsigned i = 7 * 40; i < 19 * 40; i++)
        COLOUR[i] = 0x08 | VCOL_WHITE;  // multicolour; 11 is the dash
}

int main(void)
{
    __asm { sei }                       // the IRQ chain is the only interrupt
    cia1.icr = 0x7f;                    // no CIA1 interrupts
    char c = cia1.icr;
    cia1.pra = 0xff;                    // no keyboard column: $DC00 reads port 2
    vic.intr_enable = 0;
    art_init();                         // leaves $01 = $35: BASIC and KERNAL out
    video_init();
    __asm { jsr ASM_DETECT_MODEL }
    model = B(ASM_RB_MODEL);
    fps = model ? 60 : 50;
    fpt = model ? 6 : 5;
    __asm { jsr ASM_RB_INIT }
    sound_init();
    road_init();
    cars_reset();                       // the grid, for the first pictures
    hud_init();
    for (char k = 0; k < 2; k++)        // both copies whole before the chain starts
    {
        road_build_all();
        B(ASM_RB_READY) = 0;
        B(ASM_RB_FRONT) ^= 1;
    }

    // The chain. BASIC and KERNAL are out ($01 = $35), so the CPU takes its
    // vectors from RAM: $FFFE to the chain, $FFFA (RESTORE) to an RTI.
    *(volatile unsigned *)0xfffe = ASM_IRQ_BLANK;
    *(volatile unsigned *)0xfffa = ASM_NMI_RTI;
    vic.raster = 251;
    vic.intr_ctrl = 0xff;
    vic.intr_enable = 1;

    meter_init((unsigned)HUDPAGE, 24, 20, VCOL_WHITE, PLAY_HOLD);
#if FRAME_METER
    cia2.icr = 0x02;                    // timer B's NMI masked
    cia2.crb = 0x00;
    cia2.tb = 0xffff;                   // the latch the IRQs force-load
    B(ASM_IRQ_METER) = 1;
#endif
    __asm { cli }
    title();                            // PRESS FIRE once the game steps: a press is seen

    char prev_joy = 0xff;
    char last = TICK;
    for (;;)
    {
        // Between frames the main loop builds the next picture, a piece at a
        // time (road_work: a row, or a picture's start or end), and looks at
        // the tick after each piece. A piece takes at most 3,706 cycles
        // (README), so the step below starts within about 70 lines of 251
        // (the piece and irq_blank's own time, arithmetic).
        char now = TICK;
        if (now == last)
        {
            if (state != ST_GRADED)
                road_work();
            continue;
        }
        char gap = now - last;
        last = now;
        char ticks = now;
        if (state == ST_RACE && gap > 1)
            late += gap - 1;            // frames that passed with no game step
#if FRAME_METER
        // The last frame's figure: its step, and every IRQ from its start to
        // this one's that landed outside the step's bracket (the road chain
        // and irq_blank, as the step ends before line 103). It is recorded
        // after this step (meter_frame, below): recording the 255th frame
        // works out the median, which is not play.
        if (metering)
        {
            last_sum += fold_irq_time(!PROF);
            if (last_sum > run_worst)
                run_worst = last_sum;
            meter_due = true;
        }
        else
            fold_irq_time(false);
#endif
        bool play = state == ST_RACE;
#if AUTOPILOT
        metering = play && ap_recording();
#else
        metering = play;
#endif
        last_sum = 0;
        if (metering && !PROF)
            METER_START;

#if AUTOPILOT
        ap_next = autopilot_port();     // the bot reads the game as it stands, as a player would
#endif
        char joy = port_read();
        char pressed = prev_joy & ~joy;
        prev_joy = joy;
        switch (state)
        {
        case ST_TITLE:
            if (pressed & JOY_FIRE)
                grid();
            break;
        case ST_GRID:
            grid_frame();
            break;
        case ST_RACE:
            PON(2)
            cars_step(joy);
            POFF(2)
            if (finished)
                finish();
            break;
        case ST_FINISH:
            cars_step(0xff);            // coasting past the line
            if (++timer == 250)
                title();
            break;
        }
        PON(3)
        if (state == ST_RACE || state == ST_GRID)
            hud_draw();
        sound_frame();
        POFF(3)
#if FRAME_METER
        unsigned bracket = metering && !PROF ? meter_read() : 0;   // METER_PAUSE, kept
#endif
        if (play && TICK != ticks)
            late++;                     // this step ran past the next line 251

#if FRAME_METER
        if (meter_due)
        {
            meter_frame();              // the last frame, whole
            meter_due = false;
        }
        if (metering && !PROF)
        {
            meter_add(bracket);         // this one's bracket, recorded next frame
            last_sum = bracket - meter_zero;
        }
#endif
#if AUTOPILOT
        autopilot_frame();
        if (meter_frames == PLAY_HOLD && !meter_shown)
        {
            meter_print();              // once, when it has its frames: printing divides
            meter_shown = true;
        }
#endif
        // Bookkeeping (the meter, the bot's own counts; the meter's median
        // once, about 7 frames when its recording ends) that ran past the
        // next line 251: the frames it covered are counted here, not as
        // lost, and the loop waits for the next frame.
        if (TICK != ticks)
        {
            slow += (char)(TICK - ticks);
            last = TICK;
        }
        frame++;
    }
    return 0;
}
