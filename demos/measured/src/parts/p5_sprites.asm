// p5_sprites.asm: part 5 of MEASURED, the SPRITES part.
//
// Two c64-kb recipes ported into one part module:
//   docs/recipes/kickassembler/sprites-only-screen.md (sprites_only_screen_mode)
//   docs/recipes/kickassembler/vector-balls.md        (vector_balls_sprites)
//
// The mode: five plain raster interrupts write $D011 as the recipe's table
// says (line 40 $0B, line 50 $1B, line 53 $0B, line 249 $03, line 253 $0B),
// so DEN is clear while line 48 passes (no badline all frame), set for the
// one check at line 51 (the vertical border flip-flop resets once) and RSEL
// is clear while line 251 passes (the flip-flop never sets again). $3FFF is
// 0 and border and background are black, so the picture is the sprites and
// nothing else. The balls: eight sprites on a tilted ring, one table step a
// frame, one bubble pass a frame farthest first, rank i on hardware sprite
// 7 - i so the VIC's fixed priority draws the near ball over the far one.
//
// Where this module differs from the two recipes, and why:
//   1. Interrupts enter through the sequencer's dispatcher, not $0314
//      directly: the dispatcher acknowledges $D019, saves A, X, Y and arms
//      the next line, so the handlers here only write $D011 and time
//      themselves, and end with rts. $D012 is never written by this part.
//   2. The ball update runs from the main loop after the sequencer's frame
//      flag (set by the line-255 interrupt), not from a wait on $D012 = 255.
//   3. Zero page $10 to $3F holds the recipe's variables (atmp, ytmp, ztmp,
//      order, bx, by, bz) instead of absolute bytes, plus the stopwatch sum.
//   4. Bank 0, screen $0400: the shapes sit at $3F00 (pointer $FC, big ball)
//      and $3F40 (pointer $FD, small ball), copied there by prepare; $3FFF
//      stays 0. The recipe had them at $2000 and $2040.
//   5. The ring's centre is Y 140 (recipe 130) and the tilt is 80, not the
//      recipe's 12 and not the brief's 24: with TILT 24 the table's Y runs
//      109 to 171, which never leaves the display window (lines 51 to 250),
//      so no ball could be drawn in an opened border. TILT 80 gives Y 35 to
//      245 over the table; at frame 300 the top ball is at Y 40 (drawn on
//      lines 41 to 61) and the bottom ball at Y 244 (lines 245 to 265).
//   6. The free-CPU meter of the sprites-only recipe is not ported (the
//      main loop belongs to the sequencer). The recipe's CIA1 timer A
//      bracket is kept and extended: each handler starts the timer, does
//      its write and adds its own cycles to a per-frame sum; main closes
//      the previous frame's sum into worst and typical, then brackets the
//      ball update the same way. The line-253 handler carries no latch.
//   7. The colour fade is the colour-fade recipe's luminance table
//      (order 0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1, sixteen
//      steps) kept as three 17-entry columns, for the three ball colours
//      only, stepped once every 8 frames.
//   8. selfcheck masks bit 7 of $D011 before the compare: the sequencer
//      calls it from the main loop after line 255, when the raster's ninth
//      bit is set on PAL, and that bit is the raster counter's, not DEN's.
//
// What the stopwatch bracket covers: for each handler, from its first
// instruction to its read of the timer (the dispatcher's entry and exit,
// and the handler's own add into the sum after the read, about 14 cycles,
// are outside it); for main, from the timer start to the timer stop around
// the lookup, the sort pass and the twenty-four position, pointer and
// colour writes. worst is the largest sum over the part's run, typical the
// last closed frame. The timer's own start and stop instructions, about six
// cycles per bracket, are inside the figures and not removed. Sprite DMA
// that lands on a bracket is inside it too, as in both recipes.

.namespace p5 {

.const RADIUS  = 40               // ring radius in the XZ plane
.const TILT    = 80               // y = TILT * sin(a), see note 5
.const EYE     = 200              // z of the projection plane behind the ring
.const XMID    = 172              // sprite X of the ring's centre
.const YMID    = 140              // sprite Y of the ring's centre
.const NEAR    = 120              // zd below this: white
.const MID     = 136              // zd below this: light grey, else grey
.const BIGBALL = $3f00            // pointer $FC: 24 by 21 ball, near half
.const SMLBALL = $3f40            // pointer $FD: 16 by 14 ball, far half
.const SCREEN  = $0400
.const FADE_FRAMES = 8            // frames per luminance step in fadeout
.const FADE_STEPS  = 16

// Zero page ($10 to $7F is the running part's).
.label acc      = $10             // 16-bit: this frame's cycles so far
.label tcount   = $12             // t, the table step (frame count of the part)
.label atmp     = $13
.label ytmp     = $14
.label ztmp     = $15
.label fade_ctr = $16
.label fade_lvl = $17
.label sum      = $18             // 16-bit: the last closed frame
.label order    = $20             // 8 bytes: ball index per depth rank, farthest first
.label bx       = $28             // 8 bytes: this frame's screen x per ball
.label by       = $30
.label bz       = $38

// Perspective: screen = centre + coordinate * 256 / (z + EYE).
.function proj(a, amp, centre) {
    .var rad = toRadians(a * 360 / 256)
    .var z3 = RADIUS * cos(rad)
    .return round(centre + amp * sin(rad) * 256 / (z3 + EYE))
}
.function depth(a) {
    .return round(128 + RADIUS * cos(toRadians(a * 360 / 256)))
}
// One byte of a filled ellipse rx by ry pixels, centred in a 24 by 21 sprite.
.function ballByte(row, col8, rx, ry) {
    .var v = 0
    .for (var c = 0; c < 8; c++) {
        .var x = col8 * 8 + c
        .if (pow((x - 11.5) / (rx / 2), 2) + pow((row - 10) / (ry / 2), 2) <= 1) {
            .eval v = v | (128 >> c)
        }
    }
    .return v
}
// The colour-fade recipe's luminance order and its fade[step][colour] rule.
.var lum = List().add(0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1)
.var lumpos = List()
.for (var i = 0; i < 16; i++) .eval lumpos.add(0)
.for (var i = 0; i < 16; i++) .eval lumpos.set(lum.get(i), i)
.function faded(colour, s) {
    .return lum.get(floor((lumpos.get(colour) * (FADE_STEPS - s) + 8) / 16))
}

* = P5_CODE "p5 code"

// The five handlers: timer start, one $D011 write, timer read, add to acc.
// As in the sprites-only recipe only the low byte of the count-down is
// read (the handler is far shorter than 256 cycles, so the high byte is
// still $FF): elapsed = $FF - $DC04. 34 cycles from the first instruction
// to the rts, 39 when the sum's low byte carries (arithmetic). The
// line-253 handler enters at line 254 cycle 13 to 20 through the KERNAL
// and the dispatcher (traced), so it must be this short to end before the
// sequencer's line 255.
.macro Slot(val) {
        lda #$19
        sta $dc0e                 // timer A: one shot from $FFFF, starts now
        lda #val
        sta $d011
        lda $dc04                 // low byte of the count-down: cost so far
        eor #$ff
        clc
        adc acc
        sta acc
        bcc !+
        inc acc+1
!:      rts
}

h40:    Slot($0b)                 // DEN clear before line 48: no badlines this frame
h50:    Slot($1b)                 // DEN set before line 51: the flip-flop resets
h53:    Slot($0b)                 // DEN clear again; nothing sets the flip-flop
h249:   Slot($03)                 // RSEL clear before line 251: 251 is not a match
h252:   Slot($0b)                 // RSEL set again: next frame's 247 is not either

irq_count:   .byte 5
irq_lines:   .byte 40, 50, 53, 249, 252
irq_hi:      .byte 0, 0, 0, 0, 0
irq_lo:      .byte <h40, <h50, <h53, <h249, <h252
irq_hi_addr: .byte >h40, >h50, >h53, >h249, >h252
worst:       .word 0
typical:     .word 0

// prepare: shapes into bank 0, variables to their start values. No VIC writes.
prepare:
        ldx #0
!:      lda shapes_src,x
        sta BIGBALL,x
        inx
        cpx #128
        bne !-
        lda #0
        sta worst
        sta worst+1
        sta typical
        sta typical+1
        rts

// setup: every VIC register the contract lists, the sprites for frame 0,
// the stopwatch's latch. Interrupts are off while this runs.
setup:
        lda #$0b
        sta $d011                 // display off, RSEL set: the mode's resting value
        lda #$c8
        sta $d016
        lda #$15
        sta $d018                 // screen $0400
        lda #$3f
        sta $dd02
        lda #$c7
        sta $dd00                 // bank 0
        lda #0
        sta $d020
        sta $d021
        sta $d017                 // no expansion
        sta $d01d
        sta $d01c                 // single colour
        sta $d01b                 // sprites in front
        sta $d010
        sta IDLE_BYTE             // $3FFF: the idle fetch draws background
        ldx #0                    // screen RAM blank, colour RAM black: the
        lda #$20                  // display is off, so neither is ever shown
!:      sta SCREEN,x
        sta SCREEN+$100,x
        sta SCREEN+$200,x
        sta SCREEN+$300,x
        inx
        bne !-
        lda #0
!:      sta $d800,x
        sta $d900,x
        sta $da00,x
        sta $db00,x
        inx
        bne !-
        ldx #7
!:      lda #BIGBALL/64
        sta SCREEN+$3f8,x
        lda #1
        sta $d027,x
        dex
        bpl !-
        lda #$ff
        sta $dc04                 // timer A latch $FFFF; each bracket restarts it
        sta $dc05
        lda #0
        sta $dc0e
        // zero-page init: runs here, not in prepare, because $10-$7F belongs to
        // the running part and prepare executes while the previous part is live.
        ldx #7                    // order[i] = 7 - i: hardware sprite k shows ball k
!:      lda sprn,x
        sta order,x
        dex
        bpl !-
        lda #0
        sta tcount
        sta acc
        sta acc+1
        sta sum
        sta sum+1
        sta fade_ctr
        sta fade_lvl
        jsr update                // positions, pointers and colours for t = 0
        lda #$ff
        sta $d015
        rts

// main: close the previous frame's bracket, then the ball update inside a new one.
main:
        lda acc
        sta sum
        sta typical
        lda acc+1
        sta sum+1
        sta typical+1
        lda #0
        sta acc
        sta acc+1
        lda worst+1               // worst = max(worst, sum)
        cmp sum+1
        bcc newmax
        bne nomax
        lda worst
        cmp sum
        bcs nomax
newmax: lda sum
        sta worst
        lda sum+1
        sta worst+1
nomax:
        inc tcount                // t advances by 1
        lda #$19
        sta $dc0e
        jsr update
        lda #0
        sta $dc0e
        lda $dc04
        eor #$ff
        clc
        adc acc
        sta acc
        lda $dc05
        eor #$ff
        adc acc+1
        sta acc+1
        rts

// update: lookup at t, one bubble pass, assign to the hardware sprites.
update:
        lda tcount                // ball k reads px, py, zd at a = t + 32k
        ldx #0
look:   sta atmp
        tay
        lda px,y
        sta bx,x
        lda py,y
        sta by,x
        lda zd,y
        sta bz,x
        lda atmp
        clc
        adc #32
        inx
        cpx #8
        bne look

        ldx #0                    // one bubble pass, zd descending: order[0] is the farthest
pass:   ldy order,x
        lda bz,y
        ldy order+1,x
        cmp bz,y
        bcs !+                    // zd[i] >= zd[i+1]: in order
        lda order,x               // else swap the pair
        sta order+1,x
        tya
        sta order,x
!:      inx
        cpx #7
        bne pass

        ldx #0                    // order[i] goes to hardware sprite 7 - i
assign: ldy order,x
        lda bz,y
        sta ztmp
        lda by,y
        sta ytmp
        lda bx,y
        ldy pairs,x               // 2 * (7 - i)
        sta $d000,y
        lda ytmp
        sta $d001,y
        ldy sprn,x                // 7 - i
        lda ztmp
        cmp #128
        bcs !+                    // zd >= 128: far, small ball
        lda #BIGBALL/64
        bne ptr
!:      lda #SMLBALL/64
ptr:    sta SCREEN+$3f8,y
        lda ztmp
        ldy fade_lvl
        cmp #NEAR
        bcs !+
        lda fade_white,y
        jmp col
!:      cmp #MID
        bcs !+
        lda fade_lgrey,y
        jmp col
!:      lda fade_grey,y
col:    ldy sprn,x
        sta $d027,y
        inx
        cpx #8
        bne assign
        lda #0                    // no table X is past 232 (.errorif below), so
        sta $d010                 // every ninth bit is 0; written every frame
        rts

// fadeout: one luminance step every FADE_FRAMES frames; at step 16 every
// ball colour is black, so the sprites go off and the part reports done.
fadeout:
        lda fade_lvl
        cmp #FADE_STEPS
        bcs fade_done
        inc fade_ctr
        lda fade_ctr
        cmp #FADE_FRAMES
        bcc fade_going
        lda #0
        sta fade_ctr
        inc fade_lvl
fade_going:
        lda #0
        rts
fade_done:
        lda #0
        sta $d015
        lda #1
        rts

// cleanup: the sequencer has removed the part's lines. Wait for line 250,
// then the contract's resting values. The stopwatch is stopped, $3FFF stays 0.
cleanup:
!:      lda $d011
        bmi !-
        lda $d012
        cmp #250
        bne !-
        lda #$1b
        sta $d011
        lda #$c8
        sta $d016
        lda #$15
        sta $d018
        lda #0
        sta $d015
        sta $d020
        sta $d021
        sta $dc0e
        lda #$c7
        sta $dd00
        rts

// selfcheck: one byte of each table, read from RAM at a fixed index, equals
// the value the assembler computed for it (a table assembled under I/O
// reads a VIC register mirror here, and the register compare below cannot
// see that, because the registers were written from the same reads: I-008);
// then $D011's low seven bits read $0B (DEN clear, RSEL set), $D010 reads 0,
// and the VIC's sixteen position registers hold the table's values for the
// sorted order at t. A = 1 only when all of that is read back.
selfcheck:
        lda px + 0
        cmp #proj(0, RADIUS, XMID)
        bne sc_fail
        lda py + 64
        cmp #proj(64, TILT, YMID)
        bne sc_fail
        lda zd + 128
        cmp #depth(128)
        bne sc_fail
        lda $d011
        and #$7f
        cmp #$0b
        bne sc_fail
        lda $d010
        bne sc_fail
        ldx #0
sc_loop:
        lda order,x               // ball at rank x
        asl
        asl
        asl
        asl
        asl                       // 32 * ball
        clc
        adc tcount
        sta atmp                  // a = t + 32 * ball
        tay
        lda px,y
        ldy pairs,x
        cmp $d000,y
        bne sc_fail
        ldy atmp
        lda py,y
        ldy pairs,x
        cmp $d001,y
        bne sc_fail
        inx
        cpx #8
        bne sc_loop
        lda #1
        rts
sc_fail:
        lda #0
        rts

pairs:  .byte 14, 12, 10, 8, 6, 4, 2, 0
sprn:   .byte 7, 6, 5, 4, 3, 2, 1, 0

// The colour-fade table's columns for the three ball colours: entry s is
// the colour after s luminance steps; entry 16 is black for all three.
fade_white: .fill FADE_STEPS + 1, faded(1, i)
fade_lgrey: .fill FADE_STEPS + 1, faded(15, i)
fade_grey:  .fill FADE_STEPS + 1, faded(12, i)

// The two shapes, copied to $3F00 by prepare: 64 bytes each.
shapes_src:
.for (var r = 0; r < 21; r++) { .byte ballByte(r, 0, 24, 21), ballByte(r, 1, 24, 21), ballByte(r, 2, 24, 21) }
.byte 0
.for (var r = 0; r < 21; r++) { .byte ballByte(r, 0, 16, 14), ballByte(r, 1, 16, 14), ballByte(r, 2, 16, 14) }
.byte 0

// The CPU reads $A000-$BFFF as BASIC ROM and $D000-$DFFF as I/O while
// $01 = $37, so nothing this part reads may be assembled there. The page
// tables once followed the code at P5_CODE + $0500, which was $CD00 when
// P5_CODE was $C800 and became $D100 when it moved to $CC00: every lookup
// then read a VIC register mirror and the picture was one grey ball at
// (255, 255). See the integration record, I-008.
.errorif * > $d000, "p5 code and small tables reach the I/O area at $D000"
.errorif (P5_TABLES & $ff) != 0, "p5 tables must start on a page: the bracket figures assume no page crossing"
.errorif !((P5_TABLES + $300 <= $a000) || (P5_TABLES >= $c000 && P5_TABLES + $300 <= $d000)), "p5 tables must sit in RAM the CPU sees with $01 = $37"

* = P5_TABLES "p5 tables"
px: .fill 256, proj(i, RADIUS, XMID)
py: .fill 256, proj(i, TILT, YMID)
zd: .fill 256, depth(i)
.for (var i = 0; i < 256; i++) {
    .errorif proj(i, RADIUS, XMID) > 255 - 23, "a ball would cross X 255"
    .errorif proj(i, TILT, YMID) > 255, "a ball's Y would not fit the register"
    .errorif proj(i, TILT, YMID) < 0, "a ball's Y would be negative"
}

}
