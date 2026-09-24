---
recipe: sid-detect
toolchain: oscar64
output_format: PRG
region: both
techniques: [sid_8580_vs_6581_differences]
file_formats: [PRG]
uses_registers: [D011, D012, D020, D40E, D40F, D412, D41B]
uses_kernal: [CHROUT]
claims: [sid_voice_3 (owns)]
harness: [$02F0-$02F1]
---

<!-- doc-type: recipe -->

# Oscar64 6581 or 8580: the `$D41B` Probe

## Synopsis

A program can tell which SID it runs on by one read. Voice 3 is set to
TEST with frequency `$FFFF`, then to sawtooth alone, and `$D41B` is read
4 cycles later: in VICE x64sc's reSID a 6581 reads `$03` and an 8580
`$02`. The probe waits for raster line 255 first, so no badline can stop
the CPU between the store and the read. The result is printed, shown as
the border colour (light blue 6581, green 8580, red neither) and stored
at `$02F0` (verdict) and `$02F1` (the byte read). The measurement needs a
sound sink: with `+sound`, VICE does not run the SID and the read is
noise. This supplies the detection named in `sid_8580_vs_6581_differences`
(`docs/techniques/music-sid.md`).

## Source

```c
// sid-detect.c
//
// Tell a 6581 from an 8580 by reading voice 3's oscillator right after the
// TEST bit is released. The two chips restart the sawtooth accumulator
// differently, so the byte at $D41B differs. The result goes on screen, in
// the border colour (light blue 6581, green 8580, red neither) and at $02F0
// for a harness.
//
#include <c64/vic.h>
#include <stdio.h>

static char osc;                  // the $D41B byte read by the probe
volatile char * const Result = (volatile char *)0x02f0;

// The probe in assembly, so the read follows the $20 store by a fixed
// 4 cycles (one LDA abs): TEST, GATE and every waveform set with the
// frequency at $FFFF, then sawtooth alone. It first waits for raster line
// 255, below the display, so no badline or sprite fetch can stop the CPU
// between the store and the read.
static void sid_probe(void)
{
	__asm {
		sei
	w1:	lda $d011               // line 255 has bit 8 clear; skip 256-311
		bmi w1
		lda #$ff
	w2:	cmp $d012
		bne w2
		lda #$ff
		sta $d412               // voice 3 control: TEST set, all waveforms
		sta $d40e               // voice 3 frequency $FFFF
		sta $d40f
		lda #$20
		sta $d412               // sawtooth only, TEST released
		lda $d41b               // oscillator 3, read at once
		sta osc
		lda #$00
		sta $d412               // voice 3 silent again
		cli
	}
}

int main(void)
{
	sid_probe();
	Result[1] = osc;

	char verdict;
	if (osc == 3)
		verdict = 1;              // 6581
	else if (osc == 2)
		verdict = 2;              // 8580
	else
		verdict = 0;
	Result[0] = verdict;

	vic.color_border = verdict == 1 ? VCOL_LT_BLUE : verdict == 2 ? VCOL_GREEN : VCOL_RED;
	printf("SID PROBE: $D41B = %02X\n", osc);
	printf(verdict == 1 ? "6581\n" : verdict == 2 ? "8580\n" : "NOT RECOGNISED\n");

	for (;;)
		;
	return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=sid-detect.prg sid-detect.c
```

Run with a sound sink. The pinned run adds
`-sound -sounddev dump -soundarg /dev/null`, which works under `-warp`;
`+warp -sound -sounddev wav -soundarg out.wav` records in real time and
gives the same reads (`docs/runtime/vice-reference.md`, "Recording the SID
output").

## Expected output

The KERNAL start-up text, then `SID PROBE: $D41B = 02` and `8580` with a
green border on the default PAL machine (C64C: VIC-II 8565, SID 8580), and
`SID PROBE: $D41B = 03` and `6581` with a light blue border on NTSC
(6567R8, 6581). Screenshots: `screenshots/sid-detect.png` (PAL),
`screenshots/sid-detect-ntsc.png` (NTSC).

### Measured

VICE x64sc 3.10, reSID, a store trace on `$02F0`-`$02F1`:

| Machine | Sound | `$D41B` | Verdict |
|---|---|---|---|
| default PAL (8580) | dump sink | `$02` | 8580 |
| `-model c64` (6581) | dump sink | `$03` | 6581 |
| `-model ntsc` (6581) | dump sink | `$03` | 6581 |
| default PAL, `-model c64`, `-model ntsc` | WAV sink, real time | `$02`, `$03`, `$03` | 8580, 6581, 6581 |
| default PAL, `-model c64` | `+sound` | `$D9`, `$D9` | not recognised |
| `-model ntsc` | `+sound` | `$C5` | not recognised |

With `+sound` the byte also changed between builds of the same probe
(`$48` and `$57` in an earlier build), so no threshold can be set on it.

### The byte counts cycles

With the frequency at `$FFFF` the accumulator's top byte gains about one
per cycle once TEST is released. Extra `NOP`s between the `$20` store and
the read, dump sink:

| Delay after the store | 8580 | 6581 (`-model c64` and `-model ntsc`) |
|---|---|---|
| 4 cycles (the listing) | `$02` | `$03` |
| 6 | `$04` | `$05` |
| 8 | `$06` | `$07` |
| 12 | `$0A` | `$0B` |
| 20 | `$12` | `$13` |
| 36 | `$22` | `$23` |

At every delay the 6581 reads one more than the 8580. The two values are
therefore a property of this instruction sequence, not constants of the
chips: a probe written another way must be measured again. The reason the
6581 is one ahead is not established here.

A stall between the store and the read changes the delay. The same probe
without the raster wait, run 1,000 times from different points in the
frame (dump sink), read the usual value 998 times on PAL and 992 times on
NTSC; the rest were wrong. With the wait, 1,000 of 1,000 on both.

## Why this works

### Only the oscillator is readable

`$D41B` is the top 8 bits of voice 3's waveform output and `$D41C` its
envelope; both come before the filter, so the filter differences between
the chips cannot be read by software (`docs/hardware/sid-reference.md`).
What differs early enough to read is how the oscillator restarts after
TEST. Setting TEST holds the accumulator at zero; clearing it lets it
count again at `$FFFF` a cycle, and the sawtooth output is the
accumulator's top bits.

### Fixed timing

Everything that moves the read by a cycle moves the answer by one: the
`LDA abs` after the `STA`, an interrupt, a badline, a sprite fetch. So the
probe runs with `sei`, waits for line 255 (below the display on both
machines, no badline, no sprites here), and keeps the store and the read
adjacent. The result is only compared with `$02` and `$03`; anything else
is reported as not recognised rather than guessed.

### Real chips

Measured in reSID only. Whether a real 6581 and 8580 read these two values
with this sequence is not measured here, and chips vary (`sidasid_emulation_notes`).
Offer the player a setting as well, as `sid_8580_vs_6581_differences` says.
