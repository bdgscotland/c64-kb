// hello: the minimal starter. One sprite moved by joystick port 2 and placed
// by a KickAssembler routine called from C, with the frame meter around the
// frame's work. AUTOPILOT=1 replaces the port with a script and grades the
// end position; FORCE_FAULT=1 starts the sprite one pixel off, so both the
// program's own grade and the screenshot checks must fail.
#include <c64/vic.h>
#include <c64/cia.h>
#include "asm.h"            // generated from src/sprite.asm by the harness
#include "frame_meter.h"    // templates/_harness/meter

#ifndef AUTOPILOT
#define AUTOPILOT 0
#endif
#ifndef FORCE_FAULT
#define FORCE_FAULT 0
#endif

// ---- the KickAssembler blob at its own address ------------------------------
// ASM_ORG comes from the blob; main moves up to $1000 to leave it room. A blob
// that outgrows $1000 fails the link with "Could not place object"; one that
// starts below $0880, over Oscar64's startup code, stops at the #error that
// asm.h carries.
#pragma section( asmcode, 0 )
#pragma region( asmreg, ASM_ORG, 0x1000, , , { asmcode } )
#pragma region( main, 0x1000, 0xa000, , , { code, data, bss, heap, stack } )
#pragma data( asmcode )
__export const char asm_blob[] = {
#embed "asm.bin"
};
#pragma data( data )

#define SPR_X   (*(volatile unsigned *)ASM_SPR_X)   // parameters live in the blob
#define SPR_Y   (*(volatile char *)ASM_SPR_Y)

#define SCREEN  ((char *)0x0400)
#define COLOUR  ((char *)0xd800)
#define SPRITE_BLOCK 13                             // $0340, the tape buffer
#define RESULT  (*(volatile char *)0x02ff)          // $01 pass, $02 fail, $00 not reached

#define JOY_UP    0x01
#define JOY_DOWN  0x02
#define JOY_LEFT  0x04
#define JOY_RIGHT 0x08
#define JOY_FIRE  0x10

#define START_X (100 + FORCE_FAULT)                 // the fault build ends 1 pixel off
#define START_Y 100
#define PLAY_FRAMES 144                             // the script's length; the meter records these
#define VERDICT_FRAME 150                           // after the script

#if AUTOPILOT
// { frames, port byte }, active low as $DC00 reads it: right 64, down 40,
// fire 16 (one press: yellow to cyan), up and right 24. Every frame plays.
static const char script[4][2] = {
    { 64, 0xf7 }, { 40, 0xfd }, { 16, 0xef }, { 24, 0xf6 }
};
static char ap_index, ap_used;
// End state by arithmetic on the script: x 100 + 64 + 24, y 100 + 40 - 24.
#define EXPECT_X 188
#define EXPECT_Y 116
#define EXPECT_COLOUR VCOL_CYAN

static char port_read(void)
{
    char out = 0xff;
    if (ap_index < 4) {
        out = script[ap_index][1];
        if (++ap_used == script[ap_index][0]) { ap_used = 0; ap_index++; }
    }
    return out;
}
#else
static char port_read(void)
{
    return cia1.pra;                                // control port 2, active low
}
#endif

static void put_text(char row, char col, const char *s, char colour)
{
    char *p = SCREEN + 40 * row + col;
    char *q = COLOUR + 40 * row + col;
    while (*s) {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
        *q++ = colour;
    }
}

// frame_sync_loop: line 250 is below the last badline ($F7) on PAL and NTSC
// and occurs once a frame, so the 8-bit compare needs no ninth bit.
static void wait_frame(void)
{
    while (vic.raster == 250) ;
    while (vic.raster != 250) ;
}

int main(void)
{
    __asm { sei }                                   // no KERNAL IRQ inside the meter's bracket
    cia1.pra = 0xff;                                // no keyboard column selected

    for (unsigned i = 0; i < 1000; i++) {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;
    put_text(1, 1, "hello harness", VCOL_WHITE);

    char *img = (char *)(SPRITE_BLOCK * 64);
    for (char i = 0; i < 63; i++)
        img[i] = 0xff;                              // a solid 24 x 21 block
    SCREEN[0x3f8] = SPRITE_BLOCK;
    vic.spr_color[0] = VCOL_YELLOW;
    vic.spr_enable = 0x01;

    unsigned x = START_X;
    char y = START_Y, colour = VCOL_YELLOW, prev = 0xff;
    unsigned frame = 0;

    meter_init(0x0400, 24, 20, VCOL_WHITE, PLAY_FRAMES);

    for (;;) {
        wait_frame();
        METER_START;

        char joy = port_read();
        if (!(joy & JOY_LEFT)  && x > 24)  x--;
        if (!(joy & JOY_RIGHT) && x < 320) x++;
        if (!(joy & JOY_UP)    && y > 50)  y--;
        if (!(joy & JOY_DOWN)  && y < 229) y++;
        if (!(joy & JOY_FIRE) && (prev & JOY_FIRE))   // a new press
            colour = colour == VCOL_YELLOW ? VCOL_CYAN : VCOL_YELLOW;
        prev = joy;

        SPR_X = x;
        SPR_Y = y;
        __asm { jsr ASM_PUT_SPRITE }                // the KickAssembler routine
        vic.spr_color[0] = colour;

        METER_STOP;                                 // the frame's own work ends here

#if AUTOPILOT
        // Grading is the harness's bookkeeping, not the program's work: it
        // runs after METER_STOP, so it is not in the worst frame.
        if (frame == VERDICT_FRAME) {
            char ok = vic.spr_pos[0].x == (char)EXPECT_X
                   && (*(volatile char *)0xd010 & 1) == (EXPECT_X >> 8)
                   && vic.spr_pos[0].y == EXPECT_Y
                   && (vic.spr_color[0] & 15) == EXPECT_COLOUR;
            RESULT = ok ? 0x01 : 0x02;
            vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
            put_text(22, 1, ok ? "result 01 pass" : "result 02 fail", VCOL_WHITE);
        }
#endif
        meter_print();
        frame++;
    }
    return 0;
}
