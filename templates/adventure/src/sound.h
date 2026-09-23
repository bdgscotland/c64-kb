// sound.h: a key click on voice 1 and short tunes on voice 2 (c64-kb technique
// sid_voice_setup). One sound_update() a frame steps them. No music: text
// adventures of the period mostly had none, and the frame is the printer's.
#ifndef SOUND_H
#define SOUND_H

void sound_init(bool ntsc);
void sound_click(void);
void sound_chime(void);         // the score went up
void sound_fanfare(void);       // the ending
void sound_update(void);
void sound_mute(bool on);       // around disk calls

#pragma compile("sound.c")

#endif
