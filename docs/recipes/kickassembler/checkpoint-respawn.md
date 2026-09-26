---
recipe: checkpoint-respawn
toolchain: kickassembler
output_format: PRG
region: both
techniques: [checkpoint_respawn]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD0E, DD0F]
uses_kernal: []
claims: [zero_page $FB-$FE (owns)]
harness: [cia2_timer_a, cia2_timer_b, vic_raster_irq, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler — Checkpoint respawn: restart row, cleared pool, re-spawned window, grenades topped up

## Synopsis

A level whose map row counts down from 160 as the player advances, a
five-entry checkpoint table, an eight-slot object pool fed by an event
list keyed by row, and the respawn routine that runs after a death. The
program plays to three death rows (110, 40, and 20, which is itself a
checkpoint), and after each prints the restart row, the pool before and
after the respawn, the next event to fire, the grenades before and after,
and the respawn's cycles on the CIA2 timers. A 63-byte record of those
values is compared with one from a Python model of the same rules:
`$02FF = $01` and a green border when they match, `$02` and red
otherwise. The technique is `checkpoint_respawn` in `techniques/logic.md`.

## Source

```asm
// checkpoint-respawn.asm
// Checkpoint respawn on a row-counted scrolling level. The level's map
// row counts down from 160 as the player advances. A five-entry
// ascending checkpoint table gives the restart rows. After a death:
// restart at the first checkpoint >= the current row (the nearest one
// behind), free every pool slot, pre-spawn the events whose rows lie in
// the visible window [row, row + 22], set the event cursor to the first
// event past the window, and top the grenades up to 5.
//
// Three deaths are simulated, at rows 110, 40 and 20 (20 is itself a
// checkpoint). Before and after each respawn the pool is printed as the
// event row each slot holds ("---" = free), with the restart row, the
// next event row, the grenades and the respawn's cycles on the CIA2
// timers. At the end a 63-byte record is compared with a compiled-in
// expected record: $02FF = $01 and a green border when they match, $02
// and red otherwise.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN    = $0400
.const RESULT    = $02ff         // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02
.const LINE      = 40

.const START_ROW = 160           // the area's first row; rows count down
.const WINDOW    = 22            // rows on screen below the current row
.const NCKPT     = 5
.const POOL      = 8
.const FULL      = 5             // grenades after a respawn, at least
.const NSCENE    = 3
.const REC       = 21            // record bytes per death
.const FREE      = $ff           // a free slot in the record
.const NEV       = 26            // events in the list

.const src = $fb                 // zero-page pointer: string source
.const dst = $fd                 // zero-page pointer: screen destination

// ---------------------------------------------------------------- respawn
// respawn: row holds the row the player died on.
respawn:
    ldx #0                       // 1. first checkpoint >= row
!:  lda ckpt,x
    cmp row
    bcs !found+
    inx
    cpx #NCKPT
    bne !-
    lda ckpt + NCKPT - 1         // past the last entry: the area start
!found:
    sta row

    lda #0                       // 2. free every pool slot
    ldx #POOL - 1
!:  sta slot_type,x
    dex
    bpl !-

    lda row                      // 3. pre-spawn the visible window
    clc
    adc #WINDOW
    sta limit
    ldx #0
!skip:                           // events below the window stay dead
    cpx #NEV
    beq !done+
    lda limit
    cmp ev_row,x                 // C clear: ev_row > limit
    bcs !spawn+
    inx
    bne !skip-
!spawn:
    lda ev_row,x
    cmp row
    bcc !done+                   // ev_row < row: the next event to fire
    jsr spawn_event
    inx
    cpx #NEV
    bne !spawn-
!done:
    stx cursor                   // 4. the spawn cursor

    lda gren                     // 5. top up, never take away
    cmp #FULL
    bcs !+
    lda #FULL
    sta gren
!:  rts

// spawn_event: event X into the first free slot; dropped if none.
// Keeps X.
spawn_event:
    ldy #0
!:  lda slot_type,y
    beq !free+
    iny
    cpy #POOL
    bne !-
    rts
!free:
    lda ev_type,x
    sta slot_type,y
    lda ev_row,x
    sta slot_row,y
    rts

// step_row: the scroll moves one row on. Slots whose row has left the
// window are freed; events whose row is the new row fire.
step_row:
    dec row
    lda row
    clc
    adc #WINDOW
    sta limit
    ldy #POOL - 1
!:  lda slot_type,y
    beq !next+
    lda limit
    cmp slot_row,y               // C clear: slot_row > limit
    bcs !next+
    lda #0
    sta slot_type,y
!next:
    dey
    bpl !-
    ldx cursor
!fire:
    cpx #NEV
    beq !+
    lda ev_row,x
    cmp row
    bne !+
    jsr spawn_event
    inx
    bne !fire-
!:  stx cursor
    rts

nothing:
    rts

// ---------------------------------------------------------------- timing
// Time(routine, slot): CIA2 timer A counts phi2, timer B counts A
// underflows; the count lands in slot. Screen blanked, interrupts off.
.macro Time(routine, slot) {
    lda #$51
    sta $dd0f
    lda #$11
    sta $dd0e
    jsr routine
    lda #$00
    sta $dd0e
    sta $dd0f
    sec
    lda #$ff
    sbc $dd04
    sta slot
    lda #$ff
    sbc $dd05
    sta slot+1
}

// ---------------------------------------------------------------- main
start:
    sei
    ldx #0
    lda #$20
!:  sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $300,x
    inx
    bne !-

    lda #<SCREEN
    sta dst
    lda #>SCREEN
    sta dst+1
    ldy #0
    lda #<title
    ldx #>title
    jsr print_str
    jsr next_line
    ldy #0
    lda #<ckpt_txt
    ldx #>ckpt_txt
    jsr print_str
    ldx #0
!:  stx idx
    lda ckpt,x
    jsr print_dec3
    iny
    ldx idx
    inx
    cpx #NCKPT
    bne !-
    jsr next_line
    jsr next_line

    lda $d011                    // screen off, then wait for the raster
    and #$ef                     // to wrap: no badlines while timing
    sta $d011
!:  lda $d011
    bpl !-
!:  lda $d011
    bmi !-
    lda #$00
    sta $dd0e
    sta $dd0f
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07
    Time(nothing, base)

    lda #START_ROW               // area start: the same entry as a
    sta row                      // respawn, from the start row
    lda #FULL
    sta gren
    jsr respawn

    lda #0
    sta scene
    sta recp
scene_loop:
    ldx scene
!:  lda row                      // play on to the death row
    cmp death_row,x
    beq !+
    jsr step_row
    ldx scene
    jmp !-
!:  lda gren                     // grenades thrown or picked up
    clc
    adc gren_delta,x
    sta gren

    ldx recp                     // record: death row, grenades, old pool
    lda row
    sta record,x
    lda gren
    sta record + 1,x
    txa
    clc
    adc #2
    tax
    jsr snap_pool

    Time(respawn, cyc)
    sec
    lda cyc
    sbc base
    sta cyc
    lda cyc+1
    sbc base+1
    sta cyc+1

    ldx recp                     // record: restart, next event, new pool,
    lda row                      // grenades
    sta record + 10,x
    lda #FREE
    ldy cursor
    cpy #NEV
    beq !+
    lda ev_row,y
!:  sta record + 11,x
    lda gren
    sta record + 20,x
    txa
    clc
    adc #12
    tax
    jsr snap_pool

    jsr print_scene

    lda recp
    clc
    adc #REC
    sta recp
    inc scene
    lda scene
    cmp #NSCENE
    beq !+
    jmp scene_loop
!:
    lda $d011
    ora #$10
    sta $d011

    ldx #NSCENE * REC - 1        // verdict
!:  lda record,x
    cmp expect,x
    bne fail
    dex
    bpl !-
    lda #CODE_PASS
    sta RESULT
    lda #5
    sta BORDER
    lda #<pass_txt
    ldx #>pass_txt
    jmp verdict
fail:
    lda #CODE_FAIL
    sta RESULT
    lda #2
    sta BORDER
    lda #<fail_txt
    ldx #>fail_txt
verdict:
    pha
    lda #<(SCREEN + 36)
    sta dst
    lda #>(SCREEN + 36)
    sta dst+1
    ldy #0
    pla
    jsr print_str
    jmp *

// snap_pool: the eight slots' rows into record,x.. (FREE if free).
snap_pool:
    ldy #0
!:  lda #FREE
    pha
    lda slot_type,y
    beq !+
    pla
    lda slot_row,y
    pha
!:  pla
    sta record,x
    inx
    iny
    cpy #POOL
    bne !--
    rts

// print_scene: four lines from the record at recp, then a blank line.
print_scene:
    ldy #0
    lda #<death_txt
    ldx #>death_txt
    jsr print_str
    ldx recp
    lda record,x
    jsr print_dec3
    lda #<restart_txt
    ldx #>restart_txt
    jsr print_str
    ldx recp
    lda record + 10,x
    jsr print_dec3
    lda #<next_txt
    ldx #>next_txt
    jsr print_str
    ldx recp
    lda record + 11,x
    jsr print_dec3
    jsr next_line

    ldy #0
    lda #<old_txt
    ldx #>old_txt
    jsr print_str
    lda recp
    clc
    adc #2
    jsr print_pool
    jsr next_line

    ldy #0
    lda #<new_txt
    ldx #>new_txt
    jsr print_str
    lda recp
    clc
    adc #12
    jsr print_pool
    jsr next_line

    ldy #0
    lda #<gren_txt
    ldx #>gren_txt
    jsr print_str
    ldx recp
    lda record + 1,x
    jsr print_dec3
    lda #<to_txt
    ldx #>to_txt
    jsr print_str
    ldx recp
    lda record + 20,x
    jsr print_dec3
    lda #<cyc_txt
    ldx #>cyc_txt
    jsr print_str
    jsr print_cycles
    jsr next_line
    jmp next_line

// print_pool: eight record bytes from offset A, each as three digits
// and a space.
print_pool:
    sta idx
    lda #POOL
    sta cnt
!:  ldx idx
    lda record,x
    jsr print_dec3
    iny
    inc idx
    dec cnt
    bne !-
    rts

// ---------------------------------------------------------------- print
// print_str: zero-terminated string at A (lo) / X (hi) to (dst),y.
print_str:
    sta src
    stx src+1
    ldx #0
!:  lda (src,x)
    beq !+
    sta (dst),y
    iny
    inc src
    bne !-
    inc src+1
    bne !-
!:  rts

// print_dec3: A as three decimal digits, or "---" for FREE.
print_dec3:
    cmp #FREE
    bne !+
    lda #$2d
    sta (dst),y
    iny
    sta (dst),y
    iny
    sta (dst),y
    iny
    rts
!:  ldx #$30                     // hundreds
!:  cmp #100
    bcc !+
    sbc #100
    inx
    bne !-
!:  pha
    txa
    sta (dst),y
    iny
    pla
    ldx #$30                     // tens
!:  cmp #10
    bcc !+
    sbc #10
    inx
    bne !-
!:  pha
    txa
    sta (dst),y
    iny
    pla
    ora #$30                     // ones
    sta (dst),y
    iny
    rts

// print_cycles: cyc (16 bits) as five decimal digits.
print_cycles:
    ldx #0
!digit:
    lda #$2f
    sta digit
!sub:
    inc digit
    sec
    lda cyc
    sbc pow10_lo,x
    pha
    lda cyc+1
    sbc pow10_hi,x
    bcc !stop+
    sta cyc+1
    pla
    sta cyc
    jmp !sub-
!stop:
    pla
    lda digit
    sta (dst),y
    iny
    inx
    cpx #5
    bne !digit-
    rts

// next_line: dst += 40.
next_line:
    clc
    lda dst
    adc #LINE
    sta dst
    bcc !+
    inc dst+1
!:  rts

// ---------------------------------------------------------------- data
// Checkpoint rows, ascending. The last is the area start.
ckpt:       .byte 20, 56, 92, 128, 160

// The event list, sorted by trigger row, descending: an event fires on
// the frame its row becomes the current row.
ev_row:     .byte 158, 152, 147, 141, 136, 130, 124, 119, 114, 108, 103, 97, 90
            .byte 84, 77, 70, 63, 58, 51, 45, 38, 31, 25, 19, 12, 6
ev_type:    .fill NEV, 1 + mod(i, 3)

// Three deaths: the row, and the grenades used (-) or picked up (+)
// since the last respawn.
death_row:  .byte 110, 40, 20
gren_delta: .byte <(-3), <(-1), 2

// Expected record, from a Python model of the same rules: per death the
// death row, grenades, pool before (8), restart row, next event row,
// pool after (8), grenades after.
expect:
    .byte 110, 2, 130, 124, 119, 114, FREE, FREE, FREE, FREE
    .byte 128, 124, 147, 141, 136, 130, FREE, FREE, FREE, FREE, 5
    .byte 40, 4, 45, FREE, 58, 51, FREE, FREE, FREE, FREE
    .byte 56, 51, 77, 70, 63, 58, FREE, FREE, FREE, FREE, 5
    .byte 20, 7, 25, FREE, 38, 31, FREE, FREE, FREE, FREE
    .byte 20, 19, 38, 31, 25, FREE, FREE, FREE, FREE, FREE, 7

pow10_lo:   .byte <10000, <1000, <100, <10, <1
pow10_hi:   .byte >10000, >1000, >100, >10, >1

title:       .text "CHECKPOINT RESPAWN"
             .byte 0
ckpt_txt:    .text "CHECKPOINTS "
             .byte 0
death_txt:   .text "DEATH "
             .byte 0
restart_txt: .text " RESTART "
             .byte 0
next_txt:    .text " NEXT "
             .byte 0
old_txt:     .text "OLD "
             .byte 0
new_txt:     .text "NEW "
             .byte 0
gren_txt:    .text "GRENADES "
             .byte 0
to_txt:      .text " TO "
             .byte 0
cyc_txt:     .text " CYCLES "
             .byte 0
pass_txt:    .text "PASS"
             .byte 0
fail_txt:    .text "FAIL"
             .byte 0

// ---------------------------------------------------------------- state
row:        .byte 0
limit:      .byte 0
cursor:     .byte 0
gren:       .byte 0
scene:      .byte 0
recp:       .byte 0
idx:        .byte 0
cnt:        .byte 0
digit:      .byte 0
base:       .word 0
cyc:        .word 0
slot_type:  .fill POOL, 0
slot_row:   .fill POOL, 0
record:     .fill NSCENE * REC, 0
```

## Build

```bash
java -jar "$KICKASS_JAR" checkpoint-respawn.asm -o checkpoint-respawn.prg
```

## Expected output

A green border (`$02FF = $01`) and this text on the blue screen, rows 0
to 16 (`screenshots/checkpoint-respawn.png`, PAL;
`screenshots/checkpoint-respawn-ntsc.png`, NTSC):

```
CHECKPOINT RESPAWN                  PASS
CHECKPOINTS 020 056 092 128 160

DEATH 110 RESTART 128 NEXT 124
OLD 130 124 119 114 --- --- --- ---
NEW 147 141 136 130 --- --- --- ---
GRENADES 002 TO 005 CYCLES 00549

DEATH 040 RESTART 056 NEXT 051
OLD 045 --- 058 051 --- --- --- ---
NEW 077 070 063 058 --- --- --- ---
GRENADES 004 TO 005 CYCLES 00743

DEATH 020 RESTART 020 NEXT 019
OLD 025 --- 038 031 --- --- --- ---
NEW 038 031 025 --- --- --- --- ---
GRENADES 007 TO 007 CYCLES 00740
```

`OLD` is the pool at the death, one field per slot, the row of the event
the slot holds; `NEW` is the pool after the respawn. The second death
shows slot reuse: slot 1 was freed when its enemy left the window and
not yet refilled.

Verified in VICE x64sc 3.10 (PAL c64c: 8565/8580/8521, and `ntsc`,
6567R8), 4,000,000 cycles, pinned in `runs.json`. Measured with PIL: the
border pixel at (2, 100) is (98, 213, 50) on PAL and (114, 189, 103) on
NTSC, palette index 5 on each; every text cell of rows 0 to 24, decoded
against `chargen-901225-01.bin` with the screen's most common colour as
background (PAL text origin y = 35, NTSC y = 23), reads the block above,
with rows 17 to 24 blank. Both models print the same cycle counts; the
timing runs with the screen off, so no badline and no model difference
enters it. With one expected byte changed (the third restart's pool
entry 25 made 24), the same run shows `FAIL` and a red border, (175,
60, 88) on PAL.

## Why this works

The restart row is one compare per checkpoint: `cmp row` sets carry when
the entry is at least the row, so the first entry with carry set is the
nearest checkpoint behind (step 1 of `respawn`). A death on a checkpoint
row restarts on that row, as the third death shows.

The pre-spawn scan is what keeps the replayed stretch full. The event
list is sorted by row, descending, and `step_row` fires an event only
when its row equals the current row, so after the restart the cursor
must point at the first event below the restart row, and the events
already inside the 22-row window must be put in the pool by hand. The
scan does both in one pass: it skips events whose row is above
`restart + 22`, spawns those in the window, and stops at the first
below the restart row. After the death at 110 the four events at rows
147 to 130 are back and event 124, which had fired before the death,
fires again once the player reaches it.

The grenade top-up compares and raises only (`bcs` past the store when
the count is already 5 or more), which is why the third death keeps 7.
The respawn cost is the scan: 549 cycles with 2 events skipped, 743
with 14 skipped and 4 spawned, 740 with 20 skipped and 3 spawned. The
figures are the CIA2 count less the harness's cost of timing an empty
call (`base`).
