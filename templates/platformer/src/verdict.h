// verdict.h: the AUTOPILOT build grades itself once the script is over,
// from the game's own state, and freezes. Included by main.c only when
// AUTOPILOT is set. $02FF = $01 and a green border on a pass, $02 and red
// on a fail (c64-kb headless-verify); row 21 says which checks failed.
//
// DEBUG_AT=n (a build define) freezes at frame n instead and prints the
// state on row 21: frame, player x and y, camera, events, state, respawn
// x; row 23 the live enemies' x. That is how the script was timed.
#ifndef DEBUG_AT
#define DEBUG_AT 0
#endif
#define VERDICT_FRAME 860           // the script ends at 823; the player stands at the wall

// What the script does, by design (autopilot.h): five coins (three by the
// hill, two on the ledge), one stomp, one hit from the hopper, one respawn.
#define EXPECT_COINS  5
#define EXPECT_STOMPS 1
#define EXPECT_HURTS  1
#define EV_ALL        0x1fff
// The brick at tile 45 has its left edge at x 720; the wall probe stops the
// foot column BODY_HALF + 1 short of it, and the camera settles with the
// player CAM_RIGHT (140) pixels in: arithmetic, not a pinned run.
#define EXPECT_PX     (720 - BODY_HALF - 1)
#define EXPECT_CAMX   (EXPECT_PX - 140)

static void put_num(char row, char col, unsigned v, char width)
{
    char *p = HUDPAGE + row * 40 + col + width;
    for (char i = 0; i < width; i++)
    {
        unsigned q = v / 10;
        *--p = '0' + (char)(v - q * 10);
        v = q;
    }
}

static void put_hex(char row, char col, unsigned v)
{
    char *p = HUDPAGE + row * 40 + col;
    for (char i = 0; i < 4; i++)
    {
        char d = (v >> (12 - 4 * i)) & 15;
        p[i] = d < 10 ? '0' + d : d - 9;    // screen codes: A is 1
    }
}

static void debug_print(void)
{
    put_num(21, 0, frame, 4);
    put_num(21, 5, px, 4);
    put_num(21, 10, py >> 8, 3);
    put_num(21, 14, camx, 4);
    put_num(21, 19, events, 5);
    put_num(21, 25, state, 1);
    put_num(21, 27, safe_x, 4);
    for (char s = 0; s < NSLOT; s++)
        put_num(23, 10 + s * 5, slot_lvl[s] == NO_SLOT ? 0 : slot_x[s], 4);
}

// Every ready page against the level at its column: the scroll's own check.
static bool pages_match(void)
{
    for (char p = 0; p < NPAGES; p++)
    {
        if (page_rows[p] < PF_ROWS || page_col[p] < 0 || page_col[p] > LEVEL_CW - 40)
            continue;
        const char *q = p == 0 ? PAGE0 : p == 1 ? PAGE1 : PAGE2;
        for (char r = 0; r < PF_ROWS; r++)
            for (char c = 0; c < 40; c++)
                if (q[r * 40 + c] != cell_char(page_col[p] + c, r))
                    return false;
    }
    return true;
}

// The activation window's promises: a live entry is in exactly one slot;
// a dormant, living entry is never inside the view; every live actor is
// inside the drop window.
static bool window_holds(void)
{
    char cc = camx >> 3;
    for (char i = 0; i < lvl_count; i++)
    {
        char n = 0;
        for (char s = 0; s < NSLOT; s++)
            if (slot_lvl[s] == i)
                n++;
        if ((lvl_flags[i] & LF_LIVE) ? n != 1 : n != 0)
            return false;
        if (!(lvl_flags[i] & (LF_LIVE | LF_DEAD)) && lvl_col[i] >= cc && lvl_col[i] < cc + 40)
            return false;
    }
    for (char s = 0; s < NSLOT; s++)
    {
        char c = slot_x[s] >> 3;
        if (slot_lvl[s] != NO_SLOT && (c + 6 < cc || c > cc + 46))
            return false;
    }
    return true;
}

// The sprite registers the VIC was given last blank against the model.
static bool sprites_match(void)
{
    unsigned sx = px - 8 - camx + 31;
    return vic.spr_pos[0].x == (char)sx && (vic.spr_msbx & 1) == (sx >> 8) &&
           vic.spr_pos[0].y == (char)((py >> 8) - 21 + 50) && (vic.spr_enable & 1) &&
           (vic.spr_color[0] & 15) == COL_PLAYER;
}

static void grade(void)
{
    unsigned value = 0;
    for (char i = 0; i < 6; i++)
        value = value * 10 + score[i];
    unsigned fails = 0;
    if (events != EV_ALL)                                   fails |= 0x0001;
    if (value != coins * 10u + stomps * 100u)               fails |= 0x0002;
    if (coins != EXPECT_COINS || stomps != EXPECT_STOMPS)   fails |= 0x0004;
    if (hurts != EXPECT_HURTS || lives != START_LIVES - EXPECT_HURTS) fails |= 0x0008;
    if (px != EXPECT_PX || (py >> 8) != 128 || !pground)    fails |= 0x0010;
    if (camx != EXPECT_CAMX)                                fails |= 0x0020;
    if (!pages_match())                                     fails |= 0x0040;
    if (!window_holds())                                    fails |= 0x0080;
    if (!(lvl_flags[1] & LF_DEAD) || (lvl_flags[0] & (LF_LIVE | LF_DEAD)))
        fails |= 0x0100;                                    // stomped stays dead; the walker left behind sleeps
    if (!sprites_match())                                   fails |= 0x0200;
    if (late)                                               fails |= 0x0400;

    bool ok = fails == 0;
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    put_text(21, 0, ok ? "result 01 pass" : "result 02 fail");
    if (!ok)
        put_hex(21, 15, fails);
}

// Right after the IRQ at line 251 has set the new picture up, its camera
// goes on row 23 ("CAM 0576"), so tools/tearcheck.py can compare the
// picture with the camera the program meant: a page and an XSCROLL that
// disagree put the picture 8 pixels off.
static void autopilot_blank(void)
{
    put_text(23, 30, "cam");
    put_num(23, 34, pub_camx, 4);
}

static void autopilot_frame(void)
{
    if (state == ST_GRADED)
        return;
    if (DEBUG_AT && frame == DEBUG_AT)
    {
        debug_print();
        state = ST_GRADED;
    }
    else if (frame == VERDICT_FRAME)
    {
        grade();
        meter_print();
        state = ST_GRADED;
    }
}
