// api.inc: what every part module and the sequencer agree on. Read DESIGN.md
// ("The contract every part keeps") for the words; these are the numbers.
//
// A part module is src/parts/pN_<name>.asm. It defines .namespace pN with:
//   prepare, setup, main, fadeout, cleanup, selfcheck      (routines, rts)
//   irq_count (byte), irq_lines (bytes), irq_hi (bytes: 0 or $80), irq_lo, irq_hi_addr (handler address bytes)
//   worst, typical                                         (words: the part's own CIA1 timer A bracket)
// Handlers named in irq_lo/irq_hi_addr are entered with A, X, Y saved and
// $D019 acknowledged by the dispatcher; they end with rts. A handler may run
// the double-IRQ stable entry inside itself (stable-raster-irq recipe shape)
// as long as it leaves the dispatcher's state alone.

// Sequencer zero page ($02-$0F). Parts never write these.
.label seq_frame      = $02        // 16-bit frame counter, low/high, incremented by the line-255 interrupt
.label seq_flag       = $04        // set to 1 by the line-255 interrupt; the main loop clears it
.label seq_fade       = $05        // 0 = running, 1 = fade requested (parts read it in main/fadeout)
.label seq_part       = $06        // current part number 1..5 (0 before the first)
.label seq_tmp        = $08        // $08-$0F scratch for the sequencer only

// Part zero page: $10-$7F belongs to the running part; nothing survives a part change.
.label part_zp        = $10

// Music player zero page: $FB-$FE (the sfx-in-player recipe's fxptr and patptr).

// Raster lines the sequencer owns. No part interrupt or cycle-locked loop may
// cover lines 254 to 258 inclusive; the sequencer's interrupt is at 255.
.const SEQ_LINE       = 255

// Verdict contract (vice-reference, "Verifying a run without a human").
.label RESULT_BYTE    = $02ff      // $01 pass, $02 fail
.const BORDER_PASS    = 5
.const BORDER_FAIL    = 2

// Memory owned by the sequencer and the music; parts stay out of these.
.const SEQ_CODE       = $0810      // to $0FFF
.const MUSIC_BASE     = $1000      // to $1CFF: music_init, music_play, music_pos, the tune (ends $1798 today)
// Part 5's three 256-byte projection tables (px, py, zd), read-only data
// loaded with the PRG. They used to follow p5's code at P5_CODE + $0500;
// when I-004 moved P5_CODE to $CC00 that put them at $D100, under the I/O
// area, and every table read returned a VIC register mirror (I-008). This
// is the last 768-byte page-aligned hole in RAM that the CPU sees with
// $01 = $37 and that no part writes; the assembler refuses an overlap if
// the tune ever grows into it.
.const P5_TABLES      = $1d00      // to $1FFF
.const IDLE_BYTE      = $3fff      // held at 0 for the whole demo (idle_fetch_byte_shows_in_gaps)

// Part code blocks (see DESIGN.md "Memory"; $A000-$BFFF is BASIC ROM while $01 = $37, so parts 4 and 5 sit at $C000).
.const P1_CODE = $8000
.const P2_CODE = $8c00
// P3_CODE moved forward by $120 to clear p2's FORCE_FAULT build: the fault
// adds ~147 bytes of poisoning and verification code, pushing p2 to $9811;
// $9920 leaves 270 bytes of clearance.  See the integration record, I-001.
.const P3_CODE = $9920
.const P4_CODE = $c000
.const P5_CODE = $cc00   // moved from $c800: p4 is 2931 bytes, exceeds the $800 gap; DESIGN.md text says $cc00

// Part data areas in the VIC banks (rebuilt by each part's prepare; nothing persists between parts).
// Bank 0 ($0000-$3FFF): screen $0400 unless the part says otherwise; $2000-$3FFE free for sprites, charsets, buffers.
// Bank 1 ($4000-$7FFF): part 2 only (bitmap $6000, screen $5C00, phase images $4400).

// CIA rules: CIA1 timer A ($DC04/$DC05, control $DC0E) is the running part's stopwatch.
// CIA2 timer A is the harness meter's: never write $DD04-$DD0F. $DC0D stays $7F. $01 stays $37.
