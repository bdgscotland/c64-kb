// sound.c: the tune and the effects. The tune is original: an arpeggiated
// A minor, F, G, E loop, lead on voice 1 (pulse), bass on voice 2
// (triangle). Note lengths are in frames, so on NTSC it plays 20 % faster
// (c64-kb pitfall pal_ntsc_tempo_mismatch); the pitches come from the
// model's own table, so they are right on both.
#include "sound.h"
#include <c64/sid.h>

#include "gen_notes.h"

#define REST 0xff

// Note numbers are semitones above C1 (gen_notes.h): 45 is A4.
static const char lead[32] = {
    45, 48, 52, 48, 45, 52, 57, 52,             // A minor
    41, 45, 48, 45, 53, 48, 45, 41,             // F
    43, 47, 50, 47, 55, 50, 47, 43,             // G
    40, 44, 47, 44, 52, 47, 44, REST            // E
};
static const char bass[16] = {
    21, 21, 28, 21,  17, 17, 24, 17,  19, 19, 26, 19,  16, 16, 23, 16
};
#define LEAD_LEN 6                              // frames a lead note lasts
#define BASS_LEN 12

static const unsigned *notes;
static char lead_pos, lead_timer, bass_pos, bass_timer;
static char volume = 15;

// ---- effects on voice 3 ---------------------------------------------------
// One row per frame: frequency and control byte; the row with ctrl SFX_END
// ends the effect and frees the voice. The first row of each effect is
// TEST + GATE, the hard restart the sfx-engine recipe uses.
#define SFX_END 0xff
typedef struct { unsigned freq; char ctrl; } SfxRow;
typedef struct { char prio; char attdec; char susrel; unsigned pw; const SfxRow *rows; } Sfx;

static const SfxRow dig_rows[] = {
    { 0x3000, SID_CTRL_TEST | SID_CTRL_GATE }, { 0x3000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x2400, SID_CTRL_NOISE }, { 0, SFX_END } };
static const SfxRow push_rows[] = {
    { 0x0400, SID_CTRL_TEST | SID_CTRL_GATE }, { 0x0400, SID_CTRL_RECT | SID_CTRL_GATE },
    { 0x0380, SID_CTRL_RECT | SID_CTRL_GATE }, { 0x0300, SID_CTRL_RECT }, { 0, SFX_END } };
static const SfxRow land_rows[] = {
    { 0x0800, SID_CTRL_TEST | SID_CTRL_GATE }, { 0x0800, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x0600, SID_CTRL_NOISE | SID_CTRL_GATE }, { 0x0400, SID_CTRL_NOISE }, { 0, SFX_END } };
static const SfxRow gem_rows[] = {
    { 0x2000, SID_CTRL_TEST | SID_CTRL_GATE }, { 0x2000, SID_CTRL_RECT | SID_CTRL_GATE },
    { 0x2800, SID_CTRL_RECT | SID_CTRL_GATE }, { 0x3000, SID_CTRL_RECT | SID_CTRL_GATE },
    { 0x4000, SID_CTRL_RECT | SID_CTRL_GATE }, { 0x4000, SID_CTRL_RECT }, { 0, SFX_END } };
static const SfxRow open_rows[] = {
    { 0x1000, SID_CTRL_TEST | SID_CTRL_GATE }, { 0x1000, SID_CTRL_TRI | SID_CTRL_GATE },
    { 0x1400, SID_CTRL_TRI | SID_CTRL_GATE }, { 0x1800, SID_CTRL_TRI | SID_CTRL_GATE },
    { 0x2000, SID_CTRL_TRI | SID_CTRL_GATE }, { 0x2800, SID_CTRL_TRI | SID_CTRL_GATE },
    { 0x3000, SID_CTRL_TRI | SID_CTRL_GATE }, { 0x4000, SID_CTRL_TRI | SID_CTRL_GATE },
    { 0x4000, SID_CTRL_TRI }, { 0, SFX_END } };
static const SfxRow boom_rows[] = {
    { 0x1800, SID_CTRL_TEST | SID_CTRL_GATE }, { 0x1800, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x1400, SID_CTRL_NOISE | SID_CTRL_GATE }, { 0x1000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x0c00, SID_CTRL_NOISE | SID_CTRL_GATE }, { 0x0a00, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x0800, SID_CTRL_NOISE }, { 0x0600, SID_CTRL_NOISE }, { 0x0500, SID_CTRL_NOISE },
    { 0x0400, SID_CTRL_NOISE }, { 0x0300, SID_CTRL_NOISE }, { 0, SFX_END } };

static const Sfx effects[6] = {
    { 0, SID_ATK_2 | SID_DKY_24,  0x00 | SID_DKY_48,  0x0800, dig_rows  },
    { 1, SID_ATK_2 | SID_DKY_48,  0x40 | SID_DKY_114, 0x0400, push_rows },
    { 1, SID_ATK_2 | SID_DKY_48,  0x40 | SID_DKY_114, 0x0800, land_rows },
    { 2, SID_ATK_2 | SID_DKY_48,  0x80 | SID_DKY_168, 0x0800, gem_rows  },
    { 3, SID_ATK_2 | SID_DKY_114, 0xa0 | SID_DKY_204, 0x0800, open_rows },
    { 4, SID_ATK_2 | SID_DKY_114, 0xf0 | SID_DKY_750, 0x0800, boom_rows }
};

static const Sfx *sfx_cur;                      // the effect that owns voice 3, or 0
static const SfxRow *sfx_row;

void sound_init(bool ntsc)
{
    for (char r = 0; r < 25; r++)
        ((volatile char *)0xd400)[r] = 0;       // silence first: no pops
    notes = ntsc ? note_ntsc : note_pal;
    sid.voices[0].pwm = 0x0600;
    sid.voices[0].attdec = SID_ATK_2 | SID_DKY_114;
    sid.voices[0].susrel = 0x60 | SID_DKY_168;
    sid.voices[1].attdec = SID_ATK_2 | SID_DKY_168;
    sid.voices[1].susrel = 0x80 | SID_DKY_114;
    lead_pos = bass_pos = 0;
    lead_timer = bass_timer = 0;
    sfx_cur = nullptr;
    sid.fmodevol = volume;
}

// One voice of the tune: a new note when the timer runs out, the gate
// released on the note's last frame so the next one retriggers.
static void voice_step(char v, char note, char *timer, char len, char wave)
{
    if (*timer == 0)
    {
        *timer = len;
        if (note != REST)
        {
            sid.voices[v].freq = notes[note];
            sid.voices[v].ctrl = wave | SID_CTRL_GATE;
        }
    }
    if (--*timer == 0)
        sid.voices[v].ctrl = wave;
}

void music_play(void)
{
    char was = lead_timer;
    voice_step(0, lead[lead_pos], &lead_timer, LEAD_LEN, SID_CTRL_RECT);
    if (was == 1)
        lead_pos = (lead_pos + 1) & 31;
    was = bass_timer;
    voice_step(1, bass[bass_pos], &bass_timer, BASS_LEN, SID_CTRL_TRI);
    if (was == 1)
        bass_pos = (bass_pos + 1) & 15;
    sid.fmodevol = volume;
}

void sfx_play(char fx)
{
    const Sfx *e = effects + fx;
    if (sfx_cur && e->prio < sfx_cur->prio)
        return;                                 // a more important effect keeps the voice
    sfx_cur = e;
    sfx_row = e->rows;
    sid.voices[2].attdec = e->attdec;
    sid.voices[2].susrel = e->susrel;
    sid.voices[2].pwm = e->pw;
}

void sfx_update(void)
{
    if (!sfx_cur)
        return;
    if (sfx_row->ctrl == SFX_END)
    {
        sfx_cur = nullptr;
        return;
    }
    sid.voices[2].freq = sfx_row->freq;
    sid.voices[2].ctrl = sfx_row->ctrl;
    sfx_row++;
}

void sound_mute(bool on)
{
    volume = on ? 0 : 15;
    sid.fmodevol = volume;
    if (on)
    {
        sid.voices[0].ctrl = 0;                 // gates off: nothing drones through a disk call
        sid.voices[1].ctrl = 0;
        sid.voices[2].ctrl = 0;
    }
}
