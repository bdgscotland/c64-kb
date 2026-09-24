<!-- doc-type: format-reference -->

# IEC Bus and 1541 Disk Drive Reference

The Commodore IEC serial bus protocol, the 1541 floppy drive's command interface, and what C64 code that talks to disk drives has to do. The IEC bus is the physical transport underlying KERNAL disk I/O (LOAD, SAVE, OPEN, CLOSE, CHKIN, CHKOUT) and any custom fast-loader that bypasses the KERNAL. For the KERNAL jump-table entries that drive IEC communication from the C64 side, see `../hardware/kernal-routines-reference.md`.

---

## Overview

The IEC bus (serial IEEE-488 bus) is Commodore's cost-reduced adaptation of the IEEE-488/HP-IB parallel bus used on PET computers. Commodore replaced the 16-wire parallel bus with a 3-wire serial bus to save component costs, at a cost in speed: the standard 1541 protocol delivers approximately 300–400 bytes/second, against the PET's ~4 KB/second. The bus connects the C64 to disk drives (1541, 1571, 1581), printers (MPS-801, MPS-803), and other peripherals via a 6-pin DIN connector on the back of the computer.

The C64 works the IEC bus through five lines of CIA2 port A: three outputs (ATN, CLK, DATA) and two inputs (CLK, DATA). The same CIA2 chip (`$DD00`–`$DD0F`) that controls the VIC-II bank-switching (`$DD00` bits 0–1) also owns the IEC bus lines. Code that manipulates CIA2 for RS-232 or custom bit-banging must therefore allow for IEC bus contention.

All IEC communication from the C64 side goes through KERNAL routines. User programs should always call the KERNAL jump table (`$FF81`–`$FFF5`), never poke CIA2 directly for IEC purposes; the internal routine addresses changed between KERNAL revisions and are private implementation details.

---

## Pin Map and Electrical Characteristics

The IEC bus is open-collector. For each line, every device has a driver that can pull the line to ground and do nothing else, and a pull-up lets the line float to +5 V when no driver is on. A line is therefore **asserted ("true") when it is low** and **released ("false") when it is high**, and any one device can hold it low against all the others. The handshakes rely on this: a listener that is not ready keeps DATA low and the talker cannot proceed.

**DIN-6 connector pinout:**

| Pin | Signal | Direction | Description |
|-----|--------|-----------|-------------|
| 1 | SRQ | Bidirectional | Service Request (unused by 1541; used by some fast loaders for handshake) |
| 2 | GND | — | Signal ground |
| 3 | ATN | C64 → drives | Attention: C64 claims bus and sends command bytes |
| 4 | CLK | Bidirectional | Clock line: transmitter controls timing |
| 5 | DATA | Bidirectional | Serial data |
| 6 | RESET | C64 → drives | Reset line (tied to C64 reset; resets all devices on power-cycle) |

**CIA2 port A (`$DD00`) bit map**, read from the KERNAL 901227-03 image (rung 1; the instructions are in the next table):

| Bit | Direction (DDR default) | Signal | Sense |
|-----|-------------------------|--------|-------|
| 7 | input | DATA IN | 1 = DATA is high (released); 0 = some device, this C64 included, is holding DATA low |
| 6 | input | CLK IN | 1 = CLK is high (released); 0 = CLK is held low |
| 5 | output | DATA OUT | 1 = this C64 pulls DATA low; 0 = released |
| 4 | output | CLK OUT | 1 = this C64 pulls CLK low; 0 = released |
| 3 | output | ATN OUT | 1 = this C64 pulls ATN low; 0 = released |
| 2 | output | RS-232 TXD | user port, not IEC — the KERNAL's RS-232 transmitter writes it |
| 1–0 | output | VIC-II bank select | not IEC — see `../hardware/cia-reference.md` |

The two directions have opposite senses. **Writing 1 to an output bit pulls its line low**: the port reaches the bus through inverting open-collector drivers (the 7406 on the C64 schematic, rung 4), so releasing a line means *clearing* its bit, and the KERNAL's routine for "clock high" is an `AND`. **Reading 1 on an input bit means the line is high**, i.e. released; a line that anything is holding low reads 0. The KERNAL's device-present test is that: assert ATN, release our own DATA, and if DATA IN still reads 1 nobody is holding it, so nobody is there.

The evidence, all rung 1 from the ROM bytes (the labels are the KERNAL source's names, rung 4):

| Address | Label | Instructions | Establishes |
|---|---|---|---|
| `$EE85` | CLKHI | `LDA $DD00 / AND #$EF / STA $DD00` | CLK OUT is bit 4; release by clearing |
| `$EE8E` | CLKLO | `LDA $DD00 / ORA #$10 / STA $DD00` | assert by setting |
| `$EE97` | DATAHI | `LDA $DD00 / AND #$DF / STA $DD00` | DATA OUT is bit 5 |
| `$EEA0` | DATALO | `LDA $DD00 / ORA #$20 / STA $DD00` | |
| `$ED2E` | in LISTEN/TALK | `LDA $DD00 / ORA #$08 / STA $DD00` | ATN OUT is bit 3, asserted by setting |
| `$EDBE` | SCATN | `LDA $DD00 / AND #$F7 / STA $DD00` | released by clearing |
| `$EEA9` | DEBPIA | `LDA $DD00 / CMP $DD00 / BNE $EEA9 / ASL A / RTS` | debounced read: DATA IN (bit 7) lands in the carry, CLK IN (bit 6) in the sign flag |
| `$ED41`–`$ED47` | in ISOUR | `JSR DATAHI / JSR DEBPIA / BCS $EDAD` | carry set — DATA IN reads 1 — with ATN asserted goes to `$EDAD`, `LDA #$80`, the device-not-present status; a present drive holds DATA low, and low reads 0 |
| `$FE7B` | RS-232 transmit | `LDA $DD00 / AND #$FB / ORA $B5 / STA $DD00` | bit 2 is the RS-232 TXD bit |

Measured too, in VICE x64sc 3.10 with `-drive8truedrive` (rung 1): once the C64 has released its own lines (the probe stored `$07` before its first read; the reset state below says why), `$DD00` reads `$C7` (bits 6–7 both 1); write bit 4 and it reads `$97` (CLK IN fell to 0); write bit 5 instead and it reads `$67` (DATA IN fell to 0); after `JSR $FFB1` (LISTEN 8) with a 1541 attached it reads `$1F` (ATN and CLK held by the C64, DATA held by the drive, all three inputs 0) and READST is `$00`, while with no drive attached the same call leaves `$C7` and READST `$80`.

**Data direction and reset state.** IOINIT (`$FDA3`) sets the port up at `$FDCB`–`$FDD4`: `LDA #$07 / STA $DD00`, then `LDA #$3F / STA $DD02` (rung 1). The DDR default is therefore `$3F` (bits 0–5 output, 6–7 input), and user code has no reason to change it. The `$07` is not where the port ends up. IOINIT's last instruction, at `$FDF6`, is `JMP $FF6E`, and `$FF6E`–`$FF7F` (`LDA #$81 / STA $DC0D / LDA $DC0E / AND #$80 / ORA #$11 / STA $DC0E / JMP $EE8E`) finishes with the only `JMP CLKLO` in the KERNAL (rung 1). A freshly reset C64 therefore parks CLK asserted: the port register is `$17` and `$DD00` reads `$97`. Measured in VICE x64sc 3.10 (rung 1): a program whose first instruction is `LDA $DD00` shows `$97`, and `$C7` only after it stores `$07`; the readings are identical with `-drive8truedrive` and a 1541 attached and with no drive, so nothing on the emulated bus was pulling. `$C7` is the bus after the C64 has released its lines. A `$07` store does that, and so does the `JSR CLKHI / JMP DATAHI` pair at `$EE0D`–`$EE12` that the KERNAL's UNLSN and UNTLK both end with.

**One register, both directions.** The C64 reads the bus and drives its own lines through the same byte, which is why every KERNAL primitive above is a read-modify-write: a bare `STA $DD00` would also rewrite the VIC bank and TXD. Custom IEC code must mask the same way, and anything that changes the VIC bank while the bus is busy (a raster interrupt switching banks under a loader, say) must carry bits 3–5 through unchanged or it will drop CLK or DATA in the middle of a byte.

Port B (`$DD01`) and its DDR (`$DD03`) carry no IEC signal. They are the user port's data lines, which is where parallel-cable loaders put their eight data bits.

**Correction (2026-09-21).** The table this replaces had every IEC row wrong (CLK IN on bit 7, DATA IN on bit 6, ATN on bit 4, CLK OUT on bit 3, DATA OUT on bit 2, and "bits 2, 3, 4 output" for the DDR) and said the inputs were "ORed with the output lines inside the CIA". A loader written from it would have toggled the RS-232 TXD line as DATA and sampled DATA as CLK. `../hardware/cia-reference.md` has the bit numbers right but gives the input sense the other way round ("reading `1` from bit 6 means the bus is being held low"); the ISOUR test and the VICE readings above both say 1 is released. A draft of this section written the same day said IOINIT's `$07` store left all three IEC lines released and called `$C7` the idle reading without saying whose idle; IOINIT's last instruction asserts CLK, and `$C7` is what the C64 sees after it has released its own lines.

---

## Bus Protocol

### Roles: Controller, Talker, Listener

The IEC bus has one **controller** (always the C64), one **talker** (the device sending data), and one or more **listeners** (devices receiving data). During a LOAD, the drive is the talker and the C64 is the listener. During a SAVE, the C64 is the talker and the drive is the listener. A printer is always a listener.

### ATN Phase (Command Phase)

The C64 initiates bus activity by pulling ATN low. While ATN is asserted, all devices on the bus treat incoming bytes as command bytes (not data). The C64 sends a 1-byte command:

- **LISTEN and TALK:** bits 7–5 are the command, bits 4–0 the device (0–30).
  - `$20` + device (001xxxxx) — LISTEN: address a device as a listener
  - `$40` + device (010xxxxx) — TALK: address a device as a talker
  - `$3F` UNLISTEN and `$5F` UNTALK use device 31
- **Secondary address:** sent after LISTEN or TALK; bits 7–4 are the command, bits 3–0 the channel (0–15).
  - `$60` + channel (0110xxxx) — data to or from an open channel
  - `$E0` + channel (1110xxxx) — CLOSE
  - `$F0` + channel (1111xxxx) — OPEN; the filename follows
- **Device numbers:** the KERNAL's OPEN (`$F34A`) handles device 0 (keyboard), 1–2 (Datassette, RS-232) and 3 (screen) itself and sends only 4 and up over the bus. Drives default to 8–11, printers to 4–7.

The command bytes are rung 1, read from `kernal-901227-03.bin`: `ORA #$40` at `$ED09` (TALK), `ORA #$20` at `$ED0C` (LISTEN), `ORA #$60` at `$F36B`, `ORA #$F0` at `$F3E8` (OPEN), `ORA #$E0` at `$F64F` (CLOSE), and `LDA #$5F` / `LDA #$3F` at `$EDFB` / `$EDFE`. An earlier version gave `$F0` as 111xxxxx, gave the secondary-address commands a 5-bit device field instead of a 4-bit channel, and called the C64 itself device 0, which is the keyboard and never on the bus.

After sending LISTEN or TALK + secondary address, the C64 releases ATN. The addressed device becomes active; all others go passive.

### Serial Frame (Data Phase)

Each byte is transferred serially, bit-by-bit, using a two-line handshake on CLK and DATA:

1. Talker asserts CLK (signals it is about to send a bit)
2. Listener releases DATA (signals ready to receive)
3. Talker toggles CLK while holding DATA stable at the bit value
4. Listener reads DATA on the CLK edge
5. Repeat for all 8 bits (LSB first)
6. Listener holds DATA low (ACK) briefly after the last bit

This handshake means transmission speed is limited by the slowest device on the bus. The 1541 adds overhead because it processes bytes in its own 6502 CPU, handling each bit-transfer in a software loop at 1 MHz. The result is the ~300 byte/sec standard-load throughput.

### EOI (End Or Identify)

The talker signals the last byte in a data stream via EOI (End or Identify). After the receiver is ready (DATA released), the talker leaves CLK *released* and does nothing; a normal byte would have CLK pulled low again within a couple of hundred microseconds. The listener recognises the long gap as EOI and acknowledges by pulling DATA low briefly, then releasing it; only then does the talker pull CLK low and clock the final byte out. The lengths, as the KERNAL produces and accepts them, are in "IEC bit timing, measured" below.

**Correction (2026-09-23).** This paragraph said the talker "holds CLK low for more than ~200 µs" to signal EOI. It is the other way round: CLK is high (released) throughout the EOI gap, and it is the *absence* of the CLK-low edge that the listener times. The trace below shows the C64, as talker, releasing CLK at `$EE8A` and not touching it again until after the drive's DATA pulse; as listener it times the gap with CIA1 timer B and answers after 539 cycles, not 200 µs.

The KERNAL READST routine (`$FFB7`) returns a status byte where bit 6 indicates EOI was received on the last IECIN call.

### UNLISTEN / UNTALK

After data transfer is complete, the C64 asserts ATN and sends the UNLISTEN (`$3F`) or UNTALK (`$5F`) command to release the addressed devices.

---

## IEC bit timing, measured

This section times each part of the handshake as the 901227-03 KERNAL does it, read off a cycle-stamped trace of every `$DD00` access in VICE x64sc 3.10 with `-drive8truedrive -drive8type 1541` and a freshly formatted disk (rung 1). Two probes were traced: one that does `CHKOUT` on channel 15, sends `M-R $00 $00 $04` and reads the four bytes back, and one that only reads the status line, which is the shortest way to get an EOI *from* the drive. The body of the first, without its BASIC stub:

```kick
iec_timing:
    lda #15
    ldx #8
    ldy #15
    jsr $ffba            // SETLFS 15,8,15
    lda #0
    jsr $ffbd            // SETNAM "": with no name, OPEN sends nothing on the bus
    jsr $ffc0            // OPEN
    ldx #15
    jsr $ffc9            // CHKOUT 15: LISTEN 8, secondary $6F, under ATN
    ldx #0
send:
    lda cmd,x
    jsr $ffd2            // CHROUT: the KERNAL sends the previous byte, keeps this one
    inx
    cpx #6
    bne send
    jsr $ffcc            // CLRCHN: last byte goes out with EOI, then UNLISTEN
    ldx #15
    jsr $ffc6            // CHKIN 15: TALK 8, secondary $6F, then the turnaround
    ldx #0
recv:
    jsr $ffcf            // CHRIN: one byte from the drive
    sta buf,x
    inx
    cpx #4
    bne recv
    jsr $ffcc            // CLRCHN: UNTALK
    lda #15
    jmp $ffc3            // CLOSE 15: LISTEN 8, secondary $EF, UNLISTEN
cmd:
    .text "M-R"
    .byte $00, $00, $04
buf:
    .fill 4, 0
```

The monitor file, given to `-moncommands`. `trace` does not stop the machine (`watch` would, and the run would hang; see `../runtime/vice-reference.md`); `command 2` dumps the port after every read so the log carries the value the load returned, which the register line does not show:

```text
logname "/tmp/iec.log"
log on
trace store dd00
trace load dd00
command 2 "m dd00 dd00"
```

The run: `x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 4500000 -8 disk.d64 -drive8truedrive -drive8type 1541 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 -moncommands trace.mon -exitscreenshot out.png -autostart iec.prg`, once PAL and once with `-model ntsc`. Each log was about 8,400 lines; a Python script folds it into one line per bus event, with the port bits named. The parse is two regular expressions:

```text
import re, sys
ev, pend = [], None
for ln in open(sys.argv[1], encoding='latin-1'):       # the dump line carries a PETSCII byte
    m = re.match(r'\.C:([0-9a-f]{4})\s+.{12}(\w+)\s+\$DD00\s+- A:([0-9A-F]{2}).*?(\d+)\s*$', ln)
    if m:                                               # ".C:ee93  8D 00 DD    STA $DD00 - A:1F ...  3011202"
        pc, op, a, cyc = m.group(1), m.group(2), int(m.group(3), 16), int(m.group(4))
        if op == 'STA': ev.append([cyc, pc, 'W', a]); pend = None
        else:           pend = [cyc, pc, 'R', None]; ev.append(pend)
        continue
    m = re.match(r'>C:dd00\s+([0-9a-f]{2})', ln)          # the value the load saw
    if m and pend: pend[3] = int(m.group(1), 16); pend = None
for cyc, pc, k, v in ev:
    if v is None: continue
    print('%8d %s %s %02x  ATN%d CLKo%d DATo%d | CLKi%d DATi%d' % (cyc, pc, k, v,
          (v>>3)&1, (v>>4)&1, (v>>5)&1, (v>>6)&1, (v>>7)&1))
```

A second script grouped those events into bytes; its figures are the table. The first excerpt is the start of `CHKOUT`'s LISTEN (PAL, cycles are the monitor's stopwatch column; `W` is a store, `R` a load, and the output bits are the C64's own drivers, 1 = pulling low):

```text
 3011184 ed33 W 9f  ATN1 CLKo1 DATo0 | CLKi0 DATi1     ATN asserted
 3011196 ee8e R 1f  ATN1 CLKo1 DATo0 | CLKi0 DATi0     DATA already low, 12 cycles later
 3011224 ee9c W 1f  ATN1 CLKo1 DATo0 | CLKi0 DATi0     DATAHI: C64 releases its own DATA
 3012265 ee97 R 1f  ATN1 CLKo1 DATo0 | CLKi0 DATi0     1,041 cycles later: the 1 ms wait is over
 3012287 eea9 R 1f  ATN1 CLKo1 DATo0 | CLKi0 DATi0     DEBPIA: DATA low, so a device is present
 3012319 ee8a W 0f  ATN1 CLKo0 DATo0 | CLKi0 DATi0     CLKHI: talker ready to send
 3012422 eea9 R cf  ATN1 CLKo0 DATo0 | CLKi1 DATi1     drive releases DATA: listener ready
 3012454 ee93 W df  ATN1 CLKo1 DATo0 | CLKi1 DATi1     CLKLO: byte starts
 3012502 eea5 W bf  ATN1 CLKo1 DATo1 | CLKi0 DATi1     DATALO: bit 0 of $28 is 0
 3012527 ee8a W 2f  ATN1 CLKo0 DATo1 | CLKi0 DATi0     CLKHI: bit valid
 3012553 ed8b W 5f  ATN1 CLKo1 DATo0 | CLKi1 DATi0     CLK low again, DATA released: cell over
 3012666 ee8a W 2f  ATN1 CLKo0 DATo1 | CLKi0 DATi0     next bit valid, 139 cycles after the last (a badline)
```

The second is the drive's EOI on the status line's closing `$0D`, seen by the C64 as listener:

```text
 3070659 eea9 R 67  ATN0 CLKo0 DATo1 | CLKi1 DATi0     drive releases CLK: talker ready
 3070703 ee9c W 47  ATN0 CLKo0 DATo0 | CLKi1 DATi0     DATAHI: listener ready, timer B running
 3071242 eea5 W e7  ATN0 CLKo0 DATo1 | CLKi1 DATi1     539 cycles, no CLK edge: DATALO, the EOI acknowledge
 3071326 ee9c W 07  ATN0 CLKo0 DATo0 | CLKi0 DATi0     DATAHI: acknowledge over after 84 cycles
 3071354 eea9 R 87  ATN0 CLKo0 DATo0 | CLKi0 DATi1     drive pulls CLK low 28 cycles later: byte starts
```

**The figures.** Cycles are what was measured; microseconds are those cycles at 985,248 Hz (PAL) and 1,022,727 Hz (NTSC). Where the NTSC column is a cycle count it came from the NTSC run; the C64's own base intervals came out identical in cycles on both models: they are instruction counts, plus whatever VIC-II stalls the screen state adds, and the stalls land in different places on the two models, so the long variants quoted are the PAL run's unless the row says otherwise. "Whose" says which side sets the interval: the C64's are the KERNAL's own and would be the same on any drive; the drive's are VICE's 1541 answering at VICE's 1541 timing, quoted as the range seen over fifteen sent and thirty-one received bytes, and a real drive, a 1571 or an SD2IEC will differ there.

| Phase | Whose | Cycles | PAL µs | NTSC µs | Where in the KERNAL |
|---|---|---|---|---|---|
| ATN asserted to first look at DATA (the device-present test) | C64 | 1,103 with the screen on (two badlines); 1,017 by instruction count | 1,119.5 | 1,078.5 | `STA $DD00` at `$ED33`; DATAHI at `$EE9C` 40 cycles later; the 1 ms loop is `LDX #$B8` at `$EEB4`, 955 cycles by count from the DATAHI store to the `$EE97` load before the next one, 1,041 measured on both models, the 86 being two badline stalls of 43; the test read at `$EEA9` |
| Drive's DATA response to ATN | drive | ≤ 12 | ≤ 12.2 | ≤ 11.7 | already low at the first read after the ATN store, `$EE8E` |
| Talker CLK release to listener DATA release (drive ready for a byte) | drive | 49 to 859 | 50 to 872 | 48 to 840 | wait loop at `$EEA9`; the 859 was the drive's `UNLISTEN` after `CLOSE`, the rest 49 to 373 |
| Listener ready to CLK asserted (byte starts) | C64 | 32; 43 to 98 when the `$EEA9` poll catches the edge late or a badline lands in the gap | 32.5 | 31.3 | `$EE93`; 32 in twelve of the fifteen sent bytes, 43, 75 and 98 in the other three on PAL, 39 and 43 on NTSC |
| CLK asserted to first bit's CLK release | C64 | 71 to 73 | 72.1 to 74.1 | 69.4 to 71.4 | first pass of the loop at `$ED66` |
| Bit cell, C64 sending: CLK released | C64 | 26, or 69 with a badline in the released half | 26.4, or 70.0 | 25.4, or 67.5 | `$EE8A` to `$ED8B`; three of the 120 cells in each run were 69 |
| Bit cell, C64 sending: period | C64 | 94 to 96, or 136 to 139 | 95.4 to 97.4, or 138.0 to 141.1 | 91.9 to 93.9, or 133.0 to 135.9 | `$EE8A` to the next `$EE8A`; the long cells are the ones a badline landed in |
| Last bit to listener acknowledge (DATA low) | drive | 76 to 80, once 111, once 154 | 77 to 81 | 74 to 78 | wait loop at `$EEA9` after `$ED8B` |
| EOI, C64 sending: listener ready to the drive's DATA pulse | drive | 609 to 613 | 618 | 599 | the C64 idles at `$EEA9` with CLK released |
| EOI, C64 sending: the drive's DATA pulse | drive | 80 to 87 | 81 | 85 | then `$EE93`, CLK asserted, 32 cycles after it ends |
| TALK turnaround: ATN release to C64 CLK release | C64 | 22 | 22.3 | 21.5 | `$EDC3` then `$EE8A` |
| TALK turnaround: C64 CLK release to drive CLK assert | drive | 70 to 86 | 87 | 68 | wait at `$EEA9` |
| Receive: drive CLK release to C64 DATA release (listener ready) | C64 | 44 | 44.7 | 43.0 | `$EE9C`, inside ACPTR |
| Receive: listener ready to drive CLK assert (byte starts) | drive | 63 to 106 | 64 to 108 | 62 to 104 | wait at `$EEA9` |
| Receive: bit period, drive sending | drive | 157 to 237, mostly 185 to 196 | 188 to 199 | 181 to 192 | CLK-high samples at `$EE5A`/`$EE5D`, CLK-low waits at `$EE67`/`$EE6A` |
| Receive: last bit to C64 acknowledge (DATA low) | both | 78 to 136 | 79 to 138 | 76 to 133 | `$EEA5` after the loop |
| EOI, C64 receiving: listener ready to acknowledge | C64 | 539 | 547.1 | 527.0 | timer B armed before `$EE9C`; `$EEA5` when it expires |
| EOI, C64 receiving: acknowledge pulse | C64 | 84 | 85.3 | 82.1 | `$EEA5` to `$EE9C`, with CLKHI at `$EE8A` between |
| UNTALK: ATN asserted from a different place | C64 | | | | `STA $DD00` at `$EDF8`, not `$ED33` |

Three things the table settles:

- **The C64's bit cell is not constant.** The send loop is straight-line code, so its cell is 94 to 96 cycles, but a VIC-II badline steals about 40 cycles from whichever cell it lands in, and one or two of every eight bits were 136 to 139 cycles in every byte sent with the screen on. The drive tolerates it because every bit is handshaken; a loader with cycle-counted loops on the drive side does not, which is why fast loaders blank the screen or sit in the border. Pitfalls `gcr_timing_assumes_stock_drive`, `fastloader_dd00_write_corrupts_resident` and `raster_irq_during_serial_io` are the three places this bites.
- **The EOI window the C64 applies as listener is 539 cycles, not 256.** ACPTR writes `1` to CIA1 timer B's high byte and force-loads the timer; it never writes the low byte, whose latch is left at whatever the last user set, so the count that ran here was `$01FF`, not `$0100`. That is arithmetic from the trace (539 = 511 plus the loop's overhead), not a measurement of the latch (not measured here). The send-side timeout in "Drive-Not-Ready and Timeout Errors" below writes `4` the same way, so "about 1,024 cycles" is the nominal count and the one that runs is likely `$04FF`, 1,279 cycles; a run in which it fires was not produced (see the caveat).
- **The drive answers ATN by hardware, not by code.** DATA was low 12 cycles after the ATN store, in both runs, before the drive's CPU could have taken an interrupt. The 1541 gates DATA from ATN in logic, and the KERNAL's 1 ms wait before it looks is for the drive's *software* to catch up, not for the line.

**What this measures and what it does not.** The drive rows are VICE's 1541 and nothing else: they are the reply times of an emulated 6502 running the 325302-01+901229-05 ROM under VICE's drive timing, and the real spread across drives, ROM revisions and third-party devices is not in them. The device-not-present path was traced too, in a run with no disk mounted and `-drive8type 0 +drive8truedrive +busdevice8` in place of the drive flags. An earlier version of this paragraph said that run could not be produced and that something still answered ATN; it had been read from a log holding five runs appended (`log on` appends to an existing file, so a log shared between runs must be split per run before it is parsed), and only the first run in it, made with a disk mounted, had been looked at. With nothing on the bus the trace matches the drive run to the cycle up to the test: ATN store at `$ED33`, DATAHI at +40, the second DATAHI at +1,087, the `$EEA9` read at +1,103. There it returns DATA high, the `BCS` at `$ED47` takes the `$EDAD` path, and ATN is released at `$EDC3` 65 cycles after the test read, so the 1,103 window is confirmed from the refusal itself. Not one byte is sent, which is why the send-side timer at `$ED92` was still not seen to fire: that needs a device that answers ATN and then never acknowledges. The `CHKIN` that followed put TALK on the bus at cycle 3,016,512, released ATN at 3,017,723, ran the talk turnaround regardless, and then waited at `$EEA9` for a CLK edge from cycle 3,019,237 to the 4,500,000 limit: the hang "Drive-Not-Ready and Timeout Errors" below describes, with no timeout. The monitor's drive-side breakpoints (`dev 8`, or the `8:` address prefix) were not tried; everything here is the C64's view of the bus.

---

## Drive Commands

### High-Level KERNAL Interface

The standard way for C64 programs to communicate with a disk drive is via the KERNAL file I/O layer. The typical sequence for loading a file:

```asm
; Set logical file number, device, secondary address (channel)
; LFN=1, device=8, SA=0 (load to original address)
LDA #1
LDX #8
LDY #0
JSR $FFBA   ; SETLFS

; Set filename
LDA #<filename_len
LDX #<filename_addr
LDY #>filename_addr
JSR $FFBD   ; SETNAM

; LOAD: A=0 (load), A=1 (verify)
LDA #0
LDX #<dest_addr_lo
LDY #<dest_addr_hi
JSR $FFD5   ; LOAD
```

For arbitrary file access (read/write):

```asm
JSR $FFC0   ; OPEN  — opens the file (uses LFN/device/SA from SETLFS/SETNAM)
JSR $FFC6   ; CHKIN  — redirect character input from file
JSR $FFCF   ; CHRIN  — read one byte
JSR $FFC9   ; CHKOUT — redirect character output to file
JSR $FFD2   ; CHROUT — write one byte
JSR $FFCC   ; CLRCHN — restore default I/O channels
JSR $FFC3   ; CLOSE  — close the file
```

See `../hardware/kernal-routines-reference.md` for the full register contracts, error-status handling, and secondary address conventions for each jump-table entry.

### Secondary Addresses and Channels

The secondary address (SA) passed to SETLFS encodes the channel number and access type:

| Secondary address | Meaning |
|------------------|---------|
| 0 | LOAD (drive sends file to C64 memory) |
| 1 | SAVE (C64 sends file to drive) |
| 2–14 | Arbitrary I/O channels |
| 15 | Command/status channel |

The **command channel** (SA=15, device=8) is a special bidirectional channel for sending DOS commands to the drive and reading the drive status. To scratch a file:

```
OPEN 1,8,15,"S0:FILENAME"
```

Common drive commands sent to the command channel:

| Command | Example | Effect |
|---------|---------|--------|
| SCRATCH | `S0:FILENAME` | Delete file |
| RENAME | `R0:NEW=OLD` | Rename file |
| COPY | `C0:DST=0:SRC` | Copy file |
| VALIDATE | `V0` | Rebuild BAM (like CHKDSK) |
| INITIALIZE | `I0` | Force drive to re-read BAM |
| NEW | `N0:NAME,ID` | Format disk |
| BLOCK-READ | `B-R chn drv trk sec` | Read arbitrary sector |
| BLOCK-WRITE | `B-W chn drv trk sec` | Write arbitrary sector |
| MEMORY-READ | `M-R addrlo addrhi len` | Read drive RAM/ROM |
| MEMORY-WRITE | `M-W addrlo addrhi len data` | Write drive RAM |
| MEMORY-EXECUTE | `M-E addrlo addrhi` | Execute code in drive RAM |

Reading from the command channel after any operation returns the drive status string: a 2-digit error code, message text, track number, sector number, and newline. Error code `00` means no error.

### Sequential vs Random Access Files

**Sequential files** (PRG, SEQ, USR types) are stored as a linked chain of 256-byte sectors (254 bytes of data per sector; first 2 bytes are next-track/next-sector pointers). Reading is strictly forward.

**Random access files** (REL type) allow seeking to arbitrary records. They use a fixed record length declared at file-open time and maintain side-sectors — dedicated bookkeeping sectors that map logical record numbers to physical track/sector locations. REL files are rarely used in demo/game code but common in productivity applications. The on-disk layout (directory entry bytes, side-sector fields, record padding, the P command's byte order) is decoded from images the 1541 wrote in `c64-file-formats.md`, ".D64", under "REL file".

### The 1541 DOS Error Codes

The status line is `cc,message,tt,ss` followed by a CR: a two-digit code, the text, then a track and a sector in decimal. The 1541 ROM assembles it at `$E6C7` into the buffer at `$02D5`: two BCD digits from the code, a comma, the text looked up in the table below, a comma, the track, a comma, the sector (rung 1: the `dos1541-325302-01+901229-05` image in `/opt/homebrew/opt/vice/share/vice/DRIVES/`, bytes `$E6C7`–`$E705`). Every code the ROM can put in that line is in this table. The message column is the text field exactly as it comes back, including the leading space some messages have; the "Provoked" column says whether the recipe `../recipes/kickassembler/dos-error-codes.md` produced that reply in VICE x64sc 3.10 (rung 1) or whether the text is only read from the ROM.

| Code | Message field | Cause | Class | Provoked |
|---|---|---|---|---|
| 00 | ` OK` | no error; the line reads `00, OK,00,00` | none | yes |
| 01 | ` FILES SCRATCHED` | the reply to SCRATCH; the track field is the number of files removed, so `01, FILES SCRATCHED,00,00` means nothing matched | none | yes (`S0:T` after writing T: `01, FILES SCRATCHED,01,00`) |
| 20 | `READ ERROR` | block header not found (job code 2) | media | ROM text only |
| 21 | `READ ERROR` | no sync found (job code 3): unformatted track, no disk, or the drive did not come up to speed | media | ROM text only |
| 22 | `READ ERROR` | data block not found after the header (job code 4) | media | ROM text only |
| 23 | `READ ERROR` | checksum error in the data block (job code 5) | media | ROM text only |
| 24 | `READ ERROR` | job code 6, and also job code 0 (the ROM maps both here); the 1541 manual calls it a byte-decoding error (rung 4) | media | ROM text only |
| 25 | ` WRITE ERROR` | write-verify mismatch (job code 7) | retry, then media | ROM text only |
| 26 | ` WRITE PROTECT ON` | write attempted with the notch covered (job code 8) | user error | yes, in a side run with `-attach8ro`: `26, WRITE PROTECT ON,18,00` |
| 27 | `READ ERROR` | checksum error in the block header (job code 9) | media | ROM text only |
| 28 | ` WRITE ERROR` | no sync after the data block was written, a long data block (job code 10) | media | ROM text only |
| 29 | ` DISK ID MISMATCH` | the sector header's ID is not the one in the BAM (job code 11): a disk was changed without INITIALIZE, or a disk was formatted over | user error | ROM text only |
| 30 | `SYNTAX ERROR` | the command parser could not make sense of the string (issued at `$C263`, `$C923`, `$CC2B`, `$D837`) | program bug | yes (`R0:A`, a RENAME with no `=`) |
| 31 | `SYNTAX ERROR` | the command letter does not exist, or the letter after `M-` or `B-` is not one the DOS has (`$C175`, `$C8C1`, `$CB4B`, `$CC26`) | program bug | yes (`XYZ`) |
| 32 | `SYNTAX ERROR` | the command string is too long (`$C2D7`) | program bug | ROM text only |
| 33 | `SYNTAX ERROR` | a wildcard in a name where none is allowed (`$D8F0`, `$EE14`) | program bug | yes (`T*,S,W`) |
| 34 | `SYNTAX ERROR` | no file name after the command (`$C1F3`) | program bug | yes (`N` alone) |
| 39 | ` FILE NOT FOUND` | raised at one site only, `$E7C0`; that it is the `&` utility-loader command's not-found case is rung 4 | user error | ROM text only |
| 50 | ` RECORD NOT PRESENT` | REL file: positioned past the last record; the DOS also reports it when a write extends the file (`$D9BE`, `$E169`, `$E449`) | program bug, or expected when extending | ROM text only |
| 51 | `OVERFLOW IN RECORD` | REL file: more bytes written than the record length (`$E297`) | program bug | ROM text only |
| 52 | ` FILE TOO LARGE` | REL file: the record position would need more blocks than the disk has (`$E363`) | program bug | ROM text only |
| 60 | ` WRITE FILE OPEN` | opening a file that is still open for write, an unclosed entry (`$D957`) | program bug | ROM text only |
| 61 | ` FILE NOT OPEN` | a data channel used with no file open on it (`$CFF8`) | program bug | ROM text only |
| 62 | ` FILE NOT FOUND` | the name is not in the directory (`$CAE1`, `$D945`); OPEN on the C64 side still returns C=0 | user error | yes (`NOFILE,S,R`) |
| 63 | ` FILE EXISTS` | open for write on a name that exists, without `@` (`$CAEF`, `$D8EB`) | user error | yes (`T,S,W` a second time) |
| 64 | ` FILE TYPE MISMATCH` | the type in the open string is not the entry's type (`$C982`, `$D965`, `$E223`) | program bug | yes (`T,P,R` on a SEQ file) |
| 65 | `NO BLOCK` | B-A on a block already allocated; the track and sector fields give the next free block, or `00,00` if none (`$CD31`) | program bug | ROM text only |
| 66 | `ILLEGAL TRACK OR SECTOR` | a block command named a track or sector that does not exist; the fields echo the request (`$D54D`) | program bug | yes (`B-R 2 0 40 0`: `66,ILLEGAL TRACK OR SECTOR,40,00`) |
| 67 | `ILLEGAL TRACK OR SECTOR` | a file chain or the BAM points at a block that does not exist (`$DC01`, `$E202`, `$F1DA`); same text as 66 | media | ROM text only |
| 70 | `NO CHANNEL` | no drive buffer free: the 1541 lends four to data channels (seven sites, among them `$CBA0`, `$D212`, `$E214`) | program bug | yes (a fifth `#` open) |
| 71 | `DIR ERROR` | the BAM disagrees with itself while allocating (`$F1F5`, `$F246`); VALIDATE rebuilds it | media | ROM text only |
| 72 | ` DISK FULL` | no free block, or no free directory entry (`$F15A`) | user error | ROM text only |
| 73 | `CBM DOS V2.6 1541` | the power-on message, put there at reset (`$EBD5`); also raised as an error at `$D575` when the BAM's DOS-version byte is not the ROM's `$41` and a write was attempted | none on the first read; media after an access | yes (first read) |
| 74 | `DRIVE NOT READY` | no disk, or the drive could not read it (job code 15, and `$C41B`) | user error | yes, in a side run with no image attached: `74,DRIVE NOT READY,00,00` |

The provoked lines are the twelve on the recipe's screenshot plus the two side runs. The side runs used the same PRG; `-attach8ro` before `-8 disk.d64` attaches the image read-only and the write step answered 26 (an `-attach8rw` option also exists), and a run with no `-8` at all answered 74 on the first OPEN. For codes marked "ROM text only" the message field is assembled from the table below by the same routine, so the text is rung 1; the cause column for those rows is from the 1541 manual and the ROM's call sites, and the track and sector fields were not measured.

The class column is for an agent deciding what to do with the line: **retry** means try the operation again once, **media** means the disk or drive is at fault and no retry will help, **user error** means the program is fine and the person needs to act (insert a disk, free space, remove a file), **program bug** means the command string or call sequence is wrong. Codes 20 to 29 all carry the failing track and sector.

**How the text is stored.** The message table runs from `$E4FC` to `$E5D4`, and a word table from `$E5D5` to `$E609` follows it (rung 1). An entry is one or more BCD code bytes followed by the text; the first and the last byte of a text carry bit 7 set, which is how the reader finds the ends, and several codes share one text (`20 21 22 23 24 27` precede `READ ERROR`, `25 28` precede `WRITE ERROR`, `30`–`34` precede `SYNTAX ERROR`, `39 62` precede `FILE NOT FOUND`, `66 67` precede `ILLEGAL TRACK OR SECTOR`). Nine words are stored once and referred to by a byte below `$10`:

| Token | Word | At |
|---|---|---|
| `$03` | FILE | `$E5E1` |
| `$04` | OPEN | `$E5E6` |
| `$05` | MISMATCH | `$E5EB` |
| `$06` | NOT | `$E5F4` |
| `$07` | FOUND | `$E5F8` |
| `$08` | DISK | `$E5FE` |
| `$09` | ERROR | `$E5D5` |
| `$0A` | WRITE | `$E5DB` |
| `$0B` | RECORD | `$E603` |

The lookup at `$E706` scans from `$E4FC` for a byte equal to the code, skips to the text, and copies it byte by byte; a byte below `$20` is a token, and the copier at `$E754` writes a space and then looks the token up through the same routine (the scan runs on past `$E5D5` into the word table). That space is why `62` reads `62, FILE NOT FOUND` with a space after the comma while `31` reads `31,SYNTAX ERROR` without one: a message that starts with a token gets the token's space, a message that starts with a literal letter does not, and `00` has its space stored as a literal `$A0`. Entry 62 is the three bytes `83 06 87` at `$E58F`, tokens FILE, NOT, FOUND with the end bits on the first and last. A code that is not in the table at all comes back with an empty text field; the scan stops at `$E60A`.

**D64 error bytes.** The per-sector error byte a `.d64` image can carry (683 bytes after the sector data, see `c64-file-formats.md`) is not the DOS number. It is the drive's job return code, the value the sector routines hand back, and the conversion to a DOS number is at `$E60A`–`$E62C` (rung 1): the code is masked to its low four bits; 0 becomes 24, 15 becomes 74, and anything else is ORed with `$20` and decremented twice, which reads as a decimal code because the results stay below `$2A`.

| Byte in the image | DOS code | Message |
|---|---|---|
| `$01` | none | sector read cleanly |
| `$02` | 20 | READ ERROR, header not found |
| `$03` | 21 | READ ERROR, no sync |
| `$04` | 22 | READ ERROR, data block not found |
| `$05` | 23 | READ ERROR, data checksum |
| `$06` | 24 | READ ERROR |
| `$07` | 25 | WRITE ERROR, verify |
| `$08` | 26 | WRITE PROTECT ON |
| `$09` | 27 | READ ERROR, header checksum |
| `$0A` | 28 | WRITE ERROR |
| `$0B` | 29 | DISK ID MISMATCH |
| `$0F` | 74 | DRIVE NOT READY |

A `$00` byte is treated as no error by image tools. So a D64 can carry 20 to 29 and 74 and nothing else; the 3x, 5x, 6x and 7x codes are conditions of a command or a file, not of a sector, and no image byte produces them. That the image's byte is the job code is the D64 format's convention (rung 4, from the format's documentation); the arithmetic from job code to DOS number is the ROM's. Which of these bytes VICE's 1541 emulation reproduces on a read is measured in `../pitfalls/loader.md` (`d64_error_byte_is_a_controller_code`): VICE 3.10 honours `$02`, `$03`, `$04`, `$05`, `$09` and `$0B` and ignores `$07`, `$08` and `$0F`, and a single sector flagged `$03` or `$0B` reports 20 rather than 21 or 29 unless the whole track carries the code.

---

## Identifying the drive over the command channel

`M-R` (memory read) on the command channel returns raw bytes from the drive's own address space, and each DOS keeps its power-on message in ROM at a fixed place. Four bytes therefore say which firmware is answering. The same four bytes are the correct form of the "is this a real 1541?" test that a GCR fast loader wants before it uploads drive code (`../pitfalls/loader.md`, `gcr_timing_assumes_stock_drive`).

**Where the string is** (rung 1: the bytes of the drive ROM images VICE 3.10 ships in `/opt/homebrew/opt/vice/share/vice/DRIVES/`). In the 1541 the error-message table holds entry 73 at `$E5B6`: the number byte `$73`, then `CBM DOS V2.6 1541` from `$E5B7` to `$E5C7`, with bit 7 set on the first text byte (`$C3`) and on the last (`$B1`); that is how the table marks a message's ends. The same entry in the other images:

| VICE image | Drive | Text at `$E5BF` | Bytes at `$E5C4`–`$E5C7` | Byte at `$E5C3` |
|---|---|---|---|---|
| `dos1541-325302-01+901229-05` | 1541 | `V2.6 1541` | `31 35 34 B1` — "1541" | `$20` |
| `dos1541ii-251968-03` | 1541-II | `V2.6 1541` | `31 35 34 B1` — identical | `$20` |
| `dos1540-325302+3-01` | 1540 | `V2.6 V170` | `56 31 37 B0` — "V170" | `$20` |
| `dos1571-310654-05` | 1571 | `V3.0 1571` | `31 35 37 B1` — "1571" | `$20` |
| `dos1571cr-318047-01` | 1571 (C128DCR) | `V3.1 1571` | `31 35 37 B1` — "1571" | `$20` |
| `dos1570-315090-01` | 1570 | `V3.0 1570` | `31 35 37 B0` — "1570" | `$20` |
| `dos1581-318045-02` | 1581 | `FF FF FF FF …` | `FF FF FF FF` | `$FF` |

The 1581's ROM (32 KB from `$8000`) has nothing at that address. Its message is `COPYRIGHT CBM DOS V10 1581`: entry 73 at `$A6D0`, text from `$A6D1`, with "1581" at `$A6E7`–`$A6EA` (`31 35 38 B1`). The 1551 image (`dos1551-318008-01`) is a different bus (the Plus/4's parallel port, not IEC; rung 4) and is laid out differently again.

**The command.** From the 1541's handler (MEMRD, `$CB20`, rung 1 from the bytes): the letter after `M-` is compared with `R`, `W` and `E` (anything else is error 31), the address is taken from `$0203` (low byte) and `$0204` (high byte), and if the command is at least six bytes long the byte at `$0205` is the count; a shorter command, or a count of 1, returns one byte. So the full form is the six bytes `M-R` `lo` `hi` `count`, sent as the "filename" of an OPEN on secondary address 15 (or with `PRINT#`; the CR it appends is ignored). The drive then delivers `count` bytes on channel 15, the last with EOI; read them with CHRIN after CHKIN 15 (or `GET#`, one per call; `INPUT#` splits its input at a CR, a comma or a colon, so it is the wrong tool for raw bytes).

**A fragment that shows the answer.** Opens the command channel, asks for the four bytes at `$E5C4`, strips the end-marker bit and puts them at the top left of the screen (digits have the same code in PETSCII and in screen code):

```kick
show_drive_id:
    lda #15
    ldx #8
    ldy #15
    jsr $ffba          // SETLFS: logical file 15, device 8, channel 15
    lda #cmd_end-cmd
    ldx #<cmd
    ldy #>cmd
    jsr $ffbd          // SETNAM: the command text travels as the "filename"
    jsr $ffc0          // OPEN sends it
    bcs fail
    ldx #15
    jsr $ffc6          // CHKIN: channel 15 becomes the input channel
    ldy #0
loop:
    jsr $ffcf          // CHRIN: one reply byte per call
    and #$7f           // the string's last byte carries bit 7 as its end marker
    sta $0400,y
    lda #1
    sta $d800,y
    iny
    cpy #4
    bne loop
    jsr $ffcc          // CLRCHN
    lda #15
    jsr $ffc3          // CLOSE
fail:
    rts
cmd:
    .byte $4d, $2d, $52   // "M-R" in PETSCII
    .byte $c4, $e5        // address $E5C4, low byte first
    .byte $04             // byte count
cmd_end:
```

Run in VICE x64sc 3.10 (PAL) with `-drive8truedrive` and a freshly formatted `.d64` attached (rung 1): `-drive8type 1541`, `1542` (the 1541-II) and the default drive each put `1541` on the screen; `-drive8type 1571` puts `1571`; `-drive8type 1581` with a `.d81` puts four `$7F` glyphs, the `$FF` bytes with bit 7 stripped. Each glyph was matched against the character ROM's bitmap with zero differing pixels. With true drive emulation off the row stayed blank: the answer comes from the emulated drive's ROM, not from a VICE shortcut.

**`$41` is not a ROM byte.** The `$41` ("A") that detection routines sometimes go looking for is the DOS-version marker at offset 2 of the BAM sector, track 18 sector 0, written to the disk when it is formatted (rung 1: `c1541 -format test,01 d64 test.d64`, then byte 357 × 256 + 2 of the file reads `$41`). The 1541 ROM holds that constant at `$FED5` (VERNUM in the listing) and compares the BAM's byte against it. Testing for `$41` at `$E5C3` confuses the two: `$E5C3` is `$20`, the space between `V2.6` and `1541`, in every 1541-family image above, so such a test never passes.

One thing observed and not explained: in VICE, asserting ATN by hand with CLK left released did not get DATA pulled by the emulated 1541 within 330 ms, while ATN together with CLK, which is what the KERNAL does, did. Do as the KERNAL does; the mechanism was not chased.

---

## 1541 Drive ROM

The 1541 has its own 6502 at 1 MHz, 2 KiB of RAM at `$0000`–`$07FF` (rung 4) and 16 KiB of ROM at `$C000`–`$FFFF` (rung 1: the image is 16,384 bytes and its reset vector at `$FFFC` reads `$EAA0`). The firmware, CBM DOS 2.6, runs the file system by itself; the C64 only ever talks to it over the bus.

Entry points, for reading a disassembly or for code uploaded with `M-W` and started with `M-E`. The bytes are rung 1 from the `dos1541-325302-01+901229-05` image and are identical in `dos1541ii-251968-03` and, except where the table says otherwise, in the 1540 image; the names are those of the g3sl.github.io listing, which takes them from *Inside Commodore DOS* (rung 4).

| Address | First bytes | Name | What it is |
|---|---|---|---|
| `$C100` | `78 A9 F7 2D 00 1C 48` | SETLDS | turn on the drive-active LED |
| `$CB20` | `B1 6F 85 85 AD 74 02 C9 06` | MEMRD | the `M-R` handler described above |
| `$D042` | `20 D1 F0 20 13 D3 20 0E D0` | INITDR | initialise the drive: read the BAM |
| `$E5B6` | `73 C3 42 4D 20 44 4F 53` | — | error table, entry 73: `CBM DOS V2.6 1541` (the 1540 has `V170` at `$E5C4`) |
| `$E85B` | `78 A9 00 85 7C 85 79 85 7A` | ATNSRV | ATN service: where the drive goes when the C64 asserts ATN |
| `$E909` | `78 20 EB D0 B0 06` | TALK | send bytes on the bus as talker |
| `$E9C9` | `A9 08 85 98 20 59 EA 20 C0 E9` | ACPTR | receive one byte from the bus |
| `$EBE7` | `58 AD 00 18 29 E5 8D 00 18` | IDLE | the idle loop; on entry it clears the DATA OUT, CLK OUT and ATNA bits of `$1800` |
| `$F4CA` | `C9 00 F0 03 4C 6E F5` | READ | job dispatch for a read job; not a sector read itself, and it hands anything else to WRIGHT |
| `$F56E` | `C9 10 F0 03 4C 91 F6` | WRIGHT | job dispatch for a write job |
| `$F5E9` | `A9 00 A8 51 30 C8 D0 FB 60` | CHKBLK | EOR checksum over the 256-byte data block |
| `$F78F` | `A9 00 85 30 85 2E 85 36 A9 BB` | BINGCR | convert the buffer to its GCR image |
| `$FED1` | `11 12 13 15` | — | sectors per track by zone index 0–3: 17, 18, 19, 21 |
| `$FED5` | `41` | VERNUM | the DOS-version byte the formatter writes into the BAM |
| `$FED7` | `24 1F 19 12` | MAXTRK | zone boundaries: 36, 31, 25, 18 |

The listing itself is at `https://g3sl.github.io/c1541rom.html`; it annotates the 325302-01 + 901229-01 pair, and the instruction it shows at each address above agrees with the -05 bytes quoted. Most fast loaders call none of this: they upload their own drive code with `M-W` and start it with `M-E`.

**Correction (2026-09-21).** The previous table was wrong in every row: `$C100` was called the "main idle/command loop" (it is the LED routine; the idle loop is `$EBE7`), `$E505` "bump head to track 1" (it is a data byte in the error-message table: `$E500`–`$E505` hold the numbers `20 21 22 23 24 27` that share one text, `$E505` is the last of them, `$27`, and `READ` starts at `$E506` with `$D2`), `$F5E9` "transmit byte via IEC" (the block checksum) and `$F78F` "receive byte via IEC" (the GCR conversion); `$D486` is OPNIWR, open an internal write channel, not the formatter, and `$C8B6` and `$C83C` are directory-entry deletion inside the scratch code, not sector read and write. It also pointed at `pagetable.com/c64ref/1541/`, which could not be reached from here to confirm it exists; the g3sl listing above was read.

---

## Custom Code on the 1541

### Drive RAM and the Parallel Trick

The 1541 has 2 KiB of general-purpose RAM. Because the drive's 6502 operates independently of the C64's 6510, both CPUs can coordinate via the IEC bus for synchronization, enabling **parallel loading**: data is transferred over all 8 bits of the user port (Centronics-style) simultaneously rather than serially over the 1-bit IEC DATA line. Combined with bit-banging on the drive side, this achieves 10–25 KB/sec, 30–80x faster than the standard KERNAL loader.

The technique requires custom code running on the drive CPU. The C64 uploads the drive-side routine via the command channel's `M-W` (Memory Write) command, then starts it with `M-E` (Memory Execute). Once the drive routine is running, both sides enter a handshake loop using the user-port lines for data and the IEC bus for control.

### 1541 job queue and buffers

The addresses uploaded code uses to ask the controller for a sector. The rows marked "run" were exercised by `../recipes/kickassembler/drive-job-queue.md` in VICE x64sc 3.10 with true drive emulation of a 1541 (rung 1); the rest carry the names and meanings of the g3sl.github.io ROM listing (rung 4) and were not run here.

| Address | Name | Meaning | Status |
|---|---|---|---|
| `$00`–`$05` | JOBS | one job byte per buffer 0–5; bit 7 set means pending, the controller replaces it with a result code | `$01` run |
| `$06`–`$11` | HDRS | track and sector for each job, two bytes per buffer: `$06`/`$07` buffer 0, `$08`/`$09` buffer 1, up to `$10`/`$11` buffer 5 | `$08`/`$09` run: read back `12 00` |
| `$12`–`$13` | DSKID | the master disk ID the controller compares each header against; set by a seek job and by `I` | run: `00 00` until a seek, then `30 31` |
| `$16`–`$1A` | HEADER | the last header read: ID, ID, track, sector, checksum | not run |
| `$0300`–`$06FF` | buffers 0–3 | data buffers lent to channels | `$0400` and `$0600` run |
| `$0700`–`$07FF` | buffer 4 | the BAM | not run |

| Job code | Meaning | Status |
|---|---|---|
| `$80` | read the sector into the buffer | run |
| `$90` | write the buffer to the sector | not run |
| `$A0` | verify | not run |
| `$B0` | seek: find any header on the track, keep its ID | run |
| `$C0` | bump the head to track 1 | not run |
| `$D0` | jump to code in the buffer | not run |
| `$E0` | execute code in the buffer once the motor is up to speed | not run |

| Result | Meaning | Status |
|---|---|---|
| `$01` | done | seen: seek and read |
| `$02` | header not found | not seen |
| `$03` | no sync | seen: read of track 40 on a 35-track image |
| `$04` | data block not found | not seen |
| `$05` | data checksum error | not seen |
| `$07` | verify error | not seen |
| `$08` | write protect | not seen |
| `$09` | header checksum error | not seen |
| `$0A` | data block too long | not seen |
| `$0B` | ID mismatch | seen: read before any seek or `I` |
| `$10` | byte decoding error | not seen |

The result codes are the same numbers a `.d64` error block carries; `../pitfalls/loader.md`, `d64_error_byte_is_a_controller_code`, maps them to the error-channel numbers. Two more things measured by the same recipe: a job that fails leaves the error channel at `00, OK,00,00`, and a bare read of channel 15 after an `M-R` has been consumed returns one CR. `M-E` returns to the idle loop on the routine's RTS, and the host's next command waits until it does.

### Notable Fastloaders

Demoscene fastloaders that use this approach:

- **Krill's Loader** — widely used in modern demos; source published. Its v194 `loader/README` lists native support for the 1541, 1570/71, 1581, CMD FD and 1541U, and SD2IEC only through the KERNAL fallback ("slow"); NTSC support is a build option, off in the pre-built binaries. (An earlier version listed SD2IEC among the supported drives and said it was PAL/NTSC safe through CIA-timer calibration.)
- **Spindle** — lft's loader and disk-building system for the 1541 (rung 4, not checked here; an earlier version called it DreamLoad-compatible, which nothing here supports)
- **DreamLoad** — older but common in late-1990s/early-2000s releases
- **Kung Fu Flash loader** — targets flash-cart hardware with direct SD access

In this KB's toolchains, a fastloader is an assembly module linked into the PRG (Oscar64: `__asm` blocks, or a binary pulled into a `char[]` initialiser with `#embed "file.bin"`; KickAssembler: `.import binary "file.bin"` or `#import` of source). Both were built here with a 3-byte test file. Oscar64 has no object linker, so an external `.asm` cannot be linked in; an earlier version said it could, and wrote the KickAssembler directive without its dot, which 5.25 rejects as a syntax error.. The drive-side routine is a binary blob uploaded at runtime. Oscar64 or KickAssembler produce the drive-side stub as a `.BIN` and the loader includes it as a `char[]` array or embedded resource.

### Timing Considerations

The 1541's 6502 runs at 1 MHz from a 16 MHz crystal divided by sixteen, a fixed oscillator independent of the disk. What changes with the track is the bit-cell clock: a programmable counter divides the same 16 MHz by 13, 14, 15 or 16 under two "density" bits, so the longer outer tracks are written denser in time and hold more sectors (rung 4: Ruud Baltissen's page on the 1541 board, which names a 74177 as the ÷16 stage and a 74LS193 as the counter the VIA's PB5/PB6 "density bits" preload, with divisors 13, 14, 15 and 16 for tracks 1–17, 18–24, 25–30 and 31–35; not measured here). The ROM's half of that is rung 1: at `$F33C`–`$F358` the DOS compares the track against the boundary table at `$FED7` (36, 31, 25, 18), ending with a zone index of 3 for tracks 1–17 down to 0 for tracks 31–35, fetches the matching sectors-per-track from `$FED1` (21, 19, 18, 17 for indices 3 to 0), shifts the index left five places and writes it into bits 5–6 of `$1C00` with `LDA $1C00 / AND #$9F / ORA $44 / STA $1C00`. Index 3 is the fastest bit clock, index 0 the slowest.

Drives still vary (crystals have tolerances and spindles do not all turn at exactly 300 rpm), and a fast loader with cycle-counted loops on both ends has to leave room for that; the KERNAL protocol is immune because every bit is handshaken. The PAL/NTSC difference is on the C64 side only: 985,248 Hz against 1,022,727 Hz, while the drive is 1 MHz in both regions, so a loader that counts C64 cycles against drive cycles must know which C64 it is on. The `c64_pal_ntsc_diff` tool in this KB has the numbers.

**Correction (2026-09-21).** The earlier text said the drive CPU's clock was "derived from the disk rotation rate, synchronous with the GCR bit cells" and that "PAL C64 drives run at 985,248 Hz". Neither is so: the CPU clock is the crystal, only the bit clock is switched, and it is switched by track zone rather than by anything measured off the disk; the two frequencies quoted are the C64's, not the drive's.

---

## 1541 VIA registers, measured

The drive has two 6522 VIAs: VIA1 at `$1800`, whose port B is the serial bus, and VIA2 at `$1C00`, whose port B drives the mechanism and whose port A is the byte under the head. Every value below was read in VICE x64sc 3.10 with true drive emulation of a 1541 by `../recipes/kickassembler/drive-via-probe.md` (rung 1), on a disk formatted `TEST,01`, in these states:

- **rest**: after power-up, before any job; the host's `M-R` is the first command after the bare open of channel 15.
- **job**: the drive's own copy of the port, taken by uploaded code the instant a seek job's code byte came back below `$80`, motor still on. Five seeks: track 18 requested twice, then 1, 25, 31.
- **host**: the host's `M-R` of the same port after `M-E` returned, a few milliseconds later.
- **idle**: `M-R` after five seconds of C64 time with no command.
- **init**: `M-R` after `OPEN 2,8,2,"#"` and again after `CLOSE 2`; the open made the DOS initialise the disk.
- **trace**: a `-moncommands` file with `trace store 8:1c00` and no attached command, logging every write to `$1C00` over the PAL run with the writer's address and the byte.

Bit names are the DOS ROM listing's (g3sl.github.io, from *Inside Commodore DOS*, rung 4); the values are rung 1. The same picture came out byte-identical on two runs per model; PAL and NTSC differed only where the table says.

**VIA1, `$1800`, serial bus.**

| Address | Bit | Name | Read here |
|---|---|---|---|
| `$1800` | 0 | DATA IN | rest `1` both models; job `1` (all five); host `1` |
| `$1800` | 1 | DATA OUT | `0` in every state (output; DDR bit set) |
| `$1800` | 2 | CLK IN | rest `1` PAL, `0` NTSC; job `0` (all five); host `1` |
| `$1800` | 3 | CLK OUT | `0` in every state (output) |
| `$1800` | 4 | ATNA, attention acknowledge | `0` in every state (output). Set by a drive program it reads back as `1` (`11`, `90`, `13`, `93` in the runs behind `pitfalls/loader.md#atn_assert_drives_data_low_via_atna`) |
| `$1800` | 5, 6 | device number jumpers | `0 0` in every state: device 8. Another number: not measured here (x64sc 3.10 has no option to move drive 8) |
| `$1800` | 7 | ATN IN | `1` in every state of this run. Measured later with a drive program of its own (`pitfalls/loader.md#atn_assert_drives_data_low_via_atna`): `0` with ATN released, `1` with ATN asserted, PAL and NTSC, so `1` here is the asserted level, and the `M-R` reads behind this table were taken while the host still held ATN for the command (an inference from the DOS command flow, not traced). An earlier version of this row said ATN was released in all of them |
| `$1800` | all | port B | rest `85` PAL, `81` NTSC; job `81`; host `85`. Bits 0 and 2 are one instant of the bus handshake and their level-to-bit polarity is not established by this run |
| `$1801` | all | port A, unused | `00` |
| `$1802` | all | DDRB | `1A`: bits 1, 3, 4 outputs, the rest inputs |
| `$1803` | all | DDRA | `FF` |
| `$1804`-`$1805` | all | timer 1 counter | PAL `A1 00`, NTSC `54 00`: free-running, differs run to run when the program changes |
| `$1806`-`$1807` | all | timer 1 latch | `FF 01` |
| `$1808`-`$1809` | all | timer 2 counter | PAL `4C AA`, NTSC `F7 B3` |
| `$180A` | all | shift register | `00` |
| `$180B` | all | ACR | `00` |
| `$180C` | all | PCR | `01`: CA1 (ATN) interrupts on a positive edge |
| `$180D` | all | IFR | `00` |
| `$180E` | all | IER | `82`: CA1 enabled, so ATN raises the drive's IRQ |
| `$180F` | all | port A without handshake | `00` |

**VIA2, `$1C00`, disk controller.**

| Address | Bit | Name | Read here |
|---|---|---|---|
| `$1C00` | 0, 1 | stepper motor phase | rest `00`; job `00` for the first track 18 request, `10` for the second, `00` for 1, 25, 31; init `10`. The trace shows `$FA75` writing the low two bits down through `3 2 1 0 3 2 ...` at one write per half-step, 122 writes over the run's five moves (96 for the four seeks that stepped, 26 for the initialise), one write every 14.8 thousand drive cycles |
| `$1C00` | 2 | motor on | rest `0`; job `1` (all five); host `1`; idle `0`; init `1` after the open, `1` after the close. The trace's motor-on writes came from `$F987`, motor-off from `$F9ED` |
| `$1C00` | 3 | drive LED | `0` in every `M-R` and every job snapshot. On in the trace only: `$EC98` in the idle loop wrote `DE` twice, 1,108 cycles apart, during the initialise; no other write in the run had bit 3 set. A named-file open, which the ROM's `$C100` path serves: not measured here |
| `$1C00` | 4 | write-protect sense | `1` with the image attached normally, `0` with `-attach8ro` (rest `F0` against `E0`). Zero-page `$1E` (LWPT) followed it: `10` against `00` |
| `$1C00` | 5, 6 | density (bit-clock select) | rest `11`; job `10` for track 18, `11` for 1, `01` for 25, `00` for 31; this is the zone index of the Timing section above, now rung 1. Written by `$F35C` in the trace, from the requested track: the first job wrote `D4` for track 18 while the head was still on track 19 (see `$22` below) |
| `$1C00` | 7 | SYNC detected, inverted | `1` in every read but one: the NTSC host read after the track 1 seek was `74`, a sync mark under the head at that instant |
| `$1C00` | all | port B | rest `F0` (read-write image) or `E0` (read-only); job `D4 D6 F4 B4 94`; host the same except the NTSC `74`; idle `90`; init `D6` before and after the close; trace also `F7` from `$EB2A` at reset and `60` from `$F260` |
| `$1C01` | all | port A, the byte from the head | rest `54`. Read by uploaded code with byte-ready after each seek: `A5 4A 94 29`, `52 A5 4A 94`, `52 94 29 52`; GCR of long runs, as in a gap. Byte-ready only arrives with CA2 of `$1C0C` high (SOE); at rest it is low and the read loop times out |
| `$1C02` | all | DDRB | `6F`: bits 4 and 7 inputs, the rest outputs |
| `$1C03` | all | DDRA | `00`: read mode |
| `$1C04`-`$1C05` | all | timer 1 counter | PAL `85 18`, NTSC `D8 20`: free-running |
| `$1C06`-`$1C07` | all | timer 1 latch | `00 3A`: the controller's interrupt interval is `$3A00` = 14,848 drive cycles, which matches the stepper write spacing above |
| `$1C08`-`$1C09` | all | timer 2 counter | PAL `66 9B`, NTSC `70 A8` |
| `$1C0A` | all | shift register | `00` |
| `$1C0B` | all | ACR | `41`: timer 1 free-running, port A input latching on |
| `$1C0C` | all | PCR | `EC`: CA1 negative edge, CA2 output low (SOE off), CB1 negative edge, CB2 output high (read mode). The probe writes `EE` while it reads the head and puts `EC` back |
| `$1C0D` | all | IFR | `00` at rest |
| `$1C0E` | all | IER | `C0`: timer 1 enabled; that interrupt is the disk controller |
| `$1C0F` | all | port A without handshake | `54`, the same byte as `$1C01` |

Two things the seeks showed about the controller rather than the VIA. The zero-page track byte `$22` is `00` at rest, and the first job after power-up does not step: the request for track 18 found a header on track 19 (the header image at `$16`-`$1A` read `30 31 13 02 10`, ID `01`, track 19) and left `$22` at `13`; only the second request for track 18 moved the head, two half-steps. And a job that fails to step still sets the density bits for the track it was asked for. Rung 1 for VICE's 1541; whether the initial head position of 19 is the emulator's or a real drive's power-on position is not established here.

Related pitfall: `../pitfalls/loader.md`, `gcr_timing_assumes_stock_drive`, for what happens when uploaded code assumes these bit clocks on a drive that is not a stock 1541.

## 1541 memory map

The 6502 in the drive sees 2 KiB of RAM, two VIAs and 16 KiB of ROM. Names and meanings are the g3sl.github.io ROM listing's (rung 4); "run" marks a location read or exercised here or by `../recipes/kickassembler/drive-job-queue.md` (rung 1); the ROM start is rung 1 from the image.

| Address | Name | What the DOS keeps there | Status |
|---|---|---|---|
| `$00`-`$05` | JOBS | job code per buffer, result code when done | run |
| `$06`-`$11` | HDRS | track and sector per buffer | run |
| `$12`-`$13` | DSKID | master disk ID | run |
| `$16`-`$1A` | HEADER | last header read: ID, ID, track, sector, checksum | run: `30 31 12 03 10` after the seek to 18 (PAL) |
| `$1C` | WPSW | write-protect switch changed | run: `01` at rest |
| `$1E` | LWPT | last write-protect state | run: `10` read-write, `00` read-only |
| `$20` | DRVST | drive status | run: `30` after a job (an earlier build of the probe printed it) |
| `$22` | DRVTRK | track under the head | run: `00` at rest, then the track of the last job |
| `$30`-`$31` | BUFPNT | pointer to the active buffer | listing |
| `$3E` | CDRIVE | active drive, `$FF` when idle | listing |
| `$3F`, `$41` | JOBN, NXTJOB | last and next job slot | listing |
| `$44` | WORK | scratch; the zone index during the density write | listing, ROM |
| `$48` | ACLTIM | head acceleration timer | listing |
| `$4A` | STEPS | half-steps left to move | listing |
| `$62`-`$63` | NXTST | pointer to the stepping routine, `$FA05` when not stepping | listing |
| `$6F`-`$74` | T0-T4 | temporaries | listing |
| `$7F` | DRVNUM | drive number, `0` | listing |
| `$80`-`$81` | TRACK, SECTOR | the track and sector of the current file operation | listing |
| `$82`-`$84` | LINDX, SA, ORGSA | current channel index and secondary address | listing |
| `$99`-`$A6` | BUFTAB | pointers into buffers 0 to 4, the command buffer and the error buffer | listing |
| `$F9` | JOBNUM | current job number | listing |
| `$0100`-`$01FF` | stack | the 6502 stack; the trace showed SP at `$43`-`$45` | run |
| `$0200`-`$0229` | CMDBUF | the command as received on channel 15 | listing |
| `$022A` | CMDNUM | command code | listing |
| `$022B`-`$023D` | LINTAB | secondary address to channel table | listing |
| `$023E`-`$0243` | CHNDAT | last data byte per channel | listing |
| `$0274` | CMDSIZ | command length | listing |
| `$027A`-`$027F` | FILTBL | filename pointers | listing |
| `$02B1`-`$02D4` | NAMBUF | directory name buffer | listing |
| `$02D5`-`$02F8` | ERRBUF | the error channel text | listing |
| `$02FA`-`$02FD` | NDBL, NDBK | blocks free | listing |
| `$02FE` | PHASE | stepper phase | listing |
| `$0300`-`$03FF` | buffer 0 | data buffer lent to a channel | listing |
| `$0400`-`$04FF` | buffer 1 | data buffer; read into by both recipes | run |
| `$0500`-`$05FF` | buffer 2 | data buffer | listing |
| `$0600`-`$06FF` | buffer 3 | data buffer; both recipes upload code here with only channel 15 open | run |
| `$0700`-`$07FF` | buffer 4 | the BAM once a disk is initialised | listing |
| `$0800`-`$17FF` | — | no RAM in a stock 1541; what a read returns here: not measured | — |
| `$1800`-`$180F` | VIA1 | serial bus; table above | run |
| `$1C00`-`$1C0F` | VIA2 | disk controller; table above | run |
| `$C000`-`$FFFF` | ROM | CBM DOS 2.6; entry points in the section "1541 Drive ROM" | run |

Which buffers uploaded code may take: with only channel 15 open, buffers 1 and 3 were free in both recipes and nothing overwrote them between commands (rung 1 for that situation). A file channel takes a buffer from this pool, and the BAM takes buffer 4 once a disk is initialised (listing, rung 4); a loader that opens files while its code is resident must check the channel-to-buffer table before choosing, and that check is not measured here. The mirror addresses between `$0800` and `$17FF` and the register repeats within `$1800`-`$1BFF` and `$1C00`-`$1FFF` are not measured here.

---

## SD2IEC and Ultimate II+

These modern IEC-compatible peripherals are **out of scope** for this KB's primary hardware target (stock C64 PAL/NTSC).

**SD2IEC** is a microcontroller-based IEC device that reads/writes SD cards. It emulates the 1541 command set well enough for most purposes but has no drive CPU: it cannot execute drive-side code, making all `M-W`/`M-E` based fastloaders non-functional. Some fastloaders run on it through the KERNAL instead: Krill's v194 README supports SD2IEC only through its KERNAL fallback, which it calls "slow". (An earlier version said Krill's loader had an SD2IEC codepath.)

**Ultimate II+** (Gideon's Logic) is an FPGA cartridge that includes a 1541 emulation that runs drive code (rung 4, not checked here). An earlier version also credited it with an "FBI fast loader" in its firmware; nothing here supports that. Krill's v194 README lists the 1541U among its natively supported drives. It is used for hardware-accurate fast loading on modern C64 setups but is cartridge-extended hardware outside the stock scope.

Both devices handle `.D64`, `.D71`, `.D81`, `.T64`, and `.PRG` files from SD cards, making them the most common way demosceners develop on real hardware today.

---

## Pitfalls

### Standard IEC Load Speed (~300 bytes/sec)

A full 35-track 1541 disk holds 664 blocks × 254 data bytes = 168,656 bytes (about 165 KiB). Measured in VICE x64sc 3.10 (PAL, default 1541-II with true drive emulation), `LOAD"BIG",8,1` of a 50,000-byte file written by `c1541` took 121,174,229 cycles from `JSR $FFD5` at `$E175` to its return, 123 s or about 406 bytes/s including the directory search; at that rate a full disk takes about 7 minutes. (An earlier version said "664 KB usable", over 30 minutes for a full disk and about 2.5 minutes for 50 KB; 664 is the block count.) Nearly every released demo and game therefore uses a custom fastloader. Plan for fastloader integration from the start of any project targeting real hardware.

### VICE Timing Differences with Real Hardware

x64sc 3.10 started with `-default` already runs drive 8 as a 1541-II (`Drive8Type=1542`) with true drive emulation on (`Drive8TrueEmulation=1`, both read with the monitor's `resourceget`). An earlier version said the default configuration does not emulate IEC timing. Emulation is still not a real drive: a loader with cycle-counted IEC routines can pass in VICE and fail on hardware, or the reverse. `-drive8truedrive` and `+drive8truedrive` turn it on and off (x64sc `-help`: "hardware-level emulation of disk drive"), which matters when a saved configuration has turned it off; `-drivesound` plays the head noise; an earlier version of this sentence spelled them `--drivesound 1 --drive8truedrive 1`, which x64sc 3.10 refuses: its options take a single dash and no argument.

The `c64_pal_ntsc_diff` MCP tool and `../hardware/pal-ntsc-reference.md` detail the clock-rate differences that affect CIA-timer-based IEC routines.

### CIA2 Contention: IEC Bus vs RS-232

CIA2 Port B (`$DD01`) is the user port's eight data lines (RS-232 or a parallel cable); Port A (`$DD00`) holds the IEC outputs in bits 3–5, the RS-232 TXD line in bit 2 and the VIC bank in bits 0–1. A parallel fast loader drives Port B freely (nothing there touches the bus), but every write to Port A must be a masked read-modify-write, and the bug to look for is a loader, or an interrupt handler switching VIC banks, that stores a whole byte to `$DD00` and thereby releases or asserts ATN, CLK or DATA. An earlier version of this paragraph had the IEC outputs at bits 2–4 and the fault on Port B; both were wrong.

Code that uses CIA2 for RS-232 (via the user port ACIA emulation) must ensure IEC I/O is not simultaneously active. The KERNAL does not serialize these; user code must guard access.

### Drive-Not-Ready and Timeout Errors

The KERNAL has one timeout on the bus, and it is short and narrow. The byte-send routine arms CIA1 timer B for about 1,024 cycles (it writes 4 to the timer's high byte at `$ED92`) while it waits for a listener to acknowledge; if nothing answers it sets the READST bit and returns. An absent or unpowered drive is caught before that, and not by the timer: `LISTEN` and `TALK` look at DATA about 1,100 cycles after asserting ATN, and if no device is holding it low they take the device-not-present path at `$EDAD` without sending a byte (measured in the no-drive run under "IEC bit timing, measured" above; an earlier version of this paragraph credited the timer with that detection). The talk turnaround and the byte-receive waits have no timeout at all: a drive that has accepted TALK and never pulls CLK leaves the CPU waiting for ever, which is the start-up hang measured in VICE and described on `recipes/oscar64/high-score-persist.md`. An earlier version of this page said "approximately 64 ms" and implied every stall returns; neither is so. Check READST after every OPEN/CHKIN/CHKOUT for the errors the KERNAL can report, and do not rely on it to return from a stalled transfer.

### Directory Track Corruption

Track 18 is the most-written track on a 1541. The directory and BAM are updated on every file write or scratch. What corrupts the BAM is a write file left open, not repeated use. Measured in VICE x64sc 3.10 with true drive emulation: a BASIC program wrote twelve 7-block SEQ files and scratched nine, closing every file, and left 643 blocks free, exactly 664 − 3 × 7, which `c1541 -validate` did not change. The same program followed by one file opened for write and never closed left a 0-block `*SEQ` entry and 636 blocks free; `c1541 -validate` removed the entry and returned the 7 lost blocks, back to 643. (An earlier version said repeated use without VALIDATE corrupts the BAM.) VALIDATE (`V0` on the command channel) rebuilds the BAM by walking every file chain and reconstructing the bitmap. Running VALIDATE on a disk with active writes will abort any open file writes. The c1541 utility (bundled with VICE) can perform offline BAM repair.

---

## See Also

- `../runtime/vice-reference.md` — VICE emulator configuration for IEC/drive emulation
- `c64-file-formats.md` — Disk image formats (.D64, .D71, .D81, .G64)
- `../hardware/kernal-routines-reference.md` — KERNAL jump table: SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, LOAD, SAVE, LISTEN, TALK, IECIN, IECOUT, READST, UNLSN, UNTLK

---

## Sources

- KERNAL ROM 901227-03 and the drive ROM images (1540 325302+3-01, 1541 325302-01+901229-05, 1541-II 251968-03, 1570 315090-01, 1571 310654-05, 1571CR 318047-01, 1581 318045-02) as shipped with VICE 3.10 in `/opt/homebrew/opt/vice/share/vice/C64/` and `…/DRIVES/` — every byte, address and instruction quoted above was read from these (rung 1).
- VICE x64sc 3.10, `-drive8truedrive`, drive types 1541, 1541-II, 1571 and 1581, and `c1541` — the `$DD00` readings, the reset-state reading, the `M-R` runs and the BAM byte (rung 1).
- *C1541 ROM disassembly with comments*, `https://g3sl.github.io/c1541rom.html` — the routine names SETLDS, MEMRD, INITDR, ATNSRV, TALK, ACPTR, IDLE, READ, WRIGHT, CHKBLK, BINGCR, VERNUM, MAXTRK and OPNIWR; the page credits its labels and comments to *Inside Commodore DOS* by Richard Immers and Gerald G. Neufeld, 1984 (rung 4).
- Ruud Baltissen, *1541: Transferring data*, `http://baltissen.org/newhtm/1541a.htm`, read directly — the 16 MHz clock, the 74177 ÷16 stage for the 6502, the 74LS193 counter preloaded from the VIA's PB5/PB6 density bits, and the divisors 13–16 by track zone (rung 4). An earlier draft of this list also cited the Commodore 1540/1541 Service Manual for those figures; it was not consulted, and the figures came from this page.
- The KERNAL labels CLKHI, CLKLO, DATAHI, DATALO, DEBPIA, SCATN, ISOUR and IOINIT are the names used in the published KERNAL source listings (rung 4).
