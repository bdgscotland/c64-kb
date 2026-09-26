---
recipe: joystick-name-entry
toolchain: kickassembler
output_format: PRG
region: both
techniques: [joystick_name_entry]
file_formats: [PRG]
uses_registers: [DC00, DC04, DC05, DC0D, DC0E, D012, D020, D021]
uses_kernal: []
claims: [cia1_timer_b (init), cia1_tod (init), zero_page $02-$1A (owns)]
harness: [cia1_timer_a, $02FF]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Three initials entered with the joystick, KERNAL banked out

## Synopsis

A high-score name entry for a game that has banked the KERNAL out
(`$01` = `$35`) and so has no GETIN. Up and down turn a letter wheel
(A to Z, then `.`), and a held direction repeats after 16 frames, then
every 4. Fire or right accepts the letter and moves on; left goes back
one. The entry ignores the stick until every line has been released
once, and it closes itself after 150 frames with no input. A scripted
stick makes two entries. The first is `DAB`, with a repeat, a wrong
letter and a step back. The second is a `B` followed by a timeout, which
gives `B..`. Each event is logged, and the names, logs and closing frames
are checked against the Python model below. The technique is
`joystick_name_entry` in `techniques/text.md`.

## Source

```asm
// joystick-name-entry.asm: three initials entered with the joystick, with
// the KERNAL banked out ($01 = $35), so no GETIN.
// Up and down turn a letter wheel (A-Z, then "."), held they repeat after
// DELAY frames every RATE frames; fire or right accepts the letter and moves
// on; left goes back one; the entry ignores the stick until every line has
// been released once (a fire still held from the game over does not accept
// a letter), and closes itself after IDLE frames with no input.
// A scripted stick (ANDed into the $DC00 read, so a real stick in port 2 also
// counts) makes two entries: DAB, with a repeat, a wrong letter and a step
// back; then B and a timeout, which gives "B..".
// Each event is logged: a letter when the wheel turns, "+" accept, "<" back,
// "!" timeout. Verdict: $02FF = $01 and a green border when both names,
// both trails and both closing frames equal the model's; $02 and red if not.
// Build: java -jar KickAss.jar joystick-name-entry.asm -o joystick-name-entry.prg
.encoding "screencode_upper"

.const SCREEN = $0400
.const COLRAM = $d800
.const RESULT = $02ff
.const LINE   = 251             // work line: below the display on PAL and NTSC
.const DELAY  = 16              // frames before a held direction repeats
.const RATE   = 4               // frames between repeats
.const IDLE   = 150             // frames with no input before the entry closes
.const DOT    = $2e             // "." screen code
.const FIELD  = SCREEN + 5 * 40 + 17
.const TRMAX  = 20              // trail bytes kept per entry

// zero page
.const pressed = $02            // this frame's lines, 1 = pressed: fire, right, left, down, up
.const prev    = $03
.const fresh   = $04            // pressed this frame and not last
.const ud      = $05            // up/down lines this frame
.const held    = $06            // up/down lines the repeat counter belongs to
.const count   = $07            // frames held
.const step    = $08            // 1: turn the wheel this frame
.const armed   = $09            // 0 until every line has been released
.const cursor  = $0a            // 0-2
.const idle    = $0b            // frames with no input (2)
.const done    = $0d            // 1 accepted, 2 timed out
.const trlen   = $0e
.const sidx    = $0f            // script position, frames left in this step
.const sleft   = $10
.const frames  = $11            // frames in this entry (2)
.const entry   = $13            // 0 or 1
.const fails   = $14
.const cyc     = $15            // body cycles of the last frame (2)
.const worst   = $17            // most cycles one frame took (2)
.const zp_ptr  = $19            // (2)

BasicUpstart2(start)

start:
        sei
        lda #$35                // KERNAL and BASIC out, I/O in: no GETIN from here
        sta $01
        lda #$7f
        sta $dc0d               // no CIA1 interrupts
        lda $dc0d
        lda #0
        sta $d020
        sta $d021
        sta sidx
        sta sleft
        sta fails
        sta worst
        sta worst+1
        sta entry
        jsr clear_screen
        ldx #txt_title_end - txt_title - 1
!:      lda txt_title,x
        sta SCREEN,x
        dex
        bpl !-
        jsr time_empty

one_entry:
        jsr entry_init
frame_loop:
        lda #LINE
!:      cmp $d012
        bne !-
        jsr script_byte         // A = this frame's scripted stick
        and $dc00               // and the real one in port 2
        ldx #$ff
        stx $dc04
        stx $dc05
        ldx #%00011001          // CIA1 timer A: force load, one-shot, start
        stx $dc0e
        jsr entry_frame
        ldx #0
        stx $dc0e
        jsr take_time
        inc frames
        bne !+
        inc frames+1
!:      lda #LINE
!:      cmp $d012               // leave the work line before waiting again
        beq !-
        lda done
        beq frame_loop

        jsr report_entry
        inc entry
        lda entry
        cmp #2
        bne one_entry

        // worst frame, verdict
        lda #<(SCREEN + 12 * 40 + 20)
        sta zp_ptr
        lda #>(SCREEN + 12 * 40 + 20)
        sta zp_ptr+1
        ldx #txt_cyc_end - txt_cyc - 1
!:      lda txt_cyc,x
        sta SCREEN + 12 * 40,x
        dex
        bpl !-
        ldy #0
        lda worst+1
        jsr put_hex
        lda worst
        jsr put_hex
        lda fails
        bne fail
        lda #1
        sta RESULT
        lda #5
        sta $d020
        ldx #0
!:      lda txt_pass,x
        sta SCREEN + 14 * 40,x
        inx
        cpx #12
        bne !-
        jmp forever
fail:
        lda #2
        sta RESULT
        sta $d020
        ldx #0
!:      lda txt_fail,x
        sta SCREEN + 14 * 40,x
        inx
        cpx #12
        bne !-
forever:
        jmp forever

// ============================================================
// entry_init: "A.." with the cursor on the first letter, disarmed
// ============================================================
entry_init:
        lda #1                  // "A"
        sta name
        lda #DOT
        sta name+1
        sta name+2
        lda #0
        sta cursor
        sta armed
        sta prev
        sta held
        sta count
        sta idle
        sta idle+1
        sta done
        sta trlen
        sta frames
        sta frames+1
        jmp draw_field

// ============================================================
// entry_frame: A = the port byte ($DC00 form, 0 = pressed). One frame of
// the entry: arm, edges, repeat, idle, wheel, accept, back, draw.
// ============================================================
entry_frame:
        eor #$ff
        and #$1f
        sta pressed
        lda armed
        bne ef_arm_ok
        lda pressed
        beq ef_arm              // every line released: armed from now on
        lda #0                  // still held from before: no input this frame
        sta fresh
        sta ud
        jmp ef_idle
ef_arm:
        lda #1
        sta armed
ef_arm_ok:
        lda prev                // joystick_edge_detect
        eor #$ff
        and pressed
        sta fresh
        lda pressed
        sta prev
        and #%00011             // up, down
        sta ud

        lda #0                  // joystick_autorepeat, one counter for up/down
        sta step
        lda ud
        beq ef_new
        cmp held
        bne ef_new
        inc count
        lda count
        cmp #DELAY
        bcc ef_rep_done
        lda #DELAY-RATE
        sta count
        inc step
        bne ef_rep_done         // always
ef_new: sta held                // A = ud
        lda #0
        sta count
        lda ud
        beq ef_rep_done
        inc step
ef_rep_done:
        lda fresh
        ora ud
        beq ef_idle
        lda #0
        sta idle
        sta idle+1
        beq ef_act              // always
ef_idle:
        inc idle
        bne !+
        inc idle+1
!:      lda idle+1
        cmp #>IDLE
        bcc ef_quiet
        bne ef_timeout
        lda idle
        cmp #<IDLE
        bcc ef_quiet
ef_timeout:
        lda #$21                // "!"
        jsr log
        lda #2
        jmp close
ef_quiet:
        lda armed
        bne ef_act
        rts

ef_act:
        lda step
        beq ef_keys
        ldx cursor
        lda ud
        cmp #%00001             // up alone: next letter
        bne ef_down
        lda name,x
        cmp #DOT
        beq ef_to_a
        cmp #26
        beq ef_to_dot
        clc
        adc #1
        bne ef_set              // always
ef_down:
        cmp #%00010             // down alone: letter before; both: nothing
        bne ef_keys
        lda name,x
        cmp #1
        beq ef_to_dot
        cmp #DOT
        beq ef_to_z
        sec
        sbc #1
        bne ef_set              // always
ef_to_a:
        lda #1
        bne ef_set
ef_to_z:
        lda #26
        bne ef_set
ef_to_dot:
        lda #DOT
ef_set: sta name,x
        jsr log

ef_keys:
        lda fresh
        and #%11000             // fire or right: accept
        beq ef_left
        lda #$2b                // "+"
        jsr log
        inc cursor
        ldx cursor
        cpx #3
        bne !+
        lda #1
        jmp close
!:      lda #1
        sta name,x              // the next letter starts at "A"
        jmp draw_field
ef_left:
        lda fresh
        and #%00100             // left: back one
        beq draw_field
        ldx cursor
        beq draw_field
        lda #DOT
        sta name,x
        dec cursor
        lda #$3c                // "<"
        jsr log
        jmp draw_field

// close: A = 1 accepted, 2 timed out. Letters not accepted become ".".
close:
        sta done
        ldx cursor
!:      cpx #3
        beq draw_field
        lda #DOT
        sta name,x
        inx
        bne !-

// draw_field: the three letters two cells apart, the cursor's in yellow with
// a "-" under it
draw_field:
        ldx #0
        ldy #0
df_cell:
        lda name,x
        sta FIELD,y
        lda done
        bne df_white            // closed: no cursor
        cpx cursor
        bne df_white
        lda #7
        bne df_col              // always
df_white:
        lda #1
df_col: sta FIELD - SCREEN + COLRAM,y
        cmp #7
        beq df_mark
        lda #$20
        bne df_put
df_mark:
        lda #$2d                // "-"
df_put: sta FIELD + 40,y
        iny
        iny
        inx
        cpx #3
        bne df_cell
        rts

// log: A = event screen code, appended to this entry's trail
log:
        ldy trlen
        cpy #TRMAX
        bcs !+
        sta trail,y
        inc trlen
!:      rts

// ============================================================
// report_entry: row 8 + entry: "N NAME TRAIL" and the closing frame, then
// the compare against the model
// ============================================================
report_entry:
        ldx entry
        lda row_lo,x
        sta zp_ptr
        lda row_hi,x
        sta zp_ptr+1
        ldy #0
        lda #$31                // "1" or "2"
        clc
        adc entry
        sta (zp_ptr),y
        ldy #2
        ldx #0
!:      lda name,x
        sta (zp_ptr),y
        iny
        inx
        cpx #3
        bne !-
        ldy #6
        lda frames+1
        jsr put_hex
        lda frames
        jsr put_hex
        ldy #11
        ldx #0
!:      cpx trlen
        beq !+
        lda trail,x
        sta (zp_ptr),y
        iny
        inx
        bne !-
!:      // compare with the model
        ldx entry
        lda exp_off,x
        tax
        ldy #0
!:      lda name,y
        cmp exp_name,x
        beq *+4
        inc fails
        inx
        iny
        cpy #3
        bne !-
        ldx entry
        lda frames
        cmp exp_frames,x
        bne rep_bad
        lda frames+1
        bne rep_bad
        lda trlen
        cmp exp_trlen,x
        bne rep_bad
        lda exp_troff,x
        tax
        ldy #0
!:      cpy trlen
        beq rep_ok
        lda trail,y
        cmp exp_trail,x
        bne rep_bad
        inx
        iny
        bne !-
rep_bad:
        inc fails
rep_ok: rts

// script_byte: A = the next scripted port byte; $FF after the end
script_byte:
        lda sleft
        bne sb_take
        ldx sidx
        lda script,x
        beq sb_end
        sta sleft
        inx
        inx
        stx sidx
sb_take:
        dec sleft
        ldx sidx
        lda script-1,x
        rts
sb_end:
        lda #$ff
        rts

// timing: body = the empty call's reading minus this reading
take_time:
        lda empty_lo
        sec
        sbc $dc04
        sta cyc
        lda empty_hi
        sbc $dc05
        sta cyc+1
        cmp worst+1
        bcc tt_done
        bne !+
        lda cyc
        cmp worst
        bcc tt_done
!:      lda cyc
        sta worst
        lda cyc+1
        sta worst+1
tt_done:
        rts

time_empty:
        ldx #$ff
        stx $dc04
        stx $dc05
        ldx #%00011001
        stx $dc0e
        jsr empty_rts
        ldx #0
        stx $dc0e
        lda $dc04
        sta empty_lo
        lda $dc05
        sta empty_hi
empty_rts:
        rts

// put_hex: A as two digits at (zp_ptr),Y; Y advances by 2
put_hex:
        pha
        lsr
        lsr
        lsr
        lsr
        tax
        lda hexd,x
        sta (zp_ptr),y
        iny
        pla
        and #15
        tax
        lda hexd,x
        sta (zp_ptr),y
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

hexd:       .text "0123456789ABCDEF"
row_lo:     .byte <(SCREEN + 8 * 40), <(SCREEN + 9 * 40)
row_hi:     .byte >(SCREEN + 8 * 40), >(SCREEN + 9 * 40)
txt_title:  .text "JOYSTICK NAME ENTRY, KERNAL OUT"
txt_title_end:
txt_cyc:    .text "WORST FRAME CYCLES $"
txt_cyc_end:
txt_pass:   .text "RESULT: PASS"
txt_fail:   .text "RESULT: FAIL"
empty_lo:   .byte 0
empty_hi:   .byte 0
name:       .fill 3, 0
trail:      .fill TRMAX, 0

// the stick, { frames, $DC00 byte }, 0 ends it
script: .byte 10, $ef           // fire still held from the game over: ignored
        .byte 4, $ff            // released: armed
        .byte 21, $fe           // up held: B at once, C after 16 frames, D 4 later
        .byte 3, $ff
        .byte 1, $ef            // fire: D accepted
        .byte 3, $ff
        .byte 1, $fd            // down: "."
        .byte 2, $ff
        .byte 1, $fd            // down: Z
        .byte 2, $ff
        .byte 1, $fb            // left: back to D
        .byte 2, $ff
        .byte 1, $f7            // right: D accepted again
        .byte 2, $ff
        .byte 1, $ef            // fire: A accepted
        .byte 2, $ff
        .byte 1, $fe            // up: B
        .byte 2, $ff
        .byte 1, $ef            // fire: B accepted, DAB closed
        .byte 3, $ff            // second entry: armed
        .byte 1, $fe            // up: B
        .byte 2, $ff
        .byte 1, $ef            // fire: B accepted
        .byte 0                 // then nothing: the entry times out

// the model's answers (Python on the page)
exp_off:    .byte 0, 3
exp_name:   .text "DAB"
            .text "B.."
exp_frames: .byte 61, 157
exp_troff:  .byte 0, 11
exp_trlen:  .byte 11, 3
exp_trail:  .text "BCD+.Z<++B+"
            .text "B+!"
```

The expected names, trails and frames come from this model of the
listing:

```python
# Model of the joystick-name-entry listing: the script, the entry rules, the
# trail of events and the frame on which each entry closes.
DELAY, RATE, IDLE = 16, 4, 150
SCRIPT = [(10, 0xEF), (4, 0xFF), (21, 0xFE), (3, 0xFF), (1, 0xEF), (3, 0xFF),
          (1, 0xFD), (2, 0xFF), (1, 0xFD), (2, 0xFF), (1, 0xFB), (2, 0xFF),
          (1, 0xF7), (2, 0xFF), (1, 0xEF), (2, 0xFF), (1, 0xFE), (2, 0xFF),
          (1, 0xEF), (3, 0xFF), (1, 0xFE), (2, 0xFF), (1, 0xEF)]
def port():
    for n, b in SCRIPT:
        for _ in range(n):
            yield b
    while True:
        yield 0xFF
DOT = '.'
def wheel(c, up):
    L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.'
    return L[(L.index(c) + (1 if up else -1)) % 27]
def entry(src):
    name, cur, armed, prev, held, count, idle = ['A', DOT, DOT], 0, 0, 0, 0, 0, 0
    trail, frames = '', 0
    while True:
        frames += 1
        pressed = ~next(src) & 0x1F
        if not armed and pressed:
            fresh = ud = 0
        else:
            armed = 1
            fresh = ~prev & pressed
            prev = pressed
            ud = pressed & 3
        step = 0
        if armed and ud and ud == held:
            count += 1
            if count >= DELAY:
                count, step = DELAY - RATE, 1
        elif armed:
            held, count, step = ud, 0, 1 if ud else 0
        if fresh or ud:
            idle = 0
        else:
            idle += 1
            if idle >= IDLE:
                for i in range(cur, 3): name[i] = DOT
                return ''.join(name), trail + '!', frames
        if step and ud in (1, 2):
            name[cur] = wheel(name[cur], ud == 1); trail += name[cur]
        if fresh & 0x18:
            trail += '+'; cur += 1
            if cur == 3:
                return ''.join(name), trail, frames
            name[cur] = 'A'
        elif fresh & 0x04 and cur:
            trail += '<'; name[cur] = DOT; cur -= 1
src = port()
for k in (1, 2):
    print('entry', k, *entry(src))
```

## Build

```bash
java -jar "$KICKASS_JAR" joystick-name-entry.asm -o joystick-name-entry.prg
```

## Expected output

`screenshots/joystick-name-entry.png` (PAL) and
`screenshots/joystick-name-entry-ntsc.png` (NTSC), pinned at 8,000,000
cycles in `recipes/runs.json`. Verified in VICE x64sc 3.10 (PAL c64c:
8565/8580/8521, and ntsc: 6567R8). Measured with PIL: each cell was
matched against the character ROM and its colour read. Both models give
the same text, all of it white, and a green border:

```text
JOYSTICK NAME ENTRY, KERNAL OUT

                 B . .

1 DAB 003D BCD+.Z<++B+
2 B.. 009D B+!

WORST FRAME CYCLES $0152

RESULT: PASS
```

Row 5 is the field as the second entry left it. Rows 8 and 9 are each
entry's name, the frame it closed on (hex: 61 and 157, counted from the
entry's first frame) and its trail. In the trail a letter means the wheel
turned to it, `+` an accept, `<` a step back and `!` the timeout.

- The first 10 frames hold fire. The trail does not start with `+`, so
  the held button did not accept the `A`.
- Up held for 21 frames gives `BCD`: B on the first frame, C 16 frames
  later, D 4 frames after that.
- Down twice from `A` gives `.` then `Z`. Left drops the `Z` and returns
  to the `D`, which keeps its value. Right accepts it again.
- In the second entry the `A` shown after the accept is never accepted,
  so the timeout turns it into `.`.

The worst frame, the entry's work from the port byte to the drawn field,
took 338 cycles (`$0152`), measured with CIA1 timer A below the display
(line 251). A fault build that starts the entry armed accepted the held
fire at once, logged `+BCD+.Z<++` and `ADA`, and failed red.

## Why this works

One byte of state per rule, all updated from one port read a frame. The
edge (`joystick_edge_detect`) is the lines pressed now and not last
frame, so one press is one accept. The repeat
(`joystick_autorepeat`) keeps one counter for the up/down pair. A new
direction steps at once and resets it. A held one steps when it reaches
`DELAY`, and is then set back to `DELAY − RATE`, so it steps every
`RATE` frames after that. Up and down together is not a direction, so the
wheel does not move.

`armed` starts at 0 and becomes 1 on the first frame with every line
released. Until then the frame counts only towards the timeout. This is
what stops a fire button still held from the game over accepting the
first letter. The idle counter runs in the unarmed frames too, so a stuck
button still ends the entry.

The script is ANDed into the `$DC00` read. With interrupts off and no
stick in port 2, the read gives `$7F` or `$FF`, and the low five bits are
all 1, so the script alone decides; a real stick in port 2 adds its
presses. No KERNAL routine is called, so the listing runs unchanged with
`$01` = `$35`, as it is here.
