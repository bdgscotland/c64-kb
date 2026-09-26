// road.c: the view. Each picture: the camera behind the player's car, the
// horizon from the hills ahead, the road's centre from the car's place
// across it, the three sprites (the player and the two nearest opponents
// in view), then engine.asm's builder writes the road copy and screen not
// shown, and irq_blank swaps both with the sprites at the next line 251.
//
// A car at distance d ahead of the camera is drawn with its bottom on the
// road line whose z is d (the builder's z table for this horizon), at a size
// from the road's half-width there, and across the road at its offset
// scaled by that half-width (c64-kb pseudo_3d_road_raster; the archetype's
// "a car at the horizon is a small sprite"). Sprites stay in lines 107-202
// with their fetches (Y to Y + 20): the builder pads those lines.
#include "game.h"

char     hoff;
bool     road_snap;                     // the horizon goes straight to the hill's (a still)
unsigned cam_pos;
char     spr_line[NCARS];
char     spr_size[NCARS];
char     sizes_seen;
char     hoff_min, hoff_max;
int      curve_min, curve_max;

static char size_of_w[256];             // car picture for a half-width
static char wscale[256];                // w * 128 / W0, at most 128: offsets across the road

#define ZTAB     ((const char *)ASM_ZTAB)
#define W_OF_Z   ((const char *)ASM_W_OF_Z)
#define HILL     ((const char *)ASM_HILL)
#define SPR(t, set, s)  B(ASM_SPR_##t + (set) * 3 + (s))

char road_segment(unsigned p)
{
    return (p >> 8) & (SEGMENTS - 1);
}

// Row R's content centre in copy `set` (engine.asm's row_cref), signed
// pixels from the window's left edge.
static int row_cref(char set, char R)
{
    char i = (set * 12 + R) * 2;
    return (int)(B(ASM_ROW_CREF + i) | (B(ASM_ROW_CREF + i + 1) << 8));
}

// The centre road line i shows in copy `set`: its row's content centre plus
// the line's shift from it (engine.asm line_s: XSCROLL, and whole columns
// in a sheared row).
int line_centre(char set, char i)
{
    return row_cref(set, i >> 3) + B(ASM_LINE_S + set * ROAD_LINES + i);
}

void road_init(void)
{
    // size_w[k] is the width of car picture k; a car on a line whose
    // half-width is w is 2 * CAR_HALF * w / W0 wide
    for (unsigned w = 0; w < 256; w++)
    {
        unsigned width = (2 * CAR_HALF * w + W0 / 2) / W0;
        char k = 0;
        while (k < NSIZES - 1 && size_w[k + 1] <= width)
            k++;
        size_of_w[w] = k;
        unsigned sc = (w * 128 + W0 / 2) / W0;
        wscale[w] = sc > 128 ? 128 : sc;
    }
#if MUTANT == 2
    for (char s = 0; s < SEGMENTS; s++)
    {
        B(ASM_CURV_LO + s) = 0;
        B(ASM_CURV_HI + s) = 0;
    }
#endif
    hoff = HOFF_LEVEL;
    hoff_min = hoff_max = HOFF_LEVEL;
    curve_min = curve_max = 0;
    sizes_seen = 0;
}

// The line index (0-95) nearest the camera whose z (units of 8) is not
// below d / 8, searching the road lines below the horizon; 0xff when d is
// nearer than line 202 or beyond the horizon.
static char line_of(unsigned d, const char *zt)
{
    char top = H_MIN + hoff - ROAD_TOP + 1;     // first road line below the horizon
    if (d >= 256 * 8)
        return 0xff;
    char z = d >> 3;                            // compare in the table's units of 8
    if (z < zt[ROAD_LINES - 1] || z > zt[top])
        return 0xff;
    char lo = top, hi = ROAD_LINES - 1;          // z falls from top to bottom
    while (lo < hi)
    {
        char mid = (lo + hi + 1) >> 1;
        if (zt[mid] >= z)
            lo = mid;
        else
            hi = mid - 1;
    }
    return lo;
}

// Picture k's rows: the small ones sit at the top of the sprite, the big
// ones at the bottom, so the fetches (21 lines from Y) stay inside the road.
static bool top_aligned(char k)
{
    return k < 3;
}

void road_wait_swap(void)
{
    while (B(ASM_RB_READY)) ;
}

// A picture is built in the main loop's spare time, a piece at a time
// (road_work), while the game steps once a frame (main.c). What a picture
// shows is fixed when it starts. Measured: a picture every 3.5 frames on
// PAL, 4.9 on NTSC over the race (README, "The measured frame").
static char phase;                      // 0: no picture under way
static char p_set, p_en, p_who[3];
static int  p_px[NCARS];                // cars' offsets across the road, pixels, at the start
static int p_dx0;                       // the camera lean the builder got (10.6 a line)
static const char *p_zt;
unsigned pictures;                      // pictures published during the race

static void picture_begin(void);
static void picture_end(void);

// One piece of the next picture: its start (camera, sprites, rb_begin), one
// row, or its end (the sprites' X; rb_ready). Nothing while the last picture
// waits for irq_blank to take it.
char phase_of_road(void)
{
    return phase;
}

void road_work(void)
{
    if (B(ASM_RB_READY))
    {
        __asm { jsr ASM_RB_TAKE }       // shown now if the beam is clear of the road
        return;
    }
    switch (phase)
    {
    case 0:                             // the camera, the horizon, the sprites' lines
        picture_begin();
        phase = 1;
        break;
    case 1:                             // the builder's start (its own piece: about
        __asm { jsr ASM_RB_BEGIN }      // 2,500 cycles when the horizon moved)
#if MUTANT == 1
        for (char s = 0; s < 3; s++)    // pad every line as if no sprite fetched
            B(ASM_SPR_FIRST + s) = 0xc0;
        for (char i = 0; i < ROAD_LINES + 21; i++)
            B(ASM_LMASK + i) = 0;
#endif
        phase = 2;
        break;
    default:
        if (B(ASM_RB_STATE) || B(ASM_RB_ROW_ZP) >= 7)
        {
            B(ASM_RB_STOP) = 7;
            __asm { jsr ASM_RB_PIECE }  // one piece of a row (builder.asm)
        }
        else
        {
            picture_end();
            phase = 0;
            if (state == ST_RACE)
                pictures++;
        }
    }
}

// The picture of the game as it stands now, shown: the one under way is
// finished and taken first. The verdict calls it, so the held picture
// depends on the final state alone (the same on PAL and NTSC).
void road_final(void)
{
    while (phase || B(ASM_RB_READY))
        if (!B(ASM_RB_READY))
            road_work();
    do
        road_work();
    while (phase);
    while (B(ASM_RB_READY)) ;
}

// A whole picture at once, before the IRQ chain runs.
void road_build_all(void)
{
    do
        road_work();
    while (phase);
}

static void picture_begin(void)
{
    // ---- camera, horizon, centre ----
    cam_pos = (car_pos[0] - ZN) & LAP_MASK;
#if MUTANT == 3
    hoff = HOFF_LEVEL;
#else
    // The road's glyphs exist for even offsets: the horizon moves two lines
    // at a time (glyphs.asm).
    char want = HILL[road_segment(cam_pos + 512)] & ~1;
    if (road_snap)
        hoff = want;                    // a still: no easing in
    else if (hoff < want)
        hoff += 2;
    else if (hoff > want)
        hoff -= 2;
#endif
    if (state == ST_RACE)
    {
        if (hoff < hoff_min) hoff_min = hoff;
        if (hoff > hoff_max) hoff_max = hoff;
    }
    int px = car_x[0] >> 4;             // the player's pixel offset at line 202
    char D = L_NEAR - (H_MIN + hoff);
    W(ASM_RB_POS) = cam_pos;
    B(ASM_RB_HOFF) = hoff;
    // The road leans half as far as a camera fixed on the centre line would
    // make it: the horizon's end moves px / 2. Full lean sheared every row by
    // up to 10 pixels with the car off-centre, past XSCROLL's 7.
    int dx0 = px * 32 / D;
    W(ASM_RB_CX0) = (unsigned)((160 - px) * 64);
    W(ASM_RB_DX0) = (unsigned)dx0;

    // ---- the sprites' lines: the player, then the two nearest opponents ----
    char set = B(ASM_RB_FRONT) ^ 1;
    const char *zt = ZTAB + (hoff >> 1) * ROAD_LINES;     // even offsets only
    char en = 1;
    spr_line[0] = CAR_BOTTOM;
    spr_size[0] = NSIZES - 1;
    SPR(Y, set, 0) = CAR_BOTTOM - 21;
    SPR(PTR, set, 0) = SPR_BLOCK0 + NSIZES - 1;
    SPR(COL, set, 0) = car_colour[0];

    char near1 = 0, near2 = 0;
    unsigned d1 = 0xffff, d2 = 0xffff;
    unsigned dist[NCARS];
    char line[NCARS];
    for (char c = 1; c < NCARS; c++)
    {
        unsigned d = (car_pos[c] - cam_pos) & LAP_MASK;
        dist[c] = d;
        char i = line_of(d, zt);
        line[c] = i;
        spr_line[c] = 0;
        if (i == 0xff)
            continue;
        if (d < d1)
        {
            d2 = d1; near2 = near1;
            d1 = d; near1 = c;
        }
        else if (d < d2)
        {
            d2 = d; near2 = c;
        }
    }
    char who[3] = { 0, near1, near2 };
    for (char s = 1; s < 3; s++)
    {
        char c = who[s];
        if (!c)
            continue;
        char i = line[c];
        if (!zt[i & 0xf8])
            continue;                   // the horizon's row: drawn without road
        char w = W_OF_Z[zt[i]];
#if MUTANT == 4
        char k = 3;
#else
        char k = size_of_w[w];
#endif
        char bottom = ROAD_TOP + i;
        char y = top_aligned(k) ? bottom - size_h[k] : bottom - 21;
        if (y < ROAD_TOP || y > L_NEAR - 20)
            continue;
        spr_line[c] = bottom;
        spr_size[c] = k;
        SPR(Y, set, s) = y;
        SPR(PTR, set, s) = SPR_BLOCK0 + k;
        SPR(COL, set, s) = car_colour[c];
        en |= 1 << s;
    }
    B(ASM_SPR_EN + set) = en;
    p_set = set;
    p_en = en;
    p_zt = zt;
    for (char s = 0; s < 3; s++)
        p_who[s] = who[s];
    for (char c = 0; c < NCARS; c++)
        p_px[c] = car_x[c] >> 4;

    p_dx0 = dx0;
}

static void picture_end(void)
{
    char set = p_set, en = p_en, msb = 0;
    const char *zt = p_zt;
    int px = p_px[0];

    // ---- X from the centres the builder made ----
    SPR(X, set, 0) = 24 + 160 - 12;
    for (char s = 1; s < 3; s++)
    {
        if (!(en & (1 << s)))
            continue;
        char c = p_who[s];
        char i = spr_line[c] - ROAD_TOP;
        int cen = line_centre(set, i);
        char w = W_OF_Z[zt[i]];
        int off = (p_px[c] * wscale[w]) >> 7;   // x * w / W0: |x| <= 200, wscale <= 128
        int x = 24 + cen + off - (size_w[spr_size[c]] >> 1);
        if (x < 0 || x > 343)
            x = 0;                      // off the side: behind the left border, still
                                        // fetching, as the builder padded for it
        SPR(X, set, s) = (char)x;
        if (x > 255)
            msb |= 1 << s;
        if (state == ST_RACE && x)
            sizes_seen |= 1 << spr_size[c];
    }
    B(ASM_SPR_MSB + set) = msb;

    if (state == ST_RACE)
    {
        // The bend: the farthest road row's content centre less where a
        // straight road would put it (the builder's own rule with no
        // curvature: 160 - px at line 202, dx0 a line nearer 160 up; an
        // earlier version divided twice here, 16-bit: about 3,000 cycles).
        char R = 0;
        while (!zt[R * 8])
            R++;
        char up = ROAD_LINES - 1 - (R * 8 + 7);            // lines above 202, the row's bottom
        int sb = ((160 - px) * 64 + p_dx0 * up) >> 6;      // the builder's own 10.6 rule
        int st = ((160 - px) * 64 + p_dx0 * (up + 7)) >> 6;
        int bend = row_cref(set, R) - ((sb < st ? sb : st) & ~3);
        if (bend < curve_min) curve_min = bend;
        if (bend > curve_max) curve_max = bend;
    }
    B(ASM_RB_READY) = 1;
}
