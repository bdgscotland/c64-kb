# CIA Reference (MOS 6526 — CIA1 and CIA2)

## Overview

The Commodore 64 contains two MOS Technology 6526 Complex Interface Adapter
(CIA) chips. They are physically and electrically identical — the same mask,
the same datasheet, the same 16-register interface. What differs is *where*
each chip is wired into the C64 motherboard, *what* its pins connect to, and
*which* CPU interrupt line its IRQ output drives.

- **CIA1** lives at `$DC00-$DC0F` (with the rest of page `$DC00-$DCFF` being
  16-byte mirrors of the same registers). CIA1 is the user-input chip:
  keyboard matrix, control-port 1 and 2 (joysticks, paddles, light pen),
  and the paddle-fire button lines. Its `/IRQ` output pin drives the 6510
  `/IRQ` line. CIA1 also generates the KERNAL jiffy interrupt — about
  60 Hz on BOTH PAL and NTSC machines, not once per frame — that drives
  the KERNAL `IRQ` handler and the TI/TI$ jiffy clock. (An earlier
  version of this page said 50 Hz on PAL; the ROM and a VICE x64sc
  measurement say otherwise — see `$DC04`.)
- **CIA2** lives at `$DD00-$DD0F` (with `$DD00-$DDFF` again being 16-byte
  mirrors). CIA2 is the system-interface chip: it picks the 16 KiB VIC-II
  bank (bits 0-1 of port A), drives the serial-IEC bus (disk drive,
  printer) on port A bits 3-7, drives the RS-232 user-port lines, and
  exposes the user-port PB pins. Its `/IRQ` output pin drives the 6510
  `/NMI` line, which the keyboard's `RESTORE` key also pulls low through
  its own one-shot (one half of the 556 dual timer at U20 on the 1982-86
  boards; this page used to give the pulse as "100 ms", a figure that is
  not measured here).

The naming is unfortunate: from the 6526's point of view both chips
generate IRQs — the chip has no idea one of its IRQ outputs is wired to
the CPU's NMI line. Code that programs CIA2's interrupt-control register
(`$DD0D`) must remember it is enabling NMIs, not IRQs.

Both chips share the same internal layout:

- Two 8-bit parallel I/O ports (port A on pins PA0-PA7, port B on pins
  PB0-PB7), each with an independent data-direction register (DDR).
- Two 16-bit down-counting timers, Timer A and Timer B. Each timer can
  count system phi-2 clocks, rising (positive) edges on the CNT pin,
  Timer A underflows (Timer B only), or Timer A underflows while CNT is
  high (Timer B only). An earlier revision of this bullet said falling
  edges; the CRA/CRB tables and the Count-modes section below were
  already right. The polarity is the 6526 datasheet's, not measured
  here: CNT is a user-port pin, and VICE does not count edges the CIA
  itself puts out in SP-output mode.
- A 24-bit BCD time-of-day (TOD) clock with hours/minutes/seconds/tenths,
  plus an alarm register that fires on match.
- An 8-bit synchronous serial shift register (SDR/SP), clocked by CNT.
  The C64 KERNAL uses it on neither chip — its RS-232 driver is
  bit-banged (see `$DD0C`).
- A single interrupt-control register that masks five interrupt sources
  (Timer A underflow, Timer B underflow, TOD alarm match, serial register
  full/empty, FLAG pin transition) and aggregates them into the chip's
  single `/IRQ` output pin.

This document covers both chips in one file because they are the same chip
with different jobs. Every register section is tagged with
`**Chip:** CIA1` or `**Chip:** CIA2` so the entity extractor in
`src/graph/extract.ts` can disambiguate registers that share a name (e.g.
both chips have a "Data Port A" but at different addresses, with different
external wiring).

### IRQ vs NMI — the critical distinction

The 6510 has two interrupt pins, `/IRQ` (maskable) and `/NMI`
(non-maskable). The 6526 has no idea which of the two it is wired to.

| CIA  | Address       | CPU pin driven | Vector RAM addr | Typical user                            |
|------|---------------|----------------|-----------------|-----------------------------------------|
| CIA1 | `$DC00-$DC0F` | `/IRQ`         | `$0314-$0315`   | KERNAL 60 Hz jiffy IRQ, keyboard scan   |
| CIA2 | `$DD00-$DD0F` | `/NMI`         | `$0318-$0319`   | RESTORE key, RS-232 timing              |

`/IRQ` is maskable with the 6502 `I` flag (`SEI`/`CLI`). `/NMI` is
**not** maskable — when CIA2's `/IRQ` output goes low, the CPU will
service an NMI as soon as it finishes the current instruction, regardless
of `I`. The only way to "mask" an NMI from CIA2 is to disable the
interrupt-source bits in `$DD0D`.

The `RESTORE` key is wired to the CPU's `/NMI` pin *in parallel* with
CIA2's `/IRQ` output, through a one-shot — one half of the 556 dual
timer at U20 on the 1982-86 boards (this page used to say "a 555"). This
means pressing `RESTORE` will fire `/NMI` even with all CIA2 interrupts
disabled, and any code that uses CIA2 to generate NMIs must coexist
with the RESTORE wiring.

## CIA1 quick reference

CIA1 occupies `$DC00-$DC0F` with 16-byte mirrors filling the rest of
`$DC00-$DCFF`. Reads and writes to `$DC10`, `$DC20`, ... `$DCF0` access
the same registers as `$DC00`.

| Addr    | Name     | R/W | Function                                                |
|---------|----------|-----|---------------------------------------------------------|
| `$DC00` | `DC00`   | RW  | Data port A — keyboard matrix col, joystick 2 pins      |
| `$DC01` | `DC01`   | RW  | Data port B — keyboard matrix row, joystick 1 pins      |
| `$DC02` | `DC02`   | RW  | Data direction register A (0=input, 1=output)           |
| `$DC03` | `DC03`   | RW  | Data direction register B (0=input, 1=output)           |
| `$DC04` | `DC04`   | RW  | Timer A low byte (write = latch, read = current)        |
| `$DC05` | `DC05`   | RW  | Timer A high byte (write = latch, read = current)       |
| `$DC06` | `DC06`   | RW  | Timer B low byte (write = latch, read = current)        |
| `$DC07` | `DC07`   | RW  | Timer B high byte (write = latch, read = current)       |
| `$DC08` | `DC08`   | RW  | Time-of-day tenths of a second (BCD)                    |
| `$DC09` | `DC09`   | RW  | Time-of-day seconds (BCD)                               |
| `$DC0A` | `DC0A`   | RW  | Time-of-day minutes (BCD)                               |
| `$DC0B` | `DC0B`   | RW  | Time-of-day hours (BCD, bit 7 = AM/PM)                  |
| `$DC0C` | `DC0C`   | RW  | Serial shift register (SDR)                             |
| `$DC0D` | `DC0D`   | RW  | Interrupt-control register (drives 6510 /IRQ)           |
| `$DC0E` | `DC0E`   | RW  | Control register A — Timer A mode                       |
| `$DC0F` | `DC0F`   | RW  | Control register B — Timer B mode                       |

## CIA2 quick reference

CIA2 occupies `$DD00-$DD0F` with 16-byte mirrors filling `$DD00-$DDFF`.

| Addr    | Name     | R/W | Function                                                 |
|---------|----------|-----|----------------------------------------------------------|
| `$DD00` | `DD00`   | RW  | Data port A — VIC bank (0-1), serial bus (3-7), RS-232   |
| `$DD01` | `DD01`   | RW  | Data port B — user-port PB lines, RS-232 data            |
| `$DD02` | `DD02`   | RW  | Data direction register A                                 |
| `$DD03` | `DD03`   | RW  | Data direction register B                                 |
| `$DD04` | `DD04`   | RW  | Timer A low byte                                          |
| `$DD05` | `DD05`   | RW  | Timer A high byte                                         |
| `$DD06` | `DD06`   | RW  | Timer B low byte                                          |
| `$DD07` | `DD07`   | RW  | Timer B high byte                                         |
| `$DD08` | `DD08`   | RW  | Time-of-day tenths (BCD)                                  |
| `$DD09` | `DD09`   | RW  | Time-of-day seconds (BCD)                                 |
| `$DD0A` | `DD0A`   | RW  | Time-of-day minutes (BCD)                                 |
| `$DD0B` | `DD0B`   | RW  | Time-of-day hours (BCD)                                   |
| `$DD0C` | `DD0C`   | RW  | Serial shift register (unused by the KERNAL)              |
| `$DD0D` | `DD0D`   | RW  | Interrupt-control register (drives 6510 /NMI)             |
| `$DD0E` | `DD0E`   | RW  | Control register A — Timer A mode                         |
| `$DD0F` | `DD0F`   | RW  | Control register B — Timer B mode                         |

## CIA1 register details

### $DC00 — DC00 — Data Port A (RW)

**Chip:** CIA1

Data port A. Output pins are PA0-PA7. On the C64 these pins are wired to:

- The keyboard matrix **column drive** (PA0-PA7 drive columns 0-7).
- Control port 2 ("joy 2"): joystick directions, fire button, paddle
  switches share PA0-PA4 with the keyboard columns.
- Paddle-X / paddle-Y selection (bits 6-7) which the SID's POTX/POTY
  ADC reads.

| Bit | Function                                                       |
|-----|----------------------------------------------------------------|
| 0   | Keyboard column 0 drive / joy2 UP                              |
| 1   | Keyboard column 1 drive / joy2 DOWN                            |
| 2   | Keyboard column 2 drive / joy2 LEFT                            |
| 3   | Keyboard column 3 drive / joy2 RIGHT                           |
| 4   | Keyboard column 4 drive / joy2 FIRE                            |
| 5   | Keyboard column 5 drive                                        |
| 6   | Keyboard column 6 drive / paddle select bit 0                  |
| 7   | Keyboard column 7 drive / paddle select bit 1                  |

To scan a column, clear the chosen column's bit in `$DC00` and set the
other seven (the KERNAL walks `$FE`, `$FD`, ... `$7F`), then read
`$DC01` to see which rows were pulled low.
The control-port 2 joystick is wired in parallel with the column lines,
so a pushed direction grounds PA0-PA4 externally. On its own that
produces no phantom key: the KERNAL scanner's no-key test writes `$00`
to `$DC00` and reads `$DC01`, and nothing on port A can lower a row line
unless a key is closed. (An earlier version said joy 2 up read as a
phantom INST/DEL; corrected from the SCNKEY code at `$EA87-$EADD` and
measured in VICE x64sc.)

### $DC01 — DC01 — Data Port B (RW)

**Chip:** CIA1

Data port B. Pins PB0-PB7. On the C64:

- Keyboard matrix **row read** (PB0-PB7 read rows 0-7).
- Control port 1 ("joy 1"): joy1 directions and fire share PB0-PB4
  with the keyboard rows.
- Timer A and Timer B can optionally drive PB6/PB7 as output (see the
  PBON bit of `$DC0E`/`$DC0F`).
- Light-pen trigger: bit 4 connects to the VIC-II `/LP` line via the
  control-port 1 fire-button pin.

| Bit | Function                                                       |
|-----|----------------------------------------------------------------|
| 0   | Keyboard row 0 read / joy1 UP                                  |
| 1   | Keyboard row 1 read / joy1 DOWN                                |
| 2   | Keyboard row 2 read / joy1 LEFT                                |
| 3   | Keyboard row 3 read / joy1 RIGHT                               |
| 4   | Keyboard row 4 read / joy1 FIRE / light pen trigger            |
| 5   | Keyboard row 5 read                                            |
| 6   | Keyboard row 6 read / Timer A PBON output (if enabled)         |
| 7   | Keyboard row 7 read / Timer B PBON output (if enabled)         |

Reading `$DC01` gives `1` for rows that are pulled high (no key pressed,
joystick not in that direction) and `0` for rows pulled low through
either the matrix or the joystick switches.

### $DC02 — DC02 — Data Direction Register A (RW)

**Chip:** CIA1

Data-direction register for port A. Each bit controls the direction of
the corresponding port-A pin:

- `0` = pin is input (high-impedance, internally pulled up)
- `1` = pin is output (driven by the corresponding bit of `$DC00`)

IOINIT (`$FDA3`; the store is `STX $DC02` at `$FDC8` with X = `$FF`)
sets `$DC02` to `$FF` — at reset, again on RUN/STOP+RESTORE (the NMI
handler calls IOINIT at `$FE69`), and whenever `$FF84` is called. The
keyboard scanner (SCNKEY, `$EA87`) relies on that and only ever writes
`$DC00`; it never touches a DDR, so if you clear `$DC02` to read
joystick 2 you must restore `$FF` yourself — the jiffy scan will not.
The chip's own reset leaves the DDR at `$00` (all input): measured in
VICE x64sc 3.10 from a cartridge cold start, which the RESET entry runs
before IOINIT. An earlier version of this page said the scanner set
`$DC02` and that `$FF` was the reset default; both were the KERNAL's
doing.

### $DC03 — DC03 — Data Direction Register B (RW)

**Chip:** CIA1

Data-direction register for port B. The KERNAL keyboard scanner sets
this to `$00` so PB0-PB7 are all inputs (rows being read). After
RESET the default is `$00`.

Note: if you enable Timer A or Timer B output to PB6/PB7 via the PBON
bit of `$DC0E`/`$DC0F`, those bits of `$DC03` are forced to output
regardless of what you write here.

### $DC04 — DC04 — Timer A Low Byte (RW)

**Chip:** CIA1

Timer A is a 16-bit down counter. `$DC04` is its low byte.

- **Write**: writes go to the 16-bit *latch*, not the counter. The
  counter is reloaded from the latch on underflow or when the LOAD bit
  of `$DC0E` is set.
- **Read**: reads return the *current counter value*, not the latch.

Reading `$DC04` and `$DC05` to capture a 16-bit timer value is racy
because the counter decrements between the two byte reads. The standard
trick is: stop Timer A with `STA $DC0E` (clear START bit), then read,
then restart.

After RESET the latch is `$FFFF`.

The KERNAL programs CIA1 Timer A for the jiffy IRQ from the code at
`$FDDD` (inside IOINIT, and entered again from the tail of CINT at
`$FF5B` once it has set the PAL/NTSC flag at `$02A6`, which is the write
that sticks: 1 = PAL, 0 = NTSC). It writes the latch `$4025` on PAL
(period 16,422 cycles; 985,248 / 16,422 = 59.996 Hz) and `$4295` on
NTSC (period 17,046 cycles; 1,022,727 / 17,046 = 59.998 Hz) — so one
jiffy is 1/60 s in both regions and only the VIC frame rate differs. An
earlier version of this page had the two values swapped and said the
timer matched the frame rate. Values read from kernal-901227-03.bin at
`$FDDD-$FDF6` and confirmed in VICE x64sc by reading the latch back
(stop + LOAD strobe) and by counting 299 jiffies in 250 PAL frames; the
+1 in the period is the 6526's count-to-zero-then-reload behaviour, not
measured separately here.

### $DC05 — DC05 — Timer A High Byte (RW)

**Chip:** CIA1

Timer A high byte. Same semantics as `$DC04`: writes set the latch,
reads return the current counter.

Writing the *high* byte while Timer A is stopped also force-loads the
counter from the latch (this is a 6526 quirk — useful for setting up a
new value without an explicit LOAD).

### $DC06 — DC06 — Timer B Low Byte (RW)

**Chip:** CIA1

Timer B low byte. Same semantics as Timer A's `$DC04`. Writes go to the
latch, reads return the counter.

CIA1 Timer B is free for application use only while no KERNAL
serial-bus or tape I/O is running. Every byte the KERNAL sends on the
IEC bus (LISTEN/TALK command bytes, secondary addresses, CIOUT data)
ends with `LDA #$04 / STA $DC07 / LDA #$19 / STA $DC0F` at `$ED92` and a
poll of `$DC0D` bit 1 at `$ED9F` (the listener-acknowledge timeout), and
every byte ACPTR receives starts with the same sequence using `#$01` at
`$EE20`, polled at `$EE30` (the EOI timeout). Only the high latch byte
is written; the low byte is whatever was there before (`$FF` from reset
— IOINIT never touches `$DC06` — so the one-shots are `$04FF` and
`$01FF` cycles, about 1.3 ms and 0.5 ms, not `$0400`/`$0100`). CRB is
rewritten wholesale to `$19`: a continuous timer becomes one-shot and
stops after its next underflow, PBON, OUTMODE, INMODE and the ALARM
select are cleared, and the `$DC0D` reads discard every pending CIA1
flag, not just Timer B's. Measured in VICE x64sc with a true-emulated
1541: a Timer B programmed to `$1234`, continuous and running, read back
CRB = `$08` (one-shot, stopped), counter `$0434` and `$DC0D` bit 1
pending after a single KERNAL TALK/TKSA/ACPTR/UNTLK. The tape code owns
the timer outright: tape write runs on Timer B underflow interrupts
(mask `$82` written at `$F87A`; half-pulse latches `$0060`/`$00B0` set
at `$FBB1-$FBBC`) and tape read measures pulse widths on it at `$F92C`
and restarts it from a `$FFFF` latch at `$F93D-$F945`. A music or
raster timer on CIA1 Timer B does not survive a KERNAL LOAD or SAVE
over IEC or tape. (An earlier version of this page said the KERNAL
never used it; read from kernal-901227-03.bin and measured in VICE.)

### $DC07 — DC07 — Timer B High Byte (RW)

**Chip:** CIA1

Timer B high byte. Writes to the latch; reads from the counter.

### $DC08 — DC08 — Time-of-Day Tenths (RW)

**Chip:** CIA1

Time-of-day clock — tenths of a second, encoded in 4-bit BCD. Only
bits 0-3 are used; bits 4-7 read zero.

The TOD clock is driven by the **TOD pin** on the 6526, which on the
C64 is wired to the AC mains 50 Hz (PAL) or 60 Hz (NTSC) line via the
power supply. The CRA bit 7 of `$DC0E` selects 50 Hz vs 60 Hz division.

**Reading `$DC0B` (hours) latches** all four TOD registers
(`$DC08`-`$DC0B`) so a multi-byte read sees a coherent time; the latch
is released by reading `$DC08` (tenths). Read order: hours, minutes,
seconds, tenths. The counter keeps running underneath the latch, so a
read of tenths after a long-held latch jumps straight to the live time.
(An earlier version of this page had the two registers swapped;
measured in VICE x64sc; the probe is in `pitfalls/cia.md`,
`tod_read_order_latch`.)

**Writes** go to the running clock when the ALARM bit of `$DC0F` is 0
and to the alarm when it is 1. With ALARM = 0, writing `$DC0B` (hours)
STOPS the clock so all four registers can be set coherently, and writing
`$DC08` (tenths) restarts it; set hours, minutes, seconds, tenths in
that order — a clock whose tenths are never written stays stopped
(VICE's TOD is stopped at power-up until the first tenths write). With
ALARM = 1 the same four writes program the alarm and leave the clock
running; there is no separate arming step, the alarm compare is always
live. (An earlier version of this page said the hours write started the
clock; measured in VICE x64sc.)

### $DC09 — DC09 — Time-of-Day Seconds (RW)

**Chip:** CIA1

Seconds, BCD. Bits 0-3 are the units digit, bits 4-6 are the tens
digit (0-5). Bit 7 reads zero.

### $DC0A — DC0A — Time-of-Day Minutes (RW)

**Chip:** CIA1

Minutes, BCD. Bits 0-3 = units, bits 4-6 = tens (0-5), bit 7 = 0.

### $DC0B — DC0B — Time-of-Day Hours (RW)

**Chip:** CIA1

Hours, BCD. Bits 0-3 = units, bit 4 = tens digit (0 or 1), bits 5-6 = 0,
bit 7 = AM/PM flag (0 = AM, 1 = PM).

Writing `$DC0B` with `$DC0F` bit 7 = 0 stops the clock; it does not run
again until `$DC08` (tenths) is written. With bit 7 = 1 the write sets
the alarm hours and the clock keeps running (measured in VICE x64sc;
this page used to say the hours write started the clock).

Reading `$DC0B` latches all four TOD registers; the latch is released
by a later read of `$DC08` (tenths). If you peek at the hours and never
read tenths, every subsequent TOD read returns the frozen value.
(Previously stated the other way round; measured in VICE x64sc.)

### $DC0C — DC0C — Serial Shift Register (RW)

**Chip:** CIA1

8-bit synchronous serial shift register. Clock comes from CNT, data
from SP. Direction (input/output) is selected by the SPMODE bit of
`$DC0E`.

CIA1's SDR is **not used by the C64**. There is no useful external
wiring of CIA1's SP/CNT pins on the standard motherboard.

After a full byte has been shifted in or out, the SDR bit of the ICR
(`$DC0D` bit 3) goes high.

### $DC0D — DC0D — Interrupt Control Register (RW)

**Chip:** CIA1

Five interrupt sources, one summary flag. Reads and writes use
different bit layouts.

**Read** of `$DC0D`: returns pending interrupt flags, then **clears all
flags as a side effect** and de-asserts `/IRQ`.

| Bit | Read meaning                                       |
|-----|----------------------------------------------------|
| 0   | Timer A underflow occurred                         |
| 1   | Timer B underflow occurred                         |
| 2   | TOD alarm matched                                  |
| 3   | Serial shift register full/empty                   |
| 4   | FLAG pin transition (negative edge)                |
| 5-6 | always 0                                           |
| 7   | IRQ — set if any of bits 0-4 are set AND its mask  |

**Write** to `$DC0D`: sets or clears interrupt-enable mask bits.

| Bit | Write meaning                                                 |
|-----|---------------------------------------------------------------|
| 0   | Enable/disable Timer A underflow IRQ                          |
| 1   | Enable/disable Timer B underflow IRQ                          |
| 2   | Enable/disable TOD alarm IRQ                                  |
| 3   | Enable/disable serial shift IRQ                               |
| 4   | Enable/disable FLAG-pin IRQ                                   |
| 5-6 | reserved (write 0)                                            |
| 7   | SET/CLEAR — `1` = bits 0-4 *set* selected masks;              |
|     |                `0` = bits 0-4 *clear* selected masks          |

Idiom: to enable Timer A IRQ only, write `%10000001` = `$81`.
To disable Timer A IRQ only, write `%00000001` = `$01`.

When `/IRQ` is asserted by CIA1, the 6510's `/IRQ` pin goes low. With
`I` clear, this jumps through the IRQ vector at `$FFFE-$FFFF` (which
in KERNAL ROM mode points at `$FF48`, the KERNAL IRQ handler, which
in turn calls the indirect vector at `$0314-$0315`).

A custom IRQ handler **must** read `$DC0D` to acknowledge — otherwise
the chip will keep `/IRQ` asserted and the handler will re-enter
immediately after `RTI`.

### $DC0E — DC0E — Control Register A (Timer A) (RW)

**Chip:** CIA1

Controls Timer A.

| Bit | Name       | Function                                                |
|-----|------------|---------------------------------------------------------|
| 0   | START      | 1 = start Timer A counting, 0 = stop                    |
| 1   | PBON       | 1 = drive Timer A output (toggle or pulse) to PB6       |
| 2   | OUTMODE    | 0 = pulse PB6 for one cycle; 1 = toggle PB6 on underflow|
| 3   | RUNMODE    | 0 = continuous (auto-reload); 1 = one-shot (stop)       |
| 4   | LOAD       | 1 = strobe: force-load counter from latch (no storage)  |
| 5   | INMODE     | 0 = count phi-2 clocks; 1 = count CNT positive edges    |
| 6   | SPMODE     | 0 = SDR input; 1 = SDR output (Timer A clocks SP)       |
| 7   | TODIN      | 0 = TOD counts 60 Hz; 1 = TOD counts 50 Hz              |

The KERNAL never sets TODIN. IOINIT (`$FDAE`) writes `$08` to `$DC0E`,
`$DC0F`, `$DD0E` and `$DD0F` on every machine; the jiffy-timer tail at
`$FF6E` then rewrites `$DC0E` as (`$DC0E` AND `$80`) OR `$11`, which
keeps the 0 IOINIT put there. So after boot `$DC0E` reads `$01` and
`$DD0E` reads `$08` on PAL and NTSC alike, and both TOD clocks are in
60 Hz mode even on a PAL C64. A PAL program that wants a correct TOD
must set bit 7 itself, and must do it read-modify-write
(`LDA $DC0E : ORA #$80 : STA $DC0E`) because a plain store would clear
bit 0 and stop the Timer A jiffy IRQ that drives the keyboard scan. Left
at 0 on a 50 Hz supply the clock counts 5/6 of real time (measured in
VICE x64sc: 4.1 s on the TOD for 4.9 s elapsed); the mirror case,
TODIN = 1 on an NTSC machine, runs 6/5 fast. (An earlier version said
the KERNAL set this bit by region; read from kernal-901227-03.bin
`$FDAE`/`$FF6E` and confirmed in VICE x64sc on both models.)

LOAD is a write-only strobe; reading bit 4 always returns 0.

### $DC0F — DC0F — Control Register B (Timer B) (RW)

**Chip:** CIA1

Controls Timer B.

| Bit | Name       | Function                                                 |
|-----|------------|----------------------------------------------------------|
| 0   | START      | 1 = start Timer B counting                               |
| 1   | PBON       | 1 = drive Timer B output to PB7                          |
| 2   | OUTMODE    | 0 = pulse PB7 once; 1 = toggle PB7                       |
| 3   | RUNMODE    | 0 = continuous; 1 = one-shot                             |
| 4   | LOAD       | 1 = strobe: force-load counter from latch                |
| 5-6 | INMODE     | 00 = phi-2; 01 = rising CNT edges; 10 = Timer A underflows; |
|     |            | 11 = Timer A underflows gated by CNT high                |
| 7   | ALARM      | 0 = TOD writes set clock; 1 = TOD writes set alarm       |

The INMODE `10` setting (count Timer A underflows) lets you chain
the two timers into a 32-bit timer. Set Timer A as the low 16 bits,
Timer B as the high 16 bits, and Timer B will tick once per Timer A
underflow — giving a period of up to 2^32 phi-2 cycles, roughly
4300 seconds at 1 MHz.

## CIA2 register details

### $DD00 — DD00 — Data Port A — VIC bank + IEC (RW)

**Chip:** CIA2

CIA2's port A is the most heavily multiplexed register on the C64.
Bits 0-1 select the VIC-II's 16 KiB bank. Bits 3-7 drive (or read)
the serial-IEC bus to the disk drive and printer. Bit 2 is the
RS-232 TXD output on the user port.

| Bit | Direction | Function                                                  |
|-----|-----------|-----------------------------------------------------------|
| 0   | Output    | VA14 — VIC bank select bit 0 (inverted: see below)        |
| 1   | Output    | VA15 — VIC bank select bit 1 (inverted)                   |
| 2   | Output    | User-port RS-232 TXD (transmit data)                      |
| 3   | Output    | Serial IEC ATN OUT (drive ATN low)                        |
| 4   | Output    | Serial IEC CLK OUT                                        |
| 5   | Output    | Serial IEC DATA OUT                                       |
| 6   | Input     | Serial IEC CLK IN (sensed from bus)                       |
| 7   | Input     | Serial IEC DATA IN (sensed from bus)                      |

**VIC bank selection (bits 0-1):**

These two bits are *inverted* on the way to VA14/VA15. The mapping is:

| Bits 1-0 | Bank | VIC sees                |
|----------|------|-------------------------|
| `11`     | 0    | `$0000-$3FFF`            |
| `10`     | 1    | `$4000-$7FFF`            |
| `01`     | 2    | `$8000-$BFFF`            |
| `00`     | 3    | `$C000-$FFFF`            |

After RESET both bits are `1`, so the VIC sees bank 0 (`$0000-$3FFF`).
The KERNAL leaves the default at bank 0. Bank 1 and bank 3 do *not* see
character ROM (it only appears at `$1000-$1FFF` and `$9000-$9FFF`); to
use custom charsets in banks 1 or 3, copy the ROM character set to RAM
first.

The IEC input bits (6, 7) are *not* inverted at the register: bit 6
(CLK IN) and bit 7 (DATA IN) read `1` when the line is high (released)
and `0` when this C64 or any device is pulling it low. Only the output
side is inverted: writing `1` to bits 3, 4, 5 pulls ATN/CLK/DATA low
(the KERNAL's CLKLO at `$EE8E` is `ORA #$10`, CLKHI at `$EE85` is
`AND #$EF`). The KERNAL relies on the input polarity: LISTEN's
device-not-present test at `$ED47` is `BCS` on bit 7 after `ASL` (DATA
still high after releasing it under ATN = nobody home), and ACPTR at
`$EE1B` waits for bit 6 = 1, the talker releasing CLK. Measured in VICE
x64sc: with all three outputs released `$DD00` reads `$C7`; setting
bit 5 makes bit 7 read `0`; with a 1541 attached and ATN asserted the
drive pulls DATA and bit 7 reads `0`. After boot it reads `$97` because
the KERNAL leaves CLK OUT (bit 4) set, so bit 6 is `0` while the C64
holds CLK low. (An earlier version of this page had the inputs inverted
as well as the outputs.)

### $DD01 — DD01 — Data Port B — user port (RW)

**Chip:** CIA2

Port B is wired to the C64 user port (the rear edge connector), pins
C-L. These are general-purpose I/O pins commonly used for:

- RS-232 receive data (bit 0 is RXD)
- RS-232 modem-control signals (RTS, DTR, RI, DCD, CTS, DSR)
- User-port parallel cables (1541 fastloaders, 1571 burst mode)
- Hardware MIDI interfaces
- Centronics printer cables

The KERNAL RS-232 driver uses CIA2 Timer A as the transmit bit-clock
and Timer B as the receive bit-clock, bit-banging TXD on `$DD00` bit 2
and sampling RXD on `$DD01` bit 0 (`$FED6`).

After RESET all bits are inputs (`$DD03` = `$00`).

### $DD02 — DD02 — Data Direction Register A (RW)

**Chip:** CIA2

DDR for CIA2 port A. The KERNAL sets this to `$3F` so that bits 0-5
are outputs (VIC bank, RS-232 TXD, IEC ATN/CLK/DATA OUT) and bits 6-7
are inputs (IEC CLK IN, IEC DATA IN).

If you accidentally clear `$DD02` to `$00`, the VIC bank-select bits
become inputs and the VIC will see whatever the bus floats to —
typically `$3FFF` lines all-high, putting the VIC in bank 0. More
importantly, writing to `$DD00` then has no effect until you restore
the DDR.

### $DD03 — DD03 — Data Direction Register B (RW)

**Chip:** CIA2

DDR for CIA2 port B (user port). After RESET this is `$00` (all input).
RS-232 transmit code sets specific bits to output as needed.

### $DD04 — DD04 — Timer A Low Byte (RW)

**Chip:** CIA2

Timer A low byte. Same semantics as CIA1's `$DC04`: writes to latch,
reads from counter.

The KERNAL uses CIA2 Timer A as the RS-232 bit-rate generator. When
RS-232 is not in use, Timer A is free for application timing.

### $DD05 — DD05 — Timer A High Byte (RW)

**Chip:** CIA2

Timer A high byte.

### $DD06 — DD06 — Timer B Low Byte (RW)

**Chip:** CIA2

Timer B low byte.

### $DD07 — DD07 — Timer B High Byte (RW)

**Chip:** CIA2

Timer B high byte.

### $DD08 — DD08 — Time-of-Day Tenths (RW)

**Chip:** CIA2

CIA2 has a fully independent TOD clock from CIA1's. It is driven by the
same AC mains line through the same TOD pin, so both clocks tick at the
same external rate, but they can hold different values.

CIA2's TOD is largely unused by the C64 KERNAL.

### $DD09 — DD09 — Time-of-Day Seconds (RW)

**Chip:** CIA2

Seconds, BCD.

### $DD0A — DD0A — Time-of-Day Minutes (RW)

**Chip:** CIA2

Minutes, BCD.

### $DD0B — DD0B — Time-of-Day Hours (RW)

**Chip:** CIA2

Hours, BCD with AM/PM in bit 7.

### $DD0C — DD0C — Serial Shift Register (RW)

**Chip:** CIA2

CIA2's SDR. The KERNAL never touches either CIA's shift register —
there is no reference to `$DC0C` or `$DD0C` anywhere in the 901227-03
KERNAL or 901226-01 BASIC ROMs (byte census, any alignment). KERNAL
RS-232 is bit-banged under NMI: CIA2 Timer A paces transmit on PA2
(`$F047` writes `$11` to `$DD0E`), the FLAG input catches the start bit
(`$EF7E` writes `$90` to `$DD0D`), and Timer B paces receive sampling
of PB0 (`$FED6`: `LDA $DD01 / AND #$01 / STA $A7`; `$FEF1`/`$FF13`
write `$11` to `$DD0F`). There is no "high-speed synchronous" RS-232
mode in the KERNAL. The SP2/CNT2 pins reach the user port, so
third-party serial hardware and drivers can use the SDR; for
KERNAL-only code it is free. (An earlier version of this section said
the KERNAL used the SDR in shift-in mode for a synchronous RS-232
receive; it does not — read from kernal-901227-03.bin.)

### $DD0D — DD0D — Interrupt Control Register (drives /NMI) (RW)

**Chip:** CIA2

Same bit layout as CIA1's `$DC0D`. The crucial difference is that
CIA2's `/IRQ` output is wired to the 6510's `/NMI` pin, **not** `/IRQ`.

| Bit | Read meaning                                      | Write meaning              |
|-----|---------------------------------------------------|----------------------------|
| 0   | Timer A underflow occurred                        | Mask Timer A NMI           |
| 1   | Timer B underflow occurred                        | Mask Timer B NMI           |
| 2   | TOD alarm matched                                 | Mask TOD-alarm NMI         |
| 3   | Serial shift register full/empty                  | Mask SDR NMI               |
| 4   | FLAG pin transition                               | Mask FLAG NMI              |
| 5-6 | always 0                                          | reserved (write 0)         |
| 7   | NMI summary flag (any enabled bit 0-4 set)        | SET/CLEAR direction        |

The chip itself still calls it an "IRQ" in datasheet language. The
NMI/IRQ distinction is purely a function of which CPU pin the output
is wired to — see Overview.

Reading `$DD0D` clears all pending NMI flags and de-asserts the chip's
output pin. An NMI handler **must** read `$DD0D` (or otherwise
acknowledge) before `RTI`; otherwise `/NMI` stays low and, because the
6510 takes NMI on a falling edge only, no further CIA2 NMI — and no
RESTORE press — can be taken until something reads `$DD0D`. (An
earlier version of this page said the handler would re-enter on `RTI`;
that is the IRQ symptom, not the NMI one. Measured in VICE x64sc 3.10:
CIA2 Timer A one-shot NMI with a handler that never reads `$DD0D` —
entered once; a second underflow while `/NMI` stayed low produced no
NMI; one `LDA $DD0D` and the next underflow produced one. See
Pitfalls.)

The KERNAL initializes `$DD0D` to `$7F` (clear all masks) followed by
no explicit enables, leaving CIA2 NMIs disabled by default.

### $DD0E — DD0E — Control Register A (Timer A) (RW)

**Chip:** CIA2

Same bit layout as CIA1's `$DC0E`. Same notes about the LOAD strobe and
TODIN frequency. The KERNAL leaves CIA2's TODIN at 0 as well — IOINIT
writes `$08` here and nothing later touches bit 7 (the only other
KERNAL writes, `$F030`/`$F049` in the RS-232 code, store `$10`/`$11`)
— so a PAL program using CIA2's TOD must OR in bit 7 itself. (An
earlier version said the KERNAL set it by region.)

### $DD0F — DD0F — Control Register B (Timer B) (RW)

**Chip:** CIA2

Same bit layout as CIA1's `$DC0F`. Same INMODE choices (phi-2 / CNT /
Timer A underflows / Timer A + CNT gated). Same ALARM bit selecting
between writing the clock vs writing the alarm.

## Keyboard scanning (CIA1 ports A/B)

The C64 keyboard is an 8x8 matrix of 64 key switches. Two extra
non-matrix switches (`RESTORE` to NMI, `SHIFT LOCK` mechanically tied
to LEFT-SHIFT) exist outside the matrix.

**Wiring:**

- CIA1 port A (`$DC00`) drives the 8 *columns* (output, all `1`s except
  the column being scanned, which is `0`).
- CIA1 port B (`$DC01`) reads the 8 *rows* (input with internal pull-ups
  to `1`). A pressed key in the active column pulls its row to `0`.

The KERNAL keyboard scanner runs once per jiffy interrupt (about 60 Hz
on both PAL and NTSC — see `$DC04`). A minimal scanner in the KERNAL's
style (the ROM's SCNKEY sets the DDRs nowhere; IOINIT did that at
boot):

```asm
        LDA #$FF
        STA $DC02       ; port A = output
        LDA #$00
        STA $DC03       ; port B = input
        LDX #$00
loop:   LDA col_mask,X  ; one zero-bit walking across $FE..$7F
        STA $DC00       ; drive that column low
        LDA $DC01       ; read rows
        STA matrix,X    ; save row bits
        INX
        CPX #$08
        BNE loop
```

The classic full-matrix layout (column, row 0..7):

| Col | Row 0     | Row 1     | Row 2     | Row 3     | Row 4     | Row 5     | Row 6     | Row 7     |
|-----|-----------|-----------|-----------|-----------|-----------|-----------|-----------|-----------|
| 0   | INST/DEL  | RETURN    | CRSR L/R  | F7/F8     | F1/F2     | F3/F4     | F5/F6     | CRSR U/D  |
| 1   | 3 #       | W         | A         | 4 $       | Z         | S         | E         | L-SHIFT   |
| 2   | 5 %       | R         | D         | 6 &       | C         | F         | T         | X         |
| 3   | 7 '       | Y         | G         | 8 (       | B         | H         | U         | V         |
| 4   | 9 )       | I         | J         | 0         | M         | K         | O         | N         |
| 5   | +         | P         | L         | -         | . >       | : [       | @         | , <       |
| 6   | £         | *         | ; ]       | CLR/HOME  | R-SHIFT   | =         | UP-ARROW  | / ?       |
| 7   | 1 !       | LEFT-ARROW| CTRL      | 2 "       | SPACE     | C=        | Q         | RUN/STOP  |

**Detecting "no key pressed"**: with all columns driven low (write `$00`
to `$DC00`) and DDR-A = `$FF`, read `$DC01` and check for `$FF`.

**Detecting multiple key combinations**: scan column by column and OR
the result. Standard caveat: three keys whose row+column rectangle forms
a triangle produce a "ghost" reading on the fourth corner — there are
no diodes in the matrix.

**Joystick interference**: Joystick 2 alone cannot make the KERNAL type
anything: its lines are columns, and the scanner's no-key test
(`$DC00` = `$00`, `$DC01` == `$FF`) looks only at rows. Measured in
VICE x64sc 3.10 with PA0, and then PA0-PA4, held low through six
seconds of scanning: SFDX stays `$40`, the buffer stays empty. It is
joystick 1, on the row lines PB0-PB4, that the scanner mistakes for
keys — and not quite as folklore has it. The column loop
(`$EAA3-$EADA`) walks `$DC00` from `$FE` to `$7F` and keeps the LAST
matching matrix index (`$EAC9`: `STY $CB`), then makes one more pass
with `$DC00` = `$FF` (the mask is rotated with carry set and
`BNE $EAA8` is taken) that tests row 0 once more at index 64 — the
tables' 65th entry, `$FF`, "no key". A real key cannot appear there
because no column is selected; a joystick-grounded row does. With the
default tables: UP is swallowed (index 64 → no key); DOWN types
LEFT-ARROW (`$5F`); LEFT lands on CTRL (col 7, row 2), which the
scanner treats as a modifier (`$028D` = 4), so the key kept is `;`
(col 6) read through the CTRL table: `$1D`, cursor right; RIGHT types
`2`; FIRE passes R-SHIFT (col 6, row 4) before SPACE, so SHFLAG = 1 and
the shifted table gives `$A0`, shift-space, which prints blank — the
"joystick in port 1 types spaces" effect. All five measured in VICE
x64sc 3.10 by holding the single port-B line low while the KERNAL
scanner ran. Joystick 2 held while a real key on rows 1-7 of column 0
is pressed makes that key read as its column-7 neighbour (RETURN reads
as LEFT-ARROW), because the grounded column shows in every column pass;
from the code, not measured. Games read `$DC00`/`$DC01` directly and
keep the KERNAL scanner out of the way during play.

## Joystick reading (CIA1 port A = joy2, port B = joy1)

The C64 has two control ports (the DE-9 connectors on the right side of
the case). Each port has 5 active-low switch lines (up, down, left,
right, fire) plus two analog "potentiometer" lines.

- **Joy 2** (control port 2) → CIA1 port A, bits 0-4.
- **Joy 1** (control port 1) → CIA1 port B, bits 0-4.

Yes, port 1 is on CIA1 port *B*. This crossed wiring is the most
common surprise for new C64 developers.

**Bit assignments** (both ports use the same bit layout, just on
different CIA1 ports):

| Bit | Direction |
|-----|-----------|
| 0   | UP        |
| 1   | DOWN      |
| 2   | LEFT      |
| 3   | RIGHT     |
| 4   | FIRE      |
| 5   | (unused — analog POT-Y on the port pin, not in this bit) |
| 6   | (analog POT-X on the port pin, not in this bit)         |
| 7   | (unused)                                                |

To read joy 2:

```asm
        LDA $DC00       ; joy 2: bits 0-4, 0 = pressed (UP, DOWN, LEFT, RIGHT, FIRE)
        AND #$1F        ; idle reads $7F, not $FF: bit 7 is the KERNAL's column-7 drive
```

No DDR change is needed. The KERNAL leaves `$DC02` = `$FF` and `$DC00` =
`$7F` between scans (IOINIT `$FDC8`, SCNKEY exit `$EB42`), the CIA
returns the pin level rather than the output latch, and a closed switch
holds a pin low whether or not it is configured as an output (measured
in VICE x64sc with an external device on control port 2: the same bytes
read under DDR = `$FF`/PRA = `$7F` as under DDR = `$00`). An earlier
revision of this section wrote `$00` to `$DC02` "so the joystick can
pull lines low"; that was the wrong reason.

To read joy 1:

```asm
        LDA $DC01       ; port B is already input by default
        ; bit 0 = 0 means UP, etc.
```

If you do change `$DC02`, restore `$FF` before the next jiffy IRQ.
SCNKEY never rewrites the DDR (the only writes in the KERNAL are
IOINIT's), so with `$DC02` = `$00` no column is ever driven low, `$DC01`
reads `$FF` on every pass, and the keyboard — RUN/STOP included, which
UDTIM tests through the same port — is dead until something writes
`$FF` back.

**Paddles** (POT-X / POT-Y) are read through the SID chip's
`$D419`/`$D41A` registers. CIA1 port A bits 6-7 select which of the
two paddle pairs (port 1 or port 2) the SID samples. Setting bits 6-7
of `$DC00` to `01` selects paddle pair 1; `10` selects pair 2.

## Timer A / Timer B

Both CIAs have identical Timer A and Timer B blocks. Each is a 16-bit
down counter with a 16-bit reload latch.

### Count modes (input source)

**Timer A** has two count modes, selected by bit 5 of CRA (`$DC0E`
or `$DD0E`):

- `0`: count system phi-2 clocks (~1 MHz on a stock C64 — slightly
  different PAL/NTSC).
- `1`: count rising edges on the CNT pin.

**Timer B** has four count modes, selected by bits 5-6 of CRB:

- `00`: count phi-2 clocks.
- `01`: count rising edges on the CNT pin.
- `10`: count Timer A underflows.
- `11`: count Timer A underflows while CNT is high.

Mode `10` enables 32-bit cascade: Timer A is the low 16 bits, Timer B
is the high 16 bits.

### Run modes (what happens on underflow)

Bit 3 of CRA/CRB controls run mode:

- `0` continuous: counter reloads from latch and keeps counting.
- `1` one-shot: counter reloads from latch, START bit is cleared, the
  timer stops.

### Output to port B

Bit 1 (PBON) of CRA/CRB enables driving Timer A output to PB6 or Timer B
output to PB7. The driven bit of `$DC03`/`$DD03` is forced to output
mode regardless of what you wrote. Bit 2 (OUTMODE) picks pulse vs
toggle:

- OUTMODE = 0: PB6/PB7 *pulses* for one phi-2 cycle on each underflow.
- OUTMODE = 1: PB6/PB7 *toggles* on each underflow.

This is most often used on CIA1 to generate a tone at a precise
frequency, but the C64 doesn't route PB6/PB7 to anything audible by
default — the cassette port writes a pulse train to record bytes, but
that's CASS WRITE on the 6510 itself, not the CIA.

### IRQ / NMI on underflow

When a timer underflows, the corresponding bit in `$DC0D` / `$DD0D`
goes high. If that bit's mask is set (via a write to `$DC0D` /
`$DD0D` with bit 7 = 1), the chip asserts `/IRQ`:

- CIA1 → 6510 `/IRQ` (maskable).
- CIA2 → 6510 `/NMI` (non-maskable).

### Reading a running timer

Reads of timer low/high return the *current counter*, not the latch.
The counter is decrementing one count per phi-2 cycle (in phi-2 mode),
so reading the low byte and then the high byte will sometimes catch a
borrow in between, giving a value one tick off.

Standard idioms:

1. **Stop, read, restart**: `LDA $DC0E / AND #$FE / STA $DC0E` to stop,
   `LDA $DC04 / LDX $DC05`, then `LDA $DC0E / ORA #$01 / STA $DC0E` to
   restart. Loses a few cycles of count.
2. **Read high, read low, read high**: if the second high read matches
   the first, the low read was valid. Otherwise retry.
3. **Use the latched read**: the 6526 doesn't expose the latched
   atomic-read mode that the 6526A revision adds. On stock 6526, use
   one of the above.

### Setting up a timer IRQ

```asm
        SEI
        LDA #<period
        STA $DC04
        LDA #>period
        STA $DC05       ; latch period
        LDA #$11        ; START=1, PBON=0, RUNMODE=0 (continuous), LOAD=1
        STA $DC0E       ; LOAD + START Timer A
        LDA #$81        ; SET mask, enable Timer A
        STA $DC0D       ; enable Timer A IRQ
        CLI
```

The LOAD strobe (bit 4) forces the counter to reload from the latch
without waiting for the next underflow — useful on initial setup.

## IRQ/NMI control ($DC0D → IRQ, $DD0D → NMI)

The two ICRs share a bit layout but drive different CPU pins. The
sections above for `$DC0D` and `$DD0D` cover the bit details. Here's the
operational rules:

### Acknowledgement

**An interrupt handler MUST read its CIA's `$xx0D` to acknowledge.**
The 6526 latches an asserted `/IRQ` line; it stays low until the ICR
read clears the flags. For CIA1, on the level-sensitive `/IRQ` pin, an
`RTI` without reading the ICR means the CPU immediately re-enters the
handler (measured in VICE x64sc 3.10: a CIA1 Timer B one-shot with a
`$0314` handler that never read `$DC0D` was entered 100 times, the cap
at which the handler finally acked).

A CIA2 NMI handler must read `$DD0D` too, but the failure mode is
silence, not re-entry: the 6510 takes NMI on a falling edge, so a line
left low cannot produce another one. Measured in the same run: CIA2
Timer A one-shot NMI with a handler that never reads `$DD0D` — entered
once; a second underflow while `/NMI` stayed low produced no NMI; one
`LDA $DD0D` and the next underflow produced one; in continuous mode 1
entry without ack against 99 with ack in the same window. (An earlier
version of this section said NMIs re-entered like IRQs and that RESTORE
needed separate handling — see Pitfalls.)

### Mask-write semantics

The SET/CLEAR bit (bit 7) of a write decides whether the 1-bits in
bits 0-4 *set* or *clear* the mask:

- `STA $DC0D` with `A = $81`: enable Timer A interrupt.
- `STA $DC0D` with `A = $01`: disable Timer A interrupt.
- `STA $DC0D` with `A = $7F`: disable ALL interrupts.

A common bug is forgetting the SET/CLEAR bit, e.g. writing `$01`
intending to enable Timer A but actually disabling it.

### IRQ vector (CIA1)

CIA1's `/IRQ` reaches the 6510 `/IRQ` pin. With KERNAL ROM mapped in,
the CPU jumps through `$FFFE-$FFFF` to `$FF48`, which:

1. Pushes A, X, Y.
2. `TSX / LDA $0104,X / AND #$10` — reads the status byte pushed by the
   interrupt and tests the B flag; a BRK goes through `($0316)`, a
   hardware IRQ through `($0314)`. (`$01` is the 6510 port and is not
   involved; an earlier version of this page said `$FF48` read it.)
3. For IRQ, jumps through `($0314)` (default = `$EA31`, the KERNAL
   IRQ handler that scans keyboard and updates the jiffy clock).
4. KERNAL handler ends by reading `$DC0D` and `RTI`.

To install a custom IRQ, replace `$0314-$0315` with your handler's
address. Your handler must read `$DC0D` to ack, then either chain to
`$EA31` for full KERNAL services or `JMP $EA81` to skip the keyboard
scan and just `RTI`.

### NMI vector (CIA2 + RESTORE)

CIA2's `/IRQ` and the RESTORE key both reach the 6510 `/NMI` pin. The
CPU jumps through `$FFFA-$FFFB` to `$FE43`, which is only
`SEI / JMP ($0318)` — nothing is pushed there. The default `($0318)`
target is `$FE47`, and that is where the register saves live (read from
kernal-901227-03.bin at `$FE43`: `78 6C 18 03 48 8A 48 98 48`):

1. `$FE47`: pushes A, X, Y (`PHA / TXA / PHA / TYA / PHA`) — after the
   vector, not before it, which is exactly why a bare `RTI` at `$0318`
   is valid.
2. Writes `$7F` to `$DD0D` (disable every CIA2 source) and reads
   `$DD0D` into Y, clearing the pending flags.
3. `BMI $FE72`: if a CIA2 source was pending, runs the RS-232 code (if
   an enabled CIA2 source — Timer A for transmit, Timer B or FLAG for
   receive — is pending; `$FE72` tests ICR bits 0, 1 and 4 only, never
   the SDR bit 3). RESTORE alone falls through the RS-232 dispatcher at
   `$FE72` with no enabled bit set, rewrites `$DD0D` from the enable
   mirror at `$02A1`, restores Y, X, A and `RTI`s (`$FEBC-$FEC1`).
4. Otherwise `JSR $FD02` (cartridge check: compares `$8004-$8008` with
   `CBM80`); if a cartridge answers, `JMP ($8002)`.
5. `JSR $F6BC` (UDTIM, which is what samples the keyboard row that
   `$FFE1` then reads from `$91`), then `JSR $FFE1` (STOP test); if STOP
   is not held, restore the registers and `RTI`.
6. RUN/STOP + RESTORE: `JSR $FD15` (RESTOR), `JSR $FDA3` (IOINIT),
   `JSR $E518` (CINT), `JMP ($A002)` — the BASIC warm-start vector.

There is no BRK test anywhere in it. (An earlier version of this page
said `$FE43` saved A/X/Y before jumping through `($0318)`, that the
handler checked for BRK first, and that the RS-232 code ran when the
SDR triggered; a `$0318` handler written to that description would pull
three registers nothing had pushed. Read from kernal-901227-03.bin
`$FE43-$FEC1`.)

To install a custom NMI, replace `$0318-$0319`. Your NMI handler must
read `$DD0D` to acknowledge a CIA2 NMI. A RESTORE press is one falling
edge on `/NMI`, so one NMI, however long the pulse; there is nothing in
the CIA to acknowledge for it, and the pulse width itself is not
measured here. (Earlier text said the 555 held `/NMI` low for ~100 ms
and that this needed handling; see Pitfalls for what a held-low line
actually does.)

**Disabling RESTORE.** It cannot be done in `$DD0D`: the key's pulse never
passes through the CIA, and the KERNAL handler above recognises RESTORE
precisely by finding *no* CIA2 flag after its `LDY $DD0D` (the branch is
`BMI` at `$FE54`, from the ROM bytes). Two things work: point `$0318` at a
handler that ends in `RTI`, or hold an unacknowledged CIA2 NMI so `/NMI`
never returns high — the 6510's NMI input is edge-triggered, so a line held
low is not re-entered (the "NMI lock": measured in VICE x64sc 3.10, a
second Timer A underflow with `/NMI` already low produced no second NMI;
the key itself was not pressed in that run, so its case follows from the
edge-triggered input rather than from a measurement). Both, with their
costs and the RUN/STOP detail, are in `pitfalls/kernal-and-io.md` →
`restore_nmi_not_maskable`.

## VIC bank selection (CIA2 port A bits 0-1)

The VIC-II has a 14-bit address bus (16 KiB) but the C64 has 64 KiB of
RAM. CIA2 port A bits 0-1 select which 16 KiB *bank* the VIC sees.

The bits are **inverted** between CIA2 and the VIC:

| `$DD00` bits 1-0 | VIC sees       | Char ROM available? |
|------------------|----------------|---------------------|
| `11`             | `$0000-$3FFF`  | Yes — at `$1000-$1FFF` |
| `10`             | `$4000-$7FFF`  | No (RAM only)        |
| `01`             | `$8000-$BFFF`  | Yes — at `$9000-$9FFF` |
| `00`             | `$C000-$FFFF`  | No (RAM only)        |

After RESET, both bits are `1`, so the VIC sees bank 0 (`$0000-$3FFF`)
and the screen RAM at `$0400` is in the default location.

To switch the VIC to bank 1 while preserving the other port-A bits:

```asm
        LDA $DD00
        AND #$FC        ; clear bits 0-1
        ORA #$02        ; set bit 1, clear bit 0  (binary 10)
        STA $DD00
```

Then update `$D018` (VIC memory pointers) to tell the VIC where in the
new 16 KiB bank to find screen RAM and the character set.

**Why the inversion?** It's a circuit-design optimization: bits 0-1 of
CIA2 PA are inverted by the buffers between CIA2 and the VIC's
VA14/VA15 inputs. The effect is that after reset (when CIA2 PA is `$FF`
and bits 0-1 are high), the VIC sees bank 0. The all-high reset state
of an open-collector / TTL bus matches the "no special change" default
that makes screen RAM appear at `$0400` out of the box.

**Character ROM caveat**: the character ROM is mirrored only into VIC
banks 0 and 2 (where addresses `$x000-$x1FFF` of the VIC's view map to
the C64's `$D000-$DFFF` I/O area, which when accessed by the VIC
returns the character ROM). In banks 1 and 3, the VIC sees pure RAM at
that range. To use a custom charset in bank 1 or 3, copy the char ROM
to RAM in the new bank first.

## Serial bus (CIA2 port A bits 3-7)

The C64's serial-IEC bus is a 4-wire (plus ground) bus carrying ATN,
CLOCK, DATA, and SRQ. ATN/CLOCK/DATA each have one driver per device
plus a pull-up to +5V — a device drives the line by pulling it to
ground (open-collector), and the line reads "high" when no device is
pulling.

**CIA2 PA bit assignments for IEC:**

| Bit | Direction | IEC role                       |
|-----|-----------|--------------------------------|
| 3   | Output    | ATN OUT (1 = drive ATN low)    |
| 4   | Output    | CLK OUT (1 = drive CLK low)    |
| 5   | Output    | DATA OUT (1 = drive DATA low)  |
| 6   | Input     | CLK IN (0 = CLK pulled low by some device, 1 = released) |
| 7   | Input     | DATA IN (0 = DATA pulled low by some device, 1 = released) |

Note the asymmetry: writing `1` to bit 3 pulls ATN to ground, but
reading `1` from bit 6 means CLK is *released* (high); reading `0`
means it is being held low, either by this C64 or by a peripheral.
(An earlier version of this table had the inputs inverted too — see
`$DD00`.)

**ATN** (attention) is the talker/listener-select line. The C64
pulls ATN low to broadcast a command (e.g. "drive 8, talk channel 0"),
all devices listen, then C64 releases ATN and the talker starts
clocking out data.

**Slow loader** (KERNAL-default IEC): software-driven on every bit,
roughly 300–400 bytes per second on a 1541, about 2.5 ms per byte end
to end — measured in VICE x64sc with true drive emulation, where an
8,002-byte KERNAL LOAD took 20.1 M PAL cycles (20.4 s, ~390 bytes/s),
the same range the loader and IEC pages use. An earlier revision of
this page said ~50 bytes per second, which its own 400 µs-per-bit
figure contradicted. A 50 KB part takes over two minutes. Most
games and demos replace the KERNAL loader with a fastloader that
uses Timer A on CIA1 or CIA2 to pace high-speed bit transfers,
either by reusing CLK/DATA in non-standard timing or by adding new
wires through the serial port's extra pins.

**Fastloaders** typically take over the IRQ vector or NMI vector,
saturate the bus with a custom 2-bit-per-clock protocol, and require
matching code in the 1541 disk drive's 6502. Examples: JiffyDOS, Final
Cartridge III, Action Replay, EXOS, Krill's loader.

The SRQ line is not used by the standard C64 KERNAL.

## Pitfalls

- **CIA1 vs CIA2 confusion**: both chips have the same register layout,
  but `$DC00` is keyboard/joystick (drives IRQ) and `$DD00` is VIC
  bank/IEC (drives NMI). Mixing them up is the most common CIA bug —
  e.g. writing the VIC bank to `$DC00`, or enabling a "Timer A IRQ" on
  `$DD0D` when you wanted CIA1 (you'll get an NMI instead, which won't
  be masked by `SEI`).
- **Timer latch order**: writing the low byte of a timer (`$DC04`,
  `$DC06`, `$DD04`, `$DD06`) only updates the latch's low byte; the
  counter is not reloaded until you write the high byte (which loads
  the counter from the latch if the timer is stopped) or strobe LOAD
  via bit 4 of the CRA/CRB. Writing high then low does NOT load the
  counter — you must finish with the high byte or with a LOAD strobe.
- **An un-acknowledged CIA2 NMI silences NMI**: the hazard is lost
  NMIs, not re-entry. The 6510 takes NMI on a falling edge; a CIA2 NMI
  handler that returns without reading `$DD0D` leaves `/NMI` low, and
  no later CIA2 event can produce another edge until something reads
  the ICR. Measured in VICE x64sc 3.10: CIA2 Timer A one-shot NMI with a
  handler that never reads `$DD0D` — entered once; a second underflow
  while `/NMI` stayed low produced no NMI; one `LDA $DD0D` and the next
  underflow produced one; in continuous mode 1 entry without ack
  against 99 with ack in the same window. The demo trick to kill
  RESTORE is exactly this: fire a CIA2 Timer A one-shot NMI into a
  handler that never reads `$DD0D`, and the line stays low. RESTORE
  itself was not measured here (VICE headless cannot press it); that a
  held-low CIA2 line also swallows RESTORE presses is the standard
  scene trick and follows from the shared pin, not a measurement. The
  other option, pointing `$0318` at an `RTI`, still *takes* the NMI —
  the 7-cycle interrupt sequence, `SEI`, `JMP ($0318)` and the `RTI`,
  about 20 cycles of jitter per press with the ROM in; with the KERNAL
  banked out it is `$FFFA/$FFFB` that must point at the `RTI` — whereas
  the held-low trick prevents the interrupt from being taken at all.
  (An earlier version of this bullet described NMI re-entrancy on a
  ~100 ms RESTORE pulse and offered `LDA #$00 / STA $DD0E` or counting
  out the pulse with Timer A as workarounds; the mechanism was the IRQ
  one, and neither workaround touches the ICR — measured: that handler
  leaves the line low and the next event is still lost.)
  The dispatch table, the 20-cycle cost and the lock, measured, are in
  `pitfalls/kernal-and-io.md` → `restore_nmi_not_maskable`.
- **Reading a running timer gives torn values**: low byte decrements
  between the two-byte read. Stop the timer before reading, or use the
  read-high / read-low / re-read-high consistency loop. The 6526A
  revision exposes a latched-read mode the original 6526 does not.
- **Forgetting to acknowledge an IRQ**: a custom IRQ handler must read
  `$DC0D` (CIA1) or `$DD0D` (CIA2) to clear the pending flags and
  release the `/IRQ`/`/NMI` line. Without this a CIA1 `/IRQ` handler
  will re-enter immediately after `RTI` and the CPU will appear to hang
  in the handler; for CIA2 the symptom is the opposite: NMIs stop
  arriving (see the bullet above). (Earlier text gave the re-entry
  symptom for both chips.)
- **ICR write SET/CLEAR confusion**: bit 7 of an ICR write is the
  SET/CLEAR control bit, not an interrupt-enable. `STA $DC0D` with
  `A = $01` *disables* Timer A IRQ; you want `$81` to enable it. A
  common pattern that confuses this is "write `$7F` to mask all" — `$7F`
  has bit 7 = 0 (CLEAR), bits 0-6 = 1 (every source) → "clear masks for
  all sources" → disable all. Conversely `$FF` would *enable* all
  sources.
- **Keyboard scan vs joystick 1**: the KERNAL scanner reads rows; a
  joystick in port 1 grounds row lines and is decoded as keys — DOWN as
  LEFT-ARROW, LEFT as CTRL+; (cursor right), RIGHT as `2`, FIRE as
  shift-space; UP is swallowed by the scanner's final no-column pass.
  Joystick 2 alone types nothing, but held together with a column-0 key
  it moves that key to column 7 (RETURN reads as LEFT-ARROW). If your
  program uses the KERNAL scanner and a joystick, read the joystick
  from a raster or timer interrupt with the scanner disabled, or clear
  the buffer. (Earlier text blamed joy 2 for a phantom INST/DEL and
  said the contention could stress the CIA on early boards; wrong port
  and wrong key — see the SCNKEY reading in the keyboard section — and
  the electrical claim has no source in this repo, so it is dropped.)
- **VIC bank bits are inverted**: setting `$DD00` bits 1-0 to `00`
  selects bank 3 (`$C000-$FFFF`), not bank 0. The bit-to-bank table is
  in the VIC bank section.
- **DDR before data**: writing `$DD00` to change VIC bank has no effect
  if `$DD02` doesn't have bits 0-1 set to output. After RESET the
  KERNAL sets `$DD02 = $3F` which covers VIC bank + IEC outputs, but
  if your code clobbered `$DD02` you must restore it.
- **TOD pin needs AC mains**: the TOD clock counts the 50/60 Hz AC
  zero-crossing from the C64's power supply. In emulators that don't
  emulate the mains line (most), the TOD clock is faked from phi-2 or
  doesn't tick at all. Don't rely on TOD for precise wall-clock timing
  in cross-emulator code.
- **TOD latch on read**: reading `$DC0B` (or `$DD0B`, hours) latches
  all four TOD registers so a multi-byte read is coherent; reading
  `$DC08` (tenths) releases it. If you read hours and then never read
  tenths, the TOD registers appear frozen on subsequent reads while the
  clock keeps counting underneath (earlier text had tenths latching and
  hours releasing; measured in VICE x64sc, PAL and NTSC). The probe and the write-side twin —
  hours-write stops the clock, tenths-write starts it — are in
  `pitfalls/cia.md` (`tod_read_order_latch`).
- **TOD BCD**: TOD registers are BCD-encoded. Code that increments
  them via `INC` will produce invalid BCD digits (e.g. `$09` + 1 =
  `$0A`, not `$10`). Either write decoded values or use ADC with the
  decimal-mode flag.
- **CIA chip revision differences**: original 6526 and the later 6526A
  / 8521 have subtly different behavior on edge cases: latch loading
  timing, TOD start glitch, and serial-shift-register synchronization.
  Demoscene code that exploits cycle-exact CIA behavior may break on a
  different chip revision. The "Lorenz CIA test suite" is the gold
  standard for testing whether your emulator or replacement chip
  matches a real 6526.
- **NMI cannot be masked by SEI**: `SEI` masks the 6510 `/IRQ` line,
  not `/NMI`. Code that disables CIA1 IRQs with `SEI` to do a
  time-critical operation can still be interrupted by a CIA2 NMI or a
  RESTORE press. To truly disable all interrupts, mask CIA2's ICR
  (`STA $DD0D` with `A = $7F`) AND set `I` AND ideally point
  `($0318)` at a `RTI` to absorb a RESTORE NMI.
- **The "all-output trick" on $DC02**: setting `$DC02 = $FF` and
  `$DC00 = $00` drives all eight keyboard columns low. Reading
  `$DC01` then returns the OR of every pressed-key row — useful for
  fast "any key pressed?" tests but doesn't tell you *which* key.
- **Joystick port 1 is on port B, port 2 is on port A**: this is the
  most-warned pitfall in C64 game-dev tutorials, and yet every new C64
  coder gets bitten by it. Joy 2 on `$DC00`, joy 1 on `$DC01`.

<!-- doc-type: hardware-reference -->
