---
category: music
chip: SID
---

<!-- doc-type: technique-reference -->

# SID Music and Audio Techniques

The MOS 6581/8580 SID chip, the C64's sound chip, has three voices, a shared analog filter and several hardware quirks. This page covers per-voice frequency, waveform and envelope; filter wiring; the init/play convention; why the two chip revisions sound different; 4-bit and 8-bit sample playback; two-chip stereo; and the emulator fidelity gaps that matter when testing recipes.

All SID registers $D400-$D418 are write-only. The chip cannot be read back; code must maintain software shadow copies when it needs to modify individual bits. The four read-only registers ($D419-$D41C) return paddle inputs and voice 3 status; they are not discussed here. For the full register map see [docs/hardware/sid-reference.md](../hardware/sid-reference.md).

The Oscar64 canonical interface for this chip lives in `c64/sid.h`, which defines the `struct SID` layout (three `Voice` structs followed by filter registers) and the `sid` macro expanding to `(*((struct SID *)0xd400))`. Frequency macros `SID_FREQ_PAL(f)` and `SID_FREQ_NTSC(f)` compute the 16-bit register value from a Hz argument using fixed-point arithmetic.

---

## sid_voice_setup — Frequency / waveform / ADSR per voice

**Complexity:** low
**Region:** both
**Uses registers:** D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414
**Claims:** sid_voice_1-3 (shares)
**Claims basis:** derived-listing

`shares`, as a way into a voice rather than an effect: the technique is
the register layout, and which voice it writes is the caller's choice.
The technique that plays the voice (a player, an instrument, an effect)
owns it. Read off `recipes/kickassembler/music-player.md`, which writes
all three voices through `$D400,X` with X = 0, 7, 14.

### Why

Playing a musical note on the SID requires configuring seven registers per voice: two bytes of frequency, two bytes of pulse width, one control byte selecting the waveform and triggering the envelope, and two bytes encoding the four ADSR envelope parameters. Every other SID technique (filter routing, play routines, digi) builds on this layout.

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
F_PAL  = f * 16777216 / 985248   ~= f * 17.0284
F_NTSC = f * 16777216 / 1022727  ~= f * 16.4044
```

(Earlier figures of 17.0288 and 16.4046 here were arithmetic slips; the quotients are 17.02842 and 16.40439.) The PAL register value for A4 (440 Hz) is $1D45 (7492.5, rounded up); `sid.h`'s `SID_FREQ_PAL(440)` truncates to $1D44, one step below. Most SID players ship a 96-entry table (8 octaves × 12 semitones) with precomputed PAL and NTSC values rather than computing at runtime.

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
| 3 | TEST | Reset accumulator to zero and hold; the noise LFSR stops shifting and keeps its contents (it is not reset — an earlier version of this row said it was) |
| 2 | RING | Ring-modulate triangle with previous voice's oscillator MSB |
| 1 | SYNC | Hard-sync accumulator to previous voice's oscillator MSB transitions |
| 0 | GATE | 0 = release phase; 1 = attack-decay-sustain phase |

Setting GATE starts the attack. Clearing GATE starts the release from the current envelope level. Waveform bits can be ORed together; the output is the bitwise AND of each enabled waveform's 12-bit value. See the [sid-reference](../hardware/sid-reference.md#d404--vcreg1--voice-1-control-register-w) for combined-waveform behavior.

### Why it works

The phase accumulator advances by F every cycle. When it overflows the 24-bit range it wraps, completing one oscillator period. The waveform generator derives its output from the accumulator's upper bits: the sawtooth is the top 12 bits directly; the triangle folds them symmetrically; the pulse compares the top 12 bits against PW11-PW0 and outputs either $FFF or $000. The noise waveform takes eight bits from a 23-bit LFSR that is shifted each time bit 19 of the accumulator rises: sixteen shifts per oscillator period, not one per period (measured in VICE x64sc reSID: at F=$1000 the $D41B value holds for about 256 cycles between changes, where once-per-period clocking would hold it for 4,096; over 65,536 back-to-back polls it changed 5,617 times against roughly 313 expected from MSB clocking; an earlier version of this sentence said the LFSR was clocked by the accumulator's MSB). The ADSR envelope generator multiplies the waveform output by the current envelope level (0-$FF), giving notes their amplitude shape.

### Variations

**Pulse-width modulation (PWM) pads.** Route an LFO into the pulse-width registers while holding the PULSE waveform. Voice 3's oscillator output ($D41B) is the standard LFO source; read it each frame and write the result to the target voice's PWHI register. The result is the wobbling SID pad timbre.

**Ring modulation.** Set the RING bit alongside TRI. The triangle's MSB is XORed with the previous voice's oscillator MSB (voice 1 modulates against voice 3; voice 2 against voice 1; voice 3 against voice 2). Produces inharmonic bell-like tones. The modulator voice must have a non-zero frequency but does not need to be gated or audible.

**Oscillator sync.** Set the SYNC bit. When the modulator voice's accumulator MSB rises, this voice's accumulator resets. Sweep this voice's frequency while holding the modulator steady for a sync sweep.

**Noise drums.** Set the NOISE bit with a short attack, zero sustain, and short release. Each gate-on starts a percussive burst. Setting TEST briefly before each hit restarts the oscillator from accumulator zero, so the pitched part of the drum and the LFSR's clocking phase are locked; it does not re-seed the noise, which resumes from wherever the LFSR stopped (an earlier version said TEST re-seeded the LFSR). Only a TEST held for about two PAL frames on a 6581 leaves the register at a known all-ones state (see the sid-reference TEST entry); on an 8580 that takes seconds.

### Cycle budget

Voice setup writes are not time-critical; they happen before the note sounds. The IRQ overhead for a play routine that updates all three voices and the filter is approximately 9 registers × 4 cycles per STA = 36 cycles minimum, plus subroutine overhead and frequency-table lookups. At 50 Hz (PAL) a frame is 19656 cycles; a minimal three-voice update consumes under 0.3% of available cycles.

### Recipes

- `recipes/oscar64/sid-music-player.md`

---

## sid_filter_routing — Filter cutoff / resonance / voice-routing setup

**Complexity:** medium
**Region:** both
**Uses registers:** D415, D416, D417, D418
**Requires:** sid_voice_setup

### Why

The SID's analog multi-mode filter shapes the spectrum of the voices routed through it; without it, three-voice SID tunes sound flat. It can cut high-frequency content off bass voices, sweep a resonant peak across a lead, or combine low-pass and high-pass modes into a vowel formant. Four SID registers control it.

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

LP, BP, and HP bits can be combined: LP+HP produces a notch filter; LP+BP gives a wider band-pass; setting all three is rarely useful.

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
    // ffreq low byte -> $D415 (bits 2-0), high byte -> $D416 (FC10-FC3)
    sid.ffreq = 0x4000;  // $D415 = 0, $D416 = $40 (cutoff11 = $200)
}

// Call this from a raster IRQ or main loop to sweep the filter
void update_filter_cutoff(unsigned cutoff11)
{
    // cutoff11: 0-2047
    // ffreq is the 16-bit register: low byte = D415, high byte = D416
    // but D415 only uses bits 2-0; the upper 5 bits of the low byte are ignored
    sid.ffreq = (cutoff11 & 7) | ((cutoff11 >> 3) << 8);
    // equivalent to: D415 = cutoff11 & 7, D416 = cutoff11 >> 3
}
```

An earlier version of this example wrote `sid.ffreq = 0x0200` and `(cutoff11 >> 3) | ((cutoff11 & 7) << 13)`; compiled with `oscar64 -O2 -n`, those put $02 (not $40) in $D416 and sent the eight high cutoff bits to $D415, where bits 7-3 are ignored, so every cutoff it wrote was wrong. The values above compile to `$D415 = cutoff11 & 7`, `$D416 = cutoff11 >> 3` as the comment says.

The `SID` struct in `c64/sid.h` declares `ffreq` as `volatile unsigned`, so one C assignment compiles to two separate 8-bit stores; the 6502 has no 16-bit store (an earlier version of this note said "a single instruction"). Oscar64 currently emits the low byte ($D415) first, then the high byte ($D416), but C does not guarantee that order. Neither the SID datasheet nor this knowledge base's SID reference documents any write-order requirement or latching of the cutoff pair: each byte takes effect as it is written, so the filter briefly sees a mixed old/new value between the two stores. That transient lasts a handful of cycles and is inaudible in practice; the order does not matter for correctness.

### Why it works

All three voices (and the external audio input if FILTEX is set) share a single analog filter. Voices with their FILT bit clear bypass the filter entirely and go straight to the volume DAC at full bandwidth. Voices with FILT set pass through the filter's LP/BP/HP network before reaching the DAC. The analog filter's cutoff frequency is set by the 11-bit value; resonance emphasizes a narrow band around the cutoff frequency, producing a ringing or squealing tone. The 6581 filter is a switched-capacitor design with strongly non-linear cutoff response; the 8580 uses a different cell design with near-linear response.

Changing $D416 while voices are playing produces a live filter sweep; SID tracker filter automation works this way. Because the filter is analog and there is no sample clock, sweeps are continuous.

### Variations

**Notch filter for pad sounds.** LP+HP simultaneously (bits 4 and 6 set in $D418) creates a notch filter: all frequencies pass except a null band around the cutoff. Suits formant-like vowel textures on sustained pad voices.

**Filter as LFO target.** Route voice 3 as the LFO source ($D41B output read each frame) and write its output scaled into $D416. The filter then tracks the LFO, producing a cyclic filter sweep without CPU intervention beyond the per-frame copy.

**High resonance as pseudo-oscillator.** At maximum resonance (15) the 8580 filter self-oscillates around the cutoff frequency, producing a sine-like tone. Some SID composers exploit this as a fourth voice by routing a silent voice through the filter and relying on self-oscillation. Less predictable on 6581 (individual chips vary in how close to self-oscillation they reach at RES=15).

**Voice muting via filter.** Setting $D418 to filter mode bits but VOL=0 silences all output; restoring VOL fades all voices back. For a fade-out this is cleaner than gating voices individually; still avoid a sudden VOL jump (see pitfall `$D418 popping` in [sid-reference.md](../hardware/sid-reference.md#pitfalls)).

---

## sid_play_routine_pattern — The init+play subroutine convention

**Complexity:** low
**Region:** both
**Uses registers:** D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418
**Requires:** sid_voice_setup
**Cost:** cycles_per_frame=1198, cycles_per_frame_typical=779, irq_slots=1, bytes_code=1414, bytes_data=1070, zp_bytes=0
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-music-player (worst of 2,000 calls, PAL, a frame where an effect hands voice 3 back; 1,159 with no effect; NTSC 1,174; typical is the NTSC median, PAL 773; bytes from the symbol file: player code $10FD-$1682, data is player state 322 + effect data 249 + octave-6 tables 48 + tune 451)
**Claims:** sid_voice_1-3 (owns), sid_filter_volume (owns)
**Claims basis:** estimated

(An earlier version gave 327 cycles, measured on the stub tune of `oscar64-sfx-engine`; a full player with instruments, filter and effects costs 1,198 at worst, measured with CIA1 timer A around every call of `recipes/kickassembler/music-player.md`.)

### Why

Every C64 SID tune, whether produced by a tracker (GoatTracker, SidFactory II, defMON) or hand-coded, exposes exactly two entry points to the host: an `init` subroutine that sets up the tune and a `play` subroutine that must be called once per frame. This two-entry-point contract is how SID players, emulators, and game engines integrate music without needing to understand the tune's internals. Oscar64 code drives SID tune files through this contract.

### How

The canonical contract:

- **init(A = song_index):** Call once. Accumulator A selects which subtune to play (0-based). The routine initializes all SID registers, sets up internal player state, and returns. Multiple calls to init (with the same or different song index) must be safe: the player zeroes or resets all state on every init call.
- **play():** Call once per frame (typically from a raster IRQ at line 0 or wherever the game places its audio IRQ). The routine reads the current frame count from internal state, computes the SID register values for this frame, writes them to $D400-$D418, and returns. The play routine must not corrupt the CPU registers it uses without saving and restoring them; well-written players save A, X, Y on the stack and restore before returning.

The Claims line rests on this contract: a player writes all three voices and $D415-$D418 every frame. The recipes that implement the pattern here do not show it. `sid-music-player.md` plays voice 2 only, `simple-shmup.md` plays its music on voice 1, and `cracktro-template.md` calls a stub that returns at once. The basis is therefore `estimated`.

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
    // Acknowledge raster IRQ
    vic.intr_ctrl = 1;

    // Call SID play routine
    sid_tune_play();

    // ...rest of frame work...
}

int main(void)
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
    return 0;
}
```

(An earlier version of this fragment wrote `vic.irq = 1` and `void main(void)`; neither compiles: `vic.h` names the field `intr_ctrl`, and Oscar64's `crt.c` declares `int main`, so `void main` is refused with "Function declaration differs".)

**PSID and RSID file formats.** SID tune files (.SID) carry the `init` and `play` addresses in a fixed header:

- Bytes $06-$07: `data_offset` — offset of the tune body from the start of the file ($007C for v2)
- Bytes $08-$09: `load_address` — where to load the tune data (0 = the body's first two bytes hold the address, little-endian, and are not part of the code)
- Bytes $0A-$0B: `init_address` — entry point for init
- Bytes $0C-$0D: `play_address` — entry point for play (0 = init installs its own IRQ handler, raster or CIA)
- Bytes $0E-$0F: `songs` — total number of subtunes
- Bytes $10-$11: `start_song` — default subtune (1-based)

All header words are big-endian. An earlier version of this list was shifted one word. It called $06-$07 the load address, $08-$09 init, $0A-$0B play, and read `songs` and `start_song` from single bytes $0F and $10, the second of which is the always-zero high byte of a big-endian word. The offsets above agree with [formats/c64-file-formats.md](../formats/c64-file-formats.md).

PSID (most common) is the player-driven variant: the player itself calls init and then play on a VBI or CIA tick, and before each call it sets $01 from the routine's address ($37 below $A000, $36 below $D000, $35 at $E000 and above with the KERNAL banked out, and $34 in the $D000 page), so a PSID tune cannot assume the KERNAL is mapped in and should be self-contained. RSID ("Real SID") is the opposite: the tune gets the C64 power-on environment as-is ($01 = $37 with KERNAL and BASIC ROMs banked in, CIA 1 timer A interrupting at 60 Hz) and must configure the hardware and install its own interrupt handler, so play_address, load_address (in the header) and speed are all 0 and init must live in RAM at or above $07E8. KERNAL and BASIC use is legitimate in RSID (the RSID-only BASIC flag even runs the tune as a BASIC program). An earlier version of this paragraph had the emphasis backwards, saying PSID tunes may call the KERNAL and RSID tunes may not. Most emulator players handle both; extracting a tune into an Oscar64 project is simpler with PSID because the host calls init/play itself. See formats/c64-file-formats.md for the header.

### Why it works

The play routine is called once per frame (every 20 ms on PAL, every 16.7 ms on NTSC). That gives the player 50 opportunities per second on PAL (about 60 on NTSC) to rewrite any of the 25 registers: at most 1,250 writes a second, not the 15,600 an earlier version of this sentence claimed (312 × 50 counts raster lines, not register writes). The player's job each frame is to advance its internal sequencer by one tick (or by a fraction of a tick if the tune runs at a sub-frame rate), compute any pitch slides, vibrato, or arpeggio values for each voice, and write the result to SID. Because SID registers are write-only and take effect immediately, the writes can happen at any point in the frame without synchronization. The SID has no register-latch mode that defers application.

The call sits in a raster IRQ rather than the main loop for timing stability. A main loop with variable per-frame work produces jitter in the audio write timing. The raster IRQ fires at a fixed line number every frame, guaranteeing the play routine runs at the same point in every frame regardless of what the main loop is doing.

### Variations

**CIA-timed play.** Some tunes embed their own CIA timer IRQ setup and call the play routine on a sub-frame rate (e.g. 50 Hz for the music while the game runs at 25 Hz). The `.play_address` field in PSID can be $0000, indicating the tune installs its own IRQ. Standard SID players handle this case.

**Multi-speed tunes.** Certain trackers call the play routine 2× or 4× per frame (CIA timers) to achieve smoother vibrato and faster arpeggios than 50 Hz allows. A 4× tune calls play 200 times per second on PAL.

**Overlay (co-call) pattern.** A game's existing raster IRQ chain calls the SID play routine as one step in a multi-step handler. The play routine returns normally and execution continues with sprite positioning, scroll updates, and so on. This is the standard Oscar64 game structure.

### Cycle budget

What each feature of `recipes/kickassembler/music-player.md` costs, measured in VICE x64sc 3.10 (rung 1). Method: the listing was built with one of its `-define` switches, which removes that feature's per-frame code and its per-note setup, and every one of the harness's 2,000 CIA1 timer A counts of `music_play` was read from a VICE monitor trace of its `cost` store. The build with no switch is byte-identical to the published one and gives the published figures. Cycles per call; the change from the full player in brackets. PAL is the C64C default model, NTSC is `-model ntsc`; the NTSC median and mean cover the 1,667 calls that are not skipped.

| Build | PAL worst | PAL median | PAL mean | NTSC worst | NTSC median | NTSC mean |
|---|---|---|---|---|---|---|
| Full player | 1,198 | 773 | 787 | 1,174 | 779 | 788 |
| `NO_VIB`: no vibrato | 1,159 (-39) | 720.5 (-52.5) | 736 (-51) | 1,174 (0) | 726 (-53) | 741 (-47) |
| `NO_PWS`: no pulse sweep | 1,159 (-39) | 684 (-89) | 722 (-65) | 1,174 (0) | 691 (-88) | 724 (-64) |
| `NO_FLT`: no filter program | 1,132 (-66) | 706 (-67) | 716 (-71) | 1,109 (-65) | 707 (-72) | 718 (-70) |
| `NO_WT`: wavetable read on the note's first frame only (no arpeggios, no drum sweeps) | 1,161 (-37) | 591.5 (-181.5) | 641 (-146) | 1,165 (-9) | 596 (-183) | 644 (-144) |
| `NO_HR`: no hard restart | 1,198 (0) | 769.5 (-3.5) | 776 (-11) | 1,174 (0) | 766 (-13) | 776 (-12) |
| `NO_LEG`: no legato | 1,184 (-14) | 764 (-9) | 780 (-7) | 1,193 (+19) | 763 (-16) | 780 (-8) |
| `NO_FX`: no sound effects | 1,117 (-81) | 737 (-36) | 751 (-36) | 1,125 (-49) | 743 (-36) | 753 (-35) |
| All seven off | 1,019 (-179) | 303 (-470) | 372 (-415) | 1,027 (-147) | 311 (-468) | 381 (-407) |

- **The worst-call savings do not add.** Removing a feature moves the worst call to another frame. The seven PAL worst-call savings sum to 276, but removing all seven saves 179. The mean savings come close to adding: they sum to 387 on PAL, against 415 for all seven (arithmetic).
- **Plan the worst frame from the table's worst column, not from the mean.** Hard restart saves nothing at worst because the worst frame is a note-start frame, and the restart runs two frames earlier.
- **Legato saves cycles.** With `NO_LEG` every note of the legato instrument gates and writes AD and SR, and the NTSC worst call rises by 19.
- **The savings depend on the tune.** In "Test Card", one instrument has vibrato (the lead), four have a pulse sweep and two run a filter program. A tune that uses a feature more often gains more by removing it.
- **Removing a feature changes the sound.** Nobody has listened to any of these builds. `NO_FX` also drops the harness's effect requests, so that build reports FAIL; its cycle counts are still valid.
- **The floor is 1,019 cycles at worst on PAL.** That is order lists, patterns, envelopes and gates with every feature off.

### Recipes

- `recipes/oscar64/sid-music-player.md`
- `recipes/kickassembler/music-player.md` (a full player: order lists, instruments, wavetable, hard restart, filter, effects on voice 3; worst call measured)
- `recipes/oscar64/sfx-engine.md` (a table-driven effect borrowing a voice from a play routine that writes all three, and giving it back; register-level checksum, nobody has listened)

---

## sid_8580_vs_6581_differences — Chip revision differences

**Complexity:** low
**Region:** both
**Uses registers:** D404, D405, D406, D40E, D40F, D412, D415, D416, D417, D418, D41B

### Why

The C64 shipped with two distinct SID revisions across its production life: the 6581 (1982 through approximately 1986) and the 8580 (1987 through 1992). The two chips share one register interface but sound different. Music tuned on a 6581 may sound wrong on an 8580 and vice versa. Cross-compatible music code, or code that targets one revision, has to account for the differences below.

### How

#### Filter cutoff curve

The 6581 filter uses a switched-capacitor design with a strongly non-linear cutoff-versus-register-value curve. The curve is roughly sigmoidal on a logarithmic frequency scale, and it varies between individual chips from different manufacturing batches. A $D416 value of $40 that places the cutoff at ~1 kHz on one 6581 may produce ~600 Hz on another. Music tuned for a specific 6581 often sounds slightly wrong on a different 6581 of the same nominal revision, let alone on an 8580.

The 8580 filter has a near-linear cutoff curve and is consistent between chips. A $D416 sweep that sounds even-stepped on an 8580 sounds compressed at the low end and spread at the high end on a 6581.

Standard practice: SID players ship two filter-cutoff tables (one per chip revision) and detect which revision is present at startup.

#### ADSR bug

Both chips share a hardware quirk in the envelope rate counter: if code writes a smaller rate value to $D405 or $D406 than the 15-bit internal rate counter has already counted past for the current phase, the counter must wrap through its full 15-bit range (up to 32768 cycles, approximately 33 ms at PAL) before the envelope generator acts on the new rate. This causes new notes to play at the wrong envelope shape until the counter wraps. The standard workaround is the "hard restart" sequence (see the `Programming patterns` section in [sid-reference.md](../hardware/sid-reference.md#hard-restart-adsr-bug-workaround)):

```asm
// Hard restart: three steps over two frames, starting 2 frames before the note
hard_restart:
    lda #0
    sta $D405       // AD = 0 (attack 2ms, decay 6ms — fastest possible)
    lda #$F0
    sta $D406       // SR = $F0 (sustain max, release 0 — no decay hang)
    lda ctrl_shadow
    and #$FE
    sta $D404       // clear GATE bit to start release
    rts
// ... 1 frame later ...
hard_restart_test:
    lda #$09
    sta $D404       // TEST+GATE: reset oscillator, start attack
    rts
// ... 1 frame later (the note frame) ...
hard_restart_note:
    lda real_ad
    sta $D405
    lda real_sr
    sta $D406
    lda real_ctrl_with_gate
    sta $D404       // release TEST; GATE + waveform, correct values
    rts

ctrl_shadow:         .byte 0   // software copy of $D404 (write-only register)
real_ad:             .byte 0
real_sr:             .byte 0
real_ctrl_with_gate: .byte 0
```

An earlier version of this listing had only two steps. It went from the gate-off frame straight to the note frame, dropping the TEST+GATE frame that sid-reference.md's hard-restart pattern puts between them, and its comment said "2 frames" while the body waited one; it also read a `$D404_shadow` label that no assembler accepts. The three-step form above mirrors the reference. The 6581 exhibits the ADSR bug more visibly at certain rate combinations; the 8580 is slightly less severe in some cases, but the bug exists on both and should always be worked around.

#### $D418 sample replay (digi) difference

The 6581 has a measurable DC offset at the master volume DAC. Writing varying 4-bit values to $D418 bits 3-0 modulates this offset and produces audible clicks, enabling 4-bit PCM playback (see `digi_4bit`). The 6581's DC-offset amplitude is large enough to produce clear speech and sampled sound at multi-kHz rates.

The 8580 cleaned up the DAC design; the DC offset is nearly absent. The same $D418 write sequence produces volume levels that are too small to hear without hardware assistance. The standard hardware fix is a 330-740 kΩ resistor between SID pin 26 (EXT IN) and either GND (pin 14) or +5 V, which injects a signal into the filter path that the DAC can modulate. Without this resistor, software-only digi on a stock 8580 requires different techniques (see `digi_8bit_hard_restart`).

#### Combined waveforms

Enabling more than one waveform bit simultaneously produces a bitwise AND of the waveform outputs. On the 6581 this combined output is quieter and exhibits noise artifacts at the zero-crossing points. On the 8580 the combined output is louder and cleaner. Tunes that rely on TRI+PULSE for warm pad sounds or TRI+SAW for soft brass will sound louder and brighter on 8580 than on 6581. The exact bit patterns produced by combined waveforms depend on the chip revision; some combinations produce a fundamentally different harmonic spectrum between revisions. Measured levels in reSID for saw+pulse and tri+pulse across pulse widths, both models, are in [sid-reference.md](../hardware/sid-reference.md) under "Combined waveforms": saw+pulse is silent on the 6581 at PW `$800` and above, while tri+pulse is within 3 % between the models, so the TRI+PULSE half of the sentence above does not hold in reSID (TRI+SAW was not measured).

#### Voltage and capacitor differences

This matters only when testing on real hardware: the 6581 requires +12 V Vdd and uses 470 pF filter capacitors. The 8580 runs on +9 V and uses 22 nF capacitors. The 6582 designation is an 8580 in a different package. Swapping chips without changing the power rail and capacitors results in audibly wrong filter behavior or chip damage.

### Variations

**Chip detection at runtime.** Runtime detection cannot observe the filter from software: the only readable voice-3 registers are $D41B (oscillator) and $D41C (envelope), and both sit before the filter in the signal path, so no cutoff, mode or routing write changes what they return (see sid-reference.md, Filter signal flow; an earlier version of this paragraph said the filter's effect could be measured through $D41C). The standard detection routine instead uses $D41B: write $FF to $D412, $D40E and $D40F, then write $20 to $D412 (sawtooth, TEST and GATE cleared) and read $D41B immediately — the value differs between revisions because the two chips reset and restart the accumulator differently. In VICE 3.10 reSID the read returns 3 for the 6581 model and 2 for the 8580 model; treat the real-hardware values as the same but unverified here. Some SID players autodetect; others expose a settings toggle. Detection is imprecise (some SIDs answer ambiguously); use it only to select between precomputed cutoff tables, and offer a settings toggle as the fallback.

**Per-chip optimization.** SID music is often composed explicitly for one chip revision. The composer notes the target in the HVSC (High Voltage SID Collection) metadata (`STIL.txt` or the SID file header `SID model` field). Playback on the other revision will sound different.

---

## digi_4bit — 4-bit digi playback via $D418 volume

**Complexity:** high
**Region:** both
**Uses registers:** D418
**Demands:** continuous_interrupts

### Why

The C64 has no dedicated PCM audio hardware; the SID chip was designed as a synthesizer. Ghostbusters speech, the Arkanoid title track and Mahoney's "Musik Run/Stop" sampled instruments are nevertheless PCM playback in C64 software. The mechanism is a hardware accident in the 6581 SID: the master volume register works as a 4-bit DAC when written fast enough. C64 demos and games play speech and percussion samples this way.

### How

The $D418 register's lower nibble (VOL, bits 3-0) sets the master output volume. On the 6581 the DAC that drives the audio output pin has a measurable DC offset; changing this nibble between values produces an audible click proportional to the step size. Streaming a series of 4-bit values to $D418 at a regular rate reproduces PCM audio at 4-bit resolution.

Sample rate is determined by the IRQ frequency: any timer that fires and writes a new nibble to $D418 contributes one sample. The practical range on PAL is:

- **Low rate (4-8 kHz):** One IRQ every 123-246 cycles. This is approximately every 2-4 raster lines. Sufficient for speech and simple percussion (an earlier version cited GoatTracker's `ADSR bug` workaround timing here as an example; that concerns envelope restarts, not sample rate). The handler below costs roughly 25-35 cycles per sample plus the 7-cycle interrupt entry and 6-cycle RTI, so at one IRQ every 2-4 lines it leaves well over half the CPU free. (An earlier version of this bullet said "~20-30 IRQs per raster line is achievable"; a PAL line is 63 cycles and entry plus RTI alone cost 13, so at most four empty interrupts fit in one line.)
- **Higher rate (up to ~15.6 kHz):** One IRQ per raster line. PAL: 985,248 cycles/s ÷ 63 cycles/line ≈ 15,639 samples/s (312 lines × 50.125 Hz). NTSC: 1,022,727 ÷ 65 ≈ 15,734 samples/s (263 × 59.826 Hz). An earlier version put the PAL clock at "63 × 312 × 50 = 982080"; that product is 982,800, and the clock is 985,248 Hz. This is the theoretical ceiling for raster-line-based digi; practical implementations are limited by the IRQ overhead and the need for the main program to do anything else.

A minimal 4-bit digi IRQ (KickAssembler syntax; `sample_ptr` must be a zero-page pair because `(zp),y` has no absolute form, and KickAssembler assembles `(label),y` with a non-zero-page label silently and reads the wrong pointer):

```asm
// Setup: set SID master volume to mid-range, all voices gated off
// Sample data: array of bytes, each byte = two 4-bit samples packed as hi|lo nibble
// nibble_hi: flag byte, 0 = output low nibble, nonzero = output high nibble
// sample_ptr: zero-page pointer to the current sample byte
.label sample_ptr = $FB

digi_irq:
    pha
    tya
    pha
    ldy #0
    lda nibble_hi
    bne output_hi
    // Low nibble
    lda (sample_ptr),y
    and #$0F
    sta $D418
    inc nibble_hi
    jmp digi_irq_done
output_hi:
    lda (sample_ptr),y
    lsr
    lsr
    lsr
    lsr
    sta $D418
    lda #0
    sta nibble_hi
    inc sample_ptr       // advance to next byte
    bne digi_irq_done
    inc sample_ptr+1     // carry into high byte
digi_irq_done:
    pla
    tay
    pla
    // ... ACK IRQ (CIA or VIC as appropriate) ...
    rti

nibble_hi: .byte 0
```

An earlier version of this listing loaded the sample with `lda (sample_ptr)` — zero-page indirect with no index register, which is a 65C02 addressing mode the 6510 does not have (KickAssembler: "'lda' doesn't support INDIRECT mode"); the 6510's indirect loads are `(zp,X)` and `(zp),Y` only, hence the `ldy #0` and the extra Y save/restore.

The upper nibble (bits 7-4 of $D418) contains the filter mode and voice-3 mute bits; the sample writes should preserve those bits or accept that the filter mode is overwritten on every sample byte. A common approach for digi that coexists with music is to set the filter mode to a fixed value and OR it with each sample nibble.

On Oscar64, the play-routine pattern applies: an `__interrupt` function writes `sid.fmodevol = filter_shadow | next_sample_nibble;` on each IRQ tick, where `filter_shadow` is a software copy of the intended bits 7-4 — $D418 cannot be read back (a read returns the last byte written to any SID register, measured in VICE reSID on both models), so `sid.fmodevol & 0xF0`, which an earlier version of this sentence used, is not the filter mode but the high nibble of whatever the music routine last wrote.

### Why it works

The 6581 SID's output stage sums contributions from the three voice signals, the filter, and the master DAC. The master DAC is a simple resistor-ladder circuit driven by the four VOL bits. Changes to these bits produce a stepped analog output; because the output capacitor cannot instantaneously slew to a new voltage, each step produces a brief current transient that is audible as a click. Streaming clicks at audio rates produces the perception of continuous audio through the same mechanism as any PCM DAC: the ear integrates the rapid changes into a perceived waveform.

The technique works specifically because the 6581's DAC has a non-zero DC offset: the output at VOL=0 is not at the same voltage as at VOL=15, and that absolute shift drives current through the output coupling capacitor. The 8580 corrected this: its output at VOL=0 and VOL=15 are symmetric around the bias point, which reduces the click amplitude.

### Variations

**Digi mixed with SID music.** Some composers run three-voice SID music while simultaneously playing digi samples. The SID voices occupy the synthesizer path; digi drives the volume register. This requires the music play routine to not write $D418 (or to write only the filter-mode bits and leave the lower nibble to the digi routine). Rob Hubbard and Martin Galway pioneered this combination.

**Sample rate selection.** The sample rate a machine can sustain is bounded by CPU cycles per second, not per frame: NTSC runs 1,022,727 cycles/s against PAL's 985,248, so NTSC has about 4 % more cycles for the same sample rate. PAL's longer frame (19,656 cycles vs NTSC's 17,095) only means more cycles between two frame-rate events such as the music player call. (An earlier version said PAL's longer frame let it sustain a higher sample rate.) Most classic digi tunes were composed for PAL systems.

**NTSC consideration.** On NTSC (59.826 Hz frame rate), the same raster-line-based sample rate gives 1,022,727 ÷ 65 ≈ 15,734 samples/sec (263 × 59.826 Hz), slightly higher than PAL's 15,639 (an earlier version said 263 × 60 = 15,780, using a rounded frame rate). The shorter frame (17095 cycles) leaves fewer cycles for the main program.

**8580 hardware fix.** A 330-740 kΩ resistor between SID pin 26 (EXT IN) and ground restores audible digi on 8580 by feeding back signal through the filter input. The exact resistor value affects the amplitude and frequency response of the digi; values around 470 kΩ are common.

---

## digi_8bit_hard_restart — Hard-restart digi and high-resolution sample techniques

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D418, D404, D405, D406
**Demands:** continuous_interrupts
**Requires:** sid_voice_setup
**Alternative to:** digi_4bit (more than the 16 levels of the $D418 nibble, through the voice's envelope; described here, not demonstrated)

### Why

4-bit digi via $D418 gives 16 amplitude levels: enough for speech, marginal for music. Productions that reach more than 4-bit effective resolution exploit the SID's voice control logic rather than just the volume register. The hard-restart digi family of techniques drives the envelope generator into a state where the audio output is controlled by a pulse-width write rather than a volume nibble, giving access to a larger DAC range.

### How

The technique family exploits the relationship between the ADSR bug, the TEST bit, and the pulse-width register on the 8580.

**Background: the ADSR bug as a DAC.** When the ADSR bug stalls the envelope at a fixed level, the voice output is `oscillator_output * envelope_level`. If the oscillator is held in a fixed state (via TEST or by using a DC-level waveform), the envelope level itself becomes the DAC value. The ADSR envelope counter is 8 bits of effective resolution ($00-$FF), giving 256 amplitude levels, 8-bit PCM.

**Hard-restart digi (Hermit method, basic form):**

For each sample byte (8-bit, one per IRQ tick):
1. Gate off the voice. Write $D405 = 0, $D406 = 0 (fastest rates). No register write resets the 15-bit rate counter; it only clears when it reaches the current rate period, so a rate lowered below where the counter already sits must wrap the full range first (the ADSR bug, see above; an earlier version of this step said the write "triggers the ADSR rate counter reset", which is the opposite of the bug). This loop is safe because it writes rate 0 on every tick and never lowers the rate mid-count; a music-player hard restart gets the same guarantee by writing AD/SR = 0 a frame or two before the gate.
2. Set TEST bit ($D404 bit 3) to hold the oscillator at zero output.
3. The 8-bit sample value cannot be written into the envelope, which is not writable. Instead, set a specific ATTACK value such that the envelope ramps from 0 to the target value in exactly one sample period.

No working hard-restart / envelope-DAC listing is given here: the 8-bit envelope path described above and below is described, not demonstrated. An earlier version of this entry carried a "Hermit method" fence for voice 1 that did not do what its comments said — it loaded the sample byte and then overwrote A with `lda #$00` / `lda #$08`, so its `and #$0F` / `sta $D418` stored the constant $08 on every tick, it never set GATE, and it never acknowledged the interrupt; an agent copying it got silence at fixed volume 8. What follows instead is a plain 4-bit $D418 player that takes 8-bit sample bytes, so that the per-tick structure a hard-restart routine would also need (fetch, scale, write, acknowledge, restore) is shown by something that assembles. It uses the voice-1 registers only through the `filter_shadow` convention of `digi_4bit`; the entry still requires `sid_voice_setup` because the envelope technique it describes is built on the per-voice $D404-$D406 layout.

```asm
// Plain 4-bit $D418 player, one 8-bit sample byte per tick (high nibble used).
// This is NOT the hard-restart / envelope-DAC routine; see the text above.
digi_8bit_irq:
    pha
    tya
    pha
    // Load next sample byte (0-255)
    ldy sample_idx
    lda sample_data,y
    inc sample_idx
    // Keep the high nibble: a 4-bit $D418 digi wants bits 7-4, not 3-0
    lsr
    lsr
    lsr
    lsr
    ora filter_shadow   // software copy of $D418 bits 7-4 ($D418 cannot be read back)
    sta $D418
    lda $DC0D           // acknowledge CIA 1 timer IRQ (use dec $D019 for a raster source)
    pla
    tay
    pla
    rti

sample_idx:    .byte 0
filter_shadow: .byte 0
sample_data:   .fill 256, 0
```

The full 8-bit envelope technique requires precisely timed gate sequences spanning multiple IRQ slots. The envelope counter increments once per specific number of cycles depending on the ATTACK rate value 0 (one increment every ~8-9 cycles at PAL clock: PAL φ2 = 985248 Hz, attack-rate-0 spec = 2 ms to peak, 256 envelope steps → ~7.8 µs/step ≈ 8 φ2 cycles/step by the datasheet figure; measured in VICE reSID, both 6581 and 8580 models, ENV3 rises 3 levels per 27 cycles, i.e. 9 cycles per step, and reaches 255 about 2,080 cycles ≈ 2.1 ms after gate-on. An earlier revision said ~15 cycles per step, which is double the value its own arithmetic gives.) Counting exactly enough IRQ cycles to arrive at the target amplitude requires precise IRQ timing, which is why this is classified scene-tier. The Hermit technique in its simplest deployable form produces 5-6 effective bits; refined variants (Mahoney's "Musik Run/Stop") achieve perceptual quality close to 8 bits.

**Mahoney technique (8580-specific).** Mahoney's 8580 digi routine (released as "Musik Run/Stop", 2014 — title and year from published descriptions, not verified against the release or any document on this machine) drives the 8580 to high-resolution audio by combining the envelope, the volume DAC and the filter's resonance gain. The exact Mahoney and Hermit register sequences are not documented here. An earlier version of this entry named Jan Lund Thomsen and 1994 and called the release "Musik Runs in the Family", while the same page credited Mahoney two paragraphs earlier, two people for one work; the name and year have been dropped rather than resolved, since nothing on this machine settles them. That version also gave a four-step recipe built on holding voice 3 in PULSE+TEST and driving its pulse width as a DAC, followed by a paragraph contradicting it; that mechanism does not work (see the PWM digi variation below) and has been removed.

### Why it works

The SID has multiple analog signal paths that can be driven by digital writes at different resolutions. The $D418 volume register gives 4 bits directly. The pulse comparator output is binary ($000 or $FFF), and with TEST set it is forced to $FFF whatever PW holds, so the extra resolution in these techniques comes from the envelope and the volume DAC, not from PW (an earlier version of this sentence said the pulse width gave "12 bits of comparator control" with the oscillator locked via TEST; it does not). Combining the envelope and volume paths gives more effective resolution. The filter resonance adds gain at the cutoff frequency, boosting low-amplitude signals to audible levels on the 8580 where the raw DAC change is too small to hear without it.

### Variations

**PWM digi (8580 software-only) — does not work as once described here, and what was described here was not Harsfalvi's method.** The pulse-width-modulation digi of the late 1990s holds no TEST bit: it runs the pulse waveform at `$FFFF` and rewrites the pulse width at the sample rate, and it works on both chip models; it is built and measured under `pwm_digi` below (an earlier version of this paragraph, up to 2026-09-23, called the TEST-bit variant "PWM digi" and drew the conclusion that a pulse-width DAC does not work, which is true only with TEST held). With TEST set the pulse output is held at full scale regardless of PW: measured in VICE reSID on both models, OSC3 reads $FF for PW = $000, $080, $800 and $FFF alike, so PW cannot act as a DAC while TEST is held (an earlier version of this variation said modulating PWHI under TEST changed the DC level, and the How section above said the TEST-locked output was $000; both were wrong). The usable software-only 8580 form is the test-bit DC digi in [sid-reference.md](../hardware/sid-reference.md): PULSE+TEST+GATE ($49) on all three voices as constant full-scale sources through their envelopes, with $D418 as the 4-bit DAC. The exact Mahoney/Hermit sequences are not documented here.

**Test-bit digi.** Rapidly toggle the TEST bit at audio frequency. The duty cycle of the toggling produces an average DC level that the filter and volume DAC amplify. Produces lower effective resolution but requires only one bit manipulation per sample.

---

## pwm_digi — Pulse-width-modulation digi: the sample rides the duty cycle

**Complexity:** high
**Region:** both
**Uses registers:** D400, D401, D402, D403, D404, D405, D406, D418, DD04, DD05, DD06, DD07, DD0D, DD0E, DD0F
**Demands:** continuous_interrupts
**Requires:** sid_voice_setup
**Cost:** cycles_per_frame=4774
**Cost basis:** arithmetic
**Cost measured on:** kickassembler-pwm-digi (per-sample work at a 128-cycle period, PAL)
**Alternative to:** digi_4bit (no $D418 write per sample and no 6581 DAC offset, so the volume register stays with the music; it takes a voice), digi_8bit_hard_restart (the pulse width carries the sample, not the envelope, and no 8580 quirk is needed)

### Why

A third way to play a sample, beside the `$D418` volume nibble of `digi_4bit` and the envelope tricks of `digi_8bit_hard_restart`. It needs no volume-register write per sample, no 6581 DAC offset and no 8580 quirk: one voice plays the pulse waveform as fast as the SID can, and the program rewrites the pulse width from the sample. The duty cycle carries the sample and the output stage averages it. It is the method Levente Harsfalvi described in the late 1990s for playing samples on the 8580, where `$D418` digi is nearly silent (name and decade from the candidate list this entry was written against and from memory of the published description; the description itself was not read here, so what follows is the mechanism as built and measured, not a claim about his register sequence). It leaves the volume register to the music.

### How

1. Set the voice up as `sid_voice_setup` describes: frequency `$FFFF`, attack 0, decay 0, sustain 15, release 0, then control `$41` (pulse, gate on) and leave the gate on. Master volume 15.
2. Choose a sample period in cycles and run a timer at it (CIA 2 timer A in the recipe, so the KERNAL's jiffy timer on CIA 1 is untouched). 128 cycles gives 7,697 samples a second on PAL and 7,990 on NTSC.
3. On every timer tick write the sample into the pulse width: sample bits 7 to 4 into `$D402` bits 7 to 4, sample bits 3 to 0 into `$D403` bits 3 to 0. Two pre-split tables make that two loads and two stores.
4. In a program that does anything else, the tick is a timer interrupt every sample period, which is the `continuous_interrupts` demand; the recipe polls the CIA flag under `sei` instead, so it can prove its rate with timer B.

The carrier cannot be put above the audible band. `$FFFF` is the top of the frequency register and gives `65535 × 985,248 ÷ 16,777,216 = 3,848.6 Hz` on PAL (3,995 Hz on NTSC), one pulse period every 256.004 cycles. Every sample rate up to about half of that is usable; the recipe's 128-cycle period puts two pulse-width writes into each pulse period. The pulse width is 12 bits and the sample 8, so the sample sits in bits 11 to 4, and nothing is lost by that: at `$FFFF` the top twelve bits of the accumulator step by 16 each cycle, so the low four bits of the pulse width are below the phase step, and the 8-bit sample already uses every duty level the carrier can resolve in one period, 4,096 ÷ 16 = 256 of them.

### Why it works

The pulse comparator is a one-bit output: high while the top twelve bits of the phase accumulator are at or above the pulse width. With the envelope parked at sustain 15 the voice output is that bit at full scale, and its mean over one pulse period is the duty cycle times full scale. The mixer, the output amplifier and whatever follows the audio pin cannot follow a 3.85 kHz square wave exactly; what comes through at audio rates is the running mean, which is the sample. No register read, no TEST bit and no envelope timing is involved, which is why the write is two plain stores. An earlier version of the `digi_8bit_hard_restart` entry described a pulse-width DAC that held TEST set; that is not this method, and it does not work, since TEST forces the comparator output high whatever the pulse width holds (measured there).

Measured in VICE x64sc 3.10 reSID, PAL, from a WAV the emulator wrote (nobody listened): the strongest raw component is at 3,848.6 Hz, the carrier; after a moving average over one carrier period the dominant component is 240.5 Hz, which is the recipe's synthesised tone, `985,248 ÷ 128 ÷ 32 = 240.54 Hz`; its second harmonic is about 42 dB down. The carrier line sits about 7 dB below the tone line, with sidebands at ±240.5 Hz about 8 dB below it (whole decibels, since the window and segment chosen move these by up to a decibel; the recipe page states the method): the carrier is audible as a whistle, and a filter (the SID's own low-pass on the voice, or the listener's speaker) is what removes it. The figures are the same on the 6581 and 8580 models except level: the 8580 model's averaged signal is 0.74 of the 6581's (2,494 against 3,358 RMS in 16-bit units), about 2.6 dB quieter. Real chips were not measured.

### Variations

**Filtered carrier.** Route the voice through the SID filter in low-pass mode with the cutoff below the carrier, so the whistle is attenuated on chip. Not measured here; on the 6581 the filter's cutoff range and gain vary by chip (`sid_filter_chip_variation`).

**Interrupt-driven.** A CIA timer IRQ every sample period, the handler doing the two loads and two stores and acknowledging the CIA, is the form a game uses. Entry and `rti` add the usual 7 + 6 cycles plus register saves on top of the loop body, and any other interrupt source adds jitter to the write times; the recipe's polled loop under `sei` is the jitter-free floor.

**Loudness on real chips.** 6581 against 8580 loudness on hardware is not measured here; the reSID figure above is the emulator's.

### Cycle budget

Per sample the recipe's loop is a flag poll (`lda $DD0D`, `and #1`, `beq`) and then `lda abs,x` / `sta $D402` / `lda abs,x` / `sta $D403` / `inx` / `bne`, 31 cycles on the passing path by the instruction table: 8 for the poll, 21 for the rest, and one more for each `lda abs,x` because the recipe's two tables start two bytes before a page boundary, so every index from 2 upward crosses it (an earlier version of this paragraph said 32; a `.align $100` on the tables gives 29). The Cost line above is 31 times the samples in a PAL frame, `19,656 ÷ 128 = 154` (rounded up), and its basis is arithmetic; the loads and stores without the poll were timed in VICE at 21.1 cycles a sample, which is the table's 21 plus the outer counter once per 256, so the figure is not far from a measurement. What else was measured: at 128 cycles a sample the loop kept exact pace on both models (timer B agreed with the sample count to the underflow); at every period from 28 to 36 cycles that was tried it did not, with timer B running 4 to 17 per cent ahead of the sample count; and at 36 cycles with the display blanked it kept exact pace. The polled floor with the screen on is the badline, not the loop: the poll clears the flag, a badline holds the CPU for 40 to 43 cycles between two polls, and two underflows in that gap count as one sample, so any period below roughly 31 + 43 cycles loses samples at a rate that scales with the run's length in frames (an earlier version of this paragraph said the floor was not explained; the recipe page has the sweep, the blanked rows and the arithmetic). At 128 cycles a sample, 97 cycles of every 128 are free for the rest of the program, less the badline stall on one line in eight while the display is on.

### Recipes

- `recipes/kickassembler/pwm-digi.md`

---

## sidfx_layered_chip — Two-SID setups

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418

### Why

Three voices cannot carry chord harmonies, polyphonic melody, rhythm and bass at once, or sample playback beside full-voice music. Expansion cards that add a second SID chip are common in the demo scene and among SID musicians. Reading two-SID music source, or writing code that degrades cleanly on a stock single-SID machine, needs the convention for where the second chip sits.

**Scope notice:** Stock C64 does not have a second SID. This technique is hardware-mod-only. The register addresses and detection logic documented here describe the dominant convention; actual stock-C64 output ignores $D420 (it falls within the SID mirror range, see below). Recipes for this project target stock C64 only; this section is reference material.

### How

The first SID is always at $D400-$D418 (stock C64 mapping). The second SID address depends on the expansion hardware:

| Hardware | Second SID address | Notes |
|----------|--------------------|-------|
| C64 Reloaded MK2 | Configurable, common: $D420 | Default factory setting |
| SID Symphony cartridge | $DE00 | Cartridge port expansion I/O |
| Ultimate II+ | Configurable | Settings in Ultimate menu |
| SidCard v2 | $D500 | Rare; 1980s hardware |

**$D420 vs. mirroring.** The stock C64 SID is mirrored every 32 bytes through $D7FF (the SID has only five address inputs, A0-A4, and the C64's I/O address decoding selects it for the whole $D400-$D7FF range, so $D420, $D440, $D460... all address the same chip; an earlier version said "bits 5-0", which would be a 64-byte period). On boards with a hardware second SID, the chip select is modified so $D420 addresses the second chip instead of mirroring the first. Code that writes $D420 on stock hardware writes to the first SID voice 1 registers (same as writing $D400). Degradation is therefore automatic on stock hardware: two-SID music falls back to single-SID behavior with duplicate writes.

**Detecting second SID presence.** $D400-$D418 are write-only; $D419-$D41C read live state (paddles, OSC3, ENV3). A read of a write-only address does not float and is not the last VIC-II fetch (an earlier version of this paragraph said both): the SID drives the bus with the last byte written to any of its 32 addresses (or last read from $D419-$D41C), fading to $00 after roughly 7k cycles on a 6581 and roughly 660k on an 8580 (measured in VICE reSID; see [sid-reference.md](../hardware/sid-reference.md)). So writing a value to $D420 and reading $D420 back returns that value whether or not a second chip is there; with one chip $D420 is a mirror of $D400. A read-back test has to read the FIRST chip: write $AA to $D401, write $55 to $D421, then read $D401 promptly. A single SID returns $55 (the mirror write was its last write); a second chip at $D420 leaves the first chip's held byte at $AA. This works in VICE with a second SID configured; on real add-on boards the result depends on the board's address decoding and the read must land well inside the 6581's fade window, so treat it as a hint and expose a user toggle.

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

**Composing for two SIDs.** Two-SID tunes use six voices total. Conventional assignment: SID1 voices 1-3 for melody + bass, SID2 voices 1-3 for chords + extra percussion or samples. GoatTracker 2.x supports stereo SID output with configurable second-chip address. SidFactory II has native two-SID editing. HVSC has no `stereo` flag (an earlier version of this sentence said it had); a second SID is indicated by a non-zero `secondSIDAddress` byte at header offset $7A (PSID v3+), holding the middle byte of $Dxx0 (valid values $42-$7F and $E0-$FE, even only, e.g. $42 = $D420, $50 = $D500, $E0 = $DE00), with the third SID's address at $7B in v4.

### Why it works

A second SID chip, properly wired into the bus, responds to its assigned address range like any peripheral. The audio outputs of both chips connect to the same output mixer (either summed in hardware or via separate left/right audio channels for stereo). The CPU writes to each chip independently using its respective address range. The play routine doubles the number of SID writes per frame: init, update, and gate operations run for each voice on each chip.

### Variations

**Mono two-SID summed.** Both chips output to the same audio line. Six voices at full volume can make the mix muddy. Composers reduce per-voice amplitude by setting lower sustain levels.

**Stereo two-SID.** C64 Reloaded MK2 and some cartridges route the two chips to separate left/right outputs. HVSC stereo SID files are mixed for left/right separation. Playback on systems with only mono output sums both channels.

**$DE00 expansion-port SID.** The SID Symphony cartridge maps the second SID to $DE00 (Cartridge port expansion area 1). This address does not conflict with any stock C64 hardware and is detectable more reliably than $D420 since it does not overlap the mirror range. Tunes targeting SID Symphony set the second address to $DE00 in their header.

---

## sidasid_emulation_notes — How SID emulators differ from real silicon

**Complexity:** medium
**Region:** both
**Uses registers:** D415, D416, D417, D418

### Why

Oscar64 SID recipes are tested in VICE, not on real hardware. VICE ships reSID (version 3.x in recent VICE releases), the most accurate public SID emulation, but it is not bit-perfect. Where reSID diverges from silicon, a recipe can sound wrong on hardware but fine in the emulator, or the reverse.

### How

#### Filter cutoff curve

The largest deviation is the 6581 filter cutoff curve. Real 6581 chips vary between manufacturing batches; reSID approximates the curve from measurements of a handful of chips with a polynomial model. The result:

- At low cutoff values ($D416 < $20), reSID opens the 6581 filter more than most real chips. A patch with a closed low-pass filter sounds brighter in reSID than on hardware.
- At high cutoff values ($D416 > $C0), reSID is close to real hardware behavior.
- Mid-range ($D416 $20-$B0) is where the polynomial fit is most uncertain; filter sweep effects may have slightly different sweep rates.

The 8580 filter curve in reSID is close to real hardware and more reliable for testing than the 6581 model.

**Practical recommendation:** Compose and test with the emulated chip set to 8580. The 8580 model is more accurate and more consistent across physical chips. Ship with a note in the SID header indicating the target chip revision.

#### ADSR bug timing

The ADSR bug in reSID (v3.x) is implemented but with slightly different rate-counter timing than real hardware. On some rate transitions the wrap delay is a few cycles longer or shorter than measured on real 6581 chips. This matters for:

- Very fast arpeggios where the hard restart's AD=0 write races the next gate.
- Digi routines that rely on exact envelope-level timing.

The difference is rarely audible in music playback. For digi timing, always test against real hardware before claiming cycle-exact behavior.

#### 8580 digi click suppression

reSID 3.x correctly models the 8580's reduced DC offset: $D418 volume writes produce nearly silent output in the 8580 emulation, matching real hardware. Earlier versions of reSID (v0.16-era) incorrectly made 8580 digi audible. Digi recipes tested on older VICE versions may produce output that is absent on real 8580 hardware.

#### Combined waveforms

reSID uses lookup tables derived from chip measurements to model combined waveforms. The tables were measured from a small number of chips; combined waveform output on chips outside the measurement set may differ. The 6581 combined waveform model in particular is based on older measurements; the 8580 model is more reliable.

#### Cycle-exact register writes

reSID is not cycle-exact in VICE's default mode (it runs with a cycle granularity of 1 SID clock = 1 CPU clock, which is correct, but the audio output is buffered and interpolated). This is accurate enough for all music techniques. The cycle granularity difference matters only for techniques like oscillator-sync sweeps that involve writes on specific sub-cycle boundaries; real hardware may produce a slightly different transition glitch than reSID predicts.

#### $D41B/$D41C sampling

NOP takes two cycles, not one (an earlier version of this paragraph prescribed "a one-cycle NOP"). Whether VICE's $D41B/$D41C reads are offset from silicon by a cycle has not been measured here; what is measured (VICE 3.10, reSID) is that reads are clocked per CPU cycle (with F=$FFFF each extra NOP between a TEST-clear and an OSC3 read advances the value by exactly 2), so inserting a NOP only reads a later value, it does not remove any offset. The caveat for headless testing: with `-sound -sounddev dummy`, warp on or off, $D41B and $D41C do not advance between CPU reads (OSC3 read a constant $55 across 80,000 cycles of a running sawtooth; ENV3 stayed $00 through an attack), and with `+sound` they return changing but meaningless values (ENV3 non-monotonic during an attack, different on every run). A test that reads OSC3/ENV3 must run with a real sound sink: `-sound -sounddev wav -soundarg out.wav` or `-sound -sounddev dump -soundarg out.txt` (no audio device needed); both showed OSC3 advancing and ENV3 reaching $FF normally.

### Why it works

reSID is an analog-circuit simulation using a mix of analytical models (for the digital sections) and empirical lookup tables (for the non-linear analog sections). The digital parts (oscillators, LFSR, gate logic, rate counters) are modeled exactly. The non-linear parts (the 6581 filter and the 6581/8580 waveform combiners) use polynomial fits or lookup tables from physical measurements. Accuracy is highest where the chip behavior is linear and consistent across revisions; it degrades where behavior is non-linear, chip-dependent, or temperature-sensitive.

### Variations

**Testing against multiple VICE SID backends.** Current VICE builds expose a single SID engine: `-sidengine 1` (reSID). FastSID is a compile-time option that has been off by default since VICE 3.5 (`--with-fastsid`, marked deprecated), so a stock install rejects `-sidengine 0`; the separate reSID-fp engine that VICE 2.1 added is no longer offered as a selectable engine (an earlier version of this paragraph listed `fastsid`, `reSID` and `reSID-fp` as three runtime choices; `x64sc -help` on VICE 3.10 offers only ReSID). Choose the chip with `-sidmodel 0` (6581), `1` (8580) or `2` (8580 + digiboost), and trade speed for accuracy inside reSID with `-residsamp 0` (fast) … `3` (fast resampling) rather than by switching engines. For verifying SID techniques, use reSID. For final hardware validation, test on a real C64 with both 6581 and 8580 if possible, or use the 1541 Ultimate II+ with its SID emulation mode as an intermediate step.

**HVSC SID compatibility metadata.** The High Voltage SID Collection tags each tune with the target SID model (6581/8580/both) in the `.SID` file header's 16-bit big-endian `flags` word at $76-$77: bits 4-5 of byte $77 give the first SID's model (00 unknown, 01 6581, 10 8580, 11 both). Bits 0-1 are the MUS-data and PlaySID/BASIC flags and bits 2-3 the video standard, so mask `byte[$77] >> 4 & 3`, not `& 3` (an earlier version of this sentence put the first SID's model in bits 0-1 and the second's in bits 2-3, which would classify MUS files as 6581). In PSID v3+ bits 6-7 give the second SID's model (00 = same as the first), and in v4 bits 8-9 (low bits of byte $76) give the third's. See [c64-file-formats.md](../formats/c64-file-formats.md). STIL.txt adds human-readable notes. When ingesting SID files into a game, check this field to select the appropriate per-chip frequency and filter tables.

**GoatTracker's chip selection.** GoatTracker 2 (readme v2.72) has one SID model setting for the whole editor, and it chooses what the emulation plays: the `-E` option (`0` = 6581, `1` = 8580, default 6581) or SHIFT+F8 to switch. An instrument's nine parameters include no chip choice, so a tune written on one model sounds different on the other, filters most of all (the readme advises testing filtered tunes on a real C64 or a HardSID card). Since v2.07 the packer writes the PAL/NTSC and 6581/8580 flags of the PSID v2NG header (version history). Load the `.sid` into VICE with `-sidmodel` set to match. (An earlier version of this paragraph said GoatTracker 2.x has a per-instrument SID model toggle and exports different filter tables per chip; the readme describes neither. Source: GoatTracker 2 `readme.txt` v2.72, https://sourceforge.net/projects/goattracker2/, mirrored at https://github.com/leafo/goattracker2/blob/master/readme.txt.)

---

## sfx_engine_beside_music — Sound-effect engine beside a music player

**Complexity:** medium
**Region:** both
**Uses registers:** D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D418
**Requires:** sid_play_routine_pattern, sid_voice_setup
**Cost:** cycles_per_frame=258, cycles_per_frame_typical=50, irq_slots=1
**Cost basis:** measured-vice
**Cost measured on:** oscar64-sfx-engine (a frame the engine owns the voice)
**Claims:** sid_voice_2 (shares)
**Claims basis:** derived-listing

Nobody on this machine has listened to anything in this entry. Every claim
below is register-level: what bytes reach which SID register in which
order, measured in VICE x64sc 3.10 with a trace checkpoint and a checksum.
Whether an effect built this way sounds right is not established here.

### Why

A game needs gun shots and explosions while the tune keeps playing, and a
tune's play routine writes all three voices every frame
(`sid_play_routine_pattern`). Writing an effect's registers once, as
`simple-shmup.md` does, works only until the player's next frame overwrites
them. An engine that owns one voice for the life of the effect, runs after
the player each frame, and stops when the effect ends, gives effects that
survive the player and a tune that comes back on its own.

### How

**The table.** An effect is a header and a list of rows, one row per frame.
The header holds a priority byte and the ADSR pair, written when the effect
starts. Each row holds the 16-bit frequency, the 16-bit pulse width and the
control byte for that frame. The list ends with a terminator row; the recipe
uses control `$FF`, a value no row wants because it combines every waveform
with TEST and GATE. The engine keeps a pointer to the current row, writes it,
advances, and on reaching the terminator releases the voice.

**Priority.** Each effect carries a small priority number. A request to
start an effect is refused if an effect is running and the new one's
priority is lower; equal or higher priority cuts the running effect and
starts the new one from its first row. Equal priority restarting is what a
repeated shot wants. One byte per effect and two comparisons is the whole
scheme; count refusals in a debug counter so a level whose effects never
sound has a number to show.

**Taking the voice and handing it back.** Two cases, decided by the
player:

- A player that writes all three voices every frame (most tracker exports,
  and the stub tune in the recipe): call the player first and the engine
  second, every frame, in that order. While the engine owns the voice it
  re-pokes all seven of the voice's registers after the player has written
  its own, including AD and SR, which the effect meant to write "once at
  start" but the player has just overwritten. The SID keeps the last write,
  so the engine's values stand. Handing back is the engine not writing: the
  frame after the terminator, the player's own writes are the last ones and
  the tune's voice is back. No restore, no shadow copy.
- A player with a voice mask (a byte telling it which voices to leave
  alone): set the mask bit when an effect starts, clear it when the
  terminator is reached, and the engine can write ADSR once and rows of
  frequency, pulse width and control only. Whether a given player has such a
  mask is a property of that player's source, not of the SID; the recipe
  does not assume one.

**Gating and restart.** The engine inherits whatever envelope state the
tune left in the voice. The sid-reference hard-restart entry's classic
sequence ends with a TEST+GATE (`$09`) frame and then the real waveform
with GATE one frame later; the recipe uses those two frames, without the
AD=0/SR=$F0 frame before them. (That page's "test-bit restart" variant is
TEST alone, cleared on the gate frame, and is not what the recipe does.)
The recipe makes the `$09` frame the first row of every effect, so the oscillator
restarts from zero and the attack starts from a known state, and its last
gated row drops GATE so the tune's first gate-on after the hand-back begins
a fresh attack instead of joining a sustain. Nothing more than the SID page
already documents is claimed: the ADSR bug and the two-frame classic hard
restart are covered there, and an effect that needs them uses the same rows.

The per-frame order in the interrupt or the frame loop:

```asm
frame_tick:
    jsr tune_play       // the player writes all three voices
    jsr sfx_update      // the engine re-pokes the borrowed voice: last write wins
    rts
tune_play:  rts         // stand-ins so the fragment assembles alone
sfx_update: rts
```

### Why it works

The SID has no register latch or double buffer: each write takes effect
when it lands, and the register holds the last byte written until the next
write. Two writers to one voice in one frame therefore resolve by order,
not by conflict, and a fixed call order is a complete arbitration. AD and
SR are rate settings for the envelope generator, so rewriting the same
value mid-envelope should change nothing; that is what makes the re-poke
safe. This is stated from the register's function (rung 4, not measured
here as audio); what is measured is that the bytes land in order. The
trace in `recipes/oscar64/sfx-engine.md` shows the tune's four bytes for
`$D408-$D40B` landing on raster lines 261 to 262 and the engine's four on
267 to 268 in the same frame, and in the frame after the terminator only the
tune's four.

### Variations

**Two effect voices.** Run two engine slots, one per borrowed voice, with
the priority rule per slot and a rule for which slot a new effect takes
(the free one, else the lower-priority one). The tune loses two voices while
both are busy.

**Effects on the tune's quietest voice.** Pick the borrowed voice per tune
rather than fixing it: the voice a tune uses for a hi-hat or an echo costs
less to lose than its bass. This is a composer's choice, not a code change.

**Row compression.** A row per frame is simple and costs five bytes; a
falling sweep can be one row plus a per-frame delta applied by the engine,
at the cost of a second table format. Do this only when the tables are
measured to be the problem.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timer A around each call, interrupts
off, in `recipes/oscar64/sfx-engine.md` (rung 1): the engine costs 263
cycles on a frame it owns the voice (seven stores, four byte copies for the
checksum, and the row advance) and 55 cycles when idle, both including the
harness's 5 cycles of start/stop overhead. The stub tune's play routine
costs 332, or 327 net of that overhead, which was the figure on
`sid_play_routine_pattern`'s Cost line until it took the 1,198 of a full
player. The engine's own Cost line carries 258 (263 less the 5) as its worst frame and 50 (55 less the 5,
idle) as its typical figure. Against a PAL frame of 19,656 cycles the engine is about 1.3 %
active and 0.25 % idle (arithmetic). A real player's play routine is
typically several times the stub; its figure is the player's, not this
technique's.

### Recipes

- `recipes/oscar64/sfx-engine.md`

---

## sfx_in_player — Sound effects inside the music player: voice stealing, priority and hand-back

**Complexity:** medium
**Region:** both
**Uses registers:** D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418
**Requires:** sid_play_routine_pattern, sid_voice_setup
**Cost:** cycles_per_frame=493
**Cost basis:** arithmetic
**Cost measured on:** kickassembler-sfx-in-player (increment over the player, worst effect frame)

Every claim below is register-level: what the player put in its shadow of
the SID, and so in the SID, measured in VICE x64sc 3.10 by the recipe's
own checks. Nobody on this machine has listened to it.

### Why

`sfx_engine_beside_music` is a second routine, called after the player,
that re-pokes a voice the player has just written. Most games instead give
the music player itself an effect slot per voice. The player then knows a
voice is taken, skips its own writes there, and puts the music back when
the effect ends. There is one call per frame and one writer per register.
GoatTracker 2's packed player with sound-effect support works this way
(`goattracker_player_api`, below), and so does the sound code in
Cadaver's c64gameframework (source read, not run here).

### How

**One slot per voice.** Each voice has an effect number (0 for none) and
a position in that effect's data. Every frame the player advances the
music on all three voices, owned or not. Then, per voice, either the music
or the effect's next row writes the voice. Advancing the music under an
effect keeps the tune in time, and at hand-back the music's frequency and
gate are already right for that frame.

**The request: one start per frame, higher number wins.** The game calls
an entry point with an effect number. The entry point stores it in a
pending byte only if it is at least the number already pending. The player
takes the pending effect at the top of its next call and clears the byte.
Two requests in one frame start one effect, the higher. c64gameframework's
`QueueSfx` uses the same rule.

**Priority on the voice.** A pending effect takes its voice if its number
is the same as or higher than the effect already there; a lower one is
refused. Equal numbers restart, which a repeated shot wants. The number is
the priority, so number the effect table in order of importance. Which
voice an effect gets is a design choice: a fixed voice per effect (the
recipe), a voice the caller names (GoatTracker 2), or a round-robin search
from the channel after the last one used, taking the first voice whose
running effect is the same or lower (c64gameframework, source read, not
run).

**Hand-back.** On the frame an effect's data ends, the player must
re-apply the music voice's instrument: AD, SR, pulse width, waveform and
gate. Many players, the recipe's among them, write AD, SR and pulse width
only on a note's first frame. Without a restore, the voice keeps the effect's envelope and pulse
width until the music's next note: a held pad comes back with the effect's
decay, or silent if the effect's sustain level was 0. In the recipe, a
harness build without the restore failed all three hand-back checks that
fell mid-note (rung 1). The gate needs care too. If the effect's last row
leaves GATE set and the music wants GATE set, there is no 0-to-1 edge, so
no new attack: the music continues from whatever level the effect's
envelope reached. End every effect with a GATE-clear row, as the recipe
does, and the music's next gated frame starts a fresh attack. The same
rule applies at the start: an effect that takes a voice mid-note with
GATE set gets no attack and runs from the music envelope's level. Give
the effect a GATE-clear first frame, or a test-bit hard restart.

**Ghost registers.** The player writes a shadow of `$D400`-`$D418` in RAM
and one loop copies all 25 bytes to the SID at the end of the call, `$18`
down to `$00`. This gives four things:

- One writer. Music and effect both write the shadow; only the copy writes
  the SID.
- A readable copy. The SID's registers are write-only
  (`sid_write_only_registers` in `pitfalls/sid.md`), so the shadow is the
  only place to read what the SID holds. The recipe's checks read it.
- Fixed write order and spacing. A voice's seven writes land within 98
  cycles (7 × 14, arithmetic), in the same order, whatever path the player
  took. In an unbuffered player the gap between the AD and SR writes and
  the GATE write depends on the code path, and the ADSR bug depends on
  where the envelope's rate counter stands when a new rate is written
  (`sid_adsr_bug_8580` in `pitfalls/sid.md`). The GoatTracker 2 readme's
  remedies for ADSR bugs in unbuffered players include making the
  note-init code take more cycles, buffered writes, and hard-restart
  attack parameter F for a different write order. A fixed order and
  spacing makes the timing the same every time rather than removing the
  bug. That is the mechanism as stated; no audio was measured here (rung 4).
- A price. The copy costs 351 cycles every frame (instruction table,
  shadow within one page), which is why the readme says buffered writes
  take "more memory & rastertime".

Two cautions from the GoatTracker 2 readme, not measured here. With its
alternative hard restart (attack parameter F) the copy must write each
voice's waveform, frequency and pulse width, then ADSR last, not in the
plain descending order. And music and effects share the shadow: after an
effect ends, a music note that sets no pulse width of its own plays with
the effect's. A hand-back that rewrites the pulse width, as the recipe's
does, avoids it.

### Why it works

A SID register holds the last byte written; there is no latch. With one
writer per register per frame, music and effect never race for a voice.
The hand-back is right because the music path rewrites the instrument on
the hand-back frame and the copy delivers it in that frame.

### Variations

**Copy first, compute second.** At the top of the interrupt, copy the
shadow the last call left, then run the player for the next frame. The SID
writes then land a fixed number of cycles after the interrupt, whatever
the player does, at the cost of one frame's delay (20 ms on PAL;
arithmetic).

**Effects only while the music is off.** A second entry point that drops
the request while a tune plays, for footsteps and menu clicks
(c64gameframework's `QueueSfxNoMusic`).

**Beside or inside.** `sfx_engine_beside_music` works with a player binary
you cannot change and needs no restore code, because the player rewrites
the voice every frame. Its cost is a second set of writes to the voice.
This technique needs the player's source, or a player built with effect
support, and a hand-back written into it.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timer A around each play call in the
recipe (rung 1), identical on PAL and NTSC because the call runs below the
display with no sprites: 774 cycles on a frame with no effect and no note
start, 1,058 on the worst music-only frame (a note starts on all three
voices), and 1,200 on the worst effect frame (a note starts on all three
voices, one voice is handed back and another voice starts an effect).
The Cost line is the technique's own work: the 142-cycle increment of
the worst effect frame over the worst music-only frame plus the 351-cycle
shadow copy, 493 (arithmetic from measured figures and the instruction
table). A real player's cost replaces the recipe's music part (1,058
minus 351 on its worst frame); the effect work adds about 142. 351 cycles of each figure are the shadow copy. The
worst effect frame is 142 cycles over the worst music-only frame. The
entry point costs 25 to 34 cycles per request including the `JSR`, by the
instruction table, 6 of them the recipe's `dropped` counter where it
runs. 1,200 cycles is 6.1 % of a PAL frame of 19,656 and
7.0 % of an NTSC frame of 17,095 (arithmetic).

### Recipes

- `recipes/kickassembler/sfx-in-player.md`
- `recipes/kickassembler/music-player.md` (six effects on voice 3 beside a full tune; hand-back measured with ENV3)

### Sources

- https://github.com/leafo/goattracker2/blob/master/readme.txt
  (GoatTracker 2 v2.72 readme, section 5.1, and warning 6 in section 1.1
  on ADSR bugs; upstream https://sourceforge.net/projects/goattracker2/).
- https://github.com/cadaver/c64gameframework (MIT): `sound.s`
  (`QueueSfx`, `QueueSfxNoMusic`, per-channel `chnSfxNum`) and `raster.s`
  (the round-robin channel search). Read for facts; no code is taken from it.

---

## goattracker_player_api — GoatTracker 2 packed player: calls, zero page, sound effects and ghost registers

**Complexity:** low
**Region:** both
**Requires:** sid_play_routine_pattern

Everything in this entry is from the GoatTracker 2 v2.72 readme (rung 4
here). Neither GoatTracker nor its relocator is installed on this machine,
so no packed player was built, run or timed here. The readme gives the
jump table and the options; it does not give the packed player's internal
layout, and this entry does not either.

### Why

A game that ships GoatTracker 2 music and wants sound effects from the same
player needs the calling convention, the memory it takes, and the effect
data format. It is the ready-made form of `sfx_in_player`.

### How

The packer/relocator is F9 in the editor. It asks for the playroutine
options, a start address, a zero-page address (two consecutive locations)
and a file format: PRG, BIN or SID. It strips unused patterns, instruments,
table entries and player code. A pattern over 64 rows may fail to relocate,
and no packed pattern may exceed 256 bytes.

| Call | Registers | Address |
|---|---|---|
| Init a subtune | `A` = subtune, from 0 | `start` |
| Play one frame | none | `start+3` |
| Start an effect (sound-effect support on) | `A` = effect address low, `Y` = high, `X` = channel: 0, 7 or 14 for channels 1 to 3 | `start+6` |
| Set master volume (volume support on) | `A` = 0 to 15 | `start+6`, or `start+9` with sound-effect support |

The volume call shares its location with the tune's `DXY` master-volume
command, so the two clash. With "store author-info" on, the author string
sits at `start+$20` to `start+$3F`, and a timing mark (a `DXY` with a
parameter of `$10` or more) is copied into `start+$3F` when played.

**Priority.** Fixed by effect address: an effect higher in memory is never
interrupted by one lower in memory. Lay the effect data out in order of
importance. The caller picks the channel.

**Options that change the memory and the timing.** Buffered SID writes
collect a channel's registers and write them in one go at the end of that
channel's frame: "more memory & rastertime", more stable sound. Sound-effect
support implies buffered writes. "Use zeropage ghostregs" writes a
zero-page copy of the SID instead of the SID, and the game copies it after
every play call with a reverse loop from `X = $18` to 0 into `$D400,X`; this
also lets the player and its data sit under the I/O area. With the
alternative hard restart (attack parameter F) that copy must write each
channel's waveform, frequency and pulse width, then ADSR last. The 1- and
2-channel relocator optimisation cannot be combined with sound effects or
ghost registers.

**Effect data.**

| Offset | Content |
|---|---|
| +0 | Attack/Decay |
| +1 | Sustain/Release |
| +2 | Pulse width with its nybbles swapped (`$800` in the editor is stored `$08`); written to both `$D402` and `$D403` |
| +3 | Wavetable: `$00` ends the effect, `$01`-`$81` are waveforms, `$82`-`$DF` are absolute notes D-0 to B-7. A waveform may be left out when unchanged; a note may not |

INS2SND2 converts a GoatTracker instrument to this format. It refuses an
effect over 128 bytes, relative notes, the notes C-0 and C#0, and waveforms
above `$81`, and it drops the instrument's pulse modulation and filter.

### Cycle budget

Not measured here. The readme points to its example programs and says "No
promises!". Measure a packed player with the recipe's method (CIA timer
around `JSR start+3`, below the badlines) before planning a frame around
it.

### Recipes

- No recipe yet. `recipes/kickassembler/sfx-in-player.md` is an original
  player of the same shape, not GoatTracker's.

### Sources

- https://github.com/leafo/goattracker2/blob/master/readme.txt
  (GoatTracker 2 v2.72 readme, sections 5, 5.1 and 6.3, and the v2.34
  change note; upstream https://sourceforge.net/projects/goattracker2/).

---

*Cross-references: [docs/hardware/sid-reference.md](../hardware/sid-reference.md) for the full register map, ADSR table, programming patterns, and pitfalls. [docs/recipes/oscar64/sid-music-player.md](../recipes/oscar64/sid-music-player.md) for a working Oscar64 implementation of sid_voice_setup + sid_play_routine_pattern.*
