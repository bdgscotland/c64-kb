---
recipe: sprite-multiplex-game
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sprite_multiplex_game, ram_under_kernal]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D017, D019, D01A, D01B, D01C, D01D, D020, D021, D027, DC0D, DD04, DD05, DD06, DD07, DD0D, DD0E, DD0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Game Sprite Multiplexer With Its Own Timings

## Synopsis

Twenty-four actors move on their own paths and are shown with eight
hardware sprites. The main loop sorts them by Y every frame with an
insertion sort that keeps last frame's order, builds the sorted sprite
table into the half the IRQs are not reading, and marks it ready. A frame
IRQ at line 252 swaps the halves and writes the first eight sprites; zone
IRQs further down reuse the slots, each zone writing every sprite whose Y
is within four lines of its first. When a zone ends so close to the next
one that the raster is already within three lines of it, the handler runs
the next zone at once instead of returning. The program times its own
sort, build and IRQs with the two CIA2 timers and prints them in the top
four text rows, with a count of the times and frames the late guard fired.
Use it as the display half of a game with more than eight moving objects.
The technique is `sprite_multiplex_game` in `docs/techniques/sprite.md`.
It banks the KERNAL out and puts its IRQ and NMI handlers in `$FFFE` and
`$FFFA`, which is `ram_under_kernal` (`docs/techniques/memory-banking.md`).
An earlier version's `techniques:` omitted `ram_under_kernal`; the
`scripts/claims-watch.ts` store trace found the `$FFFE`/`$FFFA` writes (#35).

Verified in VICE x64sc 3.10 on PAL and NTSC, measured with PIL: every one
of the 24 actors shows in its own column in both pinned shots and all 16
swept shots. In the pinned shots each is one whole 21-line box. In 9
swept shots some boxes are split at the line where the exit screenshot
cut the frame.

## Source

```asm
// sprite-multiplex-game.asm
// A game-style sprite multiplexer: 24 actors on independent paths, sorted
// by Y every frame with a persistent insertion sort, built into one half
// of a double-buffered sorted table while the IRQs show the other half,
// and displayed through zone IRQs that each set up one or more sprites.
// The program times its own sort and its own IRQs with the two CIA2
// timers and prints the figures in the top four text rows.
//
// Each actor has its own X column (X = 24 + 13*i), so a missing actor is
// an empty column. Actors 18-23 are past X=255 and need $D010.
//
// Region: both. KERNAL and BASIC are banked out; the IRQ vector is $FFFE.

.const N          = 24     // actors
.const BUF        = 32     // offset of sorted buffer 1 (a multiple of 8)
.const MIN_GAP    = 21     // a reused slot's next Y must be >= its last Y + 21
.const JOIN       = 4      // sprites within 4 lines of a zone's first join it
.const LEAD       = 3      // zone IRQ line = first Y - LEAD - sprites in zone
.const MARGIN     = 3      // late guard: next line - 3 already reached? run it now
.const BOTTOM     = 252    // frame IRQ: swap buffers, write the first eight
.const TOP_Y      = 90     // path range 90..228; a sprite at Y draws Y+1..Y+21

.const SCREEN     = $0400
.const PTRS       = $07f8

// zero page
.label save_a     = $02
.label save_x     = $03
.label save_y     = $04
.label cra_save   = $05
.label next_hnd   = $06    // 2 bytes: body the next IRQ runs
.label zidx       = $08
.label zlast      = $09
.label zend_tmp   = $0a
.label front_off  = $0b    // 0 or BUF: the half the IRQs read
.label ready      = $0c    // main loop sets 1 when the back half is built
.label late_flag  = $0d
.label late_total = $0e    // 2 bytes: times the guard fell through
.label late_frms  = $10    // 2 bytes: frames with at least one fall-through
.label missed     = $12    // 2 bytes: frames shown twice (build not ready)
.label frames     = $14    // 2 bytes
.label irq_cyc    = $16    // 2 bytes: CIA2 timer B, multiplexer IRQs, one frame
.label sort_cyc   = $18    // 2 bytes: CIA2 timer A, sort of the last frame
.label sort_max   = $1a    // 2 bytes
.label calib      = $1c    // 2 bytes: timer count of an empty start/stop
.label t_stable   = $1e    // 2 bytes: startup, sort of an already sorted order
.label t_shuf     = $20    // 2 bytes: startup, order i*7 mod 24
.label t_rev      = $22    // 2 bytes: startup, reversed order
.label bo         = $24    // build: back half offset
.label acc        = $25    // build: next accepted index (absolute)
.label bk         = $26
.label by         = $27
.label d010run    = $28
.label rejects    = $29
.label zw         = $2a
.label ybase      = $2b
.label ylim       = $2c
.label zn         = $2d
.label key        = $2e
.label cand       = $2f
.label s_i        = $30
.label n16        = $31    // 2 bytes
.label tmp        = $33
.label digit      = $34
.label dst        = $35    // 2 bytes
.label t_build    = $37    // 2 bytes: startup, one build of the sorted half
.label pflip      = $39

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
* = $0820
start:
    sei
    lda #$7f
    sta $dc0d                // no CIA1 interrupts
    sta $dd0d                // no CIA2 NMIs from the timers used as counters
    lda $dc0d
    lda $dd0d
    lda #$35                 // KERNAL and BASIC out, I/O in
    sta $01
    lda #<irq_entry
    sta $fffe
    lda #>irq_entry
    sta $ffff
    lda #<nmi
    sta $fffa
    lda #>nmi
    sta $fffb

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
    sta SCREEN, x
    inx
    cpx #160
    bne !-

    lda #0
    sta $d020
    sta $d021
    sta $d017
    sta $d01d
    sta $d01c
    sta $d01b

    ldx #$2f                 // clear the zero-page variables
    lda #0
!:  sta $02, x
    dex
    bpl !-

    // CIA2 timers as cycle counters: latch $FFFF, loaded, stopped.
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07
    lda #$10
    sta $dd0e
    sta $dd0f

    // Calibration: the count of a start immediately followed by a stop.
    lda #$11
    sta $dd0e
    lda #$00
    sta $dd0e
    jsr read_a
    lda n16
    sta calib
    lda n16 + 1
    sta calib + 1

    // Startup sort timings, IRQs off, screen and sprites off: with DEN
    // clear when line $30 passes there are no badlines, so the timer
    // counts only the CPU's own cycles.
    lda #$0b
    sta $d011
    lda #0
    sta $d015
!:  lda $d012
    bne !-
!:  lda $d012
    cmp #60
    bne !-
    ldx #N - 1
!:  txa
    sta order, x
    dex
    bpl !-
    jsr move_actors
    jsr sort                 // untimed: now sorted
    jsr timed_sort           // already sorted
    lda n16
    sta t_stable
    lda n16 + 1
    sta t_stable + 1

    ldx #0                   // order = i*7 mod 24
    lda #0
!:  sta order, x
    clc
    adc #7
    cmp #N
    bcc no_wrap
    sbc #N
no_wrap:
    inx
    cpx #N
    bne !-
    jsr timed_sort
    lda n16
    sta t_shuf
    lda n16 + 1
    sta t_shuf + 1

    ldx #0                   // reverse the sorted order
    ldy #N - 1
!:  lda order, y
    sta tmp_order, x
    dey
    inx
    cpx #N
    bne !-
    ldx #N - 1
!:  lda tmp_order, x
    sta order, x
    dex
    bpl !-
    jsr timed_sort
    lda n16
    sta t_rev
    lda n16 + 1
    sta t_rev + 1

    // First frame: build half 0, show it, arm the frame IRQ.
    lda #BUF                 // so that build's back half is 0
    sta front_off
    lda #$11                 // timed like the sorts: screen still off
    sta $dd0e
    jsr build
    lda #$00
    sta $dd0e
    jsr read_a
    lda n16
    sta t_build
    lda n16 + 1
    sta t_build + 1
    lda #0
    sta front_off
    lda #<bottom_body
    sta next_hnd
    lda #>bottom_body
    sta next_hnd + 1
    jsr print_fixed
    lda #$ff
    sta $d015
    lda #$1b
    sta $d011                // screen on; bit 8 of the raster compare = 0
    lda #BOTTOM
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli

// ---------------------------------------------------------------------------
// Main loop: one pass per displayed frame.
// ---------------------------------------------------------------------------
main:
!:  lda ready                // wait until the frame IRQ took the last build
    bne !-
    jsr move_actors
    lda #$11                 // load $FFFF and start timer A
    sta $dd0e
    jsr sort
    lda #$00
    sta $dd0e                // stop
    jsr read_a
    lda n16
    sta sort_cyc
    lda n16 + 1
    sta sort_cyc + 1
    cmp sort_max + 1         // keep the largest
    bcc not_max
    bne new_max
    lda n16
    cmp sort_max
    bcc not_max
new_max:
    lda n16
    sta sort_max
    lda n16 + 1
    sta sort_max + 1
not_max:
    jsr build
    lda #1
    sta ready
    jsr print_stats
    jmp main

timed_sort:
    lda #$11
    sta $dd0e
    jsr sort
    lda #$00
    sta $dd0e
    // fall through
// read_a: n16 = $FFFF - timer A - calib, then reload the latch.
read_a:
    lda #$ff
    sec
    sbc $dd04
    sta n16
    lda #$ff
    sbc $dd05
    sta n16 + 1
    lda n16
    sec
    sbc calib
    sta n16
    lda n16 + 1
    sbc calib + 1
    sta n16 + 1
    lda #$10
    sta $dd0e
    rts

// ---------------------------------------------------------------------------
// Actors follow a 256-entry path table at their own phase and speed.
// ---------------------------------------------------------------------------
move_actors:
    ldx #N - 1
!:  lda phase, x
    clc
    adc speed, x
    sta phase, x
    tay
    lda path, y
    sta act_y, x
    dex
    bpl !-
    rts

// ---------------------------------------------------------------------------
// Persistent insertion sort: order[] keeps last frame's order, so an
// element already in place costs one compare. Ties keep their order.
// ---------------------------------------------------------------------------
.align $100                  // both loop branches stay inside one page
sort:
    ldx #1
s_loop:
    ldy order, x
    lda act_y, y
    ldy order - 1, x
    cmp act_y, y
    bcs s_next               // y[order[i]] >= y[order[i-1]]: in place
    sta key
    lda order, x
    sta cand
    stx s_i
s_shift:
    lda order - 1, x
    sta order, x
    dex
    beq s_place
    ldy order - 1, x
    lda act_y, y
    cmp key
    beq s_place
    bcs s_shift              // still greater than the key: keep shifting
s_place:
    lda cand
    sta order, x
    ldx s_i
s_next:
    inx
    cpx #N
    bne s_loop
    rts

// ---------------------------------------------------------------------------
// Build the back half: accept or reject each sorted actor, precalculate
// $D010, then group sprites 8.. into zones.
// ---------------------------------------------------------------------------
build:
    lda front_off
    eor #BUF
    sta bo
    sta acc
    lda #0
    sta d010run
    sta rejects
    ldx #0
b_loop:
    stx bk
    ldy order, x
    lda act_y, y
    sta by
    ldx acc
    txa
    sec
    sbc bo
    cmp #8
    bcc b_accept             // the first eight always fit
    lda by
    sec
    sbc sy - 8, x            // gap to the last sprite this slot showed
    cmp #MIN_GAP
    bcc b_reject
b_accept:
    lda by
    sta sy, x
    lda act_x, y
    sta sx, x
    lda act_ptr, y
    sta sptr, x
    lda act_col, y
    sta scol, x
    lda act_xh, y
    beq b_clear
    lda d010run
    ora bitm, x
    jmp b_store
b_clear:
    lda bitm, x
    eor #$ff
    and d010run
b_store:
    sta d010run
    sta sd010, x
    inx
    stx acc
    jmp b_next
b_reject:
    inc rejects
b_next:
    ldx bk
    inx
    cpx #N
    bne b_loop

    lda bo                   // zones over accepted sprites 8..acc-1
    sta zw
    clc
    adc #8
    tax
z_loop:
    cpx acc
    bcs z_done
    ldy zw
    txa
    sta zstart, y
    lda sy, x
    sta ybase
    clc
    adc #JOIN
    sta ylim
    lda #0
    sta zn
z_in:
    inx
    inc zn
    cpx acc
    bcs z_close
    lda sy, x
    cmp ylim
    bcc z_in
    beq z_in
z_close:
    txa
    sta zend, y
    lda ybase
    sec
    sbc #LEAD
    sbc zn
    sta zline, y
    inc zw
    jmp z_loop
z_done:
    ldy bo
    lda zw
    sta zlast_b, y
    lda rejects
    sta rej_b, y
    rts

// ---------------------------------------------------------------------------
// IRQ. Entry pauses timer A (so an IRQ during the sort is not counted as
// sort time, apart from the cycles before the pause) and runs timer B,
// which adds up the multiplexer's IRQ time over one frame.
// ---------------------------------------------------------------------------
irq_entry:
    sta save_a
    lda $dd0e
    and #$01
    sta cra_save
    lda #$00
    sta $dd0e                // pause the sort timer
    lda #$01
    sta $dd0f                // run the IRQ timer
    cld                      // binary arithmetic below, whatever was running
    stx save_x
    sty save_y
dispatch:
    jmp (next_hnd)

// Zone body: write every sprite of zone zidx, Y first.
zone_body:
    ldx zidx
    lda zend, x
    sta zend_tmp
    ldy zstart, x
zl:
    ldx slot2, y
    lda sy, y
    sta $d001, x
    lda sx, y
    sta $d000, x
    ldx slot, y
    lda sptr, y
    sta PTRS, x
    lda scol, y
    sta $d027, x
    lda sd010, y
    sta $d010
    iny
    cpy zend_tmp
    bne zl
    ldx zidx
    inx
    stx zidx
    cpx zlast
    beq z_to_bottom
    lda zline, x
    jmp schedule
z_to_bottom:
    lda #<bottom_body
    sta next_hnd
    lda #>bottom_body
    sta next_hnd + 1
    lda #BOTTOM
    // fall through

// schedule: A = next line. If the raster is already within MARGIN lines
// of it, run the next body now instead of returning and waiting a frame.
schedule:
    sta $d012
    sec
    sbc #MARGIN
    cmp $d012
    bcs on_time
    inc late_total
    bne !+
    inc late_total + 1
!:  lda #1
    sta late_flag
    jmp dispatch
on_time:
    lda #$01
    sta $d019
irq_exit:
    ldy save_y
    ldx save_x
    lda #$00
    sta $dd0f                // stop the IRQ timer
    lda cra_save
    sta $dd0e                // resume the sort timer if it was running
    lda save_a
nmi:
    rti

// Frame body at line BOTTOM: swap halves if a build is ready, write the
// first eight sprites of the shown half, arm the first zone.
bottom_body:
    lda ready
    beq no_swap
    lda front_off
    eor #BUF
    sta front_off
    lda #0
    sta ready
    jmp swapped
no_swap:
    inc missed
    bne swapped
    inc missed + 1
swapped:
    ldy front_off
    .for (var s = 0; s < 8; s++) {
        lda sy + s, y
        sta $d001 + s * 2
        lda sx + s, y
        sta $d000 + s * 2
        lda sptr + s, y
        sta PTRS + s
        lda scol + s, y
        sta $d027 + s
    }
    lda sd010 + 7, y
    sta $d010
    sty zidx
    lda zlast_b, y
    sta zlast
    inc frames
    bne !+
    inc frames + 1
!:  lda late_flag
    beq !+
    inc late_frms
    bne !+
    inc late_frms + 1
!:  lda #0
    sta late_flag
    sta $dd0f                // stop timer B and read one frame's IRQ time
    lda #$ff
    sec
    sbc $dd06
    sta irq_cyc
    lda #$ff
    sbc $dd07
    sta irq_cyc + 1
    lda #$10
    sta $dd0f                // reload $FFFF, stopped
    ldx zidx
    cpx zlast
    beq only_eight
    lda #<zone_body
    sta next_hnd
    lda #>zone_body
    sta next_hnd + 1
    lda zline, x
    jmp arm
only_eight:
    lda #BOTTOM
arm:
    sta $d012                // next frame: no late check across the wrap
    jmp on_time

// ---------------------------------------------------------------------------
// Statistics, printed by the main loop after each build.
// ---------------------------------------------------------------------------
.macro Print(v, col) {
    lda v
    sta n16
    lda v + 1
    sta n16 + 1
    lda #<(SCREEN + col)
    sta dst
    lda #>(SCREEN + col)
    sta dst + 1
    jsr pr16
}

// The figures fixed at startup are printed once; the live ones in two
// halves on alternate frames, so printing does not crowd out the build.
print_fixed:
    Print(t_build, 35)
    Print(t_stable, 40 + 7)
    Print(t_shuf, 40 + 18)
    Print(t_rev, 40 + 28)
    Print(calib, 120 + 30)
    rts

print_stats:
    inc pflip
    lda pflip
    and #1
    beq print_a
    Print(late_total, 80 + 5)
    Print(late_frms, 80 + 16)
    Print(frames, 120 + 7)
    Print(missed, 120 + 20)
    rts
print_a:
    Print(sort_cyc, 5)
    Print(sort_max, 15)
    Print(irq_cyc, 25)
    ldy bo                   // zones and rejects of the half just built
    lda zlast_b, y
    sec
    sbc bo
    sta n16
    lda #0
    sta n16 + 1
    lda #<(SCREEN + 80 + 25)
    sta dst
    lda #>(SCREEN + 80 + 25)
    sta dst + 1
    jsr pr16
    ldy bo
    lda rej_b, y
    sta n16
    lda #0
    sta n16 + 1
    lda #<(SCREEN + 80 + 34)
    sta dst
    lda #>(SCREEN + 80 + 34)
    sta dst + 1
    // fall through

// pr16: n16 as five decimal digits at (dst).
pr16:
    ldy #0
    ldx #0
d_loop:
    lda #$30                 // screen code of '0'
    sta digit
d_sub:
    lda n16
    sec
    sbc p10lo, x
    sta tmp
    lda n16 + 1
    sbc p10hi, x
    bcc d_out
    sta n16 + 1
    lda tmp
    sta n16
    inc digit
    jmp d_sub
d_out:
    lda digit
    sta (dst), y
    iny
    inx
    cpx #5
    bne d_loop
    rts

p10lo: .byte <10000, <1000, <100, <10, <1
p10hi: .byte >10000, >1000, >100, >10, >1

labels:
    .text "sort       max       irq       bld      "
    .text "stable       shuf       rev             "
    .text "late       lfrm       zn       rj       "
    .text "frames       missed       cal           "

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
* = $1000 "tables"
path:    .fill 256, TOP_Y + round(69 + 69 * sin(toRadians(i * 360 / 256)))
act_y:   .fill N, 0
act_x:   .fill N, (24 + 13 * i) & $ff
act_xh:  .fill N, (24 + 13 * i) >> 8
act_col: .fill N, 1 + mod(i, 15)
act_ptr: .fill N, $2000 / 64
phase:   .fill N, mod(i * 45, 256)
speed:   .fill N, (i & 3) == 3 ? $fe : 1 + (i & 3)
order:   .fill N, i
tmp_order: .fill N, 0

* = $1200 "sorted halves"
sy:      .fill 64, 0
sx:      .fill 64, 0
sptr:    .fill 64, 0
scol:    .fill 64, 0
sd010:   .fill 64, 0
zstart:  .fill 64, 0
zend:    .fill 64, 0
zline:   .fill 64, 0
zlast_b: .fill 64, 0
rej_b:   .fill 64, 0
slot:    .fill 64, i & 7
slot2:   .fill 64, (i & 7) * 2
bitm:    .fill 64, 1 << (i & 7)

// One shape: an 8-pixel-wide, 21-line block in the sprite's left byte.
* = $2000 "sprite"
    .fill 21, [$ff, $00, $00]
    .byte 0
```

## Build

```bash
java -jar KickAss.jar sprite-multiplex-game.asm -o sprite-multiplex-game.prg -showmem
```

`-showmem` prints code at $0820–$0EAA, the actor and path tables at
$1000–$11D7, the two sorted halves and the slot tables at $1200–$153F and
the sprite shape at $2000. The sort is aligned to a page (`.align $100`),
which is why the code segment has a gap.

## Expected output

A black screen. The top four text rows, in white:

```text
SORT 00750 MAX 01411 IRQ 02764 BLD 03815
STABLE 00611 SHUF 05228 REV 08783
LATE 00370 LFRM 00249 ZN 00010 RJ 00000
FRAMES 00309 MISSED 00001 CAL 00005
```

That is the PAL screenshot at 9,100,000 cycles. The NTSC one reads SORT
815, MAX 1,411, IRQ 2,608, LATE 369, LFRM 266, ZN 10, RJ 0, FRAMES 346,
MISSED 0, and the same five startup figures. The fields are:

| Field | What it counts |
|---|---|
| SORT, MAX | Cycles of this frame's sort call, and the largest so far (CIA2 timer A). |
| IRQ | Cycles inside the multiplexer IRQs over one frame (CIA2 timer B), from the timer-start write to the timer-stop write of each IRQ. |
| BLD | One build of a sorted half, timed at startup. |
| STABLE, SHUF, REV | The sort at startup on an order already sorted, on the order i×7 mod 24, and on the sorted order reversed. |
| LATE, LFRM | Times the late guard ran the next zone at once, and frames in which it did so at least once. |
| ZN, RJ | Zones and rejected actors in the half just built. |
| FRAMES, MISSED | Frame IRQs so far, and frames shown twice because the build was not ready. |
| CAL | Timer count of a start write followed at once by a stop write; every timed figure has it subtracted. |

Below the text, 24 boxes, 8 pixels wide and 21 lines tall, one per
column at sprite X = 24 + 13 × i, in colours 1–15 repeating. Actors 18–23
sit past X = 255 and need their $D010 bit. The boxes rise and fall on a
sine at different speeds and phases, so they overtake one another in Y
and the sort has work to do.

Screenshots from the VICE runs this page describes:
`screenshots/sprite-multiplex-game.png` (PAL) and
`screenshots/sprite-multiplex-game-ntsc.png` (NTSC), both at
9,100,000 cycles. Each command was run twice and gave identical bytes.

## Why this works

### What was measured

The text rows were decoded from the screenshots by matching each 8×8 cell
against the character ROM (`chargen-901225-01.bin`). The sprite check
walked each actor's column at screenshot x = 35 + 13 × i and recorded each
lit run (PAL row = raster line − 16, NTSC row = line − 28).

| Claim | Result | Rung |
|---|---|---|
| Every actor is drawn | 24 of 24 columns hold a box in both pinned shots and in 16 swept shots (PAL and NTSC, 8.1 to 9.5 million cycles, 200,000 apart) | measured in VICE x64sc |
| Boxes are whole | Pinned shots: every box is 21 lines, 8 pixels, one colour. In 9 of the 16 swept shots, 2 to 4 boxes were 18 to 26 lines long or had a 1-line fragment beside them, because the exit screenshot cut the frame there (the mid-frame effect in `docs/runtime/vice-reference.md`). The beam line at exit, (cycles mod 19,656) / 63 on PAL and (cycles mod 17,095) / 65 on NTSC, lies inside the split boxes' lines in all 9 of those shots and outside sprite lines 91 to 249 in the 7 clean ones. PAL reruns at 8,519,656 and 8,539,312 cycles (beam at line 136) split boxes at 136 again; 8,509,828 and 8,529,484 (beam at line 292) were clean | measured; the cut line predicted by arithmetic and confirmed by runs one frame apart |
| Sort, order already sorted | 611 cycles for 24 actors, JSR and RTS included. The listing gives JSR 6 + `ldx #1` 2 + 26 per compare × 23 − 1 (the last `bne` not taken) + RTS 6 = 611, which matches the measurement | measured, and arithmetic agrees |
| Same sort straddling a page | 656 cycles: both loop branches crossed a page and took 28 per compare. Hence `.align $100` | measured |
| Sort, shuffled (i×7 mod 24) | 5,228 cycles | measured |
| Sort, reversed | 8,783 cycles: 276 moves, about 29.6 cycles per place an element moves | measured |
| Sort in the running game | 611 to 953 cycles in the 16 swept shots (PAL and NTSC, 8.1 to 9.5 million cycles); largest 1,411 in the first 257 to 370 frames of each | measured |
| Build of one sorted half | 3,815 cycles | measured |
| IRQ time per frame | 2,201 to 2,764 cycles in the same 16 shots, with 7 to 13 zones built (10 in the pinned shot) | measured |
| IRQ time the timer does not see | 31 cycles before the start write (7 for the interrupt, 24 of prologue) and 16 after the stop write, per IRQ taken | arithmetic from the listing |
| One whole frame in play | A probe build (below) timed the sort, the build and every IRQ together: largest 8,420 cycles on PAL in 1,867 frames, 8,604 on NTSC in 2,142 frames; smallest 6,874 and 7,039. With the IRQ time the timer misses, at most 8,785 and 8,995 | measured in VICE x64sc, screen on (PAL and NTSC at 9.1, 20 and 40 million cycles; the largest was the same in all three); the IRQ allowance is arithmetic from the probe |
| Late guard | Fired 370 times in 309 PAL frames, in 249 of them; 369 times in 346 NTSC frames, in 266 of them | measured |
| Late guard overshoot | A probe build recorded the raster on the fall-through path: at most 5 lines past line − 3, so at most 2 lines past the scheduled line and at least 2 lines before the zone's first Y (PAL, 309 frames). An 8-sprite zone under full sprite DMA on a badline was not measured | measured in VICE x64sc |
| Late guard removed | A build with `bcs on_time` changed to `jmp on_time` showed 11 of 24 boxes in 2 of the 16 swept shots (9,300,000 cycles, PAL and NTSC) and 24 in the other 14 | measured |
| Printing load | Printing all twelve figures every frame left MISSED at 13 of about 260 PAL frames and 66 of about 290 NTSC frames; printing the five startup figures once and the live ones half at a time brought it to 0 or 1 | measured |

The startup timings run with IRQs off, sprites off and $D011 = $0B. DEN
is clear when line $30 passes, so there are no badlines and the timer
counts only the CPU's own cycles. With the screen and sprites on, the
already-sorted figure read 742.

### The sort keeps last frame's order

`order[]` is never reset. Each frame starts from the order the last frame
ended with, so an actor that has not passed a neighbour costs one compare:
`ldy order,x / lda act_y,y / ldy order-1,x / cmp act_y,y / bcs`, 26
cycles with the loop control. An actor that has passed k neighbours is
shifted k places at about 29.6 cycles a place. On paths that move 1 to 3
lines a frame that is a few hundred cycles above the sorted figure. A
reversed order is the worst case, 8,783 cycles, about 45 % of a PAL frame
on the sort alone. Ties stop the shift (`beq s_place`), so equal Ys keep
their order and do not swap back and forth from frame to frame.

### Two halves, one flag

The sorted tables `sy`, `sx`, `sptr`, `scol` and `sd010` are 64 bytes
each: half 0 at offset 0 and half 1 at offset 32. The IRQs read the half
at `front_off`; the main loop builds the other. The main loop waits until
`ready` is 0, builds, then sets `ready`. The frame IRQ swaps only when
`ready` is 1. The main loop therefore never writes a half the IRQs are
reading, and a late build shows the old half again (MISSED) instead of a
half-written table. The unsorted actor tables are not doubled; only the
main loop touches them.

### Rejecting the ninth sprite

A sorted entry at accepted position a ≥ 8 goes to slot a mod 8, which last
showed entry a − 8. `build` rejects the actor when its Y is less than 21
lines below that entry's Y and counts it in RJ. Twenty-one is the gap the
hardware needs: `docs/pitfalls/sprite.md` (`sprite_dma_overflow`) measured
a slot at Y = 100 rewritten to Y = 120 never reappearing, while Y = 121
did. A variant with the path squeezed into 50 lines showed RJ = 3 and 20
of 24 boxes in one PAL shot.

### Zones

Sprites 8 onward are grouped: a zone starts at the first unwritten sprite
and takes every following sprite whose Y is at most 4 lines lower. The
zone's IRQ line is its first Y − 3 − n, where n is its sprite count. The
writes cost about 60 cycles a sprite (arithmetic from the loop), about one
line, and Y is written first. A zone can hold at most eight sprites:
two sprites within 4 lines cannot share a slot, since accepted entries in
one slot are at least 21 lines apart. The same fact means the slot's
previous sprite started at least 17 lines above the zone's first Y, so the
IRQ line (at most 11 lines above it) is always after that start.

What the zone does not wait for is the end of the previous sprite. If the
new sprite is exactly 21 lines below the old one, the new X, colour and
pointer land while the old sprite still has its last few lines to draw.
In the squeezed variant, 1- to 3-line stubs in another actor's colour
appeared next to some boxes; that is this effect. Writing Y last and
firing the IRQ just below the old sprite avoids it, at the cost of
dropping the new sprite when the IRQ is late (Cadaver, sprite.html,
section 2.4.2).

### The late guard

At the end of every zone the handler stores the next zone's line in
$D012, subtracts 3 and compares with $D012. If the raster has already
reached that point it jumps straight to the next zone's body, skipping
the exit, the acknowledge and the next entry. Without the guard, an IRQ
line written after the raster has passed it does not fire until the
next frame, and every zone after it that frame is lost: 11 of 24 boxes in
2 of the 16 swept shots of the variant above. The acknowledge ($D019 = $01) is written only on the
on-time path, after the guard, so a compare that matched during a
fall-through does not raise a second IRQ. Cadaver found that a margin of
2 lines still flickered in rare cases and uses 3 (not measured here).
The frame IRQ does not use the guard: its next line is in the next
frame, and any compare with the current raster would call it late.

### $D010 is precalculated

`build` keeps a running $D010 value and stores, with every sorted entry,
the $D010 byte as it must be after that entry is written. The IRQ writes
one precomputed byte instead of reading, masking and setting a bit. The
frame IRQ writes the byte stored with entry 7.

### The timers

CIA2 timer A times the sort and B adds up IRQ time. Both latch $FFFF.
Writing $11 to a control register loads $FFFF and starts the timer;
writing $00 stops it; the elapsed count is $FFFF minus the timer, less
CAL. The IRQ prologue reads timer A's control register, keeps its start
bit, and stops it, then starts timer B; the epilogue stops B and writes
A's saved start bit back. A stopped timer restarts from its current count,
so an IRQ that lands during the sort adds only its first 25 or so cycles
to SORT. In this program the sort runs in the lower border after the
frame IRQ, where no zone IRQ fires. CIA2's interrupt mask is cleared so
the timers cannot raise an NMI. The prologue clears the decimal flag
before any arithmetic.

### Where the time goes

Per PAL frame in the pinned shot: sort 750, build about 3,815, IRQs 2,764
plus about 47 per IRQ taken. The build copies five bytes for every actor
so the IRQ indexes one set of tables; it is the largest item. The main
loop also runs `move_actors` and prints, and the VIC takes its badline and
sprite cycles. Printing all twelve figures every frame was enough to
overrun on NTSC (MISSED 66 of about 290), which is why the live figures
are printed half at a time.

One whole frame was timed by a probe build. It adds CIA1 timer A,
started with `$01` (run, no reload) as the second instruction of the IRQ
entry and set from a window flag at the exit, so the timer runs through
every IRQ and, while the flag is set, through the main loop's sort and
build. The frame IRQ stops it, reads it, and reloads and restarts it.
The probe prints the frame, the largest and smallest since frame 4, and
the most IRQs taken in one frame, in a fifth text row; its code grew
past $1000, so the tables moved to $1100 and $1300. The timer is
wall-clock with the screen on, so it holds the badline and sprite stalls
that fall inside the timed stretches, and 5 cycles per IRQ of the probe's
own count. It misses 26 cycles of each IRQ taken outside the sort and
build (16 up to the start write, including the 7-cycle interrupt, 1
before the timer counts, and 9 after the exit write) and 27 at the read
(arithmetic from the probe listing).

| Model | Frames | Largest | Smallest | Most IRQs | Largest + 26 × IRQs + 27 |
|---|---|---|---|---|---|
| PAL | 1,867 | 8,420 | 6,874 | 13 | 8,785 |
| NTSC | 2,142 | 8,604 | 7,039 | 14 | 8,995 |

The actor paths repeat every 256 frames (256 steps at any speed bring every
phase back), so these runs cover each arrangement several times.
With the allowance, the largest frame is 45 % of a PAL frame and 53 % of
an NTSC one. The NTSC figure, 8,995, is what `sprite_multiplex_game`
states as `cycles_per_frame_typical`. It is close to the 8,800 cycles the
technique page adds up from the parts without a reversal.

### Region

`region: both`. Every IRQ line is between 79 and 252, inside PAL's 312
and NTSC's 263 lines, so $D011 bit 7 stays 0. Sprite Ys run from 90 to
228; the last sprite line is 249, before the frame IRQ at 252. Lines 256
and later on PAL compare as 0 to 55 in the low byte, below every sprite Y
used here. The pinned run uses the same cycle count on both models.

### Sources

Facts, not code, from: Cadaver, "Sprite multiplexing",
https://cadaver.github.io/rants/sprite.html (continuous insertion sort,
the 21-line rejection, double-buffered sorted tables, precalculated
$D010, the late-IRQ check with a 3-line margin); Falco Paul in Cadaver's
"Speculative sprite sorting methods",
https://cadaver.github.io/rants/sorting.html (bucket and hybrid sorts);
cadaver/c64gameframework, https://github.com/cadaver/c64gameframework
(`screen.s`, `raster.s`; MIT), read for names and structure only.
