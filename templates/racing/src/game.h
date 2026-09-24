// game.h: everything the racer's C files share.
//
//   main.c    the frame loop, the states (title, grid, race, finish), the meter
//   road.c    the view: camera, horizon, curve, the three sprites, the builder
//   cars.c    the player's car, the three opponents, contact, laps, the clock
//   art.c     the road characters, the car pictures at six sizes, the ROM font copy
//   hud.c     the panel under the road: text, numbers, lap times
//   sound.c   the engine note, the bump, the start lights
//   autopilot.h, verdict.h   AUTOPILOT builds: the driver bot and the self-checks
#ifndef GAME_H
#define GAME_H

#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/sid.h>
#include <string.h>
#include "asm.h"

#ifndef AUTOPILOT
#define AUTOPILOT 0
#endif
#ifndef FORCE_FAULT
#define FORCE_FAULT 0
#endif
// MUTANT=n (AUTOPILOT builds, make mutants): one deliberate fault each, which
// a check must catch. 1 the sprites' padding ignored (the road's timing),
// 2 no curve, 3 no hill, 4 one car size at every distance, 5 the clock
// counts every other frame, 6 no contact between cars, 7 one game step
// runs past the next line 251 (the lost-frame count).
#ifndef MUTANT
#define MUTANT 0
#endif

#define B(a)  (*(volatile char *)(a))
#define W(a)  (*(volatile unsigned *)(a))

// ---- memory: VIC bank 3 ----------------------------------------------------------
#define SCREEN_A  ((char *)0xc000)      // road screens; rows 0-6 sky, 7-18 road
#define SCREEN_B  ((char *)0xc400)
#define HUDPAGE   ((char *)0xc800)      // rows 19-24 are the panel
#define SPRITES   ((char *)0xcc00)      // blocks 48-63
#define CHARSET   ((char *)0xe000)      // road characters (multicolour)
#define HUDFONT   ((char *)0xe800)      // the ROM's upper-case set, copied
#define COLOUR    ((char *)0xd800)
#define RESULT    B(0x02ff)             // $01 pass, $02 fail (c64-kb headless-verify)
#define SPR_BLOCK0 48

#define JOY_UP    0x01
#define JOY_DOWN  0x02
#define JOY_LEFT  0x04
#define JOY_RIGHT 0x08
#define JOY_FIRE  0x10

// ---- the road (engine.asm's constants) ---------------------------------------------
#define ROAD_TOP    107
#define ROAD_LINES  96
#define H_MIN       108
#define HOFF_N      24
#define HOFF_LEVEL  8                   // the track's level ground
#define L_NEAR      202
#define ZN          24                  // world units from the camera to line 202
#define W0          136                 // half-width at line 202, pixels
#define SEGMENTS    64
#define LAP_UNITS   16384u              // 64 segments of 256
#define LAP_MASK    0x3fff

// ---- cars -----------------------------------------------------------------------------
#define NOPP        3                   // opponents
#define NCARS       (NOPP + 1)          // car 0 is the player
#define LAPS        2
#define CAR_LEN     40                  // world units: contact along the road
#define CAR_HALF    14                  // pixels at line 202: half a car's width
#define CAR_BOTTOM  198                 // the player's car sits on this line
#define SPEED_MAX   0x0a00              // 8.8 world units a frame (10)
#define VERGE_MAX   0x0400              // on the grass
#define NSIZES      6                   // car pictures, smallest first

enum State { ST_TITLE, ST_GRID, ST_RACE, ST_FINISH, ST_GRADED };

// cars.c
extern unsigned car_pos[NCARS];         // world position, 0-16383 (mod a lap)
extern char     car_lap[NCARS];         // laps completed
extern unsigned car_speed[NCARS];       // 8.8 units a frame
extern int      car_x[NCARS];           // across the road, 1/16 pixel at line 202 (0 = centre)
extern char     car_colour[NCARS];
extern char     place;                  // the player's race position, 1-4
extern unsigned lap_frames;             // frames in the lap being driven
extern unsigned lap_time[LAPS];         // frames per finished lap
extern unsigned race_frames;            // frames since the green light
extern unsigned bumps, verge_frames, overtakes;
extern char     bump_cool;
extern bool     on_verge;
extern char     finished;               // the player's finishing position, 0 until then
void cars_reset(void);
void cars_step(char joy);

// road.c
extern char     hoff;                   // horizon offset now (0-23)
extern bool     road_snap;
extern unsigned cam_pos;                // world position of line 202's road
extern char     spr_line[NCARS];        // the line a car's bottom is drawn on, 0 when not drawn
extern char     spr_size[NCARS];
extern char     sizes_seen;             // bit per car size drawn during the race
extern char     hoff_min, hoff_max;     // the horizon's range during the race
extern int      curve_min, curve_max;   // the shown centre's range at the horizon
void road_init(void);
void road_work(void);                   // one piece of the next picture (main loop, spare time)
void road_build_all(void);              // a whole picture, before the IRQ chain runs
void road_final(void);                  // the picture of the state now, shown (the verdict)
extern unsigned pictures;               // pictures published during the race
int line_centre(char set, char i);
char road_segment(unsigned p);
void road_wait_swap(void);

// art.c
void art_init(void);
void art_sky(char *screen);
extern const char size_w[NSIZES], size_h[NSIZES];

// hud.c
void hud_init(void);
void hud_text(char row, char col, const char *s);
void hud_clear_row(char row);
void hud_dec(char row, char col, unsigned v, char digits);
void hud_time(char row, char col, unsigned frames);
void hud_draw(void);
extern char fps;                        // 50 PAL, 60 NTSC
extern char fpt;                        // frames a tenth of a second: 5 PAL, 6 NTSC

// sound.c
void sound_init(void);
void sound_frame(void);
void sound_bump(void);
void sound_beep(char high);
void sound_off(void);

// main.c
extern char state;
extern unsigned frame;
extern char model;                      // 0 PAL, 1 NTSC

// Oscar64 has no object linker: each file is pulled in here.
#pragma compile("cars.c")
#pragma compile("road.c")
#pragma compile("art.c")
#pragma compile("hud.c")
#pragma compile("sound.c")

#endif
