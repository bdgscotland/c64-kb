// sprites.asm — KickAssembler 24-sprite multiplexer escape-hatch stub
//
// This file is the structural skeleton of a three-bank 24-sprite multiplexer.
// It is not complete; the sort and bank-write logic must be filled in.
// Use it as a scaffold when you need more than 8 hardware sprites on screen.
//
// Reference: docs/recipes/kickassembler/sprite-multiplex-24.md
//
// External-asm linking pattern (Oscar64 side):
//   extern "C" void mux_sort(void);
//   extern "C" void mux_bank_write(char bank);
//
// Build and link:
//   java -jar KickAss.jar src/asm/sprites.asm -o sprites_asm.prg
//   oscar64 -O2 -o=game.prg -tf=prg src/main.c sprites_asm.prg
//
// Oscar64 calling convention:
//   First argument: zero-page register pair at $02/$03
//   Return value:   ACCU zero-page location
//
// Memory layout assumed here (adjust to your VIC bank / screen RAM location):
//   $1000  — sprite graphics data (24 shapes; first 3 used as placeholders)
//   $07f8  — sprite pointer block (screen at $0400, VIC bank 0)
//   $0c00  — logical sprite tables (X lo, Y, ptr, colour, X hi)
//   $0d00  — sort scratch (sorted_idx[24])

// VIC-II registers
.const D000 = $d000   // sprite 0 X (low byte)
.const D001 = $d001   // sprite 0 Y
.const D010 = $d010   // sprite X MSBs (all 8 sprites packed into one byte)
.const D015 = $d015   // sprite enable mask (bit n = enable sprite n)
.const D019 = $d019   // interrupt flag (W1C)
.const D01A = $d01a   // interrupt mask
.const D027 = $d027   // sprite 0 colour register

.const SPRITE_PTR_BASE = $07f8   // pointer block for screen at $0400 (VIC bank 0)
.const SPRITE_COUNT = 24
.const BANK_SIZE    = 8

// ---------------------------------------------------------------------------
// Logical sprite tables at $0c00
// Layout: 5 parallel byte arrays, one entry per logical sprite.
// ---------------------------------------------------------------------------
* = $0c00
spr_x_lo:  .fill SPRITE_COUNT, 24    // X low byte (0-255)
spr_y:     .fill SPRITE_COUNT, 50    // Y coordinate (50-250)
spr_ptr:   .fill SPRITE_COUNT, $1000/64  // sprite block pointer
spr_col:   .fill SPRITE_COUNT, 1     // sprite colour (0-15)
spr_x_hi:  .fill SPRITE_COUNT, 0     // X MSB (0 or 1)

* = $0d00
sorted_idx: .fill SPRITE_COUNT, 0    // indices sorted by Y ascending

// ---------------------------------------------------------------------------
// Sprite graphics: 3 placeholder shapes at $1000 (64 bytes each).
// Replace with real sprite data or use #embed spd_sprites in Oscar64.
// ---------------------------------------------------------------------------
* = $1000
.for (var s = 0; s < 3; s++) {
    .fill 63, $00   // TODO: replace with real sprite bitmap
    .byte 0         // pad to 64-byte boundary
}

// ---------------------------------------------------------------------------
// mux_sort
//
// TODO: implement insertion sort on spr_y[] into sorted_idx[].
// See docs/recipes/kickassembler/sprite-multiplex-24.md for the full
// implementation. This stub initialises sorted_idx to 0..23 (no sort).
// ---------------------------------------------------------------------------
.export mux_sort
mux_sort: {
    ldx #SPRITE_COUNT - 1
init_loop:
    stx sorted_idx, x
    dex
    bpl init_loop
    // TODO: insertion sort — sort sorted_idx by spr_y[sorted_idx[i]]
    rts
}

// ---------------------------------------------------------------------------
// mux_bank_write
//
// bank (0, 1, or 2) passed in the Oscar64 first-argument register ($02).
// Writes 8 hardware sprite registers for sprites sorted_idx[bank*8 .. bank*8+7].
//
// TODO: fill in the actual register-write loop.
// See docs/recipes/kickassembler/sprite-multiplex-24.md write_bank routine.
// ---------------------------------------------------------------------------
.export mux_bank_write
mux_bank_write: {
    // bank number is in zero-page $02 (Oscar64 first arg)
    lda $02
    asl
    asl
    asl            // bank * 8 = base index into sorted_idx
    tax

    // TODO: for hw_slot 0..7:
    //   idx = sorted_idx[base + hw_slot]
    //   sta D000 + hw_slot*2  <- spr_x_lo[idx]
    //   sta D001 + hw_slot*2  <- spr_y[idx]
    //   sta SPRITE_PTR_BASE + hw_slot <- spr_ptr[idx]
    //   sta D027 + hw_slot    <- spr_col[idx]
    //   accumulate spr_x_hi[idx] into D010 mask
    // sta D010  <- accumulated MSB mask
    // lda #$ff
    // sta D015  <- enable all 8 hardware sprites

    rts
}

// ---------------------------------------------------------------------------
// mux_irq_init
//
// Installs the three bank-switch raster IRQs.
// TODO: implement — chain irq_bank0 -> irq_bank1 -> irq_bank2 -> irq_bank0.
// See docs/recipes/kickassembler/sprite-multiplex-24.md IRQ section.
// ---------------------------------------------------------------------------
.export mux_irq_init
mux_irq_init: {
    sei

    lda #$7f
    sta $dc0d        // mask CIA1 timer interrupt
    lda $dc0d        // clear pending

    lda #<irq_bank0
    sta $0314
    lda #>irq_bank0
    sta $0315

    lda #$01
    sta D01A         // enable raster IRQ source
    lda #$01
    sta D019         // clear stale VIC IRQ

    lda #$1b
    sta $d011        // DEN=1 RSEL=1 YSCROLL=3

    lda #0
    sta $d012        // first IRQ at raster line 0

    cli
    rts
}

// ---------------------------------------------------------------------------
// IRQ stubs — replace with real timing-accurate bank-switch handlers.
// See docs/recipes/kickassembler/sprite-multiplex-24.md for the full pattern.
// ---------------------------------------------------------------------------
irq_bank0: {
    lda #$01
    sta D019        // acknowledge
    // TODO: call mux_sort, write bank 0, schedule irq_bank1
    lda #0
    sta $d012
    lda #<irq_bank0
    sta $0314
    lda #>irq_bank0
    sta $0315
    jmp $ea31
}

irq_bank1: {
    lda #$01
    sta D019
    // TODO: write bank 1, schedule irq_bank2
    jmp $ea31
}

irq_bank2: {
    lda #$01
    sta D019
    // TODO: write bank 2, schedule irq_bank0 for next frame
    jmp $ea31
}
