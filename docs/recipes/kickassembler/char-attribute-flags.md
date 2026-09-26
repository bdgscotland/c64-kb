---
recipe: char-attribute-flags
toolchain: kickassembler
output_format: PRG
region: both
techniques: [char_attribute_flags, mob_priority]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D010, D011, D012, D015, D017, D018, D01B, D01C, D01D, D020, D021, D027, D028, D029, DD04, DD05, DD0E]
uses_kernal: []
claims: [sprite_0-2 (owns), vic_char_base (owns), zero_page $FB-$FC (owns)]
harness: [cia2_timer_a]
ram: [colour=$D800-$DBE7]
devices: []
---

<!-- doc-type: recipe -->

# KickAssembler — Character Attribute Flags: One Table Byte Blocks, Hides and Kills

## Synopsis

A 256-byte table indexed by screen code gives every character three flags:
bit 0 blocks a move, bit 1 puts a sprite behind the scenery (`$D01B`), bit 2
kills. Three scripted walkers cross a small map, reading the character under
them from the map in RAM, never from screen RAM. One passes under a canopy
and stops at a wall with its priority bit set. One passes a short canopy,
then a bush that uses the same glyph with no flags, and stops at the wall
in front. One walks onto a hazard and dies. The frame of every event, the
final state, the worst update time and one probe's time are printed on
screen. Use it as the terrain lookup of a top-down game
(`char_attribute_flags` in `techniques/logic.md`).

## Source

```asm
// char-attribute-flags.asm
// A 256-byte attribute table indexed by the character code under an
// object answers three questions from one lookup: may it move there
// (bit 0), is it drawn behind the scenery (bit 1, fed to $D01B), and
// does it die there (bit 2). The table is read through the MAP at $4000,
// never through screen RAM.
//
// Three scripted walkers move right 1 px a frame for 200 frames:
//   lane a (rows 4-5):   canopy (bit 1) in cols 10-19, wall (bit 0) at col 20
//   lane b (rows 8-9):   canopy in cols 6-9, bush (same glyph, attribute 0)
//                        in cols 10-19, wall at col 20
//   lane c (rows 12-13): hazard (bit 2) in cols 14-15
// Then the frame of every event, the final state and the worst update
// time and one probe's time (CIA2 timer A) are printed in hex on
// rows 17-23.

.const SCREEN  = $0400
.const CHARSET = $3800        // VIC bank 0, $D018 = $1E
.const MAP     = $4000        // 40 x 25, one screen code per cell
.const MAPPTR  = $fb          // zero page pointer into MAP

.const A_BLOCK  = %001
.const A_BEHIND = %010
.const A_DEADLY = %100

.const WALL    = $70
.const CANOPY  = $71
.const BUSH    = $72
.const HAZARD  = $73

.const WALK    = 0
.const BLOCKED = 1
.const DEAD    = 2

.const FRAMES  = 200
.const WAIT_LINE = 251        // below the display on PAL and NTSC: no badlines, no sprites

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Data built by the assembler: the map, the attribute table, cell colours.
// ---------------------------------------------------------------------------
.function mapChar(i) {
    .var r = floor(i / 40)
    .var c = mod(i, 40)
    .if ((r == 4 || r == 5) && c >= 10 && c <= 19) { .return CANOPY }
    .if ((r == 4 || r == 5) && c == 20) { .return WALL }
    .if ((r == 8 || r == 9) && c >= 6 && c <= 9) { .return CANOPY }
    .if ((r == 8 || r == 9) && c >= 10 && c <= 19) { .return BUSH }
    .if ((r == 8 || r == 9) && c == 20) { .return WALL }
    .if ((r == 12 || r == 13) && c >= 14 && c <= 15) { .return HAZARD }
    .return $20
}

.function attrOf(ch) {
    .if (ch == WALL) { .return A_BLOCK }
    .if (ch == CANOPY) { .return A_BEHIND }
    .if (ch == HAZARD) { .return A_DEADLY }
    .return 0                 // BUSH looks like CANOPY and has no bits
}

.function colourOf(ch) {
    .if (ch == WALL) { .return 9 }                    // brown
    .if (ch == CANOPY || ch == BUSH) { .return 5 }    // green
    .if (ch == HAZARD) { .return 14 }                 // light blue
    .return 1                                         // text: white
}

* = MAP "map"
    .fill 1000, mapChar(i)

* = $4400 "attr"             // page-aligned: attr,y never crosses a page
attr:
    .fill 256, attrOf(i)
colours:
    .fill 256, colourOf(i)

* = $3000 "shape"            // pointer $C0: a solid 16 x 16 block
    .for (var r = 0; r < 21; r++) {
        .if (r < 16) { .byte $ff, $ff, $00 } else { .byte 0, 0, 0 }
    }
    .byte 0

// ---------------------------------------------------------------------------
// Walker state, three entries each
// ---------------------------------------------------------------------------
* = $0810 "code"
xs:     .byte 40, 40, 40
ys:     .byte 50 + 4 * 8, 50 + 8 * 8, 50 + 12 * 8
state:  .byte WALK, WALK, WALK
prio:   .byte 0, 0, 0         // $00 in front, $FF behind
bits:   .byte %001, %010, %100
on_f:   .byte $ff, $ff, $ff   // frame priority first became $FF
off_f:  .byte $ff, $ff, $ff   // frame it first went back to $00
blk_f:  .byte $ff, $ff, $ff   // frame first blocked
die_f:  .byte $ff, $ff, $ff   // frame it died
frame:  .byte 0
cell:   .byte 0
tmp:    .byte 0
cal:    .byte 0
res_lo: .byte 0
res_hi: .byte 0
max_lo: .byte 0
max_hi: .byte 0
probe_cyc: .byte 0

rowlo:  .fill 25, <(MAP + i * 40)
rowhi:  .fill 25, >(MAP + i * 40)

// Probe(dx, dy): X = walker. A = attribute of the map cell under the
// pixel (xs + dx, ys + dy) in sprite coordinates. Sprite 24, 50 is the
// top-left text pixel, so cell = ((x - 24) / 8, (y - 50) / 8).
// X stays below 256 in this recipe; a full-width map adds bit 8.
.macro Probe(dx, dy) {
    lda ys, x
    sec
    sbc #50 - dy
    lsr
    lsr
    lsr
    tay
    lda rowlo, y
    sta MAPPTR
    lda rowhi, y
    sta MAPPTR + 1
    lda xs, x
    sec
    sbc #24 - dx
    lsr
    lsr
    lsr
    tay
    lda (MAPPTR), y           // the map, not SCREEN
    tay
    lda attr, y
}

start:
    sei
    lda #0
    sta $d020
    sta $d021
    sta $d010
    sta $d017
    sta $d01c
    sta $d01d
    sta $d01b

    lda #$33                  // character ROM in at $D000
    sta $01
    ldx #0
!:  .for (var p = 0; p < 4; p++) {
        lda $d000 + p * $100, x
        sta CHARSET + p * $100, x
    }
    inx
    bne !-
    lda #$37
    sta $01
    ldx #7                    // four glyphs of our own at codes $70-$73
!:  lda #$ff
    sta CHARSET + WALL * 8, x
    lda glyph_check, x
    sta CHARSET + CANOPY * 8, x
    sta CHARSET + BUSH * 8, x
    lda glyph_wave, x
    sta CHARSET + HAZARD * 8, x
    dex
    bpl !-
    lda #$1e                  // screen $0400, charset $3800
    sta $d018

    ldx #0                    // screen and colour RAM drawn from the map
!:  .for (var p = 0; p < 4; p++) {
        lda MAP + p * 250, x
        sta SCREEN + p * 250, x
        tay
        lda colours, y
        sta $d800 + p * 250, x
    }
    inx
    cpx #250
    bne !-

    lda #$c0
    sta SCREEN + $3f8
    sta SCREEN + $3f9
    sta SCREEN + $3fa
    ldx #2
!:  lda #7                    // yellow; red when dead
    sta $d027, x
    txa
    asl
    tay
    lda ys, x
    sta $d001, y
    dex
    bpl !-
    jsr place
    lda #%00000111
    sta $d015

    jsr wait_line             // calibrate below the display: a badline
    lda #<empty               // would steal 40 cycles from the empty JSR/RTS
    ldx #>empty
    jsr time_it
    lda res_lo
    sta cal
    jsr wait_line             // one centre probe on its own, for the page
    lda #<probe_once
    ldx #>probe_once
    jsr time_it
    lda res_lo
    sec
    sbc cal
    sta probe_cyc

frame_loop:
    jsr wait_line
    lda #<update
    ldx #>update
    jsr time_it
    lda res_lo                // res - cal, keep the largest
    sec
    sbc cal
    sta res_lo
    lda res_hi
    sbc #0
    sta res_hi
    cmp max_hi
    bcc !+
    bne keep
    lda res_lo
    cmp max_lo
    bcc !+
keep:
    lda res_lo
    sta max_lo
    lda res_hi
    sta max_hi
!:  inc frame
    lda frame
    cmp #FRAMES
    bne frame_loop

    jsr report
idle:
    jmp idle

wait_line:
!:  lda $d011
    bmi !-
    lda $d012
    cmp #WAIT_LINE
    bne !-
    rts

// ---------------------------------------------------------------------------
// One frame for the three walkers, then $D01B and the positions.
// ---------------------------------------------------------------------------
update:
    ldx #2
u_loop:
    lda state, x
    cmp #DEAD
    beq u_prio                // the dead stay put; priority still follows the map
    Probe(16, 8)              // one pixel past the right edge, mid-body
    and #A_BLOCK
    beq u_move
    lda blk_f, x
    cmp #$ff
    bne !+
    lda frame
    sta blk_f, x
!:  lda #BLOCKED
    sta state, x
    bne u_prio
u_move:
    lda #WALK
    sta state, x
    inc xs, x
u_prio:
    Probe(8, 8)               // the body's centre
    sta cell
    and #A_BEHIND
    beq !+
    lda #$ff
!:  cmp prio, x
    beq u_deadly
    sta prio, x
    tay
    beq u_off
    lda on_f, x
    cmp #$ff
    bne u_deadly
    lda frame
    sta on_f, x
    jmp u_deadly
u_off:
    lda off_f, x
    cmp #$ff
    bne u_deadly
    lda frame
    sta off_f, x
u_deadly:
    lda state, x
    cmp #DEAD
    beq u_next
    lda cell
    and #A_DEADLY
    beq u_next
    lda #DEAD
    sta state, x
    lda frame
    sta die_f, x
    lda #2
    sta $d027, x
u_next:
    dex
    bmi u_done
    jmp u_loop
u_done:
    lda #0                    // $D01B: one bit per walker from its priority byte
    sta tmp
    ldx #2
!:  lda prio, x
    and bits, x
    ora tmp
    sta tmp
    dex
    bpl !-
    lda tmp
    sta $d01b
place:
    lda xs
    sta $d000
    lda xs + 1
    sta $d002
    lda xs + 2
    sta $d004
    rts

probe_once:
    ldx #0
    Probe(8, 8)
    rts

// ---------------------------------------------------------------------------
// Harness: CIA2 timer A counts down from $FFFF across one JSR.
// ---------------------------------------------------------------------------
time_it:
    sta jv + 1
    stx jv + 2
    lda #$ff
    sta $dd04
    sta $dd05
    lda #%00010001            // load $FFFF and start
    sta $dd0e
jv: jsr empty
    lda #0
    sta $dd0e
    lda #$ff
    sec
    sbc $dd04
    sta res_lo
    lda #$ff
    sbc $dd05
    sta res_hi
empty:
    rts

// ---------------------------------------------------------------------------
// Report on rows 17-23.
// ---------------------------------------------------------------------------
.macro PrintHex(src, dst) {
    lda src
    lsr
    lsr
    lsr
    lsr
    tay
    lda digits, y
    sta dst
    lda src
    and #$0f
    tay
    lda digits, y
    sta dst + 1
}

report:
    ldx #0
!:  lda labels, x
    sta SCREEN + 17 * 40, x
    inx
    cpx #240
    bne !-
    ldx #39
!:  lda labels + 240, x
    sta SCREEN + 23 * 40, x
    dex
    bpl !-
    .for (var w = 0; w < 3; w++) {
        PrintHex(xs + w,    SCREEN + (18 + w) * 40 + 7)
        PrintHex(prio + w,  SCREEN + (18 + w) * 40 + 10)
        PrintHex(state + w, SCREEN + (18 + w) * 40 + 13)
        PrintHex(on_f + w,  SCREEN + (18 + w) * 40 + 16)
        PrintHex(off_f + w, SCREEN + (18 + w) * 40 + 19)
        PrintHex(blk_f + w, SCREEN + (18 + w) * 40 + 22)
        PrintHex(die_f + w, SCREEN + (18 + w) * 40 + 25)
    }
    PrintHex($d01b, SCREEN + 21 * 40 + 7)
    PrintHex(max_hi, SCREEN + 22 * 40 + 7)
    PrintHex(max_lo, SCREEN + 22 * 40 + 9)
    PrintHex(probe_cyc, SCREEN + 23 * 40 + 7)
    rts

glyph_check: .byte $aa, $55, $aa, $55, $aa, $55, $aa, $55
glyph_wave:  .byte $00, $66, $99, $00, $00, $66, $99, $00
digits: .text "0123456789abcdef"
labels: .text "lane   x  pr st on of bk dd             "
        .text "a                                       "
        .text "b                                       "
        .text "c                                       "
        .text "d01b                                    "
        .text "cyc                                     "
        .text "probe                                   "
```

## Build

```bash
java -jar KickAss.jar char-attribute-flags.asm -o char-attribute-flags.prg
```

`-showmem`: code `$0810-$0EBD`, sprite shape `$3000-$303F`, map
`$4000-$43E7`, attribute and colour tables `$4400-$45FF`. The character
set is copied from ROM to `$3800` at start.

## Expected output

Verified in VICE x64sc 3.10, PAL (C64C: 8565, 8580, 8521) and NTSC
(6567R8), 8,000,000 cycles; screenshots
`screenshots/char-attribute-flags.png` and
`screenshots/char-attribute-flags-ntsc.png`. A PIL script found the same
in both (PAL line = PNG row + 16, NTSC line = row + 28):

- **Walker a** (yellow) at screenshot x 176-191, lines 83-98: over the
  canopy in columns 18-19, next to the wall at column 20. Of its 256
  pixels, 128 are canopy green and 128 yellow, and the green ones are
  exactly the pixels where the checker glyph has a 1 bit. The sprite is
  behind the playfield.
- **Walker b** (yellow) at x 176-191, lines 115-130: over the bush, the
  same glyph with no flags. All 256 pixels yellow: in front.
- **Walker c** (red: dead) at x 136-151, lines 147-162: all 256 pixels
  red, covering the left hazard column.
- A sprite at Y 82 starts on line 83: the first line is Y + 1.
- Rows 17-23, decoded against the character ROM:

| Row | Lane | X | Priority | State | Behind on | Behind off | Blocked | Died |
|---|---|---|---|---|---|---|---|---|
| 18 | a | `A8` (168) | `FF` | `01` blocked | `37` (55) | `FF` never | `80` (128) | `FF` never |
| 19 | b | `A8` (168) | `00` | `01` blocked | `17` (23) | `37` (55) | `80` (128) | `FF` never |
| 20 | c | `80` (128) | `00` | `02` dead | `FF` never | `FF` never | `FF` never | `57` (87) |

Row 21 prints `$D01B` read back: `01`, walker a's bit only. Row 22 prints
the worst update, `02BC` = 700 cycles, and row 23 one probe, `3B` = 59
cycles. The probe figure includes the `LDX #0` before it; the probe itself
is 57 cycles, the sum of its instructions with no page crossing. A debug
build (not this listing) that also printed the frame of the worst update
found it at frame 55, when walker a's priority set and walker b's cleared
in the same frame. PAL and NTSC print the same figures: the update runs
from line 251, below the display, with no badline and no sprite fetch.

The event frames follow from the map. A walker starts at X 40 and moves
1 pixel a frame, so in frame f it moves to X 41 + f. Its centre probe is
at X − 16, so it reaches column c at X = 8c + 16: column 10 at frame 55,
column 6 at frame 23, column 14 at frame 87. Its leading probe is at
X − 8, so the wall at column 20 stops it when X = 168, at frame 128.

The first run of this listing printed 657 cycles on PAL and 700 on NTSC.
The empty JSR/RTS that calibrates the timer ran at wherever the program
happened to start, and a badline had stolen 43 cycles from it. The
listing now calibrates below the display (`jsr wait_line` first).

## Why this works

### One byte answers three questions

`Probe` turns a pixel into a map cell, reads the screen code there and
uses it as the index into `attr`. Walls, canopies, bushes and hazards are
not known to the code at all: the map says where they are and the table
says what they do. The bush in lane b is the canopy glyph under a second
code with attribute 0. It looks the same and does nothing, which is the
only way one glyph can behave two ways with a per-character table.

### Priority from the table to `$D01B`

Each walker keeps a priority byte, `$00` or `$FF`. After the three
updates, `u_done` ANDs each byte with its sprite's bit and ORs them
together into `$D01B`. The VIC-II then decides per pixel: over a 1 bit of
the canopy the character wins, over a 0 bit the sprite shows
(`mob_priority`). That is why walker a is half green, in the checker's
pattern, and walker b, over the same glyph with its bit clear, is solid.

### Map, not screen

The screen here is at `$0400`, readable, and holds the same codes. The
lookup still reads `MAP`: the report text on rows 17-23 is written to the
screen only, and in a game the screen may sit under ROM or be rewritten
by a scroll. The map is the level; the screen is a picture of it.

### Region

`region: both`. The walkers are at lines 83-162 and the update starts at
line 251, inside NTSC's 263 lines. The update takes about 11 lines (700
cycles at 63 or 65 a line), so it ends inside the same frame on both.
