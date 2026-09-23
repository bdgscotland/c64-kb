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
        if (fkind[f] == K_BRUTE)
        {
            // Characters: his block inside the window, and on the screen now.
            if (fx[f] < camx + 20 || fx[f] > camx + 296 || !b_drawn)
                return false;
        }
        else
        {
            for (char k = 0; k < 2; k++)
            {
                int x = part_vic_x(f, k);
                if (x <= 0 || x >= 344)
                    return false;
            }
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
static char photo_hud[120];         // HUD rows 21-23 as they were before the stop

static void photo_dump(void)
{
    for (char i = 0; i < 120; i++)
    {
        photo_hud[i] = HUDPAGE[21 * 40 + i];
        HUDPAGE[21 * 40 + i] = CH_SPACE;
    }
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
            for (char i = 0; i < 120; i++)  // the HUD rows as they were: no redraw
                HUDPAGE[21 * 40 + i] = photo_hud[i];
            photo_last = frame;
        }
        return;
    }
    // Two in the second stage's fights, the third in the last stage's.
    bool due = stage == 2 ? photos < PHOTOS : photos < PHOTOS - 1;
    if (due && state == ST_PLAY && !(frame & 3) && frame - photo_last > PHOTO_GAP && crowded())   // every 4th frame: it costs
    {
        photos++;
        photo = true;
        faces_off = true;
        photo_left = PHOTO_FRAMES;
        photo_dump();
    }
}

// ---- the verdict -----------------------------------------------------------------
// Both pages against the street at their columns, the brute's block
// excepted, which must hold his codes; row 20 blank on both.
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
        {
            for (char c = 0; c < 40; c++)
            {
                char want = brute_code_at(page_col[p] + c, r);     // his cells, if he is there
                if (!want)
                    want = cell_char(page_col[p] + c, r);
                if (q[r * 40 + c] != want)
                    return false;
            }
        }
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

// ---- every hit, recomputed ----------------------------------------------------------
// fighter.c calls this for each hit before it lands. The lane difference
// and the box overlap are worked out again here, from the box tables but
// with this file's own arithmetic: world extents by facing, heights from
// the ground line. A hit across lanes, or one whose boxes do not touch, is
// counted as wrong.
static unsigned hits_seen, hits_wrong;

// A box's left edge in world x, facing counted; the right edge is + width.
static int edge(char f, signed char x0, signed char x1)
{
    return fface[f] == FACE_LEFT ? (int)fx[f] - x1 : (int)fx[f] + x0;
}

__noinline void check_hit(char a, char t, char hb)
{
    hits_seen++;
    char lane = fy[a] > fy[t] ? fy[a] - fy[t] : fy[t] - fy[a];
    const struct Box *h = &hit_box[hb];
    const struct Box *u = &hurt_box[anim_pose(&fanim[t])];
    int al = edge(a, h->x0, h->x1), tl = edge(t, u->x0, u->x1);
    int ah = al + (h->x1 - h->x0), th = tl + (u->x1 - u->x0);
    char ab = fh[a] + h->y0, at = fh[a] + h->y1;
    char tb = fh[t] + u->y0, tt = fh[t] + u->y1;
    bool touch = u->y1 != 0 && al <= th && tl <= ah && ab <= tt && tb <= at;
    if (lane > WIN || !touch)
        hits_wrong++;
}

// ---- the fighter band, read back from the VIC ------------------------------------
// view_sprites fills a table half; the IRQ at line 76 writes it to the VIC
// and, in AUTOPILOT builds, copies $D000-$D010, $D015 and $D01B back
// (engine.asm, snap). vic_expect works out what that half must hold from
// the model, on its own: the shown sprite fighters sorted near to far by a
// plain selection sort (not view.c's persistent insertion sort), two
// sprites each, X by its own formula, the $D010 bit from X, $D01B for a
// fighter farther away than the brute. vic_compare, at the start of the
// next frame, compares the copy with the expectation for the half it came
// from. Fighters on the same ground line may take either order: then only
// the set of positions is compared.
static char ex_x[16], ex_y[16], ex_msb[2], ex_en[2], ex_pri[2];    // [half * 8 + sprite]
static bool ex_tie[2], ex_ok[2];
static char snap_seen;
static unsigned vic_frames, vic_wrong;
static const char vbit[8] = { 1, 2, 4, 8, 16, 32, 64, 128 };

static bool shown_fighter(char f)
{
    char m = fmode[f];
    if (m == M_OFF || fkind[f] == K_BRUTE)
        return false;
    if (finvuln[f] & 4)
        return false;
    return !(m == M_KO && (ftimer[f] & 4));
}

static void vic_expect(void)
{
    if (!sprites_fresh)
        return;                                         // nothing new was built this frame
    sprites_fresh = false;
    char h = sprites_half;                              // the half view_sprites just filled
    char list[NFIGHT], n = 0;
    for (char f = 0; f < NFIGHT; f++)
        if (shown_fighter(f))
            list[n++] = f;
    bool tie = false;
    for (char i = 0; i < n; i++)                        // nearest (largest ground line) first
    {
        char best = i;
        for (char j = i + 1; j < n; j++)
            if (fy[list[j]] > fy[list[best]])
                best = j;
        char t = list[i];
        list[i] = list[best];
        list[best] = t;
        if (i && fy[list[i]] == fy[list[i - 1]])
            tie = true;
    }
    char *xs = ex_x + h * 8, *ys = ex_y + h * 8;
    char k = 0, msb = 0, en = 0, pri = 0;
    for (char i = 0; i < n; i++)
    {
        char f = list[i];
        const struct Part *pt = pose_part[anim_pose(&fanim[f])];
        int o = (int)fx[f] - (int)camx + 31;
        bool left = fface[f] == FACE_LEFT;
        bool back = b_drawn && fy[f] < b_fy;
        char base = fy[f] - fh[f];
        for (char p = 0; p < 2; p++)
        {
            int x = left ? o - 24 - pt[p].dx : o + pt[p].dx;
            if (x <= 0 || x >= 344 || k >= 8)
                continue;
            char b = vbit[k];
            xs[k] = (char)x;
            ys[k] = base + pt[p].dy;
            if (x >= 256)
                msb |= b;
            en |= b;
            if (back)
                pri |= b;
            k++;
        }
    }
    ex_msb[h] = msb;
    ex_en[h] = en;
    ex_pri[h] = pri;
    ex_tie[h] = tie;
    ex_ok[h] = true;
}

static void vic_compare(void)
{
    // A copy that no IRQ tore: copy until the count holds. (Read in place at
    // the end of a frame, where the IRQ at line 76 can land, 300 of 4,300
    // frames looked wrong: measured.)
    static char snap[19];
    volatile char *live = (volatile char *)ASM_SNAP;
    char c, h;
    do
    {
        c = *(volatile char *)ASM_SNAP_COUNT;
        h = *(volatile char *)ASM_SNAP_FRONT >> 3;
        for (char i = 0; i < 19; i++)
            snap[i] = live[i];
    } while (c != *(volatile char *)ASM_SNAP_COUNT);
    if (c == snap_seen)
        return;
    snap_seen = c;
    if (!ex_ok[h])
        return;
    vic_frames++;
    char en = snap[17], msb = snap[16] & en, pri = snap[18] & en;
    const char *xs = ex_x + h * 8, *ys = ex_y + h * 8;
    if (!ex_tie[h])
    {
        // One order only: every register as the expectation has it.
        if (en != ex_en[h] || msb != ex_msb[h] || pri != ex_pri[h])
        {
            vic_wrong++;
            return;
        }
        for (char k = 0; k < 8; k++)
        {
            if ((en & vbit[k]) && (xs[k] != snap[2 * k] || ys[k] != snap[2 * k + 1]))
            {
                vic_wrong++;
                return;
            }
        }
        return;
    }
    // Fighters on one ground line may take either order: the same number of
    // sprites, and each one somewhere in the expectation with its X, Y,
    // $D010 bit and $D01B bit.
    char want = 0, got = 0;
    for (char k = 0; k < 8; k++)
    {
        if (ex_en[h] & vbit[k])
            want++;
        if (!(en & vbit[k]))
            continue;
        got++;
        bool found = false;
        for (char j = 0; j < 8; j++)
            if ((ex_en[h] & vbit[j]) && xs[j] == snap[2 * k] && ys[j] == snap[2 * k + 1] &&
                !(msb & vbit[k]) == !(ex_msb[h] & vbit[j]) && !(pri & vbit[k]) == !(ex_pri[h] & vbit[j]))
                found = true;
        if (!found)
        {
            vic_wrong++;
            return;
        }
    }
    if (want != got)
        vic_wrong++;
}

static void grade(void)
{
    unsigned value = 0;
    for (char i = 0; i < 6; i++)
        value = value * 10 + score[i];
    unsigned expect = hits_punch * 10u + hits_kick * 20u + hits_jkick * 30u + kos_thug * 100u + kos_brute * 200u;
    unsigned fails = 0;
    if (events != EV_ALL)                                   fails |= 0x0001;
    if (value != expect)                                    fails |= 0x0002;
    if (lives != START_LIVES - 1)                           fails |= 0x0004;
    if (*(volatile char *)ASM_BAND_LATE)                    fails |= 0x0008;
    if (parts_dropped)                                      fails |= 0x0010;
    if (!pages_match())                                     fails |= 0x0020;
    if (!hero_in_band())                                    fails |= 0x0040;
    if (stage != 2 || camx != stage_lock[2] || locks != 3)  fails |= 0x0080;
    if (late)                                               fails |= 0x0100;
    if (photos != PHOTOS)                                   fails |= 0x0200;
    if (brute_late || kos_brute < 2)                        fails |= 0x0400;
    if (hits_wrong || hits_seen < 20)                       fails |= 0x0800;
    if (vic_wrong || vic_frames < 2000)                     fails |= 0x1000;

    bool ok = fails == 0;
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    // Where the enemy's name goes: no enemy is left, so no face covers it.
    put_text(21, 20, "                    ");
    put_text(21, 23, ok ? "result 01 pass" : "result 02 fail");
    if (!ok)
    {
        put_hex(HUDPAGE + 24 * 40 + 12, fails, 4);     // which checks, as bits: row 24
        // and the counts behind them: late frames, brute late, brutes beaten,
        // hits wrong of seen, VIC frames wrong of compared
        for (unsigned i = 22 * 40; i < 23 * 40; i++)
            HUDPAGE[i] = CH_SPACE;
        put_num(22, 3, late, 3);                        // right of the hero's face
        put_num(22, 36, slow, 3);
        put_num(22, 7, brute_late, 3);
        put_num(22, 11, kos_brute, 1);
        put_num(22, 13, hits_wrong, 3);
        put_num(22, 17, hits_seen, 3);
        put_num(22, 21, vic_wrong, 4);
        put_num(22, 26, vic_frames, 5);
        put_hex(HUDPAGE + 22 * 40 + 32, events, 4);
    }
}

// make gameover (AP_GIVE_UP=1): the bot never fights; once GAME OVER has
// been up for a second, the program checks what the HUD shows and freezes.
static void grade_gameover(void)
{
    static const char want[] = "game over";
    bool ok = lives == 0 && (events & EV_LIFE_LOST) && HUDPAGE[23 * 40 + 38] == '0';
    for (char i = 0; want[i]; i++)
    {
        char c = want[i];
        c = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
        if (HUDPAGE[21 * 40 + 15 + i] != c)
            ok = false;
    }
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    put_text(24, 0, ok ? "result 01 pass" : "result 02 fail");
}

static void autopilot_frame(void)
{
    if (state == ST_GRADED)
        return;
    if (AP_GIVE_UP)
    {
        if (state == ST_OVER && timer == 90)
        {
            grade_gameover();
            state = ST_GRADED;
        }
        return;
    }
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
