// gen_autopilot.h: written by tools/gen.py. Do not edit; edit tools/gen.py.
// The autopilot: one move per cave frame (L U R D, '-' still), per cave;
// past the end of a cave's string the player stands still.
static const char script0[] = "RRRRRRRRRRRRRRRRRRDDDR";
static const char script1[] = "RRUD";
static const char * const script_for[2] = { script0, script1 };
#define SCRIPT_CAVES 2
#define LIVES_AUTOPILOT 1
#define NAME_AUTOPILOT "ABE"
// What the rules model says the program must hold at game over.
#define EXPECT_FOLD 0xc0f1
#define EXPECT_SCORE 158UL
#define EXPECT_GEMS 6
#define EXPECT_CAVE 1
#define EXPECT_PLAY_FRAMES 140
