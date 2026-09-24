<!-- doc-type: failure-reference -->

# C64 Failure Patterns

Symptom-keyed catalog of common C64 failure modes. Each entry is a
CrashPattern node. Likely-causes tags are free-form searchable strings;
graph edges are emitted by the `Caused by …` lines.

---

## black_screen — Display goes solid color or stays $00

**Likely causes:** vic_bank_misconfigured, screen_pointer_outside_bank, d011_blanked
**Diagnosis steps:** Read $D011 and check bit 4 (BLANK); read $D018 and verify the screen-RAM pointer nibble points to RAM inside the active VIC bank; read $DD00 bits 0-1 to confirm which 16 KB bank the VIC is addressing; confirm the CPU data bus reaches VIC-II by reading $D012 (raster counter should not be stuck at $FF).
**Caused by registers:** D011, D018, DD00
**Caused by techniques:** vic_bank_select

The display is dark: a single solid color (usually black border plus
black background), or a frame that never shows characters or bitmap
data. The machine is not frozen; it is drawing nothing.

The most common cause is a VIC bank mismatch from a wrong write to
$DD00 (CIA2 Port A). The VIC-II fetches screen RAM,
charset or bitmap data, and sprite bitmaps from a 16 KB window selected
by bits 0–1 of $DD00. Four banks are available (bank 0 at $0000,
bank 1 at $4000, bank 2 at $8000, bank 3 at $C000). If the bank is
switched without also updating $D018 to point screen RAM and
character/bitmap data inside the new bank, the VIC reads from the wrong
addresses (usually all-zero ROM or garbage) and draws a blank field.
A second cause is leaving bit 4 of $D011 (DEN, Display Enable) clear;
the chip blanks the display entirely when this bit is 0. A third cause
is a $D018 video-matrix pointer that falls outside the active bank
because the offset nibble was set before the bank was switched.

**Diagnosis steps:**
1. Via vice-mcp, read memory at $D011. If bit 4 is 0 the screen is
   blanked; set it to re-enable.
2. Read $DD00 bits 0–1. Bank = 3 − (bits 0–1). Verify this matches
   where the screen RAM and charset/bitmap data live.
3. Read $D018. High nibble = screen-RAM offset (×$0400 within bank).
   Low nibble = charset pointer (×$0800) or bitmap pointer ($08 = bitmap
   at bank base, $18 = bitmap at bank_base+$2000). Confirm the resolved
   addresses fall inside the bank.
4. Write a known character code to screen RAM and read it
   back. If the read returns the written value, the RAM is visible but
   the VIC is looking elsewhere.

Correct the VIC bank by writing the right 2-bit value to $DD00 (keep
bits 2–7 unchanged). Then update $D018 so both the screen pointer and
the charset/bitmap pointer resolve to addresses inside that 16 KB window.
Set $DD00 first, then $D018, and keep screen RAM at the canonical offset
($0400 within bank 0, i.e., $D018 = $14 in default mode). If code sets
the BLANK bit as part of a display-off effect, ensure the re-enable
write cannot be skipped by an IRQ handler that returns early.

---

## garbled_bitmap — Bitmap mode shows random characters or noise

**Likely causes:** bitmap_mode_not_set, charset_pointer_wrong, screen_ram_collision
**Diagnosis steps:** Read $D011 bit 5 (BMM) — must be 1 for bitmap mode; read $D016 bit 4 (MCM) for multicolor; check $D018 low nibble: bit 3 must be set (bitmap at +$2000 relative to VIC bank base) or clear (bitmap at bank base); verify screen RAM in $D018 high nibble is inside the same VIC bank as the bitmap.
**Caused by registers:** D011, D016, D018

The display shows a chaotic pattern of random character glyphs or
high-frequency color noise instead of the intended image. Bitmap mode
was selected but the content looks like character-mode garbage.

Three settings must agree for bitmap mode to work: $D011
bit 5 (BMM) must be set; $D018 bit 3 selects whether the bitmap data
lives at the VIC bank base or at +$2000 within the bank; and $D018 high
nibble places screen RAM (which holds the foreground/background color
for each 8×8 cell) at the correct offset. A common mistake is leaving
$D018 in its power-on value of $14, which places screen RAM at $0400
and the charset pointer at $1000 — fine for character mode but
incorrect for bitmap if the bitmap data was loaded to $2000. Another
mistake is copying a koala or hires image to the right address but
forgetting to set BMM, so the VIC still reads character pointers. A
collision between screen RAM and bitmap data (when both are assigned to
overlapping ranges inside a bank) causes half the visible area to show
the wrong colors or scrambled shapes.

**Diagnosis steps:**
1. Read $D011. Bit 5 must be 1. If it is 0, the chip is in character
   mode despite the image data being loaded.
2. Read $D018. For a hires bitmap at $2000 in bank 0: screen RAM at
   $0400 → high nibble = $1, bitmap → low nibble = $8; combined $18.
   For a koala at $2000 with screen RAM at $0400: $D018 = $18, plus
   $D016 bit 4 = 1 for multicolor.
3. Confirm the VIC bank (via $DD00) encompasses both the bitmap and
   screen RAM addresses.
4. Use vice-mcp to read 8 bytes from the resolved bitmap base address
   and verify they match the first row of pixel data from the image.

Set $D011 bit 5 to enable bitmap mode and bit 4 to enable the display.
For hires, $D016 bit 4 = 0; for multicolor bitmap (Koala) it = 1.
Load the 8000-byte bitmap to the address the $D018 low nibble selects,
and the 1000-byte screen RAM to the address the high nibble selects.
The two ranges must not overlap within the VIC bank.

---

## sprite_flicker_random — Sprites flicker randomly across the frame

**Likely causes:** dma_timing_violation, sprite_register_write_during_active
**Diagnosis steps:** Read $D015 (sprite enable); count enabled sprites; use vice-mcp raster breakpoint to pause mid-frame and inspect $D000-$D00E; check whether sprite register writes occur inside VIC DMA windows (cycles 58-61 on each sprite-active scanline); look for writes to $D015 that toggle bits during visible raster.
**Caused by registers:** D015, D000
**Caused by techniques:** sprite_multiplex_8

Sprites blink on and off at random: correct on some frames, vanished
or shifted on others. The pattern differs between runs, which points to
a race between CPU writes and VIC DMA reads.

The VIC-II reads sprite data from 64-byte blocks in the VIC bank during
specific DMA windows (typically cycles 58–61 per sprite per active
scanline). If the CPU writes sprite X/Y position or enable-bit registers
during one of those windows, the VIC may see a torn value: the high
byte of a new position combined with the low byte of the old, or a
sprite-enable bit that transitions mid-DMA. The result is a sprite that
appears one pixel-row too high or low on one frame, or one that
disappears entirely when the enable bit clears at exactly the wrong
moment. The pattern looks random because the relative phase between CPU
and VIC shifts each frame unless the raster IRQ is stabilised.

**Diagnosis steps:**
1. Set a vice-mcp raster breakpoint at the first sprite-active line and
   dump $D000-$D017 to verify they match intended values.
2. Instrument the sprite-update routine to log the value of $D012
   (raster line) at the moment of each write. Writes occurring in
   the DMA window of an active sprite are unsafe.
3. Enable VICE's raster-beam display and single-step through the
   sprite-update loop to identify which write collides with DMA.
4. Check whether $D015 is written inside the visible frame with bits
   that affect currently-active sprites.

Move all sprite register writes to the vertical blank region or to
raster lines immediately above the sprite's Y position, before VIC
DMA begins for that sprite. In a multiplexer, split the sorting phase
(during visible frame) from the register-commit phase (at or near VBI).
If $D015 must be toggled mid-frame, do so at a stable raster position
with interrupts disabled for the critical write window.

---

## sprite_flicker_periodic — Sprites flicker on every N-th frame

**Likely causes:** sprite_multiplex_miscount, raster_irq_overrun
**Diagnosis steps:** Measure IRQ handler execution time in cycles via vice-mcp; check if the IRQ handler takes more cycles than the gap between the raster line it fires on and the next VIC DMA window for the topmost sprite; verify the sprite-sort routine does not run over its budget on frames with many active sprites.
**Caused by registers:** D012
**Caused by techniques:** stable_raster_irq, sprite_multiplex_8

Sprites are correct on most frames but flicker predictably on every
second, fourth, or Nth frame. Unlike random flicker, the period is
consistent, which points to a cyclic resource overrun rather than a
timing race.

The most common cause is a sprite multiplexer whose sort-and-commit
phase runs past the raster position where VIC DMA begins for the top
sprite. On light frames (few sprites) the handler finishes in time; on
heavy frames (eight or more logical sprites, complex sorting network)
it overruns by a handful of cycles, and the VIC begins DMA before the
CPU finishes writing the new Y positions. Because the overrun happens
only when the sort list reaches a certain length, the period of the
flicker matches the period of the heaviest frame in the animation. A
secondary cause is a raster IRQ that fires too late, because either
the D012 target line was miscounted or a badline stole the
cycles a tight timing routine relied on.

**Diagnosis steps:**
1. Add a cycle counter (read $DC04/$DC05 CIA1 timer) at entry and exit
   of the IRQ handler. Log the delta over 60 frames and look for
   frames where the count spikes above the budget.
2. Set a vice-mcp breakpoint at the known flicker line and inspect
   $D012 to confirm the raster IRQ fires on the intended
   line.
3. Count the number of active sprites on each frame class and compare
   against the sprite-sort worst-case cycle estimate.
4. Introduce a temporary `STA $D020` probe at the IRQ exit to see a
   visible color stripe when the handler is still running as sprites
   become active.

Reduce the sort routine's worst case: use counting sort instead of
bubble sort; cap the active sprite count at eight (hardware limit);
or split the sort across two frames with a double-buffered sprite
table. If the raster IRQ fires late due to badlines, advance the
trigger line by the number of stolen cycles.

---

## sprite_disappears — Sprite vanishes when crossing a screen position

**Likely causes:** sprite_x_high_bit_lost, sprite_y_off_screen
**Diagnosis steps:** Read $D010 (MSB of X for all sprites); when sprite X crosses 255→256 the corresponding bit in $D010 must flip from 0 to 1 or the sprite jumps back to the left edge; inspect $D001/$D003/… Y registers — values 0-7 and 248-255 place the sprite partially or fully off-screen.
**Caused by registers:** D010, D000

A sprite that tracks a moving game object or scroll position suddenly
becomes invisible at a specific horizontal or vertical position, then
reappears after passing through a narrow dead zone.

Sprite X is a 9-bit value: the low 8 bits live in $D000/$D002/… and
the 9th (MSB) lives as a single bit in $D010 for each of the eight
sprites. Software that stores sprite X as a single byte and writes only
the low register will leave the MSB stale. When the sprite crosses
X=255 the displayed position wraps to 0 instead of advancing to 256,
so the sprite jumps to the left edge and leaves the visible area. For Y, values 255 (and 0–7) place the sprite
above or on the top border; values above 230 (approximately, depending
on PAL/NTSC) push it below the visible area. A sprite at Y=255 is never
drawn.

**Diagnosis steps:**
1. In vice-mcp, set a watch on the sprite's X register ($D000 + 2×N)
   and $D010 bit N. Step through the movement code and confirm that
   when X_low rolls over from 255 to 0, the corresponding $D010 bit
   also toggles.
2. Read the sprite's Y register. Values near 0 or 255 on PAL place the
   sprite in the border/blanking region.
3. On NTSC, the visible Y window is different (41–300 raster lines;
   sprite Y range 0–249 active). Confirm the Y value is valid for the
   target region.
4. Check whether the sprite's priority bit ($D01B) is set, which causes
   it to appear behind the background bitmap, so it is hidden on
   non-$D021 pixels.

Store sprite X as a 16-bit value internally. Derive the low byte as
`x & 0xFF` and the MSB contribution as `(x >> 8) & 1`. Before writing
to hardware, compute the new $D010 value: clear the bit for this sprite,
then OR in the MSB. A common idiom is to build the full $D010 byte from
all eight sprite MSBs each frame in the commit phase. For Y, clamp the
stored position to 230 on PAL or use the off-screen sentinel $FF only
when intentionally hiding a sprite via the enable bit ($D015) instead.

---

## screen_jumps_y_axis — Display jumps vertically each frame

**Likely causes:** raster_irq_late, badline_overrun
**Diagnosis steps:** Check $D012 IRQ trigger line vs actual raster position at handler entry using CIA1 timer delta; count cycles consumed in the IRQ handler path; verify $D011 bits 0-2 (Y scroll) are not being written on different lines each frame; use vice-mcp raster breakpoint to compare actual vs expected raster position at scroll register write.
**Caused by registers:** D011, D012

The whole display jerks vertically, typically by one or
two pixel rows, once per frame. The jitter is usually consistent in
magnitude but may vary by one raster line between frames.

The cause is nearly always a scroll-register write ($D011 bits
2–0, Y-scroll) that arrives at a different raster line on different
frames. The VIC-II displays a character row eight lines tall; writing Y-
scroll mid-row shifts which pixel row the VIC outputs, causing the
display to jump. If the raster IRQ that performs this write fires late
on some frames (due to a badline, an NMI, or a variable-length preceding
handler), the write reaches the chip one raster line later and the
visible pixel shift differs by one scanline. Over multiple frames this
produces a flickering, unstable image. Badlines steal 40 CPU cycles;
if the IRQ fires on or just before a badline, the handler's timing
budget is silently consumed and the critical write is delayed.

**Diagnosis steps:**
1. Read the CIA1 timer ($DC04) at the first instruction of the IRQ
   handler and again just before the $D011 scroll write. If the delta
   varies by more than one or two cycles between frames, the IRQ is
   not arriving at a stable raster position.
2. Use vice-mcp to set a raster breakpoint at the intended trigger line
   and confirm it fires before any badline between trigger and write.
3. Instrument the code: temporarily write a distinctive value to $D020
   (border color) immediately at IRQ entry and at the scroll write to
   produce a color stripe. Measure its position on a frame grabber or
   VICE's raster display. If it moves between frames, the IRQ is unstable.
4. Count cycles between IRQ trigger and D011 write and verify the line
   falls in a non-badline region.

Use the stable double-IRQ technique to remove jitter: fire the first
IRQ above the target line, set D012 to the exact target line and exit;
the second IRQ writes the scroll register with cycle precision. If
badlines are unavoidable between the IRQ and the write, advance the
trigger line by the number of stolen cycles and verify with a CIA1
timer delta measurement.

---

## hang_no_irq — Program freezes with no IRQ activity

**Likely causes:** sei_never_cleared, irq_vector_corrupt, stack_overflow_in_irq
**Diagnosis steps:** Attach vice-mcp and read the CPU status register P — if bit 2 (I flag) is set, interrupts are globally masked; read $0314-$0315 (IRQ vector) and confirm they point to a valid handler; read the stack pointer and top-of-stack bytes to detect overflow; read $D01A (VIC IRQ enable) and $DC0D (CIA1 ICR) to confirm interrupt sources are enabled.
**Caused by kernal:** CHKIN, CHKOUT

The program halts. It neither crashes to BASIC nor responds to any
input. The border color does not change, no music plays, and no raster
effects occur. The STOP key may or may not respond depending on whether
KERNAL interrupt handling is still active.

Three failure modes produce this symptom. First: `SEI` was
executed to protect a critical section and the matching `CLI` never
ran, so interrupts stay masked: timers, raster IRQs and
keyboard scans all stop without an error. Second: the IRQ vector at $0314–$0315
was overwritten with a corrupt address; the CPU vectors there on the
next interrupt, executes garbage, and loops or crashes. Third: a
runaway IRQ handler overflows the 6510's hardware stack (page $01,
$0100–$01FF). Each IRQ entry pushes 3 bytes (PC + P); a handler that
never returns or a cascade of nested IRQs fills the stack, wraps to
$01FF, and corrupts CPU state.

**Diagnosis steps:**
1. Attach vice-mcp, halt execution, and read the CPU P register. If
   bit 2 is set, interrupts are masked; look for the last `SEI` in
   the instruction stream.
2. Read $0314 (low byte) and $0315 (high byte) of the IRQ vector. Jump
   to that address in the disassembler and confirm it contains a
   plausible handler sequence ending in `RTI`.
3. Read the CPU stack pointer (S register) and inspect $0100 + S
   through $01FF. If S is close to $00 the stack is near overflow.
4. Read $D01A bit 0 (VIC raster IRQ enable) and $DC0D bits 0-1
   (CIA1 timer A/B IRQ enable) to confirm at least one interrupt
   source is enabled.

Ensure every `SEI` is paired with a `CLI` before any blocking loop or
`RTS`. Never call KERNAL routines like `CHKIN` or `CHKOUT` with
interrupts disabled: they loop on IEC bus signals and deadlock.
Write the IRQ vector as an atomic pair with interrupts disabled. For
stack overflow, reduce handler nesting depth and prevent IRQ re-entry.

---

## wrong_music_tempo — Music plays too fast or too slow

**Likely causes:** pal_ntsc_tempo_mismatch, cia_timer_misconfigured
**Diagnosis steps:** Read $DC04/$DC05 (CIA1 Timer A low/high bytes) — on PAL the canonical frame timer value is $4CC7; on NTSC it is $42C6; detect region by reading $D012 after writing known $D011 values or by measuring frame length; check $DC0E bit 0 (timer A running) and bit 3 (one-shot vs continuous).
**Caused by registers:** D012
**Caused by techniques:** sid_play_routine_pattern, sid_voice_setup

Music is off-tempo: notes hold too long or too short, and the
overall BPM differs from the intended tempo by approximately 4% or by
a small fixed ratio. All three SID voices are affected equally.

The cause is a CIA timer value hard-coded for PAL running on
an NTSC machine (or vice versa). CIA1 Timer A drives most SID players:
a PAL timer value of $4CC7 (19,655 cycles) on an NTSC machine fires
every 19.2 ms instead of 20.1 ms, 3.8% too fast. SID players that
use the VIC raster IRQ for timing are affected too: PAL produces
50 frames/sec, NTSC ~60 frames/sec, a 20% difference that puts the
music far off on the wrong region.

**Diagnosis steps:**
1. Read $DC04/$DC05 at program startup before the player init runs.
   Compare against $4CC7 (PAL) or $42C6 (NTSC) to determine what the
   timer was set to.
2. Detect the running region: read $D011 with $1B, then poll $D012 and
   time how many CIA1 timer ticks elapse between values $F8 and $00
   (the raster wrap). PAL counts ~19656 cycles; NTSC ~17095.
3. Confirm $DC0E bit 0 is 1 (timer running) and bit 3 is 0 (continuous
   mode). One-shot mode causes the timer to stop after the first tick.
4. Check whether the player uses the raster IRQ path vs the CIA timer
   path, as the fix differs.

For a player that uses CIA1 Timer A, read the region at startup (or
accept it as a config byte) and set the timer low/high bytes
accordingly: PAL → `LDA #$C7 / STA $DC04 / LDA #$4C / STA $DC05`;
NTSC → `LDA #$C6 / STA $DC04 / LDA #$42 / STA $DC05`. For raster-
driven players, maintain two separate tempo tables and index them by
the detected region, or time all notes in absolute CPU cycles rather
than frame counts.

---

## music_silence — SID writes occur but no sound is produced

**Likely causes:** master_volume_zero, voice_gate_never_set, filter_routing_wrong
**Diagnosis steps:** Read $D418 low nibble — must be nonzero (typically $F for max volume); read $D404/$D40B/$D412 bit 0 (GATE) — gate must be asserted to start the ADSR envelope; read $D415-$D417 filter routing; confirm the SID chip is responding by writing $D418 = $0F and listening for a faint click on the audio output.
**Caused by registers:** D418, D404, D412
**Caused by techniques:** sid_voice_setup

All three SID voices are programmed with frequencies, waveforms, and
envelope settings, but the audio output is silent: no pops,
no tones. The SID registers read back the values that were
written.

Four independent settings can each silence the SID. The most
common is $D418 low nibble = $00: the master volume DAC is at zero
and the analog output is muted regardless of what the three voices are
doing. The second is a GATE bit (bit 0 of $D404, $D40B, or $D412)
that was never set to 1: the ADSR envelope stays at zero (attack
never starts) and the voice produces no output. The third is filter
misconfiguration: if all three voices are routed through the filter
($D417 bits 0–2 all set) and $D418 selects only high-pass output on a
signal that has no high-frequency content, the result is silence. The
fourth possibility is a volume-register write that was intended to kick-
start a digi sample but left volume stuck at zero.

**Diagnosis steps:**
1. Read $D418. Low nibble must be nonzero. Write $0F and check for
   sound; if silence persists, suspect a hardware or wiring issue.
2. Read $D404 (voice 1 control), $D40B (voice 2), $D412 (voice 3).
   Bit 0 = GATE. It must be 1 for any note to start.
3. Read $D405-$D406 (voice 1 ADSR). Attack nibble = $00 → instant
   attack. If decay/sustain are also zero the note will start and
   release immediately; increase sustain.
4. Read $D415-$D417. If bits 0–2 of $D417 are all set (all voices
   through filter) and $D418 bits 4–6 select only LP/HP/BP in an
   unusual combination, bypass the filter for debugging by clearing
   $D417 bits 0–2.

Set $D418 to $0F (master volume maximum). For each voice: set
frequency ($D400/$D401 etc.), set waveform and GATE bit in the
control register ($D404 = $11 for triangle+gate, for example), then
set ADSR to reasonable values ($D405 = $09 for medium attack/decay).
If using the filter, verify that at least one filter output mode is
selected in $D418 bits 4–6 and that the cutoff ($D415–$D416) is not
fully closed ($0000 on a 6581 can attenuate heavily).

---

## sid_pop_click — Audible click between notes

**Likely causes:** hard_restart_missing, gate_release_timing
**Diagnosis steps:** Check whether a hard restart (write $00 then $08 to control register with $0F waveform to flush the accumulator) is performed before each new note; measure time between gate-off and next gate-on — minimum ~2 ms (PAL ~2000 cycles) needed for envelope to reach zero; inspect $D404/$D40B/$D412 for transition from gate=1 to gate=0 without intermediate $08 pulse.
**Caused by registers:** D404
**Caused by techniques:** sid_play_routine_pattern

A sharp click or pop is audible at the boundary between two notes, or
at the moment a gate is asserted on a new note when the previous
envelope has not fully released.

The SID ADSR hardware has a documented bug: the envelope counter
is a 15-bit accumulator, and if the rate register is updated to a
value whose compare threshold the counter has already passed, the
counter must wrap the full 15-bit range (up to 32,768 cycles, roughly
33 ms at PAL) before the new rate takes effect. When a new note's gate
is asserted before the previous release has completed, the residual
envelope level is non-zero and the new attack begins from that elevated
level, producing an audible step transient: the click. Also,
if the oscillator phase accumulator is not reset between notes, the new
tone starts from a random phase offset that can produce a click at the
note onset even when the envelope is clean.

**Diagnosis steps:**
1. In vice-mcp, set a write watchpoint on $D404 (voice 1 control).
   Step through the note-change sequence and verify the sequence is:
   gate-off ($D404 &= ~$01) → wait release → $08 pulse → new note.
2. Read $D41C (ENV3) if the failing voice is voice 3; it shows the
   live envelope value. A non-zero value at gate-on confirms the
   release was incomplete.
3. Count CPU cycles between gate-off and gate-on. For typical release
   values the envelope needs at least 1000–6000 cycles to reach zero.
4. Check whether the waveform bits change simultaneously with the gate
   assertion (writing both waveform and gate in one byte is fine; the
   issue is changing waveform to $00 which AND-mixes to zero and can
   cause a transient).

Perform a hard restart before every note: gate-off with TEST bit set
(resets phase accumulator), then gate-on with TEST clear. For voice 1:
write `waveform | $08` to $D404 (gate off, test on), then write
`waveform | $01` (test off, gate on). Allow at least 2 ms (~2000 PAL
cycles) between gate-off and gate-on for the release envelope to reach
zero before the attack begins.

---

## scroll_jitter — Scroll moves unevenly or stutters

**Likely causes:** d016_write_late, raster_irq_late_unstable, badline_overrun
**Diagnosis steps:** Read $D016 bits 0-2 (X scroll) at the raster line where the scroll write should occur; use vice-mcp raster breakpoint to verify the write arrives before the VIC fetches the first visible character column; confirm the IRQ handler cycle count is deterministic; check whether a badline falls between IRQ trigger and scroll write.
**Caused by registers:** D016
**Caused by techniques:** soft_scroll_h, stable_raster_irq

The horizontal scroll should move at a fixed rate but the
display occasionally stutters by one pixel column, or the text appears
to vibrate back and forth by one pixel. On frames that exhibit the
jitter, the scroll position is off by exactly one step.

Horizontal smooth scrolling is controlled by bits 2–0 of $D016
(X-scroll, 0–7 pixels). The VIC reads this register at the start of
each visible character row. If the CPU writes the new X-scroll value
after the VIC has already latched it for the current row, the update
takes effect one raster line late: the first row of characters scrolls
by the old value while the remaining rows use the new value. On the
next frame the timing may be correct, producing alternating one-off and
on-target positions: the jitter. Badlines make this worse because they
steal 40 cycles just as the CPU needs to be writing the scroll register,
pushing the write past the VIC's sample point.

**Diagnosis steps:**
1. Place a vice-mcp raster breakpoint on the line immediately above the
   first visible character row. Confirm the scroll write happens within
   the first few cycles of that line, well before cycle 16 where VIC
   begins character fetch.
2. Use a CIA1 timer delta measurement at IRQ entry and at the scroll
   write to confirm the handler has a fixed cycle cost. Any variation
   of more than 2 cycles is enough to cause jitter.
3. Temporarily replace the IRQ-driven scroll write with a per-frame
   spin-wait on $D012 to isolate whether the jitter is an IRQ timing
   issue or a display mode issue.
4. Check whether a badline (raster line where $D011 bits 2–0 equal the
   low three bits of the raster counter) falls between IRQ trigger and
   the scroll write.

Use the stable double-IRQ pattern: fire the first IRQ several lines
above the target, set D012 to the exact write line, and write $D016
in the second IRQ with cycle precision. Adjust the D016 write to
occur during the horizontal blank portion of the target raster line
(before cycle 16 on a PAL VIC-II) so the VIC samples the
new value for all visible rows. If a badline is unavoidable, add a
compensation of 40 cycles to the stable-IRQ entry wait loop.

---

## multicolor_wrong_color — Multicolor bitmap or sprite shows wrong palette

**Likely causes:** d020_d021_swapped, sprite_multicolor_bits_wrong
**Diagnosis steps:** For multicolor bitmap: verify $D020 (border), $D021 (background color 0), $D022 (background color 1), $D023 (background color 2), and screen-RAM high nibble (foreground) are set correctly; for multicolor sprites: read $D025 (sprite multicolor 0) and $D026 (sprite multicolor 1) and confirm $D01C bit for the sprite is set.
**Caused by registers:** D020, D021, D025, D026
**Caused by techniques:** multicolor_bitmap

Colors appear correct in terms of shape (the image is recognizable) but
the palette is shifted: the background color appears
where the foreground color should be, or sprite shared colors are
swapped, or two of the four color values are exchanged.

Multicolor character and bitmap modes use a fixed mapping between 2-bit
pixel values and color sources. In multicolor bitmap mode (Koala format)
the pixel-value-to-color mapping is: `%00` = $D021 (background
register), `%01` = screen RAM high nibble, `%10` = screen RAM low
nibble, `%11` = color RAM. A common mistake is writing the two screen-
RAM nybbles in reversed order (high nibble = foreground, low nibble =
background, but the values are swapped in memory). For multicolor
sprites, `%00` = transparent, `%01` = $D025 (shared color 0), `%10` =
the sprite's own color ($D027–$D02E), `%11` = $D026 (shared color 1).
Setting $D01C bit N enables multicolor for sprite N; forgetting to set
it leaves the sprite in hires mode where the 2-bit pixel values are
interpreted differently, shifting the palette.

**Diagnosis steps:**
1. For a bitmap image: compare the intended Koala color layout with
   the values at $D021, screen RAM high/low nybbles at the relevant
   cell, and color RAM at $D800 + cell offset.
2. For sprites: read $D01C. The bit for the affected sprite must be 1.
   Read $D025 and $D026 and compare against the sprite's intended
   shared colors.
3. Convert the on-screen color index to decimal and look up the C64
   color value table. The most common mistake is confusing the color
   index (0–15) with a register address.
4. Use vice-mcp to read a single cell's screen RAM word and color RAM
   byte and trace which color value maps to which pixel pattern.

For Koala bitmaps: pack the screen RAM byte as `(color_1 << 4) | color_2`
where color_1 is the `%01` value and color_2 is the `%10` value. Use
a consistent reference (C64Wiki color chart) for the 4-bit color
indices 0–15. For multicolor sprites, ensure $D01C has the correct bit
set before the sprite appears, and load $D025/$D026 before enabling
sprites ($D015). Check the sprite color registers: sprite 0's own
color is $D027, sprite 1's is $D028, etc.; these are separate from
$D025/$D026 which are shared across all multicolor sprites.

---

## dim_colors_on_8580 — Output is visibly dimmer on 8580 than on 6581

**Likely causes:** filter_chip_variation, voice_3_silent_bit_difference
**Diagnosis steps:** Read $D418 — on the 8580, bit 7 (voice 3 mute) works differently; the 8580 filter cutoff curve is linear vs 6581's sigmoidal, so verify $D415-$D416 cutoff values produce the intended open-filter response; check whether SID digi playback uses volume-register writes calibrated for the 6581's non-linear DAC response.
**Caused by registers:** D418
**Caused by techniques:** sid_8580_vs_6581_differences

Audio output is quieter on a C64C or late-model machine
(which uses the 8580 SID) than on an earlier machine (6581). The tones
are recognizable but the overall level is lower and some filter effects
sound different. On high-filter-cutoff settings the signal may
disappear entirely on the 8580.

The 6581 and 8580 differ in three ways. First, the filter
cutoff curve: on the 6581 it is highly non-linear and varies between
chips; a cutoff value that opens the filter wide on one 6581 may have
almost no effect on another. The 8580 has a linear curve. A code path
tuned for 6581 filter behavior will produce a different tonal character
on the 8580. Second, the 8580 DAC for digi playback ($D418 used as a
PWM DAC) has a different step size than the 6581, making samples sound
clipped or too quiet. Third, the 8580's combined-waveform output
levels differ from the 6581's; timbres that work on one may be muted
on the other.

**Diagnosis steps:**
1. Confirm the target SID revision: read the environment configuration
   or detect it from a filter-response difference
   (write $D415/$D416 = $00/$00 and check audio: on 6581 this fully
   closes the filter; on 8580 the cutoff minimum is different).
2. Read $D415-$D416 and compute the cutoff frequency. If the value was
   tuned for the 6581's non-linear curve, recalibrate for the 8580's
   linear response.
3. Check $D418 bit 7. On the 8580, voice 3 is not truly muted by this
   bit in the same way; routing behavior differs. Verify that voice 3
   is not unexpectedly contributing to or stealing from the mix.
4. If digi playback is used, test the volume-register write range: on
   the 6581 the effective range for PWM digi is ~$00–$0F with a
   roughly usable midpoint around $08; on the 8580 the step size is
   lower and the effective range may require different scaling.

Maintain per-chip filter-cutoff tuning tables and detect the chip at
runtime using the filter-response heuristic. For music that must sound
identical on both chips, avoid filter-heavy patches and rely on pure
waveforms (sawtooth, pulse, triangle). For digi playback, ship separate
sample scaling factors for each chip variant.

---

## intermittent_load_crash — Load works most of the time but crashes occasionally

**Likely causes:** fastloader_kernal_dependency, gcr_timing_drift
**Diagnosis steps:** Confirm the fastloader protocol is exiting via the KERNAL UNLISTEN/UNTALK path before returning to user code; check whether the crash occurs only at specific disk sectors (suggesting a GCR timing edge case); test with the KERNAL fastloader disabled (switch to $37 memory map) to isolate whether the crash is in the custom loader or the KERNAL I/O path; count crashes per 100 loads as a timing-sensitivity metric.
**Caused by kernal:** LOAD
**Caused by techniques:** krill_loader_integration, sparkle_irq_loader

The program loads correctly on 9 out of 10 attempts but occasionally
hangs mid-load, crashes to BASIC, or corrupts a small region of the
loaded data. The failure is not reproducible at a specific sector,
which points to a timing-sensitive race rather than a data error.

The C64's IEC bus is software-timed: both the drive and the C64
measure bit timing in CPU cycles rather than via a hardware UART. Any
loss of CPU time (an NMI, a raster IRQ or a badline)
can corrupt a bit. Fastloaders that push the bus to 3× or 4× KERNAL
speed have very narrow windows; an interrupt firing on a critical
bit edge drops the bit. GCR decoding adds further sensitivity: off-
spec drive timing from head wear can miss a sync mark and begin
decoding at the wrong byte boundary, producing sporadic
corruption.

**Diagnosis steps:**
1. Disable all IRQs during the load phase (`SEI` before entering the
   loader, `CLI` after) and retest. If crashes stop, an IRQ is
   interfering with the timing loop.
2. Log the C64-side byte count at crash time across 20 runs. Consistent
   crash positions (within ±2 bytes) point to a specific sector or
   block boundary; random positions point to IRQ interference.
3. Switch from the fastloader to the KERNAL LOAD routine ($FFD5) and
   retest. If stability improves, the custom loader has a timing margin
   issue.
4. On a real disk setup, try a known-good diskette and compare crash
   rates; GCR drift is drive-specific.

Disable the KERNAL's CIA1 interrupt by reading $DC0D (ICR acknowledge)
before entering the time-critical receive loop, and re-enable it on
exit. Widen timing windows where the protocol allows; most fastloaders
have a configurable bit-cell width. If crashes correlate with a sector
boundary, add a retry at sector level. For Krill or Sparkle (IRQs
enabled during load), verify the installed IRQ handler never calls any
KERNAL I/O routine.

---

## garbled_only_in_irq — Code works at top level but corrupts data inside IRQ

**Likely causes:** decimal_mode_in_irq_handler, register_not_saved
**Diagnosis steps:** Check whether the mainline code uses BCD (SED instruction); inspect the IRQ handler prologue for PHA/TXA/PHA/TYA/PHA and corresponding epilogue; look for JSR to a subroutine inside the IRQ that modifies zero-page variables shared with mainline; confirm the IRQ returns via RTI not RTS.
**Caused by techniques:** decimal_mode_pitfalls

Code that runs correctly in the main loop produces wrong results or
corrupts variables when invoked from inside an IRQ handler. The bug is
not present when interrupts are disabled, and disabling interrupts
temporarily at the point of failure makes it disappear.

Two mechanisms produce this symptom. The first is
decimal mode: the 6510 does not automatically clear the decimal flag (D
bit of P) on IRQ entry, unlike the 65C02. If the main program uses BCD
arithmetic (`SED` / `CLD`) and an IRQ fires while the D flag is set,
all arithmetic inside the handler operates in BCD: `ADC` and `SBC`
produce Binary Coded Decimal results rather than binary results. A
handler that adds a frame counter or adjusts a position variable will
silently produce wrong values on every frame after the first `SED` in
the main loop. The second mechanism is register contamination: a
handler that modifies A, X, Y, or zero-page variables without saving
and restoring them returns to the main loop with a corrupted CPU state.
Code that looks correct in isolation fails only when the handler fires
at a sensitive moment in the main loop.

**Diagnosis steps:**
1. At the very start of the IRQ handler, read the CPU P register via
   vice-mcp and check bit 3 (D flag). If it is set when the IRQ fires,
   the main program left decimal mode active.
2. Step through the IRQ handler prologue and confirm the sequence
   `PHA / TXA / PHA / TYA / PHA` (save A, X, Y) appears before any
   register modification.
3. Check all JSR targets called from inside the handler for zero-page
   side effects. Any write to a ZP location that the mainline reads
   is a potential corruption point.
4. Verify the handler ends with `PLA / TAY / PLA / TAX / PLA / RTI` in
   that exact order, and that it is `RTI` (not `RTS` which does not
   restore P).

Add `CLD` as the first instruction of every IRQ handler before any
arithmetic; one cycle removes the whole decimal-mode class. Save
and restore all used registers in the prologue/epilogue. Subroutines
called from inside the handler must also preserve all registers they
use. For zero-page variables shared between main and IRQ, write to a
shadow copy inside the handler and swap buffers from the main loop at
a known-safe point.
