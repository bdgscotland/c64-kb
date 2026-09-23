// verdict.h: the AUTOPILOT build's pictures and self-check. Included by
// main.c only when AUTOPILOT is set.
//
// Photo stops. At three crowded moments (four fighters in view, every part
// inside the sprite X range, ground lines within 24: all eight sprites of
// the fighter band on the same lines), two in stage 2 and one in stage 3,
// the game is held for PHOTO_FRAMES frames: nothing moves, the IRQs run as
// in play, and HUD rows 21-23 show the fighters' state instead of the bars
// and faces. tools/flickercheck.py shoots inside the stops, builds the
// eight parts from art.c itself, and matches the picture.
//
// The verdict. After stage 3's first wave is beaten the program grades
// itself and freezes: $02FF = $01 and a green border on a pass, $02 and
// red on a fail; on a fail row 24 column 12 shows the failed checks as bits
// (the `fails` bits in grade()) (c64-kb headless-verify).
//
// DEBUG_AT=n (a build define) freezes at frame n instead and prints the
// state: row 21 frame, hero x, y, mode, hp, camera, stage, wave, events;
// row 22 each enemy's x, y, mode and AI state.
#ifndef DEBUG_AT
#define DEBUG_AT 0
#endif
#define PHOTO_FRAMES 64
#define PHOTOS       3
#define PHOTO_GAP    400            // frames between stops, so they are not all in one fight
#define GRADE_DELAY  20             // frames after the wave is beaten: before the next spawns (40)

static char photo_left, photos, grade_wait;
static unsigned photo_last;

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

static void put_hex(char *p, unsigned v, char digits)
{
    for (char i = 0; i < digits; i++)
    {
        char d = (v >> (4 * (digits - 1 - i))) & 15;
        p[i] = d < 10 ? '0' + d : d - 9;    // screen codes: A is 1
    }
}

static void debug_print(void)
{
    hud_clear();
    put_num(21, 0, frame, 5);
    put_num(21, 6, fx[0], 4);
    put_num(21, 11, fy[0], 3);
    put_num(21, 15, fmode[0], 1);
    put_num(21, 17, fhp[0], 2);
    put_num(21, 20, camx, 4);
    put_num(21, 25, stage, 1);
    put_num(21, 27, wave, 1);
    put_num(21, 29, events, 5);
    for (char f = 1; f < NFIGHT; f++)
    {
        put_num(22, (f - 1) * 13, fx[f], 4);
        put_num(22, (f - 1) * 13 + 5, fy[f], 3);
        put_num(22, (f - 1) * 13 + 9, fmode[f], 1);
        put_num(22, (f - 1) * 13 + 11, ai_state[f], 1);
    }
}

// ---- photo stops ---------------------------------------------------------------
// From the model, not the sprite table (FLICKER_DEMO drops a part from the
// table, and its stops must fall where the real build's do): four fighters
// in view, none blinking, every part inside the sprite X range, the ground
// lines within 24.
static bool crowded(void)
{
    char lo = 255, hi = 0;
    for (char f = 0; f < NFIGHT; f++)
    {
        if (fmode[f] == M_OFF || fmode[f] == M_KO || finvuln[f])
            return false;
        for (char k = 0; k < 2; k++)
        {
            int x = part_vic_x(f, k);
            if (x <= 0 || x >= 344)
                return false;
        }
        if (fy[f] < lo)
            lo = fy[f];
        if (fy[f] > hi)
            hi = fy[f];
    }
    return hi - lo <= 24;
}

// The model the picture must show, not the sprite table: on HUD rows 21-23,
// "PHOTO n CAM cccc", then per fighter "xxxxyyhhpfk": world x, ground line,
// height, pose, facing, kind, in hex, two fighters a row. The tool builds
// the parts from art.c's pose table itself, so a part the multiplexer
// dropped or showed wrong is a mismatch.
static void photo_dump(void)
{
    for (unsigned i = 21 * 40; i < 24 * 40; i++)
        HUDPAGE[i] = CH_SPACE;
    put_text(21, 0, "photo");
    put_num(21, 6, photos, 1);
    put_text(21, 8, "cam");
    put_hex(HUDPAGE + 21 * 40 + 12, camx, 4);
    for (char f = 0; f < NFIGHT; f++)
    {
        char *p = HUDPAGE + (22 + (f >> 1)) * 40 + (f & 1) * 14;
        put_hex(p, fx[f], 4);
        put_hex(p + 4, fy[f], 2);
        put_hex(p + 6, fh[f], 2);
        put_hex(p + 8, anim_pose(&fanim[f]), 1);
        put_hex(p + 9, fface[f], 1);
        put_hex(p + 10, fkind[f], 1);
    }
}

static void photo_frame(void)
{
    if (photo_left)
    {
        if (--photo_left == 0)
        {
            photo = false;
            faces_off = false;
            for (unsigned i = 21 * 40; i < 24 * 40; i++)
                HUDPAGE[i] = CH_SPACE;
            hud_dirty = true;
            photo_last = frame;
        }
        return;
    }
    // Two in the second stage's fights, the third in the last stage's.
    bool due = stage == 2 ? photos < PHOTOS : photos < PHOTOS - 1;
    if (due && state == ST_PLAY && frame - photo_last > PHOTO_GAP && crowded())
    {
        photos++;
        photo = true;
        faces_off = true;
        photo_left = PHOTO_FRAMES;
        photo_dump();
    }
}

// ---- the verdict -----------------------------------------------------------------
// Both pages against the street at their columns; row 20 blank on both.
static bool pages_match(void)
{
    for (char p = 0; p < NPAGES; p++)
    {
        const char *q = page_ptr(p);
        for (char c = 0; c < 40; c++)
            if (q[PF_ROWS * 40 + c] != CH_SPACE)
                return false;
        if (page_rows[p] < PF_ROWS || page_col[p] < 0 || page_col[p] > LEVEL_CW - 40)
            continue;
        for (char r = 0; r < PF_ROWS; r++)
            for (char c = 0; c < 40; c++)
                if (q[r * 40 + c] != cell_char(page_col[p] + c, r))
                    return false;
    }
    return true;
}

// The hero's two parts in the fighter band the IRQ shows, found by pointer
// and X, against his pose and position (arithmetic here, not view.c's).
static bool hero_in_band(void)
{
    char front = *(volatile char *)ASM_FRONT;
    char fi = front >> 3;
    char en = *(volatile char *)(ASM_BEN1 + fi);
    char msb = *(volatile char *)(ASM_BMSB1 + fi);
    const struct Part *pt = pose_part[anim_pose(&fanim[0])];
    char found = 0;
    for (char k = 0; k < 2; k++)
    {
        int x = (int)fx[0] - (int)camx + 31;
        x = fface[0] == FACE_RIGHT ? x + pt[k].dx : x - 24 - pt[k].dx;
        char ptr = SPR_BLOCK + pt[k].block + (fface[0] == FACE_LEFT ? B_MIRROR : 0);
        char y = fy[0] - fh[0] + pt[k].dy;
        for (char s = 0; s < 8; s++)
        {
            unsigned sx = *(volatile char *)(ASM_BX1 + front + s) | ((msb >> s) & 1 ? 0x100 : 0);
            if ((en >> s) & 1 && sx == (unsigned)x && *(volatile char *)(ASM_BY1 + front + s) == y &&
                *(volatile char *)(ASM_BP1 + front + s) == ptr)
                found++;
        }
    }
    return found == 2;
}

static void grade(void)
{
    unsigned value = 0;
    for (char i = 0; i < 6; i++)
        value = value * 10 + score[i];
    unsigned expect = hits_punch * 10u + hits_kick * 20u + hits_jkick * 30u + kos_thug * 100u + kos_brute * 200u;
    unsigned fails = 0;
    if (events != 0x1fff)                                   fails |= 0x0001;
    if (value != expect)                                    fails |= 0x0002;
    if (lives != START_LIVES - 1)                           fails |= 0x0004;
    if (*(volatile char *)ASM_BAND_LATE)                    fails |= 0x0008;
    if (parts_dropped)                                      fails |= 0x0010;
    if (!pages_match())                                     fails |= 0x0020;
    if (!hero_in_band())                                    fails |= 0x0040;
    if (stage != 2 || camx != stage_lock[2] || locks != 3)  fails |= 0x0080;
    if (late)                                               fails |= 0x0100;
    if (photos != PHOTOS)                                   fails |= 0x0200;

    bool ok = fails == 0;
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    // Where the enemy's name goes: no enemy is left, so no face covers it.
    put_text(21, 20, "                    ");
    put_text(21, 23, ok ? "result 01 pass" : "result 02 fail");
    if (!ok)
        put_hex(HUDPAGE + 24 * 40 + 12, fails, 4);     // which checks, as bits: row 24
}

static void autopilot_frame(void)
{
    if (state == ST_GRADED)
        return;
    if (DEBUG_AT && frame == DEBUG_AT)
    {
        debug_print();
        state = ST_GRADED;
        return;
    }
    photo_frame();
    // Stage 3's first wave beaten: grade before the second arrives.
    bool beaten = stage == 2 && wave == 1 && fmode[1] == M_OFF && fmode[2] == M_OFF && fmode[3] == M_OFF;
    if (state == ST_PLAY && beaten && ++grade_wait == GRADE_DELAY)
    {
        hud_draw();
        grade();
        meter_print();
        state = ST_GRADED;
    }
}
