// frame_meter.h: CIA2 timer A frame meter for Oscar64 starters.
//
//   meter_init(0x0400, 24, 20, 1, 144);   // screen, row, column, colour, frames to record
//   for (;;) {
//       wait_frame();
//       METER_START;
//       ... one frame of work ...
//       METER_STOP;                        // records this frame
//       ... grading, logging: outside the bracket ...
//       meter_print();
//   }
//
// Work split over several places in a frame (a main loop and IRQ handlers)
// is summed: METER_START ... METER_PAUSE as often as needed, and
// METER_STOP (or meter_frame()) once, to record the frame's sum. Brackets
// must not nest: an IRQ that brackets its own work must not land inside
// another bracket.
//
// It times with CIA2 timer A counting phi2 cycles, so a figure is wall
// time: badline and sprite DMA steals and any interrupt that lands inside a
// bracket are counted. The empty bracket's own count is measured at init
// (the least of four tries, each at raster line 0, where no DMA falls) and
// subtracted from every bracket.
//
// frames  = frames recorded. Recording stops at `hold` (1 to 255): make hold
//           the play frames of the autopilot script, so no idle frame counts.
// worst   = the largest recorded frame.
// typical = the median of the recorded frames, found by selection when recording
//           stops (0 until then): a cost some play frame actually took, with
//           at least half the frames at or under it. This is the KB's
//           cycles_per_frame_typical (CONVENTIONS-techniques.md) when the
//           recorded frames are play.
//
// meter_print writes "F00144 W01234 T01100" (20 cells) at the row and column
// given; the character set in use must hold 0-9, F, W and T at their screen
// codes. check.py reads it back.
//
// Timer choice: CIA2 timer A. The KERNAL IRQ uses CIA1 timer A and the KERNAL
// serial (disk) routines write CIA1 timer B (issue #35), so neither collides.
// CIA2 timer A is the KERNAL's RS-232 bit timer: do not open device 2 while
// the meter runs. meter_init masks timer A's NMI only ($DD0D = $01) and
// leaves CIA2's other sources as they were.
//
// FRAME_METER defaults to AUTOPILOT: in a build without it the macros and
// meter_print compile to nothing and the release carries none of it. Build
// with -dFRAME_METER=1 to keep the meter in a manual build.
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

void meter_init(unsigned screen, char row, char col, char colour, char hold);
unsigned meter_read(void);
void meter_add(unsigned raw);
void meter_frame(void);
void meter_stop(unsigned raw);
void meter_print(void);

#if FRAME_METER
#define METER_START (cia2.cra = 0x11)          // force-load $FFFF, start, count phi2
#define METER_PAUSE meter_add(meter_read())    // add this bracket to the frame's sum
#define METER_STOP  meter_stop(meter_read())   // add it, then record the frame
#else
#define METER_START
#define METER_PAUSE
#define METER_STOP
#endif

#pragma compile("frame_meter.c")

#endif
