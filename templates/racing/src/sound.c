// sound.c: the SID (c64-kb sid_voice_setup). Voice 1 is the engine, a
// sawtooth whose pitch follows the speed; voice 2 beeps the start lights;
// voice 3 is a noise burst on contact. No tune.
#include "game.h"

static char bump_t;

void sound_init(void)
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

void sound_frame(void)
{
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
    sid.voices[2].freq = 0x1800;
    sid.voices[2].ctrl = SID_CTRL_NOISE | SID_CTRL_GATE;
    bump_t = 6;
}

void sound_beep(char high)
{
    sid.voices[1].freq = high ? 0x4400 : 0x2200;
    sid.voices[1].ctrl = SID_CTRL_TRI;
    sid.voices[1].ctrl = SID_CTRL_TRI | SID_CTRL_GATE;
}

void sound_off(void)
{
    sid.voices[0].ctrl = 0;
    sid.voices[1].ctrl = 0;
    sid.voices[2].ctrl = 0;
}
