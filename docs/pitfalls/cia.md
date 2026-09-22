---
category: cia
---

<!-- doc-type: pitfall-reference -->

# CIA Pitfalls

Pitfalls in the two 6526 CIAs that are not about reading the keyboard or
joysticks — those are in `pitfalls/input.md`. The entries here are about
the chip's own sequencing rules: registers whose *order* of access is
part of their contract, so that code which touches them in the wrong
order gets a wrong answer without any error to show for it.

---

## tod_read_order_latch — Read TOD hours first and tenths last; write hours first and tenths last

**Severity:** high
**Region:** both
**Triggered by registers:** DC08, DC0B, DC0F

### Symptom

Four different failures, one cause. Which one you get depends on which
order your code touched `$DC08`-`$DC0B` in.

1. **A tenths digit that lags.** A clock display polled once a second
   shows seconds, minutes and hours moving while the tenths digit is
   always one poll stale, or sits on a value that makes no sense next to
   the seconds. The code reads tenths first and hours last.
2. **A frozen clock.** Every read of the four TOD registers returns the
   same time, forever, although the game has been running for minutes.
   Somewhere the code read `$DC0B` — often a lone peek at the hours or
   the AM/PM bit — and never read `$DC08` afterwards.
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

The 6526's time-of-day clock is four BCD registers — tenths (`$DC08`),
seconds (`$DC09`), minutes (`$DC0A`), hours with the AM/PM flag in bit 7
(`$DC0B`) — counting a 50 Hz or 60 Hz input on the chip's TOD pin. Two
sequencing rules are built into the silicon, and both key on the
*hours* register at one end and the *tenths* register at the other:

- **Reading.** A read of `$DC0B` latches all four registers: from that
  moment every read of `$DC08`-`$DC0B` returns the values as they stood
  at the hours read. The latch is released by a read of `$DC08`. The
  counter keeps running underneath the latch the whole time; only what
  you *see* is frozen. This exists so that a four-byte read can never
  straddle a carry (59.9 to 00.0) — provided it starts at hours and
  ends at tenths.
- **Writing.** A write to `$DC0B` stops the clock. It does not run
  again until `$DC08` is written. This exists so that a four-byte
  *write* cannot be overtaken by a tick halfway through — provided it
  starts at hours and ends at tenths. Written the other way round, the
  clock is stopped by the last write and stays stopped.
- **Clock or alarm.** Bit 7 of `$DC0F` (CRB, ALARM) chooses what a TOD
  *write* lands in: 0 = the clock, 1 = the alarm. Reads always return
  the clock, whatever bit 7 says (the datasheet's statement; the read
  side of that was not measured here). The alarm registers sit at the
  same four addresses, so "set the clock with bit 7 = 1" silently
  programs the alarm and leaves the clock alone — neither set nor
  stopped, in VICE (rows E, G and H below). One caveat on the "nor
  stopped": the datasheet's "stopped whenever a write to the Hours
  register occurs" is not conditioned on bit 7, so a 6526 may pause
  the clock on an alarm-side hours write until the alarm-side tenths
  write that follows it a few microseconds later. That is not
  measurable here and makes no difference to a four-write sequence;
  it would matter only to code that writes the alarm's hours alone.
- **Rate.** Bit 7 of `$DC0E` (CRA, TODIN) tells the chip whether the
  TOD pin carries 50 Hz (1) or 60 Hz (0), i.e. whether to divide by 5
  or by 6 to make a tenth. The KERNAL does not set this for you:
  IOINIT writes `$08` to `$DC0E` (`LDA #$08` at `$FDAE`, `STA $DC0E`
  at `$FDB0`, in KERNAL 901227-03) and the same `$08` to `$DD0E` at
  `$FDB3`, which leaves bit 7 clear on both CIAs, and the
  region-dependent timer setup at `$FF6E` reads `$DC0E` back, masks
  with `#$80` and ORs in `$11` — it preserves whatever bit 7 was, it
  never sets it. On a PAL machine the TOD therefore counts a 50 Hz
  input with the 60 Hz divider, five-sixths of true speed, until a
  program sets the bit. (ROM bytes read from the 901227-03 image,
  rung 1 — an earlier version of this page placed the `LDA`/`STA` pair
  at `$FDB0` alone; the five-sixths is arithmetic from the datasheet's
  divider, and the VICE run in the measurement section below confirms
  the ratio.)

Everything in the first three bullets is what the MOS 6526 datasheet
says in its "Time of Day Clock" section, and it is what VICE x64sc 3.10
does when measured (rung 1, below). It is not what two pages in this
repository said, which is why this entry exists: a reader who trusted
them wrote code with the read latch and the write halt on the wrong
registers.

One consequence worth stating because it follows from the rules rather
than from any measurement: the latch is chip state, not per-caller
state. If an interrupt handler reads `$DC08` while the main loop is
between its hours read and its tenths read, the main loop's latch is
gone and its remaining reads are live — a torn time with the correct
order on both sides. Keep all TOD reads in one context, or bracket the
four reads with `SEI`/`CLI` when an IRQ handler also reads the clock.
`SEI` does not hold off an NMI, so an NMI handler (RESTORE, or anything
raised through CIA2) must leave `$DC08`-`$DC0B` alone altogether.

### Fix

- **Read** in the order `$DC0B`, `$DC0A`, `$DC09`, `$DC08` — hours
  first, tenths last. If you only want one register and it is hours,
  read `$DC08` afterwards anyway to drop the latch. Any other single
  register can be read on its own.
- **Write** in the order `$DC0B`, `$DC0A`, `$DC09`, `$DC08` with
  `$DC0F` bit 7 = 0. The clock is stopped from the first write to the
  last and starts at exactly the time you set. To program the alarm,
  do the same four writes with bit 7 = 1, then put bit 7 back to 0
  before any code that expects to set the clock.
- **Set the rate** yourself: `$DC0E` bit 7 = 1 on a PAL machine (50 Hz
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
(6569) with CRA bit 7 = 1; NTSC (`-model ntsc`, 6567R8) with CRA bit
7 = 0. Nothing here was run on a 6526 on a bench. VICE derives the TOD
tick from emulated cycles, not from the host clock — the probe runs
under `-warp` and the clock still advances 1.5 s in 75 PAL frames, and
`src/core/ciacore.c` in the VICE tree schedules the tick as an alarm
`todticks` cycles apart — so the readings below are about the chip
model VICE implements, at emulated speed.

The probe (listing below, exactly as run) clears the screen, sets the
clock to 00:00:00.0 in the correct order, waits a known number of
frames by watching `$D012`, and stores a reverse-space (`$A0`) on a
fixed screen row at the column equal to the tenths value it read. One
test per row, so the screenshot *is* the result. Decoded with PIL,
which first finds the display area as the run of non-border pixels
(border red, background blue): the PAL screenshot is 384×272 with the
display at y 35-234, so screen row 0 is at PNG y = 35, and the NTSC one
384×247 with the display at y 23-222, row 0 at y = 23; the display
spans x 32-351 in both, so screen column c is x = 32 + 8c. The decoder
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
tested rather than guessed: VICE's autostart delay is randomised by
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
released, A would read 4 or 5 too. Row I settles a third reading that
is in circulation (C64-Wiki's `$DC0B` entry has a stopped clock wait
for a *read* of the tenths register): the tenths read at 0.3 s did not
restart it, the clock still stood at 0 a second and a half later, and
only the tenths write in `reset_tod` set it going again — the
datasheet's rule, in VICE.

One more PAL run with CRA bit 7 left at 0 — the state the KERNAL leaves
it in; the listing's PAL branch with its `ora #$80` changed to
`and #$7f` — reads C = 2, D = 2, E = 2, A = 2, F2 = 5, G = 5 and H = 5,
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
need 18, 41, 73 and 91 frames — arithmetic from the settled line
counts, rung 3, not run.

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
- No recipe uses the TOD clock yet.

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
