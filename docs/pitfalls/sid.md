---
category: sid
---

<!-- doc-type: pitfall-reference -->

# SID Pitfalls

The MOS 6581/8580 SID chip has a register interface that looks
straightforward on paper but hides several hardware-level traps that
catch even experienced composers and coders. These pitfalls fall into
two clusters: the write-only nature of the entire register bank
(which forces a shadow-RAM discipline on all SID code), and the
substantial behavioral differences between the two SID revisions
(which means a song or digi routine calibrated on a 6581 can fail
audibly on an 8580, or vice versa). The ADSR-reset bug and the voice-3
silent-bit divergence are both in the second cluster, and both have
safe workarounds that are easy to apply once you understand the
underlying mechanism.

All four pitfalls in this document apply equally to PAL and NTSC
systems; none of them are timing-region-specific. The filter cutoff
curve pitfall is the most musically impactful and deserves particular
attention when writing cross-compatible SID music.

---

## sid_write_only_registers — All SID registers $D400-$D418 are write-only; reads return garbage

**Severity:** medium
**Region:** both
**Triggered by registers:** D400, D404, D40B, D412, D418

### Symptom

Code that reads a SID control register expecting to see what was
previously written instead gets corrupted data — typically the high
byte of the read address, the last byte the VIC-II fetched, or
floating-bus noise. A read-modify-write pattern like "set bit 3 of
$D418 without touching the other bits" silently destroys the filter
mode and volume settings if no shadow register is maintained.
The failure mode is usually silent (the wrong register value takes
effect immediately, but there is no error signal) or manifests as
audio glitches: a filter sweep that jumps to the wrong cutoff, a
volume register that changes the master volume mid-note, or a voice
control register that clears the GATE bit unintentionally.

### Mechanism

The SID chip ($D400-$D41F) exposes 29 write-only registers at
$D400-$D418, followed by four read-only registers at $D419-$D41C.
The chip's internal design has no read latches on the write-side
registers. When the C64's CPU issues a read cycle to $D400-$D418,
the SID tri-states its data bus drivers; the CPU reads whatever
is floating on the bus at that moment. In most cases this is the
high byte of the address being read (the C64's data bus retains the
last value driven by the address multiplexer), but this depends on
bus capacitance, recent VIC-II activity, and other factors. The value
is unpredictable and must never be used as register state.

The four read-only registers ($D419-$D41C) are a completely different
story: POTX ($D419) and POTY ($D41A) return real paddle A/D values;
RANDOM ($D41B) returns the upper 8 bits of voice 3's oscillator
accumulator; ENV3 ($D41C) returns voice 3's current envelope level.
These are the only SID addresses where reads are meaningful.

### Fix

Maintain a complete shadow copy of the SID write registers in RAM.
The shadow is the single source of truth for register state. To
modify any SID register:

1. Read the shadow RAM location.
2. Apply the bit-level change to the shadow.
3. Write the modified shadow value to both the shadow location and the
   real SID register.

Never read back from the SID hardware to determine the current state.
The shadow RAM write and the hardware write must stay in lock-step;
mixing in any hardware reads is the source of the bug.

Recommended layout: a contiguous block of 25 bytes starting at a
zero-page or low-RAM address (e.g. `shadow_sid = $C5` through `$DD`
for compatibility with many SID player conventions), mapped 1:1 to
the SID register layout.

### Worked example

```asm
; WRONG: read-modify-write directly on hardware register
; This reads garbage from $D418 and sets an incorrect value.
        lda $D418           ; BUG: returns open-bus, not previous write
        ora #$0F            ; intended: set volume to 15, keep filter bits
        sta $D418           ; writes garbage|0x0F — wrong filter mode likely set

; CORRECT: shadow-RAM pattern
; Declare shadow at top of file:
;   shadow_d418:  .byte 0     ; somewhere in RAM, e.g. $C5
;
        lda shadow_d418     ; read from RAM shadow — always coherent
        ora #$0F            ; set volume bits to 15, preserve filter/3OFF bits
        sta shadow_d418     ; update shadow
        sta $D418           ; write to hardware

; Bit-clear variant (e.g. clear the LP filter mode bit 4):
        lda shadow_d418
        and #%11101111      ; clear LP bit
        sta shadow_d418
        sta $D418

; Full three-voice control register update using shadows:
;   shadow_d404:  .byte 0
;   shadow_d40b:  .byte 0
;   shadow_d412:  .byte 0
;
; To gate all three voices off:
        lda shadow_d404
        and #$FE            ; clear bit 0 (GATE)
        sta shadow_d404
        sta $D404

        lda shadow_d40b
        and #$FE
        sta shadow_d40b
        sta $D40B

        lda shadow_d412
        and #$FE
        sta shadow_d412
        sta $D412
```

### Cross-references

- Registers: D400, D404, D40B, D412, D418
- Technique: `sid_voice_setup` — covers the full register layout per voice
- Read-only registers for legitimate reads: $D419 (POTX), $D41A (POTY),
  $D41B (RANDOM/OSC3), $D41C (ENV3)

---

## sid_filter_chip_variation — 6581 vs 8580 filter cutoff and resonance differ wildly; same patch sounds different on each chip

**Severity:** high
**Region:** both
**Triggered by registers:** D415, D416, D417, D418
**Triggered by techniques:** sid_filter_routing

### Symptom

A SID music patch that sounds bright and resonant on a 6581 system
comes out dull and flat on an 8580. A filter sweep that sounds
evenly-stepped across the frequency range on an 8580 sounds
compressed at the low end and widely-spaced at the high end on a
6581. Two 6581 boards of the same chip revision may produce
noticeably different filter sounds from the same register values.
The problem is invisible in code review — the register writes are
correct — but audible immediately on mismatched hardware.

### Mechanism

The 6581 and 8580 implement the same filter architecture (11-bit
cutoff, 4-bit resonance, shared LP/BP/HP modes) but use fundamentally
different analog circuit designs for the cutoff cell.

**6581 filter — non-linear and chip-variable.** The 6581 filter is a
switched-capacitor design. The relationship between the 11-bit cutoff
register value and the resulting cutoff frequency in Hz is
non-linear — roughly sigmoidal on a logarithmic frequency scale.
The low end of the register range (roughly $D416 = $00-$30) produces
almost no frequency change; the mid-range ($40-$A0) sweeps across
most of the audible spectrum; the upper range ($A0-$FF) compresses
back. Additionally, the curve varies substantially between individual
6581 chips from different manufacturing batches. The same $D416 value
of $60 may produce a cutoff of 800 Hz on one 6581 and 1200 Hz on
another from a different batch. This inter-chip variation is inherent
to the analog design and cannot be corrected in software without
chip-specific calibration.

**8580 filter — linear and consistent.** The 8580 redesigned the
filter cell for a near-linear cutoff response. A $D416 value of $40
is roughly half the nominal maximum cutoff; a sweep of $D416 from
$00 to $FF produces a perceptually even frequency sweep. The curve
is consistent between 8580 chips.

**Resonance.** The 4-bit resonance (RESON, $D417 bits 7-4) controls
Q differently between chip revisions. At RES=12-15, the 6581 often
distorts audibly — a characteristic "gritty" resonance that scene SID
musicians frequently exploit. The 8580 at RES=15 can self-oscillate
cleanly around the cutoff frequency, producing a sine-like tone that
is useful as a "fourth voice." A patch tuned at RES=15 for a specific
6581 timbre typically sounds clean and different on 8580.

### Fix

There is no single software fix that makes the same patch sound
identical on both chips. The standard approaches are:

**Per-chip cutoff tables.** Ship two cutoff frequency tables, one
calibrated for 6581 and one for 8580. At startup, detect the chip
revision (see the chip-detect probe below) and select the appropriate
table. GoatTracker implements this with its "chip-select" toggle that
exports per-chip filter tuning. SidFactory II has similar per-chip
compensation.

**Target one chip explicitly.** For scene-quality demos or game
music, choose a target chip and tune all filter patches against that
chip. Document the target in the SID file header (byte $77 in the
.SID format, bits 0-1 for first SID chip model: 1=6581, 2=8580,
3=either). Accept that the other chip will sound different.

**Use filter-independent timbres.** Unfiltered voices (FILT bits
clear in $D417) pass straight to the volume DAC and are not subject
to cutoff curve differences. For cross-compatible patches, minimize
filter use or use the filter only for broad tonal shaping rather than
a precise tuned-resonance effect.

**Chip-detect probe.** The simplest runtime detection method writes
a known value to a voice's frequency register, then routes it through
the filter at a known cutoff and reads the envelope output of voice 3
($D41C, ENV3). Because the 6581 and 8580 filter curves differ, the
same $D416 value produces different attenuation and thus a different
ENV3 reading. This is imprecise but sufficient to select between two
pre-built tuning tables:

```asm
; Chip detection probe (voice 3 must be set up as a filtered test tone)
; Returns zero flag clear if 6581, clear if 8580 — use result to branch
detect_chip:
        ; Voice 3: triangle waveform, A4 frequency (PAL), fast attack, sustain max
        lda #$86
        sta $D40E       ; FRELO3: A4 PAL low byte ($1D86 >> 0 & $FF = $86)
        lda #$1D
        sta $D40F       ; FREHI3
        lda #$11        ; TRI + GATE
        sta $D412
        lda #$00        ; fastest attack/decay
        sta $D413
        lda #$F0        ; sustain max, release 0
        sta $D414

        ; Route voice 3 through filter, low-pass, high cutoff, no resonance
        lda #$04        ; FILT3=1
        sta $D417
        lda #$1F        ; LP mode, volume 15
        sta $D418
        lda #$40        ; mid-range cutoff — the key probe value
        sta $D416
        lda #$00
        sta $D415

        ; Wait ~1 ms for filter to settle (about 1000 cycles at PAL)
        ldx #200
wait:   dex
        bne wait

        ; Read ENV3 — on 6581 the filter is more attenuating at $40,
        ; so ENV3 reads lower; on 8580 at $40 the filter is mostly open
        lda $D41C       ; ENV3: 0-255
        cmp #$80        ; threshold: below $80 = likely 6581
        rts             ; carry set = 6581-like, carry clear = 8580-like
```

### Worked example

```asm
; SID music player with per-chip filter table selection
; shadow_d416 and shadow_d417 are maintained throughout playback

chip_is_8580:   .byte 0     ; 0 = 6581, 1 = 8580

; Filter cutoff tables (simplified; real tables have 64 or more entries)
cutoff_tbl_6581:
        ; These values are pre-mapped to produce evenly-spaced Hz steps
        ; on an average 6581 (they cluster in the $30-$A0 range)
        .byte $10, $1A, $26, $34, $44, $58, $6C, $82, $96, $AA, $BC, $CC

cutoff_tbl_8580:
        ; 8580 is linear, so these are evenly spaced $00-$FF
        .byte $15, $2A, $40, $55, $6A, $80, $95, $AA, $BF, $D5, $EA, $FF

; In the play routine, set cutoff using the appropriate table:
set_cutoff:
        ; A = note/step index into the cutoff table
        tay
        lda chip_is_8580
        bne use_8580
        lda cutoff_tbl_6581,y
        jmp write_cutoff
use_8580:
        lda cutoff_tbl_8580,y
write_cutoff:
        sta shadow_d416
        sta $D416
        rts
```

### Cross-references

- Registers: D415, D416, D417, D418
- Technique: `sid_filter_routing` — full filter setup and mode documentation
- Technique: `sid_8580_vs_6581_differences` — chip revision differences overview

---

## sid_adsr_bug_8580 — 8580 ADSR-reset bug on hard restart; rate-0 attack timing differs from 6581

**Severity:** high
**Region:** both
**Triggered by registers:** D404, D40B, D412
**Triggered by techniques:** digi_8bit_hard_restart

### Symptom

A hard-restart digi sequence that sounds correct on a 6581 produces
different envelope shapes on an 8580: a note that attacks cleanly
on 6581 lingers slightly before starting its attack on 8580, or a
digi sample that has the right amplitude profile on 6581 sounds
louder, quieter, or with a shifted peak on 8580. A music player
that sounds clean on one chip revision has envelope timing drift
on the other. The effect is most audible on fast-changing note
sequences (arpeggios) and on digi sample playback that relies on
precise envelope-level timing.

### Mechanism

Both the 6581 and 8580 share an ADSR bug rooted in the design of
the 15-bit envelope rate counter. The bug triggers when the CPU
writes a new (smaller) rate value to $D405 or $D406 at a time when
the envelope's internal 15-bit rate counter has already counted past
the new target threshold for the current phase. In that case the
counter must wrap through its full 15-bit range (0-32767 steps)
before the envelope generator reads the new rate and produces the
next envelope increment. At PAL clock (985248 Hz), a full 15-bit
wrap takes up to 32768 cycles — approximately 33 milliseconds.

**6581 behavior.** On the 6581 the rate-counter wrap time at rate-0
is typically close to the 2 ms attack time listed in the datasheet.
The ADSR bug still occurs (any rate reduction that the counter has
already passed forces a wrap) but the wrap time at the most common
fast-attack (rate 0) is short enough that hard-restart sequences
timed for a 1- to 2-frame window usually work reliably.

**8580 behavior and the reset bug.** The 8580 introduced an internal
difference in the envelope reset path. On hard restart — where the
code writes AD=0 and SR=0 then clears GATE — the 8580's envelope
can enter an intermediate "hold at level" state caused by the reset
bug before it begins the release phase. Additionally, the 8580
rate-0 attack increment timing is slightly different: at PAL clock
the internal increment fires every ~15 φ2 cycles per envelope step
on both chips per the datasheet (985248 Hz / 256 steps / 0.001 s
per step at rate-0 nominal 2 ms ≈ 15 cycles/step), but silicon
measurements show the 8580 sometimes takes 1-2 more cycles per step
than the 6581 at attack rate 0. For digi techniques that rely on
the envelope reaching a specific level in an exact number of IRQ
cycles, this delta causes perceived amplitude drift.

**Hard-restart digi (digi_8bit_hard_restart) cross-chip impact.**
The Hermit-style hard-restart digi technique depends on the voice's
envelope reaching a known level within a precisely-timed window.
If the rate-0 attack takes marginally more cycles on the 8580, the
envelope level sampled at the end of each digi IRQ interval is
systematically off by 1-3 counts. Over a sample buffer this
manifests as reduced amplitude or a compressed dynamic range on
8580. Scene-quality digi routines that were tuned on 6581 exhibit
this drift on stock 8580s.

### Fix

**Always use the full hard-restart sequence.** Both chip revisions
benefit from the two-frame hard restart: one frame with AD=0/SR=0
and GATE cleared, one frame with the TEST bit set to lock the
oscillator, then the real note gate on the third frame. This forces
the rate counter to the lowest possible starting position before the
new note begins, minimizing the window in which the wrap can
interfere.

**Avoid rate-0 for cross-chip digi.** For digi routines targeting
both chips, tune the attack rate to 1 (8 ms on 6581) rather than 0
(2 ms). Rate-1 timing is more consistent between chip revisions than
rate-0, at the cost of requiring a larger IRQ interval per sample.

**Chip-detect then branch.** Detect the SID revision at startup
(see `sid_filter_chip_variation` above for the ENV3 probe), then
select per-chip digi timing constants:

```asm
; Per-chip digi timing constants
; At PAL 985248 Hz, attack rate 0 = ~15 cycles/step
digi_cycles_per_step_6581:  .byte 15
digi_cycles_per_step_8580:  .byte 17    ; empirically measured on 8580 silicon
```

**For music (not digi):** the standard hard restart is sufficient
for music playback on both revisions. The 1-2 cycle timing difference
at rate-0 is inaudible in normal three-voice music; only digi routines
that require sub-millisecond envelope-level precision need per-chip
compensation.

### Worked example

```asm
; Mahoney-style hard restart with explicit cycle-count comments
; Applied to voice 1 two frames before the new note

; FRAME N-2: disable ADSR, gate off
hard_restart_frame1:
        lda #$00
        sta $D405           ; AD1 = 0 (fastest attack/decay)        [4 cycles]
        sta $D406           ; SR1 = 0 (no sustain, fastest release)  [4 cycles]
        lda shadow_d404
        and #$FE            ; clear GATE bit                         [2 cycles]
        sta shadow_d404
        sta $D404           ; voice 1: waveform preserved, GATE=0    [4 cycles]
        ; envelope now begins release from current level
        rts

; FRAME N-1: set TEST bit to lock oscillator at zero phase
hard_restart_frame2:
        lda shadow_d404
        and #$FE            ; ensure GATE still clear
        ora #$08            ; set TEST bit (bit 3)
        sta shadow_d404
        sta $D404           ; oscillator locked at zero DC           [4 cycles]
        ; On 8580: this also stabilizes the envelope reset path
        ; giving the rate counter a clean zero-point for the next gate
        rts

; FRAME N (note frame): release TEST, set real waveform + GATE
hard_restart_note:
        ; X = ADSR attack/decay byte for this note
        ; Y = ADSR sustain/release byte for this note
        ; A = waveform + GATE byte for this note
        stx $D405           ; real attack/decay
        sty $D406           ; real sustain/release
        sta shadow_d404
        sta $D404           ; clears TEST, sets waveform, sets GATE
        ; Attack begins from zero; oscillator released from phase-zero lock
        ; On 6581: attack ramp starts within ~15 cycles/step
        ; On 8580: attack ramp starts within ~15-17 cycles/step (chip variation)
        rts

; Cross-chip digi: per-chip attack step timing
; (used by digi_8bit_hard_restart routines to calibrate sample IRQ intervals)
compute_digi_irq_interval:
        lda chip_is_8580
        bne digi_8580_timing
        lda #15             ; 6581: ~15 φ2 cycles per attack step at rate 0
        rts
digi_8580_timing:
        lda #17             ; 8580: ~15-17 φ2 cycles (use 17 for headroom)
        rts
```

### Cross-references

- Registers: D404, D40B, D412 (VCREG for all three voices — hard restart
  applies to whichever voice is being gated)
- Technique: `digi_8bit_hard_restart` — full Hermit/Mahoney digi routine
  documentation and the complete rate-0 timing analysis
- Pitfall: `sid_write_only_registers` — always use shadow for D404 read-modify-write

---

## sid_voice3_disable_silent_bit — Bit 7 of $D418 silences voice 3 on 6581 but not all 8580 revisions; relying on it for muted melodic tricks is fragile

**Severity:** medium
**Region:** both
**Triggered by registers:** D418
**Triggered by techniques:** sid_voice_setup

### Symptom

Code that configures voice 3 as a silent LFO or random-number source
by setting $D418 bit 7 (the "3OFF" bit) hears voice 3 leaking
audibly on some 8580 boards. The leak is a faint but perceptible
tone or noise — particularly noticeable in quiet passages. Conversely,
a "muted melodic" arrangement that intentionally plays a pitched
voice 3 melody silenced via bit 7 (a known trick on 6581 for adding
a silent modulator voice) fails on certain 8580 revisions where the
voice is clearly audible.

### Mechanism

Bit 7 of $D418 (SIGVOL) is documented as "3OFF: disconnect voice 3
from audio output." The mechanism differs between chip revisions.

**6581 behavior.** On the 6581, the 3OFF bit reliably disconnects
voice 3 from the mixer that feeds the volume DAC. Voice 3's
oscillator and envelope continue running normally — the oscillator
output is still visible at $D41B (RANDOM/OSC3) and the envelope at
$D41C (ENV3) — but no audio from voice 3 reaches the output pin.
This is the basis for the classic pattern of using voice 3 as a free
LFO or random source without its sound being audible.

**8580 behavior — filter routing caveat applies to both chips.**
If voice 3 has its FILT3 bit set in $D417 (routing it through the
filter), then $D418 bit 7 does NOT silence it on either chip.
The 3OFF bit only disconnects the bypass path (the direct route from
the envelope output to the volume DAC that bypasses the filter). A
filtered voice 3 still sends its post-filter signal to the DAC
regardless of bit 7. This behavior is consistent between 6581 and
8580 — it is simply not always understood.

**8580 revision differences on the bypass path.** On 8580 chips
manufactured after approximately 1990 (typically the R5 revision and
later), the 3OFF bit's implementation was revised as part of broader
cost-reduction changes. The bit was originally undocumented and was
added for the "voice 3 as LFO" use case that had emerged in the C64
development community. Some 8580 R5 revisions implement 3OFF by
cutting the voice 3 output from the bypass summing node but do not
fully isolate the signal path, leaving a small residual. The bleed
is typically below -40 dB relative to a full-volume voice, but at
high master volume (VOL=15) and in quiet musical contexts it is
audible.

A secondary mechanism: voice 3 routed through the filter (FILT3=1 in
$D417) is entirely unaffected by 3OFF on any chip revision. Code
that sets FILT3 and 3OFF simultaneously and expects silence will hear
voice 3 through the filter on all chip revisions. This is by far the
more common source of the symptom compared to the 8580 R5 revision
bypass issue.

### Fix

**Do not rely solely on $D418 bit 7 for silence.** The safe approach
for voice 3 used as an LFO or modulation source is:

1. Clear FILT3 in $D417 (voice 3 bypasses the filter; bit 7 then
   works as intended on 6581 and most 8580s).
2. Set the voice 3 sustain level to 0 (SUSTAIN nibble of $D414
   = 0). With sustain at zero, the envelope decays to zero after
   the attack and decay phases and then holds at zero. Even if
   the bypass bleed reaches the output on some 8580 R5 chips,
   zero envelope means zero audio.
3. Optionally, set $D418 bit 7 as well for belt-and-suspenders
   protection on 6581 (where the bit works reliably).

For the voice-3-as-LFO pattern ($D41B read each frame), the
oscillator continues running at zero envelope perfectly well.
ENV3 ($D41C) is the envelope itself — if sustain=0, ENV3 reads
zero during the sustain phase, which means ENV3-as-LFO only
provides signal during the attack and decay portions of the
envelope. For a sustained LFO, use the oscillator output ($D41B,
set voice 3 to TRI or SAW waveform) rather than the envelope output.

### Worked example

```asm
; FRAGILE: relies only on $D418 bit 7 — fails on 8580 R5 if FILT3 is set,
; and may have subtle bleed on late 8580 revisions

; This sets 3OFF but forgets to clear FILT3:
        lda shadow_d417
        ora #$04            ; FILT3 = 1 (voice 3 through filter) -- MISTAKE
        sta shadow_d417
        sta $D417

        lda shadow_d418
        ora #$80            ; 3OFF = 1 -- doesn't silence filtered voice 3!
        sta shadow_d418
        sta $D418

; Result: voice 3 still audible on ALL chip revisions because FILT3 overrides 3OFF.

; ---------------------------------------------------------------

; SAFE: sustain-zero + clear FILT3 approach, works on all chips

; Voice 3 as triangle LFO source — silent on all revisions:
init_voice3_lfo:
        lda #$10            ; low frequency: slow LFO sweep
        sta $D40E           ; FRELO3
        lda #$00
        sta $D40F           ; FREHI3

        lda #$00            ; fastest attack, fastest decay
        sta $D413           ; ATDCY3
        lda #$00            ; sustain 0 — envelope goes to zero after decay
        sta $D414           ; SUREL3: sustain nibble=0, release rate=0

        lda #$11            ; TRI waveform + GATE on
        sta shadow_d412
        sta $D412           ; voice 3 oscillator starts running

        ; Clear FILT3 (remove voice 3 from filter path)
        lda shadow_d417
        and #%11111011      ; clear bit 2 (FILT3)
        sta shadow_d417
        sta $D417

        ; Now set 3OFF for belt-and-suspenders on 6581
        lda shadow_d418
        ora #$80            ; 3OFF = 1
        sta shadow_d418
        sta $D418

        ; Result: voice 3 oscillator runs (readable at $D41B), envelope at 0,
        ; FILT3 clear so 3OFF is effective, sustain=0 so even if bypass bleeds
        ; the audio amplitude is zero. Safe on all chip revisions.
        rts

; Using the LFO value each frame (e.g. in raster IRQ):
lfo_tick:
        lda $D41B           ; read OSC3 — triangle LFO value 0-255 cycling
        lsr a               ; scale down for pulse-width modulation
        lsr a
        sta shadow_d403
        sta $D403           ; write to voice 1 PWHI — modulate pulse width
        rts
```

### Cross-references

- Register: D418 (bit 7 = 3OFF, bits 4-0 = filter mode and volume)
- Register: D417 (bit 2 = FILT3 — must be clear for 3OFF to work)
- Technique: `sid_voice_setup` — full voice 3 LFO and modulation patterns
- Technique: `sid_filter_routing` — filter voice routing and the FILT3 interaction

---

*Cross-references: [docs/hardware/sid-reference.md](../hardware/sid-reference.md) for the complete SID register map, ADSR table, and hard-restart programming patterns. [docs/techniques/music-sid.md](../techniques/music-sid.md) for sid_voice_setup, sid_filter_routing, sid_8580_vs_6581_differences, and digi_8bit_hard_restart technique documentation.*
