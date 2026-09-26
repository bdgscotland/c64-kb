// sound.c: see sound.h. PLAN.md, "Audio", has the design and the figures.
#include "sound.h"

#define AUD_BYTE(a) (*(volatile char *)(a))

void sound_setup(void)
{
    AUD_BYTE(ASM_AUD_NTSC) = ntsc;
}

// The redraw starts at the band's tick (line 224) and ends on line 135 (PAL)
// or 181 (NTSC) of the next frame; the frame IRQ on line 250 lands inside it.
// Under the hold that IRQ spends 15 cycles on audio instead of a step; the
// owed step runs in the next frame IRQ, before that frame's own, so neither
// the redraw's lead nor the light frame after it pays for it.
void sound_hold(void)
{
    AUD_BYTE(ASM_AUD_HOLD) = 1;
}

void sound_release(void)
{
    AUD_BYTE(ASM_AUD_HOLD) = 0;
}

#if AUTOPILOT
#include "display.h"

// Scripted requests, { play frame, effect }: every effect, two cuts (KILL by
// a SHOT, a SHOT by a SHOT), and effects running across redraws (the BLAST
// and the DEATH). Frames and lengths: PLAN.md, "Audio". -dNO_SFX=1 empties
// it: tools/sidtrace.py compares the SID stores of the two builds.
#ifndef NO_SFX
static const unsigned sfx_frame[] = { 10, 30, 52, 110, 120, 140, 222, 224, 0xffff };
static const char sfx_what[] = { SFX_SHOT, SFX_THROW, SFX_BLAST, SFX_KILL, SFX_SHOT, SFX_DEATH, SFX_SHOT, SFX_SHOT, 0 };
#define WANT_STARTS 8
#define WANT_ENDS   6                   // KILL and the first of the last two SHOTs are cut
#else
static const unsigned sfx_frame[] = { 0xffff };
static const char sfx_what[] = { 0 };
#define WANT_STARTS 0
#define WANT_ENDS   0
#endif
#define AUD_MAX 1200                    // cycles one step may take (PLAN.md, "Audio")

static char sfx_next;
static unsigned steps0, steps1;
static char fc0, fc1, starts0, ends0;
unsigned aud_worst, aud_typical;
static char aud_n;

static unsigned steps_now(void)
{
    return *(volatile unsigned *)ASM_AUD_STEPS;
}

void sound_start(void)
{
    __asm { sei }
    steps0 = steps_now();
    fc0 = K_FRAME_CNT;
    starts0 = AUD_BYTE(ASM_FX_STARTS);
    ends0 = AUD_BYTE(ASM_FX_ENDS);
    AUD_BYTE(ASM_AUD_LOGI) = 0;
    AUD_BYTE(ASM_AUD_PROF) = 1;
    __asm { cli }
    sfx_next = 0;
}

void sound_script(unsigned f)
{
    if (f >= sfx_frame[sfx_next]) {
        sfx(sfx_what[sfx_next]);
        sfx_next++;
    }
}

static unsigned logged(char i)
{
    return AUD_BYTE(ASM_AUD_LOGLO + i) + (AUD_BYTE(ASM_AUD_LOGHI + i) << 8) - AUD_BYTE(ASM_AUD_CAL);
}

void sound_stop(void)
{
    __asm { sei }
    AUD_BYTE(ASM_AUD_PROF) = 0;
    steps1 = steps_now();
    fc1 = K_FRAME_CNT;
    __asm { cli }
    aud_n = AUD_BYTE(ASM_AUD_LOGI);
}

// Worst and median of the timed steps. Harness work, longer than a frame: it
// runs from the verdict, after first_fail has read the lost-frame count.
static void sound_stats(void)
{
    static char done;
    if (done)
        return;
    done = 1;
    aud_worst = 0;
    for (char i = 0; i < aud_n; i++) {
        unsigned c = logged(i);
        if (c > aud_worst) aud_worst = c;
    }
    // The median: the least value that at least half the steps do not exceed,
    // by bisection over 0..aud_worst.
    unsigned lo = 0, hi = aud_worst;
    while (lo < hi) {
        unsigned mid = (lo + hi) >> 1;
        char n = 0;
        for (char i = 0; i < aud_n; i++)
            if (logged(i) <= mid) n++;
        if (2 * (unsigned)n >= aud_n) hi = mid; else lo = mid + 1;
    }
    aud_typical = lo;
}

char sound_ok(void)
{
    sound_stats();
    char starts = AUD_BYTE(ASM_FX_STARTS) - starts0;
    char ends = AUD_BYTE(ASM_FX_ENDS) - ends0;
    return (char)(steps1 - steps0) == (char)(fc1 - fc0)     // one step a frame, none lost or doubled
        && AUD_BYTE(ASM_AUD_HOLD) == 0 && AUD_BYTE(ASM_AUD_OWED) == 0
        && starts == WANT_STARTS && ends == WANT_ENDS
        && aud_n > 200 && aud_worst <= AUD_MAX;
}

// "SND 08 06 W0000 T000": effects started and ended, worst and typical cycles a step.
void sound_print(char *screen, char row, char col)
{
    sound_stats();
    put_text(screen, row, col, "SND 00 00 W0000 T000");
    char *s = screen + row * 40 + col;
    put_dec(s + 4, (char)(AUD_BYTE(ASM_FX_STARTS) - starts0), 2);
    put_dec(s + 7, (char)(AUD_BYTE(ASM_FX_ENDS) - ends0), 2);
    put_dec(s + 11, aud_worst, 4);
    put_dec(s + 17, aud_typical, 3);
    text_colour(row, col, 20, TEXT_CRAM);
}
#endif
