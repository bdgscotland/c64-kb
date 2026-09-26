---
recipe: aimed-shot-octant
toolchain: kickassembler
output_format: PRG
region: both
techniques: [aimed_shot_octant]
file_formats: [PRG]
uses_registers: [DC04, DC05, DC0D, DC0E, D011, D012, D020, D021]
uses_kernal: []
claims: [cia1_timer_b (init), cia1_tod (init), vic_raster_irq (init), zero_page $02-$17 (owns)]
harness: [cia1_timer_a, $02FF]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Aim in 16 or 8 directions from (dx, dy), checked on every pair

## Synopsis

Two routines for an enemy that shoots at the player: `aim16` turns a
signed 8-bit offset `(dx, dy)` into one of sixteen facings, `aim8` into
one of eight. Neither divides or reads an angle table. Each folds the
offset into one octant and then splits it with one or two compares on the
smaller and larger magnitude. The facing is the one `facing_turn_step`
uses (0 up, 4 right, 8 down, 12 left, 22.5 degrees a step), so it indexes
the 16-entry velocity table the listing also builds. The program checks
24 cases per routine against the Python model below. It then runs all
65,536 pairs through each routine for a checksum the model predicts and
for the worst cycle count (CIA1 timer A), and draws `aim16` for a grid of
offsets. `$02FF` = `$01` and a green border mean both routines matched
the model everywhere; `$02` and red mean they did not. The technique is
`aimed_shot_octant` in `techniques/maths.md`.

## Source

```asm
// aimed-shot-octant.asm: aim at a target in 16 or 8 directions from a
// signed offset (dx, dy), with no divide and no angle table, and a
// 16-entry velocity table indexed by the result.
// aim16: facing 0-15 (0 up, 4 right, 8 down, 12 left, 22.5 degrees a step),
//        sectors split at tan 11.3 and tan 33.7 degrees: min * 5 < max,
//        min * 3 < max * 2.
// aim8:  facing 0, 2, ... 14 (the even facings), split at tan 21.8 degrees:
//        min * 5 < max * 2.
// The program checks 24 cases per routine against a Python model (quoted on
// the page), runs every one of the 65,536 (dx, dy) pairs through each routine
// for a checksum and the worst body cost (CIA1 timer A, display off), and
// draws aim16 for a 40 x 21 grid of offsets around the centre cell.
// Verdict: $02FF = $01 and a green border when both routines match the model
// on every case and on the checksum, $02 and red otherwise.
// Build: java -jar KickAss.jar aimed-shot-octant.asm -o aimed-shot-octant.prg
.encoding "screencode_upper"

.const SCREEN = $0400
.const COLRAM = $d800
.const RESULT = $02ff
.const SUM16  = $9d90           // the model's checksums over all 65,536 pairs:
.const SUM16B = $9218           // s1 += facing, s2 += s1, 16 bits each, dx outer
.const SUM8   = $3660
.const SUM8B  = $9ba8
.const NCASE  = 24              // model cases per routine
.const SPEED  = 20              // shot speed in the velocity table, sub-pixel units

// zero page; the program never returns to BASIC
.const dx      = $02            // inputs, signed
.const dy      = $03
.const ax      = $04            // |dx|, |dy|
.const ay      = $05
.const mn      = $06            // smaller and larger magnitude
.const mx      = $07
.const cyc     = $08            // last measured body cycles (2)
.const s1      = $0a            // checksum (2)
.const s2      = $0c            // checksum (2)
.const worst   = $0e            // worst body cycles (2)
.const fails   = $10
.const zp_row  = $11            // screen pointer (2)
.const zp_col  = $13            // colour pointer (2)
.const idx     = $15
.const tmp     = $16
.const col     = $17

BasicUpstart2(start)

start:
        sei
        lda #$7f
        sta $dc0d               // no CIA1 interrupts
        lda $dc0d
        lda #0
        sta $d020
        sta $d021
        sta fails
        jsr clear_screen
        lda $d011
        and #%11101111          // display off: no badline steals a timed cycle
        sta $d011
        jsr wait_line255
        jsr wait_line255
        jsr time_empty

        // ---------- the model's cases ----------
        ldx #0
case_loop:
        stx idx
        lda case_dx,x
        sta dx
        lda case_dy,x
        sta dy
        jsr aim16
        ldx idx
        cmp exp16,x
        beq !+
        inc fails
!:      jsr aim8
        ldx idx
        cmp exp8,x
        beq !+
        inc fails
!:      inx
        cpx #NCASE
        bne case_loop

        // ---------- every pair: checksum and worst cycles ----------
        lda #<aim16
        ldx #>aim16
        jsr sweep
        lda s1
        cmp #<SUM16
        bne sum_bad16
        lda s1+1
        cmp #>SUM16
        bne sum_bad16
        lda s2
        cmp #<SUM16B
        bne sum_bad16
        lda s2+1
        cmp #>SUM16B
        beq !+
sum_bad16:
        inc fails
!:      ldx #21
        jsr report

        lda #<aim8
        ldx #>aim8
        jsr sweep
        lda s1
        cmp #<SUM8
        bne sum_bad8
        lda s1+1
        cmp #>SUM8
        bne sum_bad8
        lda s2
        cmp #<SUM8B
        bne sum_bad8
        lda s2+1
        cmp #>SUM8B
        beq !+
sum_bad8:
        inc fails
!:      ldx #22
        jsr report
        lda #$01                // "A" and "8" labels in column 0-4
        ldx #21
        jsr label_row

        jsr draw_map

        lda $d011
        ora #%00010000          // display back on for the picture
        sta $d011
        lda fails
        bne fail
        lda #1
        sta RESULT
        lda #5
        sta $d020
        ldx #<txt_pass
        ldy #>txt_pass
        jmp verdict
fail:
        lda #2
        sta RESULT
        sta $d020
        ldx #<txt_fail
        ldy #>txt_fail
verdict:
        stx zp_col
        sty zp_col+1
        ldy #0
!:      lda (zp_col),y
        beq forever
        sta SCREEN+24*40,y
        iny
        bne !-
forever:
        jmp forever

// ============================================================
// Fold: X = 4 if dx < 0, + 2 if dy < 0, + 1 if |dy| >= |dx|;
// mn = the smaller magnitude, mx = the larger (0-128 unsigned).
// ============================================================
.macro FOLD() {
        ldx #0
        lda dx
        bpl !+
        eor #$ff
        clc
        adc #1                  // -128 gives $80: 128 unsigned
        ldx #4
!:      sta ax
        lda dy
        bpl !+
        eor #$ff
        clc
        adc #1
        inx
        inx
!:      sta ay
        cmp ax
        bcs !ymaj+
        sta mn                  // |dy| < |dx|: x is the major axis
        lda ax
        sta mx
        bcc !done+              // carry still clear from the compare
!ymaj:  inx
        sta mx
        lda ax
        sta mn
!done:
}

// aim16: A = facing 0-15 toward (dx, dy). (0, 0) gives 6.
.align $100
aim16:
        FOLD()
        lda mn
        cmp #26                 // mn * 5 < mx <= 128 needs mn < 26
        bcs a16_mid
        asl
        asl                     // no carry out: mn < 26
        adc mn                  // mn * 5
        cmp mx
        bcs a16_mid
        lda tab16_axis,x        // within 11.3 degrees of the major axis
        rts
a16_mid:
        lda mn
        lsr
        clc
        adc mn                  // mn + mn / 2 < mx  <=>  mn * 3 < mx * 2
        cmp mx
        bcs a16_diag
        lda tab16_mid,x         // 11.3 to 33.7 degrees
        rts
a16_diag:
        lda tab16_diag,x        // 33.7 to 45 degrees
        rts

// aim8: A = facing 0, 2, ... 14 toward (dx, dy). (0, 0) gives 6.
aim8:
        FOLD()
        lda mn
        cmp #52                 // mn * 2.5 < mx <= 128 needs mn < 52
        bcs a8_diag
        lsr
        sta tmp
        lda mn
        asl                     // no carry out: mn < 52
        adc tmp                 // mn * 2 + mn / 2 < mx  <=>  mn * 5 < mx * 2
        cmp mx
        bcs a8_diag
        lda tab8_axis,x
        rts
a8_diag:
        lda tab8_diag,x
        rts
aim_end:
.assert "aim16 and aim8 share one page", >aim16, >aim_end

// index X: bit 2 dx < 0, bit 1 dy < 0, bit 0 |dy| >= |dx|
tab16_axis: .byte 4, 8, 4, 0, 12, 8, 12, 0
tab16_mid:  .byte 5, 7, 3, 1, 11, 9, 13, 15
tab16_diag: .byte 6, 6, 2, 2, 10, 10, 14, 14
tab8_axis:  .byte 4, 8, 4, 0, 12, 8, 12, 0
tab8_diag:  .byte 6, 6, 2, 2, 10, 10, 14, 14

// the velocity table: round(SPEED * sin a), -round(SPEED * cos a), a = facing * 22.5
vel_x: .fill 16, round(SPEED * sin(toRadians(i * 22.5)))
vel_y: .fill 16, -round(SPEED * cos(toRadians(i * 22.5)))

// ============================================================
// sweep: A/X = routine. Every (dx, dy), dx outer, dy inner, from 0 up
// through 255 as bytes. s1 += result, s2 += s1; worst = most body cycles.
// ============================================================
sweep:
        sta call+1
        stx call+2
        lda #0
        sta s1
        sta s1+1
        sta s2
        sta s2+1
        sta worst
        sta worst+1
        sta dx
sw_x:   lda #0
        sta dy
sw_y:   lda #$ff
        sta $dc04
        sta $dc05
        lda #%00011001          // force load, one-shot, start
        sta $dc0e
call:   jsr $ffff               // patched with the routine
        ldy #0
        sty $dc0e               // stop
        clc
        adc s1
        sta s1
        bcc !+
        inc s1+1
!:      lda s1
        clc
        adc s2
        sta s2
        lda s1+1
        adc s2+1
        sta s2+1
        lda empty_lo            // body = empty call's reading - this reading
        sec
        sbc $dc04
        sta cyc
        lda empty_hi
        sbc $dc05
        sta cyc+1
        cmp worst+1
        bcc sw_next
        bne !+
        lda cyc
        cmp worst
        bcc sw_next
!:      lda cyc
        sta worst
        lda cyc+1
        sta worst+1
sw_next:
        inc dy
        bne sw_y
        inc dx
        bne sw_x
        rts

time_empty:
        lda #$ff
        sta $dc04
        sta $dc05
        lda #%00011001
        sta $dc0e
        jsr empty_rts
        ldy #0
        sty $dc0e
        lda $dc04
        sta empty_lo
        lda $dc05
        sta empty_hi
empty_rts:
        rts

// wait_line255: returns just after raster line 255 has passed
wait_line255:
        lda #$ff
!:      cmp $d012
        bne !-
!:      cmp $d012
        beq !-
        rts

// ============================================================
// draw_map: rows 0-20, columns 0-39: aim16 of dx = (column - 20) * 6,
// dy = (row - 10) * 6 as a hex digit. White on an axis facing, green on a
// diagonal, yellow in between; the centre cell is a red "+".
// ============================================================
draw_map:
        lda #<SCREEN
        sta zp_row
        sta zp_col
        lda #>SCREEN
        sta zp_row+1
        lda #>COLRAM
        sta zp_col+1
        lda #-60
        sta dy
dm_row: lda #-120
        sta dx
        lda #0
        sta col
dm_col: jsr aim16
        tax
        lda hexd,x
        ldy col
        sta (zp_row),y
        txa
        and #3
        tax
        lda shade,x
        sta (zp_col),y
        lda dx
        ora dy
        bne !+
        lda #$2b                // "+" at (0, 0)
        sta (zp_row),y
        lda #2
        sta (zp_col),y
!:      lda dx
        clc
        adc #6
        sta dx
        inc col
        lda col
        cmp #40
        bne dm_col
        lda zp_row
        clc
        adc #40
        sta zp_row
        sta zp_col
        bcc !+
        inc zp_row+1
        inc zp_col+1
!:      lda dy
        clc
        adc #6
        sta dy
        cmp #66
        bne dm_row
        rts

// report: X = row. "S1 hhhh S2 hhhh CYC $hhhh" from column 6, all hex.
report:
        lda row_lo,x
        sta zp_row
        lda row_hi,x
        sta zp_row+1
        ldy #6
        ldx #0
!:      lda txt_rep,x
        sta (zp_row),y
        iny
        inx
        cpx #txt_rep_end - txt_rep
        bne !-
        ldy #9
        lda s1+1
        jsr put_hex
        lda s1
        jsr put_hex
        ldy #17
        lda s2+1
        jsr put_hex
        lda s2
        jsr put_hex
        ldy #27
        lda worst+1
        jsr put_hex
        lda worst
        jmp put_hex

// label_row: rows 21 and 22, columns 0-4: "AIM16" and "AIM8"
label_row:
        ldx #4
!:      lda txt_l16,x
        sta SCREEN+21*40,x
        lda txt_l8,x
        sta SCREEN+22*40,x
        dex
        bpl !-
        rts

// put_hex: A as two digits at (zp_row),Y; Y advances by 2
put_hex:
        pha
        lsr
        lsr
        lsr
        lsr
        tax
        lda hexd,x
        sta (zp_row),y
        iny
        pla
        and #15
        tax
        lda hexd,x
        sta (zp_row),y
        iny
        rts

clear_screen:
        ldx #0
!:      lda #$20
        sta SCREEN,x
        sta SCREEN+$100,x
        sta SCREEN+$200,x
        sta SCREEN+$300,x
        lda #1
        sta COLRAM,x
        sta COLRAM+$100,x
        sta COLRAM+$200,x
        sta COLRAM+$300,x
        inx
        bne !-
        rts

hexd:    .text "0123456789ABCDEF"
shade:   .byte 1, 7, 13, 7      // facing & 3: axis white, diagonal green, between yellow
row_lo:  .fill 25, <(SCREEN + 40 * i)
row_hi:  .fill 25, >(SCREEN + 40 * i)
txt_rep: .text "S1 .... S2 .... CYC $...."
txt_rep_end:
txt_l16: .text "AIM16"
txt_l8:  .text "AIM8 "
txt_pass: .text "RESULT: PASS"
          .byte 0
txt_fail: .text "RESULT: FAIL"
          .byte 0
empty_lo: .byte 0
empty_hi: .byte 0

// generated by the page's model (Python below): expected aim16 and aim8
case_dx: .byte 0, 40, 0, -40, 30, 30, -30, -30, 6, 5, 3, 2, 1, 1, -100, -100, -100, 5, 5, 127, -128, -128, -1, 0
case_dy: .byte -40, 0, 40, 0, -30, 30, 30, -30, 1, 1, 2, 3, 5, 6, -45, -66, -67, -2, -3, -128, -128, 127, 0, 0
exp16:   .byte 0, 4, 8, 12, 2, 6, 10, 14, 4, 5, 6, 6, 7, 8, 13, 13, 14, 3, 3, 2, 14, 10, 12, 6
exp8:    .byte 0, 4, 8, 12, 2, 6, 10, 14, 4, 4, 6, 6, 8, 8, 14, 14, 14, 2, 2, 2, 14, 10, 12, 6
```

The expected values and checksums come from this model of the two
routines. It also counts where they differ from the nearest of 16 or 8
true directions:

```python
import math
def s8(v): return v-256 if v>127 else v
def fold(dx,dy):
    ax,ay=abs(dx),abs(dy)
    code=(4 if dx<0 else 0)|(2 if dy<0 else 0)
    if ay>=ax: code|=1; mn,mx=ax,ay
    else: mn,mx=ay,ax
    return code,mn,mx
def major(code):
    if code&1: return 0 if code&2 else 8
    return 12 if code&4 else 4
def diag(code):
    l,u=code&4,code&2
    return {(0,2):2,(0,0):6,(4,0):10,(4,2):14}[(l,u)]
def mid(code):
    m,d=major(code),diag(code)
    return (m+1)&15 if ((d-m)&15)==2 else (m-1)&15
TAB16=[None]*24
for c in range(8):
    TAB16[c*3+0]=major(c); TAB16[c*3+1]=mid(c); TAB16[c*3+2]=diag(c)
TAB8=[None]*16
for c in range(8):
    TAB8[c*2]=major(c); TAB8[c*2+1]=diag(c)
def aim16(dx,dy):
    c,mn,mx=fold(dx,dy)
    z=0 if mn*5<mx else (1 if mn*3<mx*2 else 2)
    return TAB16[c*3+z]
def aim8(dx,dy):
    c,mn,mx=fold(dx,dy)
    z=0 if mn*5<mx*2 else 1
    return TAB8[c*2+z]
def true_dir(dx,dy,n):
    # facing: 0 up, clockwise; angle from up clockwise = atan2(dx, -dy)
    a=math.degrees(math.atan2(dx,-dy))%360
    step=360/n
    return a, round(a/step)%n
def angerr(a,f,unit):
    d=abs((a-f*unit+180)%360-180); return d
if __name__=='__main__':
    for name,fn,n,scale in (('aim16',aim16,16,1),('aim8',aim8,8,2)):
        s1=s2=0; wrong=0; worst=0
        for x in range(256):
            for y in range(256):
                dx,dy=s8(x),s8(y)
                r=fn(dx,dy)
                s1=(s1+r)&0xffff; s2=(s2+s1)&0xffff
                if dx==0 and dy==0: continue
                a,t=true_dir(dx,dy,n)
                if r!=t*scale: wrong+=1
                worst=max(worst,angerr(a,r,22.5))
        print(name,'checksum s1=%04x s2=%04x'%(s1,s2),'differ from nearest',wrong,'worst err %.2f deg'%worst)
    print('aim16(0,0)=',aim16(0,0),'aim8(0,0)=',aim8(0,0))
    print('TAB16',TAB16); print('TAB8',TAB8)
    for S in (20,6,8,16):
        print(S,'vx',[round(S*math.sin(math.radians(i*22.5))) for i in range(16)])
        print(S,'vy',[-round(S*math.cos(math.radians(i*22.5))) for i in range(16)])
```

## Build

```bash
java -jar "$KICKASS_JAR" aimed-shot-octant.asm -o aimed-shot-octant.prg
```

## Expected output

`screenshots/aimed-shot-octant.png` (PAL) and
`screenshots/aimed-shot-octant-ntsc.png` (NTSC), pinned at 40,000,000
cycles in `recipes/runs.json`; the sweeps finish between 20,000,000 and
30,000,000. Verified in VICE x64sc 3.10 (PAL c64c: 8565/8580/8521, and
ntsc: 6567R8). Measured with PIL: each cell was matched against the
character ROM and its colour read. Both models give the same text.

Rows 21 to 24:

```text
AIM16 S1 9D90 S2 9218 CYC $005D
AIM8  S1 3660 S2 9BA8 CYC $0053

RESULT: PASS
```

Both checksums equal the model's, and all 48 cases passed, so the border
is green. The worst body cost over all 65,536 pairs, `JSR` and `RTS`
excluded, is 93 cycles for `aim16` (`$5D`) and 83 for `aim8` (`$53`).

Rows 0 to 20 are `aim16` of `dx = (column − 20) × 6`,
`dy = (row − 10) × 6`, as a hex digit. All 840 cells matched the model on
both models:

```text
DDDDDEEEEEEEEEFFFFF000111112222222223333
DDDDDDDEEEEEEEEFFFF000111122222222333333
DDDDDDDDEEEEEEEFFFF000111122222223333333
DDDDDDDDDDEEEEEEFFF000111222222333333333
DDDDDDDDDDDEEEEEEFF000112222223333333333
DDDDDDDDDDDDDEEEEFFF01112222333333333333
DDDDDDDDDDDDDDEEEEFF01122223333333333333
CCCCCDDDDDDDDDDDEEEF01222333333333334444
CCCCCCCCCCDDDDDDDEEF01223333333444444444
CCCCCCCCCCCCCCCDDDDE02333344444444444444
CCCCCCCCCCCCCCCCCCCC+4444444444444444444
CCCCCCCCCCCCCCCBBBBA86555544444444444444
CCCCCCCCCCBBBBBBBAA987665555555444444444
CCCCCBBBBBBBBBBBAAA987666555555555554444
BBBBBBBBBBBBBBAAAA9987766665555555555555
BBBBBBBBBBBBBAAAA99987776666555555555555
BBBBBBBBBBBAAAAAA99888776666665555555555
BBBBBBBBBBAAAAAA999888777666666555555555
BBBBBBBBAAAAAAA9999888777766666665555555
BBBBBBBAAAAAAAA9999888777766666666555555
BBBBBAAAAAAAAA99999888777776666666665555
```

Axis facings (0, 4, 8, 12) are white, diagonals (2, 6, 10, 14) light
green, the in-between facings yellow. The red `+` is the shooter at
`(0, 0)`. The columns run from `dx = −120` to `+114`, so the picture is
not symmetric left to right. PAL gives RGB (255, 255, 70) for yellow and
(183, 255, 134) for light green, NTSC (255, 248, 141) and (198, 255, 186)
(the palettes in `runtime/vice-reference.md`).

The model says `aim16` differs from the nearest of the 16 true directions
on 336 of the 65,535 non-zero pairs, and its worst error is 11.31
degrees, against 11.25 for a perfect split. `aim8` differs from the
nearest of 8 on 1,032 pairs, and its worst error is 23.20 degrees,
against 22.5. These are the pairs in the slivers between the true
boundaries (11.25, 33.75 and 22.5 degrees) and the compares' boundaries
(11.31, 33.69 and 21.80). The count is from the model (rung 3); the
checksum shows the machine code computes the model's answer on every
pair (rung 1).

The velocity table assembles to these bytes, read from the PRG at the
`vel_x` and `vel_y` symbols (`SPEED` = 20):

| Facing | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `vel_x` | 0 | 8 | 14 | 18 | 20 | 18 | 14 | 8 | 0 | −8 | −14 | −18 | −20 | −18 | −14 | −8 |
| `vel_y` | −20 | −18 | −14 | −8 | 0 | 8 | 14 | 18 | 20 | 18 | 14 | 8 | 0 | −8 | −14 | −18 |

## Why this works

The fold uses the symmetry that `atan2_8bit` uses. The signs of `dx` and
`dy` and which magnitude is larger pick one of eight octants. Inside an
octant the direction depends only on `min / max`, between 0 and 1. A
facing boundary is a fixed ratio: tan 11.25 = 0.199 and tan 33.75 = 0.668
for sixteen directions, tan 22.5 = 0.414 for eight. So each boundary is
one compare of `min × k` against `max`. The listing uses 1/5, 2/3 and
2/5.

All the compares fit a byte. `min × 3 < max × 2` equals
`min + floor(min / 2) < max` for integers: for an odd `min`, `3 × min` is
`2 × (min + floor(min / 2)) + 1`, and the `+ 1` cannot carry the
comparison past an even `2 × max`. `min × 5 < max × 2` equals
`2 × min + floor(min / 2) < max` in the same way. `max` is at most 128,
so a `min` of 26 or more cannot pass `min × 5 < max`, and a `min` of 52 or
more cannot pass `min × 5 < max × 2`. The listing tests those first, and
the products that remain stay below 256.

The octant code (bit 2 `dx < 0`, bit 1 `dy < 0`, bit 0 `|dy| ≥ |dx|`)
indexes one 8-byte table per zone: major axis, in between, diagonal. A tie
`|dx| = |dy|` sets bit 0 and fails both compares, so it lands on the
diagonal. `(0, 0)` does the same and returns 6; a caller should not fire
from on top of its target.
