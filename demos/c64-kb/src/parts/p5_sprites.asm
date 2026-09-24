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
// nothing else. The balls: twenty-four on the tilted ring over the eight
// sprites, multiplexed. Each frame's schedule is the balls in Y order, ball
// i on sprite i mod 8, due at the top row for the first eight and at the
// previous ball's Y + FREE_AFTER after that; fixed raster rows twenty lines
// apart take every entry due by them, so no row is ever armed too late for
// the dispatcher's sequential walk (which loses a frame per miss). The
// rows write the gradient to $D021 as they go. Three schedule buffers let
// main publish whenever it finishes; the top row takes the newest whole
// one. Projection and sort run on even frames, the build on odd ones, to
// keep a frame's brackets under the NTSC budget.
//
// Where this module differs from the two recipes, and why:
//   1. Interrupts enter through the sequencer's dispatcher, not $0314
//      directly: the dispatcher acknowledges $D019, saves A, X, Y and arms
//      the next line, so the handlers here only write $D011 and time
//      themselves, and end with rts. $D012 is never written by this part.
//   2. The ball update runs from the main loop after the sequencer's frame
//      flag (set by the line-255 interrupt), not from a wait on $D012 = 255.
//   3. Zero page $10 to $7F holds the recipe's variables (order, bx, by, bz,
//      24 bytes each) instead of absolute bytes, plus the stopwatch sums and
//      the builder's scratch; the schedule and its tables sit in RAM under
//      BASIC ROM at $B000 (prepare sets $01 = $36, cleanup puts $37 back).
//   4. Bank 0, screen $0400: the shapes sit at $3F00 (pointer $FC, big ball)
//      and $3F40 (pointer $FD, small ball), copied there by prepare; $3FFF
//      stays 0. The recipe had them at $2000 and $2040.
//   5. The ring's centre is Y 140 (recipe 130). Until 2026-09-24 X and Y
//      both rode the sine (radius 80, tilt 72, a perspective divide), so the
//      ring was always seen edge-on: one diagonal of twelve near-and-far
//      pairs. Now X rides the cosine (radius 127: X 45 to 299, the whole
//      span the ninth-bit scheme can tell apart, a table byte under XWRAP
//      meaning 256 + it), Y the sine (tilt 104: Y 36 to 244), and the depth
//      the sine too, so the ball at the bottom centre is nearest. The tilt
//      cannot be smaller: the fixed rows' proof after the tables needs the
//      eighth ball down in Y order 50 lines under its predecessor, and that
//      gap is half the tilt at worst (tilt 65 gives 33, 104 gives 53). Y is
//      read at a + breath[t], a swing of 45 degrees once per 256 steps, so
//      the ellipse leans and thins and opens again; the Y set of any frame
//      is the table at one shared offset, so the proof covers the breath.
//      A first try at a tilt reaching Y 28 showed the VIC's eight-bit Y
//      compare: a sprite at Y under 32 shows again at 256 + Y on PAL, and
//      one at Y 55 starts on line 311 and wraps onto lines 0 to 19.
//   6. The free-CPU meter of the sprites-only recipe is not ported (the
//      main loop belongs to the sequencer). The recipe's CIA1 timer A
//      bracket is kept and extended: each handler starts the timer, does
//      its write and adds its own cycles to a per-frame sum; main closes
//      the previous frame's sum into worst and typical, then brackets the
//      ball update the same way. The line-253 handler carries no latch. The
//      rows' handlers bracket on timer A and pause timer B, main brackets
//      on timer B, and h249 closes the frame's sum (rows plus main's last).
//   7. The colour fade is the colour-fade recipe's luminance table
//      (order 0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1, sixteen
//      steps) kept as three 17-entry columns for the three ball colours and
//      a 16 by 16 table for the gradient's bands, stepped once every 8 frames.
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

.const N_BALLS = 24               // balls on the ring, 15 degrees apart
.const RADIUS  = 127              // x = XMID + RADIUS * cos(a): X 45 to 299, the ninth-bit scheme's whole span
.const TILT    = 104              // y = YMID + TILT * sin(a + breath[t]), see note 5; Y 36 to 244
.const DEPTH   = 120              // zd = 128 - DEPTH * sin(a): the ball at the bottom centre is nearest
.const BREATH  = 32               // the Y phase swings +-BREATH table steps (45 degrees) once per 256 t
.const XMID    = 172              // sprite X of the ring's centre
.const YMID    = 140              // sprite Y of the ring's centre
.const XWRAP   = 44               // a table X byte below this is 256 + it (ninth bit set)
.const FIRST_LINE = 20            // the top row: the eight highest balls, above every Y
.const FREE_AFTER = 22            // a sprite takes its next ball this many lines after its Y
.const NROWS   = 9                // reposition rows, ROWSTEP lines apart from ROW0
.const ROW0    = 62
.const ROWSTEP = 20
.const STRIDE  = N_BALLS + 1      // entries a third holds: the balls and a sentinel
.const GRAD_N  = 16               // gradient bands in the ring, a power of two
.const NEAR    = 112              // zd below this: white
.const MID     = 144              // zd below this: light grey, else grey
.const BIGBALL = $3f00            // pointer $FC: 24 by 21 ball, near half
.const SMLBALL = $3f40            // pointer $FD: 16 by 14 ball, far half
.const SCREEN  = $0400
.const FADE_FRAMES = 8            // frames per luminance step in fadeout
.const FADE_STEPS  = 16

// Zero page ($10 to $7F is the running part's).
.label acc      = $10             // 16-bit: this frame's cycles so far
.label tcount   = $12             // t, the table step (frame count of the part)
.label fade_lvl_x16 = $13         // fade_lvl * 16, the gfade row; kept in step by fadeout
.label mainb    = $14             // 16-bit: main's last bracket, added to the frame at h249
.label fade_ctr = $16
.label fade_lvl = $17
.label sum      = $18             // 16-bit: the last closed frame
.label rp_thr   = $1a             // the row handler's line threshold
.label swapped  = $1b             // the sort's pass-made-a-swap flag
.label itmp     = $1c             // builder: entry index
.label stmp     = $1d             // builder: sprite
.label etmp     = $1e             // builder: entry slot (half offset in)
.label mtmp     = $1f             // builder: the sprite's ninth bit, or a slot
.label order    = $20             // N_BALLS bytes: ball index per Y rank, topmost first
.label bx       = $38             // N_BALLS bytes: this frame's screen x per ball, low byte
.label by       = $50
.label bz       = $68

// The ring as an open ellipse: X on the cosine, Y on the sine, depth on the
// sine too so the near balls sit low. Y is read one table step further round
// by breath[t], so the ellipse leans and thins and comes back as it turns.
.function xof(a) {
    .return round(XMID + RADIUS * cos(toRadians(a * 360 / 256)))
}
.function yof(a) {
    .return round(YMID + TILT * sin(toRadians(a * 360 / 256)))
}
.function depth(a) {
    .return round(128 - DEPTH * sin(toRadians(a * 360 / 256)))
}
.function breathOf(t) {
    .return round(BREATH * sin(toRadians(t * 360 / 256))) & $ff
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
// h249 also closes the frame, once a frame whether or not main ran: sum and
// typical take this frame's handler brackets (acc) plus main's last bracket
// (mainb), worst keeps the largest, acc starts again. A frame's figure is
// then its rows plus one main, never two mains or none.
h249:   lda #$19
        sta $dc0e
        lda #$03
        sta $d011                 // RSEL clear before line 251: 251 is not a match
        lda acc
        clc
        adc mainb
        sta sum
        sta typical
        lda acc+1
        adc mainb+1
        sta sum+1
        sta typical+1
        lda #0
        sta acc
        sta acc+1
        lda worst+1               // worst = max(worst, sum)
        cmp sum+1
        bcc !+
        bne !++
        lda worst
        cmp sum
        bcs !++
!:      lda sum
        sta worst
        lda sum+1
        sta worst+1
!:      lda $dc04
        eor #$ff
        clc
        adc acc
        sta acc
        bcc !+
        inc acc+1
!:      rts
h252:   Slot($0b)                 // RSEL set again: next frame's 247 is not either

// The rows are fixed: the top row at FIRST_LINE, the five mode rows, and
// NROWS reposition rows ROWSTEP lines apart from ROW0. A reposition row's
// handler takes every entry due by it, so the schedule main builds is
// picked up at the top row whenever main happens to have finished one,
// with no seq_rebuild. An entry runs at most ROWSTEP - 2 lines late,
// against the thirty-line margin the proof after the tables shows.
irq_count:   .byte NROWS + 6
irq_lines:   .byte FIRST_LINE, 40, 50, 53
             .fill NROWS, ROW0 + i * ROWSTEP
             .byte 249, 252
irq_hi:      .fill NROWS + 6, 0
irq_lo:      .byte <stubs, <h40, <h50, <h53
             .fill NROWS, <(stubs + (i + 1) * 5)
             .byte <h249, <h252
irq_hi_addr: .byte >stubs, >h40, >h50, >h53
             .fill NROWS, >(stubs + (i + 1) * 5)
             .byte >h249, >h252
row_thr:     .byte FIRST_LINE + 2 // a row takes the entries due before this line
             .fill NROWS, ROW0 + i * ROWSTEP + 2
.errorif NROWS + 6 > MAX_PART_IRQS, "more rows than the sequencer's table holds"
worst:       .word 0
typical:     .word 0

// prepare: BASIC ROM out so the $B000 body is readable, shapes into bank 0,
// variables to their start values. No VIC writes.
prepare:
        lda #$36
        sta $01
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
        sta $dc04                 // timer A latch $FFFF; each row bracket restarts it
        sta $dc05
        sta $dc06                 // timer B likewise, for main's bracket
        sta $dc07
        lda #0
        sta $dc0e
        sta $dc0f
        // zero-page init: runs here, not in prepare, because $10-$7F belongs to
        // the running part and prepare executes while the previous part is live.
        ldx #N_BALLS-1            // order[i] = i; update's sort puts it in Y order
!:      txa
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
        sta fade_lvl_x16
        sta mainb
        sta mainb+1
        sta cur
        sta rp_idx
        lda #$ff
        sta pub
        jsr project               // the first schedule, published as third 1, for t = 0
        jsr build
        lda #$ff
        sta $d015
        rts

// main: close the previous frame's bracket, then the ball update inside a new one.
main:
        inc tcount                // t advances by 1
        lda tcount                // the gradient rolls one band every four frames
        lsr
        lsr
        and #GRAD_N - 1
        sta gph
        lda #$19                  // timer B: the rows restart timer A under main,
        sta $dc0f                 // so main's own bracket runs on the other timer
        jsr update
        lda #0
        sta $dc0f
        sei                       // h249 reads mainb whole, not between the stores
        lda $dc06
        eor #$ff
        sta mainb
        lda $dc07
        eor #$ff
        sta mainb+1
        cli
        rts

// update: on even frames the projection at t and the sort (project); on
// odd frames the schedule from them (build). Halving the rate keeps a
// frame's figure under the NTSC budget, where main runs across the busy
// rows: the ring moves two table steps every other frame.
update:
        lda tcount
        lsr
        bcs build_frame
project:
        ldy tcount
        lda breath,y              // this frame's Y phase, the same for every ball
        sta yph
        ldx #0                    // ball k reads px, zd at a = t + phase[k], py at a + breath[t]
look:   lda tcount
        clc
        adc phase,x
        tay
        lda px,y
        sta bx,x
        lda zd,y
        sta bz,x
        tya
        clc
        adc yph
        tay
        lda py,y
        sta by,x
        inx
        cpx #N_BALLS
        bne look

sort:   lda #0                    // bubble passes until one makes no swap: order[0]
        sta swapped               // is the topmost ball. setup sorts frame 0, so a
        ldx #0                    // pass here is nearly always the last one
pass:   ldy order,x
        lda by,y
        ldy order+1,x
        cmp by,y
        bcc !+                    // by[i] < by[i+1]: in order
        beq !+
        lda order,x               // else swap the pair
        sta order+1,x
        tya
        sta order,x
        inc swapped
!:      inx
        cpx #N_BALLS-1
        bne pass
        lda swapped
        bne sort
        rts
build_frame:
        jmp build                 // the next schedule, into the third the rows are not reading

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
        lda fade_lvl
        cmp #16
        bcs fade_going            // the gradient's row stays at 15, black
        asl
        asl
        asl
        asl
        sta fade_lvl_x16
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
        sta $dc0f
        lda #$c7
        sta $dd00
        lda #$37
        sta $01
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
        cmp #(xof(0) & $ff)
        bne sc_fail
        lda py + 64
        cmp #yof(64)
        bne sc_fail
        lda zd + 128
        cmp #depth(128)
        bne sc_fail
        lda $d011
        and #$7f
        cmp #$0b
        bne sc_fail
        ldx irq_count             // the built rows are strictly ascending
        dex
sc_rows:
        lda irq_lines-1,x
        cmp irq_lines,x
        bcs sc_fail
        dex
        bne sc_rows
        sei                       // the rows' state, read whole: the walk stands
        ldx cur                   // inside the third the rows read, past the top
        lda halfeb,x              // row's eight at least, and the entry it took
        sta mtmp                  // last is what its sprite's registers hold now,
        ldy rp_idx                // whatever raster line this is called on
        dey
        cpy mtmp
        bcc sc_fail_cli
        tya
        sec
        sbc mtmp
        cmp #N_BALLS
        bcs sc_fail_cli
        ldx e_s2,y
        lda e_y,y
        cmp $d001,x
        bne sc_fail_cli
        lda e_x,y
        cmp $d000,x
        bne sc_fail_cli
        cli
        lda #1
        rts
sc_fail_cli:
        cli
sc_fail:
        lda #0
        rts

pairs:  .byte 14, 12, 10, 8, 6, 4, 2, 0
sprn:   .byte 7, 6, 5, 4, 3, 2, 1, 0
bits:   .fill 8, 1 << i

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
// (255, 255). See integration-issues.md I-008.
.errorif * > $d000, "p5 code and small tables reach the I/O area at $D000"
.errorif (P5_TABLES & $ff) != 0, "p5 tables must start on a page: the bracket figures assume no page crossing"
.errorif !((P5_TABLES + $300 <= $a000) || (P5_TABLES >= $c000 && P5_TABLES + $300 <= $d000)), "p5 tables must sit in RAM the CPU sees with $01 = $37"

* = P5_TABLES "p5 tables"
px: .fill 256, xof(i) & $ff
py: .fill 256, yof(i)
zd: .fill 256, depth(i)
.for (var i = 0; i < 256; i++) {
    .errorif xof(i) < XWRAP || xof(i) >= 256 + XWRAP, "a table X's ninth bit could not be told from its low byte"
    .errorif xof(i) > 343 - 23, "a ball would cross the right edge"
    .errorif yof(i) > 255, "a ball's Y would not fit the register"
    .errorif yof(i) < 36, "a ball's PAL ghost at 256 + Y would reach the visible bottom (line 287)"
    .errorif depth(i) < 0 || depth(i) > 255, "a depth would not fit its byte"
}
// Proof for the schedule, over every t: in Y order, ball i sits at least
// FREE_AFTER + 6 lines below ball i - 8, so a sprite's next ball is always
// six lines or more past its reposition line (the dispatcher's entry and a
// group of three fit in three); the last reposition line stays under the
// mode's 249; and the top ball starts after the FIRST_LINE group is done.
// The breath does not enter: a frame's Y set is py at (t + breath[t] + phase[k]),
// one offset shared by all 24 balls, and the loop below tries every offset.
.for (var t = 0; t < 256; t++) {
    .var ys = List()
    .for (var k = 0; k < N_BALLS; k++) .eval ys.add(yof((t + round(k * 256 / N_BALLS)) & 255))
    .eval ys.sort()
    .for (var k = 8; k < N_BALLS; k++) .errorif ys.get(k) - ys.get(k - 8) < FREE_AFTER + ROWSTEP + 8, "a ball would take its sprite before the ball eight above it is off it, at the latest row that can serve it (ROWSTEP - 2 lines late, the dispatcher, and four entries ahead of it)"
    .errorif ys.get(N_BALLS - 9) + FREE_AFTER > ROW0 + (NROWS - 1) * ROWSTEP + 1, "an entry would fall due after the last reposition row"
    .errorif ys.get(8) + FREE_AFTER < ROW0 - ROWSTEP + 2, "an entry would fall due more than ROWSTEP lines before the first reposition row"
    .errorif ys.get(0) <= FIRST_LINE + 12, "the top ball would start before its group at FIRST_LINE has written it"
}

// The body: RAM under BASIC ROM, readable because prepare sets $01 = $36 and
// cleanup puts $37 back. Only this part's own code runs while it is out.
* = $b000 "p5 body"
p5_body_start:
phase:  .fill N_BALLS, round(i * 256 / N_BALLS)   // table step of ball k at t = 0
nbits:  .fill 8, 255 - (1 << i)
breath: .fill 256, breathOf(i)    // the Y phase at t: a swing of +-BREATH steps, period 256 t
yph:    .byte 0                   // breath[t] for the projection in hand

// The schedule, three thirds: the rows read one (cur), a finished one may
// wait (pub, or $FF for none), and main builds into the remaining one, so
// the top row can take a whole schedule whatever the build's timing against
// it. Entry e of third h is at index h * STRIDE + e, in order of the line
// it is due; entry N_BALLS of each third is a sentinel line no row reaches.
e_s2:   .fill 3 * STRIDE, 2 * (mod(i, STRIDE) & 7)   // 2 * sprite: entry e always has sprite e mod 8
slotbit: .fill 3 * STRIDE, 1 << (mod(i, STRIDE) & 7) // the entry's sprite's ninth bit
e_x:    .fill 3 * STRIDE, 0
e_y:    .fill 3 * STRIDE, 0
e_ptr:  .fill 3 * STRIDE, 0
e_col:  .fill 3 * STRIDE, 0
e_msb:  .fill 3 * STRIDE, 0       // the sprite's ninth bit when X is 256 or more, else 0
e_line: .fill 3 * STRIDE, $ff     // the line the entry is due: its sprite's last Y + FREE_AFTER
// Each row points at its own stub, so the handler learns its row number.
stubs:  .for (var s = 0; s < NROWS + 1; s++) { lda #s; jmp rp_run }
lasty:  .fill 8, 0                // Y of the last ball put on each sprite, this build
cur:    .byte 0                   // the third the rows read
pub:    .byte $ff                 // a finished third the top row has not taken, or $FF
bld:    .byte 0                   // the third being built: neither cur nor pub
rp_idx: .byte 0                   // the next entry to take
halfeb: .byte 0, STRIDE, 2 * STRIDE
col3:   .byte 0, 0, 0             // this frame's three ball colours, faded
gph:    .byte 0                   // this frame's gradient phase, (t / 4) mod GRAD_N
// By depth: the shape pointer and the colour class (0 white, 1 light grey,
// 2 grey), an index into col3.
zptr:   .fill 256, (i < 128) ? BIGBALL / 64 : SMLBALL / 64
zcls:   .fill 256, (i < NEAR) ? 0 : ((i < MID) ? 1 : 2)
// The gradient: GRAD_N bands up the dark half of the luminance ladder and
// back, one band a row; gfade[level * 16 + band] is the band's colour
// after `level` fade steps, levels 0 to 15 (the bands sit in the ladder's
// lower half, so level 15 is already all black and the index stays a
// byte), so the field fades with the balls.
.function band(b) { .return lum.get(b < GRAD_N / 2 ? b : GRAD_N - 1 - b) }
gfade:  .fill 16 * 16, faded(band(i & 15), floor(i / 16))
.for (var b = 0; b < GRAD_N; b++) .errorif faded(band(b), 15) != 0, "a band is not black at fade level 15"
// rp_run: a row's handler, entered from its stub with A = the row. It takes
// every entry due before the row's threshold, in order, and gives each to
// its sprite: X, ninth bit, Y, pointer, colour. The top row first takes a
// new schedule if one is ready. The timer bracket is the mode handlers',
// read in 16 bits because the top row's eight run past 255 cycles.
rp_run:
        tax
        lda #$19
        sta $dc0e
        lda #0
        sta $dc0f                 // pause main's timer B: this work has its own bracket
        txa                       // the row's gradient band: main's phase plus the
        clc                       // row, faded with the balls
        adc gph
        and #GRAD_N - 1
        ora fade_lvl_x16
        tay
        lda gfade,y               // the open window's idle background: the whole
        sta $d021                 // picture but the side borders, which stay the
        txa                       // sequencer's (and the test stub's verdict)
        bne !+
        jsr rp_frame
        ldx #0
!:      lda row_thr,x
        sta rp_thr
        ldy rp_idx
rp_loop:
        lda e_line,y
        cmp rp_thr
        bcs rp_done               // the next entry is due after this row (or is the sentinel)
        ldx e_s2,y
        lda e_x,y
        sta $d000,x
        lda e_y,y
        sta $d001,x
        txa
        lsr
        tax
        lda e_ptr,y
        sta SCREEN+$3f8,x
        lda e_col,y
        sta $d027,x
        lda $d010
        and nbits,x
        ora e_msb,y
        sta $d010
        iny
        bne rp_loop
rp_done:
        sty rp_idx
        lda #1
        sta $dc0f                 // main's timer B runs on (no reload)
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

// rp_frame: at the top row, take the schedule main published, if any, and
// point the frame's walk at the start of the third the rows read.
rp_frame:
        lda pub
        bmi !+
        sta cur
        lda #$ff
        sta pub
!:      ldx cur
        lda halfeb,x
        sta rp_idx
        rts

// build: entry i takes ball order[i] on sprite i mod 8, due at FIRST_LINE
// for the first eight and FREE_AFTER lines below the last ball on its
// sprite for the rest, so the lines come out ascending because the sort
// made Y so. It writes the third that is neither read nor published (the
// one after cur, or the one after that) and publishes it when whole.
build:
        ldx cur
        lda next3,x
        cmp pub
        bne !+
        tax
        lda next3,x
!:      sta bld
        tax
        lda halfeb,x
        sta etmp                  // the entry slot, counting up from the third's base
        ldy fade_lvl              // this frame's three ball colours
        lda fade_white,y
        sta col3
        lda fade_lgrey,y
        sta col3+1
        lda fade_grey,y
        sta col3+2
        lda #FIRST_LINE - FREE_AFTER
        ldx #7                    // so the top eight come out due at the top row
!:      sta lasty,x
        dex
        bpl !-
        inx                       // x = 0
        stx itmp
b_loop: ldx itmp
        ldy order,x               // y = the ball
        txa
        and #7
        tax                       // x = its sprite
        lda lasty,x
        clc
        adc #FREE_AFTER
        sta mtmp                  // due when the sprite's last ball is off it
        lda by,y
        sta lasty,x
        ldx etmp                  // x = the slot (its sprite is the slot's, fixed)
        sta e_y,x
        lda bx,y
        sta e_x,x
        cmp #XWRAP
        lda #0
        bcs !+
        lda slotbit,x             // a low byte under XWRAP: the ninth bit is set
!:      sta e_msb,x
        lda mtmp
        sta e_line,x
        lda bz,y
        tay
        lda zptr,y
        sta e_ptr,x
        lda zcls,y
        tay
        lda col3,y
        sta e_col,x
        inc etmp
        inc itmp
        lda itmp
        cmp #N_BALLS
        bne b_loop
        lda bld
        sta pub
        rts
next3:  .byte 1, 2, 0

p5_body_end:
.errorif p5_body_end > $c000, "p5 body runs past $C000 into the free RAM the code block starts at"
.errorif p5_body_start < $b000, "p5 body must not use $A000-$AFFF"

}
