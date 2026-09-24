---
recipe: nmi-timer-tick
toolchain: kickassembler
output_format: PRG
region: both
techniques: [nmi_handler_and_restore_key]
file_formats: [PRG]
uses_registers: [D011, D020, DC04, DC05, DC06, DC07, DC0D, DC0E, DC0F, DD04, DD05, DD0D, DD0E]
uses_kernal: []
claims: [cia1_tod (init)]
harness: [cia1_timer_a, cia1_timer_b]
---

<!-- doc-type: recipe -->

# KickAssembler — NMI Handler Driven by a CIA2 Timer Tick

## Synopsis

Installs an NMI handler through the `$0318` vector and drives it from
CIA2 Timer A at a period of 10,000 cycles. The timer stands in for the
RESTORE key: a headless VICE run cannot press RESTORE, and the key was
not pressed in this run. The program measures three windows of 1,005,000
cycles on CIA1 and counts the NMIs taken in each: a handler that reads
`$DD0D` takes 100, a handler that never reads it takes 1 and then locks
`/NMI` low, and one `LDA $DD0D` from the main loop re-arms the edge for
exactly one more. It then measures the cost of a bare `RTI` stub and of
the count-and-acknowledge handler, and leaves the tick running with a
live count on screen, so the picture shows the main program still going
under a stream of NMIs. This is the `nmi_handler_and_restore_key`
technique; use it when a program needs RESTORE disarmed, a timer tick
that does not depend on the raster, or an NMI-driven sample player.

Verified in VICE x64sc 3.10 on both models: the counts, the two costs
and the verdict are identical on PAL and NTSC; the poll and live-tick
figures differ by model, as the "Expected output" section explains.

## Source

```asm
// nmi-timer-tick.asm
// Installs an NMI handler through $0318 and drives it from CIA2 Timer A,
// which stands in for the RESTORE key (a headless VICE run cannot press
// RESTORE; the key was not pressed in this run). Three windows of
// 1,005,000 phi2 cycles, each timed by CIA1 Timer A (period 10,050) with
// Timer B counting its underflows:
//   ACK  : handler counts and reads $DD0D; tick every 10,000 cycles;
//          expect 100 NMIs while the main loop keeps polling.
//   LOCK : same tick, handler never reads $DD0D; expect 1 NMI (/NMI
//          stays low, the 6510 takes NMI on the falling edge only).
//   READ : one LDA $DD0D from the main loop re-arms the edge; expect 1.
// Then the cost of a handler, measured as CIA1 Timer A across a block of
// 200 NOPs with a one-shot NMI inside it minus the same block with the
// NMI masked: the bare RTI stub and the count-and-acknowledge handler.
// Finally a live tick: the handler counts for ever and the main loop
// prints the count, so the picture shows the program still running.
// Verdict: $02FF = $01 and a green border when the three windows give
// 100, 1 and 1; $02FF = $02 and a red border otherwise.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN     = $0400
.const RESULT     = $02ff        // verdict byte read by the harness
.const BORDER     = $d020
.const CODE_PASS  = $01
.const CODE_FAIL  = $02
.const GREEN      = $05
.const RED        = $02
.const NMIVEC     = $0318

.const TICK       = 10000        // CIA2 Timer A period in cycles (latch + 1)
.const WIN_PERIOD = 10050        // CIA1 Timer A period in cycles
.const WIN_COUNT  = 100          // Timer B underflows per window
                                 // window = 100 * 10,050 = 1,005,000 cycles
.const WIN_TB     = $ffff - WIN_COUNT   // Timer B value at the window's end

.const dst        = $fb          // zero-page pointer: screen destination
.const src        = $fd          // zero-page pointer: text source
.const num        = $02          // 16-bit value for putdec
.const tmp        = $04
.const digit      = $05

// Puts(row, col, label): copy a screen-code string ($ff-terminated)
.macro Puts(row, col, label) {
    lda #<(SCREEN + row * 40 + col)
    sta dst
    lda #>(SCREEN + row * 40 + col)
    sta dst + 1
    lda #<label
    sta src
    lda #>label
    sta src + 1
    jsr puts
}

// Dec(row, col, lo, hi): print the 16-bit value at lo/hi as five digits
.macro Dec(row, col, lo, hi) {
    lda #<(SCREEN + row * 40 + col)
    sta dst
    lda #>(SCREEN + row * 40 + col)
    sta dst + 1
    lda lo
    sta num
    lda hi
    sta num + 1
    jsr putdec
}

// Vector(handler): point $0318 at handler
.macro Vector(handler) {
    lda #<handler
    sta NMIVEC
    lda #>handler
    sta NMIVEC + 1
}

// Quiet(): mask every CIA2 source and drop a pending flag
.macro Quiet() {
    lda #$00
    sta $dd0e                    // stop Timer A
    lda #$7f
    sta $dd0d
    lda $dd0d
}

// Window(): run one 1,005,000-cycle window on CIA1 while polling; count
// the polls in polls/polls+1
.macro Window() {
    lda #$00
    sta polls
    sta polls + 1
    lda #$51                     // CRB: start, force load, count A underflows
    sta $dc0f
    lda #$11                     // CRA: start, force load, count phi2
    sta $dc0e
!:  inc polls
    bne !+
    inc polls + 1
!:  lda $dc06                    // Timer B low byte
    cmp #<WIN_TB
    bne !--
    lda #$00
    sta $dc0e                    // stop both CIA1 timers
    sta $dc0f
}

// Tick(): arm CIA2 Timer A as a continuous NMI source, period TICK
.macro Tick() {
    lda #<(TICK - 1)
    sta $dd04
    lda #>(TICK - 1)
    sta $dd05
    lda #$81                     // set Timer A -> /NMI
    sta $dd0d
    lda #$11                     // CRA: start, force load, continuous
    sta $dd0e
}

// Cost(slot): CIA1 Timer A across 200 NOPs (400 cycles) with a CIA2
// one-shot NMI armed to land inside the block; leaves $FFFF - reading
// in slot/slot+1
.macro Cost(slot) {
    lda #100
    sta $dd04
    lda #$00
    sta $dd05                    // Timer A latch 100: underflow ~101 cycles in
    lda #$19                     // CRA: start, force load, one-shot
    sta $dd0e
    lda #$11
    sta $dc0e                    // CIA1 Timer A from $FFFF, counting phi2
    .fill 200, $ea               // 200 x NOP = 400 cycles
    lda #$00
    sta $dc0e
    sec
    lda #$ff
    sbc $dc04
    sta slot
    lda #$ff
    sbc $dc05
    sta slot + 1
}

start:
    sei
    lda #$7f                     // CIA1: no IRQ sources, flags dropped
    sta $dc0d
    lda $dc0d
    lda #$00
    sta $dc0e
    sta $dc0f
    lda #<(WIN_PERIOD - 1)
    sta $dc04
    lda #>(WIN_PERIOD - 1)
    sta $dc05
    lda #$ff
    sta $dc06
    sta $dc07
    Quiet()

    ldx #$00                     // clear the screen
    lda #$20
!:  sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $300, x
    inx
    bne !-

    Puts(0, 0, t_title)
    Puts(2, 0, t_tick)
    Puts(3, 0, t_ack)
    Puts(4, 0, t_lock)
    Puts(5, 0, t_read)
    Puts(6, 0, t_polls)
    Puts(8, 0, t_cost)
    Puts(10, 0, t_live)
    Puts(12, 0, t_note1)
    Puts(13, 0, t_note2)

    // ACK: count-and-acknowledge handler, 100 ticks in the window
    lda #$00
    sta count
    Vector(nmi_ack)
    Tick()
    Window()
    lda count
    sta ack_n
    Quiet()
    Dec(3, 10, ack_n, zero)
    Dec(6, 11, polls, polls + 1)

    // LOCK: handler never reads $DD0D, so the first tick locks /NMI low
    lda #$00
    sta count
    Vector(nmi_lock)
    Tick()
    Window()
    lda count
    sta lock_n
    Dec(4, 10, lock_n, zero)

    // READ: one read from the main loop re-arms the edge; the timer is
    // still running and the handler still never acknowledges
    lda #$00
    sta count
    lda $dd0d                    // the unlock
    Window()
    lda count
    sta read_n
    Quiet()
    Dec(5, 10, read_n, zero)

    // Costs: control (NMI masked), bare RTI stub, count-and-acknowledge.
    // Screen off first, so no badline steals cycles inside a block; DEN
    // is sampled on line $30, so wait for the next frame before timing.
    lda $d011
    and #$ef
    sta $d011
!:  lda $d011                    // wait until raster line >= 256
    bpl !-
!:  lda $d011                    // then until it wraps to line 0
    bmi !-
    Cost(c_ctrl)                 // CIA2 NMI still masked: control run
    Quiet()
    Vector(nmi_stub)
    lda #$81
    sta $dd0d
    Cost(c_stub)
    Quiet()                      // the stub left /NMI low; this read frees it
    Vector(nmi_ack)
    lda #$81
    sta $dd0d
    Cost(c_ack)
    Quiet()
    lda $d011
    ora #$10
    sta $d011                    // screen back on
    sec                          // stub cost = stub reading - control
    lda c_stub
    sbc c_ctrl
    sta c_stub
    lda c_stub + 1
    sbc c_ctrl + 1
    sta c_stub + 1
    sec
    lda c_ack
    sbc c_ctrl
    sta c_ack
    lda c_ack + 1
    sbc c_ctrl + 1
    sta c_ack + 1
    Dec(8, 5, c_stub, c_stub + 1)
    Dec(8, 15, c_ack, c_ack + 1)

    // Verdict
    ldx #CODE_PASS
    ldy #GREEN
    lda ack_n
    cmp #100
    bne fail
    lda lock_n
    cmp #1
    bne fail
    lda read_n
    cmp #1
    beq verdict
fail:
    ldx #CODE_FAIL
    ldy #RED
verdict:
    stx RESULT
    sty BORDER
    txa
    cmp #CODE_PASS
    bne !+
    Puts(3, 30, t_pass)
    Puts(4, 30, t_pass)
    Puts(5, 30, t_pass)
    jmp live
!:  Puts(3, 30, t_fail)
    Puts(4, 30, t_fail)
    Puts(5, 30, t_fail)

    // Live tick: the handler counts for ever, the main loop prints
live:
    lda #$00
    sta live_n
    sta live_n + 1
    Vector(nmi_live)
    Tick()
!:  Dec(10, 5, live_n, live_n + 1)
    jmp !-

// --- NMI handlers. $FE43 runs SEI then JMP ($0318); nothing is pushed
// before the vector, so a handler that touches no register needs no
// saves and a bare RTI is a complete handler. BIT reads $DD0D without
// disturbing A, X or Y; RTI puts P back.

nmi_stub:
    rti                          // disarms RESTORE; does not acknowledge CIA2

nmi_ack:
    inc count
    bit $dd0d                    // acknowledge: /NMI returns high
    rti

nmi_lock:
    inc count
    rti                          // no read: /NMI stays low, no further edge

nmi_live:
    inc live_n
    bne !+
    inc live_n + 1
!:  bit $dd0d
    rti

// --- helpers

// puts: copy the $ff-terminated screen-code string at (src) to (dst)
puts:
    ldy #$00
!:  lda (src), y
    cmp #$ff
    beq !+
    sta (dst), y
    iny
    bne !-
!:  rts

// putdec: write num (16-bit) at (dst) as five decimal digits
putdec:
    ldx #$00
    ldy #$00
pd_digit:
    lda #$30                     // screen code '0'
    sta digit
pd_sub:
    sec
    lda num
    sbc pow_lo, x
    sta tmp
    lda num + 1
    sbc pow_hi, x
    bcc pd_done
    sta num + 1
    lda tmp
    sta num
    inc digit
    jmp pd_sub
pd_done:
    lda digit
    sta (dst), y
    iny
    inx
    cpx #$05
    bne pd_digit
    rts

pow_lo: .byte <10000, <1000, <100, <10, <1
pow_hi: .byte >10000, >1000, >100, >10, >1

zero:   .byte $00
count:  .byte $00
ack_n:  .byte $00
lock_n: .byte $00
read_n: .byte $00
polls:  .word $0000
c_ctrl: .word $0000
c_stub: .word $0000
c_ack:  .word $0000
live_n: .word $0000

t_title: .text "NMI HANDLER AND RESTORE KEY"
         .byte $ff
t_tick:  .text "TICK 10000 CYCLES  WINDOW 1005000 CYCLES"
         .byte $ff
t_ack:   .text "ACK  NMIS       EXPECT 00100"
         .byte $ff
t_lock:  .text "LOCK NMIS       EXPECT 00001"
         .byte $ff
t_read:  .text "READ NMIS       EXPECT 00001"
         .byte $ff
t_polls: .text "MAIN POLLS       IN THE ACK WINDOW"
         .byte $ff
t_cost:  .text "STUB       ACK       CYCLES PER NMI"
         .byte $ff
t_live:  .text "LIVE       TICKS AND COUNTING"
         .byte $ff
t_note1: .text "RESTORE WAS NOT PRESSED IN THIS RUN."
         .byte $ff
t_note2: .text "CIA2 TIMER A STANDS IN FOR THE KEY."
         .byte $ff
t_pass:  .text "PASS"
         .byte $ff
t_fail:  .text "FAIL"
         .byte $ff
```

## Build

```bash
java -jar KickAss.jar nmi-timer-tick.asm -o nmi-timer-tick.prg
```

Produces `nmi-timer-tick.prg`, `$0801` to `$1077`.

## Expected output

Border green, text area the power-on blue. The program keeps the whole
screen and never returns to BASIC. On PAL, at the pinned 8,000,000 cycles:

```
NMI HANDLER AND RESTORE KEY

TICK 10000 CYCLES  WINDOW 1005000 CYCLES
ACK  NMIS 00100 EXPECT 00100  PASS
LOCK NMIS 00001 EXPECT 00001  PASS
READ NMIS 00001 EXPECT 00001  PASS
MAIN POLLS 52574 IN THE ACK WINDOW

STUB 00020 ACK 00030 CYCLES PER NMI

LIVE 00196 TICKS AND COUNTING

RESTORE WAS NOT PRESSED IN THIS RUN.
CIA2 TIMER A STANDS IN FOR THE KEY.
```

NTSC shows the same screen with `MAIN POLLS 52092` and `LIVE 00186`.

Screenshots from the pinned run, 8,000,000 cycles:
`screenshots/nmi-timer-tick.png` (PAL) and
`screenshots/nmi-timer-tick-ntsc.png` (NTSC). Both decoded against the
character ROM give the text above; border pixel (2, 100) = (98, 213, 50)
on PAL and (114, 189, 103) on NTSC, index 5 in both palettes of
`runtime/vice-reference.md`. The pinned command was run twice per model
and the two PNGs were identical bytes. `$02FF` is `$01`.

The arithmetic behind each line:

- **ACK.** CIA2 Timer A is latched with 9,999 and runs continuously, so
  it underflows every 10,000 cycles (a 6526 timer's period is latch + 1;
  `hardware/cia-reference.md`, `$DC04`). The window is CIA1 Timer A at
  a period of 10,050 with Timer B counting 100 of its underflows:
  1,005,000 cycles. 1,005,000 / 10,000 = 100.5, so 100 ticks fall inside
  the window with a 5,000-cycle margin at each end, whatever the few
  cycles between the two timers' starts. Both timers count phi2, so the
  figure is the same on PAL and NTSC. In seconds, PAL: a 98.5 Hz tick
  over 1.020 s; NTSC: a 102.3 Hz tick over 0.983 s (arithmetic from
  985,248 Hz and 1,022,727 Hz).
- **LOCK.** The handler increments the count and returns without reading
  `$DD0D`. The first underflow sets ICR bit 0, CIA2 pulls `/NMI` low and
  the CPU takes one NMI. The flag is never cleared, `/NMI` never goes
  high again, and the 6510's NMI input is edge-triggered, so the other
  99 underflows in the window produce no NMI. Count 1.
- **READ.** With the timer still running and the same handler in place,
  the main loop reads `$DD0D` once. That clears the flag and `/NMI` rises.
  The next underflow, within 10,000 cycles, makes a fresh falling edge,
  one NMI is taken, and the handler locks the line again. Count 1.
- **MAIN POLLS.** How many times the main loop's poll of `$DC06` ran
  during the ACK window: the program was running the whole time the
  NMIs were being taken. The figure differs by model because the
  screen was on and the badlines in a PAL frame and an NTSC frame steal
  different totals over 1,005,000 cycles; it is stated as measured, not
  derived.
- **STUB and ACK.** CIA1 Timer A counts phi2 across 200 `NOP`s (400
  cycles) with a CIA2 one-shot armed to underflow about 100 cycles in;
  the reading with the NMI masked is subtracted from the reading with
  it taken. The screen is off for these three blocks so no badline
  lands inside one (an earlier run with the screen on read 63 and 73:
  20 and 30 plus one 43-cycle badline). Bare `RTI`: 20 = the NMI
  sequence (7) + the KERNAL's `SEI` at `$FE43` (2) + its `JMP ($0318)`
  (5) + `RTI` (6). Count and acknowledge: 30 = 20 + `INC abs` (6) +
  `BIT abs` (4). The instruction table is `hardware/6510-cpu-reference.md`;
  the 20 agrees with the figure in `pitfalls/kernal-and-io.md`,
  `restore_nmi_not_maskable`.
- **LIVE.** The tick keeps running with a 16-bit count-and-acknowledge
  handler and the main loop prints the count for ever. At the pinned
  cycle count it reads 196 on PAL and 186 on NTSC; the two differ
  because the autostart and the three windows leave different amounts of
  the 8,000,000 cycles for the live phase on each model. A different
  `-limitcycles` gives a different number here and nowhere else.

## Why this works

`$FFFA` holds `$FE43`, which is `SEI` and then `JMP ($0318)`. Nothing is
pushed before that jump, so a handler at `$0318` gets control with the
interrupted program's A, X and Y intact and the CPU's own push of PC and
P already done. A handler that touches no register needs no saves, which
is why one `RTI` is a complete handler and why the counting handler uses
`BIT $DD0D` rather than `LDA`: `BIT` reads the register and only sets
flags, and `RTI` restores P. `$0318` is only consulted while the KERNAL
ROM is mapped in; with HIRAM clear the CPU fetches `$FFFA` from RAM and
the program supplies the vector there.

Reading `$DD0D` is the acknowledge. The CIA clears every flag in the ICR
on a read and drops its interrupt output, which is the 6510's `/NMI`
pin. Until that read the pin stays low, and the 6510 takes an NMI on the
high-to-low transition only, so nothing can raise another NMI, not
another underflow and not RESTORE. The LOCK and READ lines are that rule
seen twice: once locked, and once unlocked by a single read from outside
the handler. A program that uses CIA2 NMIs on purpose reads `$DD0D` in
every handler; a program that wants RESTORE dead can either point
`$0318` at `RTI`, which costs 20 cycles per press and nothing otherwise,
or hold the lock, which costs every CIA2 interrupt for as long as it
holds.

The KERNAL's own handler at `$FE47` is what the vector replaces. It
pushes the registers, masks and reads `$DD0D`, and if no CIA2 flag was
set it treats the NMI as a RESTORE press: it samples the keyboard for
RUN/STOP and, if that key is down, warm-starts BASIC through `$FE66`.
A game that leaves `$0318` alone therefore hands RUN/STOP+RESTORE to
BASIC; the details of that path, from the ROM bytes, are in
`pitfalls/kernal-and-io.md` under `restore_nmi_not_maskable`, and the
pitfall `kernal_nmi_handler_runs_stop_check` in `pitfalls/cia.md` is the
short form.

The three windows are timed on CIA1 rather than the raster so that the
count does not depend on the model. CIA1's own IRQ sources are masked
and the program runs under `SEI`, so the KERNAL's jiffy interrupt is not
part of the picture; only the NMIs interrupt the main loop, and the
`MAIN POLLS` figure shows that it kept running between them.
