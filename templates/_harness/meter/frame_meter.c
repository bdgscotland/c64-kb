// frame_meter.c: see frame_meter.h for the contract.
#include "frame_meter.h"
#include <c64/vic.h>

unsigned meter_last, meter_worst, meter_typical, meter_frames, meter_zero;

#if FRAME_METER

static unsigned sample[255];                    // one per recorded frame
static unsigned acc;                            // this frame's sum so far
static char hold_at;
static char *cell;                              // first screen cell of the readout

// Stops the timer before reading, so the two byte reads cannot straddle a
// borrow. Bit 0 of $DD0D says the timer passed zero since the last read:
// more than 65,535 cycles, so the count saturates. Reading $DD0D clears it.
__noinline unsigned meter_read(void)
{
    cia2.cra = 0x00;
    unsigned t = 0xffff - cia2.ta;
    if (cia2.icr & 0x01)
        t = 0xffff;
    return t;
}

void meter_init(unsigned screen, char row, char col, char colour, char hold)
{
    unsigned off = 40 * row + col;
    cell = (char *)(screen + off);
    char *tint = (char *)(0xd800 + off);
    for (char i = 0; i < 20; i++)
        tint[i] = colour;
    hold_at = hold ? hold : 1;
    cia2.icr = 0x01;                            // mask timer A's NMI (bit 7 clear: clear this mask bit only)
    cia2.cra = 0x00;
    cia2.ta = 0xffff;                           // the latch every METER_START reloads
    acc = cia2.icr;                             // read to clear a stale underflow flag
    meter_zero = 0xffff;
    __asm volatile { php
                     sei }                      // no interrupt inside the calibration
    for (char k = 0; k < 4; k++)                // the empty bracket, at line 0: no DMA there
    {
        while (vic.raster == 0) ;
        while (vic.raster != 0) ;
        METER_START;
        unsigned z = meter_read();
        if (z < meter_zero)
            meter_zero = z;
    }
    __asm volatile { plp }
    meter_last = meter_worst = meter_typical = meter_frames = 0;
    acc = 0;
}

// Saturates at 65,535: a frame whose brackets sum past it reads 65,535,
// not the sum modulo 65,536.
void meter_add(unsigned raw)
{
    unsigned d = raw - meter_zero;
    if (acc > 65535u - d)
        acc = 65535u;
    else
        acc += d;
}

// The median of the recorded frames by selection (Wirth's FIND, a
// quicksort that follows only the half holding the middle): a few hundred
// compares for 255 frames. The insertion sort it replaces took n * n / 4 and
// held a platformer's main loop for about 94 frames (1.85M cycles) at the
// moment recording stopped. Same value: the element a full sort would put
// in the middle.
static unsigned select_median(void)
{
    int lo = 0, hi = hold_at - 1, k = hold_at >> 1;
    while (lo < hi)
    {
        unsigned x = sample[k];
        int i = lo, j = hi;
        do
        {
            while (sample[i] < x)
                i++;
            while (x < sample[j])
                j--;
            if (i <= j)
            {
                unsigned t = sample[i];
                sample[i] = sample[j];
                sample[j] = t;
                i++;
                j--;
            }
        } while (i <= j);
        if (j < k)
            lo = i;
        if (k < i)
            hi = j;
    }
    return sample[k];
}

void meter_frame(void)
{
    unsigned t = acc;
    acc = 0;
    if (meter_frames >= hold_at)
        return;
    meter_last = t;
    if (t > meter_worst)
        meter_worst = t;
    sample[meter_frames++] = t;
    if (meter_frames == hold_at)
        meter_typical = select_median();
}

void meter_stop(unsigned raw)
{
    meter_add(raw);
    meter_frame();
}

static const unsigned pow10[4] = {10000, 1000, 100, 10};

static char *put5(char *p, char letter, unsigned v)
{
    *p++ = letter;
    for (char i = 0; i < 4; i++)
    {
        char d = 0x30;
        while (v >= pow10[i]) { v -= pow10[i]; d++; }
        *p++ = d;
    }
    *p++ = 0x30 + (char)v;
    return p;
}

void meter_print(void)
{
    char *p = put5(cell, 6, meter_frames);      // screen code 6 = F
    *p++ = 0x20;
    p = put5(p, 23, meter_worst);               // 23 = W
    *p++ = 0x20;
    put5(p, 20, meter_typical);                 // 20 = T
}

#else

unsigned meter_read(void) { return 0; }
void meter_init(unsigned screen, char row, char col, char colour, char hold) {}
void meter_add(unsigned raw) {}
void meter_frame(void) {}
void meter_stop(unsigned raw) {}
void meter_print(void) {}

#endif
