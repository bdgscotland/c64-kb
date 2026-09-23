// sound.c: see sound.h. The SID registers are write-only (pitfall
// sid_write_only_registers): nothing here reads them back.
#include "sound.h"
#include "gen_world.h"
#include <c64/sid.h>

#define NOTE_C5 0
#define NOTE_E5 1
#define NOTE_G5 2
#define NOTE_C6 3
#define NOTE_A4 4
#define END     0xff

static const unsigned *notes;                   // note_pal or note_ntsc (gen_world.h)
static const char chime[] = { NOTE_G5, NOTE_C6, END };
static const char fanfare[] = { NOTE_C5, NOTE_E5, NOTE_G5, NOTE_C6, NOTE_G5, NOTE_C6, END };
static const char *tune;                        // voice 2's notes, 0 when idle
static char tune_wait, click_wait;

void sound_init(bool ntsc)
{
    notes = ntsc ? note_ntsc : note_pal;
    sid.fmodevol = 0x0f;
    sid.voices[0].ctrl = 0;
    sid.voices[0].attdec = 0x00;                // click: instant attack, short decay
    sid.voices[0].susrel = 0x00;
    sid.voices[0].freq = 0x2000;
    sid.voices[1].ctrl = 0;
    sid.voices[1].attdec = 0x09;
    sid.voices[1].susrel = 0x00;
    sid.voices[1].pwm = 0x0800;
    tune = nullptr;
}

void sound_click(void)
{
    sid.voices[0].ctrl = 0x81;                  // noise, gate on
    click_wait = 1;
}

static void play(const char *t)
{
    tune = t;
    tune_wait = 0;
}

void sound_chime(void) { play(chime); }
void sound_fanfare(void) { play(fanfare); }

void sound_update(void)
{
    if (click_wait && !--click_wait)
        sid.voices[0].ctrl = 0x80;              // gate off
    if (!tune || tune_wait--)
        return;
    if (*tune == END)
    {
        sid.voices[1].ctrl = 0x40;
        tune = nullptr;
        return;
    }
    sid.voices[1].ctrl = 0x40;                  // gate off, then on with the new pitch
    sid.voices[1].freq = notes[*tune++];
    sid.voices[1].ctrl = 0x41;                  // pulse, gate on
    tune_wait = 6;
}

void sound_mute(bool on)
{
    sid.fmodevol = on ? 0 : 0x0f;
}
