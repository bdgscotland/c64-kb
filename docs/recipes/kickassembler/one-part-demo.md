---
recipe: one-part-demo
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [sideborder_open, topbottom_border_open, sprite_border_scroller, raster_bars, stable_raster_irq, double_irq, sid_play_routine_pattern]
raster_bands: [raster_bars@17-50, sideborder_open@248-272, sprite_border_scroller@273-311,0-1]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D016, D017, D019, D01A, D01B, D01C, D01D, D020, D021, D027, D400, D418, DC0D, DD04, DD05, DD0E, DD0F]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), zero_page $FB-$FE (owns)]
harness: [cia2_timer_a, cia2_timer_b, $02FF]
ram: [sprites=$2000-$21FF, idle=$3FFF, colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — A one-part demo with every border open

## Synopsis

Four techniques that each want part of the same frame, scheduled into one
PAL frame: raster bars in the opened top border, a line of text on the
screen, a scroller of eight sprites in the opened lower border with both
side borders open around it, and a two-voice SID tune. Two double-IRQ
entries give the two stable regions; everything else runs in the time
they leave. The page's cycle map says which lines each piece owns and
was measured with the VICE monitor, and the update's worst cost was
measured with the CIA2 timers. The side-border loop and the bars are the
ones in `sideborder-open.md` and `raster-bars.md`, placed where the frame
has no badline; the sprite scroller is `sprite-border-scroller.md`'s,
spread over the whole 504-position X range because the side borders are
open. PAL only: NTSC is measured below and does not work.

## Source

```asm
// one-part-demo.asm
// A one-part demo in one frame, PAL: raster bars in the opened top border,
// a line of text on the screen, and a sprite scroller in the opened lower
// border with both side borders open around it, to a SID tune.
//
// The frame, line by line (PAL, 312 lines of 63 cycles):
//   17-19    irq_top: double IRQ; the stable entry is on line 19
//   20-49    bars: one colour to $D020 (cycle 63) and $D021 (cycle 4 of the
//            next line) per line, so lines 21-50 are coloured; 63 cycles a
//            line, every cycle the CPU's (no badline above line 51, no sprite)
//   50-247   the main loop: waits, then prints the figures once (the
//            KERNAL is not called)
//   248-250  irq_bot: double IRQ; RSEL cleared on line 248, after line 247's
//            bottom comparison and before line 251's: the vertical border
//            never starts, so the lower border and next frame's top border
//            show the background (topbottom_border_open)
//   251-271  the side border loop: DEC $D016 writes CSEL = 0 on cycle 56 of
//            each line, so neither side comparison fires (sideborder_open).
//            All eight sprites are on lines 252-272, so the VIC takes the bus
//            from cycle 55 to cycle 10 on every line alike, and no line from
//            248 on is a badline
//   272-     RSEL back, then the update: the tune, the bar table, the eight
//            sprites' X and a glyph render when one is due; timed with the
//            CIA2 timers
// After FRAMES frames the bars and the scroller stop, so the picture is the
// same at any later cycle; the tune goes on.

BasicUpstart2(start)

.const SCREEN      = $0400
.const SPRBASE     = $2000          // eight 64-byte slots, pointers $80-$87
.const BAR_TOP     = 20             // first bar line; the loop runs BAR_LINES lines
.const BAR_LINES   = 30
.const REGION_TOP  = 251            // sprites' Y and the first side-border line
.const REGION_LINES = 21            // unexpanded sprites: 21 lines of DMA
.const SYNC_PAD    = 11             // as sideborder-open.md: same code path to the sync
.const ENTRY_PAD   = 43             // cycles from the sync to the first DEC, as there
.const BAR_PAD     = 50             // cycles from the sync to the first bar store; measured
.const XSTEP       = 63             // 8 x 63 = 504, the whole PAL X range
.const FRAMES      = 250            // updates before the picture stops
.const RESULT      = $02ff          // 1 once frozen
.const BORDER      = 11             // dark grey: a closed border shows it, an open one black

.const ptr = $fb                    // zero page: slot pointer
.const src = $fd                    // zero page: character ROM pointer

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

// dbl(b): each glyph bit doubled, as in sprite-border-scroller.md
.function dbl(b) {
    .var e = 0
    .for (var i = 0; i < 8; i++) {
        .if (((b >> i) & 1) == 1) .eval e = e | (3 << (2 * i))
    }
    .return e
}

start:
    sei
    lda #$7f
    sta $dc0d                       // every CIA1 interrupt off
    lda $dc0d
    lda #0
    sta $3fff                       // idle-state graphics byte: plain background
    sta $d021
    sta frame
    sta tidx
    sta RESULT
    lda #BORDER
    sta $d020
    lda #<200                       // p: sprite 0 starts at X 200
    sta pos
    lda #>200
    sta pos+1

    ldx #0                          // clear the screen and the sprite slots
!:  lda #$20
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    lda #0
    sta SPRBASE,x
    sta SPRBASE+$100,x
    inx
    bne !-
    ldx #TITLE_LEN-1                // the text line, row 12, white
!:  lda title,x
    sta SCREEN+12*40+(40-TITLE_LEN)/2,x
    lda #1
    sta $d800+12*40+(40-TITLE_LEN)/2,x
    dex
    bpl !-

    ldx #7                          // pointers, colours, Y, and a first glyph each
!:  txa
    clc
    adc #SPRBASE/64
    sta SCREEN+$3f8,x
    lda spr_col,x
    sta $d027,x
    ldy pairs,x
    lda #REGION_TOP
    sta $d001,y
    dex
    bpl !-
    lda #0
    sta $d017
    sta $d01d
    sta $d01c
    sta $d01b
    lda #$ff
    sta $d015                       // all eight, every frame: a constant set
    ldx #7
!:  stx slot
    jsr next_char
    ldx slot
    dex
    bpl !-
    jsr place

    jsr music_init
    jsr build_bars

    lda #<irq_top1
    sta $0314
    lda #>irq_top1
    sta $0315
    lda #$1b
    sta $d011
    lda #$c8
    sta $d016
    lda #BAR_TOP - 3
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
!:  lda RESULT                      // the main loop: wait for the freeze,
    beq !-                          // then print the figures once, outside
    jsr report                      // the interrupts
    jmp *

// ---------------------------------------------------------------- top
irq_top1:
    lda #<irq_top2
    sta $0314
    lda #>irq_top2
    sta $0315
    lda #BAR_TOP - 1
    sta $d012
    lda #$01
    sta $d019
    tsx
    stx saved_sp
    cli
    .for (var i = 0; i < 40; i++) { nop }

irq_top2:
    ldx saved_sp
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+
!:  ldx #0
    Delay(BAR_PAD)
bar:
    lda bars,x                      // 4
    sta $d020                       // 4
    sta $d021                       // 4
    inx                             // 2
    cpx #BAR_LINES                  // 2
    beq bar_done                    // 2 not taken
    Delay(42)
    jmp bar                         // 3: 63 a line
bar_done:
    lda #BORDER                     // line 50, cycle 1: both before the picture
    sta $d020
    lda #0
    sta $d021
    lda #<irq_bot1
    sta $0314
    lda #>irq_bot1
    sta $0315
    lda #REGION_TOP - 3
    sta $d012
    lda #$01
    sta $d019
    jmp $ea81                       // pla/tay/pla/tax/pla/rti

// ---------------------------------------------------------------- bottom
irq_bot1:
    lda #$13                        // RSEL = 0 on line 248: after line 247's bottom
    sta $d011                       // comparison, before line 251's; the border never starts
    lda #<irq_bot2
    sta $0314
    lda #>irq_bot2
    sta $0315
    lda #REGION_TOP - 1
    sta $d012
    lda #$01
    sta $d019
    tsx
    stx saved_sp
    cli
    .for (var i = 0; i < 40; i++) { nop }

irq_bot2:
    ldx saved_sp
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+
!:  ldx #0
    Delay(ENTRY_PAD)
side:
    dec $d016                       // writes $C7 (CSEL = 0) on cycle 56
    inc $d016                       // after the sprite stall: $C8 again
    Delay(8)
    inx
    cpx #REGION_LINES
    beq side_done
    Delay(17)
    jmp side
side_done:
    lda #$1b                        // RSEL back: line 251 has passed
    sta $d011

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
    lda $d012                       // while bit 8 ($D011 bit 7) is set, else
    bit $d011                       // 312 + $D012: it has run into the next frame
    bmi end_hi
    clc
    adc #<312
    ldx #>312
    bcc end_hi
    inx
end_hi:
    cpx endline+1                   // keep the latest over the run
    bcc !++
    bne !+
    cmp endline
    bcc !++
!:  sta endline
    stx endline+1
!:  lda $dd04                       // the update's cycles (under 65,536), inverted
    eor #$ff
    tax
    lda $dd05
    eor #$ff
    cmp upd+1                       // keep the most over the run
    bcc !++
    bne !+
    cpx upd
    bcc !++
!:  stx upd
    sta upd+1
!:

    lda #<irq_top1
    sta $0314
    lda #>irq_top1
    sta $0315
    lda #BAR_TOP - 3
    sta $d012
    lda #$01
    sta $d019
    jmp $ea81

// ---------------------------------------------------------------- update
update:
    jsr music_play
    lda RESULT
    bne frozen
    inc frame
    lda frame
    cmp #FRAMES
    bne !+
    lda #1
    sta RESULT
!:  inc bphase
    inc bphase
    jsr build_bars
    lda pos                         // p = (p - 2) mod 504
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
    beq frozen
    ldx pend
    dex
    stx slot
    jsr next_char
frozen:
    rts

// place: sprite k at X = (p + 63k) mod 504; pend = k + 1 for the sprite
// whose X is 440 or 441, out of sight between the right and left borders.
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
    lda xl                          // X >= 504 ? X -= 504
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

// next_char: the next character of the text into sprite slot `slot`
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
    lda #$33                        // character ROM in, for eight reads
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

// build_bars: BAR_LINES colours, black with three seven-line bars on a sine
build_bars:
    ldx #BAR_LINES-1
    lda #0
!:  sta bars,x
    dex
    bpl !-
    lda #0
    sta bar_n
bb_next:
    lda bar_n                       // phase = bphase + 21 * n
    asl
    asl
    asl
    asl
    clc
    adc bar_n
    adc bar_n
    adc bar_n
    adc bar_n
    adc bar_n
    adc bphase
    and #63
    tay
    lda sine,y                      // top line of this bar, 0..23
    tax
    lda bar_n
    asl
    asl
    asl                             // 8 bytes of ramp per bar
    tay
    lda #7
    sta cnt
!:  lda ramps,y
    sta bars,x
    inx
    iny
    dec cnt
    bne !-
    inc bar_n
    lda bar_n
    cmp #3
    bne bb_next
    rts

// ---------------------------------------------------------------- report
// Once, at the freeze: the most cycles one update took and the latest line
// one ended on, over the moving frames, row 14.
report:
    ldx #0
!:  lda rtext,x
    beq !+
    sta SCREEN+14*40+3,x
    lda #15
    sta $d800+14*40+3,x
    inx
    bne !-
!:  lda upd
    sta num
    lda upd+1
    sta num+1
    ldx #10
    jsr dec5
    lda endline
    sta num
    lda endline+1
    sta num+1
    ldx #34
    jsr dec5
    rts

// dec5: num as five digits at row 14, column X, leading zeros kept
dec5:
    stx doff
    ldy #0
d5_digit:
    lda #0
    sta dig
d5_sub:
    lda num
    sec
    sbc pow_lo,y
    pha
    lda num+1
    sbc pow_hi,y
    bcc d5_out
    sta num+1
    pla
    sta num
    inc dig
    bne d5_sub
d5_out:
    pla
    lda dig
    ora #$30
    ldx doff
    sta SCREEN+14*40,x
    lda #15
    sta $d800+14*40,x
    inc doff
    iny
    cpy #5
    bne d5_digit
    rts
pow_lo: .byte <10000, <1000, <100, <10, <1
pow_hi: .byte >10000, >1000, >100, >10, >1

// ---------------------------------------------------------------- music
// Two voices: a pulse bass on voice 1 and a triangle lead on voice 2, one
// step every six frames through a 32-step pattern. Frequencies are PAL.
.function freq(n) { .return round(440 * pow(2, (n - 69) / 12) * 16777216 / 985248) }

music_init:
    ldx #$18
    lda #0
!:  sta $d400,x
    dex
    bpl !-
    lda #$0f
    sta $d418                       // volume 15, no filter
    lda #$08
    sta $d403                       // voice 1 pulse width $0800
    lda #$09
    sta $d405                       // voice 1 AD
    lda #$a0
    sta $d406                       // voice 1 SR
    lda #$0a
    sta $d40c                       // voice 2 AD
    lda #$60
    sta $d40d                       // voice 2 SR
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
    lda #$40                        // gate off: the envelope releases, then restarts
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
    lda #$41                        // pulse, gate on
    sta $d404
    lda #$11                        // triangle, gate on
    sta $d40b
    inx
    txa
    and #31
    sta mstep
mp_out:
    rts

// Note numbers (MIDI): A minor, bass on the root and fifth, lead arpeggio.
bass: .byte 33,33,40,40, 33,33,40,40, 29,29,36,36, 29,29,36,36
      .byte 31,31,38,38, 31,31,38,38, 28,28,35,35, 28,28,35,35
lead: .byte 69,72,76,72, 69,72,76,79, 65,69,72,69, 65,69,72,77
      .byte 67,71,74,71, 67,71,74,79, 64,68,71,68, 64,68,71,76
ftab_lo: .fill 96, <freq(i)
ftab_hi: .fill 96, >freq(i)

// ---------------------------------------------------------------- data
.encoding "screencode_upper"
title:  .text "ONE PART, ONE FRAME, EVERY BORDER OPEN"
.label TITLE_LEN = * - title
rtext:  .text "UPDATE       CYCLES, ENDS LINE"
        .byte 0
text:   .text "THE BORDERS ARE OPEN ON ALL FOUR SIDES    "
        .byte $ff
spr_col: .byte 1, 7, 3, 13, 1, 7, 3, 13
bits:   .byte 1, 2, 4, 8, 16, 32, 64, 128
pairs:  .byte 0, 2, 4, 6, 8, 10, 12, 14
slotlo: .fill 8, <(SPRBASE + i * 64)
slothi: .fill 8, >(SPRBASE + i * 64)
ramps:  .byte 9, 2, 8, 10, 8, 2, 9, 0      // red
        .byte 6, 14, 3, 1, 3, 14, 6, 0     // blue
        .byte 11, 5, 13, 1, 13, 5, 11, 0   // green
sine:   .fill 64, round(11.5 + 11.5 * sin(toRadians(i * 360 / 64)))

.align $100
t0:   .fill 256, dbl(i) >> 12
t1:   .fill 256, (dbl(i) >> 4) & $ff
t2:   .fill 256, (dbl(i) & $0f) << 4

bars:     .fill BAR_LINES, 0
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
bphase:   .byte 0
bar_n:    .byte 0
cnt:      .byte 0
upd:      .word 0
endline:  .word 0
num:      .word 0
dig:      .byte 0
doff:     .byte 0
mtick:    .byte 0
mstep:    .byte 0
.assert "the program stays below $2000 (sprite slots) and $3FFF", * <= SPRBASE, true
```

## Build

```bash
java -jar KickAss.jar one-part-demo.asm -o one-part-demo.prg
```

Produces `one-part-demo.prg`, `$0801` to `$143D`. The sprite slots at
`$2000` and the idle byte at `$3FFF` are written at run time.

## Expected output

Screenshot from the pinned run, 10,000,000 cycles, PAL:
`screenshots/one-part-demo.png`. The border is dark grey (98, 98, 98),
palette index 11, and the background black, so every place a border was
opened shows black where the grey would be. Measured with PIL, per raster
line (screenshot row + 16), the dominant colour of the left border
(x 0-31), the centre (x 32-351) and the right border (x 352-383):

| Lines | Left | Centre | Right | What it shows |
|---|---|---|---|---|
| 16-20 | grey | black | grey | top border open: background, not border |
| 21-50 | bar | bar | bar | 30 bar lines, one colour across the whole width |
| 51-251 | grey | black | grey | the screen; the text on rows 12 and 14 |
| 252 | grey | black | black | the right border opens first |
| 253-271 | black | black | black | both side borders open |
| 272 | black | black | grey | the left border of the line after the last write |
| 273-287 | grey | black | grey | bottom border open, side borders closed |

Line 50 has black in its left border and grey in its right: the last
table entry is black, and the grey store lands on cycle 17 of line 50,
after the left border has been drawn. The bars are three seven-line
gradients (red, blue, green) on a sine, frozen where frame 250 left them:
at the pin the red bar is on lines 22-28, the green on 35-41 and the blue
on 41-47, its first line under the green's last (the table is built red,
blue, green, so green wins).

In lines 252-272 the eight sprites carry the scroller's letters in white,
yellow, cyan and light green. Counting non-black pixels in that band:
42 yellow pixels in the left border and 16 cyan in the right, so letters
are drawn where the borders were. A sprite whose X is between 376 and
495 is out of sight in the horizontal blank, which is where a sprite is
handed its next letter.

Row 12 reads `ONE PART, ONE FRAME, EVERY BORDER OPEN`. Row 14 is printed
once by the main loop after the freeze:

```
   UPDATE 02573 CYCLES, ENDS LINE 00314
```

the most cycles one update took over the 250 moving frames, and the
latest line one ended on, counted past 311 into the next frame
(314 is line 2 of the next frame).

## The frame, measured

Measured in VICE x64sc 3.10 (PAL C64C) with `trace exec` on each entry
point and `trace store` on `$D011`, `$D016`, `$D020` and `$D021`, over
the 352 frames of a 10,000,000-cycle run. Cycles are Bauer's, 1 to 63: an exec trace's CYC plus one, a
store trace's CYC as printed (`runtime/vice-reference.md`, "What the CYC
column counts").

| Lines | Code | Measured |
|---|---|---|
| 17 | `irq_top1`, through the KERNAL's `$FF48` dispatcher | entered on cycle 39 to 43 |
| 19 | `irq_top2`, the second IRQ inside the NOP slide | synchronised by the two `$D012` reads |
| 20-49 | `bar`, 63 cycles a pass | first instruction on cycle 56 of every line in every frame; `$D020` written on cycle 63, `$D021` on cycle 4 of the next line |
| 50 | `bar_done` | `$D020` grey on cycle 17, `$D021` black on 23 |
| 51-247 | main loop | idle until the freeze |
| 248 | `irq_bot1` | entered on cycle 40 to 43; RSEL cleared on cycle 45 |
| 250 | `irq_bot2` | synchronised |
| 251 | `side`, first pass | `DEC $D016` writes on cycle 54, two early: line 251 is not opened |
| 252-271 | `side` | first instruction on cycle 51, `$C7` written on cycle 56, `$C8` back on cycle 16 of the next line, every line of every frame |
| 272 | `side_done` | RSEL back on cycle 37 |
| 273 to line 1 of the next frame | `update` | 2,573 cycles at worst (a frame that renders a glyph); `upd_end` reached on line 1 of the next frame at the latest, on line 301 or 302 in most frames |

The update has from line 273 to line 17 of the next frame, when the top
IRQ is due: 56 lines, 3,528 cycles (arithmetic). Its worst took 2,573
and ended on line 1, 16 lines before the top IRQ. Were it to run past line 17, `irq_top1` would wait
for it, the double IRQ would still synchronise, but the bars would start
late or lose lines.

Why the regions do not collide:

- The bars run on lines 20-49: above line 51, the first badline, and
  with no sprite on those lines, so the loop owns every cycle and needs
  no stall accounting. The top border there is open because RSEL was
  cleared on the previous frame's line 248, and it stays open until the
  top comparison on line 51.
- The side-border loop runs on lines 251-271, below line 247, the last
  line a badline can occur ($30-$F7), so the loop needs none of
  `sideborder-open.md`'s YSCROLL rewrites. All eight sprites have Y 251
  and are enabled in every frame, so the VIC takes the bus from cycle 55
  to cycle 10 on each of those lines alike; the eight positions change
  but the set does not (`constant_sprite_set`).
- RSEL is cleared on line 248 inside `irq_bot1`, before the double IRQ.
  The first build cleared it after the sync: `irq_bot2` is entered on
  cycle 40 of line 250 and the sync and the write take about 36 cycles
  more, which puts the write early in line 251, after that line's bottom
  comparison (arithmetic from the exec trace). The bottom border closed
  and hid every sprite. Moving it to line 248 made
  no change to the sync, which depends only on where in line 250 the
  second IRQ lands.
- The sprites' registers are written only by the update, from line 273,
  after the band has been drawn.
- The tune is called first in the update, so its entry moves only with
  the side loop's exit, which is fixed: `music_play` is entered on
  cycle 27 of line 273 in every one of 354 frames (exec trace).

## c64_check_compatibility

On the seven techniques in the frontmatter, with the bands of
`raster_bands:` placed as the trace above measured them, against a graph
built from this checkout:

```
# Compatibility: sideborder_open + topbottom_border_open + sprite_border_scroller + raster_bars + stable_raster_irq + double_irq + sid_play_routine_pattern
**Verdict:** WARNINGS

Placed by the caller: sideborder_open on lines 248-272 (page: movable); sprite_border_scroller on lines 0-1,273-311 (page: movable); raster_bars on lines 17-50 (page: no band). The line rules read these bands as stated.

## unit_shared (soft): sideborder_open × topbottom_border_open
## unit_contention (soft): sideborder_open × sprite_border_scroller
## sprite_set (soft): sideborder_open × sprite_border_scroller
## unit_contention (soft): sideborder_open × raster_bars
## unit_shared (soft): topbottom_border_open × raster_bars
## unit_contention (soft): sprite_border_scroller × raster_bars

(the entry methods' unit_shared, the shared registers and the info
findings omitted here)

## Separated by raster band (info)
- sideborder_open (lines 248-272) and sprite_border_scroller (lines 0-1,273-311): cpu_vs_irq does not apply.
- sideborder_open (lines 248-272) and raster_bars (lines 17-50): cpu_vs_irq does not apply.
```

The call is `c64_check_compatibility` with
`sideborder_open@248-272`, `sprite_border_scroller@273-311,0-1` and
`raster_bars@17-50` in place of the bare names. What each finding
says, and what the recipe does:

- `unit_contention` on `vic_raster_irq` (three pairs), soft: the bands do
  not meet, so one compare serves all three as a chain. The recipe's
  chain is four handlers (`irq_top1`, `irq_top2`, `irq_bot1`,
  `irq_bot2`), each arming the next.
- `unit_shared` for topbottom_border_open: its RSEL write is one store
  inside `irq_bot1`, on cycle 45 of line 248.
- `sprite_set`, soft: the scroller's eight sprites are the side-border
  loop's constant set. All eight have Y 251 and are enabled in every
  frame; the update writes their registers from line 273, after the
  loop.
- `cpu_vs_irq` is cleared by the placed bands: no interrupt is armed
  inside lines 248-272.

Without the placements, `sideborder_open`'s band is movable and
`raster_bars` states none, so `cpu_vs_irq` and the three contentions
stay hard; the rationale says which band is unknown. An earlier version
of this section showed eight hard findings and filed the sprite
contention as a disagreement with the measurement (issue #90):
`sideborder_open` claimed `sprite_0-7 (owns)` and `topbottom_border_open`
claimed to own the compare, and the check had no way to be told the
bands.

## Why this works

### Two stable regions, one per double IRQ

Each timed region has its own double IRQ, copied from
`sideborder-open.md` with the same instructions before the sync, so the
same `SYNC_PAD` of 11 serves both. The first IRQ arms the second two
lines on and spins in `NOP`s; the second lands with one cycle of jitter,
which the two `$D012` reads remove. `BAR_PAD` was set by measurement: at
38 the bar stores landed on cycle 51 and split every bar at screenshot
x 305; at 50 both stores fall in the horizontal blank.

### Opening every border

The vertical border opens by clearing RSEL between the line-247 and
line-251 comparisons (`topbottom_border_open`): nothing sets the
vertical flip-flop, so the lower border of this frame and the top border
of the next show the background. The side borders open by writing CSEL
= 0 on cycle 56, between the two horizontal comparisons, on every line
(`sideborder_open`); the write opens that line's right border and the
next line's left, which is why the left column of the table lags the
right by one line.

### The sprite scroller across 504 positions

With the side borders open, X 0 to 23 and 344 to 375 are visible, so the
scroller cannot hide its hand-off under a border as
`sprite-border-scroller.md` does. It uses the part of the X range that
is never drawn: X runs 0 to 503 on PAL and the screen shows X 496 to 503
and 0 to 375, so 376 to 495 is out of sight. Eight sprites 63 apart fill
the 504 positions exactly; a sprite takes its next letter when its X is
440 or 441.

### NTSC

`region: pal`. Run under `-model ntsc` (6567R8, 263 lines of 65 cycles)
the same PRG draws the bars broken across each line, the lower border
closed from line 254 and no sprites: the side loop assumes 63 cycles a
line, and its 21-line band from 251 runs past line 262, the last line of
an NTSC frame. An NTSC version needs its band inside lines 251-262 or in
the top border, and the loop re-timed for 65 cycles as `dysp.md` does.
