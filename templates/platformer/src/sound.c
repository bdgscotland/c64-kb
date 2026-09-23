// sound.c: sound effects on SID voice 3, which the tune never touches
// (c64-kb sfx_engine_beside_music). An effect is a waveform, a start pitch
// and a pitch slide a frame; sfx_update runs once a frame after the tune.
#include "game.h"
#include <c64/sid.h>

struct Effect { char freq_hi, wave, frames, attdec, susrel; signed char slide; };

static const struct Effect effect[] = {
    { 0x10, SID_CTRL_RECT, 10, 0x00, 0x90,  3 },    // jump: a rising square
    { 0x38, SID_CTRL_TRI,   8, 0x00, 0x90,  6 },    // coin: a quick high chirp
    { 0x0c, SID_CTRL_NOISE, 8, 0x00, 0x90, -1 },    // stomp: a noise thump
    { 0x28, SID_CTRL_SAW,  40, 0x00, 0xa0, -1 },    // hurt: a falling saw
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
