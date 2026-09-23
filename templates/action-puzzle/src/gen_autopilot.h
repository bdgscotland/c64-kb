// gen_autopilot.h: written by tools/gen.py. Do not edit; edit tools/gen.py.
// The autopilot: one move per cave frame (L U R D, '-' still), per cave;
// past the end of a cave's string the player stands still.
static const char script0[] = "RRRRRRRRRRRRRRRRRRDDDR";
static const char script1[] = "RRUD";
static const char script2[] = "RRRRRRRRD";
static const char script3[] = "RRUD";
static const char * const script_for[4] = { script0, script1, script2, script3 };
static const char script_len[4] = { 22, 4, 9, 4 };
#define SCRIPT_STARTS 4
#define LIVES_AUTOPILOT 3
#define NAME_AUTOPILOT "ABE"
// What the rules model says the program must hold at game over.
#define EXPECT_FOLD 0x75fa
#define EXPECT_SCORE 158UL
#define EXPECT_GEMS 6
#define EXPECT_CAVE 1
#define EXPECT_PLAY_FRAMES 240
#define EXPECT_STARTS 4
#define EXPECT_RANK 3
