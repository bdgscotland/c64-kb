// main.c: CAVE RUN, the action-puzzle starter. The game's states and the
// frame loop; the rules are in cave.c, the caves in level.c, the screen in
// render.c, sound in sound.c, the high-score table and its file in hiscore.c.
//
// AUTOPILOT=1 plays a scripted game (tools/gen.py writes the script and what
// the model says the game must end with) and grades itself: $02FF = $01 and
// a green border on pass, $02 and red on fail. FORCE_FAULT=1 flips one byte
// of the high-score file as it is read back after the save (hiscore.c), so
// the verdict and the table's save line change.
#include <c64/vic.h>
#include <c64/cia.h>
#include "frame_meter.h"            // templates/_harness/meter
#include "cave.h"
#include "level.h"
#include "render.h"
#include "sound.h"
#include "hiscore.h"

#ifndef AUTOPILOT
#define AUTOPILOT 0
#endif
#ifndef FORCE_FAULT
#define FORCE_FAULT 0
#endif

// Memory: code and data below the character set at $2000-$27FF, the rest above.
#pragma region( lower, 0x0880, 0x2000, , , { code, data } )
#pragma region( main, 0x2800, 0xa000, , , { code, data, bss, heap, stack } )

#if AUTOPILOT
#include "gen_autopilot.h"       // the script and the model's EXPECT_ values
#endif

#define RESULT  (*(volatile char *)0x02ff)   // $01 pass, $02 fail, $00 not reached

#define JOY_UP    0x01
#define JOY_DOWN  0x02
#define JOY_LEFT  0x04
#define JOY_RIGHT 0x08
#define JOY_FIRE  0x10

#define SLICES        4             // display frames per cave frame; tools/gen.py SLICE_FRAMES
#define SLICE_ROWS    5             // 20 interior rows / SLICES
#define DEATH_FRAMES  6             // cave frames from a death to the next life; tools/gen.py
#define LIVES         3
#define DISK_WAIT     50            // frames before the first OPEN (pitfall first_open_after_reset_hangs_on_pal)

enum { ST_TITLE, ST_NEXT, ST_PLAY, ST_NAME, ST_TABLE };

static char state;
static unsigned state_frames;       // frames since the state began
static char joy, joy_prev;          // port 2 this frame and last, active low
static char play_frame;             // drives the glyph animation
static unsigned play_frames;        // play frames this game (the meter's hold)

static unsigned long score;         // banked score; the cave's own points are added on leaving it
static char lives, cave_index, slice, dead_frames, total_gems;
static unsigned cave_frames;        // cave frames since this start: the autopilot's script index
static char starts;                 // cave starts this game (new cave or restart): the script's key
static char pending = NO_MOVE;      // a direction tapped since the last cave frame
static unsigned end_fold;           // the fold chained over every cave the game left
static char dropped;                // play frames whose work ran past line 250 (a frame lost)
static bool seen_ok = true;         // the scan met the living player once in every cave frame
static bool screen_ok = true;       // the screen matched the cave at every cave end

static char name[3], name_pos, letter;
static char rank;
static bool ntsc;

// ---- input ------------------------------------------------------------------
#if AUTOPILOT
static char ap_name[64];            // one byte a frame: press, release, ...
static char ap_name_len;

static void ap_build_name(void)
{
    for (char k = 0; k < 3; k++)
    {
        for (char u = 'A'; u < NAME_AUTOPILOT[k]; u++)
        {
            ap_name[ap_name_len++] = 0xff & ~JOY_UP;
            ap_name[ap_name_len++] = 0xff;
        }
        ap_name[ap_name_len++] = 0xff & ~JOY_FIRE;
        ap_name[ap_name_len++] = 0xff;
    }
}

// The move for this cave frame, keyed to the game's own counters: which
// start this is (starts, 1 for the first) and the cave frame within it.
static char ap_move_byte(void)
{
    char k = starts - 1;
    if (k >= SCRIPT_STARTS || cave_frames >= script_len[k])
        return 0xff;
    char m = script_for[k][cave_frames];
    return m == 'L' ? 0xff & ~JOY_LEFT : m == 'U' ? 0xff & ~JOY_UP :
           m == 'R' ? 0xff & ~JOY_RIGHT : m == 'D' ? 0xff & ~JOY_DOWN : 0xff;
}

// The synthetic port byte: the same path a joystick takes.
static char port_read(void)
{
    if (state == ST_TITLE)
        return state_frames == 2 ? 0xff & ~JOY_FIRE : 0xff;
    if (state == ST_PLAY)
        return ap_move_byte();
    if (state == ST_NAME && state_frames >= 4 && state_frames - 4 < ap_name_len)
        return ap_name[state_frames - 4];
    return 0xff;
}
#elif defined(JOY_SOURCE)
// Headless driving of the normal game: the port byte comes from RAM at
// JOY_SOURCE, which a VICE monitor writes (make joy; README "Driving it
// headless"). The windowless VICE's joyport commands do not reach $DC00.
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

static bool pressed(char bit)       // a new press this frame (joystick_edge_detect)
{
    return !(joy & bit) && (joy_prev & bit);
}

// The direction for this cave frame: the one held now, else the last one
// tapped during the cave frame before. Up wins over down over left over right.
static char held_direction(void)
{
    if (!(joy & JOY_UP))    return 1;
    if (!(joy & JOY_DOWN))  return 3;
    if (!(joy & JOY_LEFT))  return 0;
    if (!(joy & JOY_RIGHT)) return 2;
    return NO_MOVE;
}

// ---- frame -------------------------------------------------------------------
// frame_sync_loop: line 250 is below the last badline on PAL and NTSC and
// occurs once a frame, so the 8-bit compare needs no ninth bit.
// It also says whether line 250 passed since the last call: the VIC sets
// bit 0 of $D019 on every raster compare match, with the interrupt itself
// left disabled, so a set bit on entry means the frame's work overran.
static bool wait_frame(void)
{
    bool late = vic.intr_ctrl & 0x01;
    while (vic.raster == 250) ;
    while (vic.raster != 250) ;
    vic.intr_ctrl = 0x01;                       // acknowledge this frame's match
    return late;
}

// PAL has lines up to $137, NTSC (6567R8) up to $106: look for a line
// above $136 during a few frames.
static bool detect_ntsc(void)
{
    for (unsigned i = 0; i < 12000; i++)
        if ((vic.ctrl1 & 0x80) && vic.raster >= 0x36)
            return false;
    return true;
}

// The loop counts state_frames up at the end of each frame, so a state set
// during a frame reads 0 on its first frame of its own.
static void set_state(char s)
{
    state = s;
    state_frames = 0xffff;
}

// ---- screens -----------------------------------------------------------------
static char hud_got, hud_time;      // what the HUD shows now
static unsigned hud_points;

static void draw_hud(void)
{
    put_text(0, 0, "GEMS   /   TIME     SCORE        LIVES  ", VCOL_WHITE);
    put_num(0, 5, cave_got, 2, VCOL_CYAN);
    put_num(0, 8, cave_need, 2, VCOL_CYAN);
    put_num(0, 16, cave_time, 3, VCOL_YELLOW);
    put_num(0, 26, score + cave_points, 6, VCOL_WHITE);
    put_num(0, 39, lives, 1, VCOL_YELLOW);
    hud_got = cave_got;
    hud_time = cave_time;
    hud_points = cave_points;
}

// Once a cave frame: rewrite only the fields that changed. The six-digit
// score in 32-bit arithmetic is the dearest; rewriting all three fields every
// cave frame made the worst PAL play frame 12,241 cycles instead of 10,037
// (frame meter, both builds; later edits moved code and the figure by a few
// cycles, see README.md for the current one).
static void update_hud(void)
{
    if (cave_got != hud_got)
        put_num(0, 5, hud_got = cave_got, 2, VCOL_CYAN);
    if (cave_time != hud_time)
        put_num(0, 16, hud_time = cave_time, 3, VCOL_YELLOW);
    if (cave_points != hud_points)
    {
        hud_points = cave_points;
        put_num(0, 26, score + cave_points, 6, VCOL_WHITE);
    }
}

static void draw_table(char row, char col)
{
    for (char r = 0; r < HI_ROWS; r++)
    {
        put_num(row + r, col, r + 1, 1, VCOL_WHITE);
        put_text(row + r, col + 1, ".", VCOL_WHITE);
        put_codes(row + r, col + 3, hi.row[r].name, 3, r == rank ? VCOL_YELLOW : VCOL_LT_BLUE);
        put_num(row + r, col + 7, hi.row[r].score, 6, r == rank ? VCOL_YELLOW : VCOL_WHITE);
    }
}

// What the start-up load found, and the drive's two-digit reply (99: no drive).
static void draw_disk_line(char row, char col)
{
    const char *s = "SCORES FROM DISK ";
    if (hi_state == HI_FIRST) s = "NO SCORE FILE YET";
    if (hi_state == HI_OLD)   s = "OLD SCORE FILE   ";
    if (hi_state == HI_OFF)   s = "NOT SAVING       ";
    put_text(row, col, s, VCOL_LT_GREY);
    put_text(row, col + 18, "(  )", VCOL_LT_GREY);
    put_num(row, col + 19, hi_code, 2, VCOL_LT_GREY);
}

static void draw_title(void)
{
    render_clear();
    put_text(2, 15, "CAVE RUN", VCOL_YELLOW);
    put_text(4, 5, "DIG, PUSH, COLLECT, ESCAPE", VCOL_LT_BLUE);
    put_text(7, 14, "HIGH SCORES", VCOL_WHITE);
    rank = HI_ROWS;
    draw_table(9, 13);
    draw_disk_line(16, 9);
    put_text(20, 12, "FIRE TO START", VCOL_WHITE);
    put_text(22, 3, "JOYSTICK IN PORT 2. GET THE GEMS,", VCOL_MED_GREY);
    put_text(23, 3, "THEN FIND THE EXIT BEFORE TIME ENDS", VCOL_MED_GREY);
}

static void draw_box(const char *title)
{
    fill_box(6, 7, 19, 32, VCOL_WHITE);
    put_text(7, 20 - 4, title, VCOL_YELLOW);
}

// ---- the game -----------------------------------------------------------------
static void start_cave(void)
{
    starts++;
    render_clear();
    level_load(cave_index);         // the RLE decode, timed on CIA1 timer B
    draw_cave();
    draw_hud();
    put_codes(24, 0, level_name(cave_index), 16, VCOL_LT_GREY);
    put_text(23, 14, "GET READY", VCOL_YELLOW);
    slice = 0;
    cave_frames = 0;
    dead_frames = 0;
    pending = NO_MOVE;
    set_state(ST_NEXT);
}

// The fold is chained over every cave the game leaves, as tools/gen.py does.
static void game_over(void)
{
    rank = hi_rank(score);
    if (rank < HI_ROWS)
    {
        draw_box("NEW SCORE");
        put_text(10, 12, "ENTER YOUR NAME", VCOL_WHITE);
        put_text(12, 13, "UP/DOWN, FIRE", VCOL_MED_GREY);
        name[0] = name[1] = name[2] = 0x2e;     // '.'
        name_pos = 0;
        letter = 1;
        set_state(ST_NAME);
    }
    else
        set_state(ST_TABLE);
}

// At every cave end (AUTOPILOT): the renderer finishes its queued rows, then
// every cell on screen must show the cave's element. This gates the dirty
// list, the overflow row queue and draw_row in every cave, not only the one
// on screen at the verdict. It runs between caves, outside the meter.
static void check_screen(void)
{
#if AUTOPILOT
    for (char k = 0; k < CH; k++)
        draw_pending();
    const char *s = SCREEN + CW * CAVE_ROW0;
    for (unsigned i = 0; i < CW * CH; i++)
        if (s[i] != GLYPH_BASE + (cave[i] & 0x1f))
            screen_ok = false;
#endif
}

static void lose_life(void)
{
    check_screen();
    end_fold = cave_fold(end_fold);
    score += cave_points;
    total_gems += cave_got;
    put_num(0, 39, --lives, 1, VCOL_YELLOW);
    if (lives == 0)
        game_over();
    else
        start_cave();
}

static void leave_cave(void)
{
    check_screen();
    end_fold = cave_fold(end_fold);
    score += cave_points + cave_time;           // time bonus: what is left of the counter
    total_gems += cave_got;
    if (++cave_index == level_count)
        cave_index = 0;
    start_cave();
}

static void effects_for(char ev)
{
    if (ev & EV_BOOM)      sfx_play(SFX_BOOM);
    else if (ev & EV_OPEN) sfx_play(SFX_OPEN);
    else if (ev & EV_GEM)  sfx_play(SFX_GEM);
    else if (ev & EV_LAND) sfx_play(SFX_LAND);
    else if (ev & EV_PUSH) sfx_play(SFX_PUSH);
    else if (ev & EV_DIG)  sfx_play(SFX_DIG);
}

// One display frame of play: one slice of the cave scan and its redraw.
static void play_frame_work(void)
{
    char d = held_direction();
    if (slice == 0)
    {
        cave_move = d != NO_MOVE ? d : pending;
        pending = NO_MOVE;
        cave_seen = 0;
    }
    else if (d != NO_MOVE && (joy_prev & 0x0f) == 0x0f)
        pending = d;                            // a tap between two cave frames is kept
    char y0 = 1 + SLICE_ROWS * slice;
    cave_scan_rows(y0, y0 + SLICE_ROWS);
    draw_dirty(y0, y0 + SLICE_ROWS);
    if (slice == SLICES - 1)
    {
        cave_ndirty = 0;
        cave_overflow = false;
        cave_end_frame();                       // exit, clock
        draw_dirty(1, CH - 1);
        // The scan met the living player exactly once (cave-scan's scanned
        // bit); a dead one at most once. SCAN_FLAG=0 breaks this.
        if (cave_dead ? cave_seen > 1 : cave_seen != 1)
            seen_ok = false;
        update_hud();
        cave_frames++;
    }
    draw_pending();                             // rows an overflowed slice queued
    effects_for(cave_events);
    cave_events = 0;
    render_animate(play_frame++);
    play_frames++;
    slice = (slice + 1) & (SLICES - 1);
}

// After the frame's last slice: leave, lose a life, or play on.
static void after_cave_frame(void)
{
    if (cave_exited)
        leave_cave();
    else if (cave_dead && ++dead_frames == DEATH_FRAMES)
        lose_life();
}

static void save_scores(void)
{
    put_text(17, 9, "SAVING TO DISK ...     ", VCOL_LT_GREY);
    sound_mute(true);
    hi_save();                                  // KERNAL: its serial routines end in CLI
    __asm { sei }
    cia1.pra = 0xff;                            // the KERNAL's key scan left a column selected
    sound_mute(false);
}

static void name_frame(void)
{
    if (pressed(JOY_UP))
        letter = letter == 26 ? 1 : letter + 1;
    if (pressed(JOY_DOWN))
        letter = letter == 1 ? 26 : letter - 1;
    if (pressed(JOY_FIRE))
    {
        name[name_pos++] = letter;
        letter = 1;
        if (name_pos == 3)
        {
            hi_insert(rank, name, score);
            save_scores();
            set_state(ST_TABLE);
            return;
        }
    }
    put_codes(14, 18, name, 3, VCOL_YELLOW);
    put_codes(14, 18 + name_pos, &letter, 1, VCOL_WHITE);
}

static void table_enter(void)
{
    draw_box("GAME OVER");
    put_text(9, 14, "HIGH SCORES", VCOL_WHITE);
    draw_table(11, 13);
    if (rank < HI_ROWS)
    {
        put_text(17, 9, hi_verified ? "SAVED TO DISK     (  )" :
                        hi_saving   ? "READ BACK BAD     (  )" : "NOT SAVED         (  )", VCOL_LT_GREY);
        put_num(17, 28, hi_code, 2, VCOL_LT_GREY);
    }
    else
        draw_disk_line(17, 9);
}

#if AUTOPILOT
// The verdict: real state read back against tools/gen.py's model, after the
// table is on screen. It runs outside the meter's bracket.
//
// Each failed test prints its letter after the fold, so a red run says why:
// F fold, S score, G gems, C cave, P play frames, K cave starts, T the table
// row, L a cave decode, E the scan met the player other than once, D a
// dropped frame, V the save's read-back, M the screen against the cave.
static char fails[12], nfails;

static void need(bool ok, char letter)
{
    if (!ok)
        fails[nfails++] = letter - 'A' + 1;
}

static void verdict(void)
{
    bool row_ok = rank == EXPECT_RANK && hi.row[EXPECT_RANK].score == EXPECT_SCORE;
    for (char k = 0; k < 3; k++)
        if (hi.row[EXPECT_RANK].name[k] != NAME_AUTOPILOT[k] - 'A' + 1)
            row_ok = false;
    need(end_fold == EXPECT_FOLD, 'F');
    need(score == EXPECT_SCORE, 'S');
    need(total_gems == EXPECT_GEMS, 'G');
    need(cave_index == EXPECT_CAVE, 'C');
    need(play_frames == EXPECT_PLAY_FRAMES, 'P');
    need(starts == EXPECT_STARTS, 'K');
    need(row_ok, 'T');
    need(level_ok, 'L');
    need(seen_ok, 'E');
    need(dropped == 0, 'D');
    need(screen_ok, 'M');
    need(hi_verified, 'V');
    bool ok = nfails == 0;
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    put_text(23, 0, ok ? "RESULT 01 PASS" : "RESULT 02 FAIL", VCOL_WHITE);
    put_text(23, 16, "FOLD", VCOL_WHITE);
    put_num(23, 21, end_fold, 5, VCOL_WHITE);
    put_codes(23, 27, fails, nfails, VCOL_YELLOW);
    put_text(24, 0, "                    ", VCOL_WHITE);
    put_text(24, 0, "DECODE", VCOL_WHITE);
    put_num(24, 7, level_cycles, 5, VCOL_WHITE);
    put_text(24, 13, "DROP", VCOL_WHITE);
    put_num(24, 18, dropped, 2, VCOL_WHITE);
}
#endif

static void new_game(void)
{
    score = 0;
    total_gems = 0;
    cave_index = 0;
#if AUTOPILOT
    lives = LIVES_AUTOPILOT;            // the script plays every life to game over
#else
    lives = LIVES;
#endif
    starts = 0;
    end_fold = 0;
    dropped = 0;
    seen_ok = true;
    screen_ok = true;
    play_frames = 0;
    play_frame = 0;
    rank = HI_ROWS;
    start_cave();
}

int main(void)
{
    __asm { sei }                               // no KERNAL IRQ: the loop polls the raster
    cia1.pra = 0xff;                            // no keyboard column selected
#if !AUTOPILOT && defined(JOY_SOURCE)
    *(volatile char *)JOY_SOURCE = 0xff;        // nothing pressed until the monitor says so
#endif
    render_init();
    // The compare line wait_frame's late test reads: 250. Bit 7 of $D011 is
    // its ninth bit, and the KERNAL leaves compare line 311 behind (bit 8
    // set), so it is cleared here; without that the latch never set in VICE
    // (0 of 200 frames, against 199 of 200 with it; a test program here).
    vic.ctrl1 = vic.ctrl1 & 0x7f;
    vic.raster = 250;
    ntsc = detect_ntsc();
    sound_init(ntsc);
#if AUTOPILOT
    meter_init(0x0400, 24, 20, VCOL_WHITE, EXPECT_PLAY_FRAMES);   // hold: the script's play frames
#endif
    render_clear();
    put_text(12, 13, "LOADING SCORES", VCOL_WHITE);
#if AUTOPILOT
    ap_build_name();
#endif
    for (char i = 0; i < DISK_WAIT; i++)
        wait_frame();
    hi_load();                                  // KERNAL: ends in CLI
    __asm { sei }
    cia1.pra = 0xff;
    draw_title();
    set_state(ST_TITLE);

    for (;;)
    {
        bool late = wait_frame();
        if (late && state == ST_PLAY)
            dropped++;                          // the last play frame's work overran line 250
        joy_prev = joy;
        joy = port_read();

        if (state == ST_PLAY)
        {
            METER_START;
            music_play();
            sfx_update();
            play_frame_work();
            METER_STOP;                         // the frame's own work ends here
            if (slice == 0)
                after_cave_frame();             // state changes: outside the bracket
#if AUTOPILOT
            // A watchdog: past the model's play frames the game has gone
            // another way (a broken rule, SCAN_FLAG=0), so end it and grade.
            if (state == ST_PLAY && play_frames > EXPECT_PLAY_FRAMES)
            {
                check_screen();
                end_fold = cave_fold(end_fold);
                score += cave_points;
                total_gems += cave_got;
                game_over();
            }
#endif
        }
        else
        {
            music_play();
            sfx_update();
            if (state == ST_TITLE && pressed(JOY_FIRE))
                new_game();
            else if (state == ST_NEXT)
            {
                render_animate(play_frame++);
                if (state_frames == 40)
                {
                    put_text(23, 14, "         ", VCOL_WHITE);
                    set_state(ST_PLAY);
                }
            }
            else if (state == ST_NAME)
                name_frame();
            else if (state == ST_TABLE && state_frames == 0)
            {
                table_enter();
#if AUTOPILOT
                verdict();
#endif
            }
            else if (state == ST_TABLE && !AUTOPILOT && (state_frames > 600 || pressed(JOY_FIRE)))
            {
                draw_title();
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
