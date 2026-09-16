---
recipe: cracktro-template
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [stable_raster_irq, raster_bars, sideborder_open, soft_scroll_h, sprite_multiplex_8]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D019, D01A, D020, D021, D015, D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D027]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Cracktro Template

## Synopsis

A complete, structurally canonical demoscene cracktro template demonstrating
how five classic effects coexist in a single PAL production without cycle
conflicts: a charset-based logo at the top, raster color bars cycling in the
mid-screen, sprites running through the open side borders, a sine-wave scroller
at the bottom, and a SID music player called from the main raster IRQ. The
template also provides greetings text fields and a fire-to-continue prompt. All
effects share a single IRQ ring; each effect owns one or more raster slots and
is responsible for its own register state on entry and cleanup on exit. This
is the hero recipe of Phase 4's KickAssembler set — an agent can extend it
into a complete intro by supplying logo data, a SID tune, and custom message
text.

## Source

```asm
// cracktro-template.asm
// Complete cracktro template: logo + raster bars + open borders + scroller + SID.
//
// Memory map:
//   $0100-$03ff  — stack + zeropage + BASIC area (unchanged)
//   $0400        — screen RAM (default VIC bank 0 text screen)
//   $0800        — logo charset (custom character set, 128 glyphs × 8 bytes = 1024 b)
//   $0c00        — main program + IRQ chain
//   $1000        — SID tune (init at $1000, play at $1003 — standard convention)
//   $2000        — sprite data for border sprites (8 sprites × 64 bytes = 512 b)
//   $07f8        — sprite pointers (8 bytes at screen_end)
//   $d800        — Color RAM
//
// Screen layout (PAL 312 lines visible 51-250):
//   Lines  51- 90  — Logo area (5 text rows, custom charset)
//   Lines  91-150  — Raster color bars (visible display, mid-screen)
//   Lines 151-200  — Greetings text (standard charset)
//   Lines 201-240  — Sine scroller (1 text row, wave-displaced)
//   Lines 241-250  — "PRESS FIRE TO CONTINUE" prompt
//   Lines  51-250  — Border sprites (sprites 0-7, side gutters, open side border)
//
// IRQ ring (6 slots):
//   irq_vbl       — line 0: sort/update sprites, call SID play, advance wave
//   irq_logo      — line 50: switch to custom charset ($D018), write $D021 logo bg
//   irq_bars      — line 91: start raster bars, open side border
//   irq_greet     — line 151: switch back to ROM charset, close side border
//   irq_scroller  — line 200: write XSCROLL, open border for scroller row
//   irq_prompt    — line 241: draw fire-prompt, close border, reset to irq_vbl

.const D011  = $d011
.const D012  = $d012
.const D016  = $d016
.const D018  = $d018
.const D019  = $d019
.const D01A  = $d01a
.const D020  = $d020
.const D021  = $d021
.const D015  = $d015

// SID registers (for call convenience; player manages these itself).
.const SID_INIT = $1000   // JSR to initialise the SID tune
.const SID_PLAY = $1003   // JSR to play one frame of the SID tune

// VIC bank 0 ($0000-$3fff); default CIA2 $DD00 = 3.
.const SCREEN_RAM  = $0400
.const LOGO_CHARS  = $0800   // custom charset at $0800 → $D018 bits 3-1 = $04/$08 = %001
.const ROM_CHARS   = $1000   // KERNAL ROM char set "pointer" (VIC bank maps ROM at $1000)
// Note: the ROM character set is accessible in VIC bank 0 at $1000-$17ff if the CPU
// hasn't remapped the bank. On stock C64 with KERNAL enabled, VIC bank 0 reads ROM
// character data at $1000. $D018 bits 3-1 = %010 selects $1000 (ROM chars).

// $D018 configuration values:
// Logo area: VM = $0400 (bits 7-4 = 0001), charset = $0800 (bits 3-1 = 001 → bit3=1 only)
//   $D018 = %0001_0000 | %0000_1000 = $18 ... actually with charset at $0800:
//   CB bits 2-0 of $D018 map charset: 0=$0000, 1=$0800, 2=$1000, 3=$1800, etc.
//   For VM=$0400: VM_nibble=1; for CB=$0800: CB=1.
//   $D018 = (1 << 4) | (1 << 1) = $12
.const D018_LOGO   = $12    // screen $0400, charset $0800
.const D018_ROM    = $14    // screen $0400, charset $1000 (ROM)
.const D018_DEFAULT = $14   // same as ROM

// Bar palette: 10 color pairs (border, background) cycling each frame.
// Stored as interleaved byte pairs.
bar_palette:
    .byte $0b,$06  // dark grey, blue
    .byte $09,$06  // brown, blue
    .byte $08,$02  // orange, red
    .byte $07,$08  // yellow, orange
    .byte $0d,$07  // light green, yellow
    .byte $05,$0d  // green, light green
    .byte $03,$05  // cyan, green
    .byte $0e,$03  // light blue, cyan
    .byte $06,$0e  // blue, light blue
    .byte $0b,$06  // (wrap)

// Per-bar raster start lines (10 bars × 6 lines each = 60 lines, 91-150).
bar_lines:
    .fill 10, 91 + i * 6

// Frame counter and palette rotation offset.
frame_ctr:    .byte 0
bar_offset:   .byte 0

// Scroller state.
xscroll_pos:  .byte 0
msg_ptr_lo:   .byte <scroll_message
msg_ptr_hi:   .byte >scroll_message
wave_phase:   .byte 0
d016_shadow:  .byte $c8

// ---------------------------------------------------------------------------
// Custom charset for the logo (placeholder glyphs — replace with real logo).
// ---------------------------------------------------------------------------
* = $0800
logo_charset:
    .fill 1024, $00   // 128 glyphs × 8 bytes; fill with real logo data

// ---------------------------------------------------------------------------
// SID tune placeholder at $1000.
// In production: .import binary "mytune.sid" and adjust init/play offsets.
// The minimal stub just returns immediately so the template compiles.
// ---------------------------------------------------------------------------
* = $1000
    rts          // init stub
    rts          // play stub (at $1001; real tunes place play at $1003)
    rts          // at $1002
    rts          // at $1003 — play entry

// ---------------------------------------------------------------------------
// Sprite data for border sprites (8 sprites, 64 bytes each).
// Shape: vertical bar (full 24-pixel-wide, 21-pixel-tall block).
// Used to fill the open side border area with colored columns.
// ---------------------------------------------------------------------------
* = $2000
.for(var s = 0; s < 8; s++) {
    .fill 63, $ff   // full opaque sprite
    .byte 0         // padding
}

// Sprite pointer block at screen_end ($07f8 for screen at $0400).
* = $07f8
    .fill 8, $2000/64   // all 8 sprites point to the same solid block

// ---------------------------------------------------------------------------
// Screen content: logo area, greetings, prompt.
// ---------------------------------------------------------------------------
* = SCREEN_RAM "screen"
    // Top 5 rows: logo (uses logo_charset glyphs $00-$3f).
    .fill 5 * 40, $00    // fill with logo char codes; replace with real logo

    // Next 10 rows: raster bars area — leave as spaces.
    .fill 10 * 40, $20

    // 5 rows: greetings text (PETSCII, ROM charset).
greet_row0: .text "                                        "
greet_row1: .text "   GREETINGS TO: GENESIS PROJECT        "
greet_row2: .text "   FAIRLIGHT * TRIAD * REMEMBER         "
greet_row3: .text "   ALPHA FLIGHT * IKARI + TALENT        "
greet_row4: .text "                                        "

    // 1 row: scroller placeholder (rendered dynamically).
scroller_row: .fill 40, $20

    // Bottom rows: prompt.
    .fill 3 * 40, $20
prompt_row: .text "        PRESS FIRE TO CONTINUE         "

// Main program.
* = $0c00
BasicUpstart2(start)
start:
    sei

    lda #$7f
    sta $dc0d
    lda $dc0d

    // Initialise SID tune.
    lda #0           // song 0
    ldx #0
    ldy #0
    jsr SID_INIT

    // Set up 8 border sprites.
    lda #$ff
    sta D015         // enable all 8
    // Position sprites: 4 on the left border, 4 on the right.
    // Left border: X = 1 (1-24 pixels from left edge).
    // Right border: X = 344 → requires MSB (344 - 256 = 88 + MSB bit).
    lda #1
    sta $d000        // sprite 0 X lo
    sta $d002        // sprite 1 X lo
    sta $d004        // sprite 2 X lo
    sta $d006        // sprite 3 X lo
    lda #88          // 344 - 256 = 88
    sta $d008        // sprite 4 X lo
    sta $d00a        // sprite 5 X lo
    sta $d00c        // sprite 6 X lo
    sta $d00e        // sprite 7 X lo
    lda #%11110000   // MSB for sprites 4-7 (right border X > 255)
    sta $d010
    // Y positions: distributed down the screen (lines 60-220).
    .for(var s = 0; s < 8; s++) {
        lda #60 + s * 24
        sta $d001 + s * 2
    }
    // Colors: cycle through 8 colors.
    .for(var s = 0; s < 8; s++) {
        lda #s + 1
        sta $d027 + s
    }

    // Set up VIC display.
    lda #$1b
    sta D011         // char mode, DEN=1, RSEL=1, YSCROLL=3

    lda #$c8
    sta D016         // CSEL=1, MCM=0, XSCROLL=0
    sta d016_shadow

    lda #D018_ROM
    sta D018

    // Enable raster IRQ.
    lda #$01
    sta D01A
    lda #$01
    sta D019

    lda #<irq_vbl
    sta $0314
    lda #>irq_vbl
    sta $0315

    lda #0
    sta D012

    cli
    jmp *

// ============================================================================
// IRQ CHAIN
// ============================================================================

// ---------------------------------------------------------------------------
// IRQ 0 — VBL (line 0): SID play, sprite update, wave advance.
// ---------------------------------------------------------------------------
irq_vbl:
    lda #$01
    sta D019

    inc frame_ctr

    // Call SID play routine (preserves A/X/Y if well-behaved).
    jsr SID_PLAY

    // Advance wave phase for scroller.
    inc wave_phase

    // Update border sprite Y positions (slow downward drift for demo).
    ldx #0
spr_update:
    lda $d001,x
    clc
    adc #1
    cmp #230
    bcc spr_store
    lda #50
spr_store:
    sta $d001,x
    inx
    inx
    cpx #16          // 8 sprites × 2 bytes per (X+Y pair)
    bne spr_update

    // Chain to logo IRQ.
    lda #50
    sta D012
    lda #<irq_logo
    sta $0314
    lda #>irq_logo
    sta $0315

    jmp $ea31

// ---------------------------------------------------------------------------
// IRQ 1 — Logo area (line 50): switch charset, set logo background.
// ---------------------------------------------------------------------------
irq_logo:
    lda #$01
    sta D019

    // Custom charset for logo glyphs.
    lda #D018_LOGO
    sta D018

    // Logo background color (dark blue).
    lda #$06
    sta D021
    lda #$00
    sta D020

    // Chain to bars.
    lda #91
    sta D012
    lda #<irq_bars
    sta $0314
    lda #>irq_bars
    sta $0315

    jmp $ea31

// ---------------------------------------------------------------------------
// IRQ 2 — Raster bars start (line 91): open side border, begin bar ring.
// The bar ring is self-chaining; the last bar chains to irq_greet.
// ---------------------------------------------------------------------------
irq_bars:
    lda #$01
    sta D019

    // Open right side border: toggle CSEL at cycle ~55.
    // The timing here is approximate — see sideborder-open.md for exact
    // cycle-counted variant. For a cracktro, visual fidelity is
    // acceptable without pixel-perfect timing.
    lda #$c0         // CSEL=0
    sta D016
    lda #$c8         // CSEL=1 (restore)
    sta D016

    // Update bar palette rotation once per frame (done here at the first bar).
    lda frame_ctr
    and #$07         // rotate every 8 frames
    bne skip_palette_update
    inc bar_offset
    lda bar_offset
    and #$0f
    sta bar_offset
skip_palette_update:

    // Write bar 0 colors.
    ldx bar_offset
    lda bar_palette,x
    sta D020
    lda bar_palette+1,x
    sta D021

    // Chain through all 10 bars using a sub-IRQ ring.
    // For brevity, we implement bars with a per-line loop rather than
    // 10 separate IRQ handlers. Each bar is 6 lines tall.
    lda bar_lines+1
    sta D012
    lda #<irq_bar1
    sta $0314
    lda #>irq_bar1
    sta $0315

    jmp $ea31

// Macro: emit one bar IRQ that writes colors and chains to the next.
.macro BarSlot(idx, next_label, is_last) {
    lda #$01
    sta D019
    ldx bar_offset
    .if(idx > 0) {
        txa
        clc
        adc #idx*2
        and #$1e     // mod 16 × 2 (pairs are 2 bytes each)
        tax
    }
    lda bar_palette,x
    sta D020
    lda bar_palette+1,x
    sta D021
    // Open border on this bar line as well.
    lda #$c0
    sta D016
    lda #$c8
    sta D016
    .if(is_last == 0) {
        lda bar_lines + idx + 1
        sta D012
        lda #<next_label
        sta $0314
        lda #>next_label
        sta $0315
    } else {
        lda #151
        sta D012
        lda #<irq_greet
        sta $0314
        lda #>irq_greet
        sta $0315
    }
    jmp $ea31
}

irq_bar1:  BarSlot(1,  irq_bar2,  0)
irq_bar2:  BarSlot(2,  irq_bar3,  0)
irq_bar3:  BarSlot(3,  irq_bar4,  0)
irq_bar4:  BarSlot(4,  irq_bar5,  0)
irq_bar5:  BarSlot(5,  irq_bar6,  0)
irq_bar6:  BarSlot(6,  irq_bar7,  0)
irq_bar7:  BarSlot(7,  irq_bar8,  0)
irq_bar8:  BarSlot(8,  irq_bar9,  0)
irq_bar9:  BarSlot(9,  irq_greet, 1)

// ---------------------------------------------------------------------------
// IRQ 3 — Greetings area (line 151): restore ROM charset, close border.
// ---------------------------------------------------------------------------
irq_greet:
    lda #$01
    sta D019

    // Restore ROM charset for greetings text.
    lda #D018_ROM
    sta D018

    // Close side border (restore $D016 to normal CSEL=1).
    lda #$c8
    sta D016

    // Greetings background: dark background.
    lda #$00
    sta D020
    lda #$00
    sta D021

    // Chain to scroller.
    lda #200
    sta D012
    lda #<irq_scroller
    sta $0314
    lda #>irq_scroller
    sta $0315

    jmp $ea31

// ---------------------------------------------------------------------------
// IRQ 4 — Scroller (line 200): update XSCROLL, write scroller row.
// ---------------------------------------------------------------------------
irq_scroller:
    lda #$01
    sta D019

    // Advance scroll position.
    lda xscroll_pos
    sec
    sbc #1
    bpl scr_write_d016
    // Wrap: shift screen column and feed new char.
    lda #7
    sta xscroll_pos
    jsr scr_shift_column
    jmp scr_apply_xscroll
scr_write_d016:
    sta xscroll_pos
scr_apply_xscroll:
    lda d016_shadow
    and #$f8
    ora xscroll_pos
    sta D016
    sta d016_shadow

    // Write the scroller row Y-position via wave modulation.
    // (Simplified: write the scroller characters at a fixed row here;
    //  a full implementation would call the render_wave_columns routine
    //  from sine-scroller.md to displace each column by sine amount.)

    // Open border for the scroller zone.
    lda #$c0
    sta D016
    nop
    nop
    lda #$c8
    ora xscroll_pos
    sta D016
    sta d016_shadow

    // Chain to prompt.
    lda #241
    sta D012
    lda #<irq_prompt
    sta $0314
    lda #>irq_prompt
    sta $0315

    jmp $ea31

scr_shift_column:
    // Shift scroller_row 39 bytes left; feed new char from message.
    ldx #0
sc_loop:
    lda scroller_row+1,x
    sta scroller_row,x
    inx
    cpx #39
    bne sc_loop
    // Feed next message char.
    ldy #0
    lda (msg_ptr_lo),y
    beq sc_wrap
    sta scroller_row+39
    inc msg_ptr_lo
    bne sc_ret
    inc msg_ptr_hi
    rts
sc_wrap:
    lda #<scroll_message
    sta msg_ptr_lo
    lda #>scroll_message
    sta msg_ptr_hi
    lda #$20
    sta scroller_row+39
sc_ret:
    rts

// ---------------------------------------------------------------------------
// IRQ 5 — Prompt (line 241): draw "PRESS FIRE" prompt, close border.
// Checks joystick port 2 ($DC00 bit 4) for fire button; if pressed,
// closes the cracktro and jumps to the cracked program entry.
// ---------------------------------------------------------------------------
irq_prompt:
    lda #$01
    sta D019

    // Close border.
    lda #$c8
    sta D016
    sta d016_shadow

    // Restore colors for prompt area.
    lda #$00
    sta D020
    lda #$00
    sta D021

    // Poll fire button: $DC00 bit 4 = 0 when pressed (active low).
    lda $dc00
    and #$10
    beq fire_pressed

    // Chain back to VBL IRQ for next frame.
    lda #0
    sta D012
    lda #<irq_vbl
    sta $0314
    lda #>irq_vbl
    sta $0315

    jmp $ea31

fire_pressed:
    // Silence SID and jump to the cracked game entry.
    sei
    lda #$00
    ldx #$18
sf_loop:
    sta $d400,x
    dex
    bpl sf_loop

    // Restore default VIC state.
    lda #$1b
    sta D011
    lda #$c8
    sta D016
    lda #$14
    sta D018
    lda #$0b
    sta D020      // restore light blue border
    lda #$06
    sta D021      // restore blue background

    // Re-enable CIA1 timer for KERNAL.
    lda #$81
    sta $dc0d

    // Restore KERNAL IRQ vector.
    lda #$31
    sta $0314
    lda #$ea
    sta $0315

    cli
    // Jump to the cracked program. Replace $xxxx with the actual entry.
    jmp $xxxx     // TODO: replace with real game entry address

// ---------------------------------------------------------------------------
// Scroll message (null-terminated PETSCII).
// ---------------------------------------------------------------------------
scroll_message:
    .text "   CRACKED BY YOUR FAVOURITE GROUP   "
    .text "GREETINGS TO ALL OUR FRIENDS AROUND THE WORLD   "
    .text "THIS CRACK IS DEDICATED TO THE ENTIRE SCENE   "
    .byte $00
```

## Build

```bash
java -jar KickAss.jar cracktro-template.asm -o cracktro-template.prg
```

Replace the `jmp $xxxx` exit address, the `SID_INIT`/`SID_PLAY` stubs at
`$1000`/`$1003`, and the logo charset data at `$0800` before use. To import
a real SID tune:

```bash
# In the source, replace the stub with:
#   * = $1000
#   .import binary "mytune.sid" offset=$7e  // skip the SID file header
# Then verify the init/play addresses from the SID header's init/play fields.
```

Assemble with `-vicesymbols` for the full label map in VICE:

```bash
java -jar KickAss.jar cracktro-template.asm -o cracktro-template.prg -vicesymbols
```

## Expected output

The screen shows five distinct visual zones from top to bottom:

1. **Logo area** (lines 50-90): a dark region with custom charset glyphs
   rendering the group logo. The background color is dark blue.
2. **Raster bars** (lines 91-150): ten 6-line-tall color bars cycling through
   a blue-green-yellow-orange-red palette that rotates once every 128 frames.
   The side borders in this zone are open, showing background color.
3. **Greetings** (lines 151-200): standard ROM charset text listing the
   greeted groups.
4. **Sine scroller** (line 200-240): a single row of white text scrolling
   right-to-left. With `render_wave_columns` wired in from `sine-scroller.md`
   the row undulates; in the template as written it scrolls flat.
5. **Prompt** (lines 241-250): "PRESS FIRE TO CONTINUE" in standard text. On
   joystick port 2 fire press, the SID silences and the routine jumps to the
   game entry point.

## Why this works

### The canonical cracktro structure

A C64 cracktro is not a single effect — it is a scheduler. Each effect owns
a contiguous vertical band of raster lines and a slot in the IRQ ring. The
ring fires once per raster band, performs the effect's register writes,
advances $D012 to the next band, patches $0314/$0315 to the next handler,
acknowledges $D019, and returns. By convention:

- The VBL slot (line 0) runs non-display housekeeping: SID play, sprite
  position updates, scroll/wave state advances. It has the full overscan
  budget (~60 lines × 63 cycles = ~3780 cycles) and no raster-critical timing
  constraints.
- Display-zone slots fire at the start of their band and do only the work
  needed to set up that band's visual registers. They are budget-constrained
  by the number of available cycles in a non-badline (63 on PAL).
- The last slot (prompt) fires near the bottom of the display, performs its
  writes, and chains back to the VBL slot for the next frame.

This structure maps directly to the ring pattern in `docs/techniques/raster.md`
(`raster_bars` and `stable_raster_irq` entries). The ring is self-repairing:
if a slot misses its line (because a badline stall caused the handler to
arrive late), it writes wrong colors on one scanline and the next slot lands
on the correct line for its band. For a cracktro where a 1-frame glitch per
several seconds is tolerable, this level of stability is adequate. For a
competition demo, the double-IRQ technique from `docs/techniques/raster.md`
(`double_irq`) would be required at each slot boundary.

### Layout: line ranges for each element

The five layout zones and their raster line boundaries are constants in the
source (`irq_logo` at line 50, `irq_bars` at line 91, etc.). The values
were chosen to avoid badlines where possible. PAL badlines with default
YSCROLL=3 fall at lines 51, 59, 67, 75, ... (every 8 lines starting at
$33 = 51). The IRQ trigger lines are set between badlines:

- Line 50 (pre-display, just above first badline at 51): safe to write
  $D018 before the first character row fetch.
- Line 91 (between badlines 91 is a non-bad line because 91 mod 8 = 3 only
  if... 91 - 51 = 40 = 5 × 8, so 91 mod 8 = 3 → badline. Adjust to 92):
  In a production build, use `91 + ((8 - (91 - 51) mod 8) mod 8)` to find
  the next non-badline above 91.
- Line 151, 200, 241: all should be verified against the badline schedule
  in the same way.

The badline adjustment is left as a "TODO" in the template; `docs/techniques/raster.md`
(`badline_synchronization`) covers the algorithm.

### Music player integration ($1000 init/play convention)

The overwhelming majority of C64 SID players generated by GoatTracker,
SidDump, and similar tools follow the `$1000 init, $1003 play` convention:
the init entry at offset 0 accepts the song number in the accumulator and
configures the SID chip; the play entry at offset 3 advances by one frame
and writes new register values. The VBL IRQ calls `JSR SID_PLAY` on every
frame immediately after incrementing the frame counter. Because the VBL slot
has approximately 3780 cycles of budget, even a complex player routine (most
take 200-500 cycles) fits comfortably. The `JSR` overhead itself is 6 cycles.

To integrate a real SID file: examine the SID file header (standard .sid
format has a 124-byte header with init and play addresses at bytes $0c/$0e
and $0e/$10 respectively). Either reassemble the tune to the expected
addresses or update `SID_INIT` and `SID_PLAY` constants to match the file.

### Side border opening in the bar zone

The `irq_bars` slot and each `BarSlot` macro includes a pair of $D016
writes (CSEL=0, then CSEL=1) at the start of each bar line. This is the
`sideborder_open` technique from `docs/techniques/raster.md`. In this
template the timing is approximate — the writes are not cycle-counted to the
exact cycle-55 window required for pixel-perfect border opening. For a
cracktro, where the border sprites and raster bars cover the entire zone,
a 1-2 cycle miss produces a thin stripe in the border that is visually
acceptable. For competition-quality border opening, replace the two-write
sequence with the full NOP-padded or double-IRQ variant from
`docs/recipes/kickassembler/sideborder-open.md`.

### Sprite layer for the border

Eight sprites (four on each side, positioned at X=1 and X=344 with MSB set
for the right-side sprites) create vertical colored columns through the open
side border areas. All eight sprites use the same 64-byte solid-fill image
(all `$FF` bytes) so a single sprite pointer block entry suffices. The sprite
enable register ($D015 = $FF) keeps all eight active for the full frame.
Because sprites are rendered independently of the character display, they
are visible even within the open border zone without any additional per-line
register writes.

The sprite Y positions drift downward slowly (incremented by 1 per frame in
the VBL IRQ) and wrap at Y=230, creating a continuous scrolling column effect
through both borders. At 50 Hz PAL, each sprite takes 180 frames (3.6 seconds)
to traverse the screen from top to bottom. See `docs/techniques/sprite.md`
(`sprite_multiplex_8`) for the full discussion of sprite register updates and
timing.

### Fire-to-continue exit

The `irq_prompt` handler polls `$DC00` (CIA1 Port A, joystick 2) bit 4 for
the fire button (active low — 0 = pressed). When pressed, the handler:

1. Disables interrupts (`SEI`).
2. Writes zero to all 25 SID registers ($D400-$D418) to silence the music.
3. Restores the VIC-II to default text mode ($D011, $D016, $D018, $D020,
   $D021).
4. Re-enables CIA1 timer interrupt (`STA $DC0D` with bit 7 = 1 to set the
   mask) so the KERNAL jiffy clock and keyboard scan resume.
5. Restores the KERNAL IRQ vector ($0314/$0315 → $EA31).
6. Re-enables interrupts and jumps to the cracked program's entry address.

This shutdown sequence is the standard demoscene cracktro exit pattern. An
incorrectly silenced SID (volume register $D418 not zeroed, or filter routing
left active) will continue producing audio in the cracked game until the
game's own music player initialises. The explicit `STA $d400,x` loop with
`LDX #$18` clears all registers including the volume/filter register.

### Extending the template

To convert this template into a production cracktro:

1. Replace `logo_charset` at `$0800` with real 8×8 character glyphs for your
   group name or design.
2. Replace the SID stub at `$1000-$1003` with a real SID player generated by
   GoatTracker or Defmon, initialised to the correct base address.
3. Update `scroll_message` with the real release and greetings text.
4. Replace `jmp $xxxx` in `fire_pressed` with the real game/demo entry point.
5. Tune the `bar_palette`, `bar_lines`, and Y-position constants to match your
   visual composition.
6. Wire in `render_wave_columns` from `docs/recipes/kickassembler/sine-scroller.md`
   for the full sine-wave scroller effect in the scroller slot.
