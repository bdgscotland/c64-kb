---
recipe: sprite-slot-parking
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sprite_slot_parking]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D011, D012, D015, D017, D019, D01A, D01C, D01D, D020, D021, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, DC0D, DD04, DD05, DD0D, DD0E]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), cia2_timer_b (init), cia2_tod (init)]
harness: [cia2_timer_a]
ram: [colour=$D800-$DBE7]
devices: []
---

<!-- doc-type: recipe -->

# KickAssembler — Sprite Slot Parking: Sixteen Virtual Sprites, Six Parked, No "In Use" Test in the IRQs

## Synopsis

Sixteen virtual sprites on the eight hardware sprites, ten in use and six
parked. A parked slot points at a blank shape, sits at X = 356 in the right
border and keeps a fixed Y (`PARK_Y`, 0 here). The sort and the three raster
parts treat all sixteen alike, so no IRQ code tests whether a slot is in use
and each group write costs the same every frame. Before the display starts,
CIA2 timer A times the group write with and without an "in use" test, and
the results are printed on screen. Use it as the slot policy for a game
multiplexer whose slot count is fixed (`sprite_slot_parking` in
`techniques/sprite.md`).

## Source

```asm
// sprite-slot-parking.asm
// Sixteen virtual sprites on eight hardware sprites, ten in use and six
// parked. A parked slot keeps a blank shape, X = 356 (in the right
// border) and Y = PARK_Y. The sort and the three raster parts treat all
// sixteen alike: no IRQ code tests whether a slot is in use, so every
// group write costs the same whatever is on screen.
//
// Before the display starts, CIA2 timer A times the routines with the
// screen off (no badlines, no sprite DMA) and the results are printed
// in hex on rows 19-24.

.const PARK_Y  = 0            // parked slots sort to the top and leave the
                              // frame before the first real sprite
.const PARK_X  = 356          // right border on PAL and NTSC
.const BALL    = $2000 / 64   // pointer $80
.const BLANK   = $2040 / 64   // pointer $81: 64 zero bytes
.const LINE_A  = 250          // part A: below every sprite, above line 263
.const SCREEN  = $0400
.const PTRS    = SCREEN + $3f8

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Shapes: a filled ball and the blank block every parked slot points at.
// ---------------------------------------------------------------------------
* = $2000 "shapes"
    .byte $00,$7e,$00, $01,$ff,$80, $03,$ff,$c0, $07,$ff,$e0, $0f,$ff,$f0
    .byte $1f,$ff,$f8, $3f,$ff,$fc, $3f,$ff,$fc, $7f,$ff,$fe, $7f,$ff,$fe
    .byte $7f,$ff,$fe, $7f,$ff,$fe, $7f,$ff,$fe, $3f,$ff,$fc, $3f,$ff,$fc
    .byte $1f,$ff,$f8, $0f,$ff,$f0, $07,$ff,$e0, $03,$ff,$c0, $01,$ff,$80
    .byte $00,$7e,$00, $00
    .fill 64, 0                // BLANK

// ---------------------------------------------------------------------------
// Slot tables: sixteen bytes each, all inside page $30, so no abs,y load
// ever crosses a page and every load costs 4 cycles.
// Slot:              0   1   2   3    4   5   6   7   8   9  10   11   12  13   14  15
// ---------------------------------------------------------------------------
* = $3000 "slots"
active:  .byte        1,  1,  0,  1,   1,  0,  1,  0,  1,  1,  0,   1,   1,  0,   1,  0
ys:      .byte       50, 80,  0, 86, 130,  0, 56,  0, 92, 98,  0, 140, 160,  0, 175,  0
base_lo: .byte       40, 40,  0,110,  60,  0,200,  0,180,250,  0, 200, 120,  0,<280,  0
base_hi: .byte        0,  0,  0,  0,   0,  0,  0,  0,  0,  0,  0,   0,   0,  0,>280,  0
col:     .byte        2,  3,  1,  4,   5,  1,  7,  1,  8, 10,  1,  13,  14,  1,  15,  1
speed:   .byte        1,  2,  1,  3,   2,  1,  1,  1,  2,  3,  1,   1,   3,  1,   2,  1
phase:   .fill 16, i * 16
xlo:     .fill 16, 0
xhi:     .fill 16, 0          // $00 or $FF: ANDed with the sprite's bit
ptr:     .fill 16, 0
order:   .fill 16, i          // sorted slot numbers; kept from frame to frame
backup:  .fill 16, 0
msb:     .byte 0
en:      .byte 0
en_out:  .byte 0
flag:    .byte 0
s_key:   .byte 0
s_keyy:  .byte 0
s_j:     .byte 0
res_lo:  .byte 0
res_hi:  .byte 0
cal:     .byte 0

* = $3100 "sine"
sine:    .fill 256, round(20 + 20 * sin(toRadians(i * 360 / 256)))

// ---------------------------------------------------------------------------
// One sorted entry to one hardware sprite: 50 cycles, no test.
// ---------------------------------------------------------------------------
.macro WriteEntry(e, s) {
    ldy order + e
    lda ys, y
    sta $d001 + 2 * s
    lda xlo, y
    sta $d000 + 2 * s
    lda ptr, y
    sta PTRS + s
    lda col, y
    sta $d027 + s
    lda xhi, y
    and #(1 << s)
    ora msb
    sta msb
}

// Entries first..first+n-1 to sprites sfirst..; keep = $D010 bits to keep.
.macro WriteGroup(first, sfirst, n, keep) {
    .if (keep != 0) {
        lda $d010
        and #keep
    } else {
        lda #0
    }
    sta msb
    .for (var i = 0; i < n; i++) {
        WriteEntry(first + i, sfirst + i)
    }
    lda msb
    sta $d010
}

// The same entry with an "in use" test, for the measurement only. A
// skipped sprite would keep its last shape, so the test version must also
// build a $D015 mask; it stores it to en_out, not $D015, so the timed run
// stays free of sprite DMA.
.macro WriteEntryTest(e, s) {
    ldy order + e
    lda active, y
    beq skip
    lda ys, y
    sta $d001 + 2 * s
    lda xlo, y
    sta $d000 + 2 * s
    lda ptr, y
    sta PTRS + s
    lda col, y
    sta $d027 + s
    lda xhi, y
    and #(1 << s)
    ora msb
    sta msb
    lda en
    ora #(1 << s)
    sta en
skip:
}

* = $0810 "code"
start:
    sei
    lda #$7f
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #0
    sta $d015
    sta $d020
    sta $d021
    sta $d017
    sta $d01d
    sta $d01c
    lda #$0b                 // DEN off: no badlines once line $30 passes
    sta $d011
!:  bit $d011                // wait for line 256+, then for line 0
    bpl !-
!:  bit $d011
    bmi !-

    jsr init_slots
    jsr move
    jsr sort
    jsr measure

    jsr show_results
    lda #$ff
    sta $d015
    lda #<part_a
    sta $0314
    lda #>part_a
    sta $0315
    lda #$1b
    sta $d011
    lda #LINE_A
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli

main:
    lda flag                 // set by part C, after the last group
    beq main
    lda #0
    sta flag
    jsr move
    jsr sort
    jmp main

// ---------------------------------------------------------------------------
// Park every slot not in use. A game calls park when an object dies.
// ---------------------------------------------------------------------------
init_slots:
    ldx #15
!:  lda #BALL
    sta ptr, x
    lda active, x
    bne !+
    jsr park
!:  dex
    bpl !--
    rts

park:                        // X = slot
    lda #BLANK
    sta ptr, x
    lda #<PARK_X
    sta xlo, x
    lda #$ff                 // X bit 8 set: 356 = $164
    sta xhi, x
    lda #PARK_Y
    sta ys, x
    rts

// ---------------------------------------------------------------------------
// Move: only slots in use. The main loop may branch; the IRQs never do.
// ---------------------------------------------------------------------------
move:
    ldx #15
mv_loop:
    lda active, x
    beq mv_next
    lda phase, x
    clc
    adc speed, x
    sta phase, x
    tay
    lda sine, y
    clc
    adc base_lo, x
    sta xlo, x
    lda base_hi, x
    adc #0
    beq !+
    lda #$ff
!:  sta xhi, x
mv_next:
    dex
    bpl mv_loop
    rts

// ---------------------------------------------------------------------------
// Insertion sort of order[] by ys[], ascending, from last frame's order.
// Parked slots are sorted like any other.
// ---------------------------------------------------------------------------
sort:
    ldx #1
s_outer:
    lda order, x
    sta s_key
    tay
    lda ys, y
    sta s_keyy
    stx s_j
    ldy s_j
s_inner:
    ldx order - 1, y
    lda ys, x
    cmp s_keyy
    beq s_place
    bcc s_place
    txa
    sta order, y
    dey
    bne s_inner
s_place:
    lda s_key
    sta order, y
    ldx s_j
    inx
    cpx #16
    bne s_outer
    rts

// ---------------------------------------------------------------------------
// The three group writes, shared by the IRQ parts and the measurement.
// ---------------------------------------------------------------------------
write_a:    WriteGroup(0, 0, 8, 0)          // entries 0-7  -> sprites 0-7
            rts
write_b:    WriteGroup(8, 0, 4, $f0)        // entries 8-11 -> sprites 0-3
            rts
write_c:    WriteGroup(12, 4, 4, $0f)       // entries 12-15 -> sprites 4-7
            rts

write_a_test:
    lda #0
    sta msb
    sta en
    .for (var i = 0; i < 8; i++) {
        WriteEntryTest(i, i)
    }
    lda msb
    sta $d010
    lda en
    sta en_out
    rts

// ---------------------------------------------------------------------------
// Raster parts. No overload check: a sprite whose line has passed when its
// group is written is not drawn this frame.
// ---------------------------------------------------------------------------
part_a:                      // line 250
    jsr write_a
    ldy order + 3            // sprites 0-3 are free once entry 3 has ended
    lda ys, y
    clc
    adc #22
    sta $d012
    lda #<part_b
    sta $0314
    lda #>part_b
    sta $0315
    lda #$01
    sta $d019
    jmp $ea81

part_b:                      // line Y(entry 3) + 22
    jsr write_b
    ldy order + 7            // sprites 4-7 are free once entry 7 has ended
    lda ys, y
    clc
    adc #22
    sta $d012
    lda #<part_c
    sta $0314
    lda #>part_c
    sta $0315
    lda #$01
    sta $d019
    jmp $ea81

part_c:                      // line Y(entry 7) + 22
    jsr write_c
    lda #1
    sta flag
    lda #LINE_A
    sta $d012
    lda #<part_a
    sta $0314
    lda #>part_a
    sta $0315
    lda #$01
    sta $d019
    jmp $ea81

// ---------------------------------------------------------------------------
// Measurement: CIA2 timer A counts down from $FFFF across one JSR. The cost
// of an empty JSR/RTS is subtracted, so each figure is the routine's body.
// ---------------------------------------------------------------------------
measure:
    lda #<empty
    ldx #>empty
    jsr time_it
    lda res_lo
    sta cal
    lda #<write_a
    ldx #>write_a
    jsr time_it
    ldx #0
    jsr keep
    lda #<write_a_test
    ldx #>write_a_test
    jsr time_it
    ldx #2
    jsr keep
    ldx #15                  // the test version again with every slot in use
!:  lda active, x
    sta backup, x
    lda #1
    sta active, x
    dex
    bpl !-
    lda #<write_a_test
    ldx #>write_a_test
    jsr time_it
    ldx #4
    jsr keep
    ldx #15
!:  lda backup, x
    sta active, x
    dex
    bpl !-
    lda #<write_b
    ldx #>write_b
    jsr time_it
    ldx #6
    jsr keep
    lda #<sort
    ldx #>sort
    jsr time_it
    ldx #8
    jsr keep
    ldx #15                  // worst case: 16 distinct Ys in reverse order
!:  lda ys, x
    sta backup, x
    txa
    sta ys, x                // ys[x] = x
    eor #$0f
    sta order, x             // order[x] = 15 - x: largest Y first
    dex
    bpl !-
    lda #<sort
    ldx #>sort
    jsr time_it
    ldx #10
    jsr keep
    ldx #15
!:  lda backup, x
    sta ys, x
    dex
    bpl !-
    jsr sort                 // back to the real order
    rts

keep:                        // results[x] = res - cal
    lda res_lo
    sec
    sbc cal
    sta results, x
    lda res_hi
    sbc #0
    sta results + 1, x
    rts

time_it:
    sta jv + 1
    stx jv + 2
    lda #$ff
    sta $dd04
    sta $dd05
    lda #%00010001           // load $FFFF and start, continuous
    sta $dd0e
jv: jsr empty
    lda #0
    sta $dd0e                // stop
    lda #$ff
    sec
    sbc $dd04
    sta res_lo
    lda #$ff
    sbc $dd05
    sta res_hi
empty:
    rts

results: .fill 12, 0

// ---------------------------------------------------------------------------
// Screen: black, six labelled hex results on rows 19-24.
// ---------------------------------------------------------------------------
show_results:
    ldx #0
!:  lda #$20
    sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $2e8, x
    lda #1
    sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $dae8, x
    inx
    bne !-
    ldx #0
!:  lda labels, x
    sta SCREEN + 19 * 40, x
    inx
    cpx #240
    bne !-
    .for (var r = 0; r < 6; r++) {
        PrintHex(results + 2 * r + 1, SCREEN + (19 + r) * 40 + 32)
        PrintHex(results + 2 * r, SCREEN + (19 + r) * 40 + 34)
    }
    rts

.macro PrintHex(src, dst) {
    lda src
    lsr
    lsr
    lsr
    lsr
    tay
    lda digits, y
    sta dst
    lda src
    and #$0f
    tay
    lda digits, y
    sta dst + 1
}

digits: .text "0123456789abcdef"
labels: .text "group a, no test                        "
        .text "group a, test, 6 of 8 parked            "
        .text "group a, test, 0 of 8 parked            "
        .text "group b, no test                        "
        .text "sort of 16                              "
        .text "sort of 16, reversed                    "
```

## Build

```bash
java -jar KickAss.jar sprite-slot-parking.asm -o sprite-slot-parking.prg
```

`-showmem`: code `$0810-$10EF`, shapes `$2000-$207F`, slot tables
`$3000-$30C9`, sine `$3100-$31FF`. The slot tables must stay inside one
page: a load that crosses a page costs 5 cycles, not 4, and the group
write would no longer be constant.

## Expected output

Verified in VICE x64sc 3.10, PAL (C64C: 8565, 8580, 8521) and NTSC
(6567R8), 8,000,000 cycles; screenshots `screenshots/sprite-slot-parking.png`
and `screenshots/sprite-slot-parking-ntsc.png`. A PIL script found in each:

- Ten sprites in ten colours, the ten slots in use, and nothing else. Top
  rows at lines 51, 57, 81, 87, 93, 99, 131, 141, 161 and 176: Y 50, 56,
  80, 86, 92, 98, 130, 140, 160 and 175, each 21 lines tall. The six
  parked slots draw nothing.
- White text on rows 19-24, decoded against the character ROM:

| Row | Routine timed | Hex | Cycles |
|---|---|---|---|
| 19 | group A (8 entries), no test | `019E` | 414 |
| 20 | group A with the test, 6 of 8 entries parked | `00E1` | 225 |
| 21 | group A with the test, 0 of 8 entries parked | `022A` | 554 |
| 22 | group B (4 entries), no test | `00DA` | 218 |
| 23 | insertion sort of 16, list already in order | `03C5` | 965 |
| 24 | insertion sort of 16 distinct Ys in reverse order | `103B` | 4,155 |

Row 24 is the sort's worst case: `measure` sets Y = slot number and the
order to 15 down to 0, times the sort, then restores the Ys and sorts
again. An earlier version of this recipe timed only the in-order sort, and
the technique's Cost line left the sort out.

PAL and NTSC print the same figures: the screen is off while they are
taken. Each figure is the routine's body; the empty JSR/RTS is subtracted.

The figures match the listing's cycle counts. An entry without the test is
50 cycles (`LDY`, four load/store pairs, then `LDA`/`AND`/`ORA`/`STA` for
the `$D010` bit): 6 + 8 × 50 + 8 = 414, and 10 + 4 × 50 + 8 = 218 for group
B. With the test, an entry in use is 66 cycles (4 + 4 + 2 for the test, 10
more for the `$D015` mask) and a parked one 11: 10 + 8 × 66 + 16 = 554, and
10 + 6 × 11 + 2 × 66 + 16 = 224, measured 225 because one taken branch
crosses a page.

### The pitfall, measured

With `PARK_Y = 90`, inside the band where the sprites at Y 80-98 live,
the same program shows 4 or 6 of the 10 sprites, never all 10. Shots 0, 1,
2 and 3 frames after the pinned one (8,000,000, 8,019,656, 8,039,312 and
8,058,968 cycles, PAL) alternate between the four at Y 50-86 and the six at
Y 92-175. The six parked entries sort between the real ones. They take
sprites 4-7 in group A and entries 8-9 in group B, which pushes the
sprites at Y 92 and 98 to entries 10 and 11. Part B fires at
Y(entry 3) + 22 = 86 + 22 = 108, after both have started, so they are
lost. Part B arms part C for Y(entry 7) + 22 = 112, a parked entry at 90;
line 112 has passed by the time part B's writes end, so part C runs at
line 112 of the next frame and part A at line 250 after it. From then on
one frame shows the sprites part A wrote and the next the sprites parts B
and C wrote, alternately. Nothing in the code checks either case.

## Why this works

### A parked slot is a real sprite nobody can see

The IRQ parts copy the sorted entries into the hardware registers in
fixed groups: entries 0-7 to sprites 0-7 at line 250, entries 8-11 to
sprites 0-3 at Y(entry 3) + 22, entries 12-15 to sprites 4-7 at Y(entry 7)
+ 22. They never ask whether an entry is in use. A parked entry is written
like any other and the VIC-II draws it: 21 lines of a blank shape at
X = 356, under the right border (screenshot x 364; the border starts at
x 352). `$D015` stays `$FF` all frame.

### Where the parked entries sort

At Y 0 the six parked entries sort first. They fill entries 0-5, draw
their blank shape on lines 1-21 of the next frame, and part B fires at
line 0 + 22 = 22, long before the first real sprite at Y 80 that group B
serves. The real sprites move up the list: the two highest go in group A,
four in group B, four in group C. Parking at a Y where nothing else lives
is what makes this free; the pitfall run above shows the cost of the
opposite.

### What the test would cost

Skipping a parked entry is not enough on its own: the hardware sprite
would keep whatever the previous group wrote into it. A correct skip must
also clear the sprite's `$D015` bit, and group B and C would then have to
merge `$D015` mid-frame while the other sprites are drawing. The test
version here builds that mask (and stores it to a spare byte, so the
timed run stays free of sprite DMA). Group A then costs 225 to 554 cycles
depending on what is in use, against a constant 414 without the test: 16
cycles saved on every entry in use, 39 lost on every parked entry, and 140
saved in the worst case, which is the one an IRQ part has to be scheduled
for.

Those are instruction cycles only. A parked sprite is enabled, so the
VIC-II still fetches it on its 21 lines and stalls the CPU; a skip that
clears its `$D015` bit does not. In a probe build (not this listing) one
parked sprite at Y 0 cost 105 cycles a frame of DMA on PAL and six cost
358 (`sprite_slot_parking` in `techniques/sprite.md` has the figures).
Counting that, the skip takes fewer cycles as soon as one entry is parked;
parking's gain is the constant IRQ cost and no mid-frame `$D015` merge.
An earlier version of this section compared instruction cycles alone.

### Region

`region: both`. Every line used is below 251, inside NTSC's 263. X = 356
is under the right border on both models, and outside PAL's undrawn
`$1F8-$1FF` (`sprite_x_range_hidden_and_seam` in `pitfalls/sprite.md`).
