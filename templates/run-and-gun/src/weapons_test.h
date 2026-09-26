// weapons_test.h: make weapons (-dAUTOPILOT=1 -dWEAPONS=1). main.c includes
// it twice: WT_PART 1 is the stick script, WT_PART 2 the verdict, where
// main.c's redraw and lost-frame counters are in scope. Every expected value
// is derived in PLAN.md, "Weapons".
//
// The script, by play frame (a frame's byte is $DC00's, active low; bit 5
// low is JOY_THROW):
//   5        fire: shot 0 up (facing 0), stopped by the sandbags (map row 82)
//   6-35     fire held: nothing more (no autofire)
//   36-39    right: facing 0 to 4           40  fire: shot 1 right
//   43-44    down: facing 4 to 6            45  fire: shot 2 down-right
//   48-53    left: facing 6 to 12
//   54-61    four presses: shots 3-5 left, the third press finds three flying: lost
//   62       throw: grenade 1 (5 to 4), lands on 92, its blast ends on 108
//   63-110   throw held: no second throw; fire pressed on 95, 97, 99 (shots 6-8)
//   112, 162, 212  grenades 2, 3, 4; 130 a press while 2 flies (busy)
//   262-336  up to the threshold and the sandbags; 337-406 right
//   407-502  up, scrolling, fire held 2 frames in every 8 (a light frame
//            skips a frame's input, never two)
//   504-505  up and throw: grenade 5, the last; 506-520 up; then stand
//   531      fire: a shot up, 8 frames out at the freeze
//   536      throw with none left: nothing happens
//   540      the first frame on YSCROLL FREEZE_YS: freeze (play frame 539
//            was the last to run), the blast live
#if WT_PART == 1
static const char script[][2] = {
    {   2, 0xff }, {   2, 0xef },       // title
    {   4, 0xff },
    {   1, 0xef }, {  30, 0xef },       // 5 fire, 6-35 held
    {   4, 0xf7 }, {   1, 0xef },       // 36-39 right, 40 fire
    {   2, 0xff }, {   2, 0xfd }, {   1, 0xef },    // 43-44 down, 45 fire
    {   2, 0xff }, {   6, 0xfb },       // 48-53 left
    {   1, 0xef }, {   1, 0xff }, {   1, 0xef }, {   1, 0xff },   // 54-61 four presses
    {   1, 0xef }, {   1, 0xff }, {   1, 0xef }, {   1, 0xff },
    {   1, 0xdf }, {  32, 0xdf },       // 62 throw, held
    {   1, 0xcf }, {   1, 0xdf }, {   1, 0xcf }, {   1, 0xdf }, {   1, 0xcf },   // 95-99
    {  11, 0xdf }, {   1, 0xff },       // 100-110 held, 111 released
    {   1, 0xdf }, {  17, 0xff },       // 112 grenade 2
    {   1, 0xdf }, {  31, 0xff },       // 130 busy
    {   1, 0xdf }, {  49, 0xff },       // 162 grenade 3
    {   1, 0xdf }, {  49, 0xff },       // 212 grenade 4
    {  75, 0xfe }, {  70, 0xf7 },       // 262 up, 337 right
    {   2, 0xee }, {   6, 0xfe }, {   2, 0xee }, {   6, 0xfe },   // 407 up, fire every 8
    {   2, 0xee }, {   6, 0xfe }, {   2, 0xee }, {   6, 0xfe },
    {   2, 0xee }, {   6, 0xfe }, {   2, 0xee }, {   6, 0xfe },
    {   2, 0xee }, {   6, 0xfe }, {   2, 0xee }, {   6, 0xfe },
    {   2, 0xee }, {   6, 0xfe }, {   2, 0xee }, {   6, 0xfe },
    {   2, 0xee }, {   6, 0xfe }, {   2, 0xee }, {   6, 0xfe },
    {   1, 0xfe },
    {   2, 0xde }, {  15, 0xfe },       // 504 grenade 5, 506-520 up
    {  10, 0xff }, {   1, 0xef },       // 521 stand, 531 fire: a shot up, flying at the freeze
    {   4, 0xff }, {   1, 0xdf },       // 536 throw: none left
    { 250, 0xff }, { 250, 0xff },
};
#define PLAY_FRAMES 540
#ifndef FREEZE_YS
#define FREEZE_YS   7                   // standing from frame 520 at map y 480: YSCROLL 7
#endif
#endif

#if WT_PART == 2
extern char log_facing[], log_end[], log_age[];
extern signed char log_vx[], log_vy[];
extern unsigned gl_throw_y, gl_land_y, gl_throw_f, gl_land_f, gl_end_f;
extern char gl_blast_frames;
extern unsigned wpn_worst;
extern char wpn_worst_b, wpn_worst_g;

// The hit tests at the edges and across map x 256 and 0 (weapons.h). Blast
// boxes are GREN_L 12, GREN_M 10: a point is inside at dx -11 to +12 and
// dy -9 to +10.
#define BT_N 16
static const unsigned bt[BT_N][4] = {   // blast x, y (or a 4 x 4 box's x, y), point or box
    { 250, 100, 238, 100 }, { 250, 100, 239, 100 }, { 250, 100, 262, 100 }, { 250, 100, 263, 100 },
    { 250, 100, 250,  90 }, { 250, 100, 250,  91 }, { 250, 100, 250, 110 }, { 250, 100, 250, 111 },
    { 250, 100, 259, 100 },                                     // across 256: 8-bit bounds miss it
    {   5, 100,   0, 100 }, {   5, 100,  17, 100 }, {   5, 100,  18, 100 },   // corner below 0
    { 252,  98, 256,  90 }, { 253,  98, 256,  90 },             // a 4 x 4 bullet, a 16 x 16 box at 256
    {   0,  98,   5, 100 }, {  18,  98,   5, 100 },             // a bullet, the blast around (5, 100)
};
static const char bt_want[BT_N + 1] = "MHHMMHHMHHHMMHHM";
static char bt_got[BT_N + 1];
static char bt_pass;

static unsigned hit_cyc, has_cyc;

__noinline char hit_call(const Box *a, const Box *b) { return box_hit(a, b); }
__noinline char has_call(const Box *b, unsigned x, unsigned y) { return box_has(b, x, y); }

static void timed_start(void)
{
    __asm { sei }
    while (vic.raster != 16 || (vic.ctrl1 & 0x80)) ;   // top border: no badline, no sprite
    cia1.crb = 0x00;
    cia1.tb = 0xffff;
    cia1.crb = 0x11;
}

static unsigned timed_stop(void)
{
    cia1.crb = 0x00;
    unsigned c = 0xffff - cia1.tb;
    __asm { cli }
    return c;
}

static void box_tests(void)
{
    Box a, b;
    bt_pass = 0;
    for (char k = 0; k < BT_N; k++) {
        char r;
        if (k < 12) {
            box_blast(&a, bt[k][0], bt[k][1]);
            r = has_call(&a, bt[k][2], bt[k][3]);
        } else {
            a.x = bt[k][0]; a.y = bt[k][1]; a.w = 4; a.h = 4;
            if (k < 14) {
                b.x = bt[k][2]; b.y = bt[k][3]; b.w = 16; b.h = 16;
            } else
                box_blast(&b, bt[k][2], bt[k][3]);
            r = hit_call(&a, &b);
        }
        bt_got[k] = r ? 'H' : 'M';
        if (bt_got[k] == bt_want[k])
            bt_pass++;
    }
    bt_got[BT_N] = 0;
    // One call of each, jsr and parameters included, IRQs held off (the
    // frozen frame, after the verdict's line-250 wake). Timer B's own
    // start and stop are in the figure.
    box_blast(&a, 250, 100);
    b.x = 253; b.y = 98; b.w = 4; b.h = 4;
    timed_start();
    unsigned zero = timed_stop();                    // the bracket alone
    timed_start();
    hit_call(&a, &b);
    hit_cyc = timed_stop() - zero;
    timed_start();
    has_call(&a, 259, 100);
    has_cyc = timed_stop() - zero;
}

// What the script must leave (PLAN.md, "Weapons").
static const char want_facing[6] = { 0, 4, 6, 12, 12, 12 };
static const signed char want_vx[6] = { 0, 20, 14, -20, -20, -20 };
static const signed char want_vy[6] = { -20, 0, 14, 0, 0, 0 };

static char first_fail(void)
{
    char n = 1;
    Box blast;
    box_tests();
    CHECK(overruns == 0 && rd_late == 0)                    // 1 no frame lost, no redraw late
    CHECK(rd_count >= 1 && rd_lead >= MIN_LEAD)             // 2 redraws with shots flying beat the beam
    bool along = true;
    for (char k = 0; k < 6; k++)
        along = along && log_facing[k] == want_facing[k] && log_vx[k] == want_vx[k] && log_vy[k] == want_vy[k];
    CHECK(along)                                            // 3 each press one shot, along the facing
    CHECK(log_end[0] == 2 && log_age[0] == 10)              // 4 shot 0 stopped by the sandbags, frame 10
    CHECK(shots_lost == 1)                                  // 5 the press with three flying was lost
    CHECK(gl_throw_f == 62 && gl_land_f == 92 && gl_end_f == 108)   // 6 flight 30, blast 16
    CHECK(gl_throw_y - gl_land_y == 60 && gl_blast_frames == 16)    // 7 60 pixels up, 16 blast frames
    CHECK(throws == 5 && grenades == 0)                     // 8 five thrown, the count at 0
    CHECK(throws_busy == 1 && throws_empty == 1)            // 9 no throw while one flies or with none
    CHECK(weapons_blast_box(&blast))                        // 10 grenade 5 bursting at the freeze
    CHECK(bt_pass == BT_N)                                  // 11 the hit tests, wrap included
    return 0;
}

static void weapons_print(void)
{
    char *s = SCREEN;
    static const char hex[] = "0123456789ABCDEF";
    put_text(s, 10, 1, "SH 00 LO 0 T 0 E 0 B 0");
    put_dec(s + 10 * 40 + 4, shots_fired, 2);
    put_dec(s + 10 * 40 + 10, shots_lost, 1);
    put_dec(s + 10 * 40 + 14, throws, 1);
    put_dec(s + 10 * 40 + 18, throws_empty, 1);
    put_dec(s + 10 * 40 + 22, throws_busy, 1);
    put_text(s, 11, 1, "F 000000 E 000000 A00");
    for (char k = 0; k < 6; k++) {
        char h = hex[log_facing[k] & 15];
        s[11 * 40 + 3 + k] = h >= 'A' ? h - 'A' + 1 : h;
        s[11 * 40 + 12 + k] = '0' + log_end[k];
    }
    put_dec(s + 11 * 40 + 20, log_age[0], 2);
    put_text(s, 12, 1, "G 000 000 000 00 00");
    put_dec(s + 12 * 40 + 3, gl_throw_f, 3);
    put_dec(s + 12 * 40 + 7, gl_land_f, 3);
    put_dec(s + 12 * 40 + 11, gl_end_f, 3);
    put_dec(s + 12 * 40 + 15, gl_throw_y - gl_land_y, 2);
    put_dec(s + 12 * 40 + 18, gl_blast_frames, 2);
    put_text(s, 13, 1, "BOX 00 HIT 000 HAS 000");
    put_dec(s + 13 * 40 + 5, bt_pass, 2);
    put_dec(s + 13 * 40 + 12, hit_cyc, 3);
    put_dec(s + 13 * 40 + 20, has_cyc, 3);
    put_text(s, 14, 1, bt_got);
    put_text(s, 16, 1, "S1 000 000 S4 000 000 00");
    put_dec(s + 16 * 40 + 4, SLOT_XL[SLOT_BULLET] + 256 * SLOT_XH[SLOT_BULLET], 3);
    put_dec(s + 16 * 40 + 8, SLOT_Y[SLOT_BULLET], 3);
    put_dec(s + 16 * 40 + 15, SLOT_XL[SLOT_GRENADE] + 256 * SLOT_XH[SLOT_GRENADE], 3);
    put_dec(s + 16 * 40 + 19, SLOT_Y[SLOT_GRENADE], 3);
    put_dec(s + 16 * 40 + 23, SLOT_COL[SLOT_GRENADE], 2);
    put_text(s, 15, 1, "WPN 00000 B0 G0");
    put_dec(s + 15 * 40 + 5, wpn_worst, 5);
    put_dec(s + 15 * 40 + 12, wpn_worst_b, 1);
    put_dec(s + 15 * 40 + 15, wpn_worst_g, 1);
    for (char r = 10; r <= 16; r++)
        text_colour(r, 1, 24, TEXT_CRAM);
}
#endif
