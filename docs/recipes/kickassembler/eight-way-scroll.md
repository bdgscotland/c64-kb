---
recipe: eight-way-scroll
toolchain: kickassembler
output_format: PRG
region: both
techniques: [eight_way_scroll_double_buffer, screen_double_buffer_d018, soft_scroll_h, soft_scroll_v, tile_map_render, irq_chain_table]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, DC06, DC07, DC0D, DC0F, DD0D]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Eight-way tile scroll with a double-buffered screen matrix

## Synopsis

Scrolls a 64 x 48 tile world through a 40 x 25 window in all eight
directions, one pixel every two fields, and measures what each field costs.
Sub-tile motion is the fine scroll in `$D016` and `$D011`. Whole-tile motion
is a redraw of the entire matrix into the screen page that is not on display,
followed by a `$D018` flip in the vertical blank, so no partly drawn matrix
is ever visible. The redraw is spread over at most four fields per crossing.

Colour RAM is not paged. Both halves are written in `irqColB` at raster 4
in four calls after each flip: two for the top half (rows 0 to 11) and two
for the bottom (rows 12 to 24). The first top call uses `BAND_FIRST = 5`
rows so the colour write finishes before row 6's badline even when
`irqColB` starts as late as raster 33 on NTSC. The remaining calls use
`BAND_MAX = 7`. During the four write fields, rows not yet updated show the
previous origin's colour: three displayed fields per tile crossing, about
one in four, measured at 60 ms PAL and 50 ms NTSC.

A camera path table walks the eight directions in turn, thirty-two fields
each. CIA 1 timer B measures every field. Row 1 of the screen shows the
camera position, the leg index, waited flips, the worst field in cycles,
late applies, skipped preps and first-band deadline violations. `$02FF` is
`$01` and the border green when the marker tile is where the camera says it
should be, no flip waited, no late apply occurred, no prep was skipped, no
first-band call missed the row-6 badline, and the worst field is under the
stated budget; `$02` and red otherwise. PAL and NTSC.

## Source

```asm
// Eight-way tile scroll over a double-buffered screen matrix.
//
// A 64 x 48 tile world is viewed through a 40 x 25 window. The camera
// moves one pixel every two fields along a fixed eight-leg path. Sub-tile
// motion is the fine scroll in $D016 and $D011; whole-tile motion is a
// redraw of the whole matrix into the page that is not on screen,
// followed by a $D018 flip in the vertical blank.
//
// Colour RAM is not paged. Both halves are written in irqColB at raster 4.
// The top half (rows 0..SPLIT-1) is written in two calls after the flip: the
// first uses BAND_FIRST rows, which fits safely even when irqColB starts as
// late as raster 33 on NTSC; the second uses BAND_MAX. The bottom half
// (rows SPLIT..24) follows in two more calls at BAND_MAX rows each. Four
// colour calls span the same four fields as the four matrix-redraw preps.

.const WORLD    = $2000        // 64 x 48 tile codes
.const WCOL     = $2c00        // 64 x 48 colour nybbles
.const WORLD_W  = 64
.const WORLD_H  = 48
.const SCR0     = $0400
.const SCR1     = $0800
.const MAX_COL  = WORLD_W - 40 // 24
.const MAX_ROW  = WORLD_H - 25 // 23
.const MARK_X   = 30           // marker tile, world coordinates
.const MARK_Y   = 24
.const MARK_CH  = $2a          // '*'
.const SPLIT    = 12           // first row of the bottom half
.const RAS_COLB = 4            // bottom colour half: beam above row 12
.const RAS_PREP = 152          // decide and top colour half: beam below row 12
.const RAS_APPLY = 251         // registers: vertical blank
.const CHECK_AT = 320          // frame at which the verdict is published
.const BAND_MAX = 7            // matrix rows drawn per prep field (any kind)
.const BAND_FIRST = 5          // top-half colour rows on the first call after a flip
.const BUDGET   = 18000        // worst-field cycle budget

// --- zero page -------------------------------------------------------
.const camx    = $20           // camera in world pixels
.const camy    = $21
.const ztmp2   = $22
.const visCol  = $24           // tile origin of the matrix on screen
.const visRow  = $25
.const offCol  = $26           // tile origin the spare matrix holds
.const offRow  = $27
.const pgVis   = $28           // 0 = $0400 on screen, 1 = $0800
.const rdState = $29           // 1 while the spare matrix is being redrawn
.const offOK   = $2a
.const sgnx    = $2b
.const sgny    = $2c
.const legIdx  = $2d
.const legCnt  = $2e
.const zrow    = $2f
.const zend    = $30
.const zv      = $31           // word
.const ztmp    = $33
.const t1      = $34
.const t2      = $35
.const wptr    = $36           // word
.const wx      = $38
.const wy      = $39
.const wantCol = $3a
.const wantRow = $3b
.const tgtCol  = $3c
.const tgtRow  = $3d
.const stalls  = $3e           // flips wanted while the spare page was unready
.const framesX = $3f           // frames until the next column crossing
.const framesY = $40
.const deadlin = $41
.const dcol    = $42
.const drow    = $43
.const colCol  = $44           // origin the colour halves are being written for
.const colRow  = $45
.const colPend = $46
.const pendVM  = $47           // register values waiting for the blank
.const pendD16 = $48
.const pendD11 = $49
.const frameL  = $4a
.const frameH  = $4b
.const markBad = $4c
.const tNow    = $4d           // word
.const tEnt    = $4f           // word
.const frameAc = $51           // word
.const worst   = $53           // word
.const colTop  = $55           // word, raster at which the top half finished
.const colBot  = $57           // word
.const cbSrcHi = $59
.const cbDstHi = $5a
.const cbCol   = $5b
.const cbRow   = $5c
.const pnI     = $5d
.const pnD     = $5e
.const pnTL    = $5f
.const srcp    = $60           // word
.const cptr    = $62           // word
.const done    = $64
.const fullCnt = $65
.const rdNext  = $66           // next view row the spare matrix still needs
.const colWork = $67           // this field has already rewritten a colour half
.const statIdx = $68
.const rowsF   = $69
.const wDbg    = $6a
.const lateCol   = $6b         // colour halves that missed the beam
.const prepRas   = $6c
.const lateApply  = $6d        // apply entries that fired with raster < RAS_APPLY
.const skipPrep   = $6e        // colB entries with no preceding prep
.const prepFired  = $6f        // set in irqPrep, checked and cleared in irqColB
.const stepParity = $70        // toggles each field; pathStep runs when 0
.const colTopCur  = $71        // cursor into top colour half (0..SPLIT; SPLIT=done)
.const colBotCur  = $72        // cursor into bottom colour half (SPLIT..25; 25=done)
.const b1Dead     = $73        // first top-half calls that missed the row-6 badline

.pc = $0801 "BASIC"
:BasicUpstart2(main)

// The program sits at $1000. In VIC bank 0 the chip sees the character
// generator ROM at $1000-$1FFF, so that RAM is invisible to it and free
// for code. $0800 is the second screen matrix and must stay clear.
.pc = $1000 "Main"

main:
        sei
        lda #$35                // RAM under BASIC and KERNAL, I/O visible
        sta $01

        lda #$7f                // silence both CIAs
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda $dd0d

        jsr genWorld
        jsr clearScreens
        jsr initStatus

        lda #$00
        sta $d020
        sta $d021

        // Camera start. The sub-tile phase is a design choice, not an
        // arbitrary one: with camx and camy both congruent to 2 mod 8
        // the gap between successive tile crossings never falls below
        // three frames, which is what lets the redraw be split in two.
        lda #66
        sta camx
        sta camy
        lda #8
        sta visCol
        sta visRow
        sta offCol
        sta offRow
        lda #0
        sta pgVis
        sta rdState
        sta offOK
        sta sgnx
        sta sgny
        sta stalls
        sta colPend
        sta frameL
        sta frameH
        sta markBad
        sta frameAc
        sta frameAc+1
        sta worst
        sta worst+1
        sta colTop
        sta colTop+1
        sta colBot
        sta colBot+1
        sta done
        sta fullCnt
        sta rdNext
        sta colWork
        sta statIdx
        sta rowsF
        sta wDbg
        sta lateCol
        sta prepRas
        sta lateApply
        sta skipPrep
        sta b1Dead
        sta stepParity
        lda #1
        sta prepFired               // so the first irqColB does not count as a skip
        lda #SPLIT
        sta colTopCur               // SPLIT = no top-half colour pending
        lda #25
        sta colBotCur               // 25 = no bottom-half colour pending
        lda #7
        sta legIdx              // so the first step loads leg 0
        lda #1
        sta legCnt

        // Draw the opening view straight into the page that is on
        // screen, and its colour with it.
        lda #1
        sta pgVis               // aim drawMatrix at page 0
        lda #0
        sta zrow
        lda #24
        sta zend
        jsr drawMatrix
        lda #0
        sta pgVis
        lda visCol
        sta colCol
        lda visRow
        sta colRow
        lda #0
        sta zrow
        lda #24
        sta zend
        jsr drawColour

        lda #$14                // matrix $0400, charset ROM at $1000
        sta $d018
        sta pendVM
        lda #7
        sta pendD16
        lda #$17
        sta pendD11
        sta $d011
        lda #7
        sta $d016

        lda #$ff                // free-running frame timer
        sta $dc06
        sta $dc07
        lda #$11
        sta $dc0f

        lda #<irqColB
        sta $fffe
        lda #>irqColB
        sta $ffff
        lda #RAS_COLB
        sta $d012
        lda #$01
        sta $d01a
        lda #$ff
        sta $d019
        cli

idle:   jmp idle

// --- bottom colour half, beam above row 13 ---------------------------
irqColB:
        pha
        txa
        pha
        tya
        pha
        cld                     // the D flag is not cleared on IRQ entry
        lda #$ff
        sta $d019
        lda #<irqPrep           // arm the next stage first: this handler
        sta $fffe               // can outlast its own raster line
        lda #>irqPrep
        sta $ffff
        lda $d011               // the split follows YSCROLL: row 12 ends at
        and #7                  // raster 151 + YSCROLL, so the top colour
        clc                     // half may start one line after that
        adc #RAS_PREP
        sta $d012
        sta prepRas

        lda #0                  // a new field: restart the frame timer
        sta frameAc
        sta frameAc+1
        sta colWork
        sta rowsF
        jsr markIn

        // skipPrep: if irqPrep never ran since the last irqColB, count it.
        lda prepFired
        bne cb_prepok
        inc skipPrep
cb_prepok:
        lda #0
        sta prepFired

        // Band-limited colour write: at most BAND_MAX rows per irqColB call.
        // By limiting each call, irqColB always finishes well before irqPrep's
        // raster even when irqColB starts late (due to irqApply overrunning the
        // NTSC blank). Phase 1 writes rows from colTopCur toward SPLIT; phase 2
        // writes rows from colBotCur toward 24.
        lda colPend
        bne cb_has_pend
        jmp cb_none
cb_has_pend:
        cmp #1
        bne cb_bottom
        // Phase 1: top half. BAND_FIRST rows on the first call (colTopCur == 0)
        // so the colour finishes before the row-6 badline even when irqColB
        // starts as late as raster 33 on NTSC. Subsequent calls use BAND_MAX.
        lda colTopCur
        sta zrow
        lda colTopCur
        beq cb_top_first
        clc
        adc #BAND_MAX-1
        jmp cb_top_clamp
cb_top_first:
        lda #BAND_FIRST-1
cb_top_clamp:
        cmp #SPLIT-1
        bcc !+
        lda #SPLIT-1
!:      sta zend
        jsr drawColour
        // First top-half call (zend == BAND_FIRST-1): check it finished before
        // row 6's badline (96 + YSCROLL). If not, count a deadline violation.
        lda zend
        cmp #BAND_FIRST-1
        bne cb_top_nodead
        jsr readRaster
        lda zv+1
        bne cb_top_nodead           // raster above 255: in blank, on time
        lda $d011
        and #7
        clc
        adc #96
        cmp zv                      // 96+YSCROLL >= raster: on time
        bcs cb_top_nodead
        inc b1Dead
cb_top_nodead:
        inc colWork
        lda zend
        cmp #SPLIT-1
        bcc cb_top_more
        lda #SPLIT              // top half complete; start bottom half
        sta colTopCur
        lda #2
        sta colPend
        jmp cb_none
cb_top_more:
        lda zend
        clc
        adc #1
        sta colTopCur           // resume here next call
        jmp cb_none
cb_bottom:
        // Phase 2: bottom half, BAND_MAX rows per call.
        lda colBotCur
        sta zrow
        lda colBotCur
        clc
        adc #BAND_MAX-1
        cmp #24
        bcc !+
        lda #24
!:      sta zend
        jsr drawColour
        jsr readRaster          // timing check: first band must land before row 12
        lda zv
        sta colBot
        lda zv+1
        sta colBot+1
        bne cb_late             // past raster 255 is far too late
        lda $d011
        and #7
        clc
        adc #144                // row 12 starts at raster 144 + YSCROLL
        cmp colBot
        bcs cb_intime
cb_late:
        inc lateCol
cb_intime:
        inc colWork
        lda zend
        cmp #24
        bcc cb_bot_more
        lda #25                 // bottom half complete
        sta colBotCur
        lda #0
        sta colPend
        jmp cb_none
cb_bot_more:
        lda zend
        clc
        adc #1
        sta colBotCur           // resume here next call
cb_none:
        jsr markOut
        jmp irqExit

// --- decide the next field, top colour half --------------------------
irqPrep:
        pha
        txa
        pha
        tya
        pha
        cld                     // the D flag is not cleared on IRQ entry
        lda #$ff
        sta $d019
        lda #<irqApply
        sta $fffe
        lda #>irqApply
        sta $ffff
        lda #RAS_APPLY
        sta $d012
        jsr markIn

        lda #1                  // signal that prep ran (for skipPrep detection)
        sta prepFired

        // Half-speed camera: advance one pixel every two fields so the
        // redraw always completes before the next tile crossing.
        lda stepParity
        eor #1
        sta stepParity
        beq pr_step_skip
        jsr pathStep
pr_step_skip:

        lda camx
        lsr
        lsr
        lsr
        sta wantCol
        lda camy
        lsr
        lsr
        lsr
        sta wantRow

        // Flip only if the wanted origin has moved and the spare page
        // already holds exactly that origin.
        lda wantCol
        cmp visCol
        bne pr_try
        lda wantRow
        cmp visRow
        beq pr_fine
pr_try:
        lda offOK
        beq pr_stall
        lda offCol
        cmp wantCol
        bne pr_stall
        lda offRow
        cmp wantRow
        bne pr_stall

        lda pgVis               // the flip is queued for the blank
        eor #1
        sta pgVis
        tax
        lda d018T,x
        sta pendVM
        lda offCol
        sta visCol
        sta colCol
        lda offRow
        sta visRow
        sta colRow
        lda #0
        sta offOK
        sta colTopCur           // start top-half colour write from row 0
        lda #SPLIT
        sta colBotCur           // bottom-half cursor starts at SPLIT
        lda #1
        sta colPend             // irqColB will write top half (phase 1), then bottom (phase 2)
        jmp pr_fine
pr_stall:
        lda stalls
        cmp #255
        beq pr_fine
        inc stalls

pr_fine:
        // Fine scroll for the origin that will be on screen. Both
        // registers are written whole, never read-modify-write, so CSEL,
        // MCM and the raster high bit cannot be clobbered.
        lda visCol
        asl
        asl
        asl
        sta ztmp
        lda camx
        sec
        sbc ztmp
        jsr clamp07
        sta ztmp
        lda #7
        sec
        sbc ztmp
        sta pendD16

        lda visRow
        asl
        asl
        asl
        sta ztmp
        lda camy
        sec
        sbc ztmp
        jsr clamp07
        sta ztmp
        lda #7
        sec
        sbc ztmp
        ora #$10                // DEN on, RSEL 0, raster high bit clear
        sta pendD11

        // Frames until each axis crosses a tile boundary.
        lda sgnx
        beq fx_never
        bmi fx_left
        lda camx
        and #7
        sta ztmp
        lda #8
        sec
        sbc ztmp
        jmp fx_put
fx_left:
        lda camx
        and #7
        clc
        adc #1
        jmp fx_put
fx_never:
        lda #$7f
fx_put: sta framesX

        lda sgny
        beq fy_never
        bmi fy_up
        lda camy
        and #7
        sta ztmp
        lda #8
        sec
        sbc ztmp
        jmp fy_put
fy_up:
        lda camy
        and #7
        clc
        adc #1
        jmp fy_put
fy_never:
        lda #$7f
fy_put: sta framesY

        lda framesX
        cmp framesY
        bcc !+
        lda framesY
!:      sta deadlin

        // The spare page is drawn for the origin after the next
        // crossing, which is one axis unless both cross together.
        lda #0
        sta dcol
        sta drow
        lda framesX
        cmp framesY
        beq tg_both
        bcc tg_x
        lda sgny
        sta drow
        jmp tg_have
tg_x:   lda sgnx
        sta dcol
        jmp tg_have
tg_both:
        lda sgnx
        sta dcol
        lda sgny
        sta drow
tg_have:
        lda visCol
        clc
        adc dcol
        bpl !+
        lda #0
!:      cmp #MAX_COL+1
        bcc !+
        lda #MAX_COL
!:      sta tgtCol
        lda visRow
        clc
        adc drow
        bpl !+
        lda #0
!:      cmp #MAX_ROW+1
        bcc !+
        lda #MAX_ROW
!:      sta tgtRow

        lda offCol
        cmp tgtCol
        bne pr_start
        lda offRow
        cmp tgtRow
        bne pr_start
        jmp pr_step
pr_start:
        lda tgtCol
        sta offCol
        lda tgtRow
        sta offRow
        lda #1
        sta rdState
        lda #0
        sta rdNext
        sta offOK
pr_step:
        lda rdState
        beq pr_done
        lda rdNext
        sta zrow
        lda #BAND_MAX-1         // at most BAND_MAX rows per field regardless of kind
        clc
        adc rdNext
        cmp #24
        bcc !+
        lda #24
!:      sta zend
        jsr drawMatrix
        jsr countRows
        lda zend
        cmp #24
        beq rs_ready
        clc
        adc #1
        sta rdNext
        jmp pr_done
rs_ready:
        lda #0
        sta rdState
        lda #1
        sta offOK
pr_done:
        jsr markOut
        jmp irqExit

// --- apply the registers in the blank --------------------------------
irqApply:
        pha
        txa
        pha
        tya
        pha
        cld                     // the D flag is not cleared on IRQ entry
        lda #$ff
        sta $d019
        lda #<irqColB
        sta $fffe
        lda #>irqColB
        sta $ffff
        lda #RAS_COLB
        sta $d012
        jsr markIn

        // Late-apply detection: if irqPrep overran, the raster has already
        // advanced past RAS_APPLY into the next field. Raster bit 8 is clear
        // for rasters 0-255; a raster below RAS_APPLY here means we are in
        // the next field. The CPU defers the IRQ until irqPrep's rti, so a
        // late apply is always at a raster below 251 with bit 8 clear.
        jsr readRaster
        lda zv+1
        bne ap_ontime           // raster > 255: still in the blank, on time
        lda zv
        cmp #RAS_APPLY
        bcs ap_ontime
        inc lateApply
ap_ontime:

        lda pendVM
        sta $d018
        lda pendD16
        sta $d016
        lda pendD11
        sta $d011

        jsr checkMarker
        jsr buildStatus         // one field per frame keeps the readout cheap
        jsr stampStatus

        inc frameL
        bne !+
        inc frameH
!:
        jsr markOut

        lda frameAc             // keep the worst field seen
        cmp worst
        lda frameAc+1
        sbc worst+1
        bcc ap_nw
        lda frameAc
        sta worst
        lda frameAc+1
        sta worst+1
        lda #0
        ldx colWork
        beq dbg_no
dbg_l:  clc
        adc #100
        dex
        bne dbg_l
dbg_no: clc
        adc rowsF
        sta wDbg
ap_nw:
        lda done
        bne ap_end
        lda frameL
        cmp #<CHECK_AT
        lda frameH
        sbc #>CHECK_AT
        bcc ap_end
        jsr verdict
        lda #1
        sta done
ap_end:
irqExit:
        pla
        tay
        pla
        tax
        pla
        rti

// --- verdict ---------------------------------------------------------
verdict:
        lda markBad
        bne vd_fail
        lda stalls
        bne vd_fail
        lda lateCol
        bne vd_fail
        lda lateApply
        bne vd_fail
        lda skipPrep
        bne vd_fail
        lda b1Dead
        bne vd_fail
        lda worst
        cmp #<BUDGET
        lda worst+1
        sbc #>BUDGET
        bcs vd_fail
        lda #$01
        sta $02ff
        lda #$05                // green
        sta $d020
        rts
vd_fail:
        lda #$02
        sta $02ff
        lda #$02                // red
        sta $d020
        rts

// The marker tile must sit where the camera origin says it does.
checkMarker:
        lda #MARK_X
        sec
        sbc visCol
        sta ztmp
        lda #MARK_Y
        sec
        sbc visRow
        tax
        lda rowLoT,x
        clc
        adc ztmp
        sta srcp
        lda rowHiT,x
        adc #0
        ldx pgVis
        clc
        adc pageHiT,x
        sta srcp+1
        ldy #0
        lda (srcp),y
        cmp #MARK_CH
        beq cm_ok
        lda #1
        sta markBad
cm_ok:  rts

// --- camera path -----------------------------------------------------
pathStep:
        dec legCnt
        bne ps_move
        inc legIdx
        lda legIdx
        cmp #8
        bcc !+
        lda #0
        sta legIdx
!:      tax
        lda pathDX,x
        sta sgnx
        lda pathDY,x
        sta sgny
        lda pathLen,x
        sta legCnt
ps_move:
        lda camx
        clc
        adc sgnx
        sta camx
        lda camy
        clc
        adc sgny
        sta camy
        rts

clamp07:
        bpl !+
        lda #0
        rts
!:      cmp #8
        bcc !+
        lda #7
!:      rts

// --- band copies -----------------------------------------------------
// Rows zrow..zend of the view, from the world into the spare matrix.
drawMatrix:
        lda pgVis
        eor #1
        tax
        lda pageHiT,x
        sta cbDstHi
        lda #>WORLD
        sta cbSrcHi
        lda offCol
        sta cbCol
        lda offRow
        sta cbRow
        jmp copyBand

// Rows zrow..zend of the view, from the colour world into colour RAM.
drawColour:
        lda #$d8
        sta cbDstHi
        lda #>WCOL
        sta cbSrcHi
        lda colCol
        sta cbCol
        lda colRow
        sta cbRow
        jmp copyBand

copyBand:
cb_row:
        lda cbRow
        clc
        adc zrow
        sta zv
        lsr
        lsr
        clc
        adc cbSrcHi
        sta cpSrc+2
        lda zv
        asl
        asl
        asl
        asl
        asl
        asl
        clc
        adc cbCol
        sta cpSrc+1
        ldx zrow
        lda rowLoT,x
        sta cpDst+1
        lda rowHiT,x
        clc
        adc cbDstHi
        sta cpDst+2
        jsr copyRow
        lda zrow
        cmp zend
        beq cb_done
        inc zrow
        jmp cb_row
cb_done:
        rts

copyRow:
        ldx #39
cr_l:
cpSrc:  lda $ffff,x
cpDst:  sta $ffff,x
        dex
        bpl cr_l
        rts

// --- frame timer -----------------------------------------------------
readTimer:
rt_l:   lda $dc07
        sta tNow+1
        lda $dc06
        sta tNow
        lda $dc07
        cmp tNow+1
        bne rt_l
        rts

markIn:
        jsr readTimer
        lda tNow
        sta tEnt
        lda tNow+1
        sta tEnt+1
        rts

markOut:
        jsr readTimer
        lda tEnt                // the timer counts down
        sec
        sbc tNow
        sta ztmp
        lda tEnt+1
        sbc tNow+1
        sta ztmp2
        lda frameAc
        clc
        adc ztmp
        sta frameAc
        lda frameAc+1
        adc ztmp2
        sta frameAc+1
        rts

// Did the top colour half finish before the beam reached row 0 of the
// next field? A finish raster at or above the one the handler started on
// is still inside this field and always in time.
topLate:
        lda colTop+1
        bne tl_ok
        lda colTop
        cmp prepRas
        bcs tl_ok
        lda pendD11
        and #7
        clc
        adc #48
        cmp colTop
        bcs tl_ok
        inc lateCol
tl_ok:  rts

countRows:
        lda zend
        sec
        sbc rdNext
        clc
        adc #1
        clc
        adc rowsF
        sta rowsF
        rts

// The nine-bit raster line, into zv.
readRaster:
        lda $d012
        sta zv
        lda $d011
        and #$80
        beq !+
        lda #1
        sta zv+1
        rts
!:      lda #0
        sta zv+1
        rts

// --- status line -----------------------------------------------------
// Row 1 is the topmost matrix row the display window shows in full at
// every YSCROLL value, so the digits never slide under the border.
initStatus:
        ldx #39
        lda #$20
!:      sta statBuf,x
        dex
        bpl !-
        lda #$18                // X
        sta statBuf+1
        lda #$19                // Y
        sta statBuf+6
        lda #$0c                // L
        sta statBuf+11
        lda #$13                // S
        sta statBuf+15
        lda #$17                // W
        sta statBuf+19
        lda #$14                // T
        sta statBuf+25
        lda #$02                // B
        sta statBuf+29
        lda #$04                // D
        sta statBuf+34
        rts

buildStatus:
        ldx statIdx
        ldy stSrc,x
        lda $0000,y
        sta zv
        lda #0
        sta zv+1
        lda stWrd,x
        beq !+
        iny
        lda $0000,y
        sta zv+1
!:      lda stDig,x
        sta pnI
        ldy stPos,x
        jsr putNum
        inc statIdx
        lda statIdx
        cmp #8
        bcc !+
        lda #0
        sta statIdx
!:      rts

putByte:
        sta zv
        lda #0
        sta zv+1
        lda #2
        sta pnI
        // fall through

// zv = value, Y = position in statBuf, pnI = first power of ten to use
putNum:
pn_dig: lda #0
        sta pnD
pn_sub: ldx pnI
        lda zv
        sec
        sbc pwTabLo,x
        sta pnTL
        lda zv+1
        sbc pwTabHi,x
        bcc pn_out
        sta zv+1
        lda pnTL
        sta zv
        inc pnD
        jmp pn_sub
pn_out: lda pnD
        clc
        adc #$30
        sta statBuf,y
        iny
        inc pnI
        lda pnI
        cmp #5
        bne pn_dig
        rts

stampStatus:
        ldx #39
ss_l:   lda statBuf,x
        sta SCR0+40,x
        sta SCR1+40,x
        lda #$01
        sta $d800+40,x
        dex
        bpl ss_l
        rts

// --- one-off setup ---------------------------------------------------
clearScreens:
        ldx #0
        lda #$20
!:      sta SCR0,x
        sta SCR0+$100,x
        sta SCR0+$200,x
        sta SCR0+$300,x
        sta SCR1,x
        sta SCR1+$100,x
        sta SCR1+$200,x
        sta SCR1+$300,x
        inx
        bne !-
        rts

genWorld:
        lda #<WORLD
        sta wptr
        lda #>WORLD
        sta wptr+1
        lda #<WCOL
        sta cptr
        lda #>WCOL
        sta cptr+1
        lda #0
        sta wy
gw_row:
        lda #0
        sta wx
gw_col:
        lda wx
        and #7
        sta t1
        lda wy
        and #7
        sta t2
        lda #$20
        sta ztmp
        lda t2
        bne gw_x
        lda #$40                // horizontal rule
        sta ztmp
gw_x:
        lda t1
        bne gw_b
        lda t2
        bne gw_v
        lda #$51                // ball at a grid crossing
        sta ztmp
        jmp gw_b
gw_v:
        lda #$5d                // vertical rule
        sta ztmp
gw_b:
        lda wx
        beq gw_edge
        cmp #WORLD_W-1
        beq gw_edge
        lda wy
        beq gw_edge
        cmp #WORLD_H-1
        beq gw_edge
        jmp gw_put
gw_edge:
        lda #$a0                // solid world edge
        sta ztmp
gw_put:
        lda ztmp                // colour follows the tile code
        ldx #2                  // red edge
        cmp #$a0
        beq gw_pc
        ldx #1                  // white ball
        cmp #$51
        beq gw_pc
        ldx #11                 // dark grey background
        cmp #$20
        beq gw_pc
        ldx #14                 // light blue rules
gw_pc:
        ldy #0
        lda ztmp
        sta (wptr),y
        txa
        sta (cptr),y
        inc wptr
        bne !+
        inc wptr+1
!:      inc cptr
        bne !+
        inc cptr+1
!:      inc wx
        lda wx
        cmp #WORLD_W
        beq !+
        jmp gw_col
!:      inc wy
        lda wy
        cmp #WORLD_H
        beq !+
        jmp gw_row
!:

        lda #<(WORLD + MARK_Y*WORLD_W + MARK_X)
        sta wptr
        lda #>(WORLD + MARK_Y*WORLD_W + MARK_X)
        sta wptr+1
        ldy #0
        lda #MARK_CH
        sta (wptr),y
        lda #<(WCOL + MARK_Y*WORLD_W + MARK_X)
        sta wptr
        lda #>(WCOL + MARK_Y*WORLD_W + MARK_X)
        sta wptr+1
        lda #7                  // yellow marker
        sta (wptr),y
        rts

// --- tables ----------------------------------------------------------
d018T:   .byte $14, $24
pageHiT: .byte >SCR0, >SCR1
statBuf: .fill 40, $20
rowLoT:  .fill 25, <(i*40)
rowHiT:  .fill 25, >(i*40)
stSrc:   .byte camx, camy, legIdx, stalls, worst, lateApply, skipPrep, b1Dead
stPos:   .byte 2, 7, 12, 16, 20, 26, 30, 35
stDig:   .byte 2, 2, 2, 2, 0, 2, 2, 2
stWrd:   .byte 0, 0, 0, 0, 1, 0, 0, 0
pwTabLo: .byte <10000, <1000, <100, <10, <1
pwTabHi: .byte >10000, >1000, >100, >10, >1

// right, down, left, up, down-right, down-left, up-left, up-right
pathDX:  .byte  1,  0, $ff,  0,  1, $ff, $ff,  1
pathDY:  .byte  0,  1,  0, $ff,  1,  1, $ff, $ff
pathLen: .byte 32, 32, 32, 32, 32, 32, 32, 32
```

## Build

```bash
java -jar KickAss.jar eight-way-scroll.asm -o eight-way-scroll.prg
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 20946000 -exitscreenshot eight-way-scroll.png \
  -autostart eight-way-scroll.prg
```

## Expected output

A grid of light blue rules on black with white balls at the crossings,
sliding in whichever direction the current leg is going, and a yellow
marker tile that moves with the world. Row 1 carries the readout. The
border is green from frame 320 on.

The readout is sampled: one of its eight fields is rebuilt each frame, so
a field can be up to eight frames behind the camera. Measured in the exit
screenshots, both models at 20,946,000 cycles, in a clean window at least
four fields past the last tile crossing:

| Model | Camera | Leg | Waited flips | Worst field | Late applies | Skipped preps | First-band deadline |
|---|---|---|---|---|---|---|---|
| PAL | 69, 127 | 5 | 0 | 13,111 | 0 | 0 | 0 |
| NTSC | 63, 73 | 7 | 0 | 13,152 | 0 | 0 | 0 |

The border is green in both, so the marker check held on every frame of
both runs. The two pictures are byte-identical across two runs of the
same command.

The rules sit eight tiles apart in the world, so they land 64 pixels apart
in the picture, and their phase is the camera's position within that
64-pixel period. The camera positions above are from the HUD at the exit
screenshot; the rule geometry varies with camera position.

A tile crossing produces four colour-write fields: the first top call
(`BAND_FIRST = 5` rows, rows 0 to 4), the second top call (rows 5 to 11),
the first bottom call (rows 12 to 18) and the second bottom call (rows 19
to 24). During those fields, rows not yet rewritten show the previous
origin's colour alongside the new matrix. The exit screenshots above are
taken in the clean window; a capture inside the three stale fields shows
grey horizontal rules in the rows not yet rewritten and a dimmer HUD row
for one field while row 1's colour updates (see "What it does not
establish").

Screenshots from the VICE runs this page describes:
`screenshots/eight-way-scroll.png` (PAL) and
`screenshots/eight-way-scroll-ntsc.png`.

## Why this works

### Fine scroll and the tile origin

The camera is a position in world pixels. Its tile origin is `camx >> 3`
and `camy >> 3`, and the sub-tile remainder is what the fine scroll has to
absorb. XSCROLL moves the display right, so a camera moving right needs a
decreasing XSCROLL: the listing writes `7 - (camx & 7)` and
`7 - (camy & 7)`, which walks 7 down to 0 across a tile and wraps as the
origin advances.

Both registers are written whole, never read-modify-write, so CSEL, MCM,
the raster compare's high bit and DEN keep the values the listing intends.
RSEL and CSEL are both left at 0. The narrow window hides the partial row
at each edge, so a 40 x 25 matrix covers the display at every fine scroll
value and no column or row is half drawn at the border.

### Why the matrix is double buffered

A whole-tile step needs all 1,000 matrix bytes replaced. That copy is
too long for the blank on either model, so it cannot be done between
fields; drawn into the live page it would be visible as a tear running
down the screen. Instead it goes into the page that is not on display, and
only the `$D018` VM nibble changes when it is complete. The flip is one
store in the blank.

The flip is refused unless the spare page already holds the origin
wanted, and every refusal is counted. That counter reading zero is the
evidence that the redraw always finished in time.

### Drawing for the origin after next, not the current one

The spare page cannot be drawn for the origin the camera has now, because
by the time it is ready the camera has moved on. It is drawn for the
origin after the next tile crossing. On a diagonal the two axes cross on
different frames, and a single spare page cannot serve two origins, so the
listing works out which axis crosses first, from `8 - (cam & 7)` when that
axis is increasing and `(cam & 7) + 1` when it is decreasing, and targets
that crossing alone.

The gap between crossings is set by the camera's starting position within
its tile. Starting both axes at 66 (2 within the tile) at half speed, the
smallest gap anywhere on the path is six fields: the three-field minimum
at one pixel per field doubles when the camera moves one pixel every two
fields. An earlier start position gave a gap of one at full speed and the
flip was refused on every diagonal.

### Splitting the redraw

`BAND_MAX` rows per field is the cap that applies everywhere. With
`BAND_MAX = 7` and a 25-row matrix, the spare page is ready in at most
four fields. The camera advances one pixel every two fields, so tile
crossings are sixteen fields apart on straight legs and there is always room.

The requirement is five fields: four fields of matrix redraw make the spare
page ready so a flip is possible from the fifth field, and the four colour
calls finish in the same span. The minimum gap between crossings is six
fields at half speed, leaving one field of slack. A slower rate is not
needed.

In the flip field, the matrix band is drawn into the page still on display
until raster 251. `irqPrep` toggles `pgVis` at the flip decision while
`pendVM` is applied at 251; `drawMatrix` targets `pgVis eor 1`, so the
band drawn between raster 152 + YSCROLL and 251 goes into the page the
beam is still showing. This is safe because `BAND_MAX = 7` keeps those
rows (0 to 6) above the beam at that raster. Raising `BAND_MAX` past 12
would draw into rows the beam has already reached, tearing the live page.

An earlier rule let a field with no colour work clear the whole debt. That
looked equivalent and was not: a change of leg moves the target origin
with no page flip, so a plain field started a 25-row redraw from nothing
and the field cost 20,506 cycles. Capping every band fixed it.

A second wrap arriving mid-redraw cannot happen here, because the redraw
always completes in four fields and the gap is sixteen on straight legs at half speed. If
it did, the flip would be refused, the waited-flips counter would rise and
the verdict would fail; the program does not try to abandon a part-drawn
page.

### Colour RAM

Colour RAM has one copy at `$D800` whatever `$D018` says, so it cannot be
flipped with the matrix. Both halves are written in `irqColB` at raster 4.

On NTSC, `irqApply` (register writes plus readout stamp) exceeds the
twelve-raster blank and finishes inside the next field, so `irqColB`
starts as late as raster 33. The first top call is limited to `BAND_FIRST
= 5` rows (rows 0 to 4) so it finishes before row 6's badline even at the
worst-case entry raster. The remaining calls use `BAND_MAX = 7`, which
always finishes before `irqPrep`'s raster.

The split at row 12 gives the top half twelve rows and the bottom thirteen.
Rows 0 to 4 see new colour in the flip field if the first call finishes in
time; rows 5 to 24 show old colour for one to three more fields. Over a
512-field loop about one field in four shows stale rows somewhere, and
three fields in eight on the opposite-sign diagonals where crossings are
closer together.

### The IRQ chain

Three handlers a field: raster 4 for the band-limited colour write,
152 + YSCROLL for the path step, flip decision and matrix band, and 251
for the register writes in the blank. Each arms the next one's `$D012` and
vector as its first act, before doing any work. A handler here can run for
more than a raster line, and if it armed its successor at the end it would
arm a compare the beam had already passed and lose a whole field.

The VIC sets the raster interrupt flag regardless of the CPU's interrupt
state. When the CPU's I flag is set because a previous handler is still
running, the CPU defers the new interrupt and takes it at the current
handler's `rti`. That is what lets a late `irqApply` be detected: if
`irqPrep` overruns the 251-raster mark, `irqApply` fires after the `rti`
at whatever raster `irqPrep` left the CPU, and reading `$D012` at
`irqApply`'s entry gives a number below 251.

The `$D016` write is whole-register (`lda pendD16; sta $D016`)
rather than read-modify-write. Two lint findings flag it as a possible
CSEL or MCM collision. It is not one: CSEL and MCM are both
left at 0 throughout, and a read-modify-write would require an extra byte
of state to track the stable bits.

`$01` is set to `$35`, so RAM is banked in under BASIC and KERNAL with I/O
still visible and the vector at `$FFFE` is the one that runs.

### Where the code lives

The two screen pages are `$0400` and `$0800`, both in VIC bank 0. The
program is at `$1000`, which the chip sees as character ROM, so that RAM
is free for code and cannot be mistaken for screen data. An earlier draft
sat at `$0810` and the routine that clears the second screen page wrote
over it; the program ran once, cleared itself and stopped with the BASIC
screen still up.

### What the timer measures

CIA 1 timer B free-runs from `$FFFF`. Each handler reads it on entry and
on exit and adds the difference to a per-field total, which the last
handler compares against the worst seen. The count is wall-clock, so
badline stalls are in it: the VIC holds the CPU for about 40 to 43 cycles
on every eighth line, and a copy loop that costs 14 cycles a byte in
instruction terms measures 17.6 to 17.8 cycles per byte. That figure comes
from reading the CIA timer before and after a full 25-row draw (1,000
bytes) at start-up on both models; it is a measured average, not
calculated from instruction timings alone.

The readout is inside the measured region. It builds one of its eight
fields a frame for that reason: built whole every sixteenth frame it added
about 3,000 cycles to whichever field it landed on, and the worst field is
the number this page reports.

A PAL field is 19,656 cycles and an NTSC field 17,095. The worst field
measured here is 13,111 on PAL and 13,152 on NTSC, both under the 18,000
budget the verdict checks. The NTSC figure is the larger of the two:
3,943 cycles of margin, twenty-three per cent of the field.

### What it does not establish

**Colour continuity across a flip.** A tile crossing writes colour to
colour RAM over four consecutive `irqColB` calls (two for the top half,
two for the bottom). During those fields the rows not yet rewritten show
the previous origin's colour alongside the new matrix for three displayed
fields (60 ms PAL, 50 ms NTSC). This is the cost of the band cap. Rows 0 to 4 may show old colour for
one field on NTSC when `irqColB` starts late enough that the first band
finishes after row 4's badline.

**Camera path coverage.** `MAX_COL` and `MAX_ROW` clamp the visible
origin so the camera never leaves the world. The path used here stays in
columns 4 to 12 and rows 8 to 16, so those clamps are never reached.
Whether the design is correct at the boundary is not tested.

**The one-pixel-per-field form.** At full speed the camera crosses a tile
boundary every field. Tile crossings are then eight fields apart on
straight legs, but the minimum gap on diagonals falls to three fields,
which is less than the five-field requirement. The band at `BAND_MAX = 7`
fits the available windows at either speed; what full speed loses is the
crossing gap. The half-speed camera doubles the minimum gap to six fields
and leaves one field of slack.
