// frame_meter.c: see frame_meter.h for the contract.
#include "frame_meter.h"

unsigned meter_last, meter_worst, meter_typical, meter_frames, meter_zero;

#if FRAME_METER

#define RING 16                                 // frames in the typical mean

static unsigned ring[RING];
static unsigned long ring_sum;
static char ring_i;
static unsigned hold_at;
static char *cell;                              // first screen cell of the readout
static char *tint;                              // its colour RAM cell

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

void meter_init(unsigned screen, char row, char col, char colour, unsigned hold)
{
    unsigned off = 40 * row + col;
    cell = (char *)(screen + off);
    tint = (char *)(0xd800 + off);
    for (char i = 0; i < 20; i++)
        tint[i] = colour;
    hold_at = hold;
    cia2.icr = 0x01;                            // mask timer A's NMI (bit 7 clear: clear this mask bit only)
    cia2.cra = 0x00;
    cia2.ta = 0xffff;                           // the latch every METER_START reloads
    ring_i = cia2.icr;                          // read to clear a stale underflow flag
    METER_START;
    meter_zero = meter_read();                  // the empty bracket's own count
    meter_last = meter_worst = meter_typical = meter_frames = 0;
    ring_sum = 0;
    ring_i = 0;
    for (char i = 0; i < RING; i++)
        ring[i] = 0;
}

void meter_record(unsigned raw)
{
    if (hold_at && meter_frames >= hold_at)
        return;
    unsigned t = raw - meter_zero;
    meter_last = t;
    if (t > meter_worst)
        meter_worst = t;
    ring_sum = ring_sum - ring[ring_i] + t;
    ring[ring_i] = t;
    ring_i = (ring_i + 1) & (RING - 1);
    meter_frames++;
    meter_typical = meter_frames >= RING ? (unsigned)(ring_sum >> 4) : 0;
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
void meter_init(unsigned screen, char row, char col, char colour, unsigned hold) {}
void meter_record(unsigned raw) {}
void meter_print(void) {}

#endif
