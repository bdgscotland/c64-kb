// main.c: STARWATCH, the text-adventure starter. The states (title, play,
// ending) and the frame loop; the game is in engine.c, the window printer and
// input line in text.c, the pictures in picture.c, SAVE and LOAD in save.c,
// sound in sound.c, and the world itself in tools/world.py.
//
// One frame does one bounded job: draw the room picture, or print one line
// of the window, or take typed keys (and, on RETURN, parse and run the turn,
// which only queues message numbers). Disk calls run on frames of their own,
// outside the meter.
//
// AUTOPILOT=1 types tools/world.py's script into the KERNAL keyboard queue,
// the bytes a real key puts there, and grades itself against tools/gen.py's
// model: $02FF = $01 and a green border on pass, $02 and red on fail.
// FORCE_FAULT=1 scores one point less at the end. DISKTEST=1 plays the script
// up to its SAVE; DISKTEST=2 starts at its LOAD (make disktest).
#include <c64/vic.h>
#include <c64/cia.h>
#include "frame_meter.h"            // templates/_harness/meter
#include "engine.h"
#include "text.h"
#include "picture.h"
#include "save.h"
#include "sound.h"

#ifndef AUTOPILOT
#define AUTOPILOT 0
#endif
#ifndef DISKTEST
#define DISKTEST 0
#endif

// Code and data below the character set at $3800, the rest from $4000.
#pragma region( lower, 0x0880, 0x3800, , , { code, data } )
#pragma region( main, 0x4000, 0xa000, , , { code, data, bss, heap, stack } )

#if AUTOPILOT
#include "gen_script.h"
#endif

#define RESULT  (*(volatile char *)0x02ff)   // $01 pass, $02 fail, $00 not reached
#define KEYQ    ((volatile char *)0x0277)    // the KERNAL keyboard queue
#define KEYN    (*(volatile char *)0x00c6)   // keys in it
#define KEYMAX  10                           // its size ($0289)
#define MODE    (*(volatile char *)0x0291)   // $80: SHIFT + C= does not switch case
#define JOY_FIRE 0x10

enum { ST_TITLE, ST_PLAY, ST_END };

static char state, frame;
static unsigned state_frames;
static bool ntsc;
static char pic_shown, pic_want;
static bool pic_dirty;
static unsigned play_frames;            // metered frames this game
static char last_score;

// ---- keyboard ------------------------------------------------------------------
// The KERNAL IRQ is off, so the loop runs SCNKEY itself: it reads the matrix
// and puts a new key in the queue. key_get() takes the first key out, as
// GETIN's LP2 ($E5B4) does, but without the CLI that LP2 ends with.
static void key_scan(void)
{
    __asm { jsr 0xff9f }
}

static char key_get(void)
{
    char n = KEYN;
    if (!n)
        return 0;
    char k = KEYQ[0];
    for (char i = 1; i < n; i++)
        KEYQ[i - 1] = KEYQ[i];
    KEYN = n - 1;
    return k;
}

// Fire on port 2, read only on the title and the ending. make joy builds it
// with -dJOY_SOURCE=0x02fe: the byte comes from RAM that tools/drive.py
// writes, because the windowless VICE's joyport commands never reach $DC00
// (templates/action-puzzle, README).
static bool fire_was = true;            // held at power-on counts as held, not pressed

static bool fire_pressed(void)
{
#if AUTOPILOT
    return false;
#elif defined(JOY_SOURCE)
    return !(*(volatile char *)JOY_SOURCE & JOY_FIRE);
#else
    return !(cia1.pra & JOY_FIRE);
#endif
}

#if AUTOPILOT
static char ap_cmd, ap_pos;             // the script's command and byte to type next
static unsigned text_fold, lines;
static char save_code = 0xff, load_code = 0xff;

// Up to ten bytes of the current command a frame, then its RETURN.
static void autopilot_feed(void)
{
    const char *s = script[ap_cmd];
    if (!s)
        return;
    while (KEYN < KEYMAX)
    {
        char c = s[ap_pos];
        KEYQ[KEYN] = c ? c : 0x0d;
        KEYN = KEYN + 1;
        if (!c)
        {
            ap_cmd++;
            ap_pos = 0;
            return;
        }
        ap_pos++;
    }
}

static unsigned fold16(unsigned f, char v)
{
    return (f ^ v) * 5 + 1;
}
#endif

// ---- frame -------------------------------------------------------------------------
// frame_sync_loop: line 250 is below the last badline on PAL and NTSC and
// comes once a frame, so the 8-bit compare needs no ninth bit.
static void wait_frame(void)
{
    while (vic.raster == 250) ;
    while (vic.raster != 250) ;
}

// PAL has lines up to $137, NTSC (6567R8) up to $106.
static bool detect_ntsc(void)
{
    for (unsigned i = 0; i < 12000; i++)
        if ((vic.ctrl1 & 0x80) && vic.raster >= 0x36)
            return false;
    return true;
}

static void set_state(char s)
{
    state = s;
    state_frames = 0xffff;              // the loop counts it up to 0 at the frame's end
}

// ---- title ---------------------------------------------------------------------------
static void title_draw(void)
{
    picture_draw(TITLE_PIC);
    clear_rows(PIC_ROWS, 24);
    put_text(9, 15, "STARWATCH", 7);
    put_text(11, 5, "A TEXT ADVENTURE IN TWELVE ROOMS", 3);
    put_text(14, 2, "TYPE TWO-WORD COMMANDS: GO NORTH, N,", 1);
    put_text(15, 2, "GET LAMP, OPEN CHEST, LOOK, INVENTORY.", 1);
    put_text(16, 2, "SAVE AND LOAD USE THE DISK IN DRIVE 8.", 1);
    put_text(19, 10, "PRESS RETURN OR FIRE", 7);
}

// ---- play ------------------------------------------------------------------------------
// After a turn or a disk call: the status bar, the picture, the sounds.
static void after_turn(void)
{
    status_draw();
    pic_want = picture_now();
    if (pic_want != pic_shown)
        pic_dirty = true;
    if (over == 1)
        sound_fanfare();
    else if (score > last_score)
        sound_chime();
    last_score = score;
}

static void play_start(void)
{
    clear_rows(PIC_ROWS, 24);
    for (char i = 0; i < 40; i++)
    {
        SCREEN[40 * RULE_ROW + i] = 0x2d;       // a blue rule of '-' under the window
        COLOUR[40 * RULE_ROW + i] = 6;
    }
    game_new();
    status_init();
    input_clear();
    pic_want = picture_now();
    pic_shown = 0xff;
    pic_dirty = true;
    last_score = 0;
    play_frames = 0;
    set_state(ST_PLAY);
}

// The input frame: the autopilot's keys, then every key in the queue until a RETURN.
static void input_frame(void)
{
#if AUTOPILOT
    autopilot_feed();
#endif
    for (;;)
    {
        char k = key_get();
        if (!k)
            break;
        sound_click();
        if (input_key(k))
        {
            game_command(input, input_len);
            input_clear();
            after_turn();
            break;
        }
    }
    input_cursor(frame);
}

// The disk clock: CIA2 timer A counts phi2 cycles and timer B counts timer
// A's underflows, a 32-bit count (as oscar64/save-load-seq-file). Timer A is
// the frame meter's, so the stop puts back what meter_init left: timer A
// stopped with $FFFF in its latch, and no underflow flag in $DD0D, which the
// meter would read as a frame of 65,535 cycles.
static unsigned long save_cycles, load_cycles;

static void disk_clock_start(void)
{
    cia2.cra = 0x00;
    cia2.crb = 0x00;
    cia2.ta = 0xffff;
    cia2.tb = 0xffff;
    cia2.crb = 0x51;                    // force load, start, count timer A underflows
    cia2.cra = 0x11;                    // force load, start, count phi2
}

static unsigned long disk_clock_stop(void)
{
    cia2.cra = 0x00;
    cia2.crb = 0x00;
    unsigned long c = ((unsigned long)(0xffff - cia2.tb) << 16) | (0xffff - cia2.ta);
    cia2.ta = 0xffff;                   // the meter's latch
    char flags = cia2.icr;              // reading $DD0D clears the underflow flag
    (void)flags;
    return c;
}

// SAVE or LOAD, on a frame that is not a play frame.
static void disk_frame(void)
{
    sound_mute(true);
    out_reset();
    disk_clock_start();
    if (disk_req == DISK_SAVE)
        game_save();
    else
        game_load();
    __asm { sei }                       // the KERNAL's serial routines end in CLI
    unsigned long c = disk_clock_stop();
    if (disk_req == DISK_SAVE)
        save_cycles = c;
    else
        load_cycles = c;
#if AUTOPILOT
    if (disk_req == DISK_SAVE)
        save_code = disk_code;
    else
        load_code = disk_code;
#endif
    disk_req = 0;
    sound_mute(false);
    after_turn();
}

#if AUTOPILOT
static void put_long(char row, char col, unsigned long v)   // eight digits
{
    char *d = SCREEN + 40 * row + col + 8;
    for (char i = 0; i < 8; i++)
    {
        *--d = 0x30 + (char)(v % 10);
        v /= 10;
    }
}

// The verdict: real state read back against the model, outside the meter.
static void verdict(void)
{
    unsigned lf = 0;
    for (char i = 1; i < NITEM; i++)
        lf = fold16(lf, loc[i]);
    for (char i = 1; i < NITEM; i++)
        lf = fold16(lf, opened[i]);
    bool ok = room == EXPECT_ROOM && score == EXPECT_SCORE && turns == EXPECT_TURNS &&
              flags == EXPECT_FLAGS && over == EXPECT_OVER && lf == EXPECT_LOCFOLD &&
              text_fold == EXPECT_TEXTFOLD && lines == EXPECT_LINES &&
              play_frames == EXPECT_FRAMES && save_code == EXPECT_SAVE_CODE &&
              load_code == EXPECT_LOAD_CODE;
    // The disk clock is plausible: every SAVE or LOAD the script made took
    // between 0.1 and 30 million cycles (the README has the measured figures).
    if (EXPECT_SAVE_CODE == 0 && (save_cycles < 100000 || save_cycles > 30000000))
        ok = false;
    if (EXPECT_LOAD_CODE == 0 && (load_cycles < 100000 || load_cycles > 30000000))
        ok = false;
    put_text(23, 0, "SAVE", 1);
    put_long(23, 5, save_cycles);
    put_text(23, 14, "LOAD", 1);
    put_long(23, 19, load_cycles);
    put_text(23, 28, "CYCLES", 1);
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    put_text(24, 0, ok ? "RESULT 01 PASS " : "RESULT 02 FAIL ", 1);
    unsigned f = text_fold;                     // the fold in hex, as screen codes
    char *d = SCREEN + 40 * 24 + 18;
    for (char i = 0; i < 4; i++)
    {
        char n = f & 15;
        *d-- = n < 10 ? 0x30 + n : n - 9;
        f >>= 4;
    }
}
#endif

// A frame that is not play: a disk call waiting, or the game is over, or
// (autopilot) the script has run out.
static bool between_frames(void)
{
#if AUTOPILOT
    bool done = over || !script[ap_cmd];
#else
    bool done = over;
#endif
    return disk_req || done;
}

static void play_frame(void)
{
    METER_START;
    bool printing = pic_dirty || printer_ready();
    if (!printing && between_frames())
    {
        meter_read();                   // stops the timer: this frame is not recorded
        if (disk_req)
            disk_frame();
        else
        {
            clear_rows(INPUT_ROW, INPUT_ROW);
            set_state(ST_END);
#if AUTOPILOT
            verdict();
#endif
        }
        return;
    }
    sound_update();
    key_scan();
    bool line = false;
    if (pic_dirty)
    {
        picture_draw(pic_want);
        pic_shown = pic_want;
        pic_dirty = false;
    }
    else if (printing)
    {
        printer_line();
        line = true;
    }
    else
        input_frame();
    METER_STOP;                         // the frame's own work ends here
    play_frames++;
#if AUTOPILOT
    if (line)                           // the grading's own fold: outside the bracket
    {
        const char *row = SCREEN + 40 * WIN_BOTTOM;
        for (char i = 0; i < 40; i++)
            text_fold = fold16(text_fold, row[i]);
        lines++;
    }
#endif
}

int main(void)
{
    __asm { sei }
    cia1.icr = 0x7f;                    // no CIA1 interrupts: the KERNAL's CLIs find none
    MODE = 0x80;
    KEYN = 0;
#if !AUTOPILOT && defined(JOY_SOURCE)
    *(volatile char *)JOY_SOURCE = 0xff;        // nothing pressed until the monitor says so
#endif
    ntsc = detect_ntsc();
    video_init();
    sound_init(ntsc);
    clear_rows(0, 24);
#if AUTOPILOT
    meter_init(0x0400, 24, 20, VCOL_WHITE, METER_HOLD);   // hold: the script's play frames
#endif
    title_draw();
    set_state(ST_TITLE);

    for (;;)
    {
        wait_frame();
        frame++;
        if (state == ST_PLAY)
            play_frame();
        else
        {
            sound_update();
            key_scan();
#if AUTOPILOT
            if (state == ST_TITLE && state_frames == 2)
            {
                KEYQ[KEYN] = 0x0d;      // the title's RETURN, typed like the rest
                KEYN = KEYN + 1;
            }
#endif
            char k = key_get();
            bool fire = fire_pressed();
            bool go = k == 0x0d || (fire && !fire_was);     // joystick_edge_detect: a new press
            fire_was = fire;
            if (state == ST_TITLE && go)
                play_start();
            else if (state == ST_END && go && !AUTOPILOT)
            {
                title_draw();
                set_state(ST_TITLE);
            }
        }
#if AUTOPILOT
        meter_print();
#endif
        state_frames++;
    }
    return 0;
}
