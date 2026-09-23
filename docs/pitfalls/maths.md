---
category: maths
---

<!-- doc-type: pitfall-reference -->

# Maths Pitfalls

Pitfalls in the arithmetic a game does on the 6510: tables built by the assembler or the compiler, and the shift-and-subtract loops that stand in for the divide the CPU does not have. Each one passes a small test and fails on the input the test did not reach, and each figure below was measured in VICE x64sc 3.10 with KickAssembler 5.25 and Oscar64 unless it says otherwise.

---

## sine_table_peak_wraps_to_zero — A sine table of amplitude 128 about 128 peaks at 256, which .fill and a char cast wrap to 0

**Severity:** medium
**Region:** both
**Triggered by techniques:** table_generation, sine_table_generation
**Mitigated by techniques:** table_generation

### Symptom

A sprite, a scroller row or a raster bar driven from an unsigned sine table sweeps smoothly up to the top of its range, then for seven consecutive frames sits at the other end of it (value 0, which for a sprite's Y is the top of the screen), then carries on as if nothing had happened. The other half of the swing is fine. The table's range is 0 to 255, as intended, and a glance at the first few entries shows nothing wrong, because the fault is only in the entries around the peak.

### Mechanism

The natural way to write an unsigned table centred on 128 is `128 + 128 * sin`, which reaches 256 at the peak. `sin` is within 0.0039 of 1.0 for seven of the 256 angles (entries 61 to 67), and for every one of them `round(128 + 128 * sin)` is 256. KickAssembler's `.fill` emits the low byte of the value and reports nothing; Oscar64's `(char)` cast of the same expression truncates modulo 256 and reports nothing. Both wrote `$00` for entries 61 to 67, and the two tables were identical byte for byte (measured: the assembled PRG and the Oscar64 map's data segment, then the running machine's memory through the monitor). The trough is not affected, because `128 - 128` is a legitimate 0 (entries 189 to 195 are `$00` on purpose), so the table looks like it spans the whole byte and the missing top is easy to miss.

`round` with amplitude 127.5 is not a repair on its own. `128 + 127.5 * sin` is exactly 255.5 at entry 64, which rounds to 256 and wraps to 0 for that one entry; the neighbours are `$FF`. The two forms on the technique page avoid this: `floor(128 + 127.5 * sin)` never exceeds 255, and `128 + round(127 * sin)` peaks at 255 and troughs at 1, symmetric about 128. The `sine_table_generation` route produces its byte as `128 + round(y)` with an amplitude constant of 127 for the same reason; an amplitude of 128 in its starting value would carry out of the byte at the peak by the same arithmetic (not measured here).

The slope gives a test that needs no reference table. A sine of amplitude 128 changes by at most `128 * 2 * pi / 256`, which is 3.14 per entry (arithmetic), so after rounding no two neighbours in a correct table differ by more than 4. Measured: the largest step in the wrapped table is 255 (entry 60 is `$FF`, entry 61 is `$00`); in `128 + round(127 * sin)` and in `floor(128 + 127.5 * sin)` it is 4.

On the machine the fault is one screenshot. A program that writes `50 + entry / 2` to sprite 0's Y register once a frame, stopped on the frame after entry `$40`, shows the sprite at raster lines 50 to 70 with the wrapped table and at lines 177 to 197 with the amplitude-127 table, the same program with one table name changed.

`table_generation` is on both metadata lines because the fault is the obvious form of its table and its listed scalings cure it.

### Fix

Use one of the two scalings the technique page lists, and pick by what the reader needs. `floor(128 + 127.5 * sin)` uses the whole byte, 0 to 255, and is the same bytes as an Oscar64 `(char)(128 + 127.5 * sin(i * PI / 128))` with no `+ 0.5`. `128 + round(127 * sin)` gives 1 to 255 and is the one to use when a quarter-wave unfold or an on-machine generator has to reproduce it exactly. In C, add the `0.5` inside the cast only with amplitude 127. Whatever the scaling, check the assembled bytes once: the largest difference between neighbours must not exceed 4 for amplitude 128 or less, and the peak entries (61 to 67) must not be `$00`.

### Worked example

```asm
// BAD: 128 + 128 * sin reaches 256 at the peak; .fill keeps the low byte.
sin_bad:    .fill 256, round(128 + 128 * sin(toRadians(i * 360 / 256)))

// STILL BAD: 255.5 at entry 64 rounds to 256 and wraps that one entry.
sin_r1275:  .fill 256, round(128 + 127.5 * sin(toRadians(i * 360 / 256)))

// GOOD: floor form, 0..255, same bytes as an Oscar64 (char) cast.
sin_f1275:  .fill 256, floor(128 + 127.5 * sin(toRadians(i * 360 / 256)))

// GOOD: rounded amplitude 127, 1..255, symmetric about 128.
sin_r127:   .fill 256, 128 + round(127 * sin(toRadians(i * 360 / 256)))

// Slope check at run time: a step above 4 means a wrapped entry.
            ldx #0
check:      lda sin_r127 + 1,x
            sec
            sbc sin_r127,x
            bcs !+
            eor #$ff            // absolute value of the step
            adc #1
!:          cmp #5
            bcs wrapped
            inx
            cpx #255            // 255 steps inside the table
            bne check
            rts
wrapped:    inc $d020           // a step of 255 lands here
            rts
```

Measured bytes, read from the running machine with the monitor's `m` command after the tables were assembled at `$2000`, `$2100`, `$2300` and `$2200`; Oscar64's `(char)(128 + 128 * sin(i * PI / 128) + 0.5)` and its two twins gave the same 256 bytes each:

```text
entry        3C 3D 3E 3F 40 41 42 43 44     BC BD BE BF C0 C1 C2 C3 C4
sin_bad      FF 00 00 00 00 00 00 00 FF     01 00 00 00 00 00 00 00 01
sin_r1275    FF FF FF FF 00 FF FF FF FF     01 01 01 01 01 01 01 01 01
sin_f1275    FE FF FF FF FF FF FF FF FE     01 00 00 00 00 00 00 00 01
sin_r127     FE FF FF FF FF FF FF FF FE     02 01 01 01 01 01 01 01 02

largest |step| between neighbours: sin_bad 255, sin_r1275 255,
sin_f1275 4, sin_r127 4 (slope bound for amplitude 128: 3.14, arithmetic)
sprite Y = 50 + entry/2 on the frame after entry $40:
sin_bad lines 50..70 (top of the screen), sin_r127 lines 177..197
```

### Cross-references

- Technique `table_generation` (`docs/techniques/cpu-cycle-tricks.md`) lists the scalings, the `.fill` wrap-around and the Oscar64 constant folder that produce these bytes.
- Technique `sine_table_generation` (`docs/techniques/cpu-cycle-tricks.md`) builds the amplitude-127 table on the machine and depends on it being symmetric.
- `docs/recipes/kickassembler/sine-scroller.md`, `dycp-scroller.md` and `cracktro-template.md` use small amplitudes with `round` and cannot reach 256; the shape `MID + round(AMP * sin)` wraps only when `MID + AMP` exceeds 255.

---

## division_loop_missing_ninth_bit_guard — A shift-and-subtract divide with a dividend wider than its divisor drops the remainder's top bit without a BCS after ROL

**Severity:** high
**Region:** both
**Triggered by techniques:** division_8_16bit, atan2_8bit
**Mitigated by techniques:** division_8_16bit

### Symptom

A 16-bit by 8-bit divide gives quotients that are too small, often 0, and remainders that are wrong with them, but only for divisors of `$81` and above. Every test with a small divisor passes, and so does an exhaustive 8-bit by 8-bit test, so the loop ships. In the recipe's own sweep over all 65,536 dividends, the loop without the guard was wrong 24,400 times; `256 / 255` came out as 0 remainder 0.

### Mechanism

Each pass of the loop doubles the remainder and shifts in the next dividend bit, then compares the result with the divisor. Before the shift the remainder is below the divisor; after it the remainder is at most twice the divisor less one, which needs nine bits when the divisor is above 128. `rol rem` puts that ninth bit in the carry. A loop that goes straight to `lda rem / cmp dvs` compares only the low eight bits, which are below the divisor, so it skips the subtract, leaves the quotient bit 0 and carries a wrong remainder into every later pass. The guarded form, `bcs` straight to the `sbc` after the `rol`, handles it: a nine-bit remainder is at least any eight-bit divisor, and `rol` left the carry set, which is what `sbc` needs.

The bit can appear only when the loop has already consumed more dividend bits than the divisor is wide. After `k` passes the remainder is below `2^k` as well as below the divisor, so it can reach 128 only from the ninth pass on. An 8-bit dividend has eight passes; a 16-bit dividend against a 16-bit divisor needs a remainder of `$8000` or more before the shift, which would take a seventeenth pass. Measured with the recipe `divide-check.md` rebuilt with all three of its `bcs` guards deleted: `8/8 ALL` still passes with 0 misses over its 65,280 pairs, `16/16 SWEEP` still passes with 0 misses over its 21,845 pairs, and `16/8 ALL` fails with 24,400 misses and checksum `4223` against the expected `BBC4`. A host model of the guardless loop gives the same 24,400. The threshold is a divisor of `$81`, not `$80`: at `$80` the remainder before the shift is at most `$7F` and doubles to at most `$FF`, and the model has 0 misses over all 65,536 dividends there. The technique page and the recipe used to say the loop is wrong "for every divisor of `$80` (8-bit) or `$8000` (16-bit) and above" and that the 16/16 loop needs the seventeenth bit; both were corrected on the strength of this measurement, which puts the fault in the 16/8 shape alone and its threshold one higher.

`division_8_16bit` is on both metadata lines because the fault is its loop with one instruction removed and its listed loop is the cure. `atan2_8bit` is on the trigger line because its `ratio_div` is written without the guard: it is safe there, since its divisor is at most 128, and the entry says so, but the loop is the guardless shape and a copy of it with a larger divisor inherits the fault.

### Fix

Keep the `bcs` that follows `rol rem`, and point it straight at the `sbc`, not at the `cmp`; the carry is already set on that path so no `sec` is needed. In the 16/16 and 8/8 forms the instruction costs two cycles a pass and never branches, so it may be dropped when the widths are equal; in the 16/8 form it is not optional. A loop whose divisor cannot exceed 128 by construction, such as `atan2_8bit`'s ratio of a smaller magnitude over a larger one no bigger than 128, may also omit it. `isqrt_16bit`'s loop compares without a carry guard too; its remainder never exceeds 1,019 in a 16-bit register, so the question does not arise there (arithmetic from the technique text; not measured here).

### Worked example

```asm
// BAD: 16/8 divide without the ninth-bit guard. Right for divisors up
// to $80, wrong for 24,400 of the 65,536 dividends in the recipe's sweep.
div16_8_bad:
        lda #0
        sta rem
        ldx #16
loop_b: asl dvd
        rol dvd + 1
        rol rem             // the carry is the remainder's ninth bit
        lda rem
        cmp dvs             // compares eight bits only
        bcc next_b
        sbc dvs
        sta rem
        inc dvd
next_b: dex
        bne loop_b
        rts

// GOOD: the bcs takes a nine-bit remainder straight to the subtract.
div16_8:
        lda #0
        sta rem
        ldx #16
loop:   asl dvd
        rol dvd + 1
        rol rem
        lda rem
        bcs sub             // nine bits: at least any 8-bit divisor
        cmp dvs
        bcc next
sub:    sbc dvs             // carry set on both paths
        sta rem
        inc dvd
next:   dex
        bne loop
        rts
```

Measured on the machine, results read with the monitor after both loops ran on the same pairs (quotient then remainder, hex):

```text
pair          with bcs      without bcs   true
$0100 / $FF   0001 r 01     0000 r 00     0001 r 01
$8100 / $FF   0081 r 81     0000 r 00     0081 r 81
$8080 / $81   00FF r 01     0000 r 80     00FF r 01
$0100 / $81   0001 r 7F     0000 r 00     0001 r 7F
$FFFF / $80   01FF r 7F     01FF r 7F     01FF r 7F   (at the threshold, safe)

same-width loops without their bcs, same run:
$FF / $80     01 r 7F       01 r 7F       (8/8)
$FFFF / $8000 0001 r 7FFF   0001 r 7FFF   (16/16)
$C000 / $9000 0001 r 3000   0001 r 3000   (16/16)

divide-check.md with every bcs deleted, screen read from the PNG:
8/8 ALL     CHK 7122 EXP 7122 PASS     0
16/8 ALL    CHK 4223 EXP BBC4 FAIL 24400
16/16 SWEEP CHK 6DA5 EXP 6DA5 PASS     0
```

### Cross-references

- Technique `division_8_16bit` (`docs/techniques/maths.md`) is the guarded 16/8 loop; an earlier version of its text said the 8/8 and 16/16 forms need the guard as well, and the measurement above is why it no longer does.
- Technique `atan2_8bit` (`docs/techniques/maths.md`) and `docs/recipes/kickassembler/sqrt-atan2.md`, whose `ratio_div` omits the guard because its divisor is at most 128.
- Technique `isqrt_16bit` (`docs/techniques/maths.md`), a restoring loop of the same family whose 16-bit remainder has room to spare.
- `docs/recipes/oscar64/divide-check.md`, the sweep whose miss counts are quoted here; its `16/8 ALL` row is the one that catches the fault.
