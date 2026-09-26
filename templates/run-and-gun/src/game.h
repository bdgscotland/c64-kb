// game.h: what every module of FIREBASE shares. The memory map, the kernel's
// variables (build/asm.h, generated from src/kernel.asm and mux.asm), the
// sprite slot layout, the coordinate rules and the game state. Each module's
// own header pulls its .c in with #pragma compile: Oscar64 has no object
// linker. Read PLAN.md, "Modules", before adding one.
#ifndef GAME_H
#define GAME_H

#include <c64/vic.h>
#include <c64/cia.h>
#include "asm.h"                // ASM_<LABEL> for every label in src/*.asm
#include "gen/assets.h"         // written by tools/mkassets.py

#ifndef AUTOPILOT
#define AUTOPILOT 0
#endif
#ifndef FORCE_FAULT
#define FORCE_FAULT 0
#endif
#if defined(FRONTEND) && !defined(FORCE_OVER)
#define FORCE_OVER 1                    // make frontend: the forced game over (flow.c)
#endif
// NO_HARM: nothing kills the soldier (collide.c). The forced-death builds
// (their score must be exact), make weapons (its script stands under enemy
// fire for 260 frames; it grades the gun and the grenade, and was pinned
// before collisions), make area and make fullpool (they grade the gate
// sequence and the budget; an aimed shot killed the soldier on play frame 78
// of the gate wave) set it. Bullets and blasts still kill enemies; deaths are
// make death's and make collide's to prove.
#if defined(FORCE_OVER) || defined(WEAPONS) || defined(AREATEST) || defined(FULLPOOL)
#define NO_HARM 1
#endif
// COLLIDE_TIMED: collide() times itself with CIA1 timer B (collide.h col_worst).
#if defined(WEAPONS) || defined(COLLIDETEST) || defined(AREATEST) || defined(FULLPOOL)
#define COLLIDE_TIMED 1
#endif

// ---- memory map ----------------------------------------------------------------
// $0801-$087F Oscar64 startup        $0880-$1FFF the kernel blob (asm)
// $2000-$7FFF C code, data, stack    $8000-$BFFF VIC bank 2 ($DD00 bits = 01):
//   $8000-$83E7 the one screen: playfield rows 0-20, panel rows 21-23
//   $83F8-$83FF sprite pointers       $8400-$87FF scratch (the meter's row, AUTOPILOT)
//   $8800-$8FFF characters (0-63 copied from the ROM, 64-255 the jungle)
//   $9000-$9EFF the raw row map, 96 rows of 40 screen codes (the VIC sees the
//               character ROM at $9000-$9FFF, so nothing it shows can live here)
//   $9F00-$9FFF attr[screen code], page aligned (char_attribute_flags)
//   $A000-$BFFF sprite shapes, block 128 onward
// $C000-$CFFF free.  KERNAL and BASIC are banked out ($01 = $35).
#define SCREEN    ((char *)0x8000)
#define PANEL     ((char *)0x8348)          // SCREEN + 21 * 40
#define SCRATCH   ((char *)0x8400)
#define CHARSET   ((char *)0x8800)
#define MAP       ((const char *)0x9000)
#define ATTR      ((const char *)0x9f00)
#define SPRITES   ((char *)0xa000)
#define COLOUR    ((char *)0xd800)
#define SPR_BLOCK 128                       // $A000 / 64 inside the bank
#define PF_ROWS   21                        // playfield screen rows (row 20 under the band)
#define PF_CRAM   0x0d                      // playfield colour RAM: multicolour, green
#define RESULT    (*(volatile char *)0x02ff)   // $01 pass, $02 fail (AUTOPILOT)
#define LOST_FRAMES (*(volatile char *)0x02fd) // lost play frames, saturating at 255

// ---- the kernel's variables (src/kernel.asm, mux.asm, sound.asm) ---------------
#define K_BYTE(a) (*(volatile char *)(a))
#define K_WORD(a) (*(volatile unsigned *)(a))
#define K_CUR_YS     K_BYTE(ASM_CUR_YS)
#define K_PEND_YS    K_BYTE(ASM_PEND_YS)
#define K_COMMIT     K_BYTE(ASM_COMMIT)
#define K_FRAME_FLAG K_BYTE(ASM_FRAME_FLAG)
#define K_FRAME_CNT  K_BYTE(ASM_FRAME_CNT)
#define K_BAND_TICK  K_BYTE(ASM_BAND_TICK)
#define K_REDRAW_TOP K_BYTE(ASM_REDRAW_TOP)
#define K_REDRAW_END K_WORD(ASM_REDRAW_END)
#define K_REDRAW_FC  K_BYTE(ASM_REDRAW_FC)
#define K_MTR_OPEN   K_BYTE(ASM_MTR_OPEN)
#define K_IRQ_CNT    K_BYTE(ASM_IRQ_CNT)
#define K_IRQ_CYC    K_WORD(ASM_IRQ_CYC)
#define K_IRQ_CAL    K_BYTE(ASM_IRQ_CAL)
#define K_MUX_SHOWN  K_BYTE(ASM_MUX_SHOWN)
#define K_MUX_LATE   K_BYTE(ASM_MUX_LATE)
#define COMMIT_YS    0x01                   // K_COMMIT bits
#define COMMIT_MUX   0x02

// ---- sprite slots (mux.asm) --------------------------------------------------------
// Sixteen virtual sprites, Commando's split (techniques/sprite.md,
// sprite_slot_parking): the soldier, three bullets, one grenade, eleven pool
// slots for enemies, their shots and explosions. A free slot is parked
// (objects.h slot_park); nothing tests "in use" in the IRQs. Write every
// field of a slot in the same frame (slot_show): a slot whose Y is written a
// frame after its X shows for one frame at the parking Y.
#define N_SLOTS       16
#define SLOT_SOLDIER  0
#define SLOT_BULLET   1         // 1-3: the soldier's shots (weapons.c)
#define N_BULLETS     3
#define SLOT_GRENADE  4         // weapons.c
#define SLOT_POOL     5         // 5-15: enemies, enemy shots, explosions (objects.c)
#define N_POOL        11
#define SLOT_Y   ((char *)ASM_SLOT_Y)
#define SLOT_XL  ((char *)ASM_SLOT_XL)
#define SLOT_XH  ((char *)ASM_SLOT_XH)      // bit 8 of X: 0 or 1
#define SLOT_PTR ((char *)ASM_SLOT_PTR)
#define SLOT_COL ((char *)ASM_SLOT_COL)
#define SLOT_PRI ((char *)ASM_SLOT_PRI)     // 1: behind the canopy ($D01B)
#define PARK_Y   255            // mux.asm's PARK_Y
#define PARK_X   356            // right border, PAL and NTSC
#define MAX_SY   187            // mux.asm's MAX_SY: lowest sprite Y shown (last line 208)

// ---- coordinates -------------------------------------------------------------------
// Screen: sprite registers. A sprite at (X, Y) covers VIC X X..X+23 and raster
// lines Y+1..Y+21. Playfield lines are 55-213 at every YSCROLL; 214-222 are
// the band, 223-246 the panel.
// Map: pixels, x 0-319 and y 0-767 (row 0 at the top, where the fort is).
// scroll_wy is the map y shown on raster line 55. A sprite pixel (dx, dy) of
// a sprite at (X, Y) is at map x = X + dx - 24, map y = scroll_wy + Y + dy - 54
// (scroll.h: map_x, map_y). Objects that stand on the map keep map
// coordinates and are drawn at Y = my - scroll_wy + 54 - dy.

// ---- game state (main.c) -------------------------------------------------------------
// game_state_machine: one state byte. A module that wants another state writes
// state_next; main.c runs that state's entry routine before the next frame
// (play_enter for ST_PLAY, front_enter in front.c for the front end).
enum { ST_TITLE, ST_PLAY, ST_FROZEN, ST_OVER, ST_ENTRY, ST_TABLE };
extern char state, state_next;
extern char demo;                        // 1: ST_PLAY is the attract demo (front.c)
extern unsigned play_frames;
extern char ntsc;                        // 1 on NTSC (263 lines), 0 on PAL (312)
extern char score[3];                    // BCD, score[0] most significant (6 digits); add
                                         // with flow_add_score; flow.c owns it, display.c shows it
extern char lives, grenades;             // binary; the panel follows a change (flow_frame)
extern char area;                        // the area counter, 0 first (area.c): it drives the
                                         // enemies' fire rate (objects.c place) and the colours

#define JOY_UP    0x01                  // $DC00 bits, active low
#define JOY_DOWN  0x02
#define JOY_LEFT  0x04
#define JOY_RIGHT 0x08
#define JOY_FIRE  0x10

void sfx(char n);                        // main.c: request effect n (sound.asm sfx_request)

#endif
