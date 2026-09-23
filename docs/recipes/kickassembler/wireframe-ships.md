---
recipe: wireframe-ships
toolchain: kickassembler
output_format: PRG
region: both
techniques: [wireframe_pipeline, procedural_seed_universe]
file_formats: [PRG]
uses_registers: [D011, D016, D018, D020, D021, DD00, DC04, DC05, DC06, DC07, DC0D, DC0E, DC0F, DD04, DD05, DD06, DD07, DD0D, DD0E, DD0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Rotating wireframe ships with back-face culling and clipping, and an Elite-style seeded galaxy, checked against a host model

## Synopsis

Three convex wireframe objects (a cube, a square pyramid and a ship hull
of this recipe's own design) rotate in a 160 x 120 pixel window of a
hires bitmap. Each update builds a 3x3 fixed-point rotation matrix per
object from a sine table and quarter-square multiplies, transforms and
projects every vertex through a reciprocal table, culls back faces by
the winding of the projected face, rejects lines wholly outside the
window by outcodes, and draws the rest with Bresenham and EOR. A line
that crosses the window edge is clipped pixel by pixel. The previous
update's lines are erased by drawing them again. The ship crosses the
right edge and the cube the top edge.

The program runs 48 updates twice. Pass 1 counts lines and sums their
endpoints, times every line call with CIA2, and checks the counts and a
checksum of the bitmap against the Python model below. Pass 2 erases,
rewinds and runs the same 48 updates with the counters off, timing each
object with CIA1, and checks the bitmap again. It then times one matrix
build and one ship transform, generates the first eight systems of
Elite's first galaxy from three 16-bit seeds, checks the names and
coordinates against the model, and prints everything under the window.
It writes `$01` to `$02FF` and turns the border green when every check
matches, `$02` and red otherwise. The techniques are
`wireframe_pipeline` in `techniques/effects-vector-3d.md` and
`procedural_seed_universe` in `techniques/maths.md`.

Coordinates: the program works in a virtual 256 x 256 screen with its
centre at (128, 128). The window is x 32-191, y 68-187; bitmap x is
virtual x + 32 and bitmap y is virtual y - 68, so the window fills
character rows 0-14, columns 8-27. Camera space has x right, y down and
z into the screen, with the camera at the origin.

## Source

```asm
// wireframe-ships.asm
// Three rotating convex wireframe objects (a cube, a pyramid, a ship hull)
// in a hires bitmap: 3x3 fixed-point rotation from a sine table and
// quarter-square multiplies, projection through a reciprocal table,
// back-face culling by the winding of the projected face, outcode reject,
// a per-pixel clip for lines that cross the window edge, Bresenham lines
// plotted with EOR and erased by drawing the previous frame's lines again.
// Pass 1 runs NF updates with counters on and CIA2 gated around every line
// call, then checks the line count, an endpoint sum and a bitmap checksum
// against a Python model of the same integer arithmetic (the generator is
// on the page). Pass 2 erases, rewinds and runs the same NF updates with
// the counters off, timing each object with CIA1, and checks the bitmap
// again. Then the program times a matrix build and a vertex transform,
// generates the first eight systems of Elite's first galaxy from three
// 16-bit seeds, and prints everything into the bitmap below the window.
// Verdict: $02FF = $01 and a green border when every check matches,
// $02 and red otherwise.
.encoding "screencode_upper"

.const NF      = 48             // updates before the picture is frozen
.const XMIN    = 32             // view window, virtual coordinates
.const XMAX    = 191            // (bitmap x = vx + 32, bitmap y = vy - 68)
.const YMIN    = 68
.const YMAX    = 187
.const BITMAP  = $6000          // VIC bank 1: bitmap at $6000
.const MATRIX  = $4400          //             video matrix at $4400
.const RESULT  = $02ff
.const NSYS    = 8

// expected values from gen.py
.const EXP_LAST  = 19
.const EXP_TOTAL = 1005
.const EXP_SUM   = $84ea
.const EXP_S1    = $8c
.const EXP_S2    = $99

// ---- zero page (the program never returns to BASIC) ----
.const ma      = $02            // signed multiply operands
.const mb      = $03
.const ua      = $04            // unsigned multiply operands
.const ub      = $05
.const prod    = $06            // 16-bit product
.const acc     = $08            // 16-bit dot-product accumulator
.const m       = $0a            // 3x3 matrix, row-major, 9 bytes $0a-$12
.const vxx     = $13            // vertex being transformed
.const vyy     = $14
.const vzz     = $15
.const rowi    = $16
.const obj     = $17            // current object 0-2
.const tmp     = $18
.const sgn     = $19
.const zc      = $1a
.const recf    = $1b
.const vis     = $1c            // visible-face mask of the current object
.const cnt     = $1d
.const idx     = $1e
.const t1      = $1f            // 16-bit
.const lx0     = $21            // line endpoints and clip flag
.const ly0     = $22
.const lx1     = $23
.const ly1     = $24
.const lclip   = $25
.const ddx     = $26
.const ddy     = $27
.const err     = $28
.const cy      = $29
.const sy      = $2a
.const ptr     = $2b            // 2 bytes
.const oc0     = $2d
.const hbase   = $2e            // heap slot base for the current object
.const upd     = $2f            // update counter
.const t0      = $30            // CIA1 32-bit reading, 4 bytes $30-$33
.const u24     = $34            // 24-bit accumulator for one update, 3 bytes
.const s0      = $37            // galaxy seeds, 6 bytes $37-$3c
.const s1      = $39
.const s2      = $3b
.const gt      = $3d            // 2 bytes
.const num     = $3f            // 24-bit number for the printers, 3 bytes
.const dig     = $42
.const prow    = $43            // print cursor: text row, column
.const pcol    = $44
.const sptr    = $45            // 2 bytes
.const dst     = $47            // 2 bytes
.const src     = $49            // 2 bytes
.const dvs     = $4b            // 16-bit divisor
.const rmd     = $4d            // 16-bit remainder
.const fail    = $4f
.const lng     = $50
.const pcount  = $51
.const sysn    = $52
.const gcol    = $53
.const nx      = $54

BasicUpstart2(start)

start:
        sei
        lda #$7f
        sta $dc0d               // no CIA1 interrupts
        sta $dd0d               // no CIA2 NMIs
        lda $dc0d
        lda $dd0d
        lda #0
        sta $d020
        sta $d021
        sta fail
        jsr clear_all
        lda $dd00
        and #%11111100
        ora #%00000010          // VIC bank 1 ($4000-$7fff)
        sta $dd00
        lda #$18                // matrix $4400, bitmap $6000
        sta $d018
        lda #$08
        sta $d016
        lda #$3b                // bitmap mode, display on, 25 rows
        sta $d011

        // cycle harness: CIA2 A+B chained, paused except while a line draws
        lda #0
        sta $dd0e
        sta $dd0f
        lda #$ff
        sta $dd04
        sta $dd05
        sta $dd06
        sta $dd07
        lda #$10
        sta $dd0e               // A: force load, stopped
        lda #$51
        sta $dd0f               // B: counts A underflows, force load, start
        jsr time_empty          // CIA1 start/stop overhead
        jsr pause_empty         // CIA2 resume/pause overhead

        lda #0
        sta tot_lines
        sta tot_lines+1
        sta ep_sum
        sta ep_sum+1
        sta hcount
        sta hcount+1
        sta hcount+2
        sta calls
        sta calls+1

        // pass 1, checked: counters and the CIA2 line gate are on
        lda #$80
        sta harness
        jsr run_pass
        clc
        lda hcount
        adc hcount+1
        adc hcount+2
        sta last_lines
        jsr check_model
        // line cycles: CIA2 total less the pause/resume overhead per call
        jsr cia2_read           // t0..t0+3 = cycles counted
        jsr mul_ovh_sub         // t0 -= calls * povh
        lda t0
        sta linecyc
        lda t0+1
        sta linecyc+1
        lda t0+2
        sta linecyc+2
        // pass 2, timed: erase, rewind, run the same updates with the
        // harness off; the picture must come out the same
        lda #0
        sta harness
        jsr rewind
        jsr run_pass
        jsr check_bitmap
        jmp bench

// ================= the animation =================
run_pass:
        ldx #2
!:      lda ang_a0,x
        sta ang_a,x
        lda ang_b0,x
        sta ang_b,x
        dex
        bpl !-
        lda #0
        sta upd
        sta worst
        sta worst+1
        sta worst+2
frame:
        lda #0
        sta u24
        sta u24+1
        sta u24+2
        ldx #0
obj_loop:
        stx obj
        jsr timer_start
        jsr do_object
        jsr timer_stop
        ldx obj                 // keep this object's cost for the readout
        lda t0
        sta ocyc_lo,x
        lda t0+1
        sta ocyc_mid,x
        lda t0+2
        sta ocyc_hi,x
        clc
        lda u24
        adc t0
        sta u24
        lda u24+1
        adc t0+1
        sta u24+1
        lda u24+2
        adc t0+2
        sta u24+2
        ldx obj
        inx
        cpx #3
        bne obj_loop
        // worst update so far
        lda u24+2
        cmp worst+2
        bcc !keep+
        bne !new+
        lda u24+1
        cmp worst+1
        bcc !keep+
        bne !new+
        lda u24
        cmp worst
        bcc !keep+
!new:   lda u24
        sta worst
        lda u24+1
        sta worst+1
        lda u24+2
        sta worst+2
!keep:
        inc upd
        lda upd
        cmp #NF
        beq !+
        jmp frame
!:      rts

// erase every object's heap: the bitmap returns to blank
rewind:
        ldx #0
!:      stx obj
        jsr erase_heap
        ldx obj
        lda #0
        sta hcount,x
        inx
        cpx #3
        bne !-
        rts

// ================= checks against the model =================
check_model:
        lda last_lines
        cmp #EXP_LAST
        beq !+
        inc fail
!:      lda tot_lines
        cmp #<EXP_TOTAL
        bne !bad+
        lda tot_lines+1
        cmp #>EXP_TOTAL
        bne !bad+
        lda ep_sum
        cmp #<EXP_SUM
        bne !bad+
        lda ep_sum+1
        cmp #>EXP_SUM
        beq !+
!bad:   inc fail
!:
check_bitmap:
        jsr fletcher            // bitmap rows 0-15, memory order
        lda fl1
        cmp #EXP_S1
        bne !bad+
        lda fl2
        cmp #EXP_S2
        beq !+
!bad:   inc fail
!:      rts

// ================= micro-benchmarks (bitmap untouched) =================
bench:
        lda #2
        sta obj
        jsr timer_start
        jsr build_matrix
        jsr timer_stop
        lda t0
        sta mcyc
        lda t0+1
        sta mcyc+1
        jsr timer_start
        jsr xform_all
        jsr timer_stop
        lda t0
        sta vcyc
        lda t0+1
        sta vcyc+1

// ================= galaxy =================
        jsr galaxy

// ================= readout =================
        jsr print_all
        lda fail
        bne !bad+
        lda #1
        sta RESULT
        lda #5
        sta $d020
        jmp *
!bad:   lda #2
        sta RESULT
        lda #2
        sta $d020
        jmp *

// ---------------------------------------------------------------
// one object: advance angles, matrix, transform and project every
// vertex, cull faces, erase the old lines, draw and store the new
do_object:
        ldx obj
        clc
        lda ang_a,x
        adc stp_a,x
        sta ang_a,x
        clc
        lda ang_b,x
        adc stp_b,x
        sta ang_b,x
        jsr build_matrix
        jsr xform_all
        jsr cull
        jsr erase_heap
        // new lines
        ldx obj
        lda #0
        sta hcount,x
        lda o_en,x
        sta cnt
        lda o_est,x
        sta idx
ed_loop:
        ldy idx
        lda ef0,y
        tax
        lda bit_of,x
        and vis
        bne ed_vis
        lda ef1,y
        tax
        lda bit_of,x
        and vis
        bne ed_vis
        jmp ed_next
ed_vis:
        lda e0,y
        tax
        lda px,x
        sta lx0
        lda py,x
        sta ly0
        lda e1,y
        tax
        lda px,x
        sta lx1
        lda py,x
        sta ly1
        ldx lx0
        ldy ly0
        jsr outcode
        sta oc0
        ldx lx1
        ldy ly1
        jsr outcode
        tax
        and oc0
        beq !+
        jmp ed_next             // both ends beyond one edge: reject
!:
        txa
        ora oc0
        sta lclip               // non-zero: crosses an edge, clip per pixel
        // store in the heap
        ldx obj
        lda hslot,x
        clc
        adc hcount,x
        tay
        inc hcount,x
        lda lx0
        sta hx0,y
        lda ly0
        sta hy0,y
        lda lx1
        sta hx1,y
        lda ly1
        sta hy1,y
        lda lclip
        sta hcl,y
        // bookkeeping for the model check, pass 1 only
        bit harness
        bpl ed_draw
        inc tot_lines
        bne !+
        inc tot_lines+1
!:      lda lx0
        jsr add_sum
        lda ly0
        jsr add_sum
        lda lx1
        jsr add_sum
        lda ly1
        jsr add_sum
ed_draw:
        jsr line_timed
ed_next:
        inc idx
        dec cnt
        beq !+
        jmp ed_loop
!:      rts

// draw the object's stored lines again: EOR takes them off the bitmap
erase_heap:
        ldx obj
        lda hslot,x
        sta hbase
        lda hcount,x
        sta cnt
        beq er_done
        ldy hbase
er_loop:
        sty idx
        lda hx0,y
        sta lx0
        lda hy0,y
        sta ly0
        lda hx1,y
        sta lx1
        lda hy1,y
        sta ly1
        lda hcl,y
        sta lclip
        jsr line_timed
        ldy idx
        iny
        dec cnt
        bne er_loop
er_done:
        rts

add_sum:
        clc
        adc ep_sum
        sta ep_sum
        bcc !+
        inc ep_sum+1
!:      rts

// outcode of (X, Y): bit 0 left, 1 right, 2 above, 3 below
outcode:
        lda #0
        cpx #XMIN
        bcs !+
        ora #1
!:      cpx #XMAX+1
        bcc !+
        ora #2
!:      cpy #YMIN
        bcs !+
        ora #4
!:      cpy #YMAX+1
        bcc !+
        ora #8
!:      rts

// ---------------------------------------------------------------
// rotation matrix for object obj from angles a (about y) and b (about x)
//   | ca          0    sa         |
//   | sa*sb>>6    cb   -(ca*sb>>6) |
//   | -(sa*cb>>6) sb   ca*cb>>6    |
build_matrix:
        ldx obj
        ldy ang_a,x
        lda sintab,y
        sta m+2                 // sa
        lda costab,y
        sta m+0                 // ca
        ldy ang_b,x
        lda costab,y
        sta m+4                 // cb
        lda sintab,y
        sta m+7                 // sb
        lda #0
        sta m+1
        lda m+2
        sta ma
        lda m+7
        sta mb
        jsr smuls
        jsr shr6
        sta m+3                 // sa*sb>>6
        lda m+0
        sta ma
        jsr smuls               // mb still sb
        jsr shr6
        eor #$ff
        clc
        adc #1
        sta m+5                 // -(ca*sb>>6)
        lda m+2
        sta ma
        lda m+4
        sta mb
        jsr smuls
        jsr shr6
        eor #$ff
        clc
        adc #1
        sta m+6                 // -(sa*cb>>6)
        lda m+0
        sta ma
        jsr smuls               // mb still cb
        jsr shr6
        sta m+8                 // ca*cb>>6
        rts

// prod >> 6 as a signed byte: the high byte of prod << 2
shr6:
        asl prod
        rol prod+1
        asl prod
        rol prod+1
        lda prod+1
        rts

// signed 8x8 -> 16, valid while |ma + mb| and |ma - mb| <= 128
smuls:
        lda ma
        clc
        adc mb
        tax
        lda ma
        sec
        sbc mb
        tay
        lda qslo,x
        sec
        sbc qslo,y
        sta prod
        lda qshi,x
        sbc qshi,y
        sta prod+1
        rts

// unsigned 8x8 -> 16 by quarter squares, 512-entry tables
umul:
        lda ua
        clc
        adc ub
        tax
        bcs um_hi
        lda ua
        sec
        sbc ub
        bcs !+
        eor #$ff
        adc #1                  // carry is clear here: |ua - ub|
!:      tay
        lda sqlo,x
        sec
        sbc sqlo,y
        sta prod
        lda sqhi,x
        sbc sqhi,y
        sta prod+1
        rts
um_hi:  lda ua
        sec
        sbc ub
        bcs !+
        eor #$ff
        adc #1
!:      tay
        lda sqlo+256,x
        sec
        sbc sqlo,y
        sta prod
        lda sqhi+256,x
        sbc sqhi,y
        sta prod+1
        rts

// signed 8x8 -> 16 for any |ma|, |mb| <= 127: magnitudes, then the sign
smulg:
        lda ma
        eor mb
        sta sgn
        lda ma
        bpl !+
        eor #$ff
        clc
        adc #1
!:      sta ua
        lda mb
        bpl !+
        eor #$ff
        clc
        adc #1
!:      sta ub
        jsr umul
        lda sgn
        bpl !+
        sec
        lda #0
        sbc prod
        sta prod
        lda #0
        sbc prod+1
        sta prod+1
!:      rts

// row X (0, 3, 6) of the matrix times the vertex, >> 6
dot_row:
        stx rowi
        lda m,x
        sta ma
        lda vxx
        sta mb
        jsr smuls
        lda prod
        sta acc
        lda prod+1
        sta acc+1
        ldx rowi
        lda m+1,x
        sta ma
        lda vyy
        sta mb
        jsr smuls
        clc
        lda acc
        adc prod
        sta acc
        lda acc+1
        adc prod+1
        sta acc+1
        ldx rowi
        lda m+2,x
        sta ma
        lda vzz
        sta mb
        jsr smuls
        clc
        lda acc
        adc prod
        sta acc
        lda acc+1
        adc prod+1
        asl acc                 // (sum << 2) >> 8 = sum >> 6
        rol
        asl acc
        rol
        rts

// transform and project every vertex of obj into px[], py[]
xform_all:
        ldx obj
        lda o_vn,x
        sta cnt
        lda o_vst,x
        sta idx
        lda #0
        sta tmp                 // local vertex index
xf_loop:
        ldy idx
        lda vx,y
        sta vxx
        lda vy,y
        sta vyy
        lda vz,y
        sta vzz
        ldx #6
        jsr dot_row             // z
        ldx obj
        clc
        adc o_z,x
        tay
        lda rectab,y
        sta ub
        ldx #0
        jsr dot_row             // x
        ldx obj
        clc
        adc o_x,x
        jsr project
        ldx tmp
        sta px,x
        ldx #3
        jsr dot_row             // y
        ldx obj
        clc
        adc o_y,x
        jsr project
        ldx tmp
        sta py,x
        inc tmp
        inc idx
        dec cnt
        bne xf_loop
        rts

// A = signed camera coordinate, ub = reciprocal factor: A = 128 +- (|A|*f)>>8
project:
        cmp #$80
        bcs pr_neg
        sta ua
        jsr umul
        lda prod+1
        clc
        adc #128
        rts
pr_neg: eor #$ff
        clc
        adc #1
        sta ua
        jsr umul
        lda #128
        sec
        sbc prod+1
        rts

// visible faces: the projected winding (dx1*dy2 - dy1*dx2) is negative
cull:
        lda #0
        sta vis
        ldx obj
        lda o_fn,x
        sta cnt
        lda o_fst,x
        sta idx
        lda #0
        sta sysn                // local face number
cu_loop:
        ldy idx
        ldx fa,y
        lda px,x
        sta lx0
        lda py,x
        sta ly0
        ldx fb,y
        lda px,x
        sec
        sbc lx0
        sta ddx                 // dx1
        lda py,x
        sec
        sbc ly0
        sta ddy                 // dy1
        ldx fc,y
        lda px,x
        sec
        sbc lx0
        sta lx1                 // dx2
        lda py,x
        sec
        sbc ly0
        sta ly1                 // dy2
        lda ddx
        sta ma
        lda ly1
        sta mb
        jsr smulg
        lda prod
        sta t1
        lda prod+1
        sta t1+1
        lda ddy
        sta ma
        lda lx1
        sta mb
        jsr smulg
        sec
        lda t1
        sbc prod
        lda t1+1
        sbc prod+1
        bpl !+
        ldx sysn
        lda bit_of,x
        ora vis
        sta vis
!:      inc sysn
        inc idx
        dec cnt
        bne cu_loop
        rts

// ---------------------------------------------------------------
// line with CIA2 running only while it draws
line_timed:
        bit harness
        bpl line                // pass 2: no gate
        inc calls
        bne !+
        inc calls+1
!:      lda #$01
        sta $dd0e               // resume timer A
        jsr line
        lda #$00
        sta $dd0e               // pause
        rts

// Bresenham from (lx0,ly0) to (lx1,ly1), EOR plot; lclip != 0 tests
// every pixel against the window
line:
        lda lx1
        sec
        sbc lx0
        bcs !+
        eor #$ff
        adc #1
!:      sta ddx
        lda ly1
        sec
        sbc ly0
        bcs !+
        eor #$ff
        adc #1
!:      sta ddy
        cmp ddx
        bcc x_major
        beq x_major
        jmp y_major

x_major:
        lda lx1                 // step x upward: swap if x0 > x1
        cmp lx0
        bcs !+
        ldx lx0
        sta lx0
        stx lx1
        lda ly0
        ldx ly1
        sta ly1
        stx ly0
!:      lda #1
        ldx ly1
        cpx ly0
        bcs !+
        lda #$ff
!:      sta sy
        lda ddx
        lsr
        sta err
        ldy ly0
        sty cy
        lda ylo,y
        sta ptr
        lda yhi,y
        sta ptr+1
        ldx lx0
        lda lclip
        bne !+
        XMAJOR(false)
        rts
!:      XMAJOR(true)
        rts

y_major:
        lda ly1                 // step y downward on screen: swap if y0 > y1
        cmp ly0
        bcs !+
        ldx ly0
        sta ly0
        stx ly1
        lda lx0
        ldx lx1
        sta lx1
        stx lx0
!:      lda #1
        ldx lx1
        cpx lx0
        bcs !+
        lda #$ff
!:      sta sy                  // x step
        lda ddy
        lsr
        sta err
        lda ly0
        sta cy
        ldx lx0
        lda lclip
        bne !+
        YMAJOR(false)
        rts
!:      YMAJOR(true)
        rts

.macro XMAJOR(clip) {
loop:
    .if (clip) {
        cpx #XMIN
        bcc skip
        cpx #XMAX+1
        bcs skip
        lda cy
        cmp #YMIN
        bcc skip
        cmp #YMAX+1
        bcs skip
    }
        ldy xcol,x
        lda (ptr),y
        eor xmask,x
        sta (ptr),y
skip:
        cpx lx1
        beq done
        inx
        lda err
        sec
        sbc ddy
        bcs nostep
        adc ddx                 // carry clear: err - dy + dx
        sta err
        lda cy
        clc
        adc sy
        sta cy
        tay
        lda ylo,y
        sta ptr
        lda yhi,y
        sta ptr+1
        jmp loop
nostep:
        sta err
        jmp loop
done:
}

.macro YMAJOR(clip) {
loop:
        ldy cy
        lda ylo,y
        sta ptr
        lda yhi,y
        sta ptr+1
    .if (clip) {
        cpx #XMIN
        bcc skip
        cpx #XMAX+1
        bcs skip
        cpy #YMIN
        bcc skip
        cpy #YMAX+1
        bcs skip
    }
        ldy xcol,x
        lda (ptr),y
        eor xmask,x
        sta (ptr),y
skip:
        lda cy
        cmp ly1
        beq done
        inc cy
        lda err
        sec
        sbc ddx
        bcs nostep
        adc ddy
        sta err
        txa
        clc
        adc sy
        tax
        jmp loop
nostep:
        sta err
        jmp loop
done:
}

// ---------------------------------------------------------------
// CIA1 timers A and B chained as a 32-bit down-counter
timer_start:
        lda #0
        sta $dc0e
        sta $dc0f
        lda #$ff
        sta $dc04
        sta $dc05
        sta $dc06
        sta $dc07
        lda #$51
        sta $dc0f
        lda #$11
        sta $dc0e
        rts
// stop, read, subtract the measured empty overhead: t0 = cycles
timer_stop:
        lda #0
        sta $dc0e
        lda $dc04
        eor #$ff
        sta t0
        lda $dc05
        eor #$ff
        sta t0+1
        lda $dc06
        eor #$ff
        sta t0+2
        lda $dc07
        eor #$ff
        sta t0+3
        sec
        lda t0
        sbc ovh
        sta t0
        lda t0+1
        sbc #0
        sta t0+1
        lda t0+2
        sbc #0
        sta t0+2
        rts
time_empty:
        lda #0
        sta ovh
        jsr timer_start
        jsr timer_stop
        lda t0
        sta ovh
        rts
// CIA2: time one empty resume/pause pair
pause_empty:
        lda #$01
        sta $dd0e
        lda #$00
        sta $dd0e
        jsr cia2_read
        lda t0
        sta povh
        lda #$10                // reload $ffff, stopped
        sta $dd0e
        lda #$51
        sta $dd0f
        rts
cia2_read:
        lda $dd04
        eor #$ff
        sta t0
        lda $dd05
        eor #$ff
        sta t0+1
        lda $dd06
        eor #$ff
        sta t0+2
        lda $dd07
        eor #$ff
        sta t0+3
        rts
// t0 (24 bits) -= calls * povh, by repeated subtraction
mul_ovh_sub:
        lda calls
        sta dvs
        lda calls+1
        sta dvs+1
!loop:  lda dvs
        ora dvs+1
        beq !done+
        sec
        lda t0
        sbc povh
        sta t0
        lda t0+1
        sbc #0
        sta t0+1
        lda t0+2
        sbc #0
        sta t0+2
        lda dvs
        bne !+
        dec dvs+1
!:      dec dvs
        jmp !loop-
!done:  rts

// ---------------------------------------------------------------
// Fletcher-style sums over bitmap rows 0-15 in memory order
fletcher:
        lda #<BITMAP
        sta ptr
        lda #>BITMAP
        sta ptr+1
        lda #0
        sta fl1
        sta fl2
        ldx #20                 // 20 pages = 5120 bytes = 16 cell rows
        ldy #0
!:      lda (ptr),y
        clc
        adc fl1
        sta fl1
        clc
        adc fl2
        sta fl2
        iny
        bne !-
        inc ptr+1
        dex
        bne !-
        rts

// ---------------------------------------------------------------
// galaxy: s0' = s1, s1' = s2, s2' = s0 + s1 + s2 (16-bit), four twists
// a system; the name takes a letter pair from bits 0-4 of s2_hi before
// each of the first three twists (four when bit 6 of s0_lo is set)
galaxy:
        lda #$4a
        sta s0
        lda #$5a
        sta s0+1
        lda #$48
        sta s1
        lda #$02
        sta s1+1
        lda #$53
        sta s2
        lda #$b7
        sta s2+1
        lda #0
        sta sysn
        sta gworst
        sta gworst+1
gx_sys: jsr timer_start
        jsr make_system
        jsr timer_stop
        lda t0+1
        cmp gworst+1
        bcc !+
        bne !new+
        lda t0
        cmp gworst
        bcc !+
!new:   lda t0
        sta gworst
        lda t0+1
        sta gworst+1
!:      inc sysn
        lda sysn
        cmp #NSYS
        bne gx_sys
        rts

// one system: coordinates, eight name bytes at gname + 8*sysn, then
// the seeds are left twisted four times: the next system
make_system:
        lda sysn
        asl
        asl
        asl
        tax
        stx gcol
        ldy sysn
        lda s1+1
        sta gx,y                // x = s1_hi
        lda s0+1
        lsr
        sta gy,y                // y = s0_hi >> 1
        lda s0
        and #$40
        sta lng
        lda #0
        sta pcount
ms_pair:
        lda s2+1
        and #31
        sta tmp
        jsr twist
        lda pcount
        cmp #3
        bcc !+
        lda lng
        beq ms_skip
!:      lda tmp
        beq ms_skip             // pair 0 prints nothing
        asl
        tay
        ldx gcol
        lda pairs,y
        sta gname,x
        inx
        lda pairs+1,y
        cmp #'.'
        beq !+                  // '.' is the silent second letter
        sta gname,x
        inx
!:      stx gcol
ms_skip:
        inc pcount
        lda pcount
        cmp #4
        bne ms_pair
        rts

twist:
        clc
        lda s0
        adc s1
        sta gt
        lda s0+1
        adc s1+1
        sta gt+1                // gt = s0 + s1
        lda s1
        sta s0
        lda s1+1
        sta s0+1
        lda s2
        sta s1
        lda s2+1
        sta s1+1
        clc
        lda gt
        adc s1
        sta s2
        lda gt+1
        adc s1+1
        sta s2+1                // s2 = s0 + s1 + old s2
        rts

// ---------------------------------------------------------------
// readout, printed into bitmap rows 16-24
print_all:
        // galaxy check: names, x, y
        ldx #0
!:      lda gname,x
        cmp exp_names,x
        beq ok1
        inc gfail
ok1:    inx
        cpx #NSYS*8
        bne !-
        ldx #0
!:      lda gx,x
        cmp exp_gx,x
        bne gbad
        lda gy,x
        cmp exp_gy,x
        beq gok
gbad:   inc gfail
gok:    inx
        cpx #NSYS
        bne !-
        lda #16
        ldx #0
        jsr at
        ldx #<t_wire
        ldy #>t_wire
        jsr str
        lda fail                // wireframe checks only, so far
        jsr passfail
        ldx #<t_upd
        ldy #>t_upd
        jsr str
        lda #NF
        jsr num8
        ldx #<t_lines
        ldy #>t_lines
        jsr str
        lda last_lines
        jsr num8

        lda #17
        ldx #0
        jsr at
        ldx #<t_worst
        ldy #>t_worst
        jsr str
        lda worst
        sta num
        lda worst+1
        sta num+1
        lda worst+2
        sta num+2
        jsr num24
        ldx #<t_last
        ldy #>t_last
        jsr str
        lda u24
        sta num
        lda u24+1
        sta num+1
        lda u24+2
        sta num+2
        jsr num24

        lda #18
        ldx #0
        jsr at
        ldx #<t_calls
        ldy #>t_calls
        jsr str
        lda calls
        sta num
        lda calls+1
        sta num+1
        lda #0
        sta num+2
        jsr num24
        ldx #<t_cpl
        ldy #>t_cpl
        jsr str
        lda linecyc
        sta num
        lda linecyc+1
        sta num+1
        lda linecyc+2
        sta num+2
        lda calls
        sta dvs
        lda calls+1
        sta dvs+1
        jsr div24
        jsr num24

        lda #19
        ldx #0
        jsr at
        ldx #<t_mat
        ldy #>t_mat
        jsr str
        lda mcyc
        sta num
        lda mcyc+1
        sta num+1
        lda #0
        sta num+2
        jsr num24
        ldx #<t_vtx
        ldy #>t_vtx
        jsr str
        lda vcyc
        sta num
        lda vcyc+1
        sta num+1
        lda #0
        sta num+2
        lda #7                  // the ship has 7 vertices
        sta dvs
        lda #0
        sta dvs+1
        jsr div24
        jsr num24

        ldx #<t_ship
        ldy #>t_ship
        jsr str
        lda ocyc_lo+2
        sta num
        lda ocyc_mid+2
        sta num+1
        lda ocyc_hi+2
        sta num+2
        jsr num24

        lda #20
        ldx #0
        jsr at
        ldx #<t_gal
        ldy #>t_gal
        jsr str
        lda gfail
        jsr passfail
        ldx #<t_sys
        ldy #>t_sys
        jsr str
        lda gworst
        sta num
        lda gworst+1
        sta num+1
        lda #0
        sta num+2
        jsr num24

        // eight systems, two to a row
        lda #0
        sta sysn
sy_loop:
        lda sysn
        lsr
        clc
        adc #21
        pha
        lda sysn
        and #1
        beq !+
        lda #20
!:      tax
        pla
        jsr at
        lda sysn
        asl
        asl
        asl
        sta idx
        lda #8
        sta cnt
!:      ldx idx
        lda gname,x
        jsr chr
        inc idx
        dec cnt
        bne !-
        lda #' '
        jsr chr
        ldx sysn
        lda gx,x
        jsr num8
        lda #','
        jsr chr
        ldx sysn
        lda gy,x
        jsr num8
        inc sysn
        lda sysn
        cmp #NSYS
        bne sy_loop
        lda gfail
        beq !+
        inc fail
!:      ldx #39                 // status row colour: green PASS, red FAIL
        lda fail
        beq !+
        lda #$20
        .byte $2c               // bit abs: skip the next lda
!:      lda #$50
!:      sta MATRIX+16*40,x
        dex
        bpl !-
        rts

passfail:
        cmp #0
        bne !+
        ldx #<t_pass
        ldy #>t_pass
        jmp str
!:      ldx #<t_fail
        ldy #>t_fail
        jmp str

// cursor to text row A, column X
at:     sta prow
        stx pcol
        rts

str:    stx sptr
        sty sptr+1
        ldy #0
!:      lda (sptr),y
        beq !+
        sty tmp
        jsr chr
        ldy tmp
        iny
        bne !-
!:      rts

// copy the ROM glyph of screen code A into the bitmap cell at the cursor
chr:    sta src
        lda #0
        sta src+1
        asl src
        rol src+1
        asl src
        rol src+1
        asl src
        rol src+1
        lda src+1
        ora #$d0
        sta src+1
        ldx prow
        lda rowlo,x
        sta dst
        lda rowhi,x
        sta dst+1
        lda pcol
        asl
        asl
        asl
        php
        clc
        adc dst
        sta dst
        lda dst+1
        adc #0
        plp
        adc #0                  // column * 8 carries past 255 from column 32
        sta dst+1
        lda #$33                // character ROM in, I/O out; IRQs are off
        sta $01
        ldy #7
!:      lda (src),y
        sta (dst),y
        dey
        bpl !-
        lda #$37
        sta $01
        inc pcol
        rts

// A as 3 digits, no leading zeros
num8:   sta num
        lda #0
        sta num+1
        sta num+2
        // fall through
// 24-bit num in decimal, no leading zeros
num24:  lda #0
        sta lng                 // a digit has been printed
        ldx #0
n_dig:  lda #0
        sta dig
n_sub:  sec
        lda num
        sbc p10_0,x
        sta tmp
        lda num+1
        sbc p10_1,x
        sta t1
        lda num+2
        sbc p10_2,x
        bcc n_out
        sta num+2
        lda t1
        sta num+1
        lda tmp
        sta num
        inc dig
        jmp n_sub
n_out:  lda dig
        ora lng
        bne !+
        cpx #7
        bne n_next              // leading zero, not the last digit
!:      sta lng
        lda dig
        ora #$30
        stx nx
        jsr chr
        ldx nx
n_next: inx
        cpx #8
        bne n_dig
        rts

// num (24 bits) /= dvs (16 bits), shift and subtract
div24:  lda #0
        sta rmd
        sta rmd+1
        ldx #24
!:      asl num
        rol num+1
        rol num+2
        rol rmd
        rol rmd+1
        sec
        lda rmd
        sbc dvs
        tay
        lda rmd+1
        sbc dvs+1
        bcc !+
        sta rmd+1
        sty rmd
        inc num
!:      dex
        bne !--
        rts

// ---------------------------------------------------------------
clear_all:
        lda #0
        tay
        ldx #>BITMAP
        stx ptr+1
        sta ptr
        ldx #32                 // $6000-$7fff
!:      sta (ptr),y
        iny
        bne !-
        inc ptr+1
        dex
        bne !-
        ldx #0                  // white on black everywhere
        lda #$10
!:      sta MATRIX,x
        sta MATRIX+$100,x
        sta MATRIX+$200,x
        sta MATRIX+$2e8,x
        inx
        bne !-
        rts

// ---------------------------------------------------------------
// data
ovh:        .byte 0
harness:    .byte 0
povh:       .byte 0
calls:      .word 0
tot_lines:  .word 0
ep_sum:     .word 0
last_lines: .byte 0
worst:      .byte 0, 0, 0
linecyc:    .byte 0, 0, 0
mcyc:       .word 0
vcyc:       .word 0
gworst:     .word 0
gfail:      .byte 0
fl1:        .byte 0
fl2:        .byte 0
ocyc_lo:    .byte 0, 0, 0
ocyc_mid:   .byte 0, 0, 0
ocyc_hi:    .byte 0, 0, 0
hslot:      .byte 0, 16, 32     // heap slots per object
hcount:     .byte 0, 0, 0
bit_of:     .byte 1, 2, 4, 8, 16, 32, 64, 128
px:         .fill 16, 0
py:         .fill 16, 0
hx0:        .fill 48, 0
hy0:        .fill 48, 0
hx1:        .fill 48, 0
hy1:        .fill 48, 0
hcl:        .fill 48, 0
gx:         .fill NSYS, 0
gy:         .fill NSYS, 0
gname:      .fill NSYS*8, $20
p10_0:      .byte <10000000, <1000000, <100000, <10000, <1000, <100, <10, <1
p10_1:      .byte >10000000, >1000000, >100000, >10000, >1000, >100, >10, >1
p10_2:      .byte (10000000 >> 16), (1000000 >> 16), (100000 >> 16), 0, 0, 0, 0, 0
rowlo:      .fill 25, <(BITMAP + i*320)
rowhi:      .fill 25, >(BITMAP + i*320)
// Elite's two-letter tokens, 0 prints nothing ('.' = silent letter)
pairs:      .text "..LEXEGEZACEBISOUSESARMAINDIREA.ERATENBERALAVETIEDORQUANTEISRION"
t_wire:     .text "WIREFRAME @"
t_lines:    .text " LINES @"
t_upd:      .text " UPDATES @"
t_worst:    .text "WORST UPDATE @"
t_last:     .text " LAST @"
t_calls:    .text "LINE CALLS @"
t_cpl:      .text " CYC/LINE @"
t_mat:      .text "MATRIX @"
t_vtx:      .text " CYC/VERTEX @"
t_ship:     .text " SHIP @"
t_gal:      .text "GALAXY @"
t_sys:      .text " CYC/SYSTEM @"
t_pass:     .text "PASS@"
t_fail:     .text "FAIL@"

// object model and expected values, from gen.py
vx:      .byte -30, 30, 30, -30, -30, 30, 30, -30, -32, 32, 32, -32, 0, 0, -44, -16, 16, 44, 16, -16
vy:      .byte -30, -30, 30, 30, -30, -30, 30, 30, 24, 24, 24, 24, -40, 0, 0, -12, -12, 0, 10, 10
vz:      .byte -30, -30, -30, -30, 30, 30, 30, 30, -32, -32, 32, 32, 0, 52, -20, -20, -20, -20, -20, -20
fa:      .byte 3, 6, 7, 2, 0, 7, 1, 2, 3, 0, 3, 1, 2, 3, 4, 5, 6, 6
fb:      .byte 2, 7, 3, 6, 1, 6, 4, 4, 4, 4, 2, 2, 3, 4, 5, 6, 1, 5
fc:      .byte 1, 4, 0, 5, 5, 2, 0, 1, 2, 3, 1, 0, 0, 0, 0, 0, 0, 4
e0:      .byte 0, 0, 0, 1, 1, 2, 2, 3, 4, 4, 5, 6, 0, 0, 0, 1, 1, 2, 2, 3, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 4, 5
e1:      .byte 1, 3, 4, 2, 5, 3, 6, 7, 5, 7, 6, 7, 1, 3, 4, 2, 4, 3, 4, 4, 1, 2, 3, 4, 5, 6, 2, 6, 3, 4, 5, 6
ef0:     .byte 0, 0, 2, 0, 3, 0, 3, 2, 1, 1, 1, 1, 0, 3, 0, 1, 0, 2, 1, 2, 0, 0, 1, 2, 3, 4, 0, 5, 1, 2, 3, 4
ef1:     .byte 4, 2, 4, 3, 4, 5, 5, 5, 4, 2, 3, 5, 4, 4, 3, 4, 1, 4, 2, 3, 5, 1, 2, 3, 4, 5, 6, 6, 6, 6, 6, 6
o_vst:   .byte 0, 8, 13
o_vn:    .byte 8, 5, 7
o_fst:   .byte 0, 6, 11
o_fn:    .byte 6, 5, 7
o_est:   .byte 0, 12, 20
o_en:    .byte 12, 8, 12
o_x:     .byte -58, -44, 72
o_y:     .byte -52, 44, 6
o_z:     .byte 196, 200, 192
ang_a:   .byte 0, 40, 100
ang_b:   .byte 20, 0, 60
ang_a0:  .byte 0, 40, 100
ang_b0:  .byte 20, 0, 60
stp_a:   .byte 3, -2, 2
stp_b:   .byte 2, 3, -3
exp_names: .text "TIBEDIEDQUBE    LELEER  BIARGE  XEQUERINTIRAOR  RABEDIRALAVE    "
exp_gx:  .byte 2, 152, 77, 83, 180, 172, 69, 20
exp_gy:  .byte 45, 102, 121, 104, 65, 88, 124, 86

// ---------------------------------------------------------------
// tables, page aligned, all below the VIC bank at $4000
.align $100
sqlo:    .fill 512, <floor(i*i/4)       // unsigned quarter squares, n = 0-511
sqhi:    .fill 512, >floor(i*i/4)
qslo:    .fill 256, <floor(sv(i)*sv(i)/4) // signed index: floor(s*s/4)
qshi:    .fill 256, >floor(sv(i)*sv(i)/4)
sintab:  .fill 256, floor(64*sin(toRadians(i*360/256)) + 0.5)
costab:  .fill 256, floor(64*sin(toRadians((i+64)*360/256)) + 0.5)
rectab:  .fill 256, recip(i)            // floor(32768 / z), 255 below 129
ylo:     .fill 256, <rowaddr(i)
yhi:     .fill 256, >rowaddr(i)
xcol:    .fill 256, xcolof(i)
xmask:   .fill 256, $80 >> ((i + 32) & 7)
.assert "tables end below the VIC bank", * <= $4000, true

.function sv(i) {
    .if (i < 128) .return i
    .return i - 256
}
.function recip(z) {
    .if (z < 129) .return 255
    .return floor(32768 / z)
}
.function rowaddr(vy) {                  // bitmap address of line vy, column 0
    .if (vy < YMIN || vy > YMAX) .return BITMAP
    .var by = vy - YMIN
    .return BITMAP + floor(by / 8) * 320 + mod(by, 8)
}
.function xcolof(vx) {                   // byte offset of column vx in its line
    .if (vx < XMIN || vx > XMAX) .return 0
    .return (vx + 32) & $f8
}
```

## Build

```bash
java -jar $KICKASS_JAR wireframe-ships.asm -o wireframe-ships.prg
```

The object tables, the start angles and the expected values in the
listing were printed by this script (Python 3; Pillow only for the
optional picture). It is an integer model of the whole program: the
same sine and reciprocal tables, the same matrix, shift and truncation
rules, the same winding test, outcodes and Bresenham, with the same
endpoint swap and error term, and EOR plotting. It also checks every
face decision against a floating-point normal test. The sine,
reciprocal and both square tables that KickAssembler builds were read
back out of the PRG and are identical to the model's.

```python
#!/usr/bin/env python3
# gen.py -- integer model of wireframe-ships.asm and its galaxy readout.
# Mirrors the machine code step for step: sine table, rotation matrix,
# transform, reciprocal projection, screen-space winding cull, outcodes,
# Bresenham with the same endpoint swap and error term, EOR plotting.
# Prints the KickAssembler lines for the expected values and writes
# model.png, the expected bitmap window, for the screenshot comparison.
import math, sys

NF = 48                                   # updates the program runs
XMIN, XMAX, YMIN, YMAX = 32, 191, 68, 187 # view window in virtual coordinates

SIN = [math.floor(64 * math.sin(2 * math.pi * i / 256) + 0.5) for i in range(256)]
def sn(a): return SIN[a & 255]
def cs(a): return SIN[(a + 64) & 255]
REC = [255 if z < 129 else 32768 // z for z in range(256)]

# ---- objects: vertices, faces (first three vertices set the winding), edges ----
def edges_of(faces):
    e = {}
    for fi, f in enumerate(faces):
        for k in range(len(f)):
            a, b = f[k], f[(k + 1) % len(f)]
            key = (min(a, b), max(a, b))
            e.setdefault(key, []).append(fi)
    out = []
    for (a, b), fl in sorted(e.items()):
        assert len(fl) == 2, (a, b, fl)
        out.append((a, b, fl[0], fl[1]))
    return out

C = 30
cube_v = [(-C,-C,-C),(C,-C,-C),(C,C,-C),(-C,C,-C),(-C,-C,C),(C,-C,C),(C,C,C),(-C,C,C)]
cube_f = [(0,1,2,3),(5,4,7,6),(4,0,3,7),(1,5,6,2),(4,5,1,0),(3,2,6,7)]
pyr_v  = [(-32,24,-32),(32,24,-32),(32,24,32),(-32,24,32),(0,-40,0)]
pyr_f  = [(0,4,1),(1,4,2),(2,4,3),(3,4,0),(0,1,2,3)]
# ship: a nose over a flat hexagonal stern (original design)
ship_v = [(0,0,52),(-44,0,-20),(-16,-12,-20),(16,-12,-20),(44,0,-20),(16,10,-20),(-16,10,-20)]
ship_f = [(0,2,1),(0,3,2),(0,4,3),(0,5,4),(0,6,5),(0,1,6),(1,2,3,4,5,6)]

OBJS = [  # vertices, faces, position (ox, oy, oz), start angles (a, b), steps (da, db)
    dict(v=cube_v, f=cube_f, pos=(-58,-52,196), ang=(0,20),   step=(3,2)),
    dict(v=pyr_v,  f=pyr_f,  pos=(-44,44,200),   ang=(40,0),   step=(-2,3)),
    dict(v=ship_v, f=ship_f, pos=(72,6,192),    ang=(100,60), step=(2,-3)),
]

def fix_winding():
    # Order each face so that the machine's rule (cross > 0 = visible) holds
    # for a face whose outward normal points at the camera: tested once at
    # angle 0 in float, face by face.
    for o in OBJS:
        cx = sum(p[0] for p in o['v']) / len(o['v'])
        cy = sum(p[1] for p in o['v']) / len(o['v'])
        cz = sum(p[2] for p in o['v']) / len(o['v'])
        nf = []
        for f in o['f']:
            a, b, c = (o['v'][i] for i in f[:3])
            u = [b[i]-a[i] for i in range(3)]; w = [c[i]-a[i] for i in range(3)]
            n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]]
            m = [sum(o['v'][i][k] for i in f)/len(f) for k in range(3)]
            out = (m[0]-cx)*n[0] + (m[1]-cy)*n[1] + (m[2]-cz)*n[2]
            nf.append(tuple(f) if out > 0 else tuple(reversed(f)))
        o['f'] = nf
        o['e'] = edges_of(nf)

def matrix(a, b):
    sa, ca, sb, cb = sn(a), cs(a), sn(b), cs(b)
    return [[ca, 0, sa],
            [(sa*sb) >> 6, cb, -((ca*sb) >> 6)],
            [-((sa*cb) >> 6), sb, (ca*cb) >> 6]]

def project(o, M):
    ox, oy, oz = o['pos']
    pts = []
    for (x, y, z) in o['v']:
        r = [(M[i][0]*x + M[i][1]*y + M[i][2]*z) >> 6 for i in range(3)]
        for i in range(3): assert -128 <= r[i] <= 127
        xc, yc, zc = ox + r[0], oy + r[1], oz + r[2]
        assert -127 <= xc <= 127 and -127 <= yc <= 127 and 129 <= zc <= 255, (xc, yc, zc)
        f = REC[zc]
        px = (abs(xc) * f) >> 8; py = (abs(yc) * f) >> 8
        pts.append((128 + (px if xc >= 0 else -px), 128 + (py if yc >= 0 else -py), (xc, yc, zc)))
    return pts

def faces_visible(o, pts, M):
    mask = 0
    for fi, f in enumerate(o['f']):
        p0, p1, p2 = (pts[i] for i in f[:3])
        dx1, dy1, dx2, dy2 = p1[0]-p0[0], p1[1]-p0[1], p2[0]-p0[0], p2[1]-p0[1]
        for d in (dx1, dy1, dx2, dy2): assert -127 <= d <= 127, d
        c = dx1*dy2 - dy1*dx2
        assert -32768 <= c <= 32767
        if c < 0: mask |= 1 << fi
    return mask

def outcode(x, y):
    return (1 if x < XMIN else 0) | (2 if x > XMAX else 0) | (4 if y < YMIN else 0) | (8 if y > YMAX else 0)

def line_pixels(x0, y0, x1, y1):
    dx, dy = abs(x1-x0), abs(y1-y0)
    px = []
    if dx >= dy:
        if x0 > x1: x0, y0, x1, y1 = x1, y1, x0, y0
        sy = 1 if y1 >= y0 else -1
        err, x, y = dx >> 1, x0, y0
        while True:
            px.append((x, y))
            if x == x1: break
            err -= dy
            if err < 0: err += dx; y += sy
            x += 1
    else:
        if y0 > y1: x0, y0, x1, y1 = x1, y1, x0, y0
        sx = 1 if x1 >= x0 else -1
        err, x, y = dy >> 1, x0, y0
        while True:
            px.append((x, y))
            if y == y1: break
            err -= dx
            if err < 0: err += dy; x += sx
            y += 1
    return px

def lines_for(o, a, b):
    M = matrix(a, b)
    pts = project(o, M)
    vis = faces_visible(o, pts, M)
    out = []
    for (v0, v1, fa, fb) in o['e']:
        if not (vis >> fa & 1 or vis >> fb & 1): continue
        x0, y0 = pts[v0][:2]; x1, y1 = pts[v1][:2]
        c0, c1 = outcode(x0, y0), outcode(x1, y1)
        if c0 & c1: continue                      # trivial reject
        out.append((x0, y0, x1, y1, 1 if (c0 | c1) else 0))
    return out, vis, pts, M

def float_cull(o, a, b):
    # reference: outward normal . (face point - camera) < 0, in float
    ra, rb = 2*math.pi*a/256, 2*math.pi*b/256
    def rot(p):
        x, y, z = p
        x1, z1 = x*math.cos(ra) + z*math.sin(ra), -x*math.sin(ra) + z*math.cos(ra)
        return (x1, y*math.cos(rb) - z1*math.sin(rb), y*math.sin(rb) + z1*math.cos(rb))
    mask, margin = 0, []
    for fi, f in enumerate(o['f']):
        P = [rot(o['v'][i]) for i in f[:3]]
        u = [P[1][k]-P[0][k] for k in range(3)]; w = [P[2][k]-P[0][k] for k in range(3)]
        n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]]
        q = [P[0][k] + o['pos'][k] for k in range(3)]
        d = sum(n[k]*q[k] for k in range(3)) / (math.sqrt(sum(t*t for t in n)) * math.sqrt(sum(t*t for t in q)))
        if d < 0: mask |= 1 << fi
        margin.append(abs(d))
    return mask, margin

def run():
    fix_winding()
    bm = {}
    total_lines = 0; ck = 0; line_calls = 0
    heaps = [[] for _ in OBJS]
    ang = [list(o['ang']) for o in OBJS]
    cull_mismatch = 0
    per_frame = []
    for fr in range(NF):
        frame_lines = 0; frame_pix = 0
        for i, o in enumerate(OBJS):
            ang[i][0] = (ang[i][0] + o['step'][0]) & 255
            ang[i][1] = (ang[i][1] + o['step'][1]) & 255
            new, vis, pts, M = lines_for(o, *ang[i])
            fm, margin = float_cull(o, *ang[i])
            if fm != vis:
                bad = [k for k in range(len(o['f'])) if (fm ^ vis) >> k & 1]
                if any(margin[k] > 0.02 for k in bad): cull_mismatch += 1  # beyond 0.02 of edge-on
            for L in heaps[i] + new:                  # erase old, draw new
                line_calls += 1
                for (x, y) in line_pixels(*L[:4]):
                    frame_pix += 1
                    if XMIN <= x <= XMAX and YMIN <= y <= YMAX:
                        bm[(x, y)] = bm.get((x, y), 0) ^ 1
            heaps[i] = new
            for L in new:
                total_lines += 1; ck = (ck + L[0] + L[1] + L[2] + L[3]) & 0xFFFF
            frame_lines += len(new)
        per_frame.append((frame_lines, frame_pix))
    return bm, heaps, total_lines, ck, cull_mismatch, per_frame, line_calls, ang

def fletcher(bm):
    # bitmap bytes of rows 0-15 (cells), in memory order, as the program sums them
    s1 = s2 = 0; pop = 0
    for row in range(16):
        for col in range(40):
            for ln in range(8):
                by = row*8 + ln; byte = 0
                for bit in range(8):
                    bx = col*8 + bit; vx, vy = bx - 32, by + 68
                    if bm.get((vx, vy), 0): byte |= 0x80 >> bit; pop += 1
                s1 = (s1 + byte) & 255; s2 = (s2 + s1) & 255
    return s1, s2, pop

# ---- galaxy ----
PAIRS = "..LEXEGEZACEBISOUSESARMAINDIREA.ERATENBERALAVETIEDORQUANTEISRION"
def twist(s): return [s[1], s[2], (s[0] + s[1] + s[2]) & 0xFFFF]
def galaxy(n):
    s = [0x5A4A, 0x0248, 0xB753]; out = []
    for _ in range(n):
        long_ = s[0] & 0x40; t = list(s); name = ""
        for k in range(4):
            p = (t[2] >> 8) & 31; t = twist(t)
            if (k < 3 or long_) and p: name += PAIRS[2*p:2*p+2].replace('.', '')
        out.append((name, s[1] >> 8, (s[0] >> 8) >> 1, list(s)))
        s = t
    return out

def emit_data():
    fix_winding()
    def row(label, vals): print("%-8s .byte %s" % (label + ":", ", ".join(str(v) for v in vals)))
    vs, fs, es = [], [], []
    row("vx", [p[0] for o in OBJS for p in o['v']])
    row("vy", [p[1] for o in OBJS for p in o['v']])
    row("vz", [p[2] for o in OBJS for p in o['v']])
    row("fa", [f[0] for o in OBJS for f in o['f']])
    row("fb", [f[1] for o in OBJS for f in o['f']])
    row("fc", [f[2] for o in OBJS for f in o['f']])
    row("e0", [e[0] for o in OBJS for e in o['e']])
    row("e1", [e[1] for o in OBJS for e in o['e']])
    row("ef0", [e[2] for o in OBJS for e in o['e']])
    row("ef1", [e[3] for o in OBJS for e in o['e']])
    acc = [0, 0, 0]; st = [[], [], []]
    for o in OBJS:
        for k, key in enumerate(('v', 'f', 'e')):
            st[k].append(acc[k]); acc[k] += len(o[key])
    row("o_vst", st[0]); row("o_vn", [len(o['v']) for o in OBJS])
    row("o_fst", st[1]); row("o_fn", [len(o['f']) for o in OBJS])
    row("o_est", st[2]); row("o_en", [len(o['e']) for o in OBJS])
    row("o_x", [o['pos'][0] for o in OBJS]); row("o_y", [o['pos'][1] for o in OBJS]); row("o_z", [o['pos'][2] for o in OBJS])
    row("ang_a", [o['ang'][0] for o in OBJS]); row("ang_b", [o['ang'][1] for o in OBJS])
    row("ang_a0", [o['ang'][0] for o in OBJS]); row("ang_b0", [o['ang'][1] for o in OBJS])
    row("stp_a", [o['step'][0] for o in OBJS]); row("stp_b", [o['step'][1] for o in OBJS])
    g = galaxy(8)
    print('exp_names: .text "%s"' % "".join(n.ljust(8) for n, x, y, s in g))
    row("exp_gx", [x for n, x, y, s in g]); row("exp_gy", [y for n, x, y, s in g])

if __name__ == "__main__":
    bm, heaps, total, ck, mism, pf, calls, ang = run()
    s1, s2, pop = fletcher(bm)
    last = sum(len(h) for h in heaps)
    print("// model: %d lines in the last update, %d over the run, "
          "cull mismatches beyond 0.02 of edge-on %d" % (last, total, mism))
    print("// model: %d line calls, %d pixels visited, %d set in the window" % (calls, sum(p for l, p in pf), pop))
    print(".const EXP_LAST  = %d" % last)
    print(".const EXP_TOTAL = %d" % total)
    print(".const EXP_SUM   = $%04x" % ck)
    print(".const EXP_S1    = $%02x" % s1)
    print(".const EXP_S2    = $%02x" % s2)
    emit_data()
    for name, x, y, s in galaxy(8):
        print("// %-8s x=%3d y=%3d seeds %s" % (name, x, y, " ".join("%04X" % v for v in s)))
    if len(sys.argv) > 1:                 # expected bitmap rows 0-15, 320 x 128
        from PIL import Image
        im = Image.new("L", (320, 128), 0)
        for (x, y), v in bm.items():
            if v: im.putpixel((x + 32, y - 68), 255)
        im.save(sys.argv[1])
```

`python3 gen.py model.png` prints:

```text
// model: 19 lines in the last update, 1005 over the run, cull mismatches beyond 0.02 of edge-on 0
// model: 1991 line calls, 64728 pixels visited, 575 set in the window
.const EXP_LAST  = 19
.const EXP_TOTAL = 1005
.const EXP_SUM   = $84ea
.const EXP_S1    = $8c
.const EXP_S2    = $99
```

then the data lines of the listing, then the eight systems:

```text
// TIBEDIED x=  2 y= 45 seeds 5A4A 0248 B753
// QUBE     x=152 y=102 seeds CD80 98B8 7A1D
// LELEER   x= 77 y=121 seeds F32A 4D9C 211B
// BIARGE   x= 83 y=104 seeds D098 5394 860D
// XEQUERIN x=180 y= 65 seeds 83DA B420 E233
// TIRAOR   x=172 y= 88 seeds B080 ACE0 778D
// RABEDIRA x= 69 y=124 seeds F95A 45D4 141B
// LAVE     x= 20 y= 86 seeds AD38 149C 151D
```

The screenshot check compares bitmap rows 0-15 of the exit screenshot
with `model.png` pixel by pixel and decodes the readout with the
character ROM:

```python
#!/usr/bin/env python3
# check_shot.py -- compare the exit screenshot's bitmap rows 0-15 with the
# model picture from gen.py, and decode the readout rows with the char ROM.
# usage: check_shot.py shot.png model.png pal|ntsc chargen-901225-01.bin
import sys
from PIL import Image
shot, model, region, romfile = sys.argv[1:5]
top = 35 if region == "pal" else 23          # screenshot row of raster line 51
im = Image.open(shot).convert("RGB"); md = Image.open(model)
bad = sum((im.getpixel((32 + x, top + y)) != (0, 0, 0)) != (md.getpixel((x, y)) > 0)
          for y in range(128) for x in range(320))
print("pixels differing from the model:", bad)
rom = open(romfile, "rb").read()
glyph = {tuple(rom[c*8:c*8+8]): c for c in range(64)}
for row in range(16, 25):
    line = ""
    for col in range(40):
        cell = tuple(sum(0x80 >> b for b in range(8)
                         if im.getpixel((32 + col*8 + b, top + row*8 + n)) != (0, 0, 0))
                     for n in range(8))
        c = glyph.get(cell, 63) if any(cell) else 32
        line += chr(64 + c) if 1 <= c <= 26 else chr(c) if c >= 32 else "@"
    print(line.rstrip())
```

## Expected output

Border green. The window shows the three objects in white on black;
below it, decoded from the PNG with the character ROM (the status row is
green, the rest white):

```text
WIREFRAME PASS UPDATES 48 LINES 19
WORST UPDATE 155708 LAST 131620
LINE CALLS 1991 CYC/LINE 2350
MATRIX 523 CYC/VERTEX 1179 SHIP 47467
GALAXY PASS CYC/SYSTEM 733
TIBEDIED 2,45       QUBE     152,102
LELEER   77,121     BIARGE   83,104
XEQUERIN 180,65     TIRAOR   172,88
RABEDIRA 69,124     LAVE     20,86
```

That is the PAL screen. The NTSC screen differs only in the timings:
`WORST UPDATE 157212 LAST 133169`, `CYC/LINE 2370`,
`MATRIX 522 CYC/VERTEX 1228 SHIP 48152`, `CYC/SYSTEM 733`.

Screenshots from the pinned run, 20,000,000 cycles:
`screenshots/wireframe-ships.png` (PAL) and
`screenshots/wireframe-ships-ntsc.png` (NTSC). In both, bitmap rows
0-15 match `model.png` with 0 differing pixels, and 575 pixels are set,
the model's count. The border pixel (5, 5) is (98, 213, 50) on PAL and
(114, 189, 103) on NTSC, palette index 5 in `runtime/vice-reference.md`.
The pinned command was run twice per model and the two PNGs were
identical bytes each time. At 17,000,000 cycles the PAL readout is not
yet complete.

The figures, measured in VICE x64sc 3.10 with the display on, so every
figure includes the cycles badlines take:

| Figure | PAL | NTSC | What was timed |
|---|---|---|---|
| Worst update of pass 2 | 155,708 | 157,212 | all three objects, CIA1 per object, summed |
| Last update of pass 2 | 131,620 | 133,169 | the frozen picture's update |
| Cycles per line call | 2,350 | 2,370 | CIA2 total over the 1,991 erase and draw calls of pass 1, gate overhead removed |
| Matrix build | 523 | 522 | one `build_matrix` |
| Transform and project, per vertex | 1,179 | 1,228 | `xform_all` on the ship's 7 vertices, divided by 7 |
| Ship, last update | 47,467 | 48,152 | matrix, 7 vertices, 7 faces, erase and draw |
| One galaxy system, worst of 8 | 733 | 733 | coordinates, name, four twists |

Derived by arithmetic from those: the worst update is 7.9 PAL frames
(19,656 cycles) and 9.2 NTSC frames (17,095 cycles), so this code
animates at about 6 updates a second. The model visits 64,728 pixels in
the 1,991 line calls, 32.5 a line, so a line costs about 72 cycles a
pixel with its set-up spread over it. Line calls average 97,500 cycles
an update (1,991 calls at 2,350 cycles over 48 updates): 74% of the last
update and 63% of the worst.

## Why this works

**Rotation.** The sine table holds `round(64 * sin)`, so a matrix entry
is a signed byte from -64 to 64. The matrix is rotation about y by
angle `a` followed by rotation about x by angle `b`; its four products
of two sines are shifted right 6. A row times a vertex is three signed
products summed in 16 bits; shifting the sum left twice and taking the
high byte is the sum shifted right 6, rounded down. The signed multiply
is `sq[a + b] - sq[a - b]` with `sq[s] = floor(s * s / 4)` indexed by
the signed byte `s`. It needs no sign handling, provided `a + b` and
`a - b` stay within -128 to 128. Matrix entries are at most 64 and
vertex coordinates at most 52, so they do; `s = 128` wraps to -128, and
both have the same square. The two floors cancel because `a + b` and
`a - b` have the same parity.

**Projection.** Camera z runs from 129 to 255 by placement (the model
asserts it on every vertex of every update), and
`rectab[z] = floor(32768 / z)` fits a byte there. Screen x is
`128 + (|x| * rectab[z]) >> 8` with the sign of x put back afterwards,
so the result truncates towards zero on both sides. That product uses
the unsigned quarter-square tables of 512 entries, because
`|x| + rectab[z]` reaches 382.

**Culling.** A face is drawn when its first three projected vertices
turn one way on the screen (`dx1 * dy2 - dy1 * dx2 < 0`). The model
orders every face's vertices so that this holds for a face whose outward
normal points at the camera. With perspective this test is exact apart
from rounding: over the 864 face tests of the run it disagreed with a
floating-point normal test 5 times. In each, the cosine between the face
normal and the line of sight was within 0.018 of 0, about 1 degree from
edge-on. The model counts a disagreement only beyond 0.02 of edge-on,
and there were none. That check is in the Python model only; the listing
does not do it. An edge is drawn when either of its two faces is
visible, and only once. That matters with EOR, because an edge drawn
twice would cancel itself.

**Clipping.** Each endpoint gets an outcode (left, right, above, below).
If the two outcodes share a bit, the line is wholly outside and is
dropped. If both are 0, the line is drawn with the loop that does not
test pixels. Otherwise it is drawn with the loop that skips pixels
outside the window. Bresenham then yields the same inside pixels as a
line cut at the edge, so the model needs no intersection arithmetic.
All coordinates fit a byte because the window is smaller than the
virtual screen.

**Lines.** The line steps along its longer axis, swapping the ends so
that the step is +1. The error term starts at half the long delta. Each
step subtracts the short delta; when that borrows, the long delta is
added back and the short axis steps. The subtract and the add-back are
8-bit, and the borrow is the carry flag, so no 9-bit error is needed.
The plot is `ptr = ylo/yhi[y]` for the row, then
`LDY xcol,X / LDA (ptr),Y / EOR xmask,X / STA (ptr),Y`. The window's
bitmap x never passes 255, so the column offset fits Y. The x-major
loop reloads `ptr` only when y steps.

**Why the line drawer is slow.** This is a correct, fully measured
first recipe, not a fast plotter. The figures below are arithmetic from
the instruction table over the listing's loops, and the pixel counts
come from the model; only the totals were measured. An x-major pixel
without a y step costs about 43 cycles: the plot itself
(`LDY xcol,X / LDA (ptr),Y / EOR xmask,X / STA (ptr),Y`) is about 19,
and the rest is the error term in zero page and the `JMP` back to the
loop, every pixel. An x-major pixel with a y step costs about 72,
because the row pointer is reloaded. A y-major pixel costs about 66 to
77, because the row pointer (17 cycles) is reloaded on every pixel. The
clip tests add about 19 cycles to each pixel of a line that needs them,
32% of the pixels visited, and 9% of the pixels visited are outside the
window and are walked for nothing. The loops account for about 4.4
million of the 4.68 million measured line cycles; set-up is about 140
cycles a call, about 6%. The two biggest costs are the row-pointer
reload on every y-major pixel and the read-modify-write on every pixel
with the error term and `cy` kept in zero page, not in registers.

**Erase by redraw.** Each object keeps the lines it drew (four bytes and
the clip flag each) in a heap. The next update draws them again with EOR
before drawing the new ones, and that erases them exactly, even where
they cross other objects' lines. EOR has one visible cost: a pixel
where an even number of lines meet is clear. The frozen picture has 9
such pixels, all at or beside vertices: 8 at shared endpoints, 1 where
two shallow edges leave a vertex along the same pixel. The model has the
same 9.

**Screen.** VIC bank 1: `$DD00` bits 0-1 = `%10`, `$D018 = $18` puts the
matrix at `$4400` and the bitmap at `$6000`. Code and tables stay below
`$4000` (an `.assert` checks it), so the bitmap never overlaps them. The
readout copies glyphs from the character ROM into the bitmap with `$01 =
$33`. That is safe here because interrupts are off for the whole program
(`pitfalls/banking.md`, `charset_under_io_invisible_to_cpu` and
`irq_during_charen_window`).

**Timing.** CIA1 timers A and B, chained, are a 32-bit down-counter
started and stopped around each object; an empty start/stop pair is
timed once and subtracted. CIA2 is chained the same way but only runs
between the `STA $DD0E` that resumes it and the one that pauses it
around each line; an empty resume/pause pair is timed and subtracted
per call. Pass 2 keeps only a `BIT harness` and a taken `BPL` per line
call and per stored line (7 cycles each by the instruction table, about
400 cycles in an update of 20 lines), so its update figures are the
technique's own work.

**Galaxy.** One twist sets `s0 = s1`, `s1 = s2`, `s2 = s0 + s1 + s2`
(16-bit, carries dropped). A system's x is `s1` high byte, its y is `s0`
high byte shifted right once. Its name takes bits 0-4 of `s2` high byte
before each of four twists; the pair is used for the first three twists,
and for the fourth only when bit 6 of `s0` low byte is set. Pair 0 adds
nothing, and a `.` in the pair table is a silent second letter. After
the four twists the seeds are the next system's. The rule is Elite's, as
Moxon documents it; the code is this recipe's. The token string is data
from Elite (Ian Bell and David Braben, 1984) as Moxon lists it at QQ16.
Index 0 is written `..` because it is never used, and the silent letter
is written `.`.
Moxon's worked example gives Lave's seeds as `s0 = $AD38`,
`s1 = $149C`, `s2 = $151D`, with the pairs LA (token 149) and VE (token
150), coordinates x = 20 and y = 86. The program's eighth system is
LAVE, with those seeds (model) and coordinates (screen).

## What this recipe does not show

No double buffer: the objects are erased and redrawn in the displayed
bitmap, so a line is missing from the screen between its erase and its
redraw. The technique page describes the two-bank alternative. The
recipe does not clip by intersection: a line that crosses the edge walks
its outside pixels too. That costs time on long lines, and it would not
work for coordinates beyond a byte. There is no near-plane test: camera
z is kept at 129 or more by placement, and a game must reject or clip
anything nearer. Objects do not hide each other. The plotter recomputes
the row pointer on every y step; an incremental plotter that steps the
byte address and the bit mask is faster, and was not measured here. Only
the first galaxy is generated; the other seven come from rotating each
seed byte left by one bit (Moxon, not run here).

## Sources

- Mark Moxon, "Twisting the system seeds":
  https://elite.bbcelite.com/deep_dives/twisting_the_system_seeds.html
  (the twist, four twists a system, the Tibedied seeds, 8 galaxies of 256).
- Mark Moxon, "Generating system names":
  https://elite.bbcelite.com/deep_dives/generating_system_names.html
  (bits 0-4 of `s2_hi`, bit 6 of `s0_lo`, the Lave example).
- Mark Moxon, "Generating system data":
  https://elite.bbcelite.com/deep_dives/generating_system_data.html
  (x = `s1_hi`, y = `s0_hi` shifted right once).
- Mark Moxon, C64 Elite variable QQ16:
  https://elite.bbcelite.com/c64/main/variable/qq16.html (the 32
  two-letter tokens, 128-159).
