---
chip: SID
---

# SID Hardware Reference

The MOS 6581/8580 Sound Interface Device (SID) is the C64's three-voice
synthesizer chip, mapped at $D400-$D41F (29 registers occupy $D400-$D41C;
$D41D-$D41F are unused). The chip combines digital oscillators, ADSR
envelope generators, ring modulation, oscillator sync, a multi-mode
analog filter, two paddle A/D converters, and a 4-bit master-volume DAC.

This reference covers both the original 6581 (used 1982-1986) and the
later 8580 (1987-1992). Most software runs on both, but the two parts
differ audibly in three places: filter
cutoff curve, sample replay via the volume register, and combined
waveform output level.

## Overview

The SID is a mixed-signal IC: digital control registers feed three
phase-accumulator oscillators, whose outputs pass through a digital
waveform selector, a per-voice 8-bit envelope multiplier, an optional
analog multi-mode filter, and finally a 4-bit master-volume DAC. The
chip uses a 5-bit address bus internally; the upper bits of $D4xx are
decoded by the C64's PLA. The register window is mirrored every 32
bytes throughout $D400-$D7FF on the C64. On the C128 the mirrors stop
at $D4FF: $D420-$D4FF still alias the SID, and nothing above it does.
Writes to $D5xx-$D7xx never reach the chip and reads there return other
C128 I/O (the MMU at $D500, the VDC at $D600), measured in VICE x128 in
both C64 mode and native mode. An earlier revision of this page said
the C128 did not mirror at all and reserved $D420-$D4FF for a second
SID; neither is so.

### Voice architecture

Each of the three voices contains:

- A 24-bit phase accumulator clocked at the system clock (PAL 985248 Hz
  / NTSC 1022727 Hz). The accumulator is incremented by the 16-bit
  frequency value in FREQLO/FREQHI every cycle.
- A waveform selector that can emit triangle, sawtooth, pulse (with
  12-bit programmable duty cycle), noise (from a 23-bit LFSR), or any
  AND-combination of those four.
- An 8-bit ADSR envelope generator with 16 attack rates and 16
  decay/release rates (decay and release share a rate table; sustain
  is a level, not a rate).
- A control register with GATE/SYNC/RING/TEST bits in the low nibble
  and the four waveform-enable bits in the high nibble.

Voice 3 differs from the others in two ways: its oscillator output is readable at
$D41B (OSC3) and its envelope output is readable at $D41C (ENV3),
making it the C64's only built-in random-number source and a free
LFO (the noise setup for seeding, and the LFSR it should seed rather than
be read every frame, are `lfsr_random` in `../techniques/maths.md`).
Voice 3 can also be muted via $D418 bit 7 without disturbing its
oscillator, which is how OSC3/ENV3 are used as control signals without
making them audible.

### Filter architecture

A single multi-mode analog filter operates on whichever voices have
their routing bit set in $D417. The filter has an 11-bit cutoff
($D415-$D416), a 4-bit resonance ($D417 high nibble), and three mode
bits in $D418 selecting low-pass (12 dB/oct), band-pass (6 dB/oct),
and high-pass (12 dB/oct). Mode bits can be combined (LP+HP produces
notch; all three on produces a phase-shifted blend). Voices not routed
to the filter bypass it and go straight to the volume DAC.

### 6581 vs 8580: what programmers care about

**Filter cutoff curve.** On the 6581 the cutoff vs register-value curve
is non-linear, roughly sigmoidal on a log scale, and varies widely
between individual chips depending on the manufacturing batch. A cutoff value that opens the filter wide on one
6581 may have almost no effect on another. On the 8580 the curve is
linear and consistent between chips.
Music tuned for one chip often sounds wrong on the other; SID players
typically ship per-chip tuning data.

**ADSR bug.** On both chips, if an AD or SR rate is reduced to a
smaller value than the envelope's internal rate counter has already
exceeded, the rate counter must wrap all the way
around its 15-bit range (up to 32768 cycles, ~33 ms at PAL) before the
envelope resumes. The bug also causes the very first cycle of attack
and decay to use the wrong rate. The usual workaround is a hard
restart (see Programming patterns).

**$D418 sample replay.** Writing rapidly-varying values to the lower 4
bits of the volume register modulates the master DAC and produces
audible clicks. On the 6581 this is loud enough to play 4-bit PCM
samples at multi-kHz rates and is the "digi" technique used
in Ghostbusters, Arkanoid, Mahoney's Musik Demo, and most C64 speech
synthesizers. On the 8580 the same writes are nearly inaudible because
the digital-to-analog stage is cleaner; the usual hardware fix is a
330-740 kΩ resistor between SID pin 26 (EXT IN) and pin 14 (GND) or
between EXT IN and +5 V, which forces some signal into the filter and
restores the click. Software-only digi techniques on stock 8580s
include combined-waveform digi and "pulse-width DAC" (PWM).

**Combined waveforms.** Combining two or more waveform-enable bits
produces a logical AND of the waveform outputs at the bit level. The
6581 combined waveform output is quieter and noisier; the 8580 produces
louder, cleaner combined waveforms. The specific bit-pattern depends on
the chip revision and even on individual chips. Tunes that rely on
combined waveforms (e.g. triangle+pulse for warm pad sounds) sound
different on 6581 vs 8580.

**Write-only registers.** Registers $D400-$D418 are write-only. Reading
one (or an unused address $D41D-$D41F, or any mirror through $D7FF)
does not return open bus: the SID drives the bus with the byte it last
held, which is the last value written to any address in its 32-byte
window ($D41D-$D41F included) or the last value read from $D419-$D41C,
and that byte fades to $00 after roughly 7k cycles on the 6581 and
roughly 660k cycles on the 8580 (measured in VICE 3.10 x64sc reSID:
held at 6.4k and gone at 7.7k cycles on the 6581 model, held at 658k
and gone at 669k on the 8580 model; real chips fade too, not measured
here). An earlier version of this page said the read gave the high
byte of the address or the last VIC-II fetch; neither ever appears: a
read of $D704 right after writing $A5 to $D401 returns $A5, not $D7.
Either way it is not register state: code that needs read-modify-write
must keep a software shadow. The $D419-$D41C registers are read-only;
writes to them are silently ignored.

**Voltage and capacitors.** The 6581 needs +12 V Vdd and uses 470 pF
filter capacitors. The 8580 runs on +9 V and uses 22 nF caps. Swapping
the chip without changing the caps gives wrong cutoff range. The 6582
label is an 8580 in a different package.

## Quick reference

The full register map. Addresses $D41D-$D41F are unused; writes change
no register, and reads return the SID's held bus byte (see Write-only
registers above), not open bus.

| Address | Name | R/W | Description |
|---------|------|-----|-------------|
| $D400 | FRELO1 | W | Voice 1 frequency low byte |
| $D401 | FREHI1 | W | Voice 1 frequency high byte |
| $D402 | PWLO1 | W | Voice 1 pulse width low byte (PW7-PW0) |
| $D403 | PWHI1 | W | Voice 1 pulse width high nibble (PW11-PW8) |
| $D404 | VCREG1 | W | Voice 1 control register (waveform / GATE / SYNC / RING / TEST) |
| $D405 | ATDCY1 | W | Voice 1 attack/decay rate |
| $D406 | SUREL1 | W | Voice 1 sustain level / release rate |
| $D407 | FRELO2 | W | Voice 2 frequency low byte |
| $D408 | FREHI2 | W | Voice 2 frequency high byte |
| $D409 | PWLO2 | W | Voice 2 pulse width low byte |
| $D40A | PWHI2 | W | Voice 2 pulse width high nibble |
| $D40B | VCREG2 | W | Voice 2 control register |
| $D40C | ATDCY2 | W | Voice 2 attack/decay rate |
| $D40D | SUREL2 | W | Voice 2 sustain level / release rate |
| $D40E | FRELO3 | W | Voice 3 frequency low byte |
| $D40F | FREHI3 | W | Voice 3 frequency high byte |
| $D410 | PWLO3 | W | Voice 3 pulse width low byte |
| $D411 | PWHI3 | W | Voice 3 pulse width high nibble |
| $D412 | VCREG3 | W | Voice 3 control register |
| $D413 | ATDCY3 | W | Voice 3 attack/decay rate |
| $D414 | SUREL3 | W | Voice 3 sustain level / release rate |
| $D415 | CUTLO | W | Filter cutoff frequency low (FC2-FC0) |
| $D416 | CUTHI | W | Filter cutoff frequency high (FC10-FC3) |
| $D417 | RESON | W | Filter resonance + voice routing |
| $D418 | SIGVOL | W | Filter mode + voice-3 mute + master volume |
| $D419 | POTX | R | Paddle X A/D converter |
| $D41A | POTY | R | Paddle Y A/D converter |
| $D41B | RANDOM | R | Voice 3 oscillator output (high 8 bits of accumulator) |
| $D41C | ENV3 | R | Voice 3 envelope output |

### Frequency formulas

Each voice's 16-bit frequency value F sets oscillator pitch by adding
F to the 24-bit phase accumulator every system clock. The audible
frequency f in Hz is:

```
f = F * Phi2 / 2^24
```

where `Phi2` is the system clock (985248 Hz PAL, 1022727 Hz NTSC).
Inverting:

```
F_PAL  = f * 16777216 / 985248   ~= f * 17.0284
F_NTSC = f * 16777216 / 1022727  ~= f * 16.4044
```

(The multipliers previously read 17.0288 and 16.4046; both were
arithmetic slips. The worked values $1167 and $1D45 below were always
computed from the exact fraction and are unchanged.)

For middle C (261.626 Hz) the PAL value is $1167; for A4 (440 Hz) it
is $1D45 (PAL). Music players ship 96-entry frequency tables (8
octaves x 12 semitones) tuned to either PAL or NTSC; a PAL tune played
on an NTSC machine sounds about 3.8% sharp (roughly two-thirds of a
semitone, 65 cents).

### ADSR rate table

All times are at a nominal 1 MHz clock; on a real C64 they are ~1.5%
longer on PAL (985,248 Hz) and ~2.2% shorter on NTSC (1,022,727 Hz).
(An earlier revision gave a single "~1.49%" for both; that was the PAL
figure only.) Decay and release share the same table; their values are
roughly 3x the matching attack value. The nominal times are the ones the
Commodore 64 Programmer's Reference Guide (1982) prints for the SID's
envelope rates; they are the chip's documented behaviour, not measured here.

| Value | Attack | Decay/Release |
|-------|--------|---------------|
| 0 | 2 ms | 6 ms |
| 1 | 8 ms | 24 ms |
| 2 | 16 ms | 48 ms |
| 3 | 24 ms | 72 ms |
| 4 | 38 ms | 114 ms |
| 5 | 56 ms | 168 ms |
| 6 | 68 ms | 204 ms |
| 7 | 80 ms | 240 ms |
| 8 | 100 ms | 300 ms |
| 9 | 250 ms | 750 ms |
| 10 | 500 ms | 1.5 s |
| 11 | 800 ms | 2.4 s |
| 12 | 1 s | 3 s |
| 13 | 3 s | 9 s |
| 14 | 5 s | 15 s |
| 15 | 8 s | 24 s |

Attack rises linearly from 0 to peak; decay and release are
exponential (the envelope counter drops in stages at 255, 93, 54, 26,
14, 6, 0). Sustain is a 4-bit level value (0-15) where 15 holds at
peak; the envelope multiplier scales the oscillator output by a value
from 0 to 255.

## Voice registers

Voice N (N = 1, 2, 3) occupies seven consecutive registers starting at
base address $D400 + 7*(N-1). All voice registers are write-only.

### $D400 — FRELO1 — Voice 1 frequency low byte (W)

**Chip:** SID

Low 8 bits (F7-F0) of the 16-bit oscillator frequency value for voice 1.
The full 16-bit value is added to the 24-bit phase accumulator every
system clock cycle. See [frequency formulas](#frequency-formulas) for
conversion to Hz.

Write low byte first then high byte for atomic frequency changes; a
single-byte update to the high byte while the low byte is stale can
glitch pitch by up to one semitone for one cycle.

### $D401 — FREHI1 — Voice 1 frequency high byte (W)

**Chip:** SID

High 8 bits (F15-F8) of the 16-bit oscillator frequency for voice 1.

| Bit | Name | Description |
|-----|------|-------------|
| 7-0 | F15-F8 | Frequency high byte |

The full frequency range 0-$FFFF maps to roughly 0-3848 Hz (PAL) or
0-3995 Hz (NTSC). Pitch resolution is ~0.06 Hz per LSB at PAL.

### $D402 — PWLO1 — Voice 1 pulse width low byte (W)

**Chip:** SID

Low 8 bits (PW7-PW0) of the 12-bit pulse-width value for voice 1. Only
meaningful when the pulse waveform bit is set in $D404. A value of
$000 holds the pulse output constantly high ($FFF), $800 gives a 50 %
square wave, and $FFF holds it low except for one accumulator step in
4096 (an earlier version of this page had the two DC levels swapped;
measured in VICE x64sc/reSID on both the 6581 and 8580 models, by OSC3
read-back and by the raw audio output: a PW=$800 square wave's rails
are exactly the PW=$000 and PW=$FFF levels, and PW=$FFF sits at the
same level as a sawtooth held at accumulator zero).

### $D403 — PWHI1 — Voice 1 pulse width high nibble (W)

**Chip:** SID

High 4 bits (PW11-PW8) of the 12-bit pulse-width value for voice 1.

| Bit | Name | Description |
|-----|------|-------------|
| 7-4 | — | Unused (writes ignored) |
| 3-0 | PW11-PW8 | Pulse width high nibble |

The 12-bit pulse width divides one oscillator period into 4096 steps.
The output is low while the accumulator's top 12 bits are below `PW`
and high for the rest of the period, so PW = $800 (= 2048) is a square
wave. Sweeping PW with a small LFO produces the SID "pulse PWM"
pads.

### $D404 — VCREG1 — Voice 1 control register (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7 | NOISE | Enable noise waveform |
| 6 | PULSE | Enable pulse waveform |
| 5 | SAW | Enable sawtooth waveform |
| 4 | TRI | Enable triangle waveform |
| 3 | TEST | Reset oscillator to zero (also halts noise LFSR) |
| 2 | RING | Ring-modulate with voice 3 oscillator |
| 1 | SYNC | Hard-sync this oscillator to voice 3 oscillator |
| 0 | GATE | 0 = release phase; 1 = attack-decay-sustain phase |

**GATE.** Setting GATE starts the attack phase. Clearing GATE starts
the release phase from whatever level the envelope is currently at.
The envelope generator has no separate "note off" register; gating is
the only way to trigger and end notes.

**TEST.** Setting TEST resets the phase accumulator to zero and holds
it there as long as TEST is set. The noise LFSR stops shifting and
keeps its contents; held long enough its bits drift to one, not zero.
Measured in VICE x64sc 3.10 (reSID), the noise output read at $D41B is
unchanged for about 35,000 cycles on a 6581 and reads $FF by about
38,000; on an 8580 it is unchanged for about 2.5 million cycles and
reads $FF by about 3.5 million. It never reads $00. Clearing TEST
shifts the register once, feeding the complement of bit 17 into bit 0
(an all-ones register reads $FE afterwards, an all-zero one $01), and
normal clocking resumes from that state; there is no fresh seed. An
earlier version said TEST forced the LFSR to zero and that release
started it from a fresh state; neither is so. TEST is used for
phase-locked drum sounds (so each note starts at the same accumulator
value) and for the "test-bit digi" technique on 8580s.

**RING.** Enables ring modulation between this voice's triangle and
voice 3's oscillator MSB. The triangle waveform must also be selected
(bit 4). Ring modulation XORs the triangle's MSB with voice 3's MSB,
producing inharmonic metallic tones. Voice 1 modulates against voice 3;
voice 2 against voice 1; voice 3 against voice 2 (each voice
ring-mods against the previous one cyclically).

**SYNC.** Hard-syncs this oscillator to voice 3. When voice 3's
oscillator MSB transitions high, this voice's accumulator is reset.
Sync pairing matches RING (voice 1 syncs to voice 3, voice 2 to
voice 1, voice 3 to voice 2).

**Waveform bits.** Multiple waveform bits can be set simultaneously;
the output is the bit-wise AND of each enabled waveform's 12-bit
output. Common combinations: TRI+PULSE for warm pad, SAW+PULSE for
biting lead, TRI+SAW for soft brass. Noise combined with any other
waveform shifts the noise LFSR's output bits to zero over time (a
known SID quirk) and is typically used as a one-shot effect with TEST
to restore the LFSR.

### $D405 — ATDCY1 — Voice 1 attack/decay rate (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7-4 | ATTACK | Attack rate (0-15, see ADSR table) |
| 3-0 | DECAY | Decay rate (0-15, see ADSR table) |

Attack rises linearly from 0 to peak in the time listed in the ADSR
rate table. Decay falls exponentially from peak to the sustain level.

### $D406 — SUREL1 — Voice 1 sustain level / release rate (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7-4 | SUSTAIN | Sustain level (0=silent, 15=peak) |
| 3-0 | RELEASE | Release rate (0-15, see ADSR table) |

Sustain is a 4-bit level; the envelope holds at `sustain * $11` ($00,
$11, $22 ... $FF) after decay completes (measured on ENV3 in VICE; an
earlier version said `sustain << 4`, which would make sustain 15 hold
at $F0, not the $FF peak). Release fires when GATE is cleared and
decays exponentially from the current envelope value to zero at the
listed rate.

### $D407 — FRELO2 — Voice 2 frequency low byte (W)

**Chip:** SID

Low 8 bits of voice 2's 16-bit oscillator frequency. Identical to
$D400 but for voice 2.

### $D408 — FREHI2 — Voice 2 frequency high byte (W)

**Chip:** SID

High 8 bits of voice 2's oscillator frequency.

### $D409 — PWLO2 — Voice 2 pulse width low byte (W)

**Chip:** SID

Low 8 bits of voice 2's 12-bit pulse-width.

### $D40A — PWHI2 — Voice 2 pulse width high nibble (W)

**Chip:** SID

High 4 bits of voice 2's pulse-width. Bits 7-4 unused.

### $D40B — VCREG2 — Voice 2 control register (W)

**Chip:** SID

Same bit layout as $D404. RING modulates voice 2's triangle against
voice 1's oscillator MSB; SYNC syncs voice 2 to voice 1.

| Bit | Name | Description |
|-----|------|-------------|
| 7 | NOISE | Enable noise waveform |
| 6 | PULSE | Enable pulse waveform |
| 5 | SAW | Enable sawtooth waveform |
| 4 | TRI | Enable triangle waveform |
| 3 | TEST | Reset oscillator |
| 2 | RING | Ring-mod with voice 1 |
| 1 | SYNC | Sync to voice 1 |
| 0 | GATE | Envelope gate |

### $D40C — ATDCY2 — Voice 2 attack/decay rate (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7-4 | ATTACK | Attack rate (0-15) |
| 3-0 | DECAY | Decay rate (0-15) |

### $D40D — SUREL2 — Voice 2 sustain level / release rate (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7-4 | SUSTAIN | Sustain level (0-15) |
| 3-0 | RELEASE | Release rate (0-15) |

### $D40E — FRELO3 — Voice 3 frequency low byte (W)

**Chip:** SID

Low 8 bits of voice 3's 16-bit oscillator frequency.

Voice 3 is the master for SYNC/RING (it is the
modulator for voice 1) and is the only voice with readable oscillator
and envelope outputs via $D41B/$D41C.

### $D40F — FREHI3 — Voice 3 frequency high byte (W)

**Chip:** SID

High 8 bits of voice 3's oscillator frequency.

### $D410 — PWLO3 — Voice 3 pulse width low byte (W)

**Chip:** SID

Low 8 bits of voice 3's 12-bit pulse-width.

### $D411 — PWHI3 — Voice 3 pulse width high nibble (W)

**Chip:** SID

High 4 bits of voice 3's pulse-width. Bits 7-4 unused.

### $D412 — VCREG3 — Voice 3 control register (W)

**Chip:** SID

Same bit layout as $D404. RING modulates voice 3's triangle against
voice 2's oscillator MSB; SYNC syncs voice 3 to voice 2.

| Bit | Name | Description |
|-----|------|-------------|
| 7 | NOISE | Enable noise waveform |
| 6 | PULSE | Enable pulse waveform |
| 5 | SAW | Enable sawtooth waveform |
| 4 | TRI | Enable triangle waveform |
| 3 | TEST | Reset oscillator |
| 2 | RING | Ring-mod with voice 2 |
| 1 | SYNC | Sync to voice 2 |
| 0 | GATE | Envelope gate |

When voice 3 is used as an LFO source (via $D41B/$D41C) it is common
to set NOISE alone (or TRI alone for a smoother LFO), set GATE, set
$D418 bit 7 (3OFF) to mute its audible output, and pick a low
frequency value so the oscillator slowly cycles.

### $D413 — ATDCY3 — Voice 3 attack/decay rate (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7-4 | ATTACK | Attack rate (0-15) |
| 3-0 | DECAY | Decay rate (0-15) |

### $D414 — SUREL3 — Voice 3 sustain level / release rate (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7-4 | SUSTAIN | Sustain level (0-15) |
| 3-0 | RELEASE | Release rate (0-15) |

## Filter

The SID's single multi-mode analog filter is shared across all three
voices and an external audio input. Each voice can be individually
routed through or around the filter; the filter mode (LP/BP/HP) and
cutoff/resonance apply globally.

### Filter signal flow

```
Voice 1 osc -> envelope -> [filter mux] -> filter -> [volume DAC] -> audio out
Voice 2 osc -> envelope -> [filter mux] /
Voice 3 osc -> envelope -> [filter mux] /        (also direct to mux)
EXT IN ----------------> [filter mux] /

Voices not routed to filter go directly to volume DAC.
Voice 3 muted by $D418 bit 7 bypasses both paths.
```

The filter cutoff is an 11-bit value across $D415 (low 3 bits) and
$D416 (high 8 bits). On the 6581 the cutoff range is roughly
30 Hz - 12 kHz; on the 8580 it is roughly 30 Hz - 12 kHz but with a
linear and consistent curve. Resonance ranges 0-15 across all chips;
the 8580 reaches noticeably higher Q before self-oscillation.

### $D415 — CUTLO — Filter cutoff frequency low (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7-3 | — | Unused (writes ignored) |
| 2-0 | FC2-FC0 | Filter cutoff low 3 bits |

The low 3 bits of the 11-bit cutoff frequency. Many tunes only update
$D416 (the high 8 bits) and leave $D415 at zero, giving 8-bit cutoff
resolution; the extra 3 bits in $D415 matter mostly for slow
sweeps.

### $D416 — CUTHI — Filter cutoff frequency high (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7-0 | FC10-FC3 | Filter cutoff high 8 bits |

The high 8 bits of the 11-bit cutoff frequency. Combined with $D415:
cutoff = ($D416 << 3) | ($D415 & 7), giving an 11-bit value 0-2047.

On the 6581 the mapping from this value to actual cutoff Hz is
chip-dependent and non-linear (roughly sigmoid on a log scale). On
the 8580 the mapping is linear and consistent. Tunes that sweep
cutoff for filter automation sound different across chip revisions.

### $D417 — RESON — Filter resonance and routing (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7-4 | RES | Filter resonance Q (0=low, 15=high) |
| 3 | FILTEX | Route external audio input through filter |
| 2 | FILT3 | Route voice 3 through filter |
| 1 | FILT2 | Route voice 2 through filter |
| 0 | FILT1 | Route voice 1 through filter |

**Resonance.** The 4-bit resonance value emphasises frequencies near
the cutoff. On the 6581 high resonance values often cause distortion
(some music relies on it); on the 8580
resonance is cleaner and reaches higher Q before clipping.

**Routing.** Each FILT bit selects whether that voice/input passes
through the filter or bypasses it. A voice with its FILT bit clear
goes straight to the volume DAC at full bandwidth (with the envelope
still applied). A voice with its FILT bit set is subject to the LP/BP/
HP processing in $D418.

A common pattern is to route only voice 1 (FILT1=1) to the filter
for lead synth work while voices 2-3 carry unfiltered bass and pad.

### $D418 — SIGVOL — Filter mode, voice-3 mute, master volume (W)

**Chip:** SID

| Bit | Name | Description |
|-----|------|-------------|
| 7 | 3OFF | Disconnect voice 3 from audio output (oscillator still runs) |
| 6 | HP | Enable high-pass filter mode (12 dB/oct) |
| 5 | BP | Enable band-pass filter mode (6 dB/oct) |
| 4 | LP | Enable low-pass filter mode (12 dB/oct) |
| 3-0 | VOL | Master volume (0=silent, 15=full) |

**3OFF (voice 3 mute).** Disconnects voice 3 from the final audio
output without affecting its oscillator or envelope. Used when voice 3
is configured as an LFO/random source for $D41B/$D41C and should not
be audible. Voice 3 routed to the filter (FILT3=1 in $D417) ignores
3OFF: the mute acts on the bypass path only.

**Filter mode bits.** LP, BP, HP can be combined: LP+HP is a notch
filter, LP+BP gives a warmer band-pass, BP+HP is also a notch.
Setting all three on simultaneously sums the three responses (rare in
practice). Setting all three off with $D417 routing bits set produces
silence for those voices (the filter output is grounded when no mode
is enabled).

**Volume DAC.** The 4-bit VOL field scales the audio output linearly.
This DAC is the entry point for the 4-bit sample replay
("$D418 digi") technique: writing changing values in the low nibble
produces audible clicks at the sample rate, allowing PCM playback
mixed with regular SID music. The DAC is shared with everything, so
a sudden change of VOL between non-zero values while voices are gated
produces a pop. That is the artifact that makes sample replay work,
and the reason to fade VOL gradually when turning the SID on or off.

## Read-only registers

The four read-only registers at $D419-$D41C return live state from the
chip's analog inputs and voice 3. Writes to these addresses are
silently ignored.

### $D419 — POTX — Paddle X A/D converter (R)

**Chip:** SID

8-bit A/D conversion of the voltage on pin POTX (control port 1 pin 9
or control port 2 pin 9, multiplexed by CIA1 port A, $DC00 bits 6-7:
%01 = control port 1, %10 = control port 2; an earlier revision said
CIA2, whose bits 6-7 are the IEC CLK IN / DATA IN lines and have no
effect on the SID). Values range $00 (full clockwise / pot maxed) to
$FF (full counter-clockwise / pot at zero), though the usable range is
typically $00-$DF.

The A/D circuit takes about 512 system cycles (~520 us PAL) to settle
after the multiplex source changes; reads made sooner return stale or
transitional values. Wait a full 512 cycles (nine PAL raster lines;
eight NTSC; eight PAL lines is 504 and still inside the window)
after writing the selector before sampling. In practice, switch on
one frame and read on the next. An earlier revision said two raster
lines, which is 126 cycles; measured in VICE x64sc with a 1351 on
port 1, $D419 reads noise up to 508 cycles after the selector write
and the settled value from 513 on.

The 1351 mouse uses POTX/POTY in a different way: the mouse generates
its own changing voltages encoding quadrature position, which the
software samples at known intervals (typically every other frame).

### $D41A — POTY — Paddle Y A/D converter (R)

**Chip:** SID

8-bit A/D conversion of the voltage on pin POTY (control port 1 pin 5
or control port 2 pin 5). Same multiplexing and timing as POTX.

The two A/D converters are independent; POTX and POTY can be read in
any order. Both are tied to whichever control port CIA1 has selected
at the moment of the conversion.

### $D41B — RANDOM — Voice 3 oscillator output high byte (R)

**Chip:** SID

Returns the upper 8 bits of voice 3's oscillator output. What appears
here depends on the waveform selected in $D412:

- **Noise selected.** Returns bits from the 23-bit LFSR, the usual
  C64 random-number source. Set voice 3 to NOISE+GATE with a high
  frequency value, mute it with $D418 bit 7, and read $D41B for a
  fresh pseudo-random byte. Some bits move faster than others, so
  combine multiple reads for whitening.
- **Triangle selected.** Returns the rising/falling triangle slope,
  usable as a slow LFO if voice 3's frequency is low.
- **Sawtooth selected.** Returns the ramp value.
- **Pulse selected.** Returns $00 or $FF depending on phase
  (of little use as a control source).

When the TEST bit ($D412 bit 3) is set, what $D41B reads depends on
the waveform (measured in VICE x64sc reSID, 6581 and 8580 models; an
earlier revision of this page said it always reads zero, which holds
only for triangle and sawtooth). Triangle and sawtooth read $00: the
accumulator is reset and held at zero. Pulse reads $FF whatever PW
holds ($000, $800 and $FFF all give $FF; TEST forces the pulse output
high). Noise keeps returning the LFSR's current bits, and if TEST is
held the LFSR drifts to all ones: the 6581 model reads $FF within
about 77,000 cycles (still unchanged at ~31,000, partly changed at
~36,000), the 8580 model holds its value past 77,000 cycles and reads
$FF after roughly 10 million. Combined waveforms in voice 3 produce
the same AND-of-waveforms shape that audio gets.

### $D41C — ENV3 — Voice 3 envelope output (R)

**Chip:** SID

Returns the 8-bit current value of voice 3's envelope generator
(0-$FF). Used as a programmable ramp / LFO source. Typical pattern:

1. Set voice 3 ATDCY3=$XY and SUREL3=$ZW for the desired slope
2. Set $D418 bit 7 to mute voice 3
3. Gate voice 3 by writing $D412 with GATE=1 and any waveform bit
4. Read $D41C every frame as the controller value

The envelope value rises and falls under software control of the
gate bit. Some games (e.g. Wizball) modulate other voices' pulse
width by feeding ENV3 into the PWHI register every frame.

## Programming patterns

### Frequency tables

For musical tuning, ship a 96-entry frequency table indexed by MIDI
note number (or equivalent). Each entry is a 16-bit PAL- or NTSC-
calibrated value. Example (PAL, equal temperament, A4 = 440 Hz):

```
; PAL frequency table, semitone 0 = C-0 (~16 Hz)
; F = round(freq * 16777216 / 985248)
freqtbl:
  .word $0117, $0127, $0139, $014B  ; C-0 .. D#-0
  .word $015F, $0174, $018A, $01A1  ; E-0 .. G-0
  ; ...
  .word $1D45                       ; A-4 = 440 Hz
  ; 8 octaves x 12 semitones = 96 entries
```

(Earlier revisions labelled the first eight entries C-1..G-1; they are
octave 0 in the same A4 = 440 Hz numbering as the rest of the table;
$0117 is 16.38 Hz.)

To play a note in voice 1: load the 16-bit value from `freqtbl,note`,
store low byte to $D400, high byte to $D401, then write the desired
control register value (waveform + GATE=1) to $D404.

### Hard restart (ADSR-bug workaround)

The classic hard restart prevents the ADSR-bug rate-counter wrap
before each new note. Apply two frames before the next note's gate:

```
; "Classic" hard restart, applied 2 frames before next note gate
hard_restart:
  lda #0
  sta $D405      ; AD = 0
  lda #$F0
  sta $D406      ; SR = $F0 (sustain max, release 0)
  lda $D404
  and #$FE
  sta $D404      ; clear GATE bit
  ; ... 1 frame later ...
  lda #$09
  sta $D404      ; trigger TEST+GATE (reset oscillator, start attack)
  ; ... 1 frame later (the note frame) ...
  lda real_ad
  sta $D405
  lda real_sr
  sta $D406
  lda real_waveform_with_gate
  sta $D404      ; release TEST, real waveform + GATE
```

Variants include:

- **Test-bit restart:** set $D404 bit 3 (TEST) one frame before the
  note, clear it on the gate frame. Locks the accumulator at zero so
  the new note phase-starts cleanly.
- **Aggressive restart:** write 0 to $D405/$D406 simultaneously with
  clearing GATE, forcing instant release and clamping the envelope to
  zero before the new attack.
- **Light restart:** only clear GATE one frame before, then re-gate.
  Avoids the worst of the ADSR bug at the cost of not fully resetting
  state.

Different SID players use different strategies; GoatTracker uses
classic hard restart by default, defMON has configurable variants,
and SidFactory II ships per-instrument hard-restart parameters.

### Ring modulation

Ring modulation produces inharmonic, bell-like, or clangy timbres.
The ring modulator XORs the carrier voice's triangle MSB with the
modulator voice's oscillator MSB.

```
; Voice 1 ring-mods against voice 3
  lda #$10           ; mid-range freq for voice 3
  sta $D40F
  lda #$00
  sta $D40E
  lda #$10           ; voice 3: TRI, no GATE (silent modulator; the oscillator runs regardless)
  sta $D412

  lda #$80
  sta $D401          ; voice 1 freq high
  lda #$00
  sta $D400
  lda #$15           ; voice 1: TRI + RING + GATE
  sta $D404
```

The RING bit in $D404 must be set, the TRI waveform must be enabled,
and voice 3 must have a non-zero frequency. Voice 3's GATE state is
irrelevant: the ring-mod source is the oscillator MSB, not the
post-envelope output. (An earlier revision of this listing wrote $11
here, which is TRI + GATE; measured in VICE x64sc reSID, $10 leaves
OSC3 advancing with ENV3 at zero.) Voice 3 should normally not be
audible as well: mute it via $D418 bit 7 or leave its envelope at
zero.

### Oscillator sync

Hard sync resets the slave oscillator's accumulator whenever the
master oscillator's MSB rises. The result is formant-like harmonics
that depend on the ratio between master and slave
frequencies.

```
; Voice 1 sync to voice 3
  lda #$30           ; voice 3 = master, lower frequency
  sta $D40F
  lda #$00
  sta $D40E
  lda #$11           ; voice 3: TRI + GATE — GATE only makes it audible; non-zero frequency is what sync needs
  sta $D412

  lda #$80           ; voice 1 = slave, higher frequency
  sta $D401
  lda #$21           ; voice 1: SAW + SYNC + GATE
  sta $D404
```

Sync needs the master OSCILLATOR running, not the master ENVELOPE: the
accumulator advances whenever the frequency is non-zero and TEST is
clear, whatever GATE and the waveform bits say. Measured in VICE x64sc
(reSID, 6581 and 8580 models) on OSC3: a voice synced to an ungated
master read $05 and $0D where an unsynced control read $28, the same
as with the master gated; with the master at F=0 or with its TEST bit
held, no sync occurred. An earlier revision of this page said gating
was needed for the accumulator to advance reliably; it is not; GATE
drives only the envelope. Gate the master only to hear it (with the
default all-zero ADSR a gated master only clicks). Sweep the slave
(voice 1) frequency for the sync sweep.

### ADSR-bug delay (intentional)

The ADSR bug can serve as a timed delay. Set the
sustain level high, then write a smaller AD or SR value than the
current envelope-counter position; the envelope hangs at its
current level until the rate counter wraps. Some early SID composers
used this as a "stuck note" effect, though most players treat it as
something to avoid.

### 4-bit sample replay via $D418

Stream 4-bit PCM samples by writing to the low nibble of $D418 at the
sample rate (typically 4-8 kHz). The sample rate is usually a divisor
of the system clock; an IRQ on every Nth raster line writes the next
nibble. Each byte of `sample_data` holds two consecutive samples,
first sample in the low nibble; the packer must agree, because the
unpacker below depends on it.

```
; ~8 kHz sample replay (PAL): IRQ every ~123 cycles
sample_irq:
  ldx sample_idx
  lda sample_data,x   ; packed 4-bit, LOW nibble plays first
  bit nibble_flag
  bpl lo_nibble
  lsr
  lsr
  lsr
  lsr
  inc sample_idx      ; advance only after the high nibble
lo_nibble:
  and #$0F
  sta $D418
  lda nibble_flag
  eor #$80
  sta nibble_flag
  rti
```

The shifts are written as bare `lsr` for portability: KickAssembler
rejects `lsr a` (Unknown symbol 'a'); ca65 accepts both. An earlier
version of this listing used `inc nibble_flag` as the toggle, which
flips bit 7 only every 128 calls, so it played the low nibble of bytes
0-127 and the high nibble of bytes 128-255 and never alternated
(measured in VICE x64sc); the `eor #$80` flips the tested bit on every
call, and `inc sample_idx` now advances only after the high nibble has
gone out.

On a stock 8580 this produces almost no audible output. The usual
hardware fix is a 330 kΩ - 740 kΩ resistor between EXT IN (pin 26) and
GND (pin 14), or between EXT IN and +5 V. Software-only digi on 8580
typically uses:

- **Test-bit DC digi (8580).** Set PULSE+TEST+GATE ($49) on all three
  voices, F=0 (any), AD=$00, SR=$F0, PW irrelevant. With TEST set the
  pulse output is held HIGH whatever the pulse width (measured in VICE
  x64sc reSID, both models: OSC3 reads $FF for PW=$000, $001, $800 and
  $FFF; the WAV output shows no change for PW writes while TEST is
  held), so each voice feeds a constant full-scale level through its
  envelope. Ordinary $D418 nibble writes then scale a real signal: in
  reSID's 8580 model the volume step with three such voices is about
  5x the bare-voice step, while with only one voice it is no louder
  than bare (the voice DC roughly cancels the mixer's own small
  offset), so use all three. The earlier text here said PWHI3 was the
  DAC; it was wrong: PW has no effect on the output while TEST is set
  (the value is kept and applies when TEST clears), and without TEST
  the comparator output is binary ($000 or $FFF), never proportional
  to PW. The scene form (Mahoney's 8580 digi, "Musik Run/Stop", 2014)
  also drives the filter-mode bits in $D418 with the voices routed
  through the filter and maps sample values through a per-chip lookup
  table of measured $D418 bytes for ~8-bit output; that extension is
  from published descriptions, not measured here. Nothing in this
  bullet was measured on silicon.

### Voice 3 as random source

```
; Initialize voice 3 as random-number source (one-time setup)
init_random:
  lda #$FF
  sta $D40E          ; voice 3 freq low
  sta $D40F          ; voice 3 freq high (max rate)
  lda #$80
  sta $D412          ; voice 3: NOISE only, no GATE
                     ;   (without GATE the LFSR still advances)
  rts

; Read a pseudo-random byte
random:
  lda $D41B
  rts
```

Setting NOISE+GATE+TEST and then clearing TEST is sometimes
needed to seed the LFSR; on cold start the LFSR may be in a stuck
state.

### Voice 3 as LFO

```
; Voice 3 as a slow triangle LFO (modulates voice 1 pulse width)
init_lfo:
  lda #$10           ; slow freq
  sta $D40E
  lda #$00
  sta $D40F
  lda #$11           ; TRI + GATE
  sta $D412
  lda #$80
  sta $D418          ; 3OFF set, volume 0 (or set as needed)
  rts

; Every frame, feed the triangle's top nibble to voice 1 pulse width high
lfo_tick:
  lda $D41B
  lsr
  lsr
  lsr
  lsr                ; 0-15: the slow triangle, 16 steps per half-cycle
  sta $D403          ; voice 1 PWHI — only bits 3-0 are used
  rts
```

$D403 keeps only bits 3-0, so storing OSC3 unshifted (as an earlier
version of this block did) applies the triangle's LOW nibble, which
wraps 0-15 every couple of frames at this frequency; measured in VICE
x64sc (reSID), the applied values run 0,9,3,12,6,0,9,…. That is a
jitter over the whole pulse-width range, not the slow sweep described. Shifted,
the value steps by at most 1 per frame. For finer steps also write
OSC3<<4 to $D402 (12-bit PW = OSC3 × 16); keep the sweep away from PW
$000 and $FFF, which are silent (see Pitfalls).

### Avoiding $D418 volume pops

When transitioning from playing to silent (e.g. end of game), do not
drop volume straight to zero; that causes the loudest possible click.
Instead, gate-off all voices first and let the release phase decay,
then fade VOL down through the lower nibble values. Conversely on
startup, write filter mode bits and volume only after gating voices
to known states.

### Initializing the SID

A clean startup sequence (e.g. after RESET, or before loading a tune):

```
init_sid:
  lda #0
  ldx #$18
zero_loop:
  sta $D400,x
  dex
  bpl zero_loop      ; zero $D400-$D418
  lda #$0F
  sta $D418          ; volume = 15, all filter modes off
  rts
```

This zeros all 25 write-only registers and sets master volume to
maximum with no filtering. The four read-only registers ($D419-$D41C)
are not touched.

## Pitfalls

- **Write-only registers.** $D400-$D418 cannot be read back. A read
  returns the SID's held bus byte (the last write to any SID address
  or the last $D419-$D41C read, fading to $00 within ~7k cycles (6581)
  / ~660k cycles (8580) in reSID), not open-bus garbage and not the
  address high byte as this page used to say. Code that needs to
  modify a single bit of a register must maintain a software shadow.
  See [sid.md](../pitfalls/sid.md) (`sid_write_only_registers`).

- **ADSR bug.** Reducing the AD or SR rate below the envelope's
  internal counter position causes the counter to wrap through its
  full 15-bit range before the envelope resumes, up to 33 ms at PAL.
  Mitigate with a hard restart sequence applied 1-2 frames before
  each note gate. See [sid.md](../pitfalls/sid.md) (`sid_adsr_bug_8580`;
  the entry's heading names the 8580 but its Mechanism covers both
  chips).

- **$D418 popping.** Sudden changes to the master-volume nibble
  generate audible clicks via the DAC. This is the same effect that
  enables 4-bit sample replay; for music playback always fade VOL
  gradually and gate voices off first to let release decay.

- **8580 sample replay broken.** The $D418 digi technique
  produces nearly silent output on 8580 SIDs because the cleaner DAC
  does not leak DC. Either install the 330-740 kΩ EXT-IN-to-GND
  resistor mod or use a software-only digi (the test-bit DC digi:
  three voices held at constant full-scale output with
  PULSE+TEST+GATE, $D418 as the DAC, not pulse-width modulation; see
  Programming patterns).

- **Filter cutoff varies across chips.** The 6581 cutoff curve varies
  widely between individual chips of the same revision. A
  cutoff sweep tuned on one 6581 may sound different on
  another. The 8580 cutoff is consistent but uses a different
  (linear vs sigmoidal) curve than the 6581, so 6581-tuned music
  sounds wrong on 8580 and vice versa. Music players typically ship
  per-chip-revision tuning.

- **Combined waveforms are chip-dependent.** Combining waveform bits
  (e.g. TRI+PULSE) produces a bit-wise AND of the waveform outputs;
  the resulting amplitude is louder on 8580 than 6581. Some specific
  combined-waveform shapes only sound right on one chip revision.

- **No frequency read-back.** The current oscillator
  frequency cannot be read. $D41B (OSC3) shows the upper 8 bits of
  voice 3's accumulator, but the frequency register itself is
  write-only.

- **Pulse width 0 and FFF give silence.** PW=$000 holds the pulse
  output high, PW=$FFF holds it (almost) constantly low (an earlier
  revision had the two swapped; measured in VICE x64sc reSID on both
  chip models). Both produce a DC level that
  is inaudible (the envelope multiplies a constant). A safe default
  pulse width is $800 (square wave); changing PW dynamically while
  pulse is enabled produces audible width changes.

- **TEST bit halts the noise LFSR.** Setting TEST on a voice playing
  noise freezes the LFSR where it is (its bits drift to one if TEST is
  held ~35k cycles on a 6581, ~2.5M on an 8580, measured in VICE);
  clearing TEST shifts it once and lets it run on from there. The
  output jumps at both edges, so toggling TEST during sustained
  noise notes clicks. An earlier version said TEST
  reset the LFSR to zero; it does not.

- **Noise combined with other waveforms zeros the LFSR.** With
  NOISE enabled simultaneously with TRI, SAW, or PULSE, the AND-gate
  combination eventually drives all LFSR bits to zero, silencing
  the noise. Once stuck, set TEST briefly to re-seed. This SID
  behaviour is also why "noise sweeps" usually pulse
  the TEST bit periodically. A brief pulse is enough: a few cycles of
  TEST re-seeds a zeroed LFSR, because the falling edge shifts a 1
  into bit 0 when bit 17 is 0 (measured in VICE: $D41B reads $01 right
  after the pulse and runs on). Holding TEST longer only matters to
  drive the register to all ones.

- **Voice 3 mute ($D418 bit 7) only mutes the bypass path.** If
  voice 3 has FILT3=1 in $D417, it still goes to the filter and
  through to output regardless of bit 7. To fully silence voice 3
  for use as a modulator: clear FILT3 in $D417 and set 3OFF in
  $D418.

- **Frequency table tuning depends on system clock.** PAL and NTSC
  clocks differ by ~3.8%. A tune tuned for PAL plays sharp on NTSC
  by roughly two-thirds of a semitone (65 cents). Some music
  players auto-detect the region and select between two tables.

- **Sync requires master oscillator running.** SYNC syncs to the
  previous voice's oscillator MSB. If the master voice has frequency
  zero, no MSB transitions happen and sync produces no effect. The
  master voice's GATE state is not required for sync (measured, see
  Oscillator sync), but setting a non-zero frequency is.

- **POTX/POTY settling time.** After $DC00 bits 6-7 switch the paddle
  source between control port 1 and 2, wait ~512 cycles before
  reading $D419/$D41A. Faster reads return stale/transitional
  values. The KERNAL keyboard scan (SCNKEY, called from the $EA31
  jiffy IRQ) rewrites $DC00 every frame and leaves it at $7F, i.e.
  %01 = control port 1, so select the pair with IRQs masked or
  re-select immediately before each read. See
  [cia-reference.md](cia-reference.md) for the CIA1 paddle multiplex
  bits. (Measured in VICE x64sc 3.10 and read from the 901227-03
  KERNAL; earlier text said CIA2.)

- **Mirroring at $D420-$D7FF.** The SID register window is mirrored
  every 32 bytes through $D7FF on the stock C64. Writing to $D420 is
  the same as $D400. On the C128 the mirrors stop at $D4FF: a write to
  $D512 or $D700 never reaches the SID (measured in VICE x128; an
  earlier revision said the C128 reserved this area for a second SID,
  which it does not). Do not rely on any mirror for cross-machine code:
  above $D4FF it is not the SID on a C128, and $D420 and $D500 are
  the bases add-on second-SID boards usually decode (see
  [c64-registers-reference.md](c64-registers-reference.md)), so
  portable code addresses $D400-$D41C only.

- **Voltage matters for chip swap.** Replacing a 6581 with an 8580
  (or vice versa) requires changing Vdd (12 V vs 9 V) and the filter
  capacitors (470 pF vs 22 nF). A naked swap often results in
  audible distortion, wrong cutoff range, or chip damage.

- **$D41D-$D41F are not a constant.** These addresses are unused; a
  read returns the SID's held bus byte (last write or last $D419-$D41C
  read, fading to $00), not the high byte of the address as this page
  used to say. Do not use them as a "guaranteed zero" or any other
  constant source.

<!-- doc-type: hardware-reference -->
