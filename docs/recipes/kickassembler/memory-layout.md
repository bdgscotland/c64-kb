---
recipe: memory-layout
toolchain: kickassembler
output_format: PRG
region: both
techniques: [cpu_io_port_bank, char_rom_under_vic]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D012, D015, D018, D027]
uses_kernal: [CHROUT]
claims: [vic_char_base (owns), sprite_0 (owns)]
---

<!-- doc-type: recipe -->

# KickAssembler memory layout: stub, music, charset, sprites, screen, code

## Synopsis

One `*=` block per fixed address: BASIC stub at `$0801`, a "music" stub at
`$1000` that increments a counter once per frame, a 2 KB charset at `$2000`
with glyph 0 replaced by a hollow box, one sprite at `$2800`, the screen
left at `$0400`, and code from `$3000`. The program prints the address each
of its own symbols carries, so the screen can be read against `-showmem`.
The planning behind the addresses is on
[memory-layout-planning](../../toolchains/memory-layout-planning.md).

## Source

```asm
// memory-layout.asm
// One block per address the layout reserves. -showmem prints them.
.const SCREEN  = $0400
.const MUSIC   = $1000
.const CHARSET = $2000
.const SPRITES = $2800
.const CODE    = $3000

*=$0801 "BASIC stub"
    BasicUpstart2(start)

// ---- $1000: "music" stub. Called once per frame, bumps a counter.
*=MUSIC "Music"
music_play:
    inc music_frames
    bne !+
    inc music_frames+1
!:  rts
music_frames:
    .word 0

// ---- $2000: charset. Filled at run time from the character ROM,
// then glyph 0 (screen code 0, '@') is replaced. Virtual: reserved in
// the map, not written to the .prg.
*=CHARSET "Charset" virtual
charset:
    .fill 2048, 0

// ---- $2800: one sprite. Pointer value = $2800 / 64 = 160.
*=SPRITES "Sprites"
sprite0:
    .fill 63, $ff
    .byte 0

// ---- $3000: code and data.
*=CODE "Code"
start:
    sei
    // copy the uppercase ROM font ($D000-$D7FF) into RAM at $2000
    lda $01
    pha
    lda #$33            // char ROM visible at $D000, I/O out
    sta $01
    ldx #0
!:  lda $d000,x
    sta charset,x
    lda $d100,x
    sta charset+$100,x
    lda $d200,x
    sta charset+$200,x
    lda $d300,x
    sta charset+$300,x
    lda $d400,x
    sta charset+$400,x
    lda $d500,x
    sta charset+$500,x
    lda $d600,x
    sta charset+$600,x
    lda $d700,x
    sta charset+$700,x
    inx
    bne !-
    pla
    sta $01             // I/O and KERNAL back
    cli

    // replace glyph 0 ('@') with a hollow box
    ldx #7
!:  lda glyph0,x
    sta charset,x
    dex
    bpl !-

    // screen $0400, charset $2000: (SCREEN/$400)<<4 | (CHARSET/$800)<<1
    lda #[(SCREEN / $400) << 4] | [(CHARSET / $800) << 1]
    sta $d018

    // sprite 0 from $2800, yellow, at (280, 180)
    lda #SPRITES / 64
    sta SCREEN + $03f8
    lda #7
    sta $d027
    lda #<280
    sta $d000
    lda #>280
    sta $d010
    lda #180
    sta $d001
    lda #1
    sta $d015

    // print the layout table
    lda #$93            // clear screen
    jsr $ffd2
    ldx #0
!:  lda table,x
    beq loop
    jsr $ffd2
    inx
    bne !-

loop:
    // once per frame: leave line 200, wait for the wrap, call the stub
!:  lda $d012
    cmp #200
    bcc !-
!:  lda $d012
    cmp #200
    bcs !-
    jsr music_play

    // show the counter as four hex digits at row 8, column 8
    lda music_frames+1
    jsr hex2
    lda music_frames
    ldx #10
    jsr hex2x
    jmp loop

hex2:
    ldx #8
hex2x:
    pha
    lsr
    lsr
    lsr
    lsr
    tay
    lda hexdigits,y
    sta SCREEN + 8*40,x
    pla
    and #$0f
    tay
    lda hexdigits,y
    sta SCREEN + 8*40 + 1,x
    rts

glyph0:
    .byte %11111111, %10000001, %10000001, %10000001
    .byte %10000001, %10000001, %10000001, %11111111
.encoding "screencode_upper"
hexdigits:
    .text "0123456789ABCDEF"

.encoding "petscii_upper"
table:
    .text "STUB    $"
    .text toHexString($0801, 4)
    .byte 13
    .text "MUSIC   $"
    .text toHexString(music_play, 4)
    .byte 13
    .text "CHARSET $"
    .text toHexString(charset, 4)
    .byte 13
    .text "SPRITES $"
    .text toHexString(sprite0, 4)
    .byte 13
    .text "SCREEN  $"
    .text toHexString(SCREEN, 4)
    .byte 13
    .text "CODE    $"
    .text toHexString(start, 4)
    .byte 13
    .text "FRAMES  $"
    .byte 13
    .text "@@@@@@@@"
    .byte 13, 0
```

## Build

```bash
java -jar $KICKASS_JAR memory-layout.asm -o memory-layout.prg -symbolfile -showmem
```

`-showmem` prints the memory map (KickAssembler 5.25):

```
Memory Map
----------
Default-segment:
  $0801-$0800 BASIC stub
  $0801-$080d Basic
  $080e-$080d Basic End
  $1000-$100a Music
  *$2000-$27ff Charset
  $2800-$283f Sprites
  $3000-$313b Code
```

The `*` marks the virtual block. The PRG is 10,557 bytes and loads
`$0801`-`$313B`: the file is contiguous, so the gaps between blocks,
including the virtual charset, are zero-filled.

## Expected output

Run with the pinned command (`-limitcycles 8000000`, PAL, and again with
`-model ntsc`); the pictures are
`screenshots/memory-layout.png` and `screenshots/memory-layout-ntsc.png`.
Measured with PIL on both:

- Rows 0-6 from column 0 read `STUB    $0801`, `MUSIC   $1000`,
  `CHARSET $2000`, `SPRITES $2800`, `SCREEN  $0400`, `CODE    $3000`,
  `FRAMES  $`. Each address equals the `-showmem` block start above.
- Row 7, columns 0-7: eight cells of the replaced glyph 0. Each 8x8 cell
  is a hollow box: all eight pixels of the top and bottom pixel rows in
  ink, the six middle rows ink only at the left and right edge, six
  background pixels between. On PAL the first cell is at PNG (32, 91), on
  NTSC at (32, 79).
- Row 8, columns 8-11: the frame counter in hex. At 8,000,000 cycles it
  read `00FA` on PAL and `0119` on NTSC (one run each; `verify:recipes`
  is what holds it fixed, with `+autostart-delay-random`).
- The sprite: a 24x21 block of 504 yellow pixels at PNG x 288-311, y
  165-185 on PAL (RGB 255,255,70) and y 153-173 on NTSC (RGB 255,248,141).
  That is sprite X 280 and Y 180: sprite X 24 lines up with text column
  0 at PNG x 32, so X 280 is PNG x 280 + 8 = 288; the top row of a
  sprite at Y 180 is on raster line 181, which is PNG y 181 - 16 = 165
  on PAL and 181 - 28 = 153 on NTSC. Measured on these PNGs (rung 1);
  [vice-reference](../../runtime/vice-reference.md) gives the text-row
  geometry only.
- Border (115,133,255) and background (44,61,236) on PAL; (98,145,251)
  and (25,73,180) on NTSC. The text colour was not measured.

## Why this works

`virtual` on the charset block reserves `$2000`-`$27FF` in the map
without emitting bytes; the program fills it at run time by banking the
character ROM in (`$01` = `$33` keeps BASIC and the KERNAL but replaces
the I/O window with the ROM, so interrupts are masked first: the KERNAL's
IRQ handler acknowledges CIA1, which is no longer there), copying 2 KB
from `$D000`, and banking back. Glyph 0 is then overwritten, and `$D018` =
`$18` points the VIC at screen `$0400` and charset `$2000`. The `@` row is
printed through CHROUT: PETSCII `$40` is screen code 0, the glyph that
was replaced.

Two encodings matter. `hexdigits` is written under
`.encoding "screencode_upper"` because it is stored straight into screen
memory; under the default `screencode_mixed`, `A`-`F` assemble to
`$41`-`$46`, which the upper-case font shows as graphics (the first build
printed `00-♠`). The `table` is written under `petscii_upper` because it
goes through CHROUT. `toHexString(symbol, 4)` bakes each label's assembled
address into the text at assembly time, so the screen shows what the
assembler believed, and the map shows the same numbers.

The frame loop waits until `$D012` passes line 200 and then until it
wraps, which fires once per frame on both PAL (312 lines) and NTSC (263
lines), and calls the stub at `$1000`. The counter's low byte is written
as two screen codes at row 8, column 10, and its high byte at column 8.
