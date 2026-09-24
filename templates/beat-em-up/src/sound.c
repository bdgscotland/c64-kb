// sound.c: hit effects on SID voice 3, which the tune never touches
// (c64-kb sfx_engine_beside_music). An effect is a waveform, a start pitch
// and a pitch slide a frame; sfx_update runs once a frame after the tune.
// A new effect cuts the last one.
#include "game.h"
#include <c64/sid.h>

struct Effect { char freq_hi, wave, frames, attdec, susrel; signed char slide; };

static const struct Effect effect[] = {
    { 0x30, SID_CTRL_NOISE,  4, 0x00, 0x40, -4 },   // swing: a short hiss
    { 0x08, SID_CTRL_NOISE,  8, 0x00, 0x90, -1 },   // hit: a low thump
    { 0x20, SID_CTRL_SAW,   20, 0x00, 0xa0, -1 },   // knock-down: a falling saw
    { 0x10, SID_CTRL_RECT,  10, 0x00, 0x90,  3 },   // jump: a rising square
    { 0x06, SID_CTRL_NOISE, 40, 0x00, 0xa9,  0 },   // KO: a long crash
};

static char sfx_left, sfx_hi, sfx_wave;
static signed char sfx_slide;

void sfx_play(char id)
{
    const struct Effect *e = &effect[id];
    sid.voices[2].ctrl = 0;                     // gate off: the new effect restarts the envelope
    sid.voices[2].freq = (unsigned)e->freq_hi << 8;
    sid.voices[2].pwm = 0x0800;
    sid.voices[2].attdec = e->attdec;
    sid.voices[2].susrel = e->susrel;
    sid.voices[2].ctrl = e->wave | SID_CTRL_GATE;
    sfx_left = e->frames;
    sfx_hi = e->freq_hi;
    sfx_wave = e->wave;
    sfx_slide = e->slide;
}

void sfx_update(void)
{
    if (!sfx_left)
        return;
    sfx_hi += sfx_slide;
    sid.voices[2].freq = (unsigned)sfx_hi << 8;
    if (--sfx_left == 0)
        sid.voices[2].ctrl = sfx_wave;          // gate off: release
}
