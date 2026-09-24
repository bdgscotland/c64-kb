---
recipe: linecrunch
toolchain: kickassembler
output_format: PRG
region: both
techniques: [linecrunch, stable_raster_irq, double_irq, badline_synchronization, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D018, D019, D01A, D020, D021, DC0D]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), vic_char_base (owns), zero_page $02-$05 (owns)]
harness: [$02F0-$02FF]
ram: [state=$02E0, colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: linecrunch, the text screen scrolled up N rows by one `$D011` write per raster line

## Synopsis

Scrolls the whole text screen up by N character rows, N from a sine
table (0 to 12), without moving a byte of screen RAM. A double IRQ
reaches a known cycle of line 48; from line 50 a loop exactly one raster
line long writes `$D011` once per line on cycle 60, with YSCROLL equal to
that line's low three bits. Each such write crunches the next line: the
VIC draws it from the next text row with its row counter still 7 and
moves on another row, so N writes use up N rows in N raster lines. The
crunched lines are drawn in an invalid mode (ECM and BMM set), which is
black. On line 50 + N the loop writes text mode and a YSCROLL that makes
line 51 + N an ordinary badline, which fetches row N. Screen row r holds
character r, and pixel row p of character r is the byte 8r + p, so every
line of the picture says which row and pixel row it came from. The
program then finds the first badline by timing and checks it against
51 + N; `$02FF` is `01` while every frame has matched. Built with
`:ep=N` (PAL) or `:en=N` (NTSC) every write moves N − 41 or N − 43
cycles: the sweep. Built with `:blank=0` the crunched lines stay in text
mode. The technique is `linecrunch` in `techniques/raster.md`.

## Source

```asm
// linecrunch.asm
// Linecrunch: the text screen scrolled up by N character rows without
// moving a byte, N from a sine table, 0 to 12.
//
// The VIC-II ends a text row in cycle 58 of a line on which its row
// counter RC is 7: it copies the video counter VC into VCBASE (VCBASE
// moves on by the 40 cells just drawn) and goes idle. A badline
// condition that becomes true after that check, and is false again when
// the next line starts, puts the VIC back into display state with RC
// still 7 and no row fetch. The next line is then drawn from the new
// VCBASE with RC = 7, VC advances by 40 again, and cycle 58 copies it to
// VCBASE: one raster line has used up a whole character row. Doing this
// on every line crunches one row per line.
//
// Here, on each line L from 50 to 49 + N, $D011 gets YSCROLL = L & 7 on
// cycle 60: inside the window that works, 58 to 62 on PAL and 58 to 64
// on NTSC (measured in VICE by moving the write with :ep and :en). RC is 7 before the first badline of every frame,
// left there by the last row of the previous one, so lines 51 to 50 + N
// each crunch a row, drawn in an invalid mode (ECM and BMM set), which
// shows black. On line 50 + N the loop writes text mode and
// YSCROLL = (51 + N) & 7, so line 51 + N is an ordinary badline that
// fetches row N. Everything below is N rows further on in screen RAM and
// N raster lines lower.
//
// Screen row r holds character r, whose pixel row p is the byte 8r + p,
// so every displayed line says which row and pixel row it came from.
// After the crunch the program finds the first badline by counting loop
// iterations per line and compares it with 51 + N. $02F0 = N,
// $02F1 = 51 + N, $02F2 = the measured line; $02FF is $01 while every
// frame has matched and $02 from the first that did not.

.const NMAX     = 12
.var SPP = cmdLineVars.containsKey("spp") ? cmdLineVars.get("spp").asNumber() : 12
.var SPN = cmdLineVars.containsKey("spn") ? cmdLineVars.get("spn").asNumber() : 14
.const RESULT   = $02ff
.const REC      = $02f0           // N, expected first badline, measured
.const FLAG     = $02e0           // 0 = PAL, 1 = NTSC
.const frame    = $02
.const n        = $03
.const cur      = $04
.const saved    = $05

// Entry delays that put every write on cycle 60, found with a store trace;
// each cycle more or less moves every write one cycle.
.var BLANK = cmdLineVars.containsKey("blank") ? cmdLineVars.get("blank").asNumber() : 1
.var EP = cmdLineVars.containsKey("ep") ? cmdLineVars.get("ep").asNumber() : 41
.var EN = cmdLineVars.containsKey("en") ? cmdLineVars.get("en").asNumber() : 43

BasicUpstart2(start)

.macro Delay(c) {
    .if (c == 1) .error "Delay cannot make 1 cycle"
    .if (c > 0) {
        .if ((c & 1) != 0) { bit $ea }
        .for (var i = 0; i < ((c & 1) != 0 ? c - 3 : c) / 2; i++) { nop }
    }
}

// One write per line, LINE cycles an iteration, N + 1 iterations.
.macro Crunch(LINE, ENTRY) {
    ldx #0
    Delay(ENTRY)
!loop:
    lda tab, x          // 4
    sta $d011           // 4: the write, cycle 60
    inx                 // 2
    cpx n               // 3
    beq !done+          // 2 (3 taken)
    Delay(LINE - 18)
    jmp !loop-          // 3
!done:
}

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    jsr detect_region
    // Screen row r = character r in all 40 cells; white on blue.
    lda #<$0400
    sta cur
    lda #>$0400
    sta saved
    ldx #0
!row:
    ldy #39
    txa
!:  sta (cur), y
    dey
    bpl !-
    lda cur
    clc
    adc #40
    sta cur
    bcc !+
    inc saved
!:  inx
    cpx #25
    bne !row-
    // $07E8-$07FF (the sprite pointers) is drawn once VCBASE passes 1000:
    // character 25, blank, rather than whatever power-on left there.
    ldx #23
    lda #25
!:  sta $07e8, x
    dex
    bpl !-
    ldx #0
    lda #1
!:  sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $dae8, x
    inx
    bne !-
    lda #$18                    // screen $0400, charset $2000
    sta $d018
    lda #6
    sta $d021
    lda #14
    sta $d020
    lda #1
    sta RESULT
    lda #0
    sta frame
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$1b
    sta $d011
    lda #46
    sta $d012
    lda #1
    sta $d01a
    sta $d019
    cli
main:
    inc $c000, x                // long instructions: the double IRQ
    inc $c100, x                // must absorb the entry jitter
    inx
    jmp main

// detect_region: FLAG = 0 (PAL) or 1 (NTSC), as in tech-tech.
detect_region:
!wlo:
    bit $d011
    bmi !wlo-
!whi:
    bit $d011
    bpl !whi-
!track:
    lda $d012
    bit $d011
    bpl !over+
    tax
    jmp !track-
!over:
    lda #0
    cpx #$10
    bcs !+
    lda #1
!:  sta FLAG
    rts

irq1:
    lda #$1b                    // YSCROLL 3: lines 48-50 are not badlines
    sta $d011
    ldx #<irq2p
    ldy #>irq2p
    lda FLAG
    beq !+
    ldx #<irq2n
    ldy #>irq2n
!:  stx $0314
    sty $0315
    lda #48
    sta $d012
    lda #1
    sta $d019
    tsx
    stx saved
    cli
    .for (var i = 0; i < 40; i++) { nop }

// irq2p / irq2n: entered from inside a NOP; the two $D012 reads absorb
// the last cycle of jitter. The pad differs by model: 12 on PAL and 14 on
// NTSC put every frame's write on the same cycle (measured with :spp and
// :spn; the neighbours alternate between two cycles from frame to frame).
irq2p:
    ldx saved
    txs
    Delay(SPP)
    lda $d012
    cmp $d012
    beq !+
!:  jsr setup
    Crunch(63, EP)
    jmp measure
irq2n:
    ldx saved
    txs
    Delay(SPN)
    lda $d012
    cmp $d012
    beq !+
!:  jsr setup
    Crunch(65, EN)
    jmp measure

// setup: this frame's N, and the final write put into tab[N].
setup:
    pla                         // the return address goes under tab[N]
    sta cur
    pla
    tay
    ldx frame
    lda sine, x
    sta n
    tax
    lda tab, x
    pha                         // tab[N], put back after the loop
    lda last, x
    sta tab, x
    inc n                       // N + 1 writes
    tya
    pha
    lda cur
    pha
    rts

// Count 12-cycle loop iterations per line from here (early in line
// 51 + N); the first line with fewer than three had a badline stall.
measure:
    lda $d012
    sta cur
    ldy #16
!line:
    ldx #0
!:  inx
    lda $d012
    cmp cur
    beq !-
    sta cur
    cpx #3
    bcs !+
    lda cur
    sec
    sbc #1
    sta REC + 2
    jmp !found+
!:  dey
    bne !line-
    lda #0
    sta REC + 2
!found:
    pla
    ldx n
    dex
    stx REC
    sta tab, x                  // restore tab[N]
    txa
    clc
    adc #51
    sta REC + 1
    cmp REC + 2
    beq !+
    lda #2
    sta RESULT
!:  inc frame
    lda frame
    and #63
    sta frame
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #46
    sta $d012
    lda #1
    sta $d019
    jmp $ea81

// tab[i]: the crunch write for line 50 + i, invalid mode (ECM, BMM),
// DEN, 25 rows, YSCROLL = (50 + i) & 7. :blank=0 leaves text mode on, to
// show what the crunched lines draw.
tab:
    .fill NMAX + 1, (BLANK != 0 ? $78 : $18) | ((50 + i) & 7)
// last[N]: text mode, YSCROLL = (51 + N) & 7, written on line 50 + N.
last:
    .fill NMAX + 1, $18 | ((51 + i) & 7)
sine:
    .fill 64, round(6 + 6 * sin(toRadians(i * 360 / 64)))

* = $2000
.for (var r = 0; r < 25; r++) {
    .for (var p = 0; p < 8; p++) { .byte r * 8 + p }
}
    .fill 8, 0                  // character 25
```

## Build

```bash
java -jar KickAss.jar linecrunch.asm -o linecrunch.prg
```

The write-cycle sweep, one cycle per step (41 and 43 are the listing's
cycle 60):

```bash
java -jar KickAss.jar linecrunch.asm :ep=N -o linecrunch-epN.prg   # PAL, N 34 to 46
java -jar KickAss.jar linecrunch.asm :en=N -o linecrunch-enN.prg   # NTSC, N 36 to 50
```

The crunched lines left visible:

```bash
java -jar KickAss.jar linecrunch.asm :blank=0 -o linecrunch-noblank.prg
```

`-showmem` reports the code and tables at `$0900` to `$0B7F` and the
charset at `$2000` to `$20CF`. The PRG is 6,353 bytes.

## Expected output

A light blue border. Under the top border, N black raster lines, then the
text rows from row N on, each eight lines of the character-r pattern,
white on blue. The screen is N rows further on in screen RAM and N lines
lower than a normal one. The bottom of the window shows the rows after
24: video-matrix bytes `$07E8`-`$07FF`, which the listing fills with a
blank character because power-on leaves them random in VICE, and then
`$0400` onward again.

Measured in VICE x64sc 3.10 with the pinned command at 8,000,000 cycles,
PAL c64c (8565/8580/8521) and NTSC (`-model ntsc`, 6567R8). Every line
from 51 to 250 was decoded with PIL (all 40 cells, white pixels to a
byte, byte 8r + p to row r and pixel row p) and compared with the model
"lines 51 to 50 + N black; from line 51 + N, row N + k div 8, pixel row
k mod 8":

| Model | N on this frame | First text line | Row on it | Lines matching the model | Mismatches |
|---|---|---|---|---|---|
| PAL | 4 | 55 | 4, pixel row 0 | 172 (lines 51-222; rows past 24 from 223 not modelled) | 0 |
| NTSC | 8 | 59 | 8, pixel row 0 | 144 (lines 51-194; rows past 24 from 195) | 0 |

Checked against N = 3 instead, the PAL picture matches 3 lines and fails
176, so the check tells one N from the next. A store trace of `$D011`
over the whole run put every write of the crunch loop on cycle 60 (store
CYC as printed, Bauer's numbering, `runtime/vice-reference.md`), on all
254 PAL and 286 NTSC frames. A trace of `$02F0`-`$02F2` and `$02FF` read
N, 51 + N and the measured first badline equal on every frame, and
`$02FF` was stored only by the reset and the program's `01`.

Screenshots from these runs: `screenshots/linecrunch.png` (PAL) and
`screenshots/linecrunch-ntsc.png`.

### The crunched lines

With `:blank=0`, PAL: lines 51 to 54 each show cells 0-23 as pixel row 7
of row 2's character and cells 24-39 as pixel row 7 of row 3's; NTSC
lines 51 to 58 show pixel row 7 of rows 5 and 6 the same way. Every
crunched line is pixel row 7 (RC stayed 7), and its characters are the
last row the VIC fetched in the previous frame: the bottom of the PAL
window shows the same split, row 2's character in cells 0-23 and row
3's in 24-39. No c-access happened on a crunched line. The
listing blanks them with ECM and BMM set.

### The write-cycle sweep

`:ep` and `:en` move every write of the loop together, one cycle a
step. 8,000,000 cycles, one run each; the cycle is the store trace's for
the write on line 50, the same on every frame of each run:

| Write cycle | PAL: row on line 55 (N = 4) | NTSC: row on line 59 (N = 8) |
|---|---|---|
| 53 to 55 | 0; one or two cells at the right of line 54 hold fetched data | 1; one to three cells at the right of line 58 hold fetched data |
| 56, 57 | 0 | 1 |
| 58 to 62 | 4 = N: crunched | 8 = N: crunched |
| 63, 64 | (no such cycle; 63 is the last) | 8 = N: crunched |
| The line's last cycle (63 PAL, 65 NTSC; store CYC 0) | 0 | 0 |
| 1, 2 of the next line | 1 | 1 |

The window is 58 to 62 on PAL and 58 to 64 on NTSC: from the VIC's
row-end check on cycle 58 to the line's second-to-last cycle. Why the
NTSC failures show row 1 where PAL shows row 0 was not worked out here. The
self-check read 51 + N in every run of the sweep, including those that
did not crunch, because the final write makes line 51 + N a badline
whatever happened above it: the check proves the timing of the exit, and
the picture proves the crunch.

A first sweep with a separate test program (one write per line on lines
80 to 83, the middle of row 3) gave the same window on both models and
showed what the other cycles do. Writes on 54 to 57 of a row's last line
restart the same row: line 83 showed row 3 pixel row 0 again and row 4
was never drawn (Bauer's "doubled text lines", §3.14.5). On PAL, a
matching YSCROLL written on cycles 15 to 54 starts a late badline instead, whose
missing cells shift the row sideways as in `vsp_glitch`; no row is
crunched.

## Why this works

### Bauer's rules

Christian Bauer's VIC-II article (§3.7.2) gives the rules the effect
uses. In cycle 14 VC is loaded from VCBASE, and RC is reset to 0 only if
the badline condition holds then. In display state VC is incremented
after each of the 40 g-accesses. In cycle 58, if RC is 7, the VIC goes
idle and loads VCBASE from VC; if it is in display state after that
(always, when the badline condition holds), RC is incremented. The
condition is in force whenever YSCROLL equals the line's low three bits.

### One write per line

On a line whose RC is 7, cycle 58 ends the row: VCBASE moves on 40 cells
and the VIC goes idle. The write on cycle 60 makes the condition true
after that check, so the VIC goes back to display state without a cycle
58 to increment RC; RC stays 7. The next line does not match the value,
so cycle 14 does not reset RC and no c-accesses happen. The line is drawn
in display state, pixel row 7 from the character pointers already
latched, and VC advances 40 cells; its cycle 58 finds RC = 7 again and
moves VCBASE on another row. With a write on every line, every line
crunches one row. Bauer's §3.14.4 describes the same state reached the
other way, a badline condition cancelled before cycle 14; the codebase64
article's example writes `$D012 & 7` to YSCROLL once per raster line, the
form used here.

### Where it starts

RC is 7 before line 51 of every frame (the last row of the previous frame
left it there, Bauer §3.14.4), so the first write, on line 50, crunches
line 51. `irq1` writes YSCROLL 3 on line 46 so lines 48 to 50 are not
badlines. The final write, on line 50 + N at the same cycle, sets text
mode and YSCROLL = (51 + N) & 7: it does not match line 50 + N, so that
line is the last crunched one, and line 51 + N is an ordinary badline
that fetches row N from VCBASE = 40N and resets RC. The rows below keep
the new YSCROLL. After row 24 VCBASE runs past 1000 into `$07E8`-`$07FF`
(the sprite pointers) and wraps at 1024 (Bauer §3.14.4), which is the
bottom of the picture.

### The timing

The window is five cycles wide on PAL, so the writes need a stable
raster. The double IRQ is the one in `stable-raster-irq`; its pad before
the two `$D012` reads is 12 on PAL and 14 on NTSC in this listing,
measured: with 11, 13 (PAL) or 12 (NTSC) the write alternated between
two adjacent cycles from frame to frame. The loop is 63 or 65 cycles an
iteration, one per model.
