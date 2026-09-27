// area_test.h: make area (-dAUTOPILOT=1 -dAREATEST=1) and make fullpool
// (-dFULLPOOL=1). main.c includes it twice: TT_PART 1 is the stick script,
// TT_PART 2 the verdict. Every value is derived in PLAN.md, "Area end".
//
// Both start 7 lines from the map's top with the soldier on the threshold
// (as make mapend) and no spawn-list enemies (objects.c); NO_HARM (game.h).
//
// make area, by play frame (frame 0 is the title's second fire frame):
//   1-8      up: 7 lines to map y 0 on frames 1-7; area_frame starts the
//            wave on frame 7 (scroll_can_step() is 0 after the 7th step)
//   9-78     down: the sandbags on map row 14 stop him at sprite Y 145
//   79-86    up: 8 frames turn him to face up (8 steps) and walk him to Y 137
//   87-278   fire taps every 6 frames: the wave's riflemen walk to his column
//            and down to 56 pixels above him, into his shots
// When all 6 are out and dead the walk starts: X is 168 already, so 85
// pixels up to Y 52, the arrival on the 86th frame; 100 frames of beat; the
// next area. The build freezes 12 frames into area 1.
//
// make fullpool: the same start; the wave is area 3's (12 soldiers, more
// than the 11 pool slots; area.c, FULLPOOL) under the normal spawn rule. He
// holds fire for 250 frames while the wave fills the pool and the riflemen
// gather 56 pixels above him, then fires taps and throws a grenade every 50
// frames into them. It freezes on play frame FP_FRAMES: none lost.
#if TT_PART == 1
#define TAP  {   1, 0xef }, {   5, 0xff }
#define TAP4 TAP, TAP, TAP, TAP
#define TAP16 TAP4, TAP4, TAP4, TAP4
#ifdef FULLPOOL
#define FP_FRAMES 700
#define THROW8 {   1, 0xdf }, {   5, 0xff }, TAP, TAP, TAP, TAP, TAP, TAP, TAP, {   1, 0xef }, {   1, 0xff }
static const char script[][2] = {
    {   2, 0xff }, {   2, 0xef },       // title
    {   8, 0xfe },                      // up: the scroll stops, the wave starts
    { 250, 0xff },                      // hold fire: the wave fills the pool
    THROW8, THROW8, THROW8, THROW8, THROW8, THROW8, THROW8, THROW8,
    { 250, 0xff }, { 250, 0xff },
};
#define TEST_FREEZE (play_frames >= FP_FRAMES)
#else
static const char script[][2] = {
    {   2, 0xff }, {   2, 0xef },       // title
    {   8, 0xfe },                      // up: 7 lines to the map's top, the scroll stops
    {  70, 0xfd },                      // down: the sandbags on map row 14 stop him at Y 145
    {   8, 0xfe },                      // up 8: he turns to face up (facing 8 to 0)
    TAP16, TAP16,                       // to frame 278: the wave is dead by 125
    { 250, 0xff }, { 250, 0xff }, { 250, 0xff },
};
#define TEST_FREEZE (play_frames >= 1000 || (area == 1 && play_frames >= ar_beat_end + 12))
#endif
#define PLAY_FRAMES 60000
#define FREEZE_YS   0
#define METER_ROW   8
#endif

#if TT_PART == 2
#define OWN_VERDICT
#ifdef FULLPOOL
static char first_fail(void)
{
    char n = 1;
    CHECK(overruns == 0 && rd_late == 0 && lost_all == 0)   // 1 no frame lost
    CHECK(ost_peak == N_POOL && wave_n == 12 && ar_spawned == 12)   // 2 the pool full, area 3's wave
    CHECK(shots_fired > 0 && throws > 0)                    // 3 shots and blasts into it
    CHECK(area == 1)                                        // 4 the wave cleared, the next area
    return 0;
}
#else
static char first_fail(void)
{
    char n = 1;
    CHECK(overruns == 0 && rd_late == 0 && lost_all == 0)   // 1 no frame lost, no redraw late
    CHECK(ar_wave_at == 7)                                  // 2 the wave began as the scroll stopped
    CHECK(wave_n == 6 && ar_spawned == 6 && wave_tospawn == 0)   // 3 counted: 6 out, none to come
    CHECK(ar_arrive_at - ar_walk_at == 86 && ar_walk_at > ar_wave_at)   // 4 the walk into the gate
    char sc_ok = score[0] == 0x00 && score[1] == 0x26 && score[2] == 0;
    CHECK(sc_ok && col_kills[K_RIFLE] == 6)                 // 5 6 kills of 100 and the 2,000 bonus
    CHECK(ar_beat_end - ar_arrive_at == BEAT_FRAMES)        // 6 the beat
    char col_ok = K_BYTE(ASM_PF_BG) == VCOL_MED_GREY && K_BYTE(ASM_PF_MC1) == VCOL_LT_GREY;
    CHECK(area == 1 && col_ok)                              // 7 the next area's colours
    CHECK(scroll_top == SCROLL_START_TOP && area_phase == AP_SCROLL && screen_is_map())   // 8 the map again
    CHECK(soldier_x == 168 && soldier_y == 160 && soldier_state == SS_ALIVE)   // 9 at his start
    return 0;
}
#endif

static void verdict(void)
{
    char fail = first_fail();
    char ok = fail == 0;
    verdict_code = ok ? 1 : 2;
    RESULT = verdict_code;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    char *s = SCREEN;
    put_text(s, 1, 1, ok ? "RESULT 01 PASS   " : "RESULT 02 FAIL 00");
    if (!ok)
        put_dec(s + 1 * 40 + 16, fail, 2);
    put_text(s, 2, 1, "WAVE 000 N 00 SP 00 PK 00");
    put_dec(s + 2 * 40 + 6, ar_wave_at, 3);
    put_dec8(s + 2 * 40 + 12, wave_n, 2);
    put_dec8(s + 2 * 40 + 18, (char)ar_spawned, 2);
    put_dec8(s + 2 * 40 + 24, (char)ar_peak_alive, 2);
    put_text(s, 3, 1, "WALK 0000 AT 0000 END 0000");
    put_dec(s + 3 * 40 + 6, ar_walk_at, 4);
    put_dec(s + 3 * 40 + 14, ar_arrive_at, 4);
    put_dec(s + 3 * 40 + 23, ar_beat_end, 4);
    put_text(s, 4, 1, "K 00 00 00 00 SC ...... D 0 0");
    put_dec(s + 4 * 40 + 3, col_blast, 2);
    for (char i = 1; i < 4; i++)
        put_dec(s + 4 * 40 + 3 + 3 * i, col_kills[i], 2);
    put_bcd(s + 4 * 40 + 18, score, 3);
    put_dec(s + 4 * 40 + 27, col_hits, 1);
    put_dec(s + 4 * 40 + 29, col_terrain, 1);
    put_text(s, 5, 1, "AREA 0 TOP 00 BG 00 MC 00 X 000 Y 000");
    put_dec8(s + 5 * 40 + 6, area, 1);
    put_dec8(s + 5 * 40 + 12, scroll_top, 2);
    put_dec8(s + 5 * 40 + 18, K_BYTE(ASM_PF_BG), 2);
    put_dec8(s + 5 * 40 + 24, K_BYTE(ASM_PF_MC1), 2);
    put_dec(s + 5 * 40 + 29, soldier_x, 3);
    put_dec(s + 5 * 40 + 35, soldier_y, 3);
    put_text(s, 6, 1, "COL 00000 DF 00 LOST 00 00 PEAK 00");
    put_dec(s + 6 * 40 + 5, col_worst, 5);
    put_dec(s + 6 * 40 + 14, col_deferred, 2);
    put_dec(s + 6 * 40 + 22, overruns, 2);
    put_dec(s + 6 * 40 + 25, lost_all, 2);
    put_dec8(s + 6 * 40 + 33, ost_peak, 2);
    put_text(s, 8, 20, "SKIP 0000");
    put_dec(s + 8 * 40 + 25, ost_skipped, 4);
    text_colour(8, 20, 9, TEXT_CRAM);
    put_text(s, 7, 1, "SH 000 T 00 RDC 00000 LD 000 LF 000");
    put_dec(s + 7 * 40 + 4, shots_fired, 3);
    put_dec(s + 7 * 40 + 10, throws, 2);
    put_dec(s + 7 * 40 + 17, rd_cyc, 5);
    put_dec(s + 7 * 40 + 26, rd_lead < 0 ? 0 : rd_lead, 3);
    put_dec(s + 7 * 40 + 33, light_end, 3);
    for (char r = 1; r <= 8; r++)
        text_colour(r, 1, 38, TEXT_CRAM);
}
#endif
