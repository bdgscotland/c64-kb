// death_test.h: make death (-dAUTOPILOT=1 -dDEATHTEST=1). main.c includes it
// twice: TT_PART 1 is the stick script, TT_PART 2 the verdict. Every value
// is derived in PLAN.md, "Death and checkpoints".
//
// The view starts at checkpoint row 40 (top 40, YSCROLL 0), the soldier at
// his start (168, 160), no spawn-list enemies (objects.c). Each life: up 60
// frames (50 to the threshold, then 10 lines of scroll: top 39, YSCROLL 2,
// his body centre on map row 47), then left until his body centre is on the
// swamp (columns 7-14, A_DEADLY): collide.c kills him (terrain). The death
// runs DEATH_FRAMES, a life is taken, and the restart puts the view back at
// row 40, the first checkpoint at or behind top 39. Two grenades are thrown
// in the first life (5 to 3) and one in the second (5 to 4): each restart
// tops them up to 5. The third death ends the game: the build freezes on
// the play screen as the game asks for game over (main.c TEST_OVER).
#if TT_PART == 1
#define DT_START_TOP 40
#define DT_LIFE \
    {  60, 0xfe }, {  40, 0xfb }, {  70, 0xff }
static const char script[][2] = {
    {   2, 0xff }, {   2, 0xef },       // title
    {   2, 0xff }, {   1, 0xdf }, {  49, 0xff }, {   1, 0xdf }, {  49, 0xff },   // two throws
    DT_LIFE,                            // death 1
    {   4, 0xff }, {   1, 0xdf }, {  49, 0xff },   // one throw
    DT_LIFE,                            // death 2
    DT_LIFE,                            // death 3: game over
    { 250, 0xff },
};
#define PLAY_FRAMES 60000               // frozen by the game over (TEST_OVER), not by a frame
#define FREEZE_YS   2
#define METER_ROW   18                  // under the verdict (rows 12-17), clear of the swamp (rows 6-8)
static char dt_over;                    // 1: the game asked for game over
static char dt_map_ok = 1, dt_restarts; // every restart's view drawn from its row
static unsigned dt_sx, dt_sy;           // the soldier just after each restart (the last one)
#define TEST_OVER (dt_over = 1)
#define TEST_FREEZE 0
#endif

#if TT_PART == 2
#define OWN_VERDICT
static char first_fail(void)
{
    char n = 1;
    CHECK(overruns == 0 && rd_late == 0 && lost_all == 0)   // 1 no frame lost, no redraw late
    CHECK(fl_deaths == 3 && col_terrain == 3 && col_hits == 0)   // 2 three deaths, each on the swamp
    CHECK(fl_cause[0] == DC_TERRAIN && fl_cause[2] == DC_TERRAIN)
    CHECK(fl_top[0] == 39 && fl_top[1] == 39 && fl_top[2] == 39)   // 4 each at view top 39
    CHECK(fl_row[0] == 40 && fl_row[1] == 40)               // 5 restarted at checkpoint 40, behind
    CHECK(fl_gren[0] == 3 && fl_gren_after[0] == 5 && fl_gren[1] == 4 && fl_gren_after[1] == 5)  // 6 topped up
    CHECK(fl_lives[0] == 2 && fl_lives[1] == 1 && fl_lives[2] == 0 && lives == 0)   // 7 a life each
    CHECK(fl_restart_at[0] - fl_die_at[0] == DEATH_FRAMES && fl_restart_at[1] - fl_die_at[1] == DEATH_FRAMES)  // 8
    CHECK(dt_restarts == 2 && dt_map_ok)                    // 9 each restart drew map rows 40-60
    CHECK(dt_sx == 168 && dt_sy == 160)                     // 10 he stood at his start
    CHECK(dt_over && soldier_state == SS_DEAD)              // 11 game over after the last life
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
    put_text(s, 12, 1, ok ? "RESULT 01 PASS   " : "RESULT 02 FAIL 00");
    if (!ok)
        put_dec(s + 12 * 40 + 16, fail, 2);
    put_text(s, 13, 1, "DEATHS 0 CAUSE 000 TOP 00 00 00");
    put_dec8(s + 13 * 40 + 8, fl_deaths, 1);
    for (char i = 0; i < 3; i++) {
        put_dec8(s + 13 * 40 + 16 + i, fl_cause[i], 1);
        put_dec8(s + 13 * 40 + 24 + 3 * i, fl_top[i], 2);
    }
    put_text(s, 14, 1, "ROW 00 00 GREN 0 0 0 0 LIVES 000");
    put_dec8(s + 14 * 40 + 5, fl_row[0], 2);
    put_dec8(s + 14 * 40 + 8, fl_row[1], 2);
    put_dec8(s + 14 * 40 + 16, fl_gren[0], 1);
    put_dec8(s + 14 * 40 + 18, fl_gren_after[0], 1);
    put_dec8(s + 14 * 40 + 20, fl_gren[1], 1);
    put_dec8(s + 14 * 40 + 22, fl_gren_after[1], 1);
    for (char i = 0; i < 3; i++)
        put_dec8(s + 14 * 40 + 30 + i, fl_lives[i], 1);
    put_text(s, 15, 1, "DIE 000 000 000 UP 000 000 OVER 0");
    for (char i = 0; i < 3; i++)
        put_dec(s + 15 * 40 + 5 + 4 * i, fl_die_at[i], 3);
    put_dec(s + 15 * 40 + 20, fl_restart_at[0], 3);
    put_dec(s + 15 * 40 + 24, fl_restart_at[1], 3);
    put_dec8(s + 15 * 40 + 33, dt_over, 1);
    put_text(s, 16, 1, "MAP 0 0 AT 000 000 LOST 00 00 LATE 0");
    put_dec8(s + 16 * 40 + 5, dt_restarts, 1);
    put_dec8(s + 16 * 40 + 7, dt_map_ok, 1);
    put_dec(s + 16 * 40 + 12, dt_sx, 3);
    put_dec(s + 16 * 40 + 16, dt_sy, 3);
    put_dec(s + 16 * 40 + 25, overruns, 2);
    put_dec(s + 16 * 40 + 28, lost_all, 2);
    put_dec8(s + 16 * 40 + 36, rd_late, 1);
    put_text(s, 17, 1, "RESTART 00000 LD 000");
    put_dec(s + 17 * 40 + 9, fl_restart_cyc, 5);
    put_dec(s + 17 * 40 + 18, rd_lead < 0 ? 0 : rd_lead, 3);
    for (char r = 12; r <= 17; r++)
        text_colour(r, 1, 38, TEXT_CRAM);
    text_colour(METER_ROW, 1, 20, TEXT_CRAM);
}
#endif
