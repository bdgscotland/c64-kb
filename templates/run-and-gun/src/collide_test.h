// collide_test.h: make collide (-dAUTOPILOT=1 -dCOLLIDETEST=1). main.c
// includes it twice: TT_PART 1 is the stick script, TT_PART 2 the verdict.
// Every value is derived in PLAN.md, "Collisions".
//
// The normal start (view top 75, the spawn list's rows 88, 84 and 77 in
// view), harm on. By play frame:
//   1-96     fire taps up: the runner of row 88 crosses his column (150)
//   97-228   right, X 168 to 300: under the grenadier of row 84 (X 312)
//   229-236  up 8: facing up, Y 152
//   237      throw: the grenade lands 60 pixels above his body centre on
//            frame 267, its blast box over the grenadier (200, by the blast)
//   287-382  fire taps: the rifleman of row 77 has followed his column and
//            walks into the shots (100)
//   383-     up, then stand: before the view moves (top 75) the blast of a
//            grenade the grenadier threw before he died bursts on him: a hit
//            (VICE: play frame 413; not pinned, it moves a frame with the
//            code's layout). After DEATH_FRAMES the restart puts the view at
//            row 75 (the first checkpoint at or behind 75, the area's start)
//            with the window's three events again, grenades 4 to 5.
#if TT_PART == 1
#define TAP  {   1, 0xef }, {   5, 0xff }
#define TAP4 TAP, TAP, TAP, TAP
#define TAP16 TAP4, TAP4, TAP4, TAP4
static const char script[][2] = {
    {   2, 0xff }, {   2, 0xef },       // title
    TAP16,                              // the runner crosses his line of fire
    { 132, 0xf7 },                      // right: X 168 to 300, under the grenadier
    {   8, 0xfe },                      // up 8: face up
    {   1, 0xdf }, {  49, 0xff },       // throw: the blast lands on the grenadier
    TAP16,                              // the rifleman follows him into his line of fire
    {  60, 0xfe },                      // up: to the threshold, then 16 lines of scroll
    { 250, 0xff }, { 250, 0xff },       // stand, no fire: the next rifleman's shot
};
#define PLAY_FRAMES 60000
#define FREEZE_YS   0
#define METER_ROW   10
#define TEST_FREEZE (play_frames >= 700)
#endif

#if TT_PART == 2
#define OWN_VERDICT
static char first_fail(void)
{
    char n = 1;
    CHECK(overruns == 0 && rd_late == 0 && lost_all == 0)   // 1 no frame lost, no redraw late
    CHECK(col_kills[K_RUNNER] == 1 && col_kills[K_GRENADIER] == 1 && col_kills[K_RIFLE] == 1)  // 2 one of each
    CHECK(col_blast == 1)                                   // 3 the grenadier by the blast
    CHECK(score[0] == 0 && score[1] == 0x04 && score[2] == 0x50)   // 4 150 + 200 + 100
    CHECK(col_hits == 1 && col_terrain == 0 && fl_deaths == 1 && fl_cause[0] == DC_HIT)   // 5 shot
    CHECK(fl_top[0] == 75 && fl_row[0] == 75 && lives == 2) // 6 the restart row, a life off
    CHECK(fl_restart_at[0] - fl_die_at[0] == DEATH_FRAMES && fl_alive_after[0] == 3)   // 7 the window again
    CHECK(fl_gren[0] == 4 && grenades == 5)                 // 8 grenades topped up
    return 0;
}

static void verdict(void)
{
    char fail = first_fail();
    char ok = fail == 0;
    verdict_code = ok ? 1 : 2;
    RESULT = verdict_code;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    char *s = SCREEN;
    // Short rows, columns 1-18: the restart's enemies stand top right.
    put_text(s, 1, 1, ok ? "RESULT 01 PASS   " : "RESULT 02 FAIL 00");
    if (!ok)
        put_dec(s + 1 * 40 + 16, fail, 2);
    put_text(s, 2, 1, "KILL 0 0 0 B 0");
    put_dec(s + 2 * 40 + 6, col_kills[K_RIFLE], 1);
    put_dec(s + 2 * 40 + 8, col_kills[K_RUNNER], 1);
    put_dec(s + 2 * 40 + 10, col_kills[K_GRENADIER], 1);
    put_dec(s + 2 * 40 + 14, col_blast, 1);
    put_text(s, 3, 1, "SCORE ......");
    put_bcd(s + 3 * 40 + 7, score, 3);
    put_text(s, 4, 1, "HIT 0 TER 0 C 0");
    put_dec(s + 4 * 40 + 5, col_hits, 1);
    put_dec(s + 4 * 40 + 11, col_terrain, 1);
    put_dec8(s + 4 * 40 + 15, fl_cause[0], 1);
    put_text(s, 5, 1, "TOP 00 ROW 00 E 0");
    put_dec8(s + 5 * 40 + 5, fl_top[0], 2);
    put_dec8(s + 5 * 40 + 12, fl_row[0], 2);
    put_dec8(s + 5 * 40 + 17, fl_alive_after[0], 1);
    put_text(s, 6, 1, "DT 000 GREN 0 0 L 0");
    put_dec(s + 6 * 40 + 4, fl_restart_at[0] - fl_die_at[0], 3);
    put_dec8(s + 6 * 40 + 13, fl_gren[0], 1);
    put_dec8(s + 6 * 40 + 15, grenades, 1);
    put_dec8(s + 6 * 40 + 19, lives, 1);
    put_text(s, 7, 1, "LOST 00 00 L 0");
    put_dec(s + 7 * 40 + 6, overruns, 2);
    put_dec(s + 7 * 40 + 9, lost_all, 2);
    put_dec8(s + 7 * 40 + 14, rd_late, 1);
    put_text(s, 8, 1, "COL 00000 DF 00");
    put_dec(s + 8 * 40 + 5, col_worst, 5);
    put_dec(s + 8 * 40 + 14, col_deferred, 2);
    // collide() once more with interrupts off, just after the frame IRQ on
    // line 250 (the border: no badline, no sprite DMA): its own cycles in the
    // scene at the freeze.
    K_FRAME_FLAG = 0;
    while (!K_FRAME_FLAG) ;
    __asm { sei }
    cyc_start();
    collide();
    unsigned bc = cyc_stop();
    __asm { cli }
    put_text(s, 9, 1, "BENCH 00000 P 00");
    put_dec(s + 9 * 40 + 7, bc, 5);
    put_dec8(s + 9 * 40 + 15, 11 - objects_free(), 2);
    for (char r = 1; r <= 9; r++)
        text_colour(r, 1, 19, TEXT_CRAM);
    text_colour(METER_ROW, 1, 20, TEXT_CRAM);
}
#endif
