---
recipe: high-score-insert
toolchain: kickassembler
output_format: PRG
region: both
techniques: [high_score_table_insert]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — High-score table insert: rank, shift, write, checked byte for byte

## Synopsis

A five-row high-score table of six-digit BCD scores with three-letter
names, and the routine that puts a new score into it at the right
place. Four compiled-in scores go in one after another: one that ranks
first, one that ties an existing row, one that does not qualify, and
one that ranks last. After each the table is printed with the rank
found and the cycles the insert took on the CIA2 timers. At the end
the table is compared byte for byte with a compiled-in expected table:
`$02FF = $01` and a green border when they match, `$02` and red
otherwise. The technique is `high_score_table_insert` in
`techniques/text.md`. It exists because a generated game put every
new entry in row 0 whatever its score; this is the check
`front_end_and_attract` in `game-design/game-structure.md` asks for,
"the table re-sorted", run on its own.

The tie rule is stated in the code and tested by the second insert: a
score equal to a row's score goes below that row. The holder keeps
the rank; only a strictly higher score displaces one.

## Source

```asm
// high-score-insert.asm
// A five-row high-score table of six-digit BCD scores with three-letter
// names, and the insert: find the rank by comparing BCD bytes from the
// most significant, shift the lower rows down one place with a bounded
// loop, drop the last row, write the new row. Four compiled-in scores
// are inserted in turn: one that ranks first, one that ties an existing
// row, one that does not qualify, one that ranks last. The table is
// printed after each insert with the rank found and the cycles the
// insert took on the CIA2 timers. At the end the table is compared
// byte for byte with a compiled-in expected table: $02FF = $01 and a
// green border when they match, $02 and red otherwise.
//
// Tie rule: a new score equal to a row's score goes below that row.
// The earlier holder keeps the rank; only a strictly higher score
// displaces one. No SED anywhere: CMP is the same in either mode.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN    = $0400
.const RESULT    = $02ff         // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const ROWS      = 5
.const ROWLEN    = 6             // three name screen codes, three BCD bytes
.const TABLEN    = ROWS * ROWLEN // 30
.const LASTOFF   = TABLEN - ROWLEN
.const NSEQ      = 4             // scores inserted in turn
.const LINE      = 40

.const src = $fb                 // zero-page pointer: string or entry source
.const dst = $fd                 // zero-page pointer: screen destination

// ---------------------------------------------------------------- insert
// hs_rank: X = table offset of the first row the new score beats, or
// X = TABLEN when it beats none. Compares the three BCD bytes from the
// most significant; the first byte that differs decides. Three equal
// bytes mean the row keeps its place and the search goes on.
hs_rank:
    ldx #0
!row:
    lda newrow+3
    cmp table+3,x
    bne !decide+
    lda newrow+4
    cmp table+4,x
    bne !decide+
    lda newrow+5
    cmp table+5,x
    beq !next+                   // equal on all three: the holder stays above
!decide:
    bcs !found+                  // Z clear and C set: the new score is higher
!next:
    txa
    clc
    adc #ROWLEN
    tax
    cpx #TABLEN
    bne !row-
!found:
    rts

// hs_place: shift every row from offset rank downward one place and
// write newrow at rank. The loop runs from the last row up to rank and
// stops on equal or below, so a rank that is not a row boundary cannot
// run it past the table's start.
hs_place:
    ldx #LASTOFF
!shift:
    cpx rank
    beq !write+
    bcc !write+
    .for (var i = 0; i < ROWLEN; i++) {
        lda table - ROWLEN + i,x
        sta table + i,x
    }
    txa
    sec
    sbc #ROWLEN
    tax
    jmp !shift-
!write:
    ldx rank
    ldy #0
!:  lda newrow,y
    sta table,x
    inx
    iny
    cpy #ROWLEN
    bne !-
    rts

// hs_insert: rank, then place if the score qualifies. rank = TABLEN
// means it did not. A game splits the two calls: hs_rank before the
// name entry, so the player sees where the score will go, hs_place
// after it, with the typed name in newrow.
hs_insert:
    jsr hs_rank
    stx rank
    cpx #TABLEN
    bcs !+
    jsr hs_place
!:  rts

nothing:
    rts

// ---------------------------------------------------------------- timing
// Time(routine, slot): CIA2 timer A counts phi2, timer B counts A
// underflows; the 24-bit count lands in slot. Run under SEI with the
// screen blanked so no badline lands inside the measurement.
.macro Time(routine, slot) {
    lda #$51
    sta $dd0f
    lda #$11
    sta $dd0e
    jsr routine
    lda #$00
    sta $dd0e
    sta $dd0f
    sec                          // the routine may leave C in either state
    lda #$ff
    sbc $dd04
    sta slot
    lda #$ff
    sbc $dd05
    sta slot+1
    lda #$ff
    sbc $dd06
    sta slot+2
}

// ---------------------------------------------------------------- main
start:
    sei
    ldx #0
    lda #$20
!:  sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $300,x
    inx
    bne !-

    lda #<SCREEN
    sta dst
    lda #>SCREEN
    sta dst+1
    ldy #0
    lda #<title
    sta src
    lda #>title
    sta src+1
    jsr print_str

    lda $d011                    // DEN clear, then wait for the raster to
    and #$ef                     // wrap, so the frames measured have no
    sta $d011                    // badlines
!:  lda $d011
    bpl !-
!:  lda $d011
    bmi !-

    lda #$00
    sta $dd0e
    sta $dd0f
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07

    Time(nothing, base)          // cost of the harness and an empty call

    lda #0
    sta seq
    lda #<(SCREEN + LINE)
    sta dst
    lda #>(SCREEN + LINE)
    sta dst+1

seq_loop:
    lda seq                      // newrow = sequence[seq], six bytes
    asl
    adc seq                      // seq * 3, carry clear after asl of 0..3
    asl                          // seq * 6
    tax
    ldy #0
!:  lda sequence,x
    sta newrow,y
    inx
    iny
    cpy #ROWLEN
    bne !-

    Time(hs_insert, cyc)

    sec                          // cyc = cyc - base, 16 bits
    lda cyc
    sbc base
    sta cyc
    lda cyc+1
    sbc base+1
    sta cyc+1

    ldy #0                       // header: entry, rank, cycles
    lda #<newrow
    sta src
    lda #>newrow
    sta src+1
    jsr print_entry
    lda #<rank_txt
    sta src
    lda #>rank_txt
    sta src+1
    jsr print_str
    jsr print_rank
    lda #<cyc_txt
    sta src
    lda #>cyc_txt
    sta src+1
    jsr print_str
    jsr print_cycles
    jsr next_line

    ldx #0                       // five table rows, numbered
    stx row
!table:
    ldy #0
    lda row
    clc
    adc #$31                     // screen code of the digit 1 + row
    sta (dst),y
    iny
    lda #$20
    sta (dst),y
    iny
    lda row
    asl
    adc row
    asl
    clc
    adc #<table
    sta src
    lda #>table
    adc #0
    sta src+1
    jsr print_entry
    jsr next_line
    inc row
    lda row
    cmp #ROWS
    bne !table-

    inc seq
    lda seq
    cmp #NSEQ
    beq !+
    jmp seq_loop
!:
    lda $d011
    ora #$10
    sta $d011

    ldx #TABLEN - 1              // verdict: the table against expect
!:  lda table,x
    cmp expect,x
    bne fail
    dex
    bpl !-

    lda #CODE_PASS
    sta RESULT
    lda #5
    sta BORDER
    lda #<pass_txt
    sta src
    lda #>pass_txt
    sta src+1
    jmp verdict
fail:
    lda #CODE_FAIL
    sta RESULT
    lda #2
    sta BORDER
    lda #<fail_txt
    sta src
    lda #>fail_txt
    sta src+1
verdict:
    lda #<(SCREEN + 20)
    sta dst
    lda #>(SCREEN + 20)
    sta dst+1
    ldy #0
    jsr print_str
    jmp *

// ---------------------------------------------------------------- print
// All output is screen codes written straight into screen RAM.

// print_str: zero-terminated screen-code string at src to (dst),y.
print_str:
    ldx #0
!:  lda (src,x)
    beq !+
    sta (dst),y
    iny
    inc src
    bne !-
    inc src+1
    bne !-
!:  rts

// print_entry: name (three screen codes), a space, six BCD digits,
// a space, from the six-byte entry at src.
print_entry:
    ldx #0                       // X stays 0: (src,x) reads through src
    stx cnt
!:  lda (src,x)
    sta (dst),y
    iny
    jsr next_src
    inc cnt
    lda cnt
    cmp #3
    bne !-
    lda #$20
    sta (dst),y
    iny
    stx cnt
!:  lda (src,x)
    pha
    lsr
    lsr
    lsr
    lsr
    ora #$30
    sta (dst),y
    iny
    pla
    and #$0f
    ora #$30
    sta (dst),y
    iny
    jsr next_src
    inc cnt
    lda cnt
    cmp #3
    bne !-
    lda #$20
    sta (dst),y
    iny
    rts

// next_src: src += 1.
next_src:
    inc src
    bne !+
    inc src+1
!:  rts

// print_rank: the rank as a digit 1 to ROWS, or a dash for none.
print_rank:
    lda rank
    cmp #TABLEN
    bcs !none+
    ldx #0
!:  cmp #ROWLEN                  // rank offset / ROWLEN, plus one
    bcc !+
    sbc #ROWLEN
    inx
    bne !-
!:  txa
    clc
    adc #$31
    sta (dst),y
    iny
    rts
!none:
    lda #$2d                     // the dash
    sta (dst),y
    iny
    rts

// print_cycles: cyc (16 bits) as five decimal digits, by subtracting
// powers of ten.
print_cycles:
    ldx #0
!digit:
    lda #$2f                     // one below the digit 0; the loop adds 1
    sta digit
!sub:
    inc digit
    sec
    lda cyc
    sbc pow10_lo,x
    pha
    lda cyc+1
    sbc pow10_hi,x
    bcc !stop+
    sta cyc+1
    pla
    sta cyc
    jmp !sub-
!stop:
    pla
    lda digit
    sta (dst),y
    iny
    inx
    cpx #5
    bne !digit-
    rts

// next_line: dst += 40.
next_line:
    clc
    lda dst
    adc #LINE
    sta dst
    bcc !+
    inc dst+1
!:  rts

// ---------------------------------------------------------------- data
pow10_lo: .byte <10000, <1000, <100, <10, <1
pow10_hi: .byte >10000, >1000, >100, >10, >1

title:    .text "HIGH SCORE INSERT"
          .byte 0
rank_txt: .text "RANK "
          .byte 0
cyc_txt:  .text " CYC "
          .byte 0
pass_txt: .text "PASS"
          .byte 0
fail_txt: .text "FAIL"
          .byte 0

// The table: three name screen codes, three BCD bytes, most
// significant first. Seeded so a first run never shows a blank table.
table:
    .text "AAA"
    .byte $05, $00, $00
    .text "BBB"
    .byte $04, $00, $00
    .text "CCC"
    .byte $03, $00, $00
    .text "DDD"
    .byte $02, $00, $00
    .text "EEE"
    .byte $01, $00, $00

// The scores inserted, in order.
sequence:
    .text "NEW"                  // ranks first: decided on the third byte
    .byte $05, $00, $01
    .text "TIE"                  // equals BBB: goes below it, rank 4
    .byte $04, $00, $00
    .text "NIL"                  // below the last row: not entered
    .byte $00, $50, $00
    .text "LOW"                  // ranks last: beats CCC on the second byte
    .byte $03, $50, $00

// The table the sequence must produce.
expect:
    .text "NEW"
    .byte $05, $00, $01
    .text "AAA"
    .byte $05, $00, $00
    .text "BBB"
    .byte $04, $00, $00
    .text "TIE"
    .byte $04, $00, $00
    .text "LOW"
    .byte $03, $50, $00

newrow:   .fill ROWLEN, 0
rank:     .byte 0
seq:      .byte 0
row:      .byte 0
digit:    .byte 0
cnt:      .byte 0
base:     .byte 0, 0, 0
cyc:      .byte 0, 0, 0
```

## Build

```bash
java -jar KickAss.jar high-score-insert.asm -o high-score-insert.prg
```

Produces `high-score-insert.prg`, `$0801` to `$0B7D`.

## Expected output

Border green, text area the power-on blue, the screen cleared by the
program before it prints, so the BASIC banner is gone:

```
HIGH SCORE INSERT   PASS
NEW 050001 RANK 1 CYC 00481
1 NEW 050001
2 AAA 050000
3 BBB 040000
4 CCC 030000
5 DDD 020000
TIE 040000 RANK 4 CYC 00339
1 NEW 050001
2 AAA 050000
3 BBB 040000
4 TIE 040000
5 CCC 030000
NIL 005000 RANK - CYC 00152
1 NEW 050001
2 AAA 050000
3 BBB 040000
4 TIE 040000
5 CCC 030000
LOW 035000 RANK 5 CYC 00284
1 NEW 050001
2 AAA 050000
3 BBB 040000
4 TIE 040000
5 LOW 035000
```

Each block is one insert: the new entry, the rank it was given (`-`
for not entered), the cycles the call took, then the table after it.
The seeded table was `AAA 050000` down to `EEE 010000` in steps of
ten thousand.

- `NEW 050001` beats `AAA 050000` on the third BCD byte alone, so it
  ranks first; every row moves down one and `EEE` falls off.
- `TIE 040000` equals `BBB`. The three-byte compare finds them equal,
  the search goes on, and `CCC 030000` is the first row it beats, so
  `TIE` lands at rank 4 below `BBB`.
- `NIL 005000` beats nothing. Rank `-`, the table is untouched.
- `LOW 035000` beats only `CCC`, the last row, so it ranks 5. The
  shift loop runs zero times and the write overwrites `CCC`.

Screenshots from the pinned run, 4,000,000 cycles:
`screenshots/high-score-insert.png` (PAL) and
`screenshots/high-score-insert-ntsc.png` (NTSC). Both decoded against
the character ROM give the text above; border pixel (2, 100) =
(98, 213, 50) on PAL and (114, 189, 103) on NTSC, index 5 in both
palettes of `runtime/vice-reference.md`. The pinned command was run
twice per model and the two PNGs were identical bytes. The `CYC`
figures are the same on both models: the inserts run under `SEI` with
the screen blanked, so no badline lands in a measurement.

### The cycle figures

Measured in VICE x64sc 3.10 with the CIA2 cascade, less an empty call
timed the same way, so each figure is the routine's own instructions
without the `JSR` and `RTS` of the call:

| Insert | Rank | Compares | Rows shifted | Cycles |
|---|---|---|---|---|
| `NEW 050001` | 1 | one row, three bytes deep | 4 | 481 |
| `TIE 040000` | 4 | four rows, one three bytes deep | 1 | 339 |
| `NIL 005000` | none | five rows, one byte each | 0 | 152 |
| `LOW 035000` | 5 | five rows, the last two bytes deep | 0 | 284 |

The first insert is the worst case for this table: the compare on row
0 goes all three bytes deep and the shift moves four rows. Arithmetic
from the instruction table gives the same 481: the rank search 41, a
shifted row 73 (the bounded-loop test 8, six `LDA abs,X` / `STA abs,X`
pairs 54, the step and jump 11) four times, the loop's final test 7,
the write 113, `hs_place`'s entry and return 8, and 20 in `hs_insert`
between the calls. The same arithmetic gives 339, 152 and 284 for the
other three, and no branch in the two routines crosses a page. A
longer table scales by 73 cycles a shifted row plus 26 a row compared
and rejected on its first byte.

## Why this works

**The compare.** A BCD byte holds two decimal digits and its binary
value orders the same way its digits do (`$50` is above `$49` in
both readings), so `CMP` orders BCD bytes correctly with no decimal
mode. `hs_rank` compares the most significant byte first; the first
byte that differs decides, and `BCS` after a `BNE` means the new score
is strictly higher. When all three bytes are equal the `BEQ` skips the
`BCS` and the search moves on, which is the tie rule: the holder stays
above. The result is the row offset in `X`, or `TABLEN` for none, and
that is also the qualification test: a score that beats no row does
not enter.

**The shift.** `hs_place` starts at the last row and copies the row
above it down, stepping up by one row until `X` reaches the rank. The
test is `CPX rank` followed by `BEQ` and `BCC`, so the loop stops on
equal and on below; a `rank` that is not a multiple of six, or a
caller that passes garbage, cannot walk the copy below the table's
first row. Copying downward from the bottom is what makes an in-place
shift safe: each row is read before it is overwritten. The last row
is never read as a source, so it is dropped by construction. The
write then copies the six bytes of `newrow` to the rank's offset.

**The split.** `hs_rank` and `hs_place` are separate calls with
`rank` kept between them, because a game wants the rank before the
player types a name (to show "you placed 3rd" and to skip the name
entry when the score does not qualify) and the shift and write after
it, with the typed name in `newrow`. `hs_insert` runs both back to
back for the measurement.

**The verdict.** The expected table is thirty bytes assembled from the
same layout, compared with `CMP abs,X` from the end. A wrong rank, a
shift that stops one row early, or a tie put above its holder changes
at least one byte, and a byte that differs sets `$02FF` to `$02` and
the border red.

**A fault found while writing it.** The first build passed the
verdict and drew garbage: `print_entry` used `LDA (src,X)` with `X`
as its byte counter, and indexed-indirect adds `X` to the zero-page
address before the pointer is read, so it read through `$FC`, `$FD`
and `$FE` in turn. The counter now lives in memory and `X` stays
zero. A verdict on the table bytes cannot see the screen, which is
why the screenshot is measured as well.
