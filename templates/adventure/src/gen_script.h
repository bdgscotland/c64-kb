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
    "PICK UP LANTERN",
    "GET NET",
    "W",
    "W",
    "POND",
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
#define EXPECT_TURNS 14
#define EXPECT_FLAGS 0x0003
#define EXPECT_OVER 0
#define EXPECT_LOCFOLD 0xcc35
#define EXPECT_TEXTFOLD 0xb61f
#define EXPECT_FRAMES 92
#define METER_HOLD 92      // the meter records at most 255
#define EXPECT_LINES 64
#define EXPECT_SAVE_CODE 0
#define EXPECT_LOAD_CODE 255
#elif DISKTEST == 2
static const char *const script[] = {
    "LOAD",
    "W",
    "E",
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
#define EXPECT_TURNS 37
#define EXPECT_FLAGS 0x000f
#define EXPECT_OVER 1
#define EXPECT_LOCFOLD 0x5573
#define EXPECT_TEXTFOLD 0xe4f8
#define EXPECT_FRAMES 149
#define METER_HOLD 149      // the meter records at most 255
#define EXPECT_LINES 101
#define EXPECT_SAVE_CODE 255
#define EXPECT_LOAD_CODE 0
#elif 1
static const char *const script[] = {
    "XYZZY",
    "N",
    "E",
    "OPEN CHEST",
    "PICK UP LANTERN",
    "GET NET",
    "W",
    "W",
    "POND",
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
    "W",
    "E",
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
#define EXPECT_TURNS 37
#define EXPECT_FLAGS 0x000f
#define EXPECT_OVER 1
#define EXPECT_LOCFOLD 0x5573
#define EXPECT_TEXTFOLD 0xfab8
#define EXPECT_FRAMES 251
#define METER_HOLD 251      // the meter records at most 255
#define EXPECT_LINES 169
#define EXPECT_SAVE_CODE 0
#define EXPECT_LOAD_CODE 0
#endif
#endif
