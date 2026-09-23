---
recipe: sqrt-atan2
toolchain: kickassembler
output_format: PRG
region: both
techniques: [isqrt_16bit, atan2_8bit]
file_formats: [PRG]
uses_registers: [DC04, DC05, DC0D, DC0E, D011, D012, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Integer square root and 8-bit atan2, checked against a host model and timed over every input

## Synopsis

Two routines a game needs for distance and aim: `isqrt16`, the integer
square root of a 16-bit value with an 8-bit result, by restoring
shift-and-subtract; and `atan2_8`, the angle of a signed 8-bit `(dx, dy)`
in 256ths of a turn, by folding to the first octant, an eight-pass divide
for the ratio and a 256-byte arctangent table. The program checks 35
square roots (0, 1, 65535, perfect squares and their neighbours) and 36
angles (both axes in both directions, every octant, the diagonals, the
three worst pairs the host model found) against expected values compiled
in from the Python script below, then times every one of the 65,536
inputs of each routine with CIA1 timer A and prints the worst body cost
and the input that produced it. For the square root it also checks
`rem <= 2 * root` on every input, which is `n < (root + 1)^2`. It writes
`$01` to `$02FF` and turns the border green when every case is within
tolerance (0 for the root, 1 angle unit for atan2), `$02` and red
otherwise. The techniques are `isqrt_16bit` and `atan2_8bit` in
`techniques/maths.md`.

Angle convention: 0 is `+dx` (right), 64 is `+dy` (down on a screen whose
y grows downward), 128 is `-dx`, 192 is `-dy`; the exact value is
`round(atan2(dy, dx) * 256 / 2pi) mod 256`.

## Source

```asm
// sqrt-atan2.asm
// Integer square root of a 16-bit value (8-bit result) by shift-and-subtract,
// and an 8-bit atan2 (signed 8-bit dx, dy in; angle 0-255 out) by octant
// folding, an 8-pass divide for the ratio and a 256-byte arctangent table.
// Both are checked against compiled-in expected values from a Python model
// (the generator is quoted on the page), every input of each routine is timed
// with CIA1 timer A, and the largest body cost of each routine is printed.
// Verdict: $02FF = $01 and a green border when every case is within
// tolerance, $02 and red otherwise.
//
// Angle convention: 0 = +dx (right), 64 = +dy (down on a screen whose y grows
// downward), 128 = -dx, 192 = -dy. Exact value = round(atan2(dy, dx) * 256 / 2pi).
.encoding "screencode_upper"

.const SCREEN    = $0400
.const COLRAM    = $d800
.const RESULT    = $02ff
.const SQ_TOL    = 0            // isqrt must be exact
.const AT_TOL    = 1            // atan2 within one angle unit (1/256 turn)
.const NSQ       = 35           // check cases, from the generator
.const NAT       = 36

// zero page scratch; the program never returns to BASIC
.const num       = $f7          // isqrt input, shifted out (2 bytes)
.const rem       = $f9          // isqrt remainder (2 bytes)
.const root      = $fb          // isqrt result
.const trial     = $fc          // isqrt trial subtrahend (2 bytes)
.const arg_dx    = $02          // atan2 inputs
.const arg_dy    = $03
.const ax        = $04          // |dx|, |dy|
.const ay        = $05
.const quo       = $06          // divide quotient / table index
.const angle     = $07          // atan2 result
.const tmp       = $08
.const zp_val    = $09          // 16-bit value for the decimal printer
.const zp_row    = $0b          // screen pointer for the printers (2 bytes)
.const cyc       = $0d          // last measured cycle count (2 bytes)
.const str_ptr   = $0f          // string pointer for print_str (2 bytes)
.const chk       = $11          // 2 * root for the remainder invariant (2 bytes)
.const n_cnt     = $13          // sweep counter (2 bytes)

BasicUpstart2(start)

start:
        sei
        lda #$7f
        sta $dc0d               // no CIA1 interrupts
        lda $dc0d
        lda #0
        sta $d020
        sta $d021
        jsr clear_screen
        lda $d011
        and #%11101111          // DEN off: VIC samples it on line $30, so the
        sta $d011               // badlines stop from the next frame on
        jsr wait_line255
        jsr wait_line255
        jsr time_empty          // jsr/rts and timer overhead, measured once

        ldy #0
        ldx #<txt_hdr
        lda #>txt_hdr
        jsr print_str

        // ---------- isqrt cases ----------
        lda #0
        sta sq_fail
        sta sq_maxerr
        ldx #0
sq_loop:
        stx case_idx
        lda sq_in_lo,x
        sta num
        lda sq_in_hi,x
        sta num+1
        jsr isqrt16
        ldx case_idx
        lda root
        sec
        sbc sq_exp,x
        bcs !+
        eor #$ff                // negate: |root - expected|
        adc #1
!:      cmp sq_maxerr
        bcc !+
        sta sq_maxerr
!:      cmp #SQ_TOL+1
        bcc !+
        inc sq_fail
!:      inx
        cpx #NSQ
        bne sq_loop

        // ---------- atan2 cases ----------
        lda #0
        sta at_fail
        sta at_maxerr
        ldx #0
at_loop:
        stx case_idx
        lda at_dx,x
        sta arg_dx
        lda at_dy,x
        sta arg_dy
        jsr atan2_8
        ldx case_idx
        lda angle
        sec
        sbc at_exp,x            // difference modulo 256
        cmp #$80
        bcc !+
        eor #$ff                // wrap: 255 -> 1
        clc
        adc #1
!:      cmp at_maxerr
        bcc !+
        sta at_maxerr
!:      cmp #AT_TOL+1
        bcc !+
        inc at_fail
!:      inx
        cpx #NAT
        bne at_loop

        // ---------- isqrt sweep: every input, timed, remainder invariant ----------
        lda #0
        sta n_cnt
        sta n_cnt+1
        sta sq_maxcyc
        sta sq_maxcyc+1
        sta inv_fail
        sta inv_fail+1
sw_sq:
        lda n_cnt
        sta num
        lda n_cnt+1
        sta num+1
        jsr time_isqrt
        lda cyc+1
        cmp sq_maxcyc+1
        bcc sw_sq_inv
        bne sw_sq_new
        lda cyc
        cmp sq_maxcyc
        bcc sw_sq_inv
        beq sw_sq_inv           // keep the first input that reached the max
sw_sq_new:
        lda cyc
        sta sq_maxcyc
        lda cyc+1
        sta sq_maxcyc+1
        lda n_cnt
        sta sq_maxarg
        lda n_cnt+1
        sta sq_maxarg+1
sw_sq_inv:
        lda root                // n < (root + 1)^2  <=>  rem <= 2 * root
        asl
        sta chk
        lda #0
        rol
        sta chk+1
        lda chk
        cmp rem
        lda chk+1
        sbc rem+1
        bcs !+
        inc inv_fail
        bne !+
        inc inv_fail+1
!:      inc n_cnt
        bne sw_sq
        inc n_cnt+1
        bne sw_sq

        // ---------- atan2 sweep: every (dx, dy) pair, timed ----------
        lda #0
        sta at_maxcyc
        sta at_maxcyc+1
        sta arg_dx
sw_at_x:
        lda #0
        sta arg_dy
sw_at_y:
        jsr time_atan2
        lda cyc+1
        cmp at_maxcyc+1
        bcc sw_at_next
        bne sw_at_new
        lda cyc
        cmp at_maxcyc
        bcc sw_at_next
        beq sw_at_next
sw_at_new:
        lda cyc
        sta at_maxcyc
        lda cyc+1
        sta at_maxcyc+1
        lda arg_dx
        sta at_maxarg
        lda arg_dy
        sta at_maxarg+1
sw_at_next:
        inc arg_dy
        bne sw_at_y
        inc arg_dx
        bne sw_at_x

        // ---------- report ----------
        ldy #2
        ldx #<txt_sq
        lda #>txt_sq
        jsr print_str
        lda #NSQ
        ldx #12
        ldy #2
        jsr print_dec3
        lda sq_maxerr
        ldx #25
        ldy #2
        jsr print_dec3
        lda sq_fail
        ldx #35
        ldy #2
        jsr print_dec3

        ldy #3
        ldx #<txt_at
        lda #>txt_at
        jsr print_str
        lda #NAT
        ldx #12
        ldy #3
        jsr print_dec3
        lda at_maxerr
        ldx #25
        ldy #3
        jsr print_dec3
        lda at_fail
        ldx #35
        ldy #3
        jsr print_dec3

        ldy #5
        ldx #<txt_cyc
        lda #>txt_cyc
        jsr print_str
        ldy #6
        ldx #<txt_cyc_sq
        lda #>txt_cyc_sq
        jsr print_str
        lda sq_maxcyc
        sta zp_val
        lda sq_maxcyc+1
        sta zp_val+1
        ldx #20
        ldy #6
        jsr print_dec5
        lda sq_maxarg
        sta zp_val
        lda sq_maxarg+1
        sta zp_val+1
        ldx #30
        ldy #6
        jsr print_dec5
        ldy #7
        ldx #<txt_cyc_at
        lda #>txt_cyc_at
        jsr print_str
        lda at_maxcyc
        sta zp_val
        lda at_maxcyc+1
        sta zp_val+1
        ldx #20
        ldy #7
        jsr print_dec5
        lda at_maxarg
        ldx #30
        ldy #7
        jsr print_hex2
        lda at_maxarg+1
        ldx #34
        ldy #7
        jsr print_hex2
        ldy #8
        ldx #<txt_inv
        lda #>txt_inv
        jsr print_str
        lda inv_fail
        sta zp_val
        lda inv_fail+1
        sta zp_val+1
        ldx #30
        ldy #8
        jsr print_dec5

        // sample results on one line each: sqrt(65535), atan2(10,3)
        ldy #9
        ldx #<txt_s1
        lda #>txt_s1
        jsr print_str
        lda #$ff
        sta num
        sta num+1
        jsr isqrt16
        lda root
        ldx #20
        ldy #9
        jsr print_dec3
        ldy #10
        ldx #<txt_s2
        lda #>txt_s2
        jsr print_str
        lda #10
        sta arg_dx
        lda #3
        sta arg_dy
        jsr atan2_8
        lda angle
        ldx #20
        ldy #10
        jsr print_dec3

        lda $d011
        ora #%00010000          // DEN back on for the picture
        sta $d011

        // ---------- verdict ----------
        lda sq_fail
        ora at_fail
        bne fail
        lda #1
        sta RESULT
        lda #5
        sta $d020
        ldy #12
        ldx #<txt_pass
        lda #>txt_pass
        jsr print_str
        jmp forever
fail:
        lda #2
        sta RESULT
        sta $d020
        ldy #12
        ldx #<txt_fail
        lda #>txt_fail
        jsr print_str
forever:
        jmp forever

// ============================================================
// isqrt16: root = floor(sqrt(num)), num is destroyed, rem = num - root*root.
// Restoring shift-and-subtract, two input bits per pass, eight passes.
// Both routines sit in one page so no taken branch pays a page-crossing
// cycle; the assert below fails the build if a change pushes them over.
// ============================================================
.align $100
isqrt16:
        lda #0
        sta root
        sta rem
        sta rem+1
        ldx #8
sq_pass:
        asl num                 // bring down the next two bits of num
        rol num+1
        rol rem
        rol rem+1
        asl num
        rol num+1
        rol rem
        rol rem+1
        lda root                // trial = 4 * root + 1; root = 2 * root
        asl
        sta root
        asl
        ora #1
        sta trial
        lda #0
        rol                     // carry out of the second asl is bit 8 of trial
        sta trial+1
        lda rem+1               // if rem >= trial: rem -= trial, root |= 1
        cmp trial+1
        bcc sq_next
        bne sq_sub
        lda rem
        cmp trial
        bcc sq_next
sq_sub:
        lda rem
        sbc trial               // carry is set on both paths into sq_sub
        sta rem
        lda rem+1
        sbc trial+1
        sta rem+1
        inc root
sq_next:
        dex
        bne sq_pass
        rts

// ============================================================
// atan2_8: angle = atan2(arg_dy, arg_dx) in 1/256 turn, 0 for (0, 0).
// Fold to the first octant on the sign bits and a magnitude compare,
// index the table with floor(min * 256 / max) from an 8-pass divide,
// then unfold: 64 - a across the diagonal, 128 - a for dx < 0, -a for dy < 0.
// ============================================================
atan2_8:
        lda arg_dx
        bpl !+                  // sign from bit 7 of the input, no subtract involved
        eor #$ff
        clc
        adc #1
!:      sta ax                  // 0..128 as an unsigned byte
        lda arg_dy
        bpl !+
        eor #$ff
        clc
        adc #1
!:      sta ay
        ora ax
        bne !+
        sta angle               // both zero: angle 0, nothing to divide by
        rts
!:      lda ay
        cmp ax
        beq at_diag
        bcc at_low              // ay < ax: first octant, ratio ay / ax
        lda ax                  // ay > ax: second octant, ratio ax / ay
        ldx ay
        jsr ratio_div
        lda #64
        sec
        sbc quo
        jmp at_fold
at_diag:
        lda #32
        bne at_fold
at_low:
        lda ay
        ldx ax
        jsr ratio_div
        lda quo
at_fold:
        bit arg_dx
        bpl !+
        eor #$ff                // 128 - a  ==  -(a) + 128  ==  (a ^ $ff) + 129
        clc
        adc #129
!:      bit arg_dy
        bpl !+
        eor #$ff                // 256 - a  ==  (a ^ $ff) + 1
        clc
        adc #1
!:      sta angle
        rts

// ratio_div: quo = atan_tab[ floor(A * 256 / X) ], A < X <= 128.
// Eight shift-and-subtract passes; the remainder starts as A and stays below
// X, so its doubled value fits a byte and no ninth-bit test is needed.
ratio_div:
        stx tmp
        sta rem                 // remainder starts at the numerator
        lda #0
        sta quo
        ldx #8
rd_pass:
        asl quo                 // shift a zero dividend bit up into the remainder
        rol rem
        lda rem
        cmp tmp
        bcc rd_next
        sbc tmp                 // carry set by the compare
        sta rem
        inc quo
rd_next:
        dex
        bne rd_pass
        ldx quo
        lda atan_tab,x
        sta quo
        rts
routines_end:
.assert "isqrt16 and atan2_8 share one page", >isqrt16, >routines_end

// ============================================================
// timing: CIA1 timer A, one-shot, force-loaded from $FFFF, display off so
// no badline steals cycles. cyc = body cycles: jsr, rts and the timer
// start/stop overhead are measured with an empty routine and subtracted.
// ============================================================
time_isqrt:
        lda #$ff
        sta $dc04
        sta $dc05
        lda #%00011001          // load, one-shot, start
        sta $dc0e
        jsr isqrt16
        lda #0
        sta $dc0e
        jmp time_finish

time_atan2:
        lda #$ff
        sta $dc04
        sta $dc05
        lda #%00011001
        sta $dc0e
        jsr atan2_8
        lda #0
        sta $dc0e
        jmp time_finish

time_empty:
        lda #$ff
        sta $dc04
        sta $dc05
        lda #%00011001
        sta $dc0e
        jsr empty_rts
        lda #0
        sta $dc0e
        lda $dc04
        sta empty_lo
        lda $dc05
        sta empty_hi
        rts

empty_rts:
        rts

time_finish:
        // cyc = ($FFFF - timer) - ($FFFF - empty) = empty - timer
        lda empty_lo
        sec
        sbc $dc04
        sta cyc
        lda empty_hi
        sbc $dc05
        sta cyc+1
        rts

// wait_line255: returns just after raster line 255 has passed, so two calls
// span a whole frame and the VIC has seen DEN clear on line $30.
wait_line255:
        lda #$ff
!:      cmp $d012
        bne !-
!:      cmp $d012
        beq !-
        rts

// ============================================================
// screen helpers
// ============================================================
clear_screen:
        ldx #0
        lda #$20
!:      sta SCREEN,x
        sta SCREEN+$100,x
        sta SCREEN+$200,x
        sta SCREEN+$300,x
        inx
        bne !-
        lda #1
!:      sta COLRAM,x
        sta COLRAM+$100,x
        sta COLRAM+$200,x
        sta COLRAM+$300,x
        inx
        bne !-
        rts

// set_row: Y = row; zp_row = SCREEN + 40 * Y. Preserves X and A.
set_row:
        pha
        lda row_lo,y
        sta zp_row
        lda row_hi,y
        sta zp_row+1
        pla
        rts

// print_str: X/A = string address (lo/hi), Y = row, zero-terminated, column 0
print_str:
        stx str_ptr
        sta str_ptr+1
        jsr set_row
        ldy #0
!:      lda (str_ptr),y
        beq !+
        sta (zp_row),y
        iny
        bne !-
!:      rts

// print_hex2: A = byte, X = column, Y = row. Two hex digits.
print_hex2:
        pha
        jsr set_row
        txa
        clc
        adc zp_row
        sta zp_row
        bcc !+
        inc zp_row+1
!:      pla
        pha
        lsr
        lsr
        lsr
        lsr
        tax
        lda hex_scr,x
        ldy #0
        sta (zp_row),y
        pla
        and #15
        tax
        lda hex_scr,x
        iny
        sta (zp_row),y
        rts
hex_scr: .byte $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, 1, 2, 3, 4, 5, 6

// print_dec3: A = byte, X = column, Y = row. Three digits, leading zeros.
print_dec3:
        sta zp_val
        lda #0
        sta zp_val+1
        jsr set_row
        txa
        clc
        adc zp_row
        sta zp_row
        bcc !+
        inc zp_row+1
!:      ldx #2                  // start at the hundreds
        jmp dec_digits

// print_dec5: zp_val = 16-bit value, X = column, Y = row. Five digits.
print_dec5:
        jsr set_row
        txa
        clc
        adc zp_row
        sta zp_row
        bcc !+
        inc zp_row+1
!:      ldx #0
dec_digits:
        ldy #0
dd_loop:
        lda #$30
        sta tmp
dd_sub:
        lda zp_val
        cmp pow_lo,x
        lda zp_val+1
        sbc pow_hi,x
        bcc dd_put
        lda zp_val
        sbc pow_lo,x
        sta zp_val
        lda zp_val+1
        sbc pow_hi,x
        sta zp_val+1
        inc tmp
        bne dd_sub
dd_put:
        lda tmp
        sta (zp_row),y
        iny
        inx
        cpx #5
        bne dd_loop
        rts

pow_lo: .byte <10000, <1000, <100, <10, <1
pow_hi: .byte >10000, >1000, >100, >10, >1

row_lo: .fill 25, <(SCREEN + 40 * i)
row_hi: .fill 25, >(SCREEN + 40 * i)

case_idx:   .byte 0
sq_fail:    .byte 0
sq_maxerr:  .byte 0
sq_maxcyc:  .word 0
sq_maxarg:  .word 0
inv_fail:   .word 0
at_fail:    .byte 0
at_maxerr:  .byte 0
at_maxcyc:  .word 0
at_maxarg:  .word 0
empty_lo:   .byte 0
empty_hi:   .byte 0

txt_hdr:    .text "ISQRT16 AND ATAN2 8-BIT CHECK"
            .byte 0
txt_sq:     .text "SQRT  CASES      MAX ERR      FAIL"
            .byte 0
txt_at:     .text "ATAN2 CASES      MAX ERR      FAIL"
            .byte 0
txt_cyc:    .text "WORST BODY CYCLES OVER EVERY INPUT:"
            .byte 0
txt_cyc_sq: .text "  ISQRT16                   N="
            .byte 0
txt_cyc_at: .text "  ATAN2                      $   $"
            .byte 0
txt_inv:    .text "  REM<=2*ROOT FAILS OF 65536"
            .byte 0
txt_s1:     .text "SQRT(65535)     ="
            .byte 0
txt_s2:     .text "ATAN2(10,3)     ="
            .byte 0
txt_pass:   .text "RESULT: PASS"
            .byte 0
txt_fail:   .text "RESULT: FAIL"
            .byte 0

// ---- generated by the Python script on the page ----
sq_in_lo:
        .byte $00, $01, $02, $03, $04, $08, $09, $0f, $10, $11, $18, $19, $3f, $40, $41, $63
        .byte $64, $79, $90, $ff, $00, $01, $e8, $00, $ff, $00, $10, $00, $ff, $00, $00, $01
        .byte $02, $fe, $ff
sq_in_hi:
        .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $01, $01, $03, $04, $0f, $10, $27, $40, $7f, $80, $fe, $fe
        .byte $fe, $ff, $ff
sq_exp:
        .byte $00, $01, $01, $01, $02, $02, $03, $03, $04, $04, $04, $05, $07, $08, $08, $09
        .byte $0a, $0b, $0c, $0f, $10, $10, $1f, $20, $3f, $40, $64, $80, $b5, $b5, $fe, $ff
        .byte $ff, $ff, $ff
at_dx:
        .byte $01, $00, $ff, $00, $7f, $00, $80, $00, $0a, $03, $fd, $f6, $f6, $fd, $03, $0a
        .byte $05, $fb, $fb, $05, $7f, $80, $7f, $80, $01, $02, $01, $ff, $64, $c0, $2d, $88
        .byte $00, $81, $81, $81
at_dy:
        .byte $00, $01, $00, $ff, $00, $7f, $00, $80, $03, $0a, $0a, $03, $fd, $f6, $f6, $fd
        .byte $05, $05, $fb, $fb, $7f, $80, $80, $7f, $01, $01, $02, $fe, $db, $14, $a6, $f9
        .byte $00, $84, $8a, $95
at_exp:
        .byte $00, $40, $80, $c0, $00, $40, $80, $c0, $0c, $34, $4c, $74, $8c, $b4, $cc, $f4
        .byte $20, $60, $a0, $e0, $20, $a0, $e0, $60, $20, $13, $2d, $ad, $f2, $74, $d3, $82
        .byte $00, $a0, $9f, $9d
.align $100
atan_tab:
        .byte $00, $00, $00, $00, $01, $01, $01, $01, $01, $01, $02, $02, $02, $02, $02, $02
        .byte $03, $03, $03, $03, $03, $03, $03, $04, $04, $04, $04, $04, $04, $05, $05, $05
        .byte $05, $05, $05, $06, $06, $06, $06, $06, $06, $06, $07, $07, $07, $07, $07, $07
        .byte $08, $08, $08, $08, $08, $08, $08, $09, $09, $09, $09, $09, $09, $0a, $0a, $0a
        .byte $0a, $0a, $0a, $0a, $0b, $0b, $0b, $0b, $0b, $0b, $0b, $0c, $0c, $0c, $0c, $0c
        .byte $0c, $0c, $0d, $0d, $0d, $0d, $0d, $0d, $0d, $0e, $0e, $0e, $0e, $0e, $0e, $0e
        .byte $0f, $0f, $0f, $0f, $0f, $0f, $0f, $10, $10, $10, $10, $10, $10, $10, $11, $11
        .byte $11, $11, $11, $11, $11, $11, $12, $12, $12, $12, $12, $12, $12, $13, $13, $13
        .byte $13, $13, $13, $13, $13, $14, $14, $14, $14, $14, $14, $14, $14, $15, $15, $15
        .byte $15, $15, $15, $15, $15, $15, $16, $16, $16, $16, $16, $16, $16, $16, $17, $17
        .byte $17, $17, $17, $17, $17, $17, $17, $18, $18, $18, $18, $18, $18, $18, $18, $18
        .byte $19, $19, $19, $19, $19, $19, $19, $19, $19, $19, $1a, $1a, $1a, $1a, $1a, $1a
        .byte $1a, $1a, $1a, $1b, $1b, $1b, $1b, $1b, $1b, $1b, $1b, $1b, $1b, $1c, $1c, $1c
        .byte $1c, $1c, $1c, $1c, $1c, $1c, $1c, $1c, $1d, $1d, $1d, $1d, $1d, $1d, $1d, $1d
        .byte $1d, $1d, $1d, $1e, $1e, $1e, $1e, $1e, $1e, $1e, $1e, $1e, $1e, $1e, $1f, $1f
        .byte $1f, $1f, $1f, $1f, $1f, $1f, $1f, $1f, $1f, $1f, $20, $20, $20, $20, $20, $20
```

## Build

```bash
java -jar $KICKASS_JAR sqrt-atan2.asm -o sqrt-atan2.prg
```

The table and the case bytes at the end of the listing were printed by
this script (Python 3, standard library). It also holds the integer model
of each routine and measures the model against `math.isqrt` and
`math.atan2` over every input; that measurement is what fixes the
tolerances and picks the three worst atan2 pairs for the case list.

```text
#!/usr/bin/env python3
# gen.py -- builds the atan table, models both routines exactly in integers,
# measures their error against math.isqrt / math.atan2 over every input, and
# prints the KickAssembler .byte lines for the table and the check cases.
import math

# ---- atan table: 256 entries, index r = floor(min * 256 / max), 0..255 ----
# value = round(atan(r / 256) * 256 / (2 pi)), 0..32
atan_tab = [round(math.atan(r / 256) * 256 / (2 * math.pi)) for r in range(256)]
assert max(atan_tab) <= 32 and min(atan_tab) == 0

# ---- integer model of the machine routine ----
def atan2_model(dx, dy):
    ax, ay = abs(dx), abs(dy)
    if ax == 0 and ay == 0:
        return 0
    if ay == ax:
        a = 32
    elif ay < ax:
        a = atan_tab[(ay << 8) // ax]
    else:
        a = 64 - atan_tab[(ax << 8) // ay]
    if dx < 0:
        a = 128 - a
    if dy < 0:
        a = (256 - a) & 255
    return a & 255

def atan2_exact(dx, dy):
    return round(math.atan2(dy, dx) * 256 / (2 * math.pi)) % 256

def isqrt_model(n):
    root = rem = 0
    for i in range(8):
        rem = (rem << 2) | ((n >> 14) & 3)
        n = (n << 2) & 0xFFFF
        trial = (root << 2) | 1
        root <<= 1
        if rem >= trial:
            rem -= trial
            root |= 1
    return root

# ---- exhaustive error sweep ----
worst = 0
worst_pairs = []
for dx in range(-128, 128):
    for dy in range(-128, 128):
        e = (atan2_model(dx, dy) - atan2_exact(dx, dy)) % 256
        if e > 128:
            e = 256 - e
        if e > worst:
            worst, worst_pairs = e, [(dx, dy)]
        elif e == worst:
            worst_pairs.append((dx, dy))
print(f"atan2 max error over 65536 pairs: {worst}; {len(worst_pairs)} pairs at the max")
print("first worst pairs:", worst_pairs[:8])

sq_bad = [n for n in range(65536) if isqrt_model(n) != math.isqrt(n)]
print(f"isqrt model mismatches vs math.isqrt over 65536: {len(sq_bad)}")

# ---- check cases ----
sqrt_cases = [0, 1, 2, 3, 4, 8, 9, 15, 16, 17, 24, 25, 63, 64, 65, 99, 100,
              121, 144, 255, 256, 257, 1000, 1024, 4095, 4096, 10000, 16384,
              32767, 32768, 65024, 65025, 65026, 65534, 65535]
atan_cases = [(1, 0), (0, 1), (-1, 0), (0, -1), (127, 0), (0, 127), (-128, 0), (0, -128),
              (10, 3), (3, 10), (-3, 10), (-10, 3), (-10, -3), (-3, -10), (3, -10), (10, -3),
              (5, 5), (-5, 5), (-5, -5), (5, -5), (127, 127), (-128, -128), (127, -128), (-128, 127),
              (1, 1), (2, 1), (1, 2), (-1, -2), (100, -37), (-64, 20), (45, -90), (-120, -7),
              (0, 0)] + worst_pairs[:3]

def bytes_line(label, vals):
    out = []
    for i in range(0, len(vals), 16):
        out.append("        .byte " + ", ".join(f"${v & 255:02x}" for v in vals[i:i + 16]))
    return f"{label}:\n" + "\n".join(out)

print()
print(f"// {len(sqrt_cases)} isqrt cases, {len(atan_cases)} atan2 cases")
print(bytes_line("sq_in_lo", [n & 255 for n in sqrt_cases]))
print(bytes_line("sq_in_hi", [n >> 8 for n in sqrt_cases]))
print(bytes_line("sq_exp", [math.isqrt(n) for n in sqrt_cases]))
print(bytes_line("at_dx", [dx for dx, dy in atan_cases]))
print(bytes_line("at_dy", [dy for dx, dy in atan_cases]))
print(bytes_line("at_exp", [atan2_exact(dx, dy) for dx, dy in atan_cases]))
print(bytes_line("atan_tab", atan_tab))
print(f".const NSQ = {len(sqrt_cases)}")
print(f".const NAT = {len(atan_cases)}")
# model result on the cases, for the record
print("model atan2 on cases:", [atan2_model(dx, dy) for dx, dy in atan_cases])
print("exact atan2 on cases:", [atan2_exact(dx, dy) for dx, dy in atan_cases])
```

Its output, the part that is a claim: `atan2 max error over 65536 pairs:
1; 3968 pairs at the max` and `isqrt model mismatches vs math.isqrt over
65536: 0`. The model is the same integer arithmetic as the listing; the
program is what shows the listing agrees with the model.

## Expected output

Border green, text area black (the program clears the screen and never
returns to BASIC), decoded from the PNG with the character ROM:

```
ISQRT16 AND ATAN2 8-BIT CHECK

SQRT  CASES 035  MAX ERR 000  FAIL 000
ATAN2 CASES 036  MAX ERR 001  FAIL 000

WORST BODY CYCLES OVER EVERY INPUT:
  ISQRT16           00869   N=65025
  ATAN2             00381    $81 $80
  REM<=2*ROOT FAILS OF 65536  00000
SQRT(65535)     =   255
ATAN2(10,3)     =   012

RESULT: PASS
```

Screenshots from the pinned run, 120,000,000 cycles:
`screenshots/sqrt-atan2.png` (PAL) and `screenshots/sqrt-atan2-ntsc.png`
(NTSC). Both decode to the text above; border pixel (2, 100) is
(98, 213, 50) on PAL and (114, 189, 103) on NTSC, palette index 5 in
`runtime/vice-reference.md`. The pinned command was run twice per model
and the two PNGs were identical bytes each time. The two sweeps are
about 90 million cycles; a limit under 100 million exits before the
report is drawn.

The figures, all measured in VICE x64sc 3.10 and identical on PAL and
NTSC:

- `isqrt16` body: 869 cycles at worst, first reached at n = 65025
  (255 squared), root exact on every case, `rem <= 2 * root` on all
  65,536 inputs.
- `atan2_8` body: 381 cycles at worst, first reached at
  dx = -127, dy = -128; largest error 1 angle unit over the 36 cases,
  which matches the model's 1 over every pair.
- Body means net of the `JSR`, `RTS` and timer stores, which are
  measured once with an empty routine and subtracted.

## Why this works

The square root brings down two bits of `n` per pass into a remainder,
and per pass doubles the root and tries to subtract `4 * root + 1`,
which is `(2 * root + 1)^2 - (2 * root)^2`. If the subtract fits, the new
root bit is 1. After eight passes the root is 8 bits and the remainder is
`n - root^2`, at most `2 * root`. The trial value reaches 509, so the
remainder and the trial are two bytes; the compare tests the high bytes
first and falls through to the low bytes only when they are equal. The
`SBC` at `sq_sub` is reached on two paths and the carry is set on both
(from `BNE` after a `CMP` that did not borrow, or from the low-byte
`CMP`). The worst input is 255 squared rather than 65535: both take
the subtract on every pass, but 65025 goes once more through the
equal-high-byte path of the compare, which is seven cycles longer. An
instruction-table model of the loop (rung 3) gives 862 for 65535, 869
for 65025 and 869 as its maximum over all 65,536 inputs, the figure the
sweep measured.

`atan2_8` takes the absolute values with `BPL` on the input byte itself,
not after a subtract, so -128 becomes 128 and the octant compare is a
plain unsigned `CMP`. When `|dy| < |dx|` the angle is
`atan(|dy| / |dx|)`; when greater, it is 64 minus `atan(|dx| / |dy|)`;
when equal, exactly 32, which is tested for because the ratio 256 does
not fit the table index. The ratio index is `floor(min * 256 / max)`, an
eight-pass divide whose remainder starts as `min` and stays below `max`;
`max` is at most 128, so the doubled remainder never needs a ninth bit
and the loop has no `BCS` guard (`division_8_16bit` explains the guard
the general loop needs). The table entry is `round(atan(i / 256) * 256 /
2pi)`, 0 to 32. Unfolding is two conditional negations: `128 - a` for
`dx < 0`, then `256 - a` for `dy < 0`, each written as `EOR #$FF` plus
an add. The error is at most 1 unit because the table is rounded and
the index truncates a ratio step of 1/256, which moves the angle by
less than 0.2 units.

Timing uses CIA1 timer A force-loaded from `$FFFF` in one-shot mode;
the count read after the stop, subtracted from the same reading for an
empty call, is the body cost. DEN is cleared before the sweeps and the
program waits for two passes of raster line 255 first, because the VIC
reads DEN once per frame on line `$30` and clearing it mid-frame does
not stop that frame's badlines. Both routines are placed in one page by
`.align $100` and an `.assert`: in an earlier layout the square root's
loop branch crossed a page and the same input measured 876, seven
taken branches at one extra cycle each (`pitfalls/cpu.md`,
`branch_page_cross_extra_cycle`).

## What this recipe does not show

No signed `dx` from two positions: the program feeds `dx` and `dy`
directly. A game that forms them with `SEC / SBC` on 8-bit positions
more than 127 apart gets a wrapped sign, and the fold then answers for
the wrong half of the circle (`pitfalls/cpu.md`,
`signed_compare_bmi_overflow`). Clamp the difference or compute it in
16 bits and take the high byte. The routines are not unrolled; an
unrolled root is about a fifth faster by the instruction table and was
not measured here.
