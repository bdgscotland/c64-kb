---
recipe: road-sprite-lines
toolchain: kickassembler
output_format: PRG
region: both
techniques: [pseudo_3d_road_raster, double_irq, stable_raster_irq, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D010, D011, D012, D015, D016, D017, D018, D019, D01A, D01B, D01C, D01D, D020, D021, D027, D028, D029, DC0D, DD0D]
uses_kernal: []
claims: [irq_vector_fffe (owns), nmi_vector_fffa (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init)]
---

<!-- doc-type: recipe -->

# KickAssembler: a raster road with sprites on its lines

## Synopsis

A per-line XSCROLL road with three sprites moving down it, over its
badlines, while every road line still gets its own `$D016` on the same
cycle. `pseudo-3d-road.md` draws its road with the sprites off, because a
sprite's fetches take cycles from every line it is on and that recipe's
unrolled loop counts every cycle. Here each road line is one 64-byte block
of code: its stores, then a branch into a slide of `CMP #$C9` bytes. Every
frame the branch operands are rewritten from a 16-entry pad table, by the
set of sprites that fetch on the line and by badline or not, so each line
stays 63 cycles long (65 on NTSC) with the sprites' stall inside it. This
is the method of the racing starter (`templates/racing/src/engine.asm`),
cut down to the one technique.

Measured in VICE x64sc 3.10 on PAL c64c (8565/8580/8521) and NTSC
(6567R8): the monitor's store trace puts every `STA $D016` of the road on
cycle 7 of its own line and every probe `STA $D020` on cycle 15 (Bauer's
numbering, which is what a store trace prints:
`runtime/vice-reference.md`, "What the CYC column counts"), on every frame of
20,000,000-cycle runs on both models; 100 exit screenshots, 50 a model,
show all 96 lines at their table XSCROLL and all 84 probes at x 17. With
the pads blind to the sprites, 32 to 75 of the 84 probes a shot land
somewhere else.

## Source

```asm
// road-sprite-lines.asm   KickAssembler 5.25
//
// A raster road with three sprites on its lines. Every road line 107-202
// has one 64-byte block of code; each block starts on the same cycle of
// its line. Cycles are Bauer's (1-63), as the VICE monitor's store trace
// prints the write's cycle (docs/runtime/vice-reference.md):
//
//   normal line  LDA #xs  STA $D016    XSCROLL, written on cycle 7
//                NOP
//                LDA #c   STA $D020    the probe, written on cycle 15
//                BVC into the slide    (V is clear: always taken, 3 cycles)
//   badline      LDA #xs  STA $D016    written on cycle 7; then the VIC
//                BVC into the slide    holds the bus for 43 cycles
//
// The slide is CMP #$C9 bytes ending C5 EA: entered R bytes from its end
// it takes R + 1 cycles. Each frame the BVC operands are patched so that
// every line is 63 cycles (65 on NTSC) with the stall of the sprites that
// fetch on it counted: sprites 0-2 fetch at the end of a line and stall a
// reading CPU for 5 + 2 * (last - first) cycles, last and first being the
// highest and lowest of them on that line. A badline takes 43 more.
// Sprites 3-7 would fetch at the start of a line, over the stores: off.
//
// The probe: normal lines alternate the border between black and dark
// grey, so the left border of each shows where its store landed: x 17 of
// the screenshot. A line that starts a cycle late moves it 8 pixels right.
//
// Build variants (KickAssembler command line, for the measurements):
//   :SYNCP=n :ENTRYP=n :SYNCN=n :ENTRYN=n   the double IRQ's constants
//   :NOPAD=1                                the pads ignore the sprites

BasicUpstart2(main)

.var SYNC_P  = cmdLineVars.containsKey("SYNCP")  ? cmdLineVars.get("SYNCP").asNumber()  : 40
.var ENTRY_P = cmdLineVars.containsKey("ENTRYP") ? cmdLineVars.get("ENTRYP").asNumber() : 58
.var SYNC_N  = cmdLineVars.containsKey("SYNCN")  ? cmdLineVars.get("SYNCN").asNumber()  : 42
.var ENTRY_N = cmdLineVars.containsKey("ENTRYN") ? cmdLineVars.get("ENTRYN").asNumber() : 60
.var NOPAD   = cmdLineVars.containsKey("NOPAD")

.const ROAD_TOP   = 107         // row 7's first line, a badline (YSCROLL 3)
.const ROAD_LINES = 96          // lines 107-202, rows 7-18
.const IRQ_TOP    = 103         // the double IRQ: 103, then 105
.const SYNC_LINE  = 105
.const BADLOSS    = 43          // cycles 12-54 of a badline, CPU reading

.const SCREEN   = $0400
.const SPRITES  = $2000         // pointers 128-130
.const CHARSET  = $3000
.const ROAD     = $4000         // 97 blocks of 64 bytes

.const C_TOP    = 14            // border above and below the road
.const C_PROBE0 = 0             // black
.const C_PROBE1 = 11            // dark grey
.const C_GRASS  = 5
.const C_ROAD   = 12
.const C_KERB   = 1
.const C_SKY    = 14

// Block layout: bytes before the slide, and cycles before it.
.const NB_HEAD  = 13
.const NB_CYC   = 17            // 2 + 4 + 2 + 2 + 4 + 3
.const NB_SLIDE = 64 - NB_HEAD
.const BB_HEAD  = 7
.const BB_CYC   = 9             // 2 + 4 + 3
.const BB_SLIDE = 64 - BB_HEAD

.const late     = $02f0         // frames whose sync IRQ was not on line 105
.const frames   = $02f1
.const model    = $02f2         // 0 PAL, 1 NTSC

.function isBad(line) { .return (line & 7) == 3 }

// CPU cycles sprites 0-2 take from a line, by the set m (bit s: sprite s).
.function lostSet(m) {
    .if (m == 0 || NOPAD) .return 0
    .var f = 0
    .while (((m >> f) & 1) == 0) .eval f++
    .var l = 2
    .while (((m >> l) & 1) == 0) .eval l--
    .return 5 + 2 * (l - f)
}
// BVC operand: skip the slide's first bytes, leave R = cycles - 1.
.function padN(line, m) { .return NB_SLIDE - (line - NB_CYC - 1 - lostSet(m)) }
.function padB(line, m) { .return BB_SLIDE - (line - BB_CYC - BADLOSS - 1 - lostSet(m)) }

// XSCROLL per road line: a bend that changes inside character rows.
.function xsOf(j) { .return round(3.5 + 3.5 * sin(2 * PI * j / 32)) }

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

* = $0810
main:
        sei
        lda #$35                // KERNAL and BASIC out, I/O in
        sta $01
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda $dd0d
        jsr detect_model
        jsr draw_screen
        ldx #15                 // this model's pads
        ldy model
        beq !+
        ldx #31
!:      ldy #15
!:      lda pads_pal, x
        sta pad_n, y
        dex
        dey
        bpl !-
        ldx #0                  // three sprites, 0-2, on the road
!:      lda spr_x, x
        pha
        txa
        asl
        tay
        pla
        sta $d000, y
        lda spr_col, x
        sta $d027, x
        txa
        clc
        adc #SPRITES / 64
        sta SCREEN + $3f8, x
        inx
        cpx #3
        bne !-
        lda #0
        sta $d010
        sta $d017
        sta $d01b
        sta $d01c
        sta $d01d
        lda #%00000111
        sta $d015
        lda #$1b                // YSCROLL 3, 25 rows, display on
        sta $d011
        lda #$08
        sta $d016
        lda #$1c                // screen $0400, characters $3000
        sta $d018
        lda #C_TOP
        sta $d020
        lda #C_GRASS
        sta $d021
        lda #0
        sta late
        sta frames
        jsr update              // pads and sprite Y before the first road
        lda #<irq_top
        sta $fffe
        lda #>irq_top
        sta $ffff
        lda #<nmi_rti
        sta $fffa
        lda #>nmi_rti
        sta $fffb
        lda #IRQ_TOP
        sta $d012
        lda #$01
        sta $d01a
        sta $d019
        cli
        jmp *

// ---- line 103: arm line 105 and wait in NOPs (the double IRQ) ------------
irq_top:
        pha
        txa
        pha
        tya
        pha
        lda model
        bne !ntsc+
        lda #<sync_pal
        ldx #>sync_pal
        bne !arm+
!ntsc:  lda #<sync_ntsc
        ldx #>sync_ntsc
!arm:   sta $fffe
        stx $ffff
        lda #SYNC_LINE
        sta $d012
        lda #$01
        sta $d019
        tsx
        stx sp_save
        cli
    .for (var i = 0; i < 50; i++) { nop }
        jmp *

// ---- line 105: entered from a NOP, 0 or 1 cycle late ----------------------
// The two $D012 reads straddle the change to line 106 in one case and not
// in the other; BEQ takes one cycle more in the case that was early. The
// first block then stores $D016 on cycle 7 of line 107.
.macro Sync(pad, entry) {
        ldx sp_save
        txs                     // drop this IRQ's frame; irq_top's stays
        Delay(pad)
        lda $d012
        cmp $d012
        beq !+
!:      cmp #SYNC_LINE
        bne bad
        Delay(entry - 6)
        clv                     // every block's BVC is taken
        jmp ROAD
bad:    inc late
        clv
        jmp ROAD
}
sync_pal:  Sync(SYNC_P, ENTRY_P)
sync_ntsc: Sync(SYNC_N, ENTRY_N)

// ---- after line 203's block: next frame's sprites and pads ----------------
road_done:
        inc frames
        jsr update
        lda #<irq_top
        sta $fffe
        lda #>irq_top
        sta $ffff
        lda #IRQ_TOP
        sta $d012
        lda #$01
        sta $d019
        pla
        tay
        pla
        tax
        pla
nmi_rti:
        rti

// update: move each sprite down its own track (Y 107-182, so it fetches
// on lines Y to Y + 20, all road lines), mark which sprites fetch on each
// road line, and patch every block's BVC operand from the pad tables.
update:
        ldx #2
!:      lda spr_c, x
        clc
        adc spr_v, x
        cmp #76
        bcc !+
        sbc #76
!:      sta spr_c, x
        clc
        adc #ROAD_TOP
        pha
        txa
        asl
        tay
        pla
        sta $d001, y
        dex
        bpl !--
        lda #0
        ldx #ROAD_LINES - 1
!:      sta mask, x
        dex
        bpl !-
    .for (var s = 0; s < 3; s++) {
        ldy spr_c + s
        ldx #21
!:      lda mask, y
        ora #1 << s
        sta mask, y
        iny
        dex
        bne !-
    }
    .for (var j = 0; j < ROAD_LINES; j++) {
        ldx mask + j
      .if (isBad(ROAD_TOP + j)) {
        lda pad_b, x
        sta ROAD + j * 64 + BB_HEAD - 1
      } else {
        lda pad_n, x
        sta ROAD + j * 64 + NB_HEAD - 1
      }
    }
        rts

// PAL or NTSC: the last raster line's low byte, read while RST8 is set:
// $37 (311) on PAL, $06 (262) on NTSC.
detect_model:
!:      bit $d011
        bmi !-
!:      bit $d011
        bpl !-
!:      lda $d012
        bit $d011
        bpl !+
        tax
        jmp !-
!:      lda #0
        cpx #$10
        bcs !+
        lda #1
!:      sta model
        rts

// Rows 0-6 sky, 7-18 the road (grass, kerb at columns 10 and 29, road
// between), 19-24 black.
draw_screen:
        ldx #0
!:      lda #1
        sta SCREEN, x
        sta SCREEN + $100, x
        sta SCREEN + $200, x
        sta SCREEN + $2e8, x
        lda #C_SKY
        sta $d800, x
        sta $d900, x
        sta $da00, x
        sta $dae8, x
        inx
        bne !-
        lda #0
        ldx #6 * 40 - 1
!:      sta $d800 + 19 * 40, x
        dex
        cpx #$ff
        bne !-
        lda #<(SCREEN + 7 * 40)
        sta $fb
        lda #>(SCREEN + 7 * 40)
        sta $fc
        lda #<($d800 + 7 * 40)
        sta $fd
        lda #>($d800 + 7 * 40)
        sta $fe
        ldx #12
!row:   ldy #39
!:      lda road_row, y
        sta ($fb), y
        lda road_col, y
        sta ($fd), y
        dey
        bpl !-
        lda $fb
        clc
        adc #40
        sta $fb
        sta $fd
        bcc !+
        inc $fc
        inc $fe
!:      dex
        bne !row-
        rts

road_row:   .fill 10, 0
            .byte 2
            .fill 18, 1
            .byte 2
            .fill 10, 0
road_col:   .fill 10, 0
            .byte C_KERB
            .fill 18, C_ROAD
            .byte C_KERB
            .fill 10, 0

spr_x:      .byte 130, 165, 200
spr_col:    .byte 2, 7, 3
spr_c:      .byte 0, 25, 50     // Y - 107, 0-75
spr_v:      .byte 1, 2, 3       // lines a frame
sp_save:    .byte 0
mask:       .fill ROAD_LINES, 0
pad_n:      .fill 8, 0          // BVC operand by sprite set: this model's
pad_b:      .fill 8, 0
pads_pal:   .fill 8, padN(63, i)
            .fill 8, padB(63, i)
pads_ntsc:  .fill 8, padN(65, i)
            .fill 8, padB(65, i)

* = SPRITES
            .fill 3 * 64, 255   // three solid 24 x 21 sprites

* = CHARSET
            .fill 8, 0          // 0: grass ($D021)
            .fill 8, 255        // 1: solid, colour RAM (sky, road, black)
            .fill 8, 255        // 2: kerb, colour RAM white

// ---- the road: one 64-byte block a line, then line 203 --------------------
.macro Slide(n) {
    .fill n - 2, $c9
    .byte $c5, $ea
}
* = ROAD
    .for (var j = 0; j < ROAD_LINES; j++) {
      .if (isBad(ROAD_TOP + j)) {
        lda #$08 | xsOf(j)
        sta $d016
        .byte $50, padB(63, 0)
        Slide(BB_SLIDE)
      } else {
        lda #$08 | xsOf(j)
        sta $d016
        nop
        lda #((j - floor(j / 8) - 1) & 1) == 0 ? C_PROBE0 : C_PROBE1
        sta $d020
        .byte $50, padN(63, 0)
        Slide(NB_SLIDE)
      }
    }
        lda #$08                // line 203: XSCROLL 0, the border back
        sta $d016
        lda #C_TOP
        sta $d020
        jmp road_done
```

## Build

```bash
java -jar KickAss.jar road-sprite-lines.asm -o road-sprite-lines.prg
```

## Expected output

Sky (light blue character cells) on rows 0-6, a grass field with a grey
road between two white kerbs on rows 7-18, black rows 19-24. The road's
edges bend on every raster line: each road line carries its own XSCROLL,
`round(3.5 + 3.5 * sin(2 * pi * j / 32))` for line 107 + j. A red, a
yellow and a cyan sprite stand on the road at X 130, 165 and 200 and move
down it at 1, 2 and 3 lines a frame, wrapping from Y 182 to 107. The left
border beside the road lines is striped black and dark grey from x 17:
the probe. Pinned at 14,500,000 cycles: `screenshots/road-sprite-lines.png`
(PAL) and `screenshots/road-sprite-lines-ntsc.png` (NTSC).

**The pictures, decoded (a script, both pinned shots).** Geometry from
`runtime/vice-reference.md`: row = line − 16 on PAL, − 28 on NTSC. For each
road line the script finds the first and last pixel that is not grass: the
left kerb starts at x 112 + XSCROLL and the right kerb ends at x 271 +
XSCROLL. On each normal line it lists the x where the left border changes
colour.

| | PAL | NTSC |
|---|---|---|
| Road lines whose XSCROLL, read at both kerbs, equals the table | 96 of 96 | 96 of 96 |
| Normal lines whose border changes at x 17 and nowhere else in x 1-31 | 84 of 84 (x 16 is a light grey dot, the 8565's) | 84 of 84 |
| Display lines by sprites on them (sprite numbers) | none 72, {0} 1, {0,1} 1, {0,1,2} 19, {1,2} 1, {2} 1 | none 62, {0} 6, {0,1} 6, {0,1,2} 9, {1,2} 6, {2} 6 |
| Badlines with a sprite on them | 163, 171, 179 | 171, 179, 187, 195 |

**Every store, every frame (VICE monitor).** Tracepoints on stores to
`$D016` and `$D020` (`-moncommands` with `tr store $d016`, `tr store
$d020`), 20,000,000 cycles a model, stores from the road blocks only:

| | PAL | NTSC |
|---|---|---|
| Frames traced (the last cut off by the cycle limit) | 854 | 975 |
| `STA $D016` of line 107 + j's block | 81,877 stores, all on line 107 + j, cycle 7 | 93,598, all line 107 + j, cycle 7 |
| `STA $D020` (normal lines) | 71,640, all cycle 15 | 81,898, all cycle 15 |
| Blocks with more than one (line, cycle) | 0 | 0 |

The cycles are the store trace's CYC as it prints it, which is the
write's cycle in Bauer's numbering. `pseudo-3d-road.md`'s "cycle 4" is
the same numbering: its store trace prints 4 (measured for issue #82).
An earlier version said that page added one to the column and that its
4 was this page's 3 (it adds one only to exec CYC), and listed the
mapping to Bauer's numbering as not settled. A badline blocks the
CPU's reads from cycle 12 (next paragraph); the probe's cycle 15 shows
at x 17, as x = 8c − 103 in `runtime/vice-reference.md` gives.
The sprite tracks put all 16 pad cases (8 sprite sets, normal and
badline) on the road within the first 44 frames (arithmetic from the
listing's speeds), so the trace covers each of them hundreds of times.

**The sweep (100 screenshots).** The listing at 8,000,000 +
k × 1,234,567 cycles (k = 0-7), at 9,000,000 and 9,500,000, and every
250,000 from 10,000,000 to 19,750,000: 50 cycle counts, PAL and NTSC.
All 96 XSCROLLs and all 84 probes are as above in every one of the 100
shots. Among them every sprite set appears on the display lines, including all
three sprites on one line and sprites 0 and 2 without 1.

**What the constants do when they are wrong.** Built with the listing's
command-line variables, four shots a model at 8,000,000 + k × 1,234,567:

| Build | PAL | NTSC |
|---|---|---|
| `:NOPAD=1`: the pads ignore the sprites | 21-40 of 96 XSCROLLs right; 59-75 of 84 probes off x 17 | 48-69 right; 32-51 probes off |
| `:SYNCP=39` | probes at x 9 (a cycle early) on some frames: 0, 84, 74 and 62 of 84 lines | unchanged |
| `:SYNCP=41` | every probe at x 25, a cycle late | unchanged |
| `:ENTRYP=57` / `59` | every probe at x 9 / x 25 | unchanged |
| `:SYNCN=43` | unchanged | every probe at x 25 |
| `:SYNCN=41` | unchanged | the four shots right; the monitor over 513 frames: 94 of 49,221 `$D016` stores a cycle early, on cycle 6 |
| `:ENTRYN=59` / `61` | unchanged | every probe at x 9 / x 25 |

With `:NOPAD=1` the first probe off x 17 is on the first line a sprite
shows on: the stall the pads leave out moves every block after it later.

**The badline's edge.** Moving `ENTRY_P` moves every store. At 63 the
monitor puts the badline `$D016` stores on cycle 11 (line 107's on 12) and
all 96 lines still match. At 64 (cycle 13) every badline's store is held
past the stall, to cycle 56 or 61, or cycle 2 of the next line when
sprites follow the badline; line 107 then shows line 106's XSCROLL. So a
store that the monitor puts on 13 needs a read on 12, and the badline
blocks it. The listing stores on 7, six cycles inside that edge.

**Cycles (VICE monitor, exec tracepoints on `irq_top`, `road_done` and
the RTI, 134 PAL and 161 NTSC frames).**

| | PAL | NTSC |
|---|---|---|
| `irq_top`'s first instruction (line 103, cycle 10-12; the exec trace printed 9-11, which an earlier version quoted as is) to `road_done` | 6,348-6,350 | 6,549-6,550 |
| `road_done` to the RTI: `update` (sprite Y, masks, 96 operands) and the exit | 3,699-3,700 | 3,697-3,700 |
| The IRQs' whole share of a frame | 10,047-10,049 of 19,656 | 10,246-10,250 of 17,095 |
| RTI on | line 262 | line 260 |

The chain is the road's 96 lines plus lines 103-106 of the double IRQ; it
holds the CPU whatever the sprites do. `update` rewrites all 96 operands
every frame; a program whose sprites move less can rewrite only the rows
they touched, as the racing starter does.

## Why this works

**The block.** A road line's block starts on the same cycle of every
line. A normal block stores `$D016` (written on cycle 7) and the probe
colour (cycle 15), then `BVC` into its slide: V is clear, so the branch
is always taken, and the 64-byte alignment keeps it inside one page, 3
cycles. The slide is `CMP #$C9` repeated and ending `C5 EA`. Entered on an
even byte from its end it runs `CMP #` pairs and a last `CMP $EA` of 3
cycles; entered on an odd byte, the last pair reads as `CMP #$C5` and a
`NOP`. Either way R bytes take R + 1 cycles, so any whole number of
cycles from 2 up is one operand. A badline block stores `$D016` only and
is reading when the VIC takes the bus: the CPU loses the 43 cycles from
12 to 54 (the `BADLOSS` found for the racing starter; measured here as
the whole chain staying exact). The starter's stores trace on 7 and 13
too (measured for issue #82, both models). Its README called them 6 and
12, counting the block's first cycle as cycle 1, until #82; the block's
first cycle is Bauer's 2.

**The pads.** The VIC fetches sprites 0-2 at the end of a line (pointer
slots 58, 60 and 62 on PAL, 60, 62 and 64 on NTSC,
`hardware/vic-ii-reference.md`, Sprite DMA). A reading CPU stops three
cycles before the first of them and resumes two after the last: 5 +
2 × (last − first) cycles, whichever sprites lie between (the arithmetic
of `dysp.md`). A sprite whose Y register is y fetches on lines y to
y + 20 and shows on y + 1 to y + 21. The slide's cycles on a line are
then

| Line | PAL R + 1 | NTSC R + 1 |
|---|---|---|
| Normal, sprite set s | 46 − lost(s) | 48 − lost(s) |
| Badline, sprite set s | 11 − lost(s) | 13 − lost(s) |

with lost = 0 for no sprite, 5 for {0}, {1} or {2}, 7 for {0,1} or
{1,2}, and 9 for {0,2} or {0,1,2}. The badline with all three on PAL is
the tightest: 2 cycles, the slide's last `NOP`. `update` builds a 96-byte
mask of the sprites on each line from their Y, then one `LDX mask+j;
LDA pad,X; STA block+operand` per line, unrolled.

**Why only sprites 0-2.** Sprites 3-7 have their slots at the start of
the next line (cycles 1-9 in `vic-ii-reference.md`). Their stall would
land on the block's stores and move them, and the XSCROLL store would no
longer be on a fixed cycle.
Sprites 0-2 stall the slide, which has no stores.

**The sync.** `irq_top` at line 103 arms line 105 and waits in `NOP`s, so
the line-105 IRQ lands 0 or 1 cycle late. Two `$D012` reads straddle the
change to line 106 in one case only, and `BEQ` takes the cycle back (the
double IRQ of `stable-raster-irq.md`; the constants are the racing
starter's, and the table above is what one cycle either way does).
Lines 100-106 carry no sprite and no badline, so nothing steals from the
sync; the sprites' Y is kept in 107-182 so that every line they fetch on
has a block. `CLV` before the jump matters: `Delay` uses `BIT $EA` for
odd counts, which sets V from memory, and a set V makes every `BVC` run
its whole slide. The KERNAL is banked out and the vectors at `$FFFE`
point straight at the handlers.

**The probe.** A colour store in the left border shows its cycle in the
picture: the border changes colour where the store lands, 8 pixels a
cycle. Alternating black and dark grey on the normal lines gives every
normal line a change, including the line after a badline, which keeps
the colour of the line above. A road for a game stores `$D021` there
instead, for a grass band per line, as the racing starter does; that
store is invisible in the picture unless it lands inside the display,
so this listing uses the border.

## What it does not establish

- Sprites 3-7 on the road, Y-expanded sprites, and a sprite reused lower
  down the road (its Y and pointer rewritten from inside the blocks):
  none of them is built or measured here.
- A real 6569, 8565 or 6567. Everything here is VICE x64sc 3.10.
