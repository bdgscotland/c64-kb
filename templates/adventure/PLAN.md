# Plan: adventure

The text-adventure starter for c64-kb issue #39. The tool output below was
produced on 2026-09-23 by this checkout's c64-kb and pasted whole.

## Concept

STARWATCH, a two-word text adventure in an original twelve-room world: an
astronomer's house on the night a comet passes. The player types commands on
an input line under a scrolling room-text window; a strip of multicolour
character pictures above the window shows the room. Objects, four containers
(chest, drawer, crate, desk), three puzzles with state (a key fished out of a
pond, a dark cellar and a lamp that needs matches, a clock that opens the
tower hatch), a scored ending, and SAVE and LOAD of the game to drive 8. The
room and message text is stored packed. PAL and NTSC.

## Briefing

Command: `npx tsx src/cli.ts game-briefing "text adventure: original twelve-room world, two-word parser with synonyms, split screen room text window above an input line, objects and containers, stateful puzzles, scored ending, save and load game state to disk, compressed room and message text, multicolour character picture strip" --archetype text_adventure`

(`--archetype adventure` is refused: the graph's name is `text_adventure`.)

Kept from its 17 proposals: adventure_database_engine, two_word_parser,
text_input_line, sid_voice_setup (a key click and two chimes).

Dropped, and why: cpu_io_port_bank, ram_under_kernal and exomizer_basics (the
archetype's fingerprint for large games; this one fits under $A000 with the
ROMs in); text_window_and_menu (the window here is a scrolling terminal, not a
save-under box, and the technique pulls in joystick_edge_detect);
flip_screen_rooms (the room change redraws only the picture strip);
screen_dissolve_lfsr and screen_wipe (no transitions); world_state_bits (the
whole state is a few dozen bytes and is saved whole); attract_mode_input_replay
(the autopilot types into the keyboard queue instead); multi_sprite_object,
two_player_state_swap, joystick_autorepeat, joystick_edge_detect (no sprites,
one player, keyboard play; fire on port 2 only starts the game).

Added, which the briefing did not propose: kernal_file_write_seq,
kernal_file_read_seq and error_channel_check (the brief says SAVE and LOAD);
mcm_text and charset_copy_rom_to_ram (the picture strip); decimal_print
(score and turns); petscii_screen_code_conversion (typed PETSCII to the
screen); frame_sync_loop; raster_profile_bars (the harness meter).

The briefing's 38 pitfalls are mostly its sprite and joystick proposals'.
The ones this program meets are in the table below.

## Techniques

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| adventure_database_engine | rooms, items, an action table with conditions and commands, occurrences, containers, packed text | oscar64-adventure-engine | petscii_written_to_screen_ram |
| two_word_parser | verb and noun stems of four letters, synonyms share an id, articles skipped | oscar64-two-word-parser | petscii_written_to_screen_ram, getchx_petscii_remaps_return, kernal_clobbers_a_x_y |
| text_input_line | the input line: echo, DEL, RETURN, a length cap, a blinking cursor | oscar64-text-input | getchx_petscii_remaps_return, badline_cycle_loss, d012_wrap_around |
| petscii_screen_code_conversion | typed PETSCII to screen codes for the echo and the unknown-word reply | oscar64-petscii-screen-codes | petscii_written_to_screen_ram |
| decimal_print | score and turns on the status bar | oscar64-print-number | petscii_written_to_screen_ram |
| mcm_text | the picture strip: colour RAM 8-15 cells are multicolour, 0-7 stay hires text | none yet (the technique says "No recipe yet"); oscar64-charset-animation for the RAM set | d016_unmasked_rmw_clobbers_csel_mcm, charset_blit_overruns_grown_code |
| charset_copy_rom_to_ram | the ROM letters and reverse glyphs copied under the picture tiles | kickassembler-charset-copy-rom-to-ram | irq_during_charen_window, charset_blit_overruns_grown_code |
| kernal_file_write_seq | SAVE: scratch, then write the state record | oscar64-save-load-seq-file, oscar64-high-score-persist | krnio_save_leaves_splat_file, kernal_assumes_sei_cleared, kernal_io_mapping_dependency |
| kernal_file_read_seq | LOAD: read the record, check size, version and checksum | oscar64-save-load-seq-file | first_open_after_reset_hangs_on_pal, kernal_assumes_sei_cleared |
| error_channel_check | the drive's two-digit reply decides what SAVE and LOAD print | oscar64-high-score-persist | first_open_after_reset_hangs_on_pal |
| frame_sync_loop | one pass a frame, polled at raster line 250 | oscar64-frame-sync-loop, templates/hello | d012_wrap_around, badline_cycle_loss, pal_ntsc_tempo_mismatch |
| sid_voice_setup | key click, score chime, ending jingle | oscar64-sid-music-player (voice setup only) | sid_write_only_registers, sid_adsr_bug_8580, sid_voice3_disable_silent_bit |
| raster_profile_bars | the harness frame meter (CIA2 timer A) | oscar64-raster-profile-bars | badline_cycle_loss |

## Compatibility

Command: `npx tsx src/cli.ts check-compatibility adventure_database_engine two_word_parser text_input_line petscii_screen_code_conversion decimal_print mcm_text charset_copy_rom_to_ram kernal_file_write_seq kernal_file_read_seq error_channel_check frame_sync_loop sid_voice_setup raster_profile_bars`

```text
# Compatibility: adventure_database_engine + two_word_parser + text_input_line + petscii_screen_code_conversion + decimal_print + mcm_text + charset_copy_rom_to_ram + kernal_file_write_seq + kernal_file_read_seq + error_channel_check + frame_sync_loop + sid_voice_setup + raster_profile_bars

**Verdict:** WARNINGS

Checked with 1 implied prerequisite(s): cpu_io_port_bank.

Unit claims are stated for 0 of 13 techniques; a unit conflict cannot be ruled out for: adventure_database_engine, two_word_parser, text_input_line, petscii_screen_code_conversion, decimal_print, mcm_text, charset_copy_rom_to_ram, kernal_file_write_seq, kernal_file_read_seq, error_channel_check, frame_sync_loop, sid_voice_setup, raster_profile_bars, cpu_io_port_bank (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## shared_kernal (soft): two_word_parser × text_input_line
**Shared:** GETIN
Both techniques call KERNAL routine(s) GETIN. Concurrent use may clobber KERNAL state.

## shared_register (soft): text_input_line × frame_sync_loop
**Shared:** SCROLY
Both techniques touch register(s) SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): petscii_screen_code_conversion × mcm_text
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): petscii_screen_code_conversion × charset_copy_rom_to_ram
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_kernal (soft): petscii_screen_code_conversion × kernal_file_write_seq
**Shared:** CHROUT
Both techniques call KERNAL routine(s) CHROUT. Concurrent use may clobber KERNAL state.

## shared_register (soft): mcm_text × charset_copy_rom_to_ram
**Shared:** VMCSB
Both techniques touch register(s) VMCSB. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_kernal (soft): kernal_file_write_seq × kernal_file_read_seq
**Shared:** CLRCHN, CLOSE, OPEN, SETNAM, SETLFS
Both techniques call KERNAL routine(s) CLRCHN, CLOSE, OPEN, SETNAM, SETLFS. Concurrent use may clobber KERNAL state.

## shared_kernal (soft): kernal_file_write_seq × error_channel_check
**Shared:** CLRCHN, CLOSE, OPEN, SETNAM, SETLFS
Both techniques call KERNAL routine(s) CLRCHN, CLOSE, OPEN, SETNAM, SETLFS. Concurrent use may clobber KERNAL state.

## shared_kernal (soft): kernal_file_read_seq × error_channel_check
**Shared:** CHRIN, CLRCHN, CHKIN, CLOSE, OPEN, SETNAM, SETLFS, READST
Both techniques call KERNAL routine(s) CHRIN, CLRCHN, CHKIN, CLOSE, OPEN, SETNAM, SETLFS, READST. Concurrent use may clobber KERNAL state.

## shared_register (soft): frame_sync_loop × raster_profile_bars
**Shared:** EXTCOL
Both techniques touch register(s) EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.


## Not covered
- **adventure_database_engine**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **decimal_print**: the graph has no registers, KERNAL routines or demands for it; the verdict says nothing about it.
- **cpu_io_port_bank** (prerequisite of charset_copy_rom_to_ram): the graph has no registers, KERNAL routines or demands for it.

## Shared Infrastructure (info)
- **cpu_io_port_bank** (prerequisite, not in the set): required by charset_copy_rom_to_ram; included in the check as implied. Set it up first.
- **SP6COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **CHRIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader, oscar64-high-score-persist
- **CHROUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader, oscar64-high-score-persist
- **CLRCHN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader, oscar64-high-score-persist
- **CHKOUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader, oscar64-high-score-persist
- **CHKIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader, oscar64-high-score-persist
- **CLOSE** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader, oscar64-high-score-persist
- **OPEN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader, oscar64-high-score-persist
- **SETNAM** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader, oscar64-high-score-persist
- **SETLFS** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader, oscar64-high-score-persist
- **DC0F** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC07** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC06** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC03** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP5COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP4COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP3COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP2COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP1COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP0COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **BGCOL0** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **EXTCOL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-directory-reader
- **IRQMSK** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VICIRQ** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SPENA** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **RASTER** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-directory-reader
- **SCROLY** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **MSIGX** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **M0Y** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **M0X** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **RANDOM** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC02** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC00** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-directory-reader
- **SIGVOL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SUREL3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **ATDCY3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VCREG3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWHI3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWLO3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FREHI3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FRELO3** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SUREL2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **ATDCY2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VCREG2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWHI2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWLO2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FREHI2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FRELO2** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SUREL1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **ATDCY1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VCREG1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWHI1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWLO1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FREHI1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FRELO1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **READST** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold, oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader, oscar64-high-score-persist
- **DD0F** (Register) shared via recipe(s): oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader
- **DD0E** (Register) shared via recipe(s): oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader
- **DD07** (Register) shared via recipe(s): oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader
- **DD06** (Register) shared via recipe(s): oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader
- **DD05** (Register) shared via recipe(s): oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader
- **DD04** (Register) shared via recipe(s): oscar64-save-load-seq-file, kickassembler-file-io-roundtrip, oscar64-directory-reader
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.

```

What the warnings mean for this program:

- GETIN shared by two_word_parser and text_input_line: one reader. The input
  line pops the KERNAL queue (the bytes GETIN's LP2 at `$E5B4` moves, without
  its `CLI`); the parser only reads the finished line.
- SCROLY (text_input_line, frame_sync_loop): read only (raster bit 8 is not
  used; the loop polls line 250 in `$D012`).
- VMCSB ($D018) for petscii_screen_code_conversion, mcm_text and
  charset_copy_rom_to_ram: written once at start-up, `$1E` (screen `$0400`,
  characters `$3800`), never again.
- CHROUT and the file routines: all disk calls are made from one place
  (`save.c`) on a frame outside the meter, never while another channel is
  open.
- EXTCOL (frame_sync_loop, raster_profile_bars): the border is written only
  by the verdict.

## Budget

Command: `npx tsx src/cli.ts plan-budget adventure_database_engine two_word_parser text_input_line petscii_screen_code_conversion decimal_print mcm_text charset_copy_rom_to_ram:init kernal_file_write_seq:transition kernal_file_read_seq:transition error_channel_check:transition frame_sync_loop sid_voice_setup raster_profile_bars --region both --screen on`

```text
# Budget plan: undetermined

Techniques: adventure_database_engine, two_word_parser, text_input_line, petscii_screen_code_conversion, decimal_print, mcm_text, charset_copy_rom_to_ram:init, kernal_file_write_seq:transition, kernal_file_read_seq:transition, error_channel_check:transition, frame_sync_loop, sid_voice_setup, raster_profile_bars

## play (PAL, 19656 cycles a frame): undetermined

Range 19004 + 1075 fixed cycles; floor 0; weakest basis estimated; IRQ slots 0.

Summed:
- adventure_database_engine: 14908 (measured-vice, on oscar64-adventure-engine (one command's parse and turn, PAL, display on))
- two_word_parser: 2036 (measured-vice, on oscar64-two-word-parser (one command's parse, worst of ten, PAL, display on))
- text_input_line: 200 (estimated, recipe not stated)
- petscii_screen_code_conversion: 32 (measured-vice, on oscar64-petscii-screen-codes (one call, longest path))
- decimal_print: 1361 (measured-vice, on oscar64-print-number (one call, worst decimal case))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

To measure:
- mcm_text: no **Cost:** line; no recipe yet
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- sid_voice_setup: no **Cost:** line; measure it on oscar64-sid-music-player

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because text_input_line, petscii_screen_code_conversion, decimal_print, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: adventure_database_engine, two_word_parser were measured with the screen on and already hold the stalls that fell inside them, so the charge is too high by that much and the over test counts 0.
- The low end, 19004 + 1075, passes the 19656-cycle frame, but it is not a floor: the figures of adventure_database_engine, two_word_parser, text_input_line, petscii_screen_code_conversion, decimal_print, raster_profile_bars are a common frame or a real run's worst, and those frames need not fall together. adventure_database_engine, two_word_parser, text_input_line, petscii_screen_code_conversion, decimal_print, raster_profile_bars have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: mcm_text, frame_sync_loop, sid_voice_setup have no cycles figure, so the verdict cannot be fits.

## play (NTSC, 17095 cycles a frame): undetermined

Range 19004 + 1075 fixed cycles; floor 0; weakest basis estimated; IRQ slots 0.

Summed:
- adventure_database_engine: 14908 (measured-vice, on oscar64-adventure-engine (one command's parse and turn, PAL, display on))
- two_word_parser: 2036 (measured-vice, on oscar64-two-word-parser (one command's parse, worst of ten, PAL, display on))
- text_input_line: 200 (estimated, recipe not stated)
- petscii_screen_code_conversion: 32 (measured-vice, on oscar64-petscii-screen-codes (one call, longest path))
- decimal_print: 1361 (measured-vice, on oscar64-print-number (one call, worst decimal case))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

To measure:
- mcm_text: no **Cost:** line; no recipe yet
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- sid_voice_setup: no **Cost:** line; measure it on oscar64-sid-music-player

Notes:
- Fixed losses 1075 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3; arithmetic) charged because text_input_line, petscii_screen_code_conversion, decimal_print, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: adventure_database_engine, two_word_parser were measured with the screen on and already hold the stalls that fell inside them, so the charge is too high by that much and the over test counts 0.
- The low end, 19004 + 1075, passes the 17095-cycle frame, but it is not a floor: the figures of adventure_database_engine, two_word_parser, text_input_line, petscii_screen_code_conversion, decimal_print, raster_profile_bars are a common frame or a real run's worst, and those frames need not fall together. adventure_database_engine, two_word_parser, text_input_line, petscii_screen_code_conversion, decimal_print, raster_profile_bars have no typical frame, so their low end is a worst frame. The floor, work every frame plus the loss no figure can hold, is 0 and fits. A frame measured whole, with every member running, would settle it.
- Unknown is not zero: mcm_text, frame_sync_loop, sid_voice_setup have no cycles figure, so the verdict cannot be fits.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## transition (PAL, 19656 cycles a frame): undetermined

Range 0 cycles; floor 0; weakest basis (nothing summed); IRQ slots 0.

To measure:
- kernal_file_write_seq: no **Cost:** line; measure it on kickassembler-file-io-roundtrip
- kernal_file_read_seq: no **Cost:** line; measure it on kickassembler-file-io-roundtrip
- error_channel_check: no **Cost:** line; measure it on kickassembler-dos-error-codes

Notes:
- Unknown is not zero: kernal_file_write_seq, kernal_file_read_seq, error_channel_check have no cycles figure, so the verdict cannot be fits.
- The transition phase is judged against one frame too; a transition that takes several frames drops frames, which may be acceptable there.

## transition (NTSC, 17095 cycles a frame): undetermined

Range 0 cycles; floor 0; weakest basis (nothing summed); IRQ slots 0.

To measure:
- kernal_file_write_seq: no **Cost:** line; measure it on kickassembler-file-io-roundtrip
- kernal_file_read_seq: no **Cost:** line; measure it on kickassembler-file-io-roundtrip
- error_channel_check: no **Cost:** line; measure it on kickassembler-dos-error-codes

Notes:
- Unknown is not zero: kernal_file_write_seq, kernal_file_read_seq, error_channel_check have no cycles figure, so the verdict cannot be fits.
- The transition phase is judged against one frame too; a transition that takes several frames drops frames, which may be acceptable there.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## init (PAL, 19656 cycles a frame): undetermined

Range 0 cycles; floor 0; weakest basis (nothing summed); IRQ slots 0.

To measure:
- charset_copy_rom_to_ram: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on kickassembler-charset-copy-rom-to-ram

Notes:
- Unknown is not zero: charset_copy_rom_to_ram has no cycles figure, so the verdict cannot be fits.
- The init phase is judged against one frame too; an init that takes several frames drops frames, which may be acceptable there.

## init (NTSC, 17095 cycles a frame): undetermined

Range 0 cycles; floor 0; weakest basis (nothing summed); IRQ slots 0.

To measure:
- charset_copy_rom_to_ram: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on kickassembler-charset-copy-rom-to-ram

Notes:
- Unknown is not zero: charset_copy_rom_to_ram has no cycles figure, so the verdict cannot be fits.
- The init phase is judged against one frame too; an init that takes several frames drops frames, which may be acceptable there.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

Sum 2118 over charset_copy_rom_to_ram; a floor, since adventure_database_engine, two_word_parser, text_input_line, petscii_screen_code_conversion, decimal_print, mcm_text, kernal_file_write_seq, kernal_file_read_seq, error_channel_check, sid_voice_setup, raster_profile_bars state no bytes.
- frame_sync_loop: 985 bytes left out, the whole program, not the technique

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.

```

The tool sums one command's parse and turn (14,908 from the recipe, which
also decoded and printed its text inside the turn) with a separate parse
(2,036) into every play frame: 19,004 + 1,075. Neither is this program's
frame. Here a frame does one bounded job: take typed keys (and, on RETURN,
parse and run the turn, which only queues message numbers); or draw the
room picture; or print one line of the window (scroll 13 rows of screen and
colour RAM, then decode and word-wrap one line). The recipe's PRINT figure
(109,866 cycles for one command's output) is why the text is printed a line
a frame. The meter settles the real figure; mcm_text, frame_sync_loop and
sid_voice_setup have no cost line and are measured only inside the whole
frame. The disk calls run on frames outside the meter's bracket (the
transition phase), as the harness allows.

## Memory and screen

- Code and data `$0880`-`$37FF`, then `$4000`-`$9FFF` if it grows (two
  Oscar64 regions). Character set `$3800`-`$3FFF`: codes 0-63 the ROM
  letters, 64-127 the picture tiles (multicolour), 128-255 the ROM reverse
  glyphs. `$D018` = `$1E`. Screen `$0400`.
- Rows 0-6 the picture strip (colour RAM 8-15: multicolour); row 7 the status
  bar; rows 8-21 the text window; row 22 a rule; row 23 the input line; row 24
  the verdict (columns 0-19) and the meter (20-39) in AUTOPILOT builds. Text
  colours are 0-7 so those cells stay hires under MCM.
- `$D021` black, `$D022` grey, `$D023` brown: shared by every picture.
- The KERNAL IRQ is off (CIA1 interrupts masked), so its `CLI`s are harmless;
  the loop calls SCNKEY (`$FF9F`) itself once a frame.

## Autopilot and checks

- The script is a list of commands in `tools/world.py`. Each frame at the
  input line the autopilot puts up to ten bytes of the next command and its
  RETURN into the KERNAL keyboard queue (`$0277`, count `$C6`), the bytes
  SCNKEY puts there for a real key; the input line reads them back the same
  way it reads a typist.
- The script walks the whole game: an unknown word, synonyms, a locked door,
  containers opened and emptied, the dark cellar, SAVE, a mistake, LOAD, and
  the ending at 100 points.
- `tools/gen.py` runs the same script through a Python model of the engine and
  printer and writes what the game must end with: room, item locations,
  flags, score, turns, a fold of every printed window line, and the play
  frames (one per metered frame). The verdict compares, then sets `$02FF` and
  the border. FORCE_FAULT scores one point less for the lens, so the status
  bar, the ending line and the verdict change.
- `expect.json`: the verdict, the ending lines in the window, the status bar,
  the input line, picture-strip cells of the tower, PAL = NTSC over the text
  rows, and the meter with the model's frame count.
- The shot runs with a copy of the release D64 in a true-drive 1541, so SAVE
  and LOAD in the script really write and read the disk. `make disktest`
  proves save, cold reset, load and the same state back.

## Decisions and open questions

- Text is packed by `tools/gen.py` at build time; the plain text is not in
  the PRG. The first plan was a dictionary of common words; see below.
- Settled: the colour scroll went. With it the worst frame was 22,000
  cycles on PAL and 22,087 on NTSC (meter); the typed command now shows in
  reverse video and the window's colour RAM stays fixed.
- Measured (`make shot check`, 251 play frames, after the review's fixes):
  worst 15,272 and typical 8,543 cycles on PAL; 15,488 and 8,842 on NTSC.
  The worst is a window line (scroll plus decode). README.md, "The measured
  frame", compares it with the budget above.
- Corrected in review: the first worst figure (15,262 / 15,476) left out
  the library picture, which the script never drew: 20,240 cycles, over the
  frame on both models. Pictures are now coded as runs and literals row by
  row (the dearest, the garden, 12,483 PAL / 12,739 NTSC), and gen.py
  refuses a script that does not show every picture.
- Settled: byte-pair packing of the text, 40.2 % smaller than C strings
  with pointers; a word dictionary saved 18 % (tools/gen.py, arithmetic).
- Settled: the title and the ending act on a new fire press. Found with
  tools/drive.py: a held fire at the ending went to the title and started a
  new game.
