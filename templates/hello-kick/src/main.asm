// hello-kick: hello in KickAssembler alone. One sprite moved by joystick
// port 2, fire toggles its colour, the frame meter around the frame's work.
// -define AUTOPILOT replaces the port with a script and grades the end
// position; -define FORCE_FAULT starts the sprite one pixel off, so both the
// program's own grade and the screenshot checks must fail.
#import "frame_meter.asm"              // templates/_harness/meter, via -libdir

.const SCREEN   = $0400
.const COLOUR   = $d800
.const RESULT   = $02ff                // $01 pass, $02 fail, $00 not reached
.const SPRITE_BLOCK = 13               // $0340, the tape buffer
#if FORCE_FAULT
.const START_X  = 101                  // the fault build ends 1 pixel off
#else
.const START_X  = 100
#endif
.const START_Y  = 100
.const PLAY_FRAMES = 144               // the script's length; the meter records these
.const VERDICT_FRAME = 150             // after the script
.const EXPECT_X = 188                  // 100 + 64 + 24, by arithmetic on the script
.const EXPECT_Y = 116                  // 100 + 40 - 24
.const EXPECT_COLOUR = 3               // cyan: one fire press from yellow

BasicUpstart2(start)

start:
        sei                            // no KERNAL IRQ inside the meter's bracket
        lda #$ff
        sta $dc00                      // no keyboard column selected
        ldx #0
!:      lda #$20
        sta SCREEN,x
        sta SCREEN+$100,x
        sta SCREEN+$200,x
        sta SCREEN+$2e8,x
        lda #1
        sta COLOUR,x
        sta COLOUR+$100,x
        sta COLOUR+$200,x
        sta COLOUR+$2e8,x
        inx
        bne !-
        lda #0
        sta $d020
        sta $d021
        ldx #title_end - title - 1
!:      lda title,x
        sta SCREEN + 40*1 + 1,x
        dex
        bpl !-
        ldx #62
        lda #$ff                       // a solid 24 x 21 block
!:      sta SPRITE_BLOCK*64,x
        dex
        bpl !-
        lda #SPRITE_BLOCK
        sta SCREEN + $3f8
        lda #7
        sta colour
        sta $d027
        lda #1
        sta $d015
        FrameMeterInit()

loop:
!:      lda $d012                      // frame_sync_loop on line 250: below the last
        cmp #250                       // badline ($F7), once a frame, PAL and NTSC
        beq !-
!:      lda $d012
        cmp #250
        bne !-
        FrameMeterStart()
        jsr port_read                  // A = port byte, active low
        sta joy
        lda joy
        and #$04                       // left, down to X 24
        bne no_left
        lda xpos+1
        bne do_left
        lda xpos
        cmp #25
        bcc no_left
do_left:
        lda xpos
        bne !+
        dec xpos+1
!:      dec xpos
no_left:
        lda joy
        and #$08                       // right, up to X 320
        bne no_right
        lda xpos+1
        beq do_right
        lda xpos
        cmp #<320
        bcs no_right
do_right:
        inc xpos
        bne no_right
        inc xpos+1
no_right:
        lda joy
        and #$01                       // up
        bne !+
        lda ypos
        cmp #51
        bcc !+
        dec ypos
!:      lda joy
        and #$02                       // down
        bne !+
        lda ypos
        cmp #229
        bcs !+
        inc ypos
!:      lda joy                        // fire: a new press toggles the colour
        and #$10
        bne !+
        lda prev
        and #$10
        beq !+
        lda colour
        eor #7 ^ 3
        sta colour
!:      lda joy
        sta prev
        lda xpos                       // the sprite registers
        sta $d000
        lda $d010
        and #$fe
        ldx xpos+1
        beq !+
        ora #1
!:      sta $d010
        lda ypos
        sta $d001
        lda colour
        sta $d027
        FrameMeterStop()               // the frame's own work ends here
#if AUTOPILOT
        // Grading is the harness's bookkeeping, not the program's work: it
        // runs after FrameMeterStop, so it is not in the worst frame.
        lda frame+1
        bne !+
        lda frame
        cmp #VERDICT_FRAME
        bne !+
        jsr verdict
!:
#endif
        FrameMeterPrint()
        inc frame
        bne !+
        inc frame+1
!:      jmp loop

#if AUTOPILOT
// Reads the sprite registers back and grades them.
verdict:
        lda $d000
        cmp #<EXPECT_X
        bne fail
        lda $d010
        and #1
        cmp #>EXPECT_X
        bne fail
        lda $d001
        cmp #EXPECT_Y
        bne fail
        lda $d027
        and #$0f                       // the upper nibble of a colour register reads set
        cmp #EXPECT_COLOUR
        bne fail
        lda #1
        sta RESULT
        lda #5
        sta $d020
        ldx #0
        jmp say
fail:   lda #2
        sta RESULT
        sta $d020
        ldx #pass_end - pass
say:    ldy #0
!:      lda pass,x
        sta SCREEN + 40*22 + 1,y
        inx
        iny
        cpy #pass_end - pass
        bne !-
        rts

// { frames, port byte }: right 64, down 40, fire 16, up and right 24.
// Every frame plays.
port_read:
        ldx ap_index
        cpx #4
        bcs idle
        inc ap_used
        lda ap_used
        cmp script_frames,x
        bne !+
        lda #0
        sta ap_used
        inc ap_index
!:      lda script_byte,x              // this frame's byte; X still names its entry
        rts
idle:   lda #$ff
        rts
script_frames: .byte 64, 40, 16, 24
script_byte:   .byte $f7, $fd, $ef, $f6
ap_index: .byte 0
ap_used:  .byte 0
pass:   .text "result 01 pass"
pass_end:
        .text "result 02 fail"
#else
port_read:
        lda $dc00                      // control port 2, active low
        rts
#endif

title:  .text "hello harness"
title_end:
xpos:   .word START_X
ypos:   .byte START_Y
colour: .byte 7
joy:    .byte 0
prev:   .byte $ff
frame:  .word 0

frame_meter:                           // the meter's macros jsr into this label
        FrameMeterCode(SCREEN, 24, 20, 1, PLAY_FRAMES)
