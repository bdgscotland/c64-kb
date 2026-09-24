---
recipe: clock-slide
toolchain: kickassembler
output_format: PRG
region: both
techniques: [clock_slide_raster_irq]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, DC04, DC05, DC0D, DC0E, DD0D]
uses_kernal: [CHROUT]
claims: [irq_vector_fffe (owns), nmi_vector_fffa (owns), cia1_timer_a (owns), cia1_timer_b (init), cia1_tod (init), cia2_timer_a (init), cia2_timer_b (init), cia2_tod (init), vic_raster_irq (owns), zero_page $02-$04+$FB-$FE (owns)]
harness: [$02FF]
---

<!-- doc-type: recipe -->

# KickAssembler — Stable raster interrupt by clock slide: one IRQ, a CIA timer and a branch into `$A9` bytes

## Synopsis

A raster interrupt made cycle-exact with one interrupt instead of two.
CIA1 timer A runs with the period of a raster line, started once on a
known cycle, so its value tells the handler how late it was entered.
The handler turns that into a branch offset and branches into a slide
of `$A9` bytes, which waits one cycle less for each cycle of lateness.
Seven interrupts a frame, on lines 30 to 48 of the top border, turn the
border red on entry and white after the slide. Over 2,000 interrupts
the handler records how late each entry was and what the timer read
after the slide; the program prints how many different values of each
it saw. `$02FF` = `$01` and a green frame when the slide left exactly
one timer value; `$02FF` = `$02` and a red frame otherwise.

## Source

```asm
// clock-slide.asm
// A stable raster interrupt from one IRQ: CIA1 timer A runs with the
// period of a raster line, started once on a known cycle; the handler
// reads it, and the reading says how late the interrupt was entered.
// A branch into a slide of $A9 bytes then waits that many cycles less.
//
// Nine interrupts a frame, on lines 30 to 46 of the top border, each
// turn the border red on entry (the edge moves with the jitter) and
// white after the slide (the edge must not move). Over 2,000
// interrupts the handler records which lateness it saw and which timer
// value it read after the slide; the main program prints how many
// different values of each there were. Pass: one timer value after the
// slide, from five or more lateness values. Verdict at $02FF ($01
// pass, $02 fail) and in the frame colour: green or red on the lines
// the bars do not use.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN    = $0400
.const RESULT    = $02ff
.const NSAMP     = 2000          // interrupts to record before the verdict
.const FIRSTL    = 30            // first interrupt line; then every third
.const LASTL     = 48            // line up to this one
.const RED       = 2
.const WHITE     = 1
.const SYNCL     = $40           // line the start-up sync begins on

.const za  = $02                 // A saved by the handler
.const zx  = $03
.const zy  = $04
.const p1  = $fb                 // text pointers
.const p2  = $fd

// Delay(n): exactly n cycles of straight code, n >= 2
.macro Delay(n) {
    .if (n < 2) .error "Delay needs 2 or more cycles"
    .if ((n & 1) != 0) {
        bit $ea                  // 3 cycles
        .for (var i = 0; i < (n - 3) / 2; i++) { nop }
    } else {
        .for (var i = 0; i < n / 2; i++) { nop }
    }
}

// ---------------------------------------------------------------- handler
// Entered through $FFFE with the KERNAL banked out. Everything from the
// entry to the slide's end is one page, so no branch pays a crossing.
.align $100
irq:
    sta za                       // 3
    lda #RED                     // 2
    sta $d020                    // 4: the unsynced edge
    lda #0                       // 2: patched with V0 for the region
v0imm:
    sec                          // 2
    sbc $dc04                    // 4: j = V0 - timer, how late the entry was
    and #$07                     // 2
    sta slide+1                  // 4
slide:
    bpl slide+2                  // 3: branch over j bytes of the slide
    .byte $a9, $a9, $a9, $a9, $a9, $a9, $a9
    .byte $24, $ea               // 10 - j cycles from slide+2 to here
synced:
    lda #WHITE                   // 2
    sta $d020                    // 4: the synced edge
    lda $dc04                    // 4: the same value on every entry
    sta vpost
    lda frame                    // back to the frame colour
    sta $d020
irq_end:
.errorif (irq >> 8) != ((irq_end - 1) >> 8), "the handler's slide crosses a page"
    lda #1                       // acknowledge, and arm the next line
    sta $d019                    // before it starts
    lda nextl
    clc
    adc #3
    cmp #LASTL + 1
    bcc !+
    lda #FIRSTL
!:  sta nextl
    sta $d012
    stx zx
    sty zy
    ldx slide+1                  // j
    lda #1
    sta seen_j,x
    ldx vpost
    sta seen_v,x
    clc                          // count += 1 in the same number of
    lda count                    // cycles every time, so the next entry's
    adc #1                       // lateness depends only on the main loop
    sta count
    lda count+1
    adc #0
    sta count+1
    ldy zy
    ldx zx
    lda za
nmi:
    rti

.label V0IMM = v0imm - 1

// ---------------------------------------------------------------- start-up sync
// SyncLoop(n): X counts the line the next $D012 read should see. Each
// pass is 11 + n cycles, one more than a line, so the read moves one
// cycle later in the line per pass. The first read that sees the next
// line was made on that line's first cycle; the code after it runs on
// a known cycle, and starts the timer there.
.macro SyncLoop(n) {
    ldx #SYNCL
!:  cpx $d012                    // wait for line SYNCL
    bne !-
loop:
    cpx $d012                    // 4, read on its last cycle
    bne found                    // 2, 3 taken
    inx                          // 2
    Delay(n)
    jmp loop                     // 3
found:
    lda #$11                     // force load, continuous, start
    sta $dc0e
    rts
}

.align $100
sync_pal:   SyncLoop(64 - 11)    // PAL: 63 cycles a line
sync_ntsc:  SyncLoop(66 - 11)    // NTSC: 65 cycles a line
sync_end:
.errorif (sync_pal >> 8) != ((sync_end - 1) >> 8), "the sync loops cross a page"

// ---------------------------------------------------------------- printing
.macro PutStr(addr, str) {
    lda #<addr
    sta p2
    lda #>addr
    sta p2+1
    lda #<text
    sta p1
    lda #>text
    sta p1+1
    jsr puts
    jmp done
text:
    .text str
    .byte 0
done:
}

puts:
    ldy #0
!:  lda (p1),y
    beq !+
    sta (p2),y
    iny
    bne !-
!:  rts

.macro At(addr) {
    lda #<addr
    sta p2
    lda #>addr
    sta p2+1
}

hex2:                            // A = byte, two hex digits at (p2)
    pha
    lsr
    lsr
    lsr
    lsr
    jsr hexdigit
    ldy #0
    sta (p2),y
    pla
    and #$0f
    jsr hexdigit
    ldy #1
    sta (p2),y
    rts

hexdigit:
    cmp #10
    bcc !+
    sbc #9                       // 10..15 -> screen codes 1..6, "A".."F"
    rts
!:  ora #$30
    rts

// scan: over the 256 flags at (p1): n = how many are set, lo and hi the
// first and last set index
scan:
    lda #0
    sta n
    sta hi
    lda #$ff
    sta lo
    ldy #0
!:  lda (p1),y
    beq !+
    inc n
    sty hi
    cpy lo
    bcs !+
    sty lo
!:  iny
    bne !--
    rts

// ---------------------------------------------------------------- main
start:
    lda #$93                     // clear the screen through CHROUT
    jsr $ffd2
    sei
    lda #$7f                     // no CIA interrupts
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #0
    ldx #0
!:  sta seen_j,x
    sta seen_v,x
    inx
    bne !-
    sta count
    sta count+1
    lda #14
    sta frame

    // region: the highest line number past 255 is 55 on PAL, 6 on NTSC
!:  bit $d011
    bpl !-
    lda #0
    sta maxl
!:  lda $d012
    cmp maxl
    bcc !+
    sta maxl
!:  bit $d011
    bmi !--
    lda maxl
    cmp #8
    lda #0
    rol
    sta pal                      // 1 on PAL

    // timer A period = one line: latch 62 on PAL, 64 on NTSC
    lda #0
    sta $dc0e
    ldx pal
    lda latch,x
    sta $dc04
    lda #0
    sta $dc05
    lda v0,x                     // the handler's V0 for this region
    sta V0IMM

    // blank the display so no badline lands in the sync loop; DEN is
    // sampled on line $30, so wait for two frame tops
    lda $d011
    and #$ef
    sta $d011
!:  bit $d011
    bpl !-
!:  bit $d011
    bmi !-
!:  bit $d011
    bpl !-
!:  bit $d011
    bmi !-
    lda pal
    beq !+
    jsr sync_pal
    jmp !++
!:  jsr sync_ntsc
!:

    // KERNAL out, the handler on $FFFE, raster interrupt on FIRSTL
    lda #$35
    sta $01
    lda #<irq
    sta $fffe
    lda #>irq
    sta $ffff
    lda #<nmi
    sta $fffa
    lda #>nmi
    sta $fffb
    lda #FIRSTL
    sta nextl
    sta $d012
    lda $d011
    and #$7f                     // line < 256
    ora #$10                     // display on
    sta $d011
    lda #1
    sta $d01a
    sta $d019
    cli

    // wait for NSAMP interrupts, in a loop of mixed lengths so that the
    // interrupt finds the CPU in every phase of a 2- to 7-cycle
    // instruction. A delay of 0 to 15 passes, picked by an LFSR, moves
    // the loop's phase against the raster on every pass.
wait:
    lsr s_hi                     // 16-bit Galois LFSR step
    ror s_lo
    bcc !+
    lda s_hi
    eor #$b4
    sta s_hi
!:  lda s_lo
    and #$0f
    tax
!:  dex                          // 5 cycles a pass
    bpl !-
    ldx #0
    inc spare,x                  // 7
    nop                          // 2
    ror spare+1                  // 6
    bit za                       // 3
    lda spare+2                  // 4
    lda count+1
    cmp #>NSAMP
    bcc wait
    lda count
    cmp #<NSAMP
    bcc wait

    // -------- results
    PutStr(SCREEN, "CLOCK SLIDE: ONE IRQ, CIA1 TIMER A")
    lda pal
    beq !+
    PutStr(SCREEN + 1*40, "PAL, 63 CYCLES A LINE")
    jmp !++
!:  PutStr(SCREEN + 1*40, "NTSC, 65 CYCLES A LINE")
!:  PutStr(SCREEN + 3*40, "INTERRUPTS RECORDED  2000")
    lda #<seen_j
    sta p1
    lda #>seen_j
    sta p1+1
    jsr scan
    lda n
    sta n_j
    PutStr(SCREEN + 4*40, "ENTRY LATENESS J     VALUES,    TO")
    At(SCREEN + 4*40 + 18)
    lda n
    jsr hex2
    At(SCREEN + 4*40 + 29)
    lda lo
    jsr hex2
    At(SCREEN + 4*40 + 35)
    lda hi
    jsr hex2
    lda #<seen_v
    sta p1
    lda #>seen_v
    sta p1+1
    jsr scan
    lda n
    sta n_v
    PutStr(SCREEN + 5*40, "TIMER AFTER SLIDE    VALUES,    TO")
    At(SCREEN + 5*40 + 18)
    lda n
    jsr hex2
    At(SCREEN + 5*40 + 29)
    lda lo
    jsr hex2
    At(SCREEN + 5*40 + 35)
    lda hi
    jsr hex2

    lda n_v                      // pass: one value after the slide, from
    cmp #1                       // entries spread over five or more
    bne fail                     // lateness values
    lda n_j
    cmp #5
    bcc fail
    lda #1
    sta RESULT
    lda #5
    sta $d020
    sta frame
    PutStr(SCREEN + 7*40, "RESULT 01 PASS")
    jmp spin
fail:
    lda #2
    sta RESULT
    sta $d020
    sta frame
    PutStr(SCREEN + 7*40, "RESULT 02 FAIL")

    // From here the main loop is one JMP, so after the first interrupt
    // every entry, and the picture, is the same from run to run.
spin:
    jmp spin

// ---------------------------------------------------------------- data
latch:  .byte 64, 62             // NTSC, PAL
v0:     .byte $33, $31           // NTSC, PAL: measured, see the recipe page
pal:    .byte 0
maxl:   .byte 0
nextl:  .byte 0
vpost:  .byte 0
count:  .word 0
n:      .byte 0
lo:     .byte 0
hi:     .byte 0
n_j:    .byte 0
n_v:    .byte 0
frame:  .byte 0
spare:  .fill 3, 0
s_lo:   .byte $e1
s_hi:   .byte $ac
.align $100
seen_j: .fill 256, 0
seen_v: .fill 256, 0
```

## Build

```bash
java -jar KickAss.jar clock-slide.asm -o clock-slide.prg
```

## Expected output

Frame green; seven one-line bars in the top border, red from the
handler's first store and white from the first store after the slide;
the text reads, on PAL:

```
CLOCK SLIDE: ONE IRQ, CIA1 TIMER A
PAL, 63 CYCLES A LINE

INTERRUPTS RECORDED  2000
ENTRY LATENESS J  07 VALUES, 00 TO 06
TIMER AFTER SLIDE 01 VALUES, 14 TO 14

RESULT 01 PASS
```

and on NTSC the same with `NTSC, 65 CYCLES A LINE` and the timer value
`16 TO 16`. The numbers are hex.

Screenshots from the pinned run, 12,000,000 cycles:
`screenshots/clock-slide.png` (PAL) and
`screenshots/clock-slide-ntsc.png` (NTSC). The text decodes against the
character ROM to the lines above. Frame pixel (2, 100) = (98, 213, 50)
on PAL and (114, 189, 103) on NTSC, index 5 in both palettes of
`runtime/vice-reference.md`. A run stopped at 8,000,000 cycles had
recorded about 1,750 interrupts and printed nothing yet; VICE's
autostart spends over two million cycles before the program runs.

The bars were measured in both screenshots with a script, row by row
over raster lines 30 to 48 (PAL row = line - 16, NTSC row = line - 28):

| Line | PAL red from x | PAL white from x | NTSC red from x | NTSC white from x |
|---|---|---|---|---|
| 30 | 49 | 305 | 41 | 305 |
| 33 | 57 | 305 | 57 | 305 |
| 36 | 57 | 305 | 57 | 305 |
| 39 | 57 | 305 | 57 | 305 |
| 42 | 57 | 305 | 57 | 305 |
| 45 | 57 | 305 | 57 | 305 |
| 48 | 57 | 305 | 57 | 305 |

The red edge moves by whole cycles, eight pixels each, with the
lateness; the white edge sits on x = 305 on every bar of both models.
By the time of the screenshot the main loop is a single `JMP`, so the
entries differ by at most the phase of that one instruction, and the
picture is the same from run to run: four runs each with a random
autostart delay gave identical PNGs on PAL, three on NTSC. The lateness
recorded while the waiting loop ran is the measure of the jitter.

Two things in the listing keep that picture fixed. The waiting loop
moves its phase against the raster on every pass with a delay picked
by an LFSR, so the 2,000 recorded entries cover every lateness the
loop's instructions allow. And the handler's own length does not
vary: its count of entries is a 16-bit add, not `INC` with a branch,
which took five cycles more on every 256th entry and shifted the
following entry by a cycle in one of four runs of an earlier build.

`ENTRY LATENESS J` is `V0` minus the timer value read in the handler's
sixth instruction, over 2,000 entries: seven values, 0 to 6, on both
models. `TIMER AFTER SLIDE`
is the timer read by the first load after the slide: one value on every
entry, `$14` on PAL and `$16` on NTSC. The two reads are `29 - j`
cycles apart, as the instruction table gives: `$31 - j - $14` on PAL
and `$33 - j - $16` on NTSC.

`V0`, the timer value of the earliest entry, was found by measurement:
a build with `V0 = $40` recorded the raw differences, and the largest
timer value seen was `$31` on PAL and `$33` on NTSC (rung 1, VICE
x64sc 3.10). With `V0` one too small the earliest entry reads -1,
which the `AND #$07` makes 7, and gets the shortest wait; one too large
and the latest reads 8, made 0, and gets the longest. Either way the
timer after the slide would show two values and the program would fail
(rung 3, not run).

## Why this works

### The timer as a clock of the line

With a latch of 62 on PAL and 64 on NTSC, timer A counts 63 or 65
cycles and reloads: one raster line, so the value it holds on a given
cycle of a line is the same on every line of every frame. It is started
once, with interrupts off and the display blanked, by a loop whose
passes are one cycle longer than a line: each pass reads `$D012` one
cycle later in the line, and the first read that sees the next line was
made on that line's first cycle. The store that starts the timer then
runs on a known cycle.

### From lateness to a branch

The interrupt is taken when the current instruction ends, so the
handler starts a varying number of cycles into the line. Its timer read
comes that many cycles later too, and the timer counts down, so
`V0 - timer` is the lateness `j`. `j` is stored as the offset of a
`BPL`, which skips `j` bytes of the slide:

```
$A9 $A9 $A9 $A9 $A9 $A9 $A9 $24 $EA
```

Entered at an even distance before `$24`, the bytes run as `LDA #$A9`
pairs and then `BIT $EA`; at an odd distance, as `LDA #$A9` pairs,
`LDA #$24` and `NOP`. Either way `n` bytes before the `$24` take
`n + 3` cycles, so skipping `j` bytes waits `10 - j`, and every entry
reaches the store after the slide on the same cycle. `A` and the flags
are changed; `$EA` is only read.

### What it costs and what it needs

The handler takes 3 + 2 + 4 + 2 + 2 + 4 + 2 + 4 + 3 + (10 - j) =
36 - j cycles from its first instruction to the end of the slide. With
the first instruction on cycle `10 + j` of the line (KERNAL out, the
`stable_raster_irq` table), the slide ends on cycle 46 of the
interrupt's own line (rung 3). The double IRQ of `stable-raster-irq.md`,
entered through `$0314`, measured 185 to 190 cycles over three lines to
its synced point. The price here is a CIA timer running for good, and
a start-up sync with the display blanked. Every byte from
the handler's first instruction to the end of the slide is in one page,
checked by `.errorif`, because a `BPL` taken into the next page costs
a cycle more (`pitfalls/cpu.md`, `branch_page_cross_extra_cycle`).

The seven values 0 to 6 agree with the `stable_raster_irq` table,
whose KERNAL-out entries start on cycles 10 to 16. The slide has room
for one more: an earlier build of this program, whose waiting loop had
no LFSR delay, recorded lateness 0 to 7 with one value in between
never seen, on both models. Why that loop reached 7 was not isolated.
