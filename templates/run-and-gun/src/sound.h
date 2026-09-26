// sound.h: FIREBASE's sound effects and the C side of the audio module
// (src/sound.asm: the tune and sfx_voice_takeover). Any module requests an
// effect with game.h's sfx(n): the effect takes voices 1 and 2 at the next
// frame IRQ, the tune plays on in voice 3, and the last request wins (a new
// request cuts the running effect). tools/mktune.py writes the effects; its
// numbers are these.
#ifndef SOUND_H
#define SOUND_H

#include "game.h"

enum {
    SFX_NONE,           // 0: ignored
    SFX_SHOT,           // 1: a bullet fired,       8 frames
    SFX_THROW,          // 2: a grenade thrown,    16 frames
    SFX_BLAST,          // 3: a grenade's blast,   48 frames
    SFX_KILL,           // 4: an enemy dies,       18 frames
    SFX_DEATH,          // 5: the soldier dies,    72 frames
    SFX_COUNT
};

void sound_setup(void);         // main, before kernel_init: PAL or NTSC tables and tempo
void sound_hold(void);          // before the redraw: the frame IRQ only counts its frame
void sound_release(void);       // after the redraw: the next frame IRQ plays the owed step first

#if AUTOPILOT
void sound_start(void);         // play_enter: counters from here, the stopwatch on
void sound_script(unsigned f);  // play frame f: the scripted requests (stand-ins for weapons)
void sound_stop(void);          // the freeze: the stopwatch off, worst and typical found
char sound_ok(void);            // the verdict's audio check: 1 pass
void sound_print(char *screen, char row, char col);
#endif

#pragma compile("sound.c")

#endif
