---
recipe: fli-music-scroller
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [fli_image, stable_raster_irq, double_irq, vic_bank_select, topbottom_border_open, sprite_border_scroller, sid_play_routine_pattern]
raster_bands: [sprite_border_scroller@273-299]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D016, D017, D018, D019, D01A, D01B, D01C, D01D, D020, D021, D027, D400, D418, DC0D, DD00, DD04, DD05, DD0E, DD0F]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), zero_page $FB-$FE (owns)]
harness: [cia2_timer_a, cia2_timer_b, $02FF]
ram: [pointers=$07F8-$07FF, sprites=$2000-$21FF, idle=$3FFF, idle1=$7FFF, colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — FLI, a SID tune and a sprite scroller in one frame

## Synopsis

FLI takes every CPU cycle of the 200 display lines: each line's block
rewrites `$D018` and `$D011` and the forced badline stops the CPU for
the rest of the line (`fli-image.md`). A tune and a scroller need time
too, and there is none on those lines. This recipe puts them where FLI
leaves time: the lower border is opened on line 249, the VIC is switched
to bank 0 on line 251 so eight sprites can carry a scroller on lines
252-272, and one IRQ on line 273 puts bank 1 back and calls the tune and
the scroller update. The FLI picture is `fli-image.md`'s test pattern and
comes out pixel for pixel the same as that recipe's pinned screenshot.
The program checks its own frame budget and sets the border green when
no update ran into the next frame's FLI. PAL only, as `fli-image.md`.

## Source

```asm
// fli-music-scroller.asm
// An FLI picture, a SID tune and a sprite scroller in one PAL frame. The
// FLI loop owns every cycle of lines 51-250 (fli-image.md), so the tune and
// the scroller live in the lines it leaves:
//   45-47    irq1/irq2: the FLI's double IRQ, stable on line 47
//   48-250   the FLI blocks: $D018 and $D011 every line, the CPU stalled by
//            the forced badline from cycle 15 to 54 of each
//   248      RSEL cleared (after line 247's bottom comparison): the lower
//            border opens (topbottom_border_open)
//   251      VIC bank 0 and a text-mode $D018, so the eight sprites on lines
//            252-272 fetch their pointers and data from bank 0; the FLI's
//            bank 1 has no room for them
//   273      irq_upd: bank 1 and the FLI's $D018 and $D011 back, then the
//            tune, then the scroller; timed with the CIA2 timers
// The picture is fli-image.md's test pattern: eight one-line colour stripes
// repeating down the screen. After FRAMES frames the scroller stops; the
// program then checks that no update ran past line 44 of the next frame and
// sets the border green ($02FF = 1) or red ($02FF = 2).

.const FIRST_LINE = 51
.const LAST_LINE  = 250
.const SYNC_LINE  = 48
.const SYNC_PAD   = 11              // as fli-image.md
.const ENTRY_PAD  = 197             // as fli-image.md
.const LINE_PAD   = 11              // as fli-image.md
.const SPRITE_Y   = 251             // sprites drawn on lines 252-272
.const UPD_LINE   = 273             // the update's IRQ
.const SPRBASE    = $2000           // bank 0: eight slots, pointers $80-$87 at $07F8
.const XSTEP      = 63
.const FRAMES     = 250
.const RESULT     = $02ff

.const BANK     = $4000
.const BITMAP   = BANK + $2000

.const ptr = $fb
.const src = $fd

BasicUpstart2(start)

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

.function d018(p) { .return (p << 4) | $08 }
.function d011(l) { .return $38 | (l & 7) }
.function dbl(b) {
    .var e = 0
    .for (var i = 0; i < 8; i++) {
        .if (((b >> i) & 1) == 1) .eval e = e | (3 << (2 * i))
    }
    .return e
}

// ---------------------------------------------------------------- picture
.for (var p = 0; p < 8; p++) {
    * = BANK + p * $400
    .fill 1000, (p << 4) | p
}
* = BITMAP
    .fill 8000, $55

// ---------------------------------------------------------------- setup
* = $0810
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    lda #0
    sta $d020
    sta $d021
    sta $3fff                       // idle bytes, bank 0 and bank 1: background
    sta $7fff
    sta frame
    sta tidx
    sta RESULT
    sta endline
    sta endline+1
    sta upd
    sta upd+1
    lda #<200
    sta pos
    lda #>200
    sta pos+1
    ldx #0
!:  sta $d800,x                     // colour RAM black: the %11 colour, unused
    sta $d900,x
    sta $da00,x
    sta $dae8,x
    sta SPRBASE,x
    sta SPRBASE+$100,x
    inx
    bne !-

    ldx #7                          // bank 0 pointers, colours, Y, a glyph each
!:  txa
    clc
    adc #SPRBASE/64
    sta $07f8,x
    lda spr_col,x
    sta $d027,x
    ldy pairs,x
    lda #SPRITE_Y
    sta $d001,y
    dex
    bpl !-
    lda #0
    sta $d017
    sta $d01d
    sta $d01c
    sta $d01b
    lda #$ff
    sta $d015
    ldx #7
!:  stx slot
    jsr next_char
    ldx slot
    dex
    bpl !-
    jsr place
    jsr music_init

    jsr bank1
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #SYNC_LINE - 3
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// bank1: the FLI's VIC set-up for the start of a frame
bank1:
    lda $dd00
    and #$fc
    ora #$02                        // VIC bank 1
    sta $dd00
    lda #$d8                        // multicolour, 40 columns
    sta $d016
    lda #d018(FIRST_LINE & 7)
    sta $d018
    lda #$3b                        // bitmap, DEN, RSEL, YSCROLL 3, bit 8 clear
    sta $d011
    rts

// ---------------------------------------------------------------- FLI
irq1:
    lda #<irq2
    sta $0314
    lda #>irq2
    sta $0315
    lda #SYNC_LINE - 1
    sta $d012
    lda #$01
    sta $d019
    tsx
    stx saved_sp
    cli
    .for (var i = 0; i < 40; i++) { nop }

irq2:
    ldx saved_sp
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+
!:  Delay(ENTRY_PAD)
    .for (var l = FIRST_LINE + 1; l <= LAST_LINE; l++) {
        Delay(LINE_PAD)
        lda #d018(l & 7)
        sta $d018
        lda #d011(l)
        sta $d011
    }
fli_done:
    // Lines 248-250 cannot be badlines, so this point comes before line 250
    // ends. Wait for line 248, then clear RSEL: line 247's bottom comparison
    // has passed and line 251's will not match.
!:  lda $d012
    cmp #248
    bcc !-
    lda #$33                        // bitmap, DEN, RSEL = 0, YSCROLL 3
    sta $d011
!:  lda $d012                       // line 251: the last display line is done
    cmp #251
    bne !-
    lda $dd00                       // bank 0 for the sprites' fetches, which
    ora #$03                        // start on cycle 55 of this line
    sta $dd00
    lda #$15                        // screen $0400: pointers at $07F8
    sta $d018
    lda #$93                        // text, RSEL = 0, bit 8 of the compare set
    sta $d011
    lda #<UPD_LINE
    sta $d012
    lda #<irq_upd
    sta $0314
    lda #>irq_upd
    sta $0315
    lda #$01
    sta $d019
    jmp $ea81                       // pla/tay/pla/tax/pla/rti

// ---------------------------------------------------------------- update
irq_upd:
    jsr bank1                       // bank 1, $D018, $D016 and $D011 for the FLI
    lda #SYNC_LINE - 3
    sta $d012
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$01
    sta $d019

    lda #$00                        // CIA2 timers A and B cascaded, from $FFFFFF
    sta $dd0e
    sta $dd0f
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07
    lda #$51
    sta $dd0f
    lda #$11
    sta $dd0e
    jsr update
upd_end:
    lda #$00
    sta $dd0e
    sta $dd0f
    ldx #1                          // the line the update ended on: 256 + $D012
    lda $d012                       // while bit 8 is set, else 312 + $D012
    bit $d011
    bmi end_hi
    clc
    adc #<312
    ldx #>312
    bcc end_hi
    inx
end_hi:
    cpx endline+1                   // the latest over the run
    bcc !++
    bne !+
    cmp endline
    bcc !++
!:  sta endline
    stx endline+1
!:  lda $dd04                       // the most cycles over the run
    eor #$ff
    tax
    lda $dd05
    eor #$ff
    cmp upd+1
    bcc !++
    bne !+
    cpx upd
    bcc !++
!:  stx upd
    sta upd+1
!:  lda RESULT                      // at the freeze: the verdict
    cmp #$ff
    bne !+
    jsr verdict
!:  jmp $ea81

update:
    jsr music_play
    lda RESULT
    bne upd_out
    inc frame
    lda frame
    cmp #FRAMES
    bne !+
    lda #$ff                        // frozen; the verdict follows this update
    sta RESULT
!:  lda pos                         // p = (p - 2) mod 504
    sec
    sbc #2
    sta pos
    bcs !+
    dec pos+1
    bpl !+
    lda pos
    clc
    adc #<504
    sta pos
    lda pos+1
    adc #>504
    sta pos+1
!:  jsr place
    lda pend
    beq upd_out
    ldx pend
    dex
    stx slot
    jsr next_char
upd_out:
    rts

// verdict: every update ended before line 45 of the next frame (357)
verdict:
    lda endline+1
    cmp #>357
    bcc pass
    bne fail
    lda endline
    cmp #<357
    bcc pass
fail:
    lda #2
    sta RESULT
    lda #2
    sta $d020
    rts
pass:
    lda #1
    sta RESULT
    lda #5
    sta $d020
    rts

// place: sprite k at X = (p + 63k) mod 504; pend = k + 1 for the sprite at
// X 440 or 441, out of sight (as one-part-demo.md)
place:
    lda #0
    sta msb
    sta pend
    lda pos
    sta xl
    lda pos+1
    sta xh
    ldx #0
pl_next:
    lda xl
    sec
    sbc #<504
    tay
    lda xh
    sbc #>504
    bcc pl_ok
    sta xh
    sty xl
pl_ok:
    ldy pairs,x
    lda xl
    sta $d000,y
    lda xh
    beq !+
    lda bits,x
    ora msb
    sta msb
    lda xl
    cmp #<440
    beq pl_due
    cmp #<441
    bne !+
pl_due:
    inx
    stx pend
    dex
!:  lda xl
    clc
    adc #XSTEP
    sta xl
    bcc !+
    inc xh
!:  inx
    cpx #8
    bne pl_next
    lda msb
    sta $d010
    rts

next_char:
    ldy tidx
    lda text,y
    cmp #$ff
    bne !+
    ldy #0
    sty tidx
    lda text
!:  sta code
    inc tidx
    ldx slot
    lda slotlo,x
    sta ptr
    lda slothi,x
    sta ptr+1
    lda #0
    sta src+1
    lda code
    asl
    rol src+1
    asl
    rol src+1
    asl
    rol src+1
    sta src
    lda src+1
    ora #$d0
    sta src+1
    lda #$33
    sta $01
    ldy #7
!:  lda (src),y
    sta gbuf,y
    dey
    bpl !-
    lda #$37
    sta $01
    .for (var r = 0; r < 8; r++) {
        ldx gbuf+r
        lda t0,x
        ldy #6*r+6
        sta (ptr),y
        ldy #6*r+9
        sta (ptr),y
        lda t1,x
        ldy #6*r+7
        sta (ptr),y
        ldy #6*r+10
        sta (ptr),y
        lda t2,x
        ldy #6*r+8
        sta (ptr),y
        ldy #6*r+11
        sta (ptr),y
    }
    rts

// ---------------------------------------------------------------- music
// The same two-voice tune as one-part-demo.md.
.function freq(n) { .return round(440 * pow(2, (n - 69) / 12) * 16777216 / 985248) }

music_init:
    ldx #$18
    lda #0
!:  sta $d400,x
    dex
    bpl !-
    lda #$0f
    sta $d418
    lda #$08
    sta $d403
    lda #$09
    sta $d405
    lda #$a0
    sta $d406
    lda #$0a
    sta $d40c
    lda #$60
    sta $d40d
    lda #1
    sta mtick
    lda #0
    sta mstep
    rts

music_play:
    dec mtick
    bne mp_out
    lda #6
    sta mtick
    ldx mstep
    lda #$40
    sta $d404
    lda #$10
    sta $d40b
    ldy bass,x
    lda ftab_lo,y
    sta $d400
    lda ftab_hi,y
    sta $d401
    ldy lead,x
    lda ftab_lo,y
    sta $d407
    lda ftab_hi,y
    sta $d408
    lda #$41
    sta $d404
    lda #$11
    sta $d40b
    inx
    txa
    and #31
    sta mstep
mp_out:
    rts

bass: .byte 33,33,40,40, 33,33,40,40, 29,29,36,36, 29,29,36,36
      .byte 31,31,38,38, 31,31,38,38, 28,28,35,35, 28,28,35,35
lead: .byte 69,72,76,72, 69,72,76,79, 65,69,72,69, 65,69,72,77
      .byte 67,71,74,71, 67,71,74,79, 64,68,71,68, 64,68,71,76
ftab_lo: .fill 96, <freq(i)
ftab_hi: .fill 96, >freq(i)

// ---------------------------------------------------------------- data
.encoding "screencode_upper"
text:   .text "FLI ABOVE, MUSIC AND WORDS BELOW    "
        .byte $ff
spr_col: .byte 1, 7, 3, 13, 1, 7, 3, 13
bits:   .byte 1, 2, 4, 8, 16, 32, 64, 128
pairs:  .byte 0, 2, 4, 6, 8, 10, 12, 14
slotlo: .fill 8, <(SPRBASE + i * 64)
slothi: .fill 8, >(SPRBASE + i * 64)

.align $100
t0:   .fill 256, dbl(i) >> 12
t1:   .fill 256, (dbl(i) >> 4) & $ff
t2:   .fill 256, (dbl(i) & $0f) << 4

saved_sp: .byte 0
frame:    .byte 0
pos:      .word 0
msb:      .byte 0
pend:     .byte 0
xl:       .byte 0
xh:       .byte 0
slot:     .byte 0
tidx:     .byte 0
code:     .byte 0
gbuf:     .fill 8, 0
upd:      .word 0
endline:  .word 0
mtick:    .byte 0
mstep:    .byte 0
.assert "the program ends below the sprite slots", * <= SPRBASE, true
```

## Build

```bash
java -jar KickAss.jar fli-music-scroller.asm -o fli-music-scroller.prg
```

Produces `fli-music-scroller.prg`, `$0801` to `$7F3F`: code and tables
to `$1E18`, the eight FLI screen pages at `$4000`, the bitmap at
`$6000`.

## Expected output

Screenshot from the pinned run, 10,000,000 cycles, PAL:
`screenshots/fli-music-scroller.png`. Measured with PIL:

- Border pixel (2, 100) = (98, 213, 50), green, palette index 5: the
  program's verdict, `$02FF` = `$01`. Every pixel of the left border
  column is that green.
- Lines 51-250, x 32-351, are pixel for pixel the same as
  `screenshots/fli-image.png`: the eight one-line colour stripes and the
  three light grey (205, 205, 205) columns at the left, the FLI bug, and
  lines 247-250 repeating line 247's colour.
- Lines 16-50 and 251-287, x 32-351, are black: the top and the bottom
  border are open. With them closed these lines would be the green
  border colour.
- Lines 252-272 carry the scroller's letters in white, yellow, cyan and
  light green (430 non-black pixels in x 32-351). The side borders are
  closed here, so a sprite at X 0-23 or 344-503 is hidden, and the
  hand-off at X 440 is out of sight.

## The frame, measured

Measured in VICE x64sc 3.10 (PAL C64C), `trace exec` on each entry point
over the 350 frames of a 10,000,000-cycle run, `trace store` on `$D011`
and `$DD00`. Cycles are Bauer's (exec CYC + 1; store CYC as printed).

| Lines | Code | Measured |
|---|---|---|
| 45 | `irq1`, through `$FF48` | entered on cycle 39 to 41 |
| 47 | `irq2` | synchronised by the two `$D012` reads |
| 51-250 | the FLI blocks | `fli-image.md`'s timing, unchanged |
| 248 | `fli_done` | reached on cycle 61 of line 248 in every frame |
| 249 | RSEL cleared (`$33`) | written on cycle 11 of line 249 |
| 251 | `$DD00` bank 0, then `$D011` `$93` | written on cycles 20 and 32 of line 251 |
| 273 | `irq_upd` | entered on cycle 40; bank 1 back on cycle 57 |
| 274 | `$D011` `$3B` | written on cycle 12 |
| 275 | `music_play` | entered on cycle 32 of line 275 in every frame |
| 275-299 | the scroller update | ends on line 299 at the latest |

The update, tune included, took 1,538 cycles at worst over 250 moving
frames (CIA2 timers A and B cascaded, read back from RAM with the VICE
monitor), and ended on line 299 at the latest. The next FLI entry is on
line 45 of the next frame, so 58 lines were left.

### Where the play call lives

Not in the FLI lines. Each FLI block is 63 cycles: the forced badline
holds the CPU from cycle 15 to cycle 54, and the block's own 23 cycles,
`LINE_PAD` of 11 and 12 of stores, are all spent placing the `$D011`
write on cycle 15 (arithmetic from `fli-image.md`'s block). No cycle in
the band is spare for a call of any length, let alone a full player's
(`music-player.md` measures 1,250 cycles at worst, 1,198 before its
note-start fix in #118), and an interrupt
armed inside the band would not be taken: the FLI handler runs with
interrupts off from line 47 to line 251. The only places are the lines
outside the band, 251 to 44 of the next frame, and the tune is called
there, first in the line-273 handler, so it is entered on the same line
and cycle every frame.

### Why the sprites need bank 0

The FLI uses VIC bank 1 almost whole: eight screen pages at
`$4000-$5FFF` and the bitmap at `$6000-$7F3F`, which leaves 192 bytes,
three sprites. So the handler switches the VIC to bank 0 on line 251,
after the last display line and before the sprites' first pointer
fetch late in that line, and points `$D018` at screen `$0400`, whose
pointers at `$07F8` select the slots at `$2000`. The line-273 handler
switches back before the next frame's FLI. The idle byte is 0 in both
banks (`$3FFF`, `$7FFF`), so the open border areas are plain
background whichever bank is showing.

### Opening the lower border inside the FLI handler

The bottom border comparison with RSEL = 1 is on line 251, and the FLI
handler owns the CPU until then, so the RSEL write goes at the end of
the handler: after the last block, a wait for line 248, then `$33`. The
store trace puts it on line 249, cycle 11: after line 247's comparison,
which RSEL = 0 would have matched, and before line 251's.

## c64_check_compatibility

On the seven techniques in the frontmatter, with the scroller placed by
`raster_bands:` where the trace above measured it, against a graph built
from this checkout:

```
# Compatibility: fli_image + stable_raster_irq + double_irq + vic_bank_select + topbottom_border_open + sprite_border_scroller + sid_play_routine_pattern
**Verdict:** WARNINGS

Placed by the caller: sprite_border_scroller on lines 273-299 (page: movable). The line rules read these bands as stated.

## unit_shared (soft): fli_image × topbottom_border_open
## unit_contention (soft): fli_image × sprite_border_scroller
## sprite_set (soft): fli_image × sprite_border_scroller

(the entry methods' unit_shared, the shared registers and the info
findings omitted here)

## Separated by raster band (info)
- fli_image (lines 45-251) and sprite_border_scroller (lines 273-299): cpu_vs_irq does not apply.
```

The call is `c64_check_compatibility` with
`sprite_border_scroller@273-299` in place of the bare name. What each
finding says, and what the recipe does:

- `unit_shared` for topbottom_border_open: its one write is the last
  thing the FLI handler does, on cycle 11 of line 249; it needs no
  interrupt of its own.
- `unit_contention` on `vic_raster_irq`, soft: the FLI's lines 45-251
  and the scroller's 273-299 do not meet, so one compare serves both as
  a chain (`irq1`, `irq2`, `irq_upd`), each arming the next.
- `sprite_set`, soft: the FLI needs a constant sprite set on its lines.
  The eight sprites are on lines 252-272, below the FLI's last line, and
  the update writes them from line 275.
- `cpu_vs_irq` is cleared by the placed band: `irq_upd` is armed for
  line 273.

The tool raises nothing for `sid_play_routine_pattern`: the play routine
states no band and no demand of its own, because it runs inside another
technique's handler. An earlier version of this section showed four
hard findings (issue #90): `topbottom_border_open` claimed to own the
compare, and `sprite_border_scroller`'s page stated its own recipe's
lines, 20-46 and 249, as fixed, which overlap the FLI's.

## Why this works

The FLI part is `fli-image.md` unchanged, with the same `SYNC_PAD`,
`ENTRY_PAD` and `LINE_PAD`, which is why its picture matches that
recipe's to the pixel. Everything added runs after line 248, when the
last forced badline is past: the border and bank writes in the tail of
the FLI handler, the tune and the scroller in a handler of their own on
line 273, which re-arms the FLI's double IRQ for line 45 and puts back
the FLI's bank, `$D018`, `$D016` and `$D011` so that line 51 of the next
frame is a natural badline on screen page 3 again.

### NTSC

`region: pal`. Run under `-model ntsc` the same PRG shows a black
screen and a black border at 10,000,000 cycles: the FLI blocks are timed
for 63-cycle lines, and nothing else in the frame is reached as
intended. `fli-image.md` is PAL-only for the same reason.
