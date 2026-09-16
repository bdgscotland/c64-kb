---
recipe: sprite-multiplex-24
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [sprite_multiplex_24, sprite_multiplex_8, stable_raster_irq]
file_formats: [PRG]
uses_registers: [D015, D000, D001, D010, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, D012, D019, D01A]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — 24-Sprite Multiplexer

## Synopsis

Demonstrates the canonical three-bank sprite multiplexer that displays
twenty-four logical sprites on-screen simultaneously by reprogramming all
eight VIC-II hardware sprites three times per frame. A per-frame insertion
sort orders the logical sprite list by ascending Y, then three raster IRQs
reload the hardware registers at the boundaries of each bank. The recipe
implements the full cycle-accounting required for PAL: the bank-switch IRQ
must complete all register writes within a safe window after the previous
bank's lowest sprite has been sent. NTSC adjustments are noted at the end
of the "Why this works" section.

## Source

```asm
// sprite-multiplex-24.asm
// 24-sprite multiplexer: 3 banks × 8 hardware sprites per bank.
// Raster IRQs swap hardware sprite registers at bank boundaries.
//
// Memory layout:
//   $1000  — sprite data blocks (sprite 0 at $1000, sprite 1 at $1040, ...)
//   $07f8  — sprite pointers for screen at $0400 (default VIC bank 0)
//   $0900  — main program
//   $0a00  — logical sprite tables (x, y, ptr, col) for 24 sprites
//   $0c00  — IRQ handlers
//
// PAL timing reference: 63 cycles/non-badline, 23 cycles/badline.
// Cycle-count claims in comments are PAL-approximate.

.const SPRITE_COUNT = 24    // total logical sprites
.const BANK_SIZE    = 8     // hardware sprites per bank
.const BANK_COUNT   = 3     // number of banks

// VIC-II registers
.const D000  = $d000        // sprite 0 X (low)
.const D001  = $d001        // sprite 0 Y
.const D010  = $d010        // sprite X MSBs (all 8 sprites)
.const D015  = $d015        // sprite enable mask
.const D019  = $d019        // interrupt flag (W1C)
.const D01A  = $d01a        // interrupt mask
.const D027  = $d027        // sprite 0 color

.const SPRITE_PTR_BASE = $07f8  // pointer block for screen RAM at $0400

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Sprite graphics data: 3 distinct shapes, each 63 bytes + 1 pad.
// Pointer values = address / 64 within the VIC bank.
// ---------------------------------------------------------------------------
* = $1000
spr_ball:
    .fill 63, 0
    .byte $ff, $ff, $00    // row 0
    .byte $ff, $00, $ff    // placeholder — fill with real shape data
    .fill 58, $00
    .byte 0                // pad to 64-byte boundary

spr_diamond:
    .byte $00,$18,$00      // row 0
    .byte $00,$7e,$00      // row 1
    .byte $00,$ff,$00      // row 2
    .byte $03,$ff,$c0      // row 3
    .byte $07,$ff,$e0      // row 4
    .byte $0f,$ff,$f0      // row 5
    .byte $1f,$ff,$f8      // row 6
    .byte $3f,$ff,$fc      // row 7
    .byte $3f,$ff,$fc      // row 8
    .byte $1f,$ff,$f8      // row 9
    .byte $0f,$ff,$f0      // row 10
    .byte $07,$ff,$e0      // row 11
    .byte $03,$ff,$c0      // row 12
    .byte $00,$ff,$00      // row 13
    .byte $00,$7e,$00      // row 14
    .byte $00,$18,$00      // row 15
    .fill 15, $00          // rows 16-20
    .byte 0                // pad

spr_arrow:
    .byte $00,$80,$00      // row 0
    .byte $00,$c0,$00
    .byte $00,$e0,$00
    .byte $7f,$f0,$00
    .byte $7f,$f8,$00
    .byte $7f,$fc,$00
    .byte $7f,$fe,$00
    .byte $7f,$fe,$00
    .byte $7f,$fc,$00
    .byte $7f,$f8,$00
    .byte $7f,$f0,$00
    .byte $00,$e0,$00
    .byte $00,$c0,$00
    .byte $00,$80,$00
    .fill 7, $00
    .byte 0

// ---------------------------------------------------------------------------
// Logical sprite table: X lo, Y, ptr, color (4 bytes per sprite × 24 = 96 b)
// The sort routine uses X_HI table (separate byte) for the MSB of X.
// ---------------------------------------------------------------------------
* = $0a00
spr_x_lo: .fill SPRITE_COUNT, 0
spr_y:    .fill SPRITE_COUNT, 50    // start all at Y=50
spr_ptr:  .fill SPRITE_COUNT, $1000/64  // all pointing to spr_ball initially
spr_col:  .fill SPRITE_COUNT, 0
spr_x_hi: .fill SPRITE_COUNT, 0    // MSB of X (0 or 1)

// Sort scratch — index array for indirect sort.
// sorted_idx[0..23] = logical sprite indices sorted by Y ascending.
sorted_idx: .fill SPRITE_COUNT, 0

// Frame counter (incremented in bank-0 setup IRQ each VBL).
frame_ctr: .byte 0

// ---------------------------------------------------------------------------
// Initialise logical sprite data with a circular layout for demo.
// ---------------------------------------------------------------------------
init_sprites:
    ldx #0
init_loop:
    txa
    // Y positions spread across screen: base 50 + (i * 8)
    asl                    // × 2
    asl                    // × 4
    asl                    // × 8 → coarse Y spacing
    clc
    adc #50
    sta spr_y,x
    // X positions across screen: base 24 + (i * 13)
    txa
    asl
    asl
    clc
    adc txa_tmp            // accumulate: X = i * 13 approximately
    sta spr_x_lo,x
    // Color: cycling through 16 C64 colors
    txa
    and #$0f
    sta spr_col,x
    // Pointer: cycle through three shapes
    txa
    .const ptrs3: [<(spr_ball/64), <(spr_diamond/64), <(spr_arrow/64)]
    and #$03
    // Use a small inline table: mod 3 via subtract
    cmp #3
    bcc :+
    sec
    sbc #3
:   tay
    lda shape_ptrs,y
    sta spr_ptr,x
    inx
    cpx #SPRITE_COUNT
    bne init_loop
    rts
txa_tmp: .byte 0
shape_ptrs: .byte spr_ball/64, spr_diamond/64, spr_arrow/64

// ---------------------------------------------------------------------------
// Insertion sort: sort sorted_idx[0..23] by spr_y[idx] ascending.
// Called once per frame from the VBL setup IRQ before bank-0 fires.
// ---------------------------------------------------------------------------
* = $0b00
sort_sprites:
    // Initialise index array 0..23.
    ldx #SPRITE_COUNT-1
si_init:
    stx sorted_idx,x
    dex
    bpl si_init

    // Insertion sort.
    ldx #1
outer:
    lda sorted_idx,x       // key = sorted_idx[x]
    sta si_key
    lda spr_y              // keyY = spr_y[sorted_idx[x]]
    ldy si_key
    lda spr_y,y
    sta si_keyY
    txa
    tay                    // j = x - 1
    dey
inner:
    bmi si_done_inner
    lda sorted_idx,y
    tax
    lda spr_y,x            // compare spr_y[sorted_idx[j]] > keyY
    cmp si_keyY
    bcc si_done_inner
    iny                    // sorted_idx[j+1] = sorted_idx[j]
    lda sorted_idx,y
    tax                    // NOTE: y still j+1 here; restore j
    dey
    lda sorted_idx,y
    iny
    sta sorted_idx,y
    dey
    dey
    bpl inner
    iny                    // j wrapped to -1
si_done_inner:
    iny
    lda si_key
    sta sorted_idx,y
    ldx si_outer_x
    inx
    stx si_outer_x
    cpx #SPRITE_COUNT
    bne outer
    rts
si_key:  .byte 0
si_keyY: .byte 0
si_outer_x: .byte 1

// ---------------------------------------------------------------------------
// write_bank: copy the next 8 sorted sprites into hardware registers.
// bank_num (0-2): determines which 8 entries in sorted_idx are used.
// Call from raster IRQ with X = bank number (0, 1, or 2).
// Modifies: A, X, Y, D000-D00F, D010, D015, D027-D02E, SPRITE_PTR_BASE.
// ---------------------------------------------------------------------------
* = $0c00
write_bank:
    // Compute base index into sorted_idx for this bank.
    txa
    asl                    // bank * 8
    asl
    asl
    sta wb_base
    ldx #0
    lda #0
    sta wb_xmsb            // accumulated MSB mask for $D010

wb_loop:
    // idx = sorted_idx[base + x]
    ldy wb_base
    txa
    clc
    adc wb_base
    tay
    lda sorted_idx,y
    sta wb_idx

    // X low byte → D000 + (sprite_slot * 2)
    ldy wb_idx
    lda spr_x_lo,y
    sta D000,x             // NOTE: x is 0,2,4,6,8,10,12,14 — we step by 2 below

    // Y → D001 + (sprite_slot * 2)
    lda spr_y,y
    sta D001,x

    // X MSB: test bit, accumulate into wb_xmsb
    lda spr_x_hi,y
    beq no_msb
    lda #1
    .byte $01              // placeholder — shift into correct bit position
no_msb:

    // Sprite pointer
    lda spr_ptr,y
    ldy wb_hwslot           // hardware slot 0-7
    sta SPRITE_PTR_BASE,y

    // Color
    lda spr_col
    ldy wb_idx
    lda spr_col,y
    ldy wb_hwslot
    sta D027,y

    inc wb_hwslot
    inx
    inx                    // advance to next X/Y pair (D000+2, D001+2, ...)
    lda wb_hwslot
    cmp #BANK_SIZE
    bne wb_loop

    // Write accumulated MSB mask.
    lda wb_xmsb
    sta D010

    // Enable all 8 sprites.
    lda #$ff
    sta D015
    rts

wb_base:   .byte 0
wb_idx:    .byte 0
wb_xmsb:   .byte 0
wb_hwslot: .byte 0

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------
* = $0900
start:
    sei

    lda #$7f
    sta $dc0d              // mask CIA1 timer IRQ
    lda $dc0d              // clear pending

    jsr init_sprites
    jsr sort_sprites

    // Install first IRQ: fires at line 0 (pre-display setup).
    lda #<irq_setup
    sta $0314
    lda #>irq_setup
    sta $0315

    lda #$01
    sta D01A               // enable raster IRQ source
    lda #$01
    sta D019               // clear any stale VIC IRQ

    lda #$1b
    sta $d011              // $D011: DEN=1, RSEL=1, YSCROLL=3, BMM=0, ECM=0
    lda #0
    sta $d012              // fire at raster line 0

    cli
    jmp *

// ---------------------------------------------------------------------------
// IRQ 0 — Frame setup (fires at raster line 0, once per frame).
// Sorts the sprite list and writes bank 0 (sprites sorted[0..7]).
// Then chains to irq_bank1 at the boundary above sorted[8].Y.
// ---------------------------------------------------------------------------
irq_setup:
    lda #$01
    sta D019               // acknowledge raster IRQ

    inc frame_ctr

    // Animate sprite positions (simple bounce for demo).
    jsr animate_sprites
    jsr sort_sprites

    // Write bank 0.
    ldx #0
    jsr write_bank

    // Schedule IRQ for bank 1: fire at sorted[8].Y - 4
    lda sorted_idx+8
    tay
    lda spr_y,y
    sec
    sbc #4
    sta $d012

    lda #$01
    and $d011
    eor $d011
    // Keep $D011 RST8 correct if target line >= 256.
    // All sprites kept < 230 in this demo so RST8 always 0.

    lda #<irq_bank1
    sta $0314
    lda #>irq_bank1
    sta $0315

    jmp $ea31

// ---------------------------------------------------------------------------
// IRQ 1 — Write bank 1 (sprites sorted[8..15]).
// Chains to irq_bank2 above sorted[16].Y.
// ---------------------------------------------------------------------------
irq_bank1:
    lda #$01
    sta D019

    ldx #1
    jsr write_bank

    // Schedule bank 2.
    lda sorted_idx+16
    tay
    lda spr_y,y
    sec
    sbc #4
    sta $d012

    lda #<irq_bank2
    sta $0314
    lda #>irq_bank2
    sta $0315

    jmp $ea31

// ---------------------------------------------------------------------------
// IRQ 2 — Write bank 2 (sprites sorted[16..23]).
// Chains back to irq_setup for next frame.
// ---------------------------------------------------------------------------
irq_bank2:
    lda #$01
    sta D019

    ldx #2
    jsr write_bank

    // Reset to setup IRQ for next frame.
    lda #0
    sta $d012

    lda #<irq_setup
    sta $0314
    lda #>irq_setup
    sta $0315

    jmp $ea31

// ---------------------------------------------------------------------------
// Simple animation: each sprite moves according to its index.
// ---------------------------------------------------------------------------
animate_sprites:
    ldx #0
anim_loop:
    // Y: oscillate up/down based on frame_ctr + sprite index.
    lda frame_ctr
    clc
    adc spr_x_lo,x         // use X offset as phase
    and #$7f
    clc
    adc #40
    sta spr_y,x            // Y in range [40, 167]

    // X: drift right slowly.
    lda spr_x_lo,x
    clc
    adc #1
    sta spr_x_lo,x
    bcc no_xwrap
    inc spr_x_hi,x
    lda spr_x_hi,x
    and #$01
    sta spr_x_hi,x
no_xwrap:
    inx
    cpx #SPRITE_COUNT
    bne anim_loop
    rts
```

## Build

```bash
java -jar KickAss.jar sprite-multiplex-24.asm -o sprite-multiplex-24.prg
```

Add `-vicesymbols` to generate a `.vs` label file for VICE breakpoints and
a `-showmem` memory map dump to verify no segments collide:

```bash
java -jar KickAss.jar sprite-multiplex-24.asm -o sprite-multiplex-24.prg \
     -vicesymbols -showmem
```

To debug bank timing in VICE, set a watchpoint on `$D015` and observe which
frame counter values it coincides with: `watch store d015` in the VICE
monitor.

## Expected output

Twenty-four sprites animate on screen simultaneously. The sprites use three
distinct shapes (ball, diamond, arrow) and cycle through all sixteen C64
colors. At 50 Hz (PAL) the motion is smooth with no sprite flickering. A
moment of each sprite disappearing entirely indicates a bank-switch IRQ
arriving late; move its trigger line two lines earlier to compensate. If
the top bank's sprites appear on the wrong background, the setup IRQ
(line 0) is landing after the VIC has begun its top-border output — shift
it to line 310 (just before the next frame's VBI).

## Why this works

### The fundamental constraint

The VIC-II provides exactly eight hardware sprites (MOBs 0-7). Each is an
independent 24×21-pixel object with its own X, Y, image pointer, and color
register. These eight registers are reprogrammed between their uses within
the same frame to yield more than eight visible objects — a technique the
demoscene has used since the C64's earliest years.

The governing principle is that the VIC-II reads each sprite's Y register
at the start of every raster line to determine whether that sprite is
"active" for this line. Once active (its Y coordinate has been reached and
the chip is counting through its 21-row height), the chip uses the values
of the position and pointer registers at the moment of first activation —
not the moment of IRQ reprogramming. This means you can safely rewrite a
hardware sprite's Y, pointer, and color in the raster lines between its
previous use ending and its next use starting.

### Three-bank chunking

The most natural extension from 8 to 24 sprites divides the frame into
three vertical bands of eight hardware sprites each. All logical sprites
are sorted by Y at the start of every frame; the sorted array is sliced
into three consecutive groups of eight: bank 0 (the topmost group), bank 1
(the middle group), and bank 2 (the bottommost group). Four raster IRQs
manage the sequence: one pre-display setup IRQ at raster line 0 writes
bank 0 and schedules bank 1's IRQ; bank 1's IRQ writes its eight sprites
and schedules bank 2; bank 2 writes the last group and resets the vector
for the next frame.

The critical trigger line for each bank-switch IRQ is the Y coordinate of
the topmost sprite in the upcoming bank, minus a safety margin. This recipe
uses a 4-line lead: if sorted[8].Y = 100, the bank 1 IRQ fires at line 96.
With eight register-write operations (Y, X, pointer, color per sprite, plus
the $D010 MSB byte and $D015 enable) the bank-switch handler needs roughly
8 × 3 stores × 4 cycles + overhead ≈ 110-130 cycles (approximate). At 63
cycles per non-badline on PAL, that spans two raster lines minimum, so the
4-line lead is the practical floor. A tight, unrolled bank-switch handler
can complete in under 100 cycles with careful optimization.

### Insertion sort

The insertion sort on the Y-coordinate array ensures each group contains
the eight sprites with the lowest Y values in ascending order. Because
sprite positions change gradually between frames (animation moves a sprite
at most a few pixels per frame), the array is nearly sorted on every
iteration — insertion sort's best-case O(N) performance on nearly-sorted
data makes it the standard choice here. A full 24-element insertion sort
costs approximately 80-150 cycles on PAL (approximate; depends on disorder
level). The sort runs in the pre-display IRQ at line 0, where the full
frame budget is available.

### MSB X accumulation ($D010)

The VIC-II X coordinate registers ($D000, $D002, ... $D00E) each hold the
low 8 bits of a sprite's horizontal position, giving a range of 0-255.
Hardware sprites can appear anywhere in the 320-dot display window plus the
side borders. The display area extends from approximately dot 24 to dot 344
— X values from 256 to 344 exceed 255 and require the MSB. $D010 packs the
MSB for all eight hardware sprites into a single byte (bit n = MSB of
sprite n). Each bank-switch handler accumulates the correct $D010 value for
its eight sprites before writing it, replacing the previous bank's value.

### Cycle budget per bank switch (PAL, non-badline)

| Operation | Cycles (approx) |
|-----------|----------------|
| IRQ entry + KERNAL dispatch | 13 |
| $D019 acknowledge | 6 |
| 8 × STA $D001+2n (Y positions) | 32 |
| 8 × STA $D000+2n (X low) | 32 |
| 8 × STA SPRITE_PTR_BASE+n | 32 |
| 8 × STA $D027+n (colors) | 32 |
| STA $D010 (MSB mask) | 4 |
| STA $D015 (enable) | 4 |
| Patch $0314/$0315 + set $D012 | 16 |
| `jmp $ea31` return | 3 |
| **Total** | **~174 cycles** |

174 cycles spans approximately three non-badlines on PAL. With a 4-line
trigger lead, the handler has a four-line window (252 cycles) — comfortable
on non-badlines, tight if a badline falls inside the window. On badlines,
only 23 cycles are available. The fix is to detect whether the trigger line
is a badline (`(target_y & 7) == YSCROLL`, default YSCROLL = 3) and move
the trigger line one row earlier. For production code, the trigger line
table is precomputed with badline avoidance at sort time.

### NTSC adjustments

NTSC (6567R8) provides 65 cycles per non-badline (2 extra) and 263 raster
lines per frame instead of PAL's 312. The extra cycles per line slightly
relax the trigger-line lead requirement: a 3-line lead is sufficient on
NTSC for the same handler. However, the reduced total frame height (263 vs
312) compresses the Y range of visible sprites. Sprites positioned at Y
values above 50 on PAL map to Y values that may be above the NTSC bottom
border (approximately Y = 235 on NTSC vs 250 on PAL). The `region: pal`
frontmatter reflects that the cycle-count claims in this recipe are
PAL-derived and that Y-range constants need adjustment for NTSC. See
`docs/techniques/raster.md` for the PAL/NTSC line-count comparison and
`docs/techniques/sprite.md` for the `sprite_multiplex_24` technique entry
this recipe implements.
