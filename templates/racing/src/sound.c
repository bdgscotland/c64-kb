// sound.c: the SID. On the title and between the stages, the tune
// (music.asm: c64-kb's music-player recipe and the starter's "Redline").
// In the race, no tune: voice 1 is the engine, a sawtooth whose pitch
// follows the speed; voice 2 beeps the start lights and the checkpoints;
// voice 3 is a noise burst on contact and a longer one on a crash (c64-kb
// sid_voice_setup). The race's sound costs a few register writes a frame;
// the player runs only when the game has room (its own cost: racing-port-110
// step 4).
#include "game.h"

static char bump_t;
static bool tune_on;                    // the player has the SID
static char tune_wait;

static void race_voices(void)
{
    for (char i = 0; i < 25; i++)
        ((volatile char *)0xd400)[i] = 0;
    sid.fmodevol = 15;
    sid.voices[0].attdec = 0x00;
    sid.voices[0].susrel = 0xa0;        // sustain 10, release 0
    sid.voices[0].pwm = 0x0800;
    sid.voices[1].attdec = 0x09;
    sid.voices[1].susrel = 0x00;
    sid.voices[2].attdec = 0x09;
    sid.voices[2].susrel = 0x00;
}

void sound_init(void)
{
    char m = model;                     // the player's frequency table, once
    __asm {
        lda m
        jsr ASM_MUSIC_INIT
    }
    tune_on = false;
    race_voices();
}

void sound_frame(void)
{
    bool tune = state == ST_TITLE || state == ST_CLEAR;
    // The tune starts three frames after it is asked for: not in the step
    // that ends a stage, which has the most to do (on NTSC that step with
    // the tune's start ran past the next frame once a race).
    if (!tune)
        tune_wait = 0;
    else if (!tune_on && ++tune_wait < 3)
        tune = false;
    if (tune != tune_on)
    {
        tune_on = tune;
        if (tune)
            __asm { jsr ASM_MUSIC_RESTART }     // the tune from its top, the SID quiet
        else
            race_voices();
    }
    if (tune)
    {
        __asm { jsr ASM_MUSIC_PLAY }
        return;
    }
    if (state == ST_RACE || state == ST_GRID)
    {
        sid.voices[0].freq = 0x0400 + (car_speed[0] >> 1) + (car_speed[0] >> 3);
        sid.voices[0].ctrl = SID_CTRL_SAW | SID_CTRL_GATE;
    }
    else
        sid.voices[0].ctrl = SID_CTRL_SAW;
    if (bump_t && !--bump_t)
        sid.voices[2].ctrl = SID_CTRL_NOISE;
}

void sound_bump(void)
{
    if (tune_on)
        return;
    sid.voices[2].freq = 0x1800;
    sid.voices[2].ctrl = SID_CTRL_NOISE | SID_CTRL_GATE;
    bump_t = 6;
}

void sound_crash(void)
{
    if (tune_on)
        return;
    sid.voices[2].freq = 0x0800;        // lower and longer than a bump
    sid.voices[2].ctrl = SID_CTRL_NOISE | SID_CTRL_GATE;
    bump_t = 30;
}

void sound_beep(char high)
{
    if (tune_on)
        return;
    sid.voices[1].freq = high ? 0x4400 : 0x2200;
    sid.voices[1].ctrl = SID_CTRL_TRI;
    sid.voices[1].ctrl = SID_CTRL_TRI | SID_CTRL_GATE;
}

void sound_off(void)
{
    sid.voices[0].ctrl = 0;
    sid.voices[1].ctrl = 0;
    sid.voices[2].ctrl = 0;
    tune_on = false;                    // the title's tune starts on its next frame
}
