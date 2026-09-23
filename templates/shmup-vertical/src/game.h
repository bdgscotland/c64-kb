// game.h: what every module of shmup-vertical shares. Memory map, the
// kernel's variables (build/asm.h, generated from src/kernel.asm), and the
// game state. Each module's own header pulls its .c in with
// #pragma compile: Oscar64 has no object linker.
#ifndef GAME_H
#define GAME_H

#include <c64/vic.h>
#include <c64/cia.h>
#include "asm.h"                // ASM_<LABEL> for every label in src/*.asm

#ifndef AUTOPILOT
#define AUTOPILOT 0
#endif
#ifndef FORCE_FAULT
#define FORCE_FAULT 0
#endif

// ---- memory map ------------------------------------------------------------
// $0801-$087F Oscar64 startup      $0880-$1FFF the kernel blob (asm)
// $2000-$7FFF C code, data, stack  $8000-$BFFF VIC bank 2:
//   $8000 playfield screen 0, $8400 playfield screen 1, $8800 panel screen,
//   $8C00 meter scratch row (AUTOPILOT), $A000 sprite shapes, $B800 characters.
// The VIC sees the character ROM at $9000-$9FFF in bank 2, so nothing it
// shows lives there; C keeps its level map there.
#define PF0       ((char *)0x8000)
#define PF1       ((char *)0x8400)
#define PANEL     ((char *)0x8800)
#define SCRATCH   ((char *)0x8c00)
#define SPRITES   ((char *)0xa000)
#define CHARSET   ((char *)0xb800)
#define COLOUR    ((char *)0xd800)
#define LEVEL_RAM ((char *)0x9000)
#define SPR_BLOCK 128           // $A000 / 64 inside the bank
#define D018_PF0  0x0e          // screen $8000, characters $B800
#define D018_PF1  0x1e          // screen $8400
#define RESULT    (*(volatile char *)0x02ff)   // $01 pass, $02 fail

// ---- the kernel's variables (src/kernel.asm, mux.asm, sound.asm) -------------
#define K_BYTE(a) (*(volatile char *)(a))
#define K_WORD(a) (*(volatile unsigned *)(a))
#define K_PF_D011    K_BYTE(ASM_PF_D011)
#define K_PF_D018    K_BYTE(ASM_PF_D018)
#define K_PF_BG      K_BYTE(ASM_PF_BG)
#define K_FRAME_FLAG K_BYTE(ASM_FRAME_FLAG)
#define K_MTR_OPEN   K_BYTE(ASM_MTR_OPEN)
#define K_IRQ_CNT    K_BYTE(ASM_IRQ_CNT)
#define K_IRQ_CYC    K_WORD(ASM_IRQ_CYC)
#define K_IRQ_CAL    K_BYTE(ASM_IRQ_CAL)
#define K_SPLIT_PREV K_BYTE(ASM_SPLIT_PREV)
#define K_MUX_READY  K_BYTE(ASM_MUX_READY)
#define K_MUX_SHOWN  K_BYTE(ASM_MUX_SHOWN)
#define K_MUX_PEAK   K_BYTE(ASM_MUX_PEAK)
#define K_SFX_TAKEN  K_BYTE(ASM_SFX_TAKEN)
// C writes the actor table and then calls mux_sort; the IRQs read only the
// sorted copy mux_build makes, so the table need not be volatile.
#define ACT_Y   ((char *)ASM_ACT_Y)
#define ACT_HX  ((char *)ASM_ACT_HX)       // sprite X = 2 * hx
#define ACT_PTR ((char *)ASM_ACT_PTR)
#define ACT_COL ((char *)ASM_ACT_COL)
#define N_ACTORS 16             // mux.asm's N
#define OFF_Y    0xff           // mux.asm's OFF_Y: not shown
#define MAX_SY   187            // mux.asm's MAX_SY: lowest sprite Y shown

// ---- coordinates ---------------------------------------------------------
// Horizontal positions are half X ("hx"): sprite X = 2 * hx, one byte for the
// whole screen, and one hx is one multicolour pixel. Vertical positions are
// sprite Y registers for sprites and raster lines for bullets; a sprite at Y
// is drawn on lines Y + 1 to Y + 21.

// ---- game state (main.c) ---------------------------------------------------
enum { ST_TITLE, ST_PLAY, ST_OVER, ST_FROZEN };
extern char state;
extern char lives, deaths;
extern unsigned score, hiscore;         // in tens of points: the panel adds a 0
extern unsigned play_frames;

#define START_LIVES 3

void sfx(char n);                       // 1 shot, 2 explosion, 3 ship lost
void add_score(char tens);


#endif
