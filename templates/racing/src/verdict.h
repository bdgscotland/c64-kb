// verdict.h: AUTOPILOT builds only. Two seconds after the finish the program
// grades its own run, writes $02FF ($01 pass, $02 fail) and the border
// (green, red), prints the result on row 24, shows the still (photo) and
// stops building pictures: the still stays on the screen for the pinned
// shots. Every check reads the game's state or the VIC-II back; none is a
// replay of the script.
//
//   bit  check
//   0    two laps done, a finishing place 1-4
//   1    the clock: each lap's frames equal the bot's own count (autopilot.h)
//   2    the panel: L1 and L2 on screen are those counts as M:SS.T
//   3    contact: at least one bump
//   4    the verge: at least one frame on the grass
//   5    overtakes: at least one
//   6    no lost frame: every tick of line 251 had its game step and every
//        step ended before the next; every road chain took its IRQ on line
//        105 and split the panel off on line 203-204 (road_late)
//   7    the hill: the horizon moved over at least 10 lines
//   8    the bend: the farthest road row's centre, less where a straight
//        road would put it, ranged over at least 60 pixels
//   9    the cars' sizes: at least four of the six pictures were drawn
//   10   the sprites: the VIC-II's registers are the set shown
//   11   the meter recorded its 255 frames
// On a failure row 24 shows the failed bits in hex, row 23 the counts.

static bool vic_matches_shown(void)
{
    char f = B(ASM_RB_FRONT);
    char base = f * 3;
    if ((vic.spr_enable & 7) != B(ASM_SPR_EN + f))
        return false;
    if ((vic.spr_msbx & 7) != B(ASM_SPR_MSB + f))
        return false;
    char *ptrs = (f ? SCREEN_B : SCREEN_A) + 0x3f8;
    for (char s = 0; s < 3; s++)
    {
        if (!(B(ASM_SPR_EN + f) & (1 << s)))
            continue;
        if (vic.spr_pos[s].x != B(ASM_SPR_X + base + s))
            return false;
        if (vic.spr_pos[s].y != B(ASM_SPR_Y + base + s))
            return false;
        if (ptrs[s] != B(ASM_SPR_PTR + base + s))
            return false;
        if ((vic.spr_color[s] & 15) != B(ASM_SPR_COL + base + s))
            return false;
    }
    return true;
}

static char popcount6(char v)
{
    char n = 0;
    for (char i = 0; i < NSIZES; i++)
        n += (v >> i) & 1;
    return n;
}

static void hex4(char *p, unsigned v)
{
    for (char i = 4; i > 0; i--)
    {
        char d = v & 15;
        p[i - 1] = d < 10 ? '0' + d : d - 9;
        v >>= 4;
    }
}

// The still the shots are pinned on, after the grade: the real projection
// and builder, with the cars put where the checks want them. The camera 64
// units into the left kink over the crest (segments 50-53: the horizon at
// line 124, the road bending left from the bottom up); car 1 16 units ahead
// in the left lane (a big picture), car 2 120 ahead in the right lane (a
// small one), car 3 far enough to be left out; the player 20 pixels right
// of the centre line.
#define PHOTO_POS (50 * 256 + 64 + ZN)
static void photo(void)
{
    static const unsigned ahead[NCARS] = { 0, 16, 120, 1500 };
    static const int across[NCARS] = { 20 * 16, -48 * 16, 48 * 16, 0 };
    for (char c = 0; c < NCARS; c++)
    {
        car_pos[c] = (PHOTO_POS + ahead[c]) & LAP_MASK;
        car_x[c] = across[c];
    }
    road_snap = true;
    road_final();
}

static void grade(void)
{
    road_final();                       // the held picture: the final state's
    unsigned bad = 0;
    if (car_lap[0] < LAPS || finished < 1 || finished > NCARS)
        bad |= 1 << 0;
    for (char l = 0; l < LAPS; l++)
        if (!ap_lap[l] || lap_time[l] != ap_lap[l])
            bad |= 1 << 1;
    // the panel: the bot's counts, drawn on row 23, against row 21
    for (char l = 0; l < LAPS; l++)
    {
        hud_time(23, 0, ap_lap[l]);
        for (char i = 0; i < 6; i++)
            if (HUDPAGE[23 * 40 + i] != HUDPAGE[21 * 40 + 17 + 12 * l + i])
                bad |= 1 << 2;
    }
    hud_clear_row(23);
    if (!bumps)
        bad |= 1 << 3;
    if (!verge_frames)
        bad |= 1 << 4;
    if (!overtakes)
        bad |= 1 << 5;
    if (late || B(ASM_ROAD_LATE))
        bad |= 1 << 6;
    if (hoff_max - hoff_min < 10)
        bad |= 1 << 7;
    if (curve_max - curve_min < 60)
        bad |= 1 << 8;
    if (popcount6(sizes_seen) < 4)
        bad |= 1 << 9;
    if (!vic_matches_shown())
        bad |= 1 << 10;
    if (meter_frames != PLAY_HOLD)
        bad |= 1 << 11;

    state = ST_GRADED;
    hud_clear_row(24);
    photo();
    if (!bad)
    {
        hud_text(24, 0, "result 01 pass");
        RESULT = 0x01;
        vic.color_border = VCOL_GREEN;
    }
    else
    {
        hud_text(24, 0, "result 02 fail");
        hex4(HUDPAGE + 24 * 40 + 15, bad);
        // the counts behind the checks: bumps, verge, overtakes, late, road late
        hud_dec(23, 0, bumps, 3);
        hud_dec(23, 4, verge_frames, 4);
        hud_dec(23, 9, overtakes, 2);
        hud_dec(23, 12, late, 4);
        hud_dec(23, 17, B(ASM_ROAD_LATE), 3);
        hud_dec(23, 21, hoff_max - hoff_min, 2);
        hud_dec(23, 24, curve_max - curve_min, 3);
        hex4(HUDPAGE + 23 * 40 + 28, sizes_seen);
        RESULT = 0x02;
        vic.color_border = VCOL_RED;
    }
    meter_print();
}
