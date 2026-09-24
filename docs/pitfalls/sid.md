---
category: sid
---

<!-- doc-type: pitfall-reference -->

# SID Pitfalls

The MOS 6581/8580 SID chip's pitfalls fall into two clusters: the
write-only register bank (which forces a shadow copy in RAM for all SID
code), and the behavioral differences between the two SID revisions (a
song or digi routine calibrated on a 6581 can fail audibly on an 8580,
or vice versa). The ADSR-reset bug and the voice-3 silent-bit divergence
are both in the second cluster, and both have workarounds. SID replacements that do not emulate the read side (the
SwinSID) are a separate case: `sid_replacement_d41b_unreadable`.

All pitfalls in this document apply equally to PAL and NTSC
systems; none of them are timing-region-specific. The filter cutoff
curve pitfall has the largest audible effect on SID music written for
both chips.

---

## sid_write_only_registers — All SID registers $D400-$D418 are write-only; reads return garbage

**Severity:** medium
**Region:** both
**Triggered by registers:** D400, D404, D40B, D412, D418
**Triggered by techniques:** sfx_engine_beside_music, sidfx_layered_chip, sfx_in_player, digi_4bit, sidasid_emulation_notes, sid_pwm_pad

### Symptom

Code that reads a SID control register expecting to see what was
previously written instead gets the last byte
written to (or read from) the SID, not the register's value (an
earlier version of this sentence said "the high byte of the read
address, the last byte the VIC-II fetched, or floating-bus noise";
neither of the first two ever appears). A read-modify-write pattern like "set bit 3 of
$D418 without touching the other bits" destroys the filter
mode and volume settings if no shadow register is maintained.
The failure mode is usually silent (the wrong register value takes
effect immediately, but there is no error signal) or manifests as
audio glitches: a filter sweep that jumps to the wrong cutoff, a
volume register that changes the master volume mid-note, or a voice
control register that clears the GATE bit unintentionally.

### Mechanism

The SID chip ($D400-$D41F) exposes 25 write-only registers at
$D400-$D418 (an earlier version of this sentence said 29; $D418 −
$D400 + 1 = 25, the same count the Fix below uses), followed by four
read-only registers at $D419-$D41C. The SID has no read path for
these registers. A read does not float the bus: the chip drives it
with the byte it last held: the last value written to any of its 32
addresses ($D400-$D41F and every mirror through $D7FF) or the last
value read from $D419-$D41C. That byte decays to $00 after roughly
7k cycles on a 6581 and roughly 660k cycles on an 8580 (measured in
VICE 3.10 reSID with the SID being clocked; real chips also decay but
were not measured here; see sid-reference.md). It is not the address
high byte and not a VIC-II fetch, which is what an earlier version of
this paragraph said; either way it is not register state and must
never be used as such. (For testers: in VICE, a run with sound
disabled (`+sound`) returns $00 from these reads via a fallback path
and does not emulate this behaviour, and with the dummy driver or
warp mode the held byte never fades.)

The four read-only registers ($D419-$D41C) behave differently:
POTX ($D419) and POTY ($D41A) return real paddle A/D values;
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

Recommended layout: a contiguous block of 25 bytes in RAM you own,
mapped 1:1 to the SID register layout. Under BASIC/KERNAL the free
zero page is only $02 and $FB-$FE, so a 25-byte shadow cannot live
there; $033C-$03FB is the cassette buffer, free only when tape I/O is
not in use, or use any RAM above your program. An earlier version of
this paragraph recommended `$C5` through `$DD`; that block is the
KERNAL's keyboard and screen-editor state ($C5 LSTX, $C6 NDX, $CB-$CD
key/cursor, $D1-$D6 screen line and cursor, $D9-$F2 the line link
table; see c64-memory-map.md), and a shadow there corrupts the
keyboard scan and screen editor on every IRQ. No "SID player
convention" places a shadow there.

### Worked example

```asm
; WRONG: read-modify-write directly on hardware register
; This reads garbage from $D418 and sets an incorrect value.
        lda $D418           ; BUG: returns the SID's last-held bus byte, not this register
        ora #$0F            ; intended: set volume to 15, keep filter bits
        sta $D418           ; writes garbage|0x0F — wrong filter mode likely set

; CORRECT: shadow-RAM pattern
; Declare shadow at top of file:
;   shadow_d418:  .byte 0     ; in RAM you own, e.g. $0340 (not zero page unless you own it)
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
**Triggered by techniques:** sid_filter_routing, sid_8580_vs_6581_differences, sidasid_emulation_notes, sid_env3_filter_envelope, mahoney_d418_8bit_digi, sid_8580_digi_bias_and_filter_bypass, sid_test_bit_and_osc_reset_tricks

### Symptom

A SID music patch that sounds bright and resonant on a 6581 system
comes out dull and flat on an 8580. A filter sweep that sounds
evenly-stepped across the frequency range on an 8580 sounds
compressed at the low end and widely-spaced at the high end on a
6581. Two 6581 boards of the same chip revision may produce
noticeably different filter sounds from the same register values.
Code review cannot find it (the register writes are correct), but it
is audible at once on mismatched hardware.

### Mechanism

The 6581 and 8580 implement the same filter architecture (11-bit
cutoff, 4-bit resonance, shared LP/BP/HP modes) but use
different analog circuit designs for the cutoff cell.

**6581 filter — non-linear and chip-variable.** The 6581 filter is a
continuous-time two-integrator filter whose cutoff resistors are NMOS
FETs used as voltage-controlled resistors (reSID's `filter.h` in the VICE
3.10 source; an earlier version called it a switched-capacitor design). The relationship between the 11-bit cutoff
register value and the resulting cutoff frequency in Hz is
non-linear, roughly sigmoidal on a logarithmic frequency scale.
The low end of the register range (roughly $D416 = $00-$30) produces
almost no frequency change; the mid-range ($40-$A0) sweeps across
most of the audible spectrum; the upper range ($A0-$FF) compresses
back. The curve also varies between individual
6581 chips from different manufacturing batches. The same $D416 value
can give a noticeably different cutoff on two 6581s from different
batches (no figures are sourced here; an earlier version gave 800 Hz
against 1200 Hz for $60 without a source).
This inter-chip variation is inherent
to the analog design and cannot be corrected in software without
chip-specific calibration.

**8580 filter — linear and consistent.** The 8580 redesigned the
filter cell for a near-linear cutoff response. A $D416 value of $80
is roughly half the nominal maximum cutoff (an earlier version said
$40, which is a quarter of the register's range); a sweep of $D416 from
$00 to $FF is even in Hz, not in pitch: $80 to $FF is one octave, so a
linear sweep spends half its range on the top octave. Space table entries
geometrically for an even-sounding sweep (an earlier version called the
linear sweep perceptually even). The curve
is consistent between 8580 chips.

**Resonance.** The 4-bit resonance (RESON, $D417 bits 7-4) controls
Q differently between chip revisions. At RES=12-15, the 6581 often
distorts audibly, a "gritty" resonance that scene SID
musicians use. The 8580 at RES=15 can self-oscillate
cleanly around the cutoff frequency, producing a sine-like tone that
is useful as a "fourth voice." A patch tuned at RES=15 for a specific
6581 timbre sounds clean and different on 8580.

### Fix

There is no single software fix that makes the same patch sound
identical on both chips. The approaches:

**Per-chip cutoff tables.** Ship two cutoff frequency tables, one
calibrated for 6581 and one for 8580. At startup, detect the chip
revision (see the $D41B detection method below, and
`sid_8580_vs_6581_differences`) and select the appropriate
table. (An earlier version said GoatTracker exports per-chip filter tuning
through a "chip-select" toggle and that SID Factory II has similar
compensation; no source for either was found, so the claim is withdrawn.)

**Target one chip explicitly.** For demo or game
music, choose a target chip and tune all filter patches against that
chip. Document the target in the .SID header's 16-bit big-endian
flags word at $76-$77: bits 4-5 of byte $77 give the first SID's
model (00=unknown, 01=6581, 10=8580, 11=either); bits 0-1 are the
MUS-data and PlaySID/BASIC flags and bits 2-3 the video standard, so
mask `byte[$77] >> 4 & 3`, not `& 3` (an earlier version of this
sentence put the model in bits 0-1, which would classify MUS files as
6581). See formats/c64-file-formats.md. Accept that the other chip
will sound different.

**Use filter-independent timbres.** Unfiltered voices (FILT bits
clear in $D417) pass straight to the volume DAC and are not subject
to cutoff curve differences. For cross-compatible patches, minimize
filter use or use the filter only for broad tonal shaping rather than
a precise tuned-resonance effect.

**Chip detection at runtime.** The filter cannot be observed from
software: the only readable voice-3 registers are $D41B (OSC3) and
$D41C (ENV3), and both sit before the filter in the signal path (see
sid-reference.md, Filter signal flow), so no cutoff, mode or routing
write changes what they return. An earlier version of this section
proposed reading ENV3 through the filter, which cannot work: $D41B
and $D41C sit before the filter; run in VICE reSID, ENV3 read $FF
with cutoff $00, cutoff $FF, FILT3 = 0 and 3OFF = 1 alike on both chip
models, and the deleted listing returned "8580-like" on both chips by
its own comment (its value was just how far a rate-0 attack had got in
the ~1,000-cycle settle loop). That listing was also self-inconsistent:
its header comment named the same flag state for both chips and its
carry sense was the inverse of its own prose. Anyone who copied it got
both the mechanism and the branch wrong.

The standard detection routine uses $D41B instead: write $FF to
$D412, $D40E and $D40F, then write $20 to $D412 (sawtooth, TEST and
GATE cleared) and read $D41B immediately. The value differs between
revisions because the two chips reset and restart the accumulator
differently. Measured in VICE x64sc reSID, `-sidmodel 0` returns 3
and `-sidmodel 1` returns 2; real-hardware values are unverified here,
treat them as the same. Detection is imprecise (some SIDs answer
ambiguously); use it only to select between precomputed cutoff
tables, and offer a settings toggle as the fallback. When testing this
in headless VICE, the $D41B/$D41C reads are only meaningful with a
real sound sink (`-sound -sounddev wav -soundarg out.wav`); the usual
`+sound` invocation returns meaningless values and would make the
detection look non-deterministic (see `sidasid_emulation_notes` in
music-sid).

### Worked example

```asm
; SID music player with per-chip filter table selection
; shadow_d416 and shadow_d417 are maintained throughout playback

chip_is_8580:   .byte 0     ; 0 = 6581, 1 = 8580

; Filter cutoff tables (simplified; real tables have 64 or more entries)
cutoff_tbl_6581:
        ; Illustrative values, not measured on any chip. They run $10-$CC
        ; (an earlier comment said they cluster in $30-$A0)
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

## sid_adsr_bug_8580 — 8580 ADSR-reset bug on hard restart; the rate-counter wrap is ~33 ms on both chips

**Severity:** high
**Region:** both
**Triggered by registers:** D404, D40B, D412
**Triggered by techniques:** digi_8bit_hard_restart, sid_8580_vs_6581_differences, sfx_in_player, goattracker_player_api, sid_env3_filter_envelope, music_sync_timeline, sid_hard_restart_drum

### Symptom

A hard restart that behaves on a 6581 leaves an 8580 voice holding
its level for a moment before the attack starts (the 8580 reset-path
difference below), and on either chip a note whose AD/SR nibbles were
lowered while the rate counter had already passed the new period
starts up to 33 ms late (the rate-counter wrap). The effect is most
audible on fast-changing note sequences (arpeggios). An earlier version
of this Symptom also described digi samples coming out "louder, quieter,
or with a shifted peak on 8580" and players with "envelope timing drift
on the other chip"; both rested on a per-chip attack-step difference
that the Mechanism below withdraws; none has been measured.

### Mechanism

Both the 6581 and 8580 share an ADSR bug in
the 15-bit envelope rate counter. The bug triggers when the CPU
writes a new (smaller) rate value to $D405 or $D406 at a time when
the envelope's internal 15-bit rate counter has already counted past
the new target threshold for the current phase. In that case the
counter must wrap through its full 15-bit range (0-32767 steps)
before the envelope generator reads the new rate and produces the
next envelope increment. At PAL clock (985248 Hz), a full 15-bit
wrap takes up to 32768 cycles — approximately 33 milliseconds.

The wrap length does not depend on the chip or on the new rate: it
is up to 32768 cycles (~33 ms at PAL) on both the 6581 and the 8580,
because the 15-bit counter must come back round to the new compare
value however small that value is (measured in VICE reSID: writing
attack 0 after the counter had run 5,120 cycles stalled the envelope
27,627 cycles on the 6581 model and 27,240 on the 8580; writing
attack 1 instead gave 27,173 / 27,350; the rate-0 attack itself takes
~2,280 cycles, which is where the 2 ms figure belongs). An earlier
version of this paragraph said the 6581's wrap at rate 0 was "close
to the 2 ms attack time"; that confused the attack duration with the
wrap. Hard restart works by writing AD/SR = 0 two frames before the
gate: 2 × 19,656 = 39,312 cycles (63 × 312 per PAL frame) covers the
worst-case wrap, one frame (19,656) does not. (An earlier version used
19,705, which is φ2 / 50, not the frame.)

**The note frame's write order.** The restart is undone if the note
frame writes AD or SR before the gate. Written first with the gate off,
SR's release rate is in force at once and its counter runs past a fast
attack's period before the gate; AD's decay rate is the period reSID
uses for the gate's first cycles (VICE 3.10 `src/resid/envelope.cc`,
`writeCONTROL_REG`). Measured in VICE x64sc 3.10 (reSID) by
`recipes/kickassembler/sid-hr-snare.md`, an attack-0 snare with AD
`$08`, SR `$08`, 80 hard-restarted hits per order: AD, SR, then the gate
150 cycles later (the #50 player's order), 0 started in their own frame;
AD, gate, SR, 73; gate, AD, SR, 80. The late hits start 33.0 to 34.8 ms
after the gate write in the recordings, on both chip models. Write the
gate first. The #50 player (`recipes/kickassembler/music-player.md`)
does since #118; its note check, with each part of its tune played on
voice 3, reads 163 of 163 drum, 139 of 139 bass and 43 of 43 lead notes
starting in their own call, against 146, 81 and 0 in the old order
(PAL, VICE x64sc 3.10).

**8580 behavior and the reset bug.** The 8580 introduced an internal
difference in the envelope reset path. On hard restart (the
code writes AD=0 and SR=0, then clears GATE) the 8580's envelope
can enter an intermediate "hold at level" state caused by the reset
bug before it begins the release phase. At rate 0 the envelope steps
roughly every 9 φ2 cycles on either chip (2 ms / 256 steps = 7.7 µs
by the datasheet; measured in VICE reSID, 6581 and 8580 models, the
255 steps to peak take about 2,100-2,300 cycles ≈ 2.1-2.3 ms, with
the two models within half a cycle per step of each other). An
earlier version said ~15 cycles on the 6581 and 17 on the 8580 and
attributed the 17 to a silicon measurement; neither number came from
a measurement, and the quoted formula did not evaluate to 15.

**Hard-restart digi (digi_8bit_hard_restart) cross-chip impact.**
The Hermit-style hard-restart digi technique depends on the voice's
envelope reaching a known level within a precisely-timed window. No
per-chip rate-0 step difference has been measured (in reSID the two
models reach peak within the same poll count), so an earlier version
of this paragraph, which derived a systematic 1-3 count envelope
offset on the 8580 from a slower attack step, rested on a premise
that has been withdrawn. Digi routines do drift between real chips,
but for other reasons (DC offset, the volume DAC's mixing
nonlinearity and the filter), not from the attack step rate.

### Fix

**Always use a hard-restart sequence.** Both chip revisions benefit
from a two-frame hard restart. The one shown in the worked example
below is the **test-bit restart** variant listed under hard-restart
variants in sid-reference.md: one frame with AD=0/SR=0 and GATE
cleared, one frame with the TEST bit set (GATE still clear) to lock
the oscillator, then the real note gate on the third frame, so the
note frame supplies the 0→1 GATE edge and the attack begins from
zero. The "Classic" form that sid-reference.md and music-sid.md show
is a different sequence: SR = $F0 (not 0) on the first frame and $09
= TEST+GATE on the middle frame, so the envelope is already gated at
the note frame (ENV3 $FF before and after the note-frame write in
reSID) and that write does not start a fresh attack. An earlier
version of this entry presented the test-bit form as "the full
hard-restart sequence" without distinguishing it from the classic
one. Do not mix the two: with AD=0/SR=0 on frame 1, a $09 middle
frame would let the envelope decay to zero during the TEST+GATE frame
and, because a GATE-held write does not retrigger the attack
(measured in VICE reSID), the note frame would play silently. Either
form forces the rate counter through its wrap before the new note
begins.

**Do not pick an attack rate for cross-chip consistency without
measuring it.** No source supports rate 1 being more consistent
between revisions than rate 0 (an earlier version of this paragraph
said it was). In VICE reSID both rates jitter by the rate counter's
phase at gate-on and neither shows a systematic 6581/8580 difference:
the rate-0 attack reached $FF in 2,080-2,300 cycles and the rate-1
attack in 7,460-8,070 cycles on both chip models (x64sc, `-sound
-sounddev wav`, 16 trials per rate; runs made with `+sound` return
meaningless ENV3 values, see music-sid). What does change the rate-0
time is the ADSR delay bug: lowering the attack nibble while the rate
counter has passed the new period cost one trial 33 ms (the full
15-bit wrap), which is why the hard-restart sequence above matters
more than the rate you choose.

**Chip-detect then branch.** Detect the SID revision at startup (see
the $D41B method in `sid_filter_chip_variation` above, or
`sid_8580_vs_6581_differences`) if you need per-chip filter tables.
An earlier version of this section followed with a listing of
per-chip digi timing constants (`.byte 15` for the 6581, `.byte 17
; empirically measured on 8580 silicon` for the 8580); neither value
came from a measurement, the only measured figure is one number for
both chips (~9 cycles per attack step at rate 0, VICE reSID), and the
listing has been removed rather than corrected. Do not keep a
per-chip constant.

**For music (not digi):** the standard hard restart is sufficient
for music playback on both revisions. Only digi routines that
require sub-millisecond envelope-level precision depend on
the attack step timing, and no per-chip difference in it has
been measured.

### Worked example

```asm
; Test-bit hard restart (sid-reference.md's "Test-bit restart" variant,
; not the "Classic" SR=$F0 / $09 form) with explicit cycle-count comments
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
        ; GATE stays clear here (test-bit variant): the note frame
        ; supplies the 0->1 GATE edge. The classic form writes $09
        ; (TEST+GATE) instead, but only with SR=$F0 on frame 1.
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
        ; attack steps every ~9 cycles at rate 0 (VICE reSID, both models)
        rts
```

An earlier version of this listing ended with a
`compute_digi_irq_interval` routine returning 15 for the 6581 and 17
for the 8580 as "cycles per attack step"; neither figure was measured
and the two chips show no difference in reSID, so it has been removed.

### Cross-references

- Registers: D404, D40B, D412 (VCREG for all three voices — hard restart
  applies to whichever voice is being gated)
- Technique: `digi_8bit_hard_restart` — the hard-restart digi family and
  the measured rate-0 envelope timing (9 φ2 cycles per attack step in
  reSID on both chip models; the exact Hermit/Mahoney register sequences
  are not documented in this knowledge base; an earlier version of this
  line promised "full Hermit/Mahoney digi routine documentation")
- Pitfall: `sid_write_only_registers` — always use shadow for D404 read-modify-write

---

## sid_voice3_disable_silent_bit — Bit 7 of $D418 does not silence voice 3 routed through the filter; relying on it alone is fragile

**Severity:** medium
**Region:** both
**Triggered by registers:** D418
**Triggered by techniques:** sid_voice_setup, lfsr_random, sid_env3_filter_envelope, sid_8580_digi_bias_and_filter_bypass, sid_sync_lead, sid_ring_mod_bell

### Symptom

Code that configures voice 3 as a silent LFO or random-number source
by setting $D418 bit 7 (the "3OFF" bit) still hears voice 3: a tone or
noise under the music. (An earlier version blamed some 8580 boards and a
"muted melodic" 6581 trick that fails on certain 8580 revisions; neither
had a source.)

### Mechanism

Bit 7 of $D418 (SIGVOL) is documented as "3OFF: disconnect voice 3
from audio output." The mechanism differs between chip revisions.

**6581 behavior.** On the 6581, the 3OFF bit disconnects
voice 3 from the mixer that feeds the volume DAC. Voice 3's
oscillator and envelope keep running. The oscillator
output is still visible at $D41B (RANDOM/OSC3) and the envelope at
$D41C (ENV3), but no audio from voice 3 reaches the output pin.
This is the basis for the pattern of using voice 3 as a free
LFO or random source without its sound being audible.

**8580 behavior — filter routing caveat applies to both chips.**
If voice 3 has its FILT3 bit set in $D417 (routing it through the
filter), then $D418 bit 7 does NOT silence it on either chip.
The 3OFF bit only disconnects the bypass path (the direct route from
the envelope output to the volume DAC that bypasses the filter). A
filtered voice 3 still sends its post-filter signal to the DAC
regardless of bit 7. This behavior is the same on the 6581 and
8580.

**A leak through 3OFF on some 8580s is unsourced.** Accounts that
late 8580s let a little of voice 3 through 3OFF have no revision, date
or level behind them here, and reSID (VICE's SID model) cuts voice 3
cleanly on both chips (`src/resid/filter.cc`, `set_sum_mix`: "voice3off
... only affects voice 3 if it is routed directly to the mixer"). Treat
it as unverified. (An earlier version stated it as fact for 8580s made
after about 1990, "typically the R5 revision"; before that it said the
bit was originally undocumented and put the bleed below -40 dB. None of
it had a source, and 3OFF is in the SID's register map.)

A secondary mechanism: voice 3 routed through the filter (FILT3=1 in
$D417) is entirely unaffected by 3OFF on any chip revision. Code
that sets FILT3 and 3OFF simultaneously and expects silence will hear
voice 3 through the filter on all chip revisions. This is the only
cause of the symptom that reSID reproduces.

### Fix

**Do not rely solely on $D418 bit 7 for silence.** For voice 3 used
as an LFO or modulation source:

1. Clear FILT3 in $D417 (voice 3 bypasses the filter; bit 7 then
   works as intended; reSID cuts it cleanly on both chips).
2. Set the voice 3 sustain level to 0 (SUSTAIN nibble of $D414
   = 0). With sustain at zero, the envelope decays to zero after
   the attack and decay phases and then holds at zero. Even if
   a chip did leak through 3OFF, zero envelope means zero audio.
3. Set $D418 bit 7 as well.

For the voice-3-as-LFO pattern ($D41B read each frame), the
oscillator keeps running at zero envelope.
ENV3 ($D41C) is the envelope itself: if sustain=0, ENV3 reads
zero during the sustain phase, which means ENV3-as-LFO only
provides signal during the attack and decay portions of the
envelope. For a sustained LFO, use the oscillator output ($D41B,
set voice 3 to TRI or SAW waveform) rather than the envelope output.

### Worked example

```asm
; FRAGILE: relies only on $D418 bit 7 — fails on every chip if FILT3 is set
; (an earlier comment said only on 8580 R5); a leak on some 8580s is unsourced

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

        ; Now set 3OFF as well
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

- Register: D418 (bit 7 = 3OFF, bits 6-4 = filter mode, bits 3-0 = volume;
  an earlier version said bits 4-0)
- Register: D417 (bit 2 = FILT3 — must be clear for 3OFF to work)
- Technique: `sid_voice_setup` — full voice 3 LFO and modulation patterns
- Technique: `sid_filter_routing` — filter voice routing and the FILT3 interaction

---

## sid_replacement_d41b_unreadable — Some SID replacements cannot read back $D41B; a random seed from it can become constant or low-entropy

**Severity:** medium
**Region:** both
**Triggered by registers:** D41B
**Triggered by techniques:** lfsr_random, sid_8580_vs_6581_differences, sid_test_bit_and_osc_reset_tricks, mahoney_d418_8bit_digi

### Symptom

A game seeded from SID voice 3 noise plays the same "random" sequence
on every run, or its enemies, spawns and level layouts never vary, on a
machine fitted with a SID replacement. The same program varies on a
real 6581 or 8580. Chip-detection code that reads `$D41B` reports the
wrong chip or none. Nothing here was run on such hardware; this page
has no instrument for it (rung 4, from the sources below).

### Mechanism

The seeding pattern in `lfsr_random` sets voice 3 to noise at frequency
`$FFFF` and reads the oscillator output at `$D41B` twice. On a real SID
the register changes on every read. SID replacements are
microcontrollers or FPGAs that emulate the chip, and not all of them
emulate the read side:

- **SwinSID.** C64-Wiki: "SwinSID does not support reading registers",
  and games that "read from $D41B to generate random numbers" (it names
  Fort Apocalypse, Uridium, Pirates! and Paradroid) "behave strangely".
  Paddles and mice do not work either, because SwinSID has no
  analogue-to-digital converter for `$D419`/`$D41A`.
- **SwinSID Nano.** The SIDDetector-II README says its `$D41B` does move,
  but only at about 44 kHz, so back-to-back reads can return the same
  value; SIDDetector-II uses exactly that to tell it from a real SID.
  C64-Wiki names the SwinSID Nano as the SwinSID it describes, so the two
  sources disagree about whether its read moves at all.
- **No SID, or an Ultimate II+ with its virtual SID off.** The same README
  reports bus noise at about 44 kHz from the cartridge, which SIDDetector-II
  cannot tell from a SwinSID Nano.
- **ARMSID, SwinSID Ultimate and others** echo written values in their
  voice-3 read registers when sent an identification string (SIDDetector-II
  README); what they return at `$D41B` during normal play is not stated
  there.

Where the read does not move, or moves slowly, the two reads can give
the same bytes on every run and the seed can be constant or low-entropy;
an undriven read may also return open-bus data. This is an inference from
the sources (rung 4), not something C64-Wiki states. `$D41B`-based chip detection
(`sid_8580_vs_6581_differences`, "Chip detection at runtime") fails for
the same reason.

### Fix

Do not make `$D41B` the only source of the seed. XOR in CIA1 timer A
(`$DC04/$DC05`) and, better, the frame count until the player's first
fire press; `lfsr_random` in `techniques/maths.md` already describes
both. The recipe's own check can also detect the problem: it counts how
many of 255 consecutive `$D41B` read pairs differ (255 in VICE). A count
far below 255 means the SID read is not moving and the seed should come
from the other sources (an inference from the sources above, not
measured here). Keep the zero check from `lfsr_zero_state_lockup`: a bus
that reads `$00` gives a zero seed.

Recipes that seed from `$D41B` alone: `recipes/oscar64/lfsr-random.md`
(it also prints the CIA timer but does not mix it into the seed) and
`recipes/oscar64/platformer-scaffold.md` (two `sid.random` reads, then
the zero check). Both can give a constant or low-entropy seed on a SwinSID (rung 4).

### Cross-references

- Technique `lfsr_random` — seeding from SID, CIA timer and player input
- Technique `sid_8580_vs_6581_differences` — `$D41B` chip detection
- Pitfall `lfsr_zero_state_lockup` (`pitfalls/cpu.md`) — the zero seed
- Register `$D41B` (OSC3) — `../hardware/sid-reference.md`

**Sources.** C64-Wiki, "SwinSID": https://www.c64-wiki.com/wiki/SwinSID.
SIDDetector-II README (steps "SwinSID Nano" and "ARMSID / ARM2SID / Swinsid
Ultimate"): https://github.com/MichaelTroelsen/SIDDetector-II.

---

*Cross-references: [docs/hardware/sid-reference.md](../hardware/sid-reference.md) for the complete SID register map, ADSR table, and hard-restart programming patterns. [docs/techniques/music-sid.md](../techniques/music-sid.md) for sid_voice_setup, sid_filter_routing, sid_8580_vs_6581_differences, and digi_8bit_hard_restart technique documentation.*
