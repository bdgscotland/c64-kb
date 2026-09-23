// cave.h: the cave and its rules (c64-kb technique cave_scan_engine).
//
// A 40 x 22 cave of one-byte cells, steel border included. One cave frame is
// one top-to-bottom, left-to-right scan of the 38 x 20 interior. The game
// splits it into slices of rows, one slice a display frame
// (cave_scan_rows), then calls cave_end_frame. An object that moves down or
// right gets bit 7 (SCANNED), so the scan skips it when it reaches the cell
// it moved into. tools/gen.py holds a model of the same rules; the AUTOPILOT
// build checks the cave against it.
#ifndef CAVE_H
#define CAVE_H

#define CW 40                   // cave width in cells
#define CH 22                   // cave height in cells

// Element codes (tools/gen.py uses the same numbers). A code below BOULDER
// never moves, and the scan loop does nothing more than compare it.
#define SPACE      0
#define DIRT       1
#define BRICK      2            // round: things roll off it
#define STEEL      3            // not round, not destroyed by explosions
#define BOULDER    4
#define BOULDER_F  5            // falling: the resting code + 1
#define GEM        6
#define GEM_F      7
#define EXIT_SHUT  8            // drawn as steel until the quota is met
#define EXIT_OPEN  9
#define PLAYER     10
#define SPARK      12           // 12..15: heading in the low two bits; keeps a wall on its left
#define MOTH       16           // 16..19: keeps a wall on its right; dies into gems
#define BLAST      20           // 20..22: explosion stages, then space
#define BURST      23           // 23..25: explosion stages, then a gem
#define CODES      26           // at most 32: render.c draws code & 0x1f at glyph $40 + code
#define SCANNED    0x80

#define NO_MOVE    0xff         // cave_move: headings 0..3 are left, up, right, down

#define GEM_POINTS       10
#define TICK_CAVE_FRAMES 12     // cave frames per unit of the time counter

// Sound events a scan raised, for the effects engine (bits of cave_events).
#define EV_DIG   0x01
#define EV_PUSH  0x02
#define EV_LAND  0x04
#define EV_GEM   0x08
#define EV_OPEN  0x10
#define EV_BOOM  0x20

extern char cave[CW * CH];
extern char cave_move;          // the player's heading this cave frame, or NO_MOVE
extern char cave_got, cave_need, cave_time, cave_tick;
extern unsigned cave_points;    // points scored in this cave
extern unsigned cave_player;    // cell index of the player
extern unsigned cave_exit_at;
extern bool cave_dead, cave_exited, cave_exit_open;
extern char cave_events;
extern char cave_seen;          // times the scan ran the player's rules; main.c resets it each cave frame

// Cells a slice changed, for the renderer. A move marks two cells, an
// explosion nine, so a slice holds up to 8 moves before the list overflows;
// then render.c queues the slice's rows and redraws them two a frame.
#define DIRTY_MAX 16
extern unsigned cave_dirty[DIRTY_MAX];
extern char cave_ndirty;
extern bool cave_overflow;

void cave_start(char need, char time);  // after the decode: find the player and exit
void cave_scan_rows(char y0, char y1);  // scan interior rows y0 .. y1 - 1
void cave_end_frame(void);              // after the last slice: exit, clock
unsigned cave_fold(unsigned chk);       // chk = (chk ^ v) * 5 + 1 over all 880 cells

// SCAN_FLAG=0 builds the rules without the scanned bit: the double-move bug
// of the cave-scan recipe, which make selftest-scan must see fail.
#ifndef SCAN_FLAG
#define SCAN_FLAG 1
#endif

#pragma compile("cave.c")

#endif
