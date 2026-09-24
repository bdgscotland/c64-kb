---
recipe: scroll-panel-split
toolchain: kickassembler
output_format: PRG
region: both
techniques: [scroll_panel_split, soft_scroll_v, char_scroll_buffer_v, ram_under_kernal]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, DC0D, DD0D]
uses_kernal: []
claims: [cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init)]
---

<!-- doc-type: recipe -->

# KickAssembler — Vertically scrolling playfield over a fixed score panel

## Synopsis

A playfield scrolls up one pixel a frame through all eight YSCROLL phases
above a panel of five character rows that does not move. The panel starts on
raster line 215 with YSCROLL 7, so the playfield ends on line 214 at every
phase. A split IRQ polls for line 214, waits a delay read from a table indexed
by the playfield's YSCROLL, and switches `$D016`, `$D011` and `$D018` in that
line's right border; `$D021` follows one line later. The table has one short
entry, for YSCROLL 6, the phase at which line 214 is a badline. This is the
`scroll_panel_split` technique; set `USE_TABLE` to 0 to see the one-phase
glitch it prevents (pitfall `scroll_phase_breaks_panel_split`).
The KERNAL is banked out and the IRQs go through `$FFFE`, which is
`ram_under_kernal` (`docs/techniques/memory-banking.md`). An earlier
version's `techniques:` omitted it; the `scripts/claims-watch.ts` store
trace found the `$FFFE` writes (#35).

## Source

```asm
// scroll-panel-split.asm: a playfield that scrolls up one pixel a frame
// through all eight YSCROLL phases, over a five-row panel (row 24 is cut by
// the bottom border) that stays still. The panel starts on line 215 with
// YSCROLL 7, so the playfield ends on line 214 at every phase. The split IRQ
// polls for line 214, burns a delay read from a table indexed by the
// playfield's YSCROLL, and writes the panel's $D011, $D018 and $D016 in the
// right border of line 214; $D021 follows in the right border of line 215,
// after the panel's first badline.
// Build: java -jar KickAss.jar scroll-panel-split.asm -o scroll-panel-split.prg

BasicUpstart2(start)

.const USE_TABLE   = 1       // 0: one fixed delay for every phase (the naive split)
.const FREEZE      = -1      // 0-7 holds YSCROLL at that phase; -1 scrolls

.const SCREEN      = $0400   // playfield matrix
.const PANEL       = $0c00   // panel matrix
.const COLRAM      = $d800
.const PF_ROWS     = 21      // rows 0-20 scroll; row 20 shows 7-YSCROLL lines
.const PANEL_ROW   = 20      // first badline of the panel fetches row 20
.const LAST_PF     = 214     // last playfield line at every phase
.const SPLIT_IRQ   = 212     // split IRQ fires here and polls for LAST_PF
.const BOTTOM_IRQ  = 252     // after the bottom border has closed on line 251
.const PF_D011     = $10     // DEN, RSEL=0 (24 rows), YSCROLL added per frame
.const PANEL_D011  = $1f     // DEN, RSEL=1, YSCROLL=7: panel badlines 215, 223, 231, 239, 247
.const PF_D018     = $15     // screen $0400, ROM charset
.const PANEL_D018  = $35     // screen $0C00, ROM charset
.const PF_D016     = $c0     // 38 columns, XSCROLL 0
.const PANEL_D016  = $c8     // 40 columns, XSCROLL 0
.const PF_BG       = 6       // blue
.const FG          = 14      // light blue: playfield chars and panel row 20
.const PANEL_BG    = 11      // dark grey
.const PANEL_FG    = 1       // white: panel rows 21-24

* = $0810
start:
        sei
        lda #$35                // RAM under KERNAL, I/O in: IRQs use $FFFE
        sta $01
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda $dd0d
        lda #0
        sta $d020
        sta $3fff               // idle-state byte, in case a line goes idle
        sta rowcount

        ldx #0                  // colour RAM: light blue everywhere,
colfill:                        // then white for panel rows 21-24
        lda #FG
        sta COLRAM,x
        sta COLRAM+$100,x
        sta COLRAM+$200,x
        sta COLRAM+$300,x
        inx
        bne colfill
        ldx #199
panelfill:
        lda panel_text,x
        sta PANEL+PANEL_ROW*40,x
        cpx #40
        bcc panelnext           // row 20 shares colour RAM with the playfield
        lda #PANEL_FG
        sta COLRAM+PANEL_ROW*40,x
panelnext:
        dex
        cpx #$ff
        bne panelfill

        lda #PF_ROWS            // fill the playfield by scrolling 21 rows in
        sta initcount
initloop:
        jsr shift_rows
        dec initcount
        bne initloop

        lda #7
        sta yscroll
        lda #<bottom_irq
        sta $fffe
        lda #>bottom_irq
        sta $ffff
        lda #BOTTOM_IRQ
        sta $d012
        lda #PF_D011|7          // bit 7 clear: raster compare below 256
        sta $d011
        lda #1
        sta $d01a
        sta $d019
        cli
        jmp *

// Once a frame, below the panel: playfield registers, scroll step, next split.
bottom_irq:
        pha
        txa
        pha
        tya
        pha
        lda #PF_BG
        sta $d021
        lda #PF_D016            // whole-register store: bit 5 (reset) clear, MCM
        sta $d016               // (bit 4) clear and CSEL (bit 3) clear on purpose
        lda #PF_D018
        sta $d018
.if (FREEZE >= 0) {
        lda #FREEZE
        sta yscroll
} else {
        dec yscroll             // content moves up one line
        bpl nocarry
        lda #7                  // carry: rows move up one, YSCROLL back to 7
        sta yscroll
        ora #PF_D011            // the new phase must be in $D011 before line 48;
        sta $d011               // the row shift below runs until about line 130
        jsr shift_rows
nocarry:
}
        lda yscroll
        ora #PF_D011
        sta $d011
        lda #SPLIT_IRQ
        sta $d012
        lda #<split_irq
        sta $fffe
        lda #>split_irq
        sta $ffff
        lda #1
        sta $d019
        pla
        tay
        pla
        tax
        pla
        rti

// Split: poll for line 214, wait delay_tbl[YSCROLL], then switch to the panel.
// When YSCROLL is 6, line 214 is a badline and the VIC has already held the
// CPU for 40 cycles, so the table entry for 6 is short.
split_irq:
        pha
        txa
        pha
        tya
        pha
        ldx yscroll
        lda delay_tbl,x
        sta count
        ldx #PANEL_D018         // load everything before the poll, so that
        ldy #PANEL_D016         // after a badline stall only the stores remain
        lda #LAST_PF-1
waitline:
        cmp $d012               // until $D012 > 213: never waits a whole frame
        bcs waitline
        lda #PANEL_D011
delay:
        dec count               // absolute: 9 cycles a pass, 8 on the way out
        bpl delay
        sty $d016               // between line 214's last pixel and 215's first
        sta $d011               // before cycle 12 of line 215, the panel's badline
        stx $d018               // before that badline's first screen fetch
        lda #LAST_PF
waitpanel:
        cmp $d012               // until $D012 > 214
        bcs waitpanel
        nop                     // reads across cycle 12 of line 215: the panel's
        nop                     // own badline holds the CPU until cycle 55, which
        nop                     // removes the poll jitter at every phase
        nop
        lda #PANEL_BG
        sta $d021               // right border of line 215: the panel is grey from 216
        lda #BOTTOM_IRQ
        sta $d012
        lda #<bottom_irq
        sta $fffe
        lda #>bottom_irq
        sta $ffff
        lda #1
        sta $d019
        pla
        tay
        pla
        tax
        pla
        rti

// Rows 1-20 move to 0-19, row by row from the top, which stays ahead of the
// beam; then a new row 20 is drawn from rowcount.
shift_rows:
.for (var r = 0; r < PF_ROWS - 1; r++) {
        ldx #39
!:      lda SCREEN+(r+1)*40,x
        sta SCREEN+r*40,x
        dex
        bpl !-
}
        ldx #39
newrow:
        txa
        clc
        adc rowcount
        and #7
        bne letter
        lda #$a0                // reverse space: a solid block every 8 columns
        bne put
letter:
        lda rowcount
        and #15
        clc
        adc #1                  // screen codes 1-16: A-P
put:
        sta SCREEN+(PF_ROWS-1)*40,x
        dex
        bpl newrow
        inc rowcount
        rts

// Delay passes per playfield YSCROLL (dec abs/bpl: 9 cycles a pass).
delay_tbl:
.if (USE_TABLE != 0) {
        .byte 5, 5, 5, 5, 5, 5, 0, 5
} else {
        .byte 5, 5, 5, 5, 5, 5, 5, 5
}

yscroll:   .byte 0
count:     .byte 0
rowcount:  .byte 0
initcount: .byte 0

// Panel rows 20-24 (screen codes). Row 20 is a rule in the playfield's colour.
panel_text:
        .fill 40, $40
        .text "  score 004250          hi 012900       "
        .text "                                        "
        .text "  lives 3    stage 2    time 173        "
        .text "                                        "
panel_end:
.assert "panel is five rows", panel_end - panel_text, 200
```

## Build

```bash
java -jar KickAss.jar scroll-panel-split.asm -o scroll-panel-split.prg
```

The PRG is 758 bytes, loaded at $0801-$0AF4.

## Expected output

Black border. Above: a blue playfield of light-blue letter rows with a solid
block every eighth column, 38 columns wide, moving up one line a frame. Below:
a dark-grey panel, 40 columns wide, whose first row is a light-blue rule
(lines 218-219) and whose white text rows read `SCORE 004250  HI 012900` and
`LIVES 3  STAGE 2  TIME 173`. The panel never moves.

Measured in VICE x64sc 3.10 from the exit PNG with PIL (`-limitcycles
8000000`, `scripts/verify-recipes.ts` settings), raster line = PNG row + 16 on
PAL and + 28 on NTSC:

| Line | PAL and NTSC |
|---|---|
| 55 | first playfield line (RSEL=0 top border) |
| 214 | last playfield line: blue, x 39-342 (38 columns) |
| 215 | first panel line: x 32-351 (40 columns), still blue background |
| 216-250 | dark grey background, panel characters |
| 251 | bottom border |

The panel region, lines 215-250, is pixel-identical to the same region with
the scroll frozen at YSCROLL 3, on both models.

### Per-phase measurement

Each row below is two builds with `FREEZE` set to that phase: one with the
table as listed, one with `USE_TABLE = 0`, where every phase gets the delay
of 5. Each was run for 8,000,000 cycles on PAL and on NTSC (`-model ntsc`),
and lines 215-250 were compared pixel by pixel with the table build at
YSCROLL 3.

| YSCROLL | Line 214 a badline? | Fixed delay (naive) | Table |
|---|---|---|---|
| 0 | no | panel identical | panel identical |
| 1 | no | panel identical | panel identical |
| 2 | no | panel identical | panel identical |
| 3 | no | panel identical | panel identical |
| 4 | no | panel identical | panel identical |
| 5 | no (213 is) | panel identical | panel identical |
| 6 | yes | lines 215-221 differ (1,108 pixels PAL, 1,107 NTSC) | panel identical |
| 7 | no | panel identical | panel identical |

In the naive YSCROLL 6 picture (PIL, both models), line 215 spans x 39-351
on blue: its left edge is still 38 columns, so `$D016` changed mid-line.
Lines 216-221 are 40 columns (x 32-351) on the panel's grey, with light-blue
character pixels where the rule should be; the reference has the rule only as
solid light blue on lines 218-219. Line 222 on is identical to the reference.
Only line 215 shows the playfield width. The writes come about 40 cycles late,
inside line 215, so the panel's badline starts late.

The delay of 5 passes was found by trying values at YSCROLL 3: on both models
4 and 5 are clean, 3 or less writes `$D016` before line 214's right border
(line 214 grows to x 351), and 6 misses the start of line 215 (lines 215-222
differ on PAL, 215-219 on NTSC). At 4, NTSC YSCROLL 5 also widened line
214, so 5 is the value that is clean at all eight phases on both models. At YSCROLL 6 the entry is 0.

## Why this works

**The panel's first badline sits on a line where YSCROLL would be 7.** The VIC
re-reads screen memory for a row from the start of that row until the row has
shown all eight lines. A playfield row cut short by the panel's badline is
fetched again, so the panel's first row comes from the screen row after the
last complete playfield row. With the panel's first line at 48 + 8k + 7, every
YSCROLL phase leaves exactly k complete rows, here 20. An earlier draft of this
recipe put the panel on line 216 with YSCROLL 0: at YSCROLL 3 the panel showed
screen row 20, at YSCROLL 0 row 21 (both measured). Row 20 of the playfield,
lines 208+YSCROLL to 214, is fetched from the playfield matrix at `$0400`; the
panel's row 20, from line 215, from `$0C00` through `$D018`. Both use colour
RAM row 20, so the rule row is in the playfield's character colour.

**Line 214 is a badline only when YSCROLL is 6.** Then the VIC holds the CPU
from cycle 12 to cycle 54 while the split code is waiting in its delay loop,
and a full delay puts the writes into line 215. The table gives that phase no
delay: the stall itself is the wait. c64gameframework's panel table,
8, 8, 8, 8, 8, 5, 0, 8 (`aligneddata.s` line 71, read, not run here), polls
line 229 and runs its delay on line 230, which is 6 mod 8, and its entry for
6 is also 0; its shorter entry for phase 5 matches the finding above that
phase 5 is the sensitive one at 4 passes on NTSC.

Every register value is loaded before the poll, so after the stall only the three stores remain; with the loads after
the poll, NTSC's two extra cycles a line pushed `$D016` past line 215's left
border. The poll uses `bcs`, not `bne`, so a late entry cannot wait a whole
frame.

**`$D021` waits for the panel's own badline.** After the stores the handler
polls for line 215 and executes reads across cycle 12 of that line. Line 215
is always a badline now, so the CPU is always released at cycle 55, and the
colour store lands in the right border of line 215 at every phase and on both
models, with no jitter. The panel's grey starts on line 216; line 215 is the
blank top line of the rule row.

**The bottom IRQ runs on line 252.** RSEL goes back to 0 for the playfield
there. Clearing it on line 251, before the border is set at the end of that
line, would leave the lower border open. The row shift runs row by row from
the top at 560 cycles, about nine lines, a row (arithmetic), which stays
ahead of the beam's eight. On a carry frame the new YSCROLL goes into `$D011`
before the shift starts: an earlier draft wrote it after, and the PAL exit
shot showed the display window opening on line 51 instead of 55 because the
write only landed near line 130. Nine consecutive PAL frames from 8,000,000
cycles, one of them a carry frame, all open on line 55 and leave the panel
pixel-identical.
