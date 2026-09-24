// test/music_b_test.asm: standalone runner for src/parts/music3.asm with the
// tune data under the KERNAL. A copy of plan/music3/A/runner.asm (itself the
// music_test.asm shape plus the ENV3 log) with three changes: it copies the
// tune image from its load block to $E000 before music_init, it calls
// music_init with the tune chosen on the command line (:tune=N, default 1,
// tune B), and it banks the KERNAL out around music_play the way the
// sequencer must ($01 = $35 for the call, restored after; the CIA bracket
// includes those eight instructions). A BASIC stub at $0801, code at $0810,
// a text readout on rows 0 to 6 of $0400 in the ROM font, a line-255 raster
// interrupt calling music_play once per frame bracketed by CIA1 timer A
// (one-shot from $FFFF, net of its own start and stop). At frame 300 it
// grades: $02FF = 1 if music_pos equals the value the tune's timing predicts
// for that frame on this model (:pos300pal=N :pos300ntsc=M; the player
// skips one call in six on NTSC, so the two differ) and the call count
// equals the frame count, else 2; green or red border. The readout freezes
// at frame 300; the music keeps playing and the runner records music_pos at
// frames A and B (:posa, :posb) in $02F6 and $02F7 for the monitor to dump.
//   $02F0/1 worst play cycles over frames 1 to 300   $02F2/3 the frame-300 call's cycles
//   $02F4/5 calls at frame 300                       $02F8 music_pos at frame 300
//   $02F6 music_pos at frame A                       $02F7 music_pos at frame B
//   $02F9/A worst play cycles over frames 1 to B (row 6 shows the same)
// Rows 2 and 3 show player state: NTSC flag, next pattern index, filter
// program, cutoff, resonance/routing, mode, effect, speed index, then the
// tune's speed bytes (mu_speed, copied by music_init) and loop index.
// Build: java -jar KickAss.jar test/music_b_test.asm -odir build -o build/music_b_test.prg
//        :pos300pal=N :pos300ntsc=M :tune=T [:posa=A :posb=B :logfrom=F]

#import "../src/api.inc"

BasicUpstart2(start)

.encoding "screencode_upper"

.const SCREEN     = $0400
.const GRADE_AT   = 300
// The two late capture frames default to 1000 and 4000 as in music_test.asm;
// :posa=N :posb=M move them (a run to 6000 PAL frames covers a whole
// 100-second tune, so the W on row 6 is then the tune's worst call).
.const POS_AT_A   = cmdLineVars.containsKey("posa") ? cmdLineVars.get("posa").asNumber() : 1000
.const POS_AT_B   = cmdLineVars.containsKey("posb") ? cmdLineVars.get("posb").asNumber() : 4000
.const POS300_PAL  = cmdLineVars.get("pos300pal").asNumber()
.const POS300_NTSC = cmdLineVars.get("pos300ntsc").asNumber()
// The ENV3 log (2026-09-24): from frame LOG_FROM (:logfrom=N, default 2200,
// which is 45 frames before the break's first bar on PAL) the IRQ stores the
// player's mu_e3 (the $D41C byte it read) and mu_fcut (the $D416 byte it
// wrote) once a frame, LOG_N frames of each, at LOG_E3 and LOG_CUT; when the
// log is full it writes LOG_DONE, the byte a -moncommands `trace store`
// dumps the log on. env3check.py reads the dump against the SID register
// dump and checks $D416 = ($D41C >> 1) + base frame by frame.
.const LOG_FROM = cmdLineVars.containsKey("logfrom") ? cmdLineVars.get("logfrom").asNumber() : 2200
.const LOG_N    = 512
.const LOG_E3   = $3000
.const LOG_CUT  = $3200
.label LOG_DONE = $02fe
// The tune music_init is given: 0 tune A, 1 tune B, 2 tune C when built,
// the count in the data's header (TUNES) minus one the silent list.
.const TUNE_SEL = cmdLineVars.containsKey("tune") ? cmdLineVars.get("tune").asNumber() : 1

* = $0810 "runner"

start:
    sei
    lda #$37
    sta $01
    lda #$7f
    sta $dc0d               // no CIA interrupts: timer A is the stopwatch
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #0
    sta $d020
    sta $d021
    ldx #0
clr:
    lda #$20
    sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $2e8,x
    lda #1
    sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $dae8,x
    inx
    bne clr
    ldx #0
lab:
    lda labels,x            // seven rows of labels: 280 bytes in two passes
    sta SCREEN,x
    inx
    bne lab
lab2:
    lda labels + 256,x
    sta SCREEN + 256,x
    inx
    cpx #24
    bne lab2
    lda #0
    sta frame
    sta frame + 1
    sta calls
    sta calls + 1
    sta worst
    sta worst + 1
    sta done
    sta frame_tick
    sta $02f6
    sta $02f7
    sta logact
    sta logi
    sta LOG_DONE
    jsr copy_image          // the tune image to $E000, under the KERNAL
    lda #TUNE_SEL
    jsr music_init
    jsr calibrate
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #SEQ_LINE
    sta $d012
    lda $d011
    and #$7f
    sta $d011
    lda #$01
    sta $d01a
    asl $d019
    cli
idle:
    lda frame_tick
    beq idle                // wait for the IRQ to post a tick
    lda #0
    sta frame_tick
    inc frame
    bne idle
    inc frame + 1
    jmp idle

// ---------------------------------------------------------------------------
// Stopwatch: CIA1 timer A, one-shot from $FFFF (the recipe's).
// ---------------------------------------------------------------------------
calibrate:
    lda #$ff
    sta $dc04
    sta $dc05
    lda #%00011001          // force load, one-shot, start
    sta $dc0e
    lda #0
    sta $dc0e               // stop
    sec
    lda #$ff
    sbc $dc04
    sta calib
    lda #$ff
    sbc $dc05
    sta calib + 1
    rts

timed_play:
    lda #$ff
    sta $dc04
    sta $dc05
    lda #%00011001
    sta $dc0e
    lda $01                 // the tune image is under the KERNAL: bank it
    pha                     // out around the call, as the sequencer must
    lda #$35
    sta $01
    jsr music_play
    pla
    sta $01
    lda #0
    sta $dc0e
    sec
    lda #$ff
    sbc $dc04
    sta cost
    lda #$ff
    sbc $dc05
    sta cost + 1
    sec                     // less the stopwatch's own start/stop
    lda cost
    sbc calib
    sta cost
    lda cost + 1
    sbc calib + 1
    sta cost + 1
    rts

// ---------------------------------------------------------------------------
// Line 255, once per frame: count the call, time it, keep the worst,
// count the frame, update the readout until frame 300, grade at 300.
// ---------------------------------------------------------------------------
irq:
    asl $d019
    lda #1
    sta frame_tick          // post a tick; the idle loop converts it to a frame count
    jsr timed_play
    lda cost + 1
    cmp worst + 1
    bcc nw
    bne newworst
    lda cost
    cmp worst
    bcc nw
newworst:
    lda cost
    sta worst
    lda cost + 1
    sta worst + 1
nw:
    lda done
    bne later
    jsr readout
    lda frame + 1
    cmp #>GRADE_AT
    bne later               // (was irqcounts: out of branch range once the log
    lda frame               // block went in; every frame test below is past 300)
    cmp #<GRADE_AT
    bne later
    jsr grade
later:
    // the ENV3 log: logact 0 waiting for LOG_FROM, 1 logging, 2 full
    lda logact
    cmp #1
    beq dolog
    bcs nolog
    lda frame + 1
    cmp #>LOG_FROM
    bne nolog
    lda frame
    cmp #<LOG_FROM
    bne nolog
    inc logact
dolog:
    ldx logi
    lda mu_e3
lg_e3:
    sta LOG_E3,x
    lda mu_fcut
lg_ct:
    sta LOG_CUT,x
    inc logi
    bne nolog
    inc lg_e3 + 2           // the next page of each log
    inc lg_ct + 2
    lda lg_e3 + 2
    cmp #>(LOG_E3 + LOG_N)
    bne nolog
    lda #2
    sta logact
    sta LOG_DONE            // the monitor's trace point: dump the log
nolog:
    lda frame + 1
    cmp #>POS_AT_A
    bne !+
    lda frame
    cmp #<POS_AT_A
    bne !+
    lda music_pos
    sta $02f6
    lda #<(SCREEN + 6 * 40 + 18)
    ldx #>(SCREEN + 6 * 40 + 18)
    ldy music_pos
    jsr puthex
!:  lda frame + 1
    cmp #>POS_AT_B
    bne irqcounts
    lda frame
    cmp #<POS_AT_B
    bne irqcounts
    lda music_pos
    sta $02f7
    lda #<(SCREEN + 6 * 40 + 30)
    ldx #>(SCREEN + 6 * 40 + 30)
    ldy music_pos
    jsr puthex
    lda worst               // the running worst over frames 1 to 4000
    sta $02f9
    lda worst + 1
    sta $02fa
    lda #<(SCREEN + 6 * 40 + 36)
    ldx #>(SCREEN + 6 * 40 + 36)
    ldy worst + 1
    jsr puthex
    lda #<(SCREEN + 6 * 40 + 38)
    ldx #>(SCREEN + 6 * 40 + 38)
    ldy worst
    jsr puthex
irqcounts:
    inc calls
    bne irqdone
    inc calls + 1
irqdone:
    jmp $ea81               // pla/tay/pla/tax/pla/rti

grade:
    lda #1
    sta done
    lda worst
    sta $02f0
    lda worst + 1
    sta $02f1
    lda cost
    sta $02f2
    lda cost + 1
    sta $02f3
    lda calls
    sta $02f4
    lda calls + 1
    sta $02f5
    lda music_pos
    sta $02f8
    ldx mu_ntsc
    cmp expected,x
    bne gfail
    lda calls
    cmp frame
    bne gfail
    lda calls + 1
    cmp frame + 1
    bne gfail
    ldx #3
gp:
    lda passtxt,x
    sta SCREEN + 5 * 40 + 10,x
    dex
    bpl gp
    lda #BORDER_PASS
    sta $d020
    lda #$01
    sta RESULT_BYTE
    rts
gfail:
    ldx #3
gf:
    lda failtxt,x
    sta SCREEN + 5 * 40 + 10,x
    dex
    bpl gf
    lda #BORDER_FAIL
    sta $d020
    lda #$02
    sta RESULT_BYTE
    rts

expected: .byte POS300_PAL, POS300_NTSC

// Rows 0 to 4: position, frames, calls, player state, cycles.
readout:
    lda #<(SCREEN + 33)
    ldx #>(SCREEN + 33)
    ldy music_pos
    jsr puthex
    lda #<(SCREEN + 40 + 7)
    ldx #>(SCREEN + 40 + 7)
    ldy frame + 1
    jsr puthex
    lda #<(SCREEN + 40 + 9)
    ldx #>(SCREEN + 40 + 9)
    ldy frame
    jsr puthex
    lda #<(SCREEN + 40 + 19)
    ldx #>(SCREEN + 40 + 19)
    ldy calls + 1
    jsr puthex
    lda #<(SCREEN + 40 + 21)
    ldx #>(SCREEN + 40 + 21)
    ldy calls
    jsr puthex
    // row 2: eight state bytes at columns 7, 10, 13 ... 28
    ldy mu_ntsc
    lda #<(SCREEN + 2 * 40 + 7);  ldx #>(SCREEN + 2 * 40 + 7);  jsr puthex
    ldy mu_pidx
    lda #<(SCREEN + 2 * 40 + 10); ldx #>(SCREEN + 2 * 40 + 10); jsr puthex
    ldy mu_fprog
    lda #<(SCREEN + 2 * 40 + 13); ldx #>(SCREEN + 2 * 40 + 13); jsr puthex
    ldy mu_fcut
    lda #<(SCREEN + 2 * 40 + 16); ldx #>(SCREEN + 2 * 40 + 16); jsr puthex
    ldy mu_fres
    lda #<(SCREEN + 2 * 40 + 19); ldx #>(SCREEN + 2 * 40 + 19); jsr puthex
    ldy mu_fmode
    lda #<(SCREEN + 2 * 40 + 22); ldx #>(SCREEN + 2 * 40 + 22); jsr puthex
    ldy sfx_num
    lda #<(SCREEN + 2 * 40 + 25); ldx #>(SCREEN + 2 * 40 + 25); jsr puthex
    ldy mu_sidx
    lda #<(SCREEN + 2 * 40 + 28); ldx #>(SCREEN + 2 * 40 + 28); jsr puthex
    // row 3: the tune's constants
    ldy mu_speed
    lda #<(SCREEN + 3 * 40 + 7);  ldx #>(SCREEN + 3 * 40 + 7);  jsr puthex
    ldy mu_speed + 1
    lda #<(SCREEN + 3 * 40 + 10); ldx #>(SCREEN + 3 * 40 + 10); jsr puthex
    ldy mu_loop1
    lda #<(SCREEN + 3 * 40 + 21); ldx #>(SCREEN + 3 * 40 + 21); jsr puthex
    lda #<(SCREEN + 4 * 40 + 12)
    ldx #>(SCREEN + 4 * 40 + 12)
    ldy worst + 1
    jsr puthex
    lda #<(SCREEN + 4 * 40 + 14)
    ldx #>(SCREEN + 4 * 40 + 14)
    ldy worst
    jsr puthex
    lda #<(SCREEN + 4 * 40 + 22)
    ldx #>(SCREEN + 4 * 40 + 22)
    ldy cost + 1
    jsr puthex
    lda #<(SCREEN + 4 * 40 + 24)
    ldx #>(SCREEN + 4 * 40 + 24)
    ldy cost
    jsr puthex
    rts

// Y = byte, A/X = screen address: two hex digits (pointer $10, the part zp)
puthex:
    sta $10
    stx $11
    tya
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda hexdig,x
    ldy #0
    sta ($10),y
    pla
    and #$0f
    tax
    lda hexdig,x
    ldy #1
    sta ($10),y
    rts

hexdig:  .text "0123456789ABCDEF"
passtxt: .text "PASS"
failtxt: .text "FAIL"

labels:
    .text "C64-KB MUSIC B TEST         POS $       "   // row 0
    .text "FRAME $     CALLS $                     "   // row 1
    .text "STATE                                   "   // row 2
    .text "SPEED         LOOP1 $                   "   // row 3
    .text "PLAY WORST $     NOW $                  "   // row 4
    .text "RESULT                                  "   // row 5
    .text "POS AT FRAME A    $   AT B    $   W $   "   // row 6, written at frames A and B (posa, posb)

frame:      .word 0
calls:      .word 0
worst:      .word 0
cost:       .word 0
calib:      .word 0
done:       .byte 0
frame_tick: .byte 0        // set to 1 by the IRQ; cleared by the idle loop
logact:     .byte 0        // the ENV3 log: 0 waiting, 1 logging, 2 full
logi:       .byte 0        // index within the log's current page

// The tune image, assembled at MUSIC_IMAGE_LOAD, to MUSIC_IMAGE_RUN under the
// KERNAL: a write reaches the RAM under a ROM whatever $01 holds, so the copy
// needs no banking. Whole pages, rounded up; $10-$13 are the part zero page.
copy_image:
    lda #<music_image
    sta $10
    lda #>music_image
    sta $11
    lda #<MUSIC_IMAGE_RUN
    sta $12
    lda #>MUSIC_IMAGE_RUN
    sta $13
    ldx #>(MUSIC_IMAGE_LEN + 255)
    ldy #0
!:  lda ($10),y
    sta ($12),y
    iny
    bne !-
    inc $11
    inc $13
    dex
    bne !-
    rts

runner_end:
.assert "runner fits below MUSIC_BASE", runner_end <= MUSIC_BASE, true

// The module under test, at MUSIC_BASE (music3.asm sets the program counter).
.import source "../src/parts/music3.asm"
