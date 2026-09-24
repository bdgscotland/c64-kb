---
category: cia
---

<!-- doc-type: pitfall-reference -->

# CIA Pitfalls

Pitfalls in the two 6526 CIAs other than keyboard and joystick reading
(those are in `pitfalls/input.md`). The entries here are about the
chip's own sequencing rules: registers whose *order* of access matters.
Code that touches them in the wrong order gets a wrong answer and no
error.

---

## tod_read_order_latch — Read TOD hours first and tenths last; write hours first and tenths last

**Severity:** high
**Region:** both
**Triggered by registers:** DC08, DC0B, DC0F
**Triggered by techniques:** tod_alarm_interrupt

### Symptom

Four failures, one cause. Which one appears depends on the order in
which the code touched `$DC08`-`$DC0B`.

1. **A tenths digit that lags.** A clock display polled once a second
   shows seconds, minutes and hours moving while the tenths digit is
   always one poll stale, or sits on a value that makes no sense next to
   the seconds. The code reads tenths first and hours last.
2. **A frozen clock.** Every read of the four TOD registers returns the
   same time, forever, although the game has been running for minutes.
   Somewhere the code read `$DC0B` (often a lone peek at the hours or
   the AM/PM bit) and never read `$DC08` afterwards.
3. **A clock that never starts.** The program sets the time and the
   registers read back exactly what was written, an hour later. The
   code wrote tenths first and hours last.
4. **A time that will not set, and an alarm interrupt later.** The
   program follows "set `$DC0F` bit 7, then write hours..tenths"; the
   clock keeps its old time and keeps running, and some time later ICR
   bit 2 sets. The writes armed the alarm, not the clock.

Until 2026-09-21 two pages in this repository led straight into these:
`hardware/cia-reference.md` had the first three the wrong way round (a
read of tenths latched, a read of hours released, a write of hours
started the clock), and the CIA1 quick-lookup row in
`hardware/c64-registers-reference.md` prescribed the fourth (set the
clock with bit 7 of `$DC0F` *set*). Both are corrected; the measurement
that corrected them is below.

### Mechanism

The 6526's time-of-day clock is four BCD registers: tenths (`$DC08`),
seconds (`$DC09`), minutes (`$DC0A`), and hours with the AM/PM flag in
bit 7 (`$DC0B`). They count a 50 Hz or 60 Hz input on the chip's TOD
pin. Two sequencing rules are built into the chip. Both key on the
*hours* register at one end and the *tenths* register at the other:

- **Reading.** A read of `$DC0B` latches all four registers: from that
  moment every read of `$DC08`-`$DC0B` returns the values as they stood
  at the hours read. The latch is released by a read of `$DC08`. The
  counter keeps running underneath the latch; only what a read returns
  is frozen. This exists so that a four-byte read can never straddle a
  carry (59.9 to 00.0), provided it starts at hours and ends at tenths.
- **Writing.** A write to `$DC0B` stops the clock. It does not run
  again until `$DC08` is written. This exists so that a four-byte
  *write* cannot be overtaken by a tick halfway through, provided it
  starts at hours and ends at tenths. Written the other way round, the
  clock is stopped by the last write and stays stopped.
- **Clock or alarm.** Bit 7 of `$DC0F` (CRB, ALARM) chooses what a TOD
  *write* lands in: 0 = the clock, 1 = the alarm. Reads always return
  the clock, whatever bit 7 says (the datasheet's statement; the read
  side of that was not measured here). The alarm registers sit at the
  same four addresses, so "set the clock with bit 7 = 1" programs the
  alarm and leaves the clock alone: neither set nor stopped, in VICE
  (rows E, G and H below). One caveat on the "nor
  stopped": the datasheet's "stopped whenever a write to the Hours
  register occurs" is not conditioned on bit 7, so a 6526 may pause
  the clock on an alarm-side hours write until the alarm-side tenths
  write that follows it a few microseconds later. That is not
  measurable here and makes no difference to a four-write sequence;
  it would matter only to code that writes the alarm's hours alone.
- **Rate.** Bit 7 of `$DC0E` (CRA, TODIN) tells the chip whether the
  TOD pin carries 50 Hz (1) or 60 Hz (0), i.e. whether to divide by 5
  or by 6 to make a tenth. The KERNAL does not set it:
  IOINIT writes `$08` to `$DC0E` (`LDA #$08` at `$FDAE`, `STA $DC0E`
  at `$FDB0`, in KERNAL 901227-03) and the same `$08` to `$DD0E` at
  `$FDB3`, which leaves bit 7 clear on both CIAs, and the
  region-dependent timer setup at `$FF6E` reads `$DC0E` back, masks
  with `#$80` and ORs in `$11`, which preserves bit 7 and never sets
  it. On a PAL machine the TOD therefore counts a 50 Hz
  input with the 60 Hz divider, five-sixths of true speed, until a
  program sets the bit. (ROM bytes read from the 901227-03 image,
  rung 1; an earlier version of this page placed the `LDA`/`STA` pair
  at `$FDB0` alone; the five-sixths is arithmetic from the datasheet's
  divider, and the VICE run in the measurement section below confirms
  the ratio.)

The first three bullets are what the MOS 6526 datasheet says in its
"Time of Day Clock" section, and what VICE x64sc 3.10 does when
measured (rung 1, below). Two pages in this repository said otherwise,
and code written from them put the read latch and the write halt on the
wrong registers.

One consequence follows from the rules, not from a measurement: the
latch is chip state, not per-caller
state. If an interrupt handler reads `$DC08` while the main loop is
between its hours read and its tenths read, the main loop's latch is
gone and its remaining reads are live: a torn time with the correct
order on both sides. Keep all TOD reads in one context, or bracket the
four reads with `SEI`/`CLI` when an IRQ handler also reads the clock.
`SEI` does not hold off an NMI, so an NMI handler (RESTORE, or anything
raised through CIA2) must leave `$DC08`-`$DC0B` alone altogether.

### Fix

- **Read** in the order `$DC0B`, `$DC0A`, `$DC09`, `$DC08`: hours
  first, tenths last. To read hours alone, read `$DC08` afterwards to
  drop the latch. Any other single register can be read on its own.
- **Write** in the order `$DC0B`, `$DC0A`, `$DC09`, `$DC08` with
  `$DC0F` bit 7 = 0. The clock is stopped from the first write to the
  last and starts at exactly the time written. To program the alarm,
  do the same four writes with bit 7 = 1, then put bit 7 back to 0
  before any code that expects to set the clock.
- **Set the rate**: `$DC0E` bit 7 = 1 on a PAL machine (50 Hz
  mains), 0 on NTSC (60 Hz). The KERNAL leaves it 0 on both.
- Values are BCD; the hours register carries AM/PM in bit 7.

### Worked example

The first two routines are the orders an earlier version of the two
hardware pages implied; the last two are the correct ones. This fence
is assembled by `npm run check:listings`.

```kick
// WRONG — tenths first "to latch", hours last "to release" (the order
// cia-reference.md gave before 2026-09-21). On the first pass nothing
// is latched while these four reads happen, so a carry between them
// tears the time. The hours read at the end DOES latch, so on every
// later pass the first read returns the tenths as they stood at the
// previous pass's hours read and then releases; only the last three
// reads of each pass are live.
read_tod_wrong:
        lda $dc08
        sta tod_tenths
        lda $dc09
        sta tod_secs
        lda $dc0a
        sta tod_mins
        lda $dc0b           // latches all four here; nothing releases it
        sta tod_hours
        rts

// WRONG — "$DC0F bit 7 = 1, then write hours..tenths" (the quick-lookup
// row before 2026-09-21). Bit 7 = 1 routes the writes to the ALARM; the
// clock is neither set nor stopped (rows E and G in the measurement).
set_tod_wrong:
        lda $dc0f
        ora #$80
        sta $dc0f
        lda new_hours
        sta $dc0b
        lda new_mins
        sta $dc0a
        lda new_secs
        sta $dc09
        lda new_tenths
        sta $dc08           // the alarm is armed for new_*; the clock never changed
        rts

// RIGHT — hours first (latches all four), tenths last (releases).
read_tod:
        lda $dc0b
        sta tod_hours
        lda $dc0a
        sta tod_mins
        lda $dc09
        sta tod_secs
        lda $dc08           // releases the latch; the counter never stopped
        sta tod_tenths
        rts

// RIGHT — mains rate in CRA bit 7, clock (not alarm) in CRB bit 7,
// hours first (stops the clock), tenths last (starts it at the set time).
set_tod:
        lda $dc0e
        ora #$80            // TODIN = 1: 50 Hz mains (PAL). NTSC: and #$7f
        sta $dc0e
        lda $dc0f
        and #$7f            // ALARM = 0: the four writes below reach the clock
        sta $dc0f
        lda new_hours       // BCD, bit 7 = PM
        sta $dc0b           // clock stops
        lda new_mins
        sta $dc0a
        lda new_secs
        sta $dc09
        lda new_tenths
        sta $dc08           // clock starts
        rts

tod_hours:  .byte 0
tod_mins:   .byte 0
tod_secs:   .byte 0
tod_tenths: .byte 0
new_hours:  .byte $09       // 09:41:23.5 AM
new_mins:   .byte $41
new_secs:   .byte $23
new_tenths: .byte $05
```

### How this was measured

Instrument: VICE x64sc 3.10 (`*** VICE Version 3.10 ***` in its own
startup log; the Homebrew cellar path says the same), headless, `-warp`,
`-autostartprgmode 1`, `-limitcycles 20000000` (16,000,000 until three
rows were added on 2026-09-22; the probe now waits about 12 s of C64
time after boot), `-exitscreenshot`. PAL
(VICE's default C64C: 8565, 8580, CIA 8521) with CRA bit 7 = 1; NTSC (`-model ntsc`, 6567R8) with CRA bit
7 = 0. Nothing here was run on a 6526 on a bench. An earlier version said
the PAL run was a 6569; `x64sc -default` is the C64C, whose CIAs are 8521s,
while the NTSC run's are 6526s. VICE derives the TOD
tick from emulated cycles, not from the host clock: the probe runs
under `-warp` and the clock still advances 1.5 s in 75 PAL frames, and
`src/core/ciacore.c` in the VICE tree schedules the tick as an alarm
`todticks` cycles apart. The readings below are therefore about the
chip model VICE implements, at emulated speed.

The probe (listing below, exactly as run) clears the screen, sets the
clock to 00:00:00.0 in the correct order, waits a known number of
frames by watching `$D012`, and stores a reverse-space (`$A0`) on a
fixed screen row at the column equal to the tenths value it read. One
test per row, so the screenshot is the result. Decoded with PIL,
which first finds the display area as the run of non-border pixels
(border red, background blue): the PAL screenshot is 384×272 with the
display at y 35-234, so screen row 0 is at PNG y = 35, and the NTSC one
384×247 with the display at y 23-222, row 0 at y = 23; the display
spans x 32-351 in both, so screen column c is x = 32 + 8c (this geometry,
the palette values per model and a decode snippet are now collected in
`../runtime/vice-reference.md`, "Reading the exit screenshot"). The decoder
then demands exactly one lit cell per test row, all 64 of its pixels
lit, and no lit cell anywhere else on the screen; every run below
passed that. The runs (2026-09-22, after rows G, H and I were added;
the first seven rows re-measured and reading what the page's first
version had):

| Row | Test | PAL 1 | PAL 2 | PAL 3 | NTSC 1 | NTSC 2 | Reading |
|-----|------|------:|------:|------:|-------:|-------:|---------|
| 6 | **I** hours written (clock stopped at 0); tenths *read* at ~0.3 s; tenths read again ~1.5 s later | 0 | 0 | 0 | 0 | 0 | still 0: **reading tenths does not restart a stopped clock**, only the tenths write does |
| 8 | **H** running from 0; at ~0.3 s CRB bit 7 = 1, hours written alone, bit 7 = 0; tenths read ~1.5 s later | 8 | 8 | 8 | 8 | 8 | ~1.8 s elapsed: **an alarm-side hours write did not stop the clock** (a stop would read 2 or 3) |
| 10 | **G** as E, then a further ~0.3 s before the tenths read | 8 | 8 | 8 | 8 | 8 | ~1.8 s elapsed: **the clock kept running after the alarm-routed writes** (a stop would read 4 or 5) |
| 12 | **A** hours read at ~0.3 s, tenths read at ~1.5 s | 3 | 3 | 3 | 3 | 3 | tenths froze at the hours read: **hours read latches** |
| 14 | **B** tenths written, *then* hours; tenths read ~1.5 s later | 0 | 0 | 0 | 0 | 0 | never moved: **hours write stops the clock** |
| 16 | **C** live tenths at ~1.5 s (control) | 5 | 5 | 5 | 5 | 5 | clock runs at the right rate |
| 18 | **D** live tenths at ~0.3 s (control) | 2 | 2 | 3 | 2 | 3 | |
| 20 | **E** CRB bit 7 = 1, then 00:00:00.0 written hours..tenths at ~1.5 s; tenths read at once | 5 | 5 | 5 | 5 | 5 | not 0: **bit 7 = 1 writes the alarm, the clock was not set** |
| 22 | **F1** hours read at once after start; first tenths read at ~0.66 s | 0 | 0 | 0 | 0 | 0 | the latched value |
| 24 | **F2** second tenths read, back to back with F1 | 6 | 6 | 6 | 6 | 6 | live: **the tenths read released the latch** |

The seven tests (A, B, E, F1, G, H, I) gave the same digit on every
run. The two controls vary by one between runs, and the cause was
tested: VICE's autostart delay is randomised by
default, and two PAL runs with `+autostart-delay-random` came out
identical (C = 5, D = 2, every test digit as above; the page's first
version made the same check on its seven-row probe and read C = 5,
D = 3 twice). The program therefore starts at a different point
relative to the emulated tick from run to run, a 75-frame wait is
1.48-1.50 s depending on where in a frame it began, and a live reading
taken near 1.5 s or 0.3 s lands either side of a digit boundary. The
tests do not sit near a boundary; the controls do. Which control
wobbles is itself run-dependent: the first version's five runs read
C = 4/5/4/5/5 with D = 3/2/3/2/2, the five above read C = 5 every time
with D = 2/2/3/2/3. A decoder that demands C = 5 or D = 2 exactly will
fail on some runs and prove nothing when it does. (This also accounts
for an earlier run of the same design, before this page, reading C = 5
where the next read 4.)

Row B also shows what the earlier text would have predicted wrongly: if
the hours write started the clock, B would read 4 or 5 like C. Row A
shows the other half: if the tenths read latched and the hours read
released, A would read 4 or 5 too. Row I settles a third claim in
circulation (C64-Wiki's `$DC0B` entry has a stopped clock wait
for a *read* of the tenths register): the tenths read at 0.3 s did not
restart it, the clock still stood at 0 a second and a half later, and
only the tenths write in `reset_tod` set it going again: the
datasheet's rule, in VICE.

One more PAL run with CRA bit 7 left at 0 (the state the KERNAL leaves
it in; the listing's PAL branch with its `ora #$80` changed to
`and #$7f`) reads C = 2, D = 2, E = 2, A = 2, F2 = 5, G = 5 and H = 5,
with B, I and F1 still 0: 1.5 s of waiting advanced the clock about
1.25 s and 1.8 s about 1.5 s, the five-sixths ratio above (rung 1 for
the emulator's divider; the datasheet describes the same divide-by-6).

```kick
// TOD semantics probe, extended from tod3 (same encoding: a reverse-space at
// screen column = value read, one test per row). Original code for c64-kb.
//
//   row  6: I  hours written (clock stopped); tenths READ at ~0.3 s; tenths
//              read again ~1.5 s later                        restart-by-read test
//   row  8: H  clock running from 0; at ~0.3 s CRB bit 7 = 1, hours written
//              (alarm side, nothing after it), bit 7 = 0; tenths read ~1.5 s
//              later                                          alarm-hours halt test
//   row 10: G  as E, then a further ~0.3 s wait before the tenths read
//                                                             still-running test
//   row 12: A  hours read at ~0.3 s, tenths read at ~1.5 s      latch test
//   row 14: B  tenths then hours written, tenths read ~1.5 s later  halt test
//   row 16: C  live tenths at ~1.5 s                             control
//   row 18: D  live tenths at ~0.3 s                             control
//   row 20: E  CRB bit 7 = 1, then 00:00:00.0 written hours..tenths while
//              the clock reads ~1.5 s; tenths read at once       alarm-select test
//   row 22: F1 hours read right after start; first tenths read at ~0.66 s
//   row 24: F2 second tenths read, back to back with F1          latch release test
//
// Border red, background blue, so the decoder can read the display area's
// top edge (text row 0) off the same PNG instead of assuming it; the screen
// is cleared first so a lit cell can only be a result.
//
// Build PAL:  java -jar KickAss.jar tod6.asm -o tod6_pal.prg
// Build NTSC: java -jar KickAss.jar tod6.asm -define NTSC -o tod6_ntsc.prg
//   (NTSC: CRA bit 7 = 0 so the TOD divides 60 Hz; frame counts rescaled
//    to the 6567R8's 17,095-cycle frame so the seconds waited stay the same)

#if NTSC
.const F03 = 18      // ~0.30 s
.const F06 = 40      // ~0.67 s
.const F12 = 72      // ~1.20 s
.const F15 = 90      // ~1.50 s
#else
.const F03 = 15      // ~0.30 s
.const F06 = 33      // ~0.66 s
.const F12 = 60      // ~1.20 s
.const F15 = 75      // ~1.50 s
#endif

.label col = $02
.label lo  = $03
.label hi  = $04

* = $0801
.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00   // 10 SYS2061
* = $080d
        sei
        lda #$02
        sta $d020       // border red
        lda #$06
        sta $d021       // background blue
        ldx #$00
        lda #$20
cls:    sta $0400,x     // clear the screen: the boot banner and the typed RUN
        sta $0500,x     // would otherwise sit on rows 1, 3, 5 and 6
        sta $0600,x
        sta $0700,x
        inx
        bne cls
#if NTSC
        lda $dc0e
        and #$7f        // TODIN = 0: 60 Hz
        sta $dc0e
#else
        lda $dc0e
        ora #$80        // TODIN = 1: 50 Hz
        sta $dc0e
#endif
        lda $dc0f
        and #$7f        // ALARM = 0: TOD writes go to the clock
        sta $dc0f

        // D: live tenths at ~0.3 s (control)
        jsr reset_tod
        ldx #F03
        jsr waitx
        lda $dc08
        ldy #18
        jsr plot

        // A: latch test — hours read at ~0.3 s, tenths read at ~1.5 s
        jsr reset_tod
        ldx #F03
        jsr waitx
        lda $dc0b       // hours read: datasheet says this latches all four
        ldx #F12
        jsr waitx       // now ~1.5 s
        lda $dc08
        ldy #12
        jsr plot
        lda $dc08       // release, in case the latch is still held

        // C: live tenths at ~1.5 s (control)
        jsr reset_tod
        ldx #F15
        jsr waitx
        lda $dc08
        ldy #16
        jsr plot

        // B: halt test — clock running, then hours written LAST
        jsr reset_tod   // ends with the tenths write: running
        lda #$00
        sta $dc0b       // hours written after tenths
        ldx #F15
        jsr waitx
        lda $dc08
        ldy #14
        jsr plot

        // E: alarm-select test — the registers page's "set the clock" row
        jsr reset_tod   // running from 00:00:00.0
        ldx #F15
        jsr waitx       // clock reads ~1.5 s
        lda $dc0f
        ora #$80        // ALARM = 1
        sta $dc0f
        lda #$00
        sta $dc0b       // "set the clock to 00:00:00.0"
        sta $dc0a
        sta $dc09
        sta $dc08
        lda $dc0f
        and #$7f        // ALARM = 0 again
        sta $dc0f
        lda $dc08       // if the clock had been set this reads 0
        ldy #20
        jsr plot

        // G: still-running test — E again, then wait before reading
        jsr reset_tod   // running from 00:00:00.0
        ldx #F15
        jsr waitx       // clock reads ~1.5 s
        lda $dc0f
        ora #$80        // ALARM = 1
        sta $dc0f
        lda #$00
        sta $dc0b
        sta $dc0a
        sta $dc09
        sta $dc08
        lda $dc0f
        and #$7f        // ALARM = 0 again
        sta $dc0f
        ldx #F03
        jsr waitx       // a further ~0.3 s
        lda $dc08       // still running: ~1.8 s -> 8 or 7; stopped by the writes: 4 or 5
        ldy #10
        jsr plot

        // H: alarm-hours halt test — one alarm-side hours write, nothing after it
        jsr reset_tod   // running from 00:00:00.0
        ldx #F03
        jsr waitx       // ~0.3 s
        lda $dc0f
        ora #$80        // ALARM = 1
        sta $dc0f
        lda #$00
        sta $dc0b       // hours, alarm side; no tenths write follows
        lda $dc0f
        and #$7f        // ALARM = 0 again
        sta $dc0f
        ldx #F15
        jsr waitx       // ~1.5 s more
        lda $dc08       // still running: ~1.8 s -> 8 or 7; stopped at the write: 2 or 3
        ldy #8
        jsr plot

        // I: restart-by-read test — does reading tenths restart a write-stopped clock?
        jsr reset_tod   // running from 00:00:00.0
        lda #$00
        sta $dc0b       // hours written: clock stops at 0
        ldx #F03
        jsr waitx       // ~0.3 s
        lda $dc08       // tenths read while stopped (reads 0 either way)
        ldx #F15
        jsr waitx       // ~1.5 s more
        lda $dc08       // 0 if only a tenths WRITE restarts it; 4 or 5 if that read did
        ldy #6
        jsr plot

        // F: latch then two back-to-back tenths reads
        jsr reset_tod   // running from 00:00:00.0
        lda $dc0b       // hours read at once: latched tenths = 0
        ldx #F06
        jsr waitx       // ~0.66 s
        lda $dc08       // first tenths read: the latched value
        and #$0f
        pha
        lda $dc08       // second tenths read: live, latch released
        ldy #24
        jsr plot
        pla
        ldy #22
        jsr plot
loop:   jmp loop

// A = raw register value, Y = screen row (0-24). Reverse-space at column (A & 15).
plot:   and #$0f
        sta col
        lda #<$0400
        sta lo
        lda #>$0400
        sta hi
        tya
        beq pdone
        tax
padd:   lda lo
        clc
        adc #40
        sta lo
        bcc pnext
        inc hi
pnext:  dex
        bne padd
pdone:  ldy col
        lda #$a0
        sta (lo),y
        rts

reset_tod:
        lda #$00
        sta $dc0b       // hours first: stops the clock
        sta $dc0a
        sta $dc09
        sta $dc08       // tenths last: starts it
        rts

// wait X frames, synchronising to raster line $FF each time
waitx:
w1:     lda #$ff
w2:     cmp $d012
        bne w2
w3:     cmp $d012
        beq w3
        dex
        bne w1
        rts
```

Run with
`x64sc -default -warp +sound -autostartprgmode 1 -limitcycles 20000000 -exitscreenshot out.png -autostart tod6_pal.prg`
(add `-model ntsc` and build with `-define NTSC` for the NTSC column),
then find the single lit eight-pixel cell on each of rows 6, 8, 10, 12,
14, 16, 18, 20, 22 and 24 and read its column. The NTSC frame counts
are for the 6567R8 (65 × 263 = 17,095 cycles a frame, 59.83 Hz); on a
6567R56A (64 × 262 = 16,768 cycles, 60.99 Hz) the same seconds would
need 18, 41, 73 and 91 frames (arithmetic from the settled line
counts, rung 3, not run).

### Cross-references

- `hardware/cia-reference.md` — `$DC08`, `$DC0B` and `$DC0F`
  (corrected 2026-09-21 to match this entry), `$DC0E` bit 7 (TODIN),
  and the "TOD latch on read" bullet in its Pitfalls list.
- `hardware/c64-registers-reference.md` — the CIA1 quick-lookup rows
  "Read the TOD clock" and "Set the TOD clock" (the second corrected
  2026-09-21), and the "TOD clock latching" bullet in its Pitfalls,
  which had the read side right all along.
- Register `DC0E` — TODIN, bit 7, which the KERNAL leaves clear; the
  same is true of CIA2's `DD0E` (its `hardware/cia-reference.md` entry
  said otherwise until 2026-09-22).
- `pitfalls/input.md` — the other CIA1 pitfall family (shared pins).
- `recipes/kickassembler/tod-alarm.md` — sets the clock and the alarm
  in this order, reads the four registers in the handler in this order,
  sets TODIN from the detected model, and quotes the drift with the bit
  wrong (this bullet said no recipe used the TOD clock until
  2026-09-23). Technique: `tod_alarm_interrupt`,
  `techniques/cpu-cycle-tricks.md`.

### Sources

- *6526 Complex Interface Adapter (CIA)* datasheet, Commodore
  Semiconductor Group / MOS Technology — "Time of Day Clock (TOD)" and
  "Control Registers" sections. Read in the re-typeset copy
  `mos_6526_cia_recreated.pdf` at 6502.org
  (https://6502.org/documents/datasheets/mos/mos_6526_cia_recreated.pdf);
  that copy carries no date. Paraphrased, not quoted. The server
  answers a bare `curl` with 404 and a browser user-agent string with
  200 (checked 2026-09-22; the same file either way), so a link checker
  will call this URL dead when it is not.
- VICE 3.10, `x64sc` — the instrument for every measured digit above;
  and `vice/src/core/ciacore.c` (VICE-Team `svn-mirror` on GitHub),
  read to learn how the emulator schedules TOD ticks, and re-read on
  2026-09-22 for the alarm case: its store routine sets the stopped
  flag on an hours write, and clears it on a tenths write, only inside
  the branch taken when CRB bit 7 is clear, which is why rows G and H
  come out as they do. That reading is about the instrument, not about
  a chip.
- C64 KERNAL ROM 901227-03 (image shipped with VICE) — bytes at
  `$FDA3-$FDBC` and `$FF6E-$FF7C` for what the KERNAL writes to `$DC0E`,
  and `$F02E-$F030`, `$F047-$F049` and `$FDB3` for the three stores to
  `$DD0E`.
- C64-Wiki, "CIA" (https://www.c64-wiki.com/wiki/CIA) — consulted for
  its register-bit wording; it agrees with the datasheet on CRB bit 7
  and on the hours-write stop, but its `$DC0B` text has the stopped
  clock restart on a *read* of the tenths register where the datasheet
  says a write. Row I above measured that difference in VICE and the
  datasheet is what the emulator does; do not "correct" this page
  toward the wiki on that point.

---

## kernal_nmi_handler_runs_stop_check — The KERNAL NMI handler warm-starts BASIC on RUN/STOP+RESTORE, and a handler that skips the $DD0D read locks every NMI out

**Severity:** high
**Region:** both
**Triggered by registers:** DD0D
**Triggered by techniques:** nmi_handler_and_restore_key
**Mitigated by techniques:** nmi_handler_and_restore_key

### Symptom

Two failures with opposite causes.

1. **The game is gone.** The player presses RUN/STOP+RESTORE, by
   accident or on purpose, and the screen clears to `READY.` with the
   program's code still in memory. The program never touched `$0318`.
   Its interrupt vector, its `$01` setting and its VIC mode were all put
   back to the KERNAL's defaults on the way.
2. **The tick stopped.** A program with its own NMI handler, driven by a
   CIA2 timer, plays or counts exactly once and then never again. The
   timer is still running; `$DD0D` reads `$81` if anything reads it at
   all. RESTORE does nothing either. The handler ends in `RTI` without
   having read `$DD0D`.

### Mechanism

This entry sits in the CIA pitfalls because both halves turn on one
register access, the read of `$DD0D`, and on what CIA2's interrupt
output does around it. The KERNAL's dispatch through the vector and the
per-board wiring of the key are in `pitfalls/kernal-and-io.md`,
`restore_nmi_not_maskable`; this entry is the short form for a program
that is installing a handler. The technique is on both lines above
because the pitfall arises inside a naive version of it (no vector
taken, or a handler with no `$DD0D` read) and the correct version cures
it.

**The STOP check.** The KERNAL's handler at `$FE47` (the default
`$0318` target) reads `$DD0D` and branches on bit 7. Set means a CIA2
source: it runs the RS-232 code. Clear means the NMI came from
somewhere else, and the only other source is the RESTORE key. It then
samples the keyboard row that holds RUN/STOP through `$F6BC` and tests
it through `$FFE1`; if the key is down it falls into `$FE66`: RESTOR,
IOINIT, CINT and `JMP ($A002)`, the BASIC warm start. There is no flag a
program can set to opt out; the decision is made from the CIA2 flag
being absent, which is the state a RESTORE press produces. This
is from the ROM bytes of `kernal-901227-03.bin`, read for
`restore_nmi_not_maskable`; the warm-start branch itself needs RUN/STOP
held and was not run headless.

**The lock.** CIA2 drives the 6510's `/NMI` pin, and holds it low while
any enabled flag in its interrupt control register is set. A read of
`$DD0D` clears every flag and lets the pin rise. The 6510 takes an NMI
on the falling edge of the pin and not on its level, so a handler that
returns without the read leaves `/NMI` low, and no later event on the
pin, timer or key, can make an edge. Measured in VICE x64sc 3.10 on PAL
and NTSC: CIA2 Timer A ticking every 10,000 cycles for 1,005,000 cycles
entered a handler that reads `$DD0D` 100 times and a handler that does
not exactly once; a single `LDA $DD0D` from the main loop then bought
exactly one more entry before the second handler locked the line again
(`recipes/kickassembler/nmi-timer-tick.md`).

### Fix

For the first symptom, install a handler at `$0318` before the game
starts. One `RTI` is a complete handler; `$FE43` runs only `SEI` before
the vector and pushes nothing. Reinstall it after anything that calls
RESTOR (`$FF8A`) or VECTOR (`$FF8D`) with an old table, since both put
`$FE47` back.

For the second, read `$DD0D` in every handler that services a CIA2
source. `BIT $DD0D` costs 4 cycles and touches no register. Do the read
only when the handler is meant to consume the event: a RESTORE-only
stub that also reads `$DD0D` discards a timer or RS-232 flag that
arrived in the same instant.

A program that wants both a live CIA2 tick and a dead RESTORE key
takes the vector, acknowledges in the handler, and either ignores the
extra entry a press produces or tests bit 7 of `$DD0D` before acting.

### Worked example

The handler that locks. It counts one tick and then nothing, and the
key is dead with it:

```asm
// LOCKS AFTER ONE TICK: no read of $DD0D, so /NMI never rises again.
nmi_bad:
        inc tick_count
        rti

tick_count:
        .byte $00
```

The same handler with the acknowledge. Every tick is taken, and a
RESTORE press is one extra entry the counter also sees:

```asm
// Correct: the read clears the CIA2 flag and re-arms the edge.
nmi_good:
        inc tick_count
        bit $dd0d
        rti

tick_count:
        .byte $00
```

For a program with no CIA2 use, the stub that disarms the key; it costs
20 cycles per press and nothing between presses (measured in VICE x64sc
3.10, `recipes/kickassembler/nmi-timer-tick.md`):

```asm
install_stub:
        sei
        lda #<nmi_stub
        sta $0318
        lda #>nmi_stub
        sta $0319
        cli
        rts

nmi_stub:
        rti
```

### Cross-references

- Technique `nmi_handler_and_restore_key` (`techniques/cpu-cycle-tricks.md`),
  the entry this pitfall guards and the one that fixes it: the vector,
  the acknowledge and the tick, with the measurements.
- Pitfall `restore_nmi_not_maskable` (`pitfalls/kernal-and-io.md`), the
  long form: the wiring of the key, the KERNAL path byte by byte, the
  189-cycle cost of a press with the KERNAL handler in place, and RESTOR
  and VECTOR undoing the vector.
- `hardware/cia-reference.md`, `$DD0D` and "NMI vector (CIA2 +
  RESTORE)".
- `hardware/c64-memory-map.md`, `$0318-$0319` and `$FE43-$FF42`.
- Recipe `recipes/kickassembler/nmi-timer-tick.md`.

### Sources

- Commodore 64 KERNAL ROM 901227-03 (`kernal-901227-03.bin` as shipped
  with VICE), as read for `restore_nmi_not_maskable`; not re-read for
  this entry.
- VICE x64sc 3.10, the pinned runs of `nmi-timer-tick.prg` on PAL and
  NTSC, screen cells decoded against `chargen-901225-01.bin`.
- C64-Wiki, "RESTORE (Key)", https://www.c64-wiki.com/wiki/RESTORE_(Key),
  consulted for the name of the key's connection to the CPU only.

---

## cia_revision_irq_one_cycle_late — An old 6526 raises its timer interrupt one cycle later than a 6526A or 8521

**Severity:** medium
**Region:** both
**Triggered by registers:** DC04, DC05, DC0D, DC0E, DD0D
**Triggered by techniques:** double_irq

### Symptom

Code whose timing is set by a CIA timer interrupt is right on one
machine and one cycle out on another, with nothing else changed.

- A raster routine that uses a CIA timer to place its second interrupt
  a counted number of cycles after the first (the "CIA timer second
  stage" of `double_irq`) lands one cycle late on an older board: a
  colour split moves eight pixels right, or a routine that was stable
  jitters by one cycle on every frame.
- A loader whose receive loop is tuned so that a timer interrupt or a
  timer-polled read falls in a fixed bit cell misses the cell on the
  other revision and reads a wrong bit, so the same disk that loads on
  the development machine fails on another.

The code is right on the machine it was tuned on. Two
revisions of the chip shipped in the C64 and both are common.

### Mechanism

The C64 carried two CIA revisions over its life: the original 6526,
and the later 6526A, which the 8521 in the C64C is an HMOS version of
(board history from the C64-Wiki CIA page, which says only that later
boards "may also use the 6526A or the 8521"; not verified here). On a
timer underflow every revision sets the timer's bit in the interrupt
control register in the same cycle. What differs is when `/IRQ` (or
`/NMI` for CIA2) follows: the old 6526 pulls the pin one cycle after
the flag, the newer parts in the same cycle. The 6510 samples the
interrupt line once per instruction, so a one-cycle change on the pin
either changes nothing or moves the handler's entry by the length of
the instruction that was running.

VICE 3.10 models this. `x64sc -help` lists `-ciamodel <0|1>` (both
chips), `-cia1model` and `-cia2model`, with 0 the "old 6526" and 1 the
"new 8521"; a run with no flag behaved as model 1 here. In the
emulator's source (`src/core/ciacore.c`, `cia_run_ifr_cycle`, read at
the VICE-Team GitHub mirror) the old-model branch always schedules the
interrupt raise one cycle on, and the new-model branch raises it in
the same cycle unless the ICR was read in the cycle before. That
source is the named authority for the real-hardware claim; no 6526 was
put on a bench for this entry, and the one-cycle figure for hardware
stands at rung 4.

Measured in VICE x64sc 3.10, the difference matches the model. A probe starts CIA1 Timer B free-running from `$FFFF` and, four
cycles later, Timer A one-shot from latch `$40 + k` for eight phases
`k`, then executes 400 cycles of 2-cycle `NOP`s. The handler's first
instruction is `lda $DC06`. The screen shows `E - N`, where `E` is
`$FFFF` less the Timer B value read and `N` the Timer A latch; the
display is blanked (`$D011` bit 4 clear) for the whole test so no
badline can move anything, and the KERNAL is banked out so `$FFFE`
reaches the handler directly. Same figures on PAL and NTSC:

| `-ciamodel` | k = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| 0, old 6526 | $12 | $11 | $12 | $11 | $12 | $11 | $12 | $11 |
| 1, new 8521 | $10 | $11 | $10 | $11 | $10 | $11 | $10 | $11 |
| none (default) | $10 | $11 | $10 | $11 | $10 | $11 | $10 | $11 |

`-cia1model 0 -cia2model 1` reads as the old row and `-cia1model 1
-cia2model 0` as the new row, so the flag for the chip under test is
the one that matters. At every even phase the old part's handler runs
two cycles later than the new part's, at every odd phase at the same
cycle; over the two phases the mean difference is one cycle, and the
alternation is the `NOP` boundary, not the chip. A control read of Timer B eight cycles after
its start write returned `$FFFA` on both models, so the timers' own
start delay does not differ between them. Subtracting the fixed parts
of the path (Timer A's four-cycle later start, the `N + 1` counts to
underflow, the three cycles from the handler's opcode fetch to the
`lda`'s read) puts the new part's underflow-to-handler-fetch at 8 or 9
cycles and the old part's at 9 or 10; that subtraction is arithmetic on
the timer pipeline, rung 3, and the difference between the rows is the
measurement.

Not measured here: CIA2 and `/NMI` (the source has one path for both
chips, so the same one-cycle rule is expected, rung 4), the Timer B
bug VICE also gates on the old model (an ICR read in the cycle before
a Timer B underflow loses the flag), and any real chip.

### Fix

Two remedies; use both.

1. **Detect the revision once at start and branch on it.** Run the
   two-phase form of the probe with interrupts otherwise off, before
   any timing-critical code is installed, and store a byte: `00` old
   6526, `01` 6526A or 8521. `recipes/kickassembler/cia-revision-detect.md`
   is that routine, verdict at `$02FE`. A timer-timed second stage then
   loads a latch one count shorter on the old part, or the loader picks
   the delay table for the part it found. The detection is a short
   routine and costs a little over two raster frames.
2. **Do not put a bit cell or a pixel on a one-cycle edge.** Where a
   timer interrupt sets the phase, follow it with a raster-synchronised
   entry (`stable_raster_irq`) or a self-timing sequence so the CIA's
   delay is absorbed; where a loader polls a timer, centre the read in
   the bit cell rather than at its edge. A routine that tolerates one
   cycle either way is right on both revisions without detection.

### Worked example

The bad pattern: a second-stage interrupt whose latch was tuned on one
machine.

```text
        ; first IRQ, raster-triggered, jitter up to 7 cycles
        lda #<DELAY        ; a value found by trial on the author's C64
        sta $dc04
        lda #>DELAY
        sta $dc05
        lda #$19           ; one-shot, load, start
        sta $dc0e
        ; ... second handler writes $D020 at "the" cycle
```

On the other revision the write lands one cycle away from where it was
tuned, and because the 6510 quantises the entry to an instruction
boundary the visible error is 0 or 2 cycles depending on which
instruction the interrupt met.

The fix, in outline (the full routine is the recipe):

```text
        ; at start-up, interrupts masked, display blanked
        ; run the probe at latch $40 and $41; E-N pairs:
        ;   $12,$11  -> old 6526        -> revision = 0
        ;   $10,$11  -> 6526A / 8521    -> revision = 1
        ; later:
        lda revision
        beq old_part
        lda #<DELAY
        bne set_latch
old_part:
        lda #<DELAY-1      ; the old part raises one cycle later
set_latch:
        sta $dc04
```

Per-model runs of the recipe (VICE x64sc 3.10, `-ciamodel 0` and `1`,
PAL and NTSC, four runs): row 2 of the screen `12 11` and verdict `OLD
6526` under model 0, `10 11` and `NEW 8521 OR 6526A` under model 1,
`$02FF` = `01` and a green border in all four.

### Cross-references

- Recipe `recipes/kickassembler/cia-revision-detect.md`, the detection
  routine, pinned under `-ciamodel 0`.
- Technique `double_irq` (`techniques/raster.md`), whose "CIA timer
  second stage" is the raster case above; `stable_raster_irq` in the
  same file is the raster-synchronised entry that absorbs the delay.
- Techniques `krill_loader_integration` and `sparkle_irq_loader`
  (`techniques/loaders-packers.md`): the loader case. Their pages
  describe finished loaders and nothing in their text turns on a
  cycle-exact timer interrupt, so they are not on the Triggered-by
  line; the pitfall is for a loader written from scratch with a timer
  in its bit loop. Whether either loader detects the revision was not
  checked here.
- `hardware/cia-reference.md`, "IRQ / NMI on underflow" and the
  "CIA chip revision differences" bullet under its Pitfalls list, which
  names the revisions without a figure; this entry supplies the one
  figure that was measured.
- Pitfall `raster_irq_first_line_jitter` (`pitfalls/raster-and-badline.md`)
  for the instruction-boundary quantisation that turns one cycle into
  0 or 2.

### Sources

- VICE x64sc 3.10, the eight-phase probe and the recipe, run under
  `-ciamodel 0`, `-ciamodel 1`, no flag, and the `-cia1model` /
  `-cia2model` pairs, PAL and NTSC, screen cells decoded against
  `chargen-901225-01.bin`.
- VICE source, `vice/src/core/ciacore.c` at
  https://github.com/VICE-Team/svn-mirror, function `cia_run_ifr_cycle`,
  read for the model branches only.
- `x64sc -help`, VICE 3.10, for the option names and values.
- C64-Wiki, "CIA", https://www.c64-wiki.com/wiki/CIA, for the sentence
  on which revisions later boards carried; it gives no timing figure.

---

## cia_icr_read_clears_all_flags — One read of $DC0D or $DD0D clears every pending flag, not just the one you tested

**Severity:** high
**Region:** both
**Triggered by registers:** DC0D, DD0D
**Triggered by techniques:** tape_turbo_loader, nmi_handler_and_restore_key, irq_chain_table, tod_alarm_interrupt, irq_keyboard_own_scan, irq_owns_processor_port

### Symptom

Two routines share one CIA. Each reads the interrupt control register
to look for its own event, and one of them never sees it.

- A tape or serial routine spins on bit 4 of `$DC0D` waiting for a
  FLAG edge. A timer on the same chip underflows while it spins. The
  routine that later checks the timer bit finds it clear, and its
  timeout, its tick or its bit-cell clock is gone.
- The other way round: a timer poll runs first and a FLAG edge that
  arrived during it is consumed by the timer poll. The FLAG waiter
  then waits for an edge that has already passed.
- On CIA2, a read of `$DD0D` from the main program while a Timer A
  underflow is arriving leaves the NMI handler with nothing to
  dispatch on, and at one phase the NMI itself is not raised: the read
  returns `$01`, the handler never runs, and the tick is lost.

Nothing errors. The register reads `$00` the second time.

### Mechanism

The 6526's interrupt control register at offset `$0D` is two registers
at one address. A write sets or clears mask bits. A read returns the
five event flags in bits 0..4 (Timer A, Timer B, TOD alarm, serial,
FLAG) with bit 7 set if any flagged event is also enabled in the mask,
and the read clears all of them together. There is no way to read one
flag and leave the others standing. The data sheet calls the register
cleared on read. Whoever reads it first owns every event that had
arrived by then.

Measured in VICE x64sc 3.10, PAL and NTSC, default CIA model and
`-ciamodel 0`, same bytes in all three runs unless a row says otherwise.
Interrupts held off with `SEI` for the CIA1 tests so the flags could
be read rather than taken; mask bit 7 with bit 0 (`$81`) written so
the pending bit would show.

1. **One read takes both.** CIA1 Timer A one-shot from latch `$0060`,
   then twenty back-to-back reads of `$DC0D` stored to RAM, 16 cycles
   apart. Reads one to six returned `$00`; the seventh returned `$81`
   (bit 7 pending, bit 0 Timer A, bit 4 FLAG clear); reads eight to
   twenty returned `$00`. The underflow was seen once, in a read that
   was looking for FLAG, and never again.
2. **The losing pattern.** The same timer, then a FLAG poll of twenty
   reads testing only bit 4, then a "has the timer fired" read. The
   check read returned `$00` (bit 0 clear) and a further read straight
   after it `$00`; the control, the same timer with a delay loop that
   reads `$D020` instead of the ICR, returned `$81`. The poll took the
   underflow on its way past and left nothing for the check.
3. **The fix pattern.** The same poll, but each read is ORed into a
   byte in RAM before bit 4 is tested. After the poll that byte was
   `$81`; the timer check, made on the copy, saw `$01`; a fresh read of
   `$DC0D` afterwards returned `$00`, so the copy was the only place
   the event still existed.
4. **CIA2, NMI masked.** Timer A of CIA2 one-shot from `$0060` with
   `$7F` written to `$DD0D` first. After the underflow `$DD0D` read
   `$01` (flag set, bit 7 clear because nothing was enabled) and the
   next read `$00`. Masking an interrupt does not stop its flag from
   being set, and does not stop a read from clearing it.
5. **CIA2, NMI enabled, handler reads once.** Vector at `$0318`,
   handler `LDA $DD0D` into a byte. One NMI counted, the handler's
   copy `$81`, and a main-program read after it `$00`.
6. **Two timers, one read.** CIA1 Timer A and Timer B one-shot from
   `$0020` together, mask `$83`. The first read of `$DC0D` returned
   `$83`; the second `$00`.
7. **A stray read racing the NMI.** CIA2 Timer A one-shot from latch
   `$60 + k` for eight phases k while the main program reads `$DD0D`
   in a 16-cycle loop and the handler of test 5 is installed. PAL,
   default model: phases 0..3, the main loop read `$81` and the
   handler read `$00`; phases 4..7, the handler read `$81` and the
   main loop `$00`; one NMI counted at every phase. NTSC default model
   and PAL `-ciamodel 0`: the same, except that at phase 3 the main
   loop read `$01`, the handler read `$00` and **no NMI was counted**.
   A read that lands in the cycle the chip would raise the line in
   takes the flag before the line follows it, and bit 7 never sets.
   Which phase does that depends on where the loop's reads fall
   against the timer, so treat the phase number as this probe's and
   the loss as the finding.

Not measured here: any real 6526 or 8521; a FLAG edge itself (no
cassette or serial input was driven, so bit 4 was never set and the
lost-FLAG case is the mirror of the lost-timer case, rung 3).

### Fix

One reader per interrupt control register, and one read per event.

1. **Read once into RAM and test the copy.** Whoever polls reads the
   ICR into a byte, ORs it into a pending byte, and every routine on
   that chip tests and clears its own bit in the pending byte, never
   the register. Test 3 above is that pattern; the timer bit survived
   the FLAG poll in it.
2. **Give the register one owner.** If the chip has an interrupt
   handler, the handler is the only code that reads its ICR. It reads
   once, stores the byte, and dispatches on the copy. Main-program
   code that wants to know about a CIA event reads the handler's copy,
   not the chip. Test 7 is what a second reader costs: at some phases
   the handler sees nothing, and at one the interrupt itself is gone.
3. **Do not read an ICR you do not own to "be safe".** A stray
   `LDA $DC0D` in a loader's clean-up, or a `BIT $DD0D` added to a
   routine that is not the NMI handler, acknowledges events that
   belong to someone else. The KERNAL's own IRQ exit at `$EA7E` reads
   `$DC0D`; a raster handler that falls through to it while a CIA1
   timer is in use hands the timer's flag to the KERNAL.

Setting up is still a read: `$7F` to the ICR and one read to clear
whatever was standing is right at install time, when nothing owns the
chip yet. The rule is about steady state.

### Worked example

The losing pattern, two routines and one register:

```asm
// LOSES THE TIMER: the FLAG poll's read cleared bit 0 on the way past.
wait_flag:
        lda $dc0d
        and #$10
        beq wait_flag       // measured: an underflow during this loop is gone
        rts

check_timer:
        lda $dc0d           // read here: $00 after the poll, $81 without it
        and #$01
        rts
```

The fix, one read kept in RAM:

```asm
// Correct: every read is banked into a pending byte; routines test the copy.
poll_icr:
        lda $dc0d           // the only read of $DC0D outside install
        ora pending
        sta pending
        rts

wait_flag_ok:
        jsr poll_icr
        lda pending
        and #$10
        beq wait_flag_ok
        lda pending
        and #$ef            // consume FLAG, leave the timer bit
        sta pending
        rts

check_timer_ok:
        lda pending         // measured: $81 after the poll, so bit 0 is here
        and #$01
        beq no_tick
        lda pending
        and #$fe
        sta pending
no_tick:
        rts

pending:
        .byte $00
```

For a chip with a handler, the handler is `poll_icr`: it reads once,
stores, and dispatches on the stored byte; nothing else touches the
register. On CIA2 that read is also the acknowledge that lets `/NMI`
rise again (`kernal_nmi_handler_runs_stop_check`).

### Cross-references

- Pitfall `cia_revision_irq_one_cycle_late` (this page): both models
  have a one-cycle window in which a read takes the flag before the
  line follows it, the old part because its raise is a cycle later,
  the new part when the read lands in the cycle before the raise.
  Which phase of test 7 falls in that window is a matter of
  alignment, which is why NTSC default and PAL `-ciamodel 0` lost
  phase 3 and PAL default lost none of the eight tried.
- Pitfall `kernal_nmi_handler_runs_stop_check` (this page) and
  `restore_nmi_not_maskable` (`pitfalls/kernal-and-io.md`): the
  opposite failure, a handler that never reads `$DD0D`. The two rules
  together: exactly one read, in the handler.
- Pitfall `tape_bit_is_a_pulse_pair_not_a_pulse` (`pitfalls/loader.md`)
  and technique `tape_turbo_loader` (`techniques/file-io.md`): the
  loader whose FLAG spin on bit 4 met this. Its Timer B is read from
  `$DC06`/`$DC07`, not from the ICR, which is why it survives; a
  variant that timed out on the Timer B flag would not.
- Technique `frame_sync_loop` (`techniques/raster.md`) is not on the
  Triggered-by line: its text waits on `$D012`, and no ICR read
  appears in it.
- `hardware/cia-reference.md`, the interrupt control register.

### Sources

- VICE x64sc 3.10 (windowless build), the seven-test probe above,
  run PAL default model, NTSC default model, PAL `-ciamodel 0`, screen
  cells decoded against `chargen-901225-01.bin`. Tests 1 to 4 were
  repeated in a smaller probe with the results dumped from RAM by a
  monitor tracepoint, same three runs; the test 2 bytes are that
  probe's.
- MOS 6526 data sheet, interrupt control register: flags cleared on
  read, bit 7 the pending summary; the bit assignments above are the
  sheet's.
