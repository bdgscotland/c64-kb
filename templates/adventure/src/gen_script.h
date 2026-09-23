// gen_script.h: written by tools/gen.py (the autopilot script and what the
// model says each build must end with). Do not edit.
#ifndef GEN_SCRIPT_H
#define GEN_SCRIPT_H

#if DISKTEST == 1
static const char *const script[] = {
    "XYZZY",
    "N",
    "E",
    "OPEN CHEST",
    "TAKE LANTERN",
    "GET NET",
    "W",
    "W",
    "EXAMINE POND",
    "GET KEY",
    "DROP NET",
    "E",
    "N",
    "N",
    "UNLOCK DOOR",
    "N",
    "SAVE",
    0
};
#define EXPECT_ROOM 6
#define EXPECT_SCORE 20
#define EXPECT_TURNS 15
#define EXPECT_FLAGS 0x0003
#define EXPECT_OVER 0
#define EXPECT_LOCFOLD 0xcc35
#define EXPECT_TEXTFOLD 0x9c76
#define EXPECT_FRAMES 94
#define METER_HOLD 94      // the meter records at most 255
#define EXPECT_LINES 65
#define EXPECT_SAVE_CODE 0
#define EXPECT_LOAD_CODE 255
#elif DISKTEST == 2
static const char *const script[] = {
    "LOAD",
    "E",
    "OPEN DRAWER",
    "GET MATCHES",
    "W",
    "D",
    "LIGHT LAMP",
    "OPEN CRATE",
    "GET LENS",
    "U",
    "U",
    "U",
    "N",
    "OPEN DESK",
    "GET WINDER",
    "S",
    "D",
    "WIND CLOCK",
    "U",
    "U",
    "PUT LENS IN TELESCOPE",
    "LOOK AT TELESCOPE",
    0
};
#define EXPECT_ROOM 12
#define EXPECT_SCORE 100
#define EXPECT_TURNS 36
#define EXPECT_FLAGS 0x000f
#define EXPECT_OVER 1
#define EXPECT_LOCFOLD 0x5573
#define EXPECT_TEXTFOLD 0xd602
#define EXPECT_FRAMES 136
#define METER_HOLD 136      // the meter records at most 255
#define EXPECT_LINES 92
#define EXPECT_SAVE_CODE 255
#define EXPECT_LOAD_CODE 0
#elif 1
static const char *const script[] = {
    "XYZZY",
    "N",
    "E",
    "OPEN CHEST",
    "TAKE LANTERN",
    "GET NET",
    "W",
    "W",
    "EXAMINE POND",
    "GET KEY",
    "DROP NET",
    "E",
    "N",
    "N",
    "UNLOCK DOOR",
    "N",
    "SAVE",
    "E",
    "OPEN DRAWER",
    "GET MATCHES",
    "DROP LAMP",
    "LOAD",
    "E",
    "OPEN DRAWER",
    "GET MATCHES",
    "W",
    "D",
    "LIGHT LAMP",
    "OPEN CRATE",
    "GET LENS",
    "U",
    "U",
    "U",
    "N",
    "OPEN DESK",
    "GET WINDER",
    "S",
    "D",
    "WIND CLOCK",
    "U",
    "U",
    "PUT LENS IN TELESCOPE",
    "LOOK AT TELESCOPE",
    0
};
#define EXPECT_ROOM 12
#define EXPECT_SCORE 100
#define EXPECT_TURNS 36
#define EXPECT_FLAGS 0x000f
#define EXPECT_OVER 1
#define EXPECT_LOCFOLD 0x5573
#define EXPECT_TEXTFOLD 0xa877
#define EXPECT_FRAMES 240
#define METER_HOLD 240      // the meter records at most 255
#define EXPECT_LINES 161
#define EXPECT_SAVE_CODE 0
#define EXPECT_LOAD_CODE 0
#endif
#endif
