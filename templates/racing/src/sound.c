// sound.c: the SID through the player (music.asm: c64-kb's
// recipes/kickassembler/music-player.md, its API and code, with this
// starter's own tune "Redline" on voices 1 and 2 and its effects on voice
// 3). Between effects voice 3 is the car's engine: a pulse whose pitch
// follows the speed. Called once a step. (light-5 played the tune only on
// the title and between stages; the maintainer wanted it in the race.)
#include "game.h"

// the player's effects (music.asm fx_pri, fx_ptr)
#define FX_TICK  1                      // the start lights
#define FX_BUMP  2                      // cars touching
#define FX_CHECK 3                      // a checkpoint
#define FX_CRASH 4
#define FX_GO    5                      // the green light

static void fx(char n)
{
    __asm {
        sei
        lda n
        jsr ASM_SFX_REQUEST
        cli
    }
}

void sound_init(void)
{
    char m = model;                     // the frequency table, the SID quiet, the tune's top
    __asm {
        lda m
        jsr ASM_MUSIC_INIT
    }
}

void sound_frame(void)
{
    bool on = state == ST_RACE || state == ST_GRID || state == ST_CLEAR;
    W(ASM_EN_FREQ) = 0x0400 + (car_speed[0] >> 1) + (car_speed[0] >> 3);
    B(ASM_EN_ON) = on;
#if !NO_TUNE
    if (state != ST_FINISH && state != ST_OVER && state != ST_GRADED)
        __asm { jsr ASM_MUSIC_PLAY }
#endif
    __asm { jsr ASM_ENGINE_NOTE }
}

void sound_bump(void)
{
    fx(FX_BUMP);
}

void sound_crash(void)
{
    fx(FX_CRASH);
}

void sound_check(void)
{
    fx(FX_CHECK);
}

void sound_beep(char high)
{
    fx(high ? FX_GO : FX_TICK);
}

void sound_off(void)
{
    __asm { jsr ASM_MUSIC_RESTART }     // the tune from its top, the SID quiet
}
