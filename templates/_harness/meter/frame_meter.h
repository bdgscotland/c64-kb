// frame_meter.h: CIA2 timer A frame meter for Oscar64 starters.
//
//   meter_init(0x0400, 24, 20, 1, 200);   // screen, row, column, colour, frames to record
//   for (;;) {
//       wait_frame();
//       METER_START;
//       ... one frame of work ...
//       METER_STOP;
//       meter_print();
//   }
//
// It times the bracket with CIA2 timer A counting phi2 cycles, so the figure
// is wall time: badline and sprite DMA steals and any interrupt that lands
// inside the bracket are counted. The empty bracket's own count is measured
// once in meter_init and subtracted.
//
// worst   = the largest bracket over the recorded frames.
// typical = the mean of the last 16 recorded frames; 0 until 16 are recorded.
// frames  = how many were recorded; recording stops at `hold` (0 = never),
//           so a pinned screenshot taken after that shows fixed figures.
//
// meter_print writes "F00200 W01234 T01100" (20 cells) at the row and column
// given, in the power-on character set. check.py reads it back.
//
// Timer choice: CIA2 timer A. The KERNAL IRQ uses CIA1 timer A and the KERNAL
// serial (disk) routines write CIA1 timer B (issue #35), so neither collides.
// CIA2 timer A is the KERNAL's RS-232 bit timer: do not open device 2 while
// the meter runs. meter_init masks timer A's NMI only ($DD0D = $01) and
// leaves CIA2's other sources as they were.
//
// FRAME_METER defaults to AUTOPILOT: in a build without it METER_START,
// METER_STOP and meter_print compile to nothing and the release carries none
// of it. Build with -dFRAME_METER=1 to keep the meter in a manual build.
#ifndef FRAME_METER_H
#define FRAME_METER_H

#include <c64/cia.h>

#ifndef AUTOPILOT
#define AUTOPILOT 0
#endif
#ifndef FRAME_METER
#define FRAME_METER AUTOPILOT
#endif

extern unsigned meter_last, meter_worst, meter_typical, meter_frames, meter_zero;

void meter_init(unsigned screen, char row, char col, char colour, unsigned hold);
unsigned meter_read(void);
void meter_record(unsigned raw);
void meter_print(void);

#if FRAME_METER
#define METER_START (cia2.cra = 0x11)          // force-load $FFFF, start, count phi2
#define METER_STOP  meter_record(meter_read())
#else
#define METER_START
#define METER_STOP
#endif

#pragma compile("frame_meter.c")

#endif
