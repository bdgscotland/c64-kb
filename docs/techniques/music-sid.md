---
category: music
chip: SID
---

<!-- doc-type: technique-reference -->

# SID Music and Audio Techniques

The MOS 6581/8580 SID chip is the reason C64 music has its own aesthetic identity. Three voices, a shared analog filter, and a handful of hardware quirks add up to an instrument that decades of composers have explored in depth. The techniques in this document cover the mechanical foundation — how to set frequency, waveform, and envelope per voice; how to wire the filter; how the init/play convention works; why the two chip revisions sound different; and how to push into territory beyond simple three-voice music: 4-bit and 8-bit sample playback, two-chip stereo setups, and the emulator fidelity gaps you need to know about when testing recipes.

All SID registers $D400-$D418 are write-only. The chip cannot be read back; code must maintain software shadow copies when it needs to modify individual bits. The four read-only registers ($D419-$D41C) return paddle inputs and voice 3 status; they are not discussed here. For the full register map see [docs/hardware/sid-reference.md](../hardware/sid-reference.md).

The Oscar64 canonical interface for this chip lives in `c64/sid.h`, which defines the `struct SID` layout (three `Voice` structs followed by filter registers) and the `sid` macro expanding to `(*((struct SID *)0xd400))`. Frequency macros `SID_FREQ_PAL(f)` and `SID_FREQ_NTSC(f)` compute the 16-bit register value from a Hz argument using fixed-point arithmetic.

---

## sid_voice_setup — Frequency / waveform / ADSR per voice

**Complexity:** low
**Region:** both
**Uses registers:** D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414

### Why

Playing a musical note on the SID requires configuring seven registers per voice: two bytes of frequency, two bytes of pulse width, one control byte selecting the waveform and triggering the envelope, and two bytes encoding the four ADSR envelope parameters. Understanding this layout is the prerequisite for every other SID technique — filter routing, play routines, and digi all layer on top of it.

### How

Voice N (N = 1, 2, 3) occupies seven consecutive registers starting at base $D400 + 7*(N-1):

| Offset | Register | Function |
|--------|----------|----------|
| +0 | FRELO | Frequency low byte (F7-F0) |
| +1 | FREHI | Frequency high byte (F15-F8) |
| +2 | PWLO | Pulse width low byte (PW7-PW0) |
| +3 | PWHI | Pulse width high nibble (PW11-PW8, bits 7-4 unused) |
| +4 | VCREG | Control: waveform select + GATE/SYNC/RING/TEST |
| +5 | ATDCY | Attack rate (bits 7-4) / Decay rate (bits 3-0) |
| +6 | SUREL | Sustain level (bits 7-4) / Release rate (bits 3-0) |

The 16-bit frequency value F sets the oscillator pitch. The SID phase accumulator is 24 bits wide; every system clock cycle F is added to it. The audible frequency in Hz is:

```
f = F * Phi2 / 2^24
```

where `Phi2` is the system clock: 985248 Hz on PAL, 1022727 Hz on NTSC. Inverting for a target note frequency:

```
F_PAL  = f * 16777216 / 985248   ~= f * 17.0288
F_NTSC = f * 16777216 / 1022727  ~= f * 16.4046
```

The PAL register value for A4 (440 Hz) is $1D45. Most SID players ship a 96-entry table (8 octaves × 12 semitones) with precomputed PAL and NTSC values rather than computing at runtime.

In Oscar64, using `c64/sid.h`:

```c
#include <c64/sid.h>

// Play A4 on voice 1 with sawtooth waveform, medium attack
void play_a4_voice1(void)
{
    // Zero out voice 1 first (good habit)
    sid.voices[0].freq   = 0;
    sid.voices[0].pwm    = 0;
    sid.voices[0].ctrl   = 0;
    sid.voices[0].attdec = 0;
    sid.voices[0].susrel = 0;

    // Frequency: A4, PAL
    sid.voices[0].freq = SID_FREQ_PAL(440);

    // Pulse width: 50% square wave (only relevant when RECT bit set)
    sid.voices[0].pwm = 0x0800;

    // ADSR: attack 16ms, decay 48ms, sustain level 9/15, release 300ms
    sid.voices[0].attdec = SID_ATK_16 | SID_DKY_48;
    sid.voices[0].susrel = (9 << 4) | SID_DKY_300;

    // Control: sawtooth waveform, GATE on -> starts attack phase
    sid.voices[0].ctrl = SID_CTRL_SAW | SID_CTRL_GATE;
}

// Release note (start release phase)
void release_voice1(void)
{
    // Keep waveform bits, clear GATE
    sid.voices[0].ctrl = SID_CTRL_SAW;  // GATE bit not set
}
```

The VCREG control byte bit layout (all three voices share this format):

| Bit | Name | Meaning |
|-----|------|---------|
| 7 | NOISE | Enable noise waveform (23-bit LFSR output) |
| 6 | PULSE/RECT | Enable pulse waveform (duty cycle from PW11-PW0) |
| 5 | SAW | Enable sawtooth waveform |
| 4 | TRI | Enable triangle waveform |
| 3 | TEST | Reset accumulator to zero and hold (noise LFSR also reset) |
| 2 | RING | Ring-modulate triangle with previous voice's oscillator MSB |
| 1 | SYNC | Hard-sync accumulator to previous voice's oscillator MSB transitions |
| 0 | GATE | 0 = release phase; 1 = attack-decay-sustain phase |

Setting GATE starts the attack. Clearing GATE starts the release from the current envelope level. Waveform bits can be ORed together; the output is the bitwise AND of each enabled waveform's 12-bit value. See the [sid-reference](../hardware/sid-reference.md#d404-vcreg1) for combined-waveform behavior.

### Why it works

The phase accumulator advances by F every cycle. When it overflows the 24-bit range it wraps, completing one oscillator period. The waveform generator derives its output from the accumulator's upper bits: the sawtooth is the top 12 bits directly; the triangle folds them symmetrically; the pulse compares the top 12 bits against PW11-PW0 and outputs either $FFF or $000. The noise waveform taps bit positions from a 23-bit LFSR clocked by the accumulator's MSB transition. The ADSR envelope generator multiplies the waveform output by the current envelope level (0-$FF), giving notes their amplitude shape.

### Variations

**Pulse-width modulation (PWM) pads.** Route an LFO into the pulse-width registers while holding the PULSE waveform. Voice 3's oscillator output ($D41B) is the standard LFO source; read it each frame and write the result to the target voice's PWHI register. Produces the classic SID "wobbling pad" timbre.

**Ring modulation.** Set the RING bit alongside TRI. The triangle's MSB is XORed with the previous voice's oscillator MSB (voice 1 modulates against voice 3; voice 2 against voice 1; voice 3 against voice 2). Produces inharmonic bell-like tones. The modulator voice must have a non-zero frequency but does not need to be gated or audible.

**Oscillator sync.** Set the SYNC bit. When the modulator voice's accumulator MSB rises, this voice's accumulator resets. Sweep this voice's frequency while holding the modulator steady for a classic sync sweep sound.

**Noise drums.** Set the NOISE bit with a short attack, zero sustain, and short release. Each gate-on starts a percussive burst. Setting TEST briefly after the drum to re-seed the LFSR ensures each hit sounds the same.

### Cycle budget

Voice setup writes are not time-critical — they happen before the note sounds. The IRQ overhead for a play routine that updates all three voices and the filter is approximately 9 registers × 4 cycles per STA = 36 cycles minimum, plus subroutine overhead and frequency-table lookups. At 50 Hz (PAL) a frame is 19656 cycles; a minimal three-voice update consumes under 0.3% of available cycles.

### Recipes

- `recipes/oscar64/sid-music-player.md`

---

## sid_filter_routing — Filter cutoff / resonance / voice-routing setup

**Complexity:** medium
**Region:** both
**Uses registers:** D415, D416, D417, D418

### Why

The SID's analog multi-mode filter is what gives it harmonic flexibility beyond a raw oscillator. Without filter work, three-voice SID tunes sound flat and mechanical. The filter lets composers carve high-frequency content off bass voices, sweep a resonant peak across a lead, or build a vowel-formant by combining low-pass and high-pass modes. Understanding the four filter registers is the bridge from "playing notes" to "making SID music sound like SID music."

### How

The filter occupies four registers at $D415-$D418:

**$D415 — CUTLO: Filter cutoff low bits.**
Bits 7-3 are unused (writes ignored). Bits 2-0 (FC2-FC0) are the low three bits of the 11-bit cutoff value. Many tunes leave this at zero and treat $D416 as an 8-bit cutoff.

**$D416 — CUTHI: Filter cutoff high bits.**
Bits 7-0 (FC10-FC3) are the high 8 bits of the 11-bit cutoff. The combined value is:
```
cutoff11 = ($D416 << 3) | ($D415 & 7)
```
Range 0-2047. On 6581 the Hz response is non-linear and chip-dependent (see `sid_8580_vs_6581_differences`). On 8580 it is linear.

**$D417 — RESON: Resonance and routing.**

| Bits | Name | Meaning |
|------|------|---------|
| 7-4 | RES | Resonance Q, 0 (none) to 15 (maximum) |
| 3 | FILTEX | Route external audio input through filter |
| 2 | FILT3 | Route voice 3 through filter |
| 1 | FILT2 | Route voice 2 through filter |
| 0 | FILT1 | Route voice 1 through filter |

**$D418 — SIGVOL: Filter mode, voice-3 mute, master volume.**

| Bits | Name | Meaning |
|------|------|---------|
| 7 | 3OFF | Disconnect voice 3 from audio (oscillator still runs) |
| 6 | HP | High-pass filter mode (12 dB/oct) |
| 5 | BP | Band-pass filter mode (6 dB/oct) |
| 4 | LP | Low-pass filter mode (12 dB/oct) |
| 3-0 | VOL | Master volume (0 = silent, 15 = full) |

LP, BP, and HP bits can be combined: LP+HP produces a notch filter; LP+BP gives a wider band-pass; setting all three is rarely useful in practice.

Oscar64 example — route voice 1 through a resonant low-pass sweep:

```c
#include <c64/sid.h>

void init_filter_sweep(void)
{
    // Route voice 1 only through filter; voices 2-3 bypass
    sid.resfilt = (12 << 4) | SID_FILTER_1;  // resonance 12, voice 1 filtered

    // Low-pass mode, master volume 15
    sid.fmodevol = SID_FMODE_LP | 15;

    // Initial cutoff: mostly closed (low frequency)
    sid.ffreq = 0x0200;  // low 3 bits zero, high byte = $40
}

// Call this from a raster IRQ or main loop to sweep the filter
void update_filter_cutoff(unsigned cutoff11)
{
    // cutoff11: 0-2047
    // ffreq is the 16-bit register: low byte = D415, high byte = D416
    // but D415 only uses bits 2-0; the upper 5 bits of the low byte are ignored
    sid.ffreq = (cutoff11 >> 3) | ((cutoff11 & 7) << 13);
    // equivalent to: D415 = cutoff11 & 7, D416 = cutoff11 >> 3
}
```

Note: the `SID` struct in `c64/sid.h` maps `ffreq` as `volatile unsigned`, so a 16-bit write writes both $D415 and $D416 in a single instruction (low byte first, which is correct — $D415 must be written before $D416 for a clean atomic update on any write ordering).

### Why it works

All three voices (and the external audio input if FILTEX is set) share a single analog filter. Voices with their FILT bit clear bypass the filter entirely and go straight to the volume DAC at full bandwidth. Voices with FILT set pass through the filter's LP/BP/HP network before reaching the DAC. The analog filter's cutoff frequency is set by the 11-bit value; resonance emphasizes a narrow band around the cutoff frequency, producing the classic "ringing" or "squealing" filter sound. The 6581 filter is a switched-capacitor design with strongly non-linear cutoff response; the 8580 uses a different cell design with near-linear response.

Changing $D416 while voices are playing produces a live filter sweep — this is how SID tracker filter automation works. Because the filter is analog and there is no sample clock, sweeps are continuous.

### Variations

**Notch filter for pad sounds.** LP+HP simultaneously (bits 4 and 6 set in $D418) creates a notch filter: all frequencies pass except a null band around the cutoff. Useful for creating formant-like vowel textures on sustained pad voices.

**Filter as LFO target.** Route voice 3 as the LFO source ($D41B output read each frame) and write its output scaled into $D416. The filter then tracks the LFO, producing a cyclic filter sweep without CPU intervention beyond the per-frame copy.

**High resonance as pseudo-oscillator.** At maximum resonance (15) the 8580 filter self-oscillates around the cutoff frequency, producing a sine-like tone. Some SID composers exploit this as a fourth "voice" by routing a silent voice through the filter and relying on self-oscillation. Less predictable on 6581 (individual chips vary in how close to self-oscillation they reach at RES=15).

**Voice muting via filter.** Setting $D418 to filter mode bits but VOL=0 silences all output; restoring VOL fades all voices back. This is cleaner than gating voices individually when you need a fade-out, but still avoid a sudden VOL jump (see pitfall `$D418 popping` in [sid-reference.md](../hardware/sid-reference.md#pitfalls)).

---

## sid_play_routine_pattern — The init+play subroutine convention

**Complexity:** low
**Region:** both
**Uses registers:** D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418

### Why

Every C64 SID tune — whether produced by a dedicated tracker (GoatTracker, SidFactory II, defMON) or hand-coded — exposes exactly two entry points to the host: an `init` subroutine that sets up the tune and a `play` subroutine that must be called once per frame. This two-entry-point contract is how SID players, emulators, and game engines integrate music without needing to understand the tune's internals. Learning this pattern is the entry point for driving SID tune files from Oscar64 code.

### How

The canonical contract:

- **init(A = song_index):** Call once. Accumulator A selects which subtune to play (0-based). The routine initializes all SID registers, sets up internal player state, and returns. Multiple calls to init (with the same or different song index) must be safe — a well-written player zeroes or resets all state on every init call.
- **play():** Call once per frame (typically from a raster IRQ at line 0 or wherever the game places its audio IRQ). The routine reads the current frame count from internal state, computes the SID register values for this frame, writes them to $D400-$D418, and returns. The play routine must not corrupt the CPU registers it uses without saving and restoring them; well-written players save A, X, Y on the stack and restore before returning.

In assembly the pattern is:

```asm
; Call init with song index 0
    lda #0
    jsr TUNE_INIT_ADDR

; In raster IRQ (called each frame):
play_music:
    jsr TUNE_PLAY_ADDR
    ; ...other IRQ work...
```

In Oscar64, the play routine is a C function pointer called from the raster IRQ:

```c
#include <c64/vic.h>
#include <c64/sid.h>

// External assembly SID tune symbols
extern void sid_tune_init(byte song);
extern void sid_tune_play(void);

__interrupt void raster_irq(void)
{
    // Acknowledge VIC interrupt
    vic.irq = 1;

    // Call SID play routine
    sid_tune_play();

    // ...rest of frame work...
}

void main(void)
{
    // Set up raster IRQ at line 0
    // ... VIC IRQ setup ...

    // Init SID tune, select song 0
    sid_tune_init(0);

    // Main loop
    for (;;)
    {
        // Game logic, not audio
    }
}
```

**PSID and RSID file formats.** SID tune files (.SID) carry the `init` and `play` addresses in a fixed header:

- Bytes $06-$07: `load_address` — where to load the tune data
- Bytes $08-$09: `init_address` — entry point for init
- Bytes $0A-$0B: `play_address` — entry point for play (0 = CIA timer driven)
- Byte $0F: `songs` — total number of subtunes
- Byte $10: `start_song` — default subtune (1-based)

PSID format (most common) is for "pseudo-SID" tunes that run in ROM-on mode and may call KERNAL routines. RSID format ("real SID") demands full C64 environment including correct CIA timing and does not allow KERNAL calls. Most SID players in emulators handle both formats; extracting tunes into Oscar64 projects is simpler with PSID.

### Why it works

The play routine is called once per frame (every 20 ms on PAL, every 16.7 ms on NTSC). This gives the music 312 × 50 = 15600 SID register writes per second on PAL. The player's job each frame is to advance its internal sequencer by one tick (or by a fraction of a tick if the tune runs at a sub-frame rate), compute any pitch slides, vibrato, or arpeggio values for each voice, and write the result to SID. Because SID registers are write-only and take effect immediately, the writes can happen at any point in the frame without synchronization — the SID does not have a "register latch" mode that defers application.

The reason for placing the call inside a raster IRQ rather than the main loop is timing stability. A main loop with variable per-frame work produces jitter in the audio write timing. The raster IRQ fires at a fixed line number every frame, guaranteeing the play routine runs at the same point in every frame regardless of what the main loop is doing.

### Variations

**CIA-timed play.** Some tunes embed their own CIA timer IRQ setup and call the play routine on a sub-frame rate (e.g. 50 Hz for the music while the game runs at 25 Hz). The `.play_address` field in PSID can be $0000, indicating the tune installs its own IRQ. Standard SID players handle this case.

**Multi-speed tunes.** Certain trackers call the play routine 2× or 4× per frame (CIA timers) to achieve smoother vibrato and faster arpeggios than 50 Hz allows. A 4× tune calls play 200 times per second on PAL.

**Overlay (co-call) pattern.** A game's existing raster IRQ chain calls the SID play routine as one step in a multi-step handler. The play routine returns normally and execution continues with sprite positioning, scroll updates, and so on. This is the standard Oscar64 game structure.

### Recipes

- `recipes/oscar64/sid-music-player.md`

---

## sid_8580_vs_6581_differences — Chip revision differences

**Complexity:** low
**Region:** both
**Uses registers:** D415, D416, D417, D418, D404

### Why

The C64 shipped with two distinct SID revisions across its production life: the 6581 (1982 through approximately 1986) and the 8580 (1987 through 1992). Despite sharing the same register interface and the same musical capabilities on paper, the two chips sound noticeably different in practice. Code that sounds excellent on a 6581 may sound wrong on an 8580 and vice versa. Understanding the three main differences is necessary to write cross-compatible music code or to deliberately target one revision.

### How

#### Filter cutoff curve

The 6581 filter uses a switched-capacitor design with a strongly non-linear cutoff-versus-register-value curve. The curve is roughly sigmoidal on a logarithmic frequency scale, and it varies significantly between individual chips from different manufacturing batches. A $D416 value of $40 that places the cutoff at ~1 kHz on one 6581 may produce ~600 Hz on another. Music tuned for a specific 6581 often sounds slightly wrong on a different 6581 of the same nominal revision, let alone on an 8580.

The 8580 filter has a near-linear cutoff curve and is consistent between chips. A $D416 sweep that sounds even-stepped on an 8580 sounds compressed at the low end and spread at the high end on a 6581.

Standard practice: SID players ship two filter-cutoff tables (one per chip revision) and detect which revision is present at startup.

#### ADSR bug

Both chips share a hardware quirk in the envelope rate counter: if you write a smaller rate value to $D405 or $D406 than the 15-bit internal rate counter has already counted past for the current phase, the counter must wrap through its full 15-bit range (up to 32768 cycles, approximately 33 ms at PAL) before the envelope generator acts on the new rate. This causes new notes to play at the wrong envelope shape until the counter wraps. The standard workaround is the "hard restart" sequence (see the `Programming patterns` section in [sid-reference.md](../hardware/sid-reference.md#hard-restart-adsr-bug-workaround)):

```asm
; Hard restart: apply 2 frames before the next gate
    lda #0
    sta $D405       ; AD = 0 (attack 2ms, decay 6ms — fastest possible)
    lda #$F0
    sta $D406       ; SR = $F0 (sustain max, release 0 — no decay hang)
    lda $D404_shadow
    and #$FE
    sta $D404       ; clear GATE bit to start release
    ; ... 1 frame passes ...
    lda real_ad
    sta $D405
    lda real_sr
    sta $D406
    lda real_ctrl_with_gate
    sta $D404       ; GATE + waveform, correct values
```

The 6581 exhibits the ADSR bug more visibly at certain rate combinations; the 8580 is slightly less severe in some cases, but the bug exists on both and should always be worked around.

#### $D418 sample replay (digi) difference

The 6581 has a measurable DC offset at the master volume DAC. Writing varying 4-bit values to $D418 bits 3-0 modulates this offset and produces audible clicks, enabling 4-bit PCM playback (see `digi_4bit`). The 6581's DC-offset amplitude is large enough to produce clear speech and sampled sound at multi-kHz rates.

The 8580 cleaned up the DAC design; the DC offset is nearly absent. The same $D418 write sequence produces volume levels that are too small to hear without hardware assistance. The standard hardware fix is a 330-740 kΩ resistor between SID pin 26 (EXT IN) and either GND (pin 14) or +5 V, which injects a signal into the filter path that the DAC can modulate. Without this resistor, software-only digi on a stock 8580 requires different techniques (see `digi_8bit_hard_restart`).

#### Combined waveforms

Enabling more than one waveform bit simultaneously produces a bitwise AND of the waveform outputs. On the 6581 this combined output is quieter and exhibits noise artifacts at the zero-crossing points. On the 8580 the combined output is louder and cleaner. Tunes that rely on TRI+PULSE for warm pad sounds or TRI+SAW for soft brass will sound distinctly louder and brighter on 8580 than on 6581. The exact bit patterns produced by combined waveforms depend on the chip revision — some combinations produce a fundamentally different harmonic spectrum between revisions.

#### Voltage and capacitor differences

This is a hardware concern, not a software one, but it affects anyone testing against real hardware: the 6581 requires +12 V Vdd and uses 470 pF filter capacitors. The 8580 runs on +9 V and uses 22 nF capacitors. The 6582 designation is an 8580 in a different package. Swapping chips without changing the power rail and capacitors results in audibly wrong filter behavior or chip damage.

### Variations

**Chip detection at runtime.** Because the 6581 and 8580 respond differently to specific cutoff values, runtime detection is possible by writing a known cutoff and measuring the filter's effect on a test tone read via $D41C (envelope of voice 3 routed through the filter). Some SID players autodetect; others expose a settings toggle. Detection is imprecise — use only to select between precomputed tuning tables.

**Per-chip optimization.** Scene-quality SID music is often composed explicitly for one chip revision. The composer notes the target in the HVSC (High Voltage SID Collection) metadata (`STIL.txt` or the SID file header `SID model` field). Accept that cross-revision playback will sound different.

---

## digi_4bit — 4-bit digi playback via $D418 volume

**Complexity:** high
**Region:** both
**Uses registers:** D418

### Why

The C64 has no dedicated PCM audio hardware. The SID chip was designed as a synthesizer, not a sample player. Yet some of the most memorable audio moments in C64 history — Ghostbusters speech, Arkanoid title track, Mahoney's "Musik Runs in the Family" sampled instruments — are PCM playback at what sounds like reasonable audio quality. The mechanism is a hardware accident in the 6581: the master volume register doubles as a 4-bit DAC for anyone willing to write to it fast enough. This technique is how C64 demos and games play speech and percussion samples.

### How

The $D418 register's lower nibble (VOL, bits 3-0) sets the master output volume. On the 6581 the DAC that drives the audio output pin has a measurable DC offset; changing this nibble between values produces an audible click proportional to the step size. Streaming a series of 4-bit values to $D418 at a regular rate reproduces PCM audio at 4-bit resolution.

Sample rate is determined by the IRQ frequency: any timer that fires and writes a new nibble to $D418 contributes one sample. The practical range on PAL is:

- **Low rate (4-8 kHz):** One IRQ every 123-246 cycles. This is approximately every 2-4 raster lines. Sufficient for speech (e.g. GoatTracker `ADSR bug` workaround timing) and simple percussion. ~20-30 IRQs per raster line is achievable but needs careful cycle accounting.
- **Higher rate (up to ~15.6 kHz):** One IRQ per raster line (PAL: 63 cycles/line × 312 lines × 50 Hz = 982080 cycles/sec; one IRQ per line gives 312 × 50 = 15600 samples/sec). This is the theoretical ceiling for raster-line-based digi; practical implementations are limited by the IRQ overhead and the need for the main program to do anything else.

A minimal 4-bit digi IRQ (assembly):

```asm
; Setup: set SID master volume to mid-range, all voices gated off
; Sample data: array of bytes, each byte = two 4-bit samples packed as hi|lo nibble
; nibble_hi: flag byte, 0 = output low nibble, nonzero = output high nibble

digi_irq:
    pha
    lda nibble_hi
    bne output_hi
    ; Low nibble
    lda (sample_ptr)
    and #$0F
    sta $D418
    inc nibble_hi
    jmp digi_irq_done
output_hi:
    lda (sample_ptr)
    lsr a
    lsr a
    lsr a
    lsr a
    sta $D418
    lda #0
    sta nibble_hi
    inc sample_ptr       ; advance to next byte
    bne digi_irq_done
    inc sample_ptr+1     ; carry into high byte
digi_irq_done:
    pla
    ; ... ACK IRQ (CIA or VIC as appropriate) ...
    rti
```

The upper nibble (bits 7-4 of $D418) contains the filter mode and voice-3 mute bits; the sample writes should preserve those bits or accept that the filter mode is overwritten on every sample byte. A common approach for digi that coexists with music is to set the filter mode to a fixed value and OR it with each sample nibble.

On Oscar64, the play-routine pattern applies: an `__interrupt` function writes the next nibble to `sid.fmodevol & 0xF0 | next_sample_nibble` on each IRQ tick.

### Why it works

The 6581 SID's output stage sums contributions from the three voice signals, the filter, and the master DAC. The master DAC is a simple resistor-ladder circuit driven by the four VOL bits. Changes to these bits produce a stepped analog output; because the output capacitor cannot instantaneously slew to a new voltage, each step produces a brief current transient that is audible as a click. Streaming clicks at audio rates produces the perception of continuous audio through the same mechanism as any PCM DAC — the ear integrates the rapid changes into a perceived waveform.

The technique works specifically because the 6581's DAC has a non-zero DC offset: the output at VOL=0 is not at the same voltage as at VOL=15 — there is an absolute shift that drives current through the output coupling capacitor. The 8580 corrected this: its output at VOL=0 and VOL=15 are symmetric around the bias point, dramatically reducing the click amplitude.

### Variations

**Digi mixed with SID music.** Some skilled composers run three-voice SID music while simultaneously playing digi samples. The SID voices occupy the synthesizer path; digi drives the volume register. This requires the music play routine to not write $D418 (or to write only the filter-mode bits and leave the lower nibble to the digi routine). Rob Hubbard and Martin Galway pioneered this combination.

**Sample rate selection.** PAL gives more cycles per frame (19656) vs NTSC (17095), so PAL can sustain a higher sample rate before competing IRQs are starved. Most classic digi tunes were composed for PAL systems.

**NTSC consideration.** On NTSC (60 Hz frame rate), the same raster-line-based sample rate gives 263 × 60 = 15780 samples/sec — slightly higher than PAL. However, the shorter frame (17095 cycles) leaves fewer cycles for the main program.

**8580 hardware fix.** A 330-740 kΩ resistor between SID pin 26 (EXT IN) and ground restores audible digi on 8580 by feeding back signal through the filter input. The exact resistor value affects the amplitude and frequency response of the digi; values around 470 kΩ are common.

---

## digi_8bit_hard_restart — Hard-restart digi and high-resolution sample techniques

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D418, D404, D405, D406

### Why

4-bit digi via $D418 gives 16 amplitude levels — adequate for speech, marginal for music. Scene-quality productions achieving more than 4-bit effective resolution exist, and they do so by exploiting the SID's voice control logic rather than just the volume register. The "hard restart digi" family of techniques drives the envelope generator into a state where the audio output is effectively controlled by a pulse-width write rather than a volume nibble, giving access to a larger DAC range.

### How

The technique family exploits the relationship between the ADSR bug, the TEST bit, and the pulse-width register on the 8580.

**Background: the ADSR bug as a DAC.** When the ADSR bug stalls the envelope at a fixed level, the voice output is `oscillator_output * envelope_level`. If the oscillator is held in a fixed state (via TEST or by using a DC-level waveform), the envelope level itself becomes the DAC value. The ADSR envelope counter is 8 bits of effective resolution ($00-$FF), giving 256 amplitude levels — 8-bit PCM.

**Hard-restart digi (Hermit method, basic form):**

For each sample byte (8-bit, one per IRQ tick):
1. Gate off the voice. Write $D405 = 0, $D406 = 0 (fastest ADSR). This triggers the ADSR rate counter reset.
2. Set TEST bit ($D404 bit 3) to hold the oscillator at zero output.
3. Write the 8-bit sample value into... the envelope? Not directly — the envelope value is not writable. Instead, the trick is to set a specific ATTACK value such that the envelope ramps from 0 to the target value in exactly one sample period.

In practice the "Hermit method" as used in VICE test cases and documented in Codebase64 works as follows for voice 1:

```asm
digi_8bit_irq:
    pha
    ; Load next sample byte (0-255)
    ldy sample_idx
    lda sample_data,y
    inc sample_idx

    ; Step 1: gate off, clear TEST, set AD=0 SR=0
    lda #$00
    sta $D404       ; gate off, no waveform, no TEST
    sta $D405       ; AD=0 (2ms attack, 6ms decay)
    sta $D406       ; SR=0 (sustain 0, release 6ms)

    ; Step 2: set TEST bit (freezes oscillator at DC level)
    lda #$08
    sta $D404       ; TEST only

    ; Step 3: gate on with TEST+TRI
    ; The attack phase begins; attack rate 0 = 2ms
    ; Write the sample as a volume nibble (mixed technique)
    and #$0F        ; low nibble of sample
    sta $D418       ; 4-bit portion to volume DAC
    ; For full 8-bit via envelope, different timing required (see below)

    pla
    ; ACK IRQ
    rti
```

The full 8-bit envelope technique requires precisely timed gate sequences spanning multiple IRQ slots. The envelope counter increments once per specific number of cycles depending on the ATTACK rate value 0 (one increment every ~15 cycles at PAL clock; PAL φ2 = 985248 Hz, attack-rate-0 spec = 2 ms to peak, 256 envelope steps → 7.7 µs/step → ~15 φ2 cycles/step). Counting exactly enough IRQ cycles to arrive at the target amplitude requires very precise IRQ timing — this is why this is classified scene-tier. The Hermit technique in its simplest deployable form produces 5-6 effective bits; the most refined variants (Mahoney "Musik Runs in the Family") achieve perceptual quality close to 8 bits.

**Mahoney technique (8580-specific).** Jan Lund Thomsen documented in detail (published as "Musik Runs in the Family," 1994) that the 8580 can be driven to produce high-resolution audio by exploiting the resonance self-oscillation at high Q values combined with carefully timed pulse-width writes:

1. Set voice 3 to pulse waveform, TEST bit set (oscillator locked at DC).
2. Set resonance to 15 in $D417; route voice 3 to filter.
3. Write sample bytes to $D411 (PWHI3 — pulse width high nibble of voice 3).
4. The locked accumulator means the comparator output is entirely determined by the pulse width vs. the locked accumulator value. Because the accumulator is at zero (TEST held), the pulse output is $FFF or $000 depending on whether PW > 0. By setting TEST, the output is always $000 (output low = silence) until we manipulate something...

Actually the precise mechanism used in practice: set voice 3 to pulse, set GATE, do NOT set TEST. Use the pulse width as a DAC: when PW = $000 the output is constant low; when PW = $800 it is constant $FFF (or close). Drive PWHI3 with the sample high nibble each IRQ. At resonance 15 the filter ring amplifies the result. This is approximate; the exact implementation details are in Hermit's and Mahoney's original source (Codebase64 forum).

### Why it works

The core insight is that the SID has multiple analog signal paths that can be driven by digital writes at different resolutions. The $D418 volume register gives 4 bits directly. The pulse-width register gives 12 bits of comparator control, of which only the high nibble needs to change to get 4-bit-equivalent control with the oscillator locked via TEST. Combining both paths gives more effective resolution. The filter resonance adds gain at the cutoff frequency, boosting low-amplitude signals to audible levels on the 8580 where the raw DAC change is too small to hear without it.

### Variations

**PWM digi (8580 software-only).** Set a voice to PULSE+TEST (oscillator locked at zero). Modulate PWHI (the 4-bit high nibble of pulse width) with sample values each IRQ. Because the locked oscillator produces a DC level determined by the PW comparator, modulating PW changes the DC level, which drives the analog output. This is the most reliable software-only digi method on stock 8580.

**Test-bit digi.** Rapidly toggle the TEST bit at audio frequency. The duty cycle of the toggling produces an average DC level that the filter and volume DAC amplify. Produces lower effective resolution but requires only one bit manipulation per sample.

---

## sidfx_layered_chip — Two-SID setups

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418

### Why

Three voices is a severe constraint for anyone who wants chord harmonies, polyphonic melody, rhythm and bass simultaneously, or sample playback coexisting with full-voice music. Hardware expansion cards that install a second SID chip are common in the advanced demo scene and among serious SID musicians. Understanding how two-SID setups work — and where the convention places the second chip — is necessary for reading scene-quality SID music source and for writing code that gracefully degrades on stock hardware.

**Scope notice:** Stock C64 does not have a second SID. This technique is hardware-mod-only. The register addresses and detection logic documented here describe the dominant convention; actual stock-C64 output ignores $D420 (it falls within the SID mirror range, see below). Recipes for this project target stock C64 only; this section is reference material.

### How

The first SID is always at $D400-$D418 (stock C64 mapping). The second SID address depends on the expansion hardware:

| Hardware | Second SID address | Notes |
|----------|--------------------|-------|
| C64 Reloaded MK2 | Configurable, common: $D420 | Default factory setting |
| SID Symphony cartridge | $DE00 | Cartridge port expansion I/O |
| Ultimate II+ | Configurable | Settings in Ultimate menu |
| SidCard v2 | $D500 | Rare; 1980s hardware |

**$D420 vs. mirroring.** The stock C64 SID is mirrored every 32 bytes through $D7FF (the PLA decodes only bits 5-0 of the address for SID chip select, so $D420, $D440, $D460... all hit the same chip). On boards with a hardware second SID, the chip select is modified so $D420 addresses the second chip instead of mirroring the first. Code that writes $D420 on stock hardware writes to the first SID voice 1 registers (same as writing $D400). Graceful degradation is therefore automatic on stock hardware — two-SID music defaults to single-SID behavior, just with duplicate writes.

**Detecting second SID presence.** A common detection method reads the SID's open-bus behavior: all real SID registers are write-only and return open-bus on read. On real hardware the open-bus value for a SID register is typically the last byte placed on the data bus by the VIC-II (the high byte of the last VIC address fetch). Some detection schemes write a known value to a SID register, then try to write a different value to $D420 and read back $D420 — if the read returns a different bus state, a second SID is likely present. This detection is fragile; more reliable methods require a combination of reads across multiple cycles. Recommended practice: expose a user toggle rather than auto-detecting.

An Oscar64 approach:

```c
#include <c64/sid.h>

// Map second SID at $D420 (C64 Reloaded default)
#define sid2 (*((struct SID *)0xd420))

// Init both SIDs
void init_both_sids(void)
{
    // Zero first SID
    byte *p = (byte *)0xd400;
    for (byte i = 0; i <= 0x18; i++) p[i] = 0;
    sid.fmodevol = 0x0F;   // volume 15, no filter

    // Zero second SID (writes to $D400 on stock hardware, harmless)
    byte *q = (byte *)0xd420;
    for (byte i = 0; i <= 0x18; i++) q[i] = 0;
    sid2.fmodevol = 0x0F;
}
```

**Composing for two SIDs.** Two-SID tunes use six voices total. Conventional assignment: SID1 voices 1-3 for melody + bass, SID2 voices 1-3 for chords + extra percussion or samples. GoatTracker 2.x supports stereo SID output with configurable second-chip address. SidFactory II has native two-SID editing. HVSC metadata identifies stereo SID files with the `stereo` flag and the second SID address in the header's `secondSIDAddress` field.

### Why it works

A second SID chip, properly wired into the bus, responds to its assigned address range like any peripheral. The audio outputs of both chips connect to the same output mixer (either summed in hardware or via separate left/right audio channels for stereo). The CPU writes to each chip independently using its respective address range. The play routine simply doubles the number of SID writes per frame: init, update, and gate operations run for each voice on each chip.

### Variations

**Mono two-SID summed.** Both chips output to the same audio line. Six voices sound richer than three but the mix can be muddy at full volume. Composers reduce per-voice amplitude by setting lower sustain levels.

**Stereo two-SID.** C64 Reloaded MK2 and some cartridges route the two chips to separate left/right outputs. HVSC stereo SID files are mixed for left/right separation. Playback on systems with only mono output sums both channels.

**$DE00 expansion-port SID.** The SID Symphony cartridge maps the second SID to $DE00 (Cartridge port expansion area 1). This address does not conflict with any stock C64 hardware and is detectable more reliably than $D420 since it does not overlap the mirror range. Tunes targeting SID Symphony set the second address to $DE00 in their header.

---

## sidasid_emulation_notes — How SID emulators differ from real silicon

**Complexity:** medium
**Region:** both
**Uses registers:** D415, D416, D417, D418

### Why

Every Oscar64 SID recipe will be tested first in VICE, not on real hardware. VICE ships reSID (version 3.x in recent VICE releases), which is the most accurate publicly-available SID emulation, but "most accurate" is not "bit-perfect." Knowing where reSID diverges from real silicon prevents debugging phantom issues where a recipe sounds wrong on hardware but fine in the emulator, or vice versa.

### How

#### Filter cutoff curve

The most significant deviation is the 6581 filter cutoff curve. Real 6581 chips vary between manufacturing batches; reSID approximates the curve from measurements of a handful of chips with a polynomial model. The result:

- At low cutoff values ($D416 < $20), reSID opens the 6581 filter more than most real chips. A patch with a closed low-pass filter sounds brighter in reSID than on hardware.
- At high cutoff values ($D416 > $C0), reSID is close to real hardware behavior.
- Mid-range ($D416 $20-$B0) is where the polynomial fit is most uncertain; filter sweep effects may have slightly different sweep rates.

The 8580 filter curve in reSID is close to real hardware and more reliable for testing than the 6581 model.

**Practical recommendation:** Compose and test with the emulated chip set to 8580. The 8580 model is more accurate and more consistent across physical chips. Ship with a note in the SID header indicating the target chip revision.

#### ADSR bug timing

The ADSR bug in reSID (v3.x) is implemented but with slightly different rate-counter timing than real hardware. On some specific rate transitions the "wrap" delay is a few cycles longer or shorter than measured on real 6581 chips. This matters for:

- Very fast arpeggios where the hard restart's AD=0 write races the next gate.
- Digi routines that rely on exact envelope-level timing.

In practice the difference is rarely audible in music playback. For digi timing, always test against real hardware before claiming cycle-exact behavior.

#### 8580 digi click suppression

reSID 3.x correctly models the 8580's reduced DC offset: $D418 volume writes produce nearly silent output in the 8580 emulation, matching real hardware. Earlier versions of reSID (v0.16-era) incorrectly made 8580 digi audible. If you test digi recipes with older VICE versions you may hear output that is absent on real 8580 hardware.

#### Combined waveforms

reSID uses lookup tables derived from chip measurements to model combined waveforms. The tables were measured from a small number of chips; combined waveform output on chips outside the measurement set may differ. The 6581 combined waveform model in particular is based on older measurements; the 8580 model is generally more reliable.

#### Cycle-exact register writes

reSID is not cycle-exact in VICE's default mode (it runs with a cycle granularity of 1 SID clock = 1 CPU clock, which is correct, but the audio output is buffered and interpolated). This is accurate enough for all music techniques. The cycle granularity difference matters only for techniques like oscillator-sync sweeps that involve writes on specific sub-cycle boundaries — real hardware may produce a slightly different transition glitch than reSID predicts.

#### $D41B/$D41C sampling

VICE samples $D41B (OSC3) and $D41C (ENV3) correctly but with the caveat that the values lag by one clock cycle compared to the CPU's write clock in some edge cases. Code that reads $D41B immediately after changing voice 3's frequency may get the previous accumulator value. A one-cycle NOP between the write and the read eliminates this.

### Why it works

reSID is an analog-circuit simulation using a mix of analytical models (for the digital sections) and empirical lookup tables (for the non-linear analog sections). The digital parts — oscillators, LFSR, gate logic, rate counters — are modeled exactly. The non-linear parts — the 6581 filter and the 6581/8580 waveform combiners — use polynomial fits or lookup tables from physical measurements. Accuracy is highest where the chip behavior is linear and consistent across revisions; it degrades where behavior is non-linear, chip-dependent, or temperature-sensitive.

### Variations

**Testing against multiple VICE SID backends.** VICE supports three SID engines at runtime: `fastsid` (simple model, fast, inaccurate), `reSID` (default, described above), and `reSID-fp` (floating-point version of reSID, slightly more accurate at filter extremes, slower). For verifying SID techniques, use reSID. For final hardware validation, test on a real C64 with both 6581 and 8580 if possible, or use the 1541 Ultimate II+ with its SID emulation mode as an intermediate step.

**HVSC SID compatibility metadata.** The High Voltage SID Collection tags each tune with the target SID model (6581/8580/both) in the `.SID` file header byte $77 (`SID model` flags: bits 0-1 for first SID, bits 2-3 for optional second). STIL.txt adds human-readable notes. When ingesting SID files into a game, check this field to select the appropriate per-chip frequency and filter tables.

**GoatTracker's chip selection.** GoatTracker 2.x has a per-instrument SID model toggle. Tunes exported from GoatTracker for specific hardware use different filter tuning tables per chip. The exported `.sid` file header encodes the target chip. Load these into VICE with the emulated chip set to match.

---

*Cross-references: [docs/hardware/sid-reference.md](../hardware/sid-reference.md) for the full register map, ADSR table, programming patterns, and pitfalls. [docs/recipes/oscar64/sid-music-player.md](../recipes/oscar64/sid-music-player.md) for a working Oscar64 implementation of sid_voice_setup + sid_play_routine_pattern.*
