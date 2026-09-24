# Canon sweep: forty everyday routines against the KB (issue #4)

Recorded 2026-09-24 at main 7888be5 plus the base-routines commit.

## Method

The source is the Codebase64 wiki, read on 2026-09-24 from its mirror
`codebase64.net` (the `codebase64.org` host was unreachable from this
machine). The section indexes read were `base:6502_6510_coding`,
`base:6502_6510_maths`, `base:interrupts`, `base:cia`,
`cia:io_programming`, `vic`, `vic:demo_programming`,
`base:sid_programming`, `base:using_the_kernal_basic_roms` and
`base:game_programming`. Each index lists one article per routine.

The forty topics below are the routines a program of any kind needs,
chosen from those indexes. The choice and the order (by section) are
this sweep's judgement: no page-view figures were available, so nothing
here ranks topics by traffic. Demo effects with their own issues
(linecrunch, AGSP, FPP, digis) are left to those issues.

Each topic was checked against `docs/` by technique name and by a text
search. "Covered" means a technique entry; the Where column names the
recipe that runs it in VICE when there is one. "Partial" names what is
there and what is not; "missing" means no entry.

## The list

| # | Topic (Codebase64 section) | KB status | Where |
|---|---|---|---|
| 1 | 16-bit add and subtract (maths) | covered | `maths.md` `add_sub_16bit`; `recipes/kickassembler/base-routines.md` |
| 2 | 16-bit and ranged compares (maths) | covered | `maths.md` `compare_16bit_and_signed`; `compare-16bit-signed.md` |
| 3 | 8 × 8 multiply, 16-bit product (maths) | covered | `maths.md` `table_multiply_8x8` |
| 4 | 16 × 16 multiply, 32-bit product (maths) | covered | `maths.md` `multiply_16x16`; `multiply-16x16.md` |
| 5 | Multiply by a constant (maths) | covered | `maths.md` `multiply_by_constant`; `multiply-constant.md` |
| 6 | 8- and 16-bit division, divide by ten (maths) | covered | `maths.md` `division_8_16bit`; `oscar64/divide-check.md` |
| 7 | Square root (maths) | covered | `maths.md` `isqrt_16bit`; `sqrt-atan2.md` |
| 8 | atan2 (maths) | covered | `maths.md` `atan2_8bit`; `sqrt-atan2.md` |
| 9 | Sine table generation (maths) | covered | `cpu-cycle-tricks.md` `sine_table_generation`; `sine-table-runtime.md` |
| 10 | Random numbers, LFSR (maths) | covered | `maths.md` `lfsr_random` |
| 11 | Random numbers in a range, even distribution (maths) | missing | no entry |
| 12 | Hex and decimal number printing (maths, I/O) | covered | `text.md` `decimal_print`; `oscar64/print-number.md` |
| 13 | BCD score counters (game) | covered | `text.md` `high_score_table_insert`; `high-score-insert.md` |
| 14 | Sorting a list (maths) | partial | sprite sorts in `sprite.md` `sprite_multiplex_24` and `sprite_multiplex_game`; no general sort entry |
| 15 | KERNAL floating point from assembly (maths) | covered | `maths.md` `basic_rom_float_calls`; `basic-float-calls.md` |
| 16 | Memory clear and fill (CPU) | covered | `cpu-cycle-tricks.md` `memory_fill_copy`; `base-routines.md` |
| 17 | Memory move, overlapping (CPU) | covered | `cpu-cycle-tricks.md` `memory_fill_copy`; `base-routines.md` |
| 18 | Loops against unrolled code (CPU) | covered | `cpu-cycle-tricks.md` `unrolled_loops` |
| 19 | Speedcode (CPU) | covered | `cpu-cycle-tricks.md` `speedcode_generation`; `speedcode-generator.md` |
| 20 | Dispatch on a byte, jump tables (CPU) | covered | `cpu-cycle-tricks.md` `jump_table_dispatch` |
| 21 | Illegal opcodes (CPU) | covered | `cpu-cycle-tricks.md` `illegal_opcode_tricks`; `pitfalls/cpu.md` |
| 22 | The `$00`/`$01` port and memory configuration (CPU, KERNAL) | covered | `memory-banking.md` `cpu_io_port_bank` |
| 23 | Delay loops (interrupts) | covered | `cpu-cycle-tricks.md` `delay_loops`; `base-routines.md` |
| 24 | Cycle-exact measuring of a routine (interrupts) | covered | the CIA2 cascade in `base-routines.md` and `compare-16bit-signed.md` |
| 25 | Raster IRQ set-up (interrupts) | covered | `raster.md` `irq_chain_table`; `irq-chain.md` |
| 26 | Stable raster, double IRQ (interrupts) | covered | `raster.md` `stable_raster_irq`, `double_irq`; `stable-raster-irq.md` |
| 27 | Stable raster by clock slide (interrupts) | missing | no clock-slide entry |
| 28 | CIA timer IRQ and NMI, RESTORE (interrupts) | covered | `cpu-cycle-tricks.md` `nmi_handler_and_restore_key`; `nmi-timer-tick.md` |
| 29 | TOD clock (CIA) | covered | `cpu-cycle-tricks.md` `tod_alarm_interrupt`; `tod-alarm.md` |
| 30 | Keyboard scanning without the KERNAL (I/O) | covered | `input.md` `keyboard_matrix_scan`, `irq_keyboard_own_scan`; `own-keyscan.md` |
| 31 | Joystick reading (I/O) | covered | `input.md` `joystick_edge_detect` |
| 32 | 1351 mouse (I/O) | covered | `input.md` `mouse_1351_read`; `mouse-1351-read.md` |
| 33 | PETSCII to screen codes (VIC, I/O) | covered | `text.md` `petscii_screen_code_conversion` |
| 34 | String input (I/O) | covered | `text.md` `text_input_line` |
| 35 | Disk load and save through the KERNAL (I/O, KERNAL) | covered | `file-io.md` `kernal_load_to_address`, `kernal_file_write_seq`; `file-io-roundtrip.md` |
| 36 | Plotting pixels and drawing lines (VIC) | covered | `bitmap-modes.md` `hires_plot`, `bresenham_line`; `hires-plot-line.md` |
| 37 | Circle drawing (VIC) | missing | no entry |
| 38 | PAL/NTSC detection (VIC) | covered | `raster.md` `pal_ntsc_detection`; `oscar64/pal-ntsc-detect.md` |
| 39 | SID model detection (SID) | missing | no entry; issue #24 backlog lists a `$D41B` recipe |
| 40 | Music player call from an IRQ (SID) | covered | `music-sid.md` `sid_play_routine_pattern`; `music-player.md` |

Totals when recorded: 33 covered, 1 partial, 6 missing. Issue #89 has
since moved rows 4 and 5 to covered.

## Missing and partial

Filed as issue #89 with acceptance criteria: 16 × 16
multiply, multiply by a constant, ranged random numbers with an even
distribution, a general sort, the clock-slide stable raster, circle
drawing. SID model detection is already in the #24 backlog.

## Sources

- Codebase64 wiki, section indexes named under Method, read at
  `https://codebase64.net/doku.php?id=<section>` on 2026-09-24.
