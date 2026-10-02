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
// No malloc: no heap (c64-kb oscar64-reference, Memory layout). 512 bytes
// of stack: Oscar64's 4 KB, then 2 KB and 1 KB, left the autopilot build no
// room (the stages, the tune, the car art). The STACKPROBE build
// (-dSTACKPROBE=1) fills the lower half and reads it back after the
// verdict: untouched (README).
#pragma heapsize(0)
#if PIECETIME
#pragma stacksize(3072)                 // (debug build only: its tables need the room)
#else
#pragma stacksize(512)
#endif
// The C region starts on the page after the blob's end (build/asm.h).
#define C_ORG ((ASM_END + 0xff) & 0xff00)
#pragma section( asmcode, 0 )
#pragma region( asmreg, ASM_ORG, C_ORG, , , { asmcode } )
#pragma region( main, C_ORG, 0xc000, , , { code, data, bss, heap, stack } )
#pragma data( asmcode )
__export const char asm_blob[] = {
#embed "asm.bin"
};
#pragma data( data )


#define TICK B(ASM_TICK)

char state;
unsigned frame;
#if PIECETIME
__export unsigned piece_max[9];         // (debug) by kind: rb_state 0-5, begin, end, rb_begin
__export unsigned piece_own[9];         // the same, pieces with no IRQ inside
__export unsigned long piece_sum[9];
__export unsigned piece_n[9];
#endif
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
    stage = 0;
    cars_reset(true);
    hud_init();
    hud_text(22, 8, "c64-kb racing starter");
    hud_text(23, 14, "press fire");
    sound_off();
}

// A stage's grid: the cars placed, the stage's track and colours, the
// lights. The race's counts carry over to stage 2.
static void grid(void)
{
    state = ST_GRID;
    cars_reset(false);
    stage_start();
    hud_init();
    timer = 0;
}

// Stage 1 done: the cars drive on while the panel says so, then stage 2.
#define CLEAR_FRAMES 150
// (The message comes a step later: in the step that ended the stage it
// ran that step past the next frame on NTSC once a race.)
static void clear(void)
{
    state = ST_CLEAR;
    timer = 0;
}

// The countdown ran out.
static void over(void)
{
    state = ST_OVER;
    timer = 0;
    hud_message("time up", 250);
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

// (The message comes a step later, as clear's: in the step that ended the
// race it ran that step past the next frame on NTSC once a race.)
static void finish(void)
{
    state = ST_FINISH;
    timer = 0;
}

static void finish_message(void)
{
    hud_clear_row(22);
    hud_text(22, 13, "finished");
    HUDPAGE[22 * 40 + 22] = '0' + finished;
    static const char suffix[6][3] = { "", "st", "nd", "rd", "th", "th" };
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
    vic.ctrl2 = 0x10;                   // 38 columns (engine.asm D016_ROAD)
    vic.memptr = 0x0c;                  // screen A, road set 3 (the sky rows)
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
#if STACKPROBE
    memset((char *)0xbe00, 0xaa, 0x100);    // (debug) the stack's lower half: read back after the verdict
#endif
    __asm { sei }                       // the IRQ chain is the only interrupt
    cia1.icr = 0x7f;                    // no CIA1 interrupts
    char c = cia1.icr;
    cia1.pra = 0xff;                    // no keyboard column: $DC00 reads port 2
    vic.intr_enable = 0;
    art_init();                         // leaves $01 = $35: BASIC and KERNAL out
    __asm { jsr ASM_GLYPH_INIT }        // the road's four character sets (interrupts off)
    video_init();
    __asm { jsr ASM_DETECT_MODEL }
    model = B(ASM_RB_MODEL);
    fps = model ? 60 : 50;
    fpt = model ? 6 : 5;
    __asm { jsr ASM_RB_INIT }
    sound_init();
    road_init();
    cars_reset(true);                   // the grid, for the first pictures
    stage_start();
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

    meter_init((unsigned)HUDPAGE, 24, 18, VCOL_WHITE, PLAY_HOLD);   // columns 18-37: 38-column mode cuts 0 and 38
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
            {
#if PIECETIME
                // (debug) wall time by piece: 0-5 rb_state, 6 begin, 7 end
                char ph = phase_of_road();
                char kind = ph == 0 ? 6 : ph == 1 ? 8 : B(ASM_RB_STATE) ? B(ASM_RB_STATE) : B(ASM_RB_ROW_ZP) >= 7 ? 0 : 7;
                // p0, p1: the beam's place, 0 at line 204; a piece with no
                // IRQ inside it starts and ends below 209 (line 101) in order
                unsigned p0 = ((vic.raster | ((vic.ctrl1 & 0x80) << 1)) + 108) % 312;
                cia1.crb = 0x00;
                cia1.tb = 0xffff;
                cia1.crb = 0x11;
                road_work();
                cia1.crb = 0x00;
                unsigned t = 0xffff - cia1.tb;
                unsigned p1 = ((vic.raster | ((vic.ctrl1 & 0x80) << 1)) + 108) % 312;
                if (state == ST_RACE)
                {
                    piece_sum[kind] += t;
                    piece_n[kind]++;
                    if (t > piece_max[kind])
                        piece_max[kind] = t;
                    if (p1 >= p0 && p1 < 209 && t > piece_own[kind])
                        piece_own[kind] = t;
                }
#else
                // The tick is read again just before a piece: irq_blank
                // (251) landing after the first read let a piece of up to
                // 3,700 cycles start after the tick, and the step behind it
                // ran past its frame once a race on NTSC (a checkpoint on
                // irq_blank showed the next tick land in that step's sound;
                // racing-port-110 found the same).
                // NTSC: no piece starts in the 25 lines before the tick. One
                // of up to 3,700 cycles started there pushed the step into the
                // next road kernel: once a race it ran past its frame (a
                // checkpoint on irq_blank), and the meter, which times from
                // one step's end to the next, read 20,170 of 17,095. Pictures
                // on NTSC: 9.3 frames each with no rule, 11.8 with it.
                if (model && vic.raster >= 226 && !(vic.ctrl1 & 0x80))
                    ;
                else if (TICK == last)
                    road_work();
#endif
            }
            continue;
        }
        char gap = now - last;
        last = now;
        char ticks = now;
        // The camera's position for this frame's bands (engine.asm bpos, even:
        // the road's code adds it to each line's z * 8, odd above the horizon).
        *(volatile char *)0xff = (char)(car_pos[0] - ZN) & 0xfe;
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
            stage_step();
            if (time_up)
                over();
            else if (stage_done)
            {
                if (stage == 0)
                    clear();
                else
                {
                    finished = place;
                    finish();
                }
            }
            break;
        case ST_CLEAR:
            cars_step(0xff);            // coasting on
            if (timer == 1)
                hud_message("stage clear", CLEAR_FRAMES);
            if (++timer == CLEAR_FRAMES)
            {
                stage = 1;
                grid();
            }
            break;
        case ST_OVER:
            cars_step(0xff);
#if !AUTOPILOT
            if (++timer == 250)
                title();
#else
            timer++;                    // (autopilot.h grades the run)
#endif
            break;
        case ST_FINISH:
            cars_step(0xff);            // coasting past the line
            if (timer == 1)
                finish_message();
            if (++timer == 250)
                title();
            break;
        }
        player_x();                     // the player's car across, every step
        PON(3)
        // the panel every other step (light-7: the budget of 5 PAL frames a
        // picture had 0.05 to find; the clock shows tenths, its digits catch up)
        if ((state == ST_RACE || state == ST_GRID || state == ST_CLEAR) && (frame & 1))
            hud_draw();
#if !NO_PLAYER                      // make watchtest: the build without it fails SID_FRAMES
        sound_frame();
#endif
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
#if FRAME_METER
            fold_irq_time(false);       // their IRQs are no step's: folded into the next
#endif                                  // sample they read 20,477 on NTSC (two frames' IRQs)
        }
        frame++;
    }
    return 0;
}
