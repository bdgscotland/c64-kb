// sound.h: an original two-voice tune (voices 1 and 2) and a table-driven
// effects engine on voice 3 (c64-kb techniques sid_play_routine_pattern and
// sfx_engine_beside_music). Call music_play() then sfx_update() once a frame.
#ifndef SOUND_H
#define SOUND_H

#define SFX_DIG   0
#define SFX_PUSH  1
#define SFX_LAND  2
#define SFX_GEM   3
#define SFX_OPEN  4
#define SFX_BOOM  5

void sound_init(bool ntsc);     // silence the SID, pick the note table
void music_play(void);          // one frame of the tune (the "play" call)
void sfx_play(char fx);         // start an effect; a higher-priority one keeps the voice
void sfx_update(void);          // one frame of the effect, after music_play
void sound_mute(bool on);       // volume 0 during disk calls

#pragma compile("sound.c")

#endif
