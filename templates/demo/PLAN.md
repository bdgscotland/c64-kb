# Plan: demo

A one-part demo skeleton in KickAssembler alone, built to be extended into a
real demo: a part table, a table-driven raster IRQ chain per part, a stable
raster kernel, and a transition between parts. The tool output below was
produced on 2026-09-23 by c64-kb 0.15.0 (KB data 764) and pasted whole.

## Concept

A title card plays for 60 frames and is wiped off two columns a frame.
The main part follows: a character logo, eight sprites riding a sine chain
under it, four moving raster bars drawn line by line from a stable raster
IRQ, and a 1x1 scroller on row 22. An original three-voice SID tune plays
once a frame throughout. No input: a demo runs by itself. PAL and NTSC,
detected at start.

## Briefing

Command: `npx tsx src/cli.ts demo-briefing --archetype demo_intro "one-part demo: character logo with an eight-sprite sine chain, stable raster bars, 1x1 scroller at the bottom, original SID tune, part table with a screen wipe transition between a title card and the main part. PAL and NTSC."`

Kept from its 13 proposals: sprite_sine_chain, irq_chain_table,
stable_raster_irq, char_scroll_buffer_h, sid_play_routine_pattern,
pal_ntsc_detection, raster_profile_bars (the harness meter is its CIA-timed
half). Added: raster_bars (the brief names bars; the briefing offered
raster_profile_bars for "raster colour effect" instead) and screen_wipe (the
transition the brief names; the briefing did not propose it).

Dropped: colour_fade (the wipe is the transition; the README names the fade
as the alternative), soft_scroll_h (its only Cost figure is a 25-row
memmove, 74,041 cycles; the scroller here moves one row, which is
char_scroll_buffer_h), dypp_sprite_sine_scroller, sprite_border_scroller and
dycp_scroller (three more scrollers; the brief asks for one 1x1),
tile_map_render (no tile map in a demo part).

Pitfalls it named that this program meets, and what the code does:
badline_cycle_loss (the bar kernel has a shorter line body on every
badline), decimal_mode_in_irq_handler (`cld` in the dispatcher),
d012_wrap_around (every slot line is below 256; an assert refuses a stable
slot that is not), raster_irq_first_line_jitter (the bars use the double
IRQ), pal_ntsc_tempo_mismatch (the player skips every sixth call on NTSC and
has a frequency table per model), xscroll_applies_to_all_rows and
d016_unmasked_rmw_clobbers_csel_mcm (a slot sets `$D016` for row 22 only;
the frame slot writes the whole value back), sprite_x_high_bit_wrong_register
(`$D010` rebuilt every frame; the chain crosses X 255),
vic_bus_takeover_on_dma (no sprite on a bar line), and
branch_page_cross_extra_cycle (asserts on the branches in timed code).

## Techniques

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| irq_chain_table | one dispatcher walks a table of (line, handler) rows; each part names its own chain | kickassembler-irq-chain | decimal_mode_in_irq_handler, cia_icr_read_clears_all_flags, d012_wrap_around, irq_during_charen_window, badline_cycle_loss |
| stable_raster_irq | the bar kernel must start on one cycle so every colour write lands in the horizontal blank | kickassembler-stable-raster-irq | branch_page_cross_extra_cycle, sprite_dma_overflow, raster_irq_first_line_jitter, badline_cycle_loss |
| raster_bars | four moving bars, one colour per raster line, full width | kickassembler-raster-bars, kickassembler-colour-fade (the ramps) | badline_cycle_loss, d012_wrap_around, raster_irq_first_line_jitter, scroll_phase_breaks_panel_split |
| sprite_sine_chain | eight sprites phased along one sine table under the logo | kickassembler-sprite-sine-chain | sprite_dma_overflow, sprite_x_high_bit_wrong_register, vic_bus_takeover_on_dma, sprite_registers_persist_across_state_change |
| char_scroll_buffer_h | the 1x1 scroller: XSCROLL for row 22, the row shifted every eighth frame | kickassembler-cracktro-template, kickassembler-sine-scroller | d016_unmasked_rmw_clobbers_csel_mcm, xscroll_applies_to_all_rows, colour_ram_index_past_last_cell_hits_cia1 |
| sid_play_routine_pattern | an original tune behind the `$1000` init / `$1003` play convention, called once a frame | oscar64-sid-music-player | pal_ntsc_tempo_mismatch, sid_adsr_bug_8580, sid_filter_chip_variation |
| screen_wipe | the out-transition of the title card, two columns a frame | kickassembler-screen-wipe | colour_ram_index_past_last_cell_hits_cia1, pal_ntsc_tempo_mismatch, badline_cycle_loss |
| pal_ntsc_detection | picks the bar kernel, the sync padding, the tune's frequency table and the NTSC tempo skip | oscar64-pal-ntsc-detect | cia_timer_phi2_difference, d012_wrap_around, pal_ntsc_tempo_mismatch |
| raster_profile_bars | the frame meter (CIA2 timer A) around every IRQ, summed with METER_PAUSE | oscar64-raster-profile-bars | badline_cycle_loss, vic_bus_takeover_on_dma, vic_colour_register_upper_nibble_reads_set |

## Compatibility

Command: `npx tsx src/cli.ts check-compatibility irq_chain_table stable_raster_irq raster_bars sprite_sine_chain char_scroll_buffer_h sid_play_routine_pattern screen_wipe pal_ntsc_detection raster_profile_bars`

```text
# Compatibility: irq_chain_table + stable_raster_irq + raster_bars + sprite_sine_chain + char_scroll_buffer_h + sid_play_routine_pattern + screen_wipe + pal_ntsc_detection + raster_profile_bars

**Verdict:** INCOMPATIBLE — not as combined; each hard conflict below says how to separate them.

Checked with 2 implied prerequisite(s): frame_sync_loop, sid_voice_setup.

Unit claims are stated for 5 of 9 techniques; a unit conflict cannot be ruled out for: char_scroll_buffer_h, screen_wipe, pal_ntsc_detection, raster_profile_bars, frame_sync_loop (prerequisite), sid_voice_setup (prerequisite). The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## unit_shared (soft): irq_chain_table × stable_raster_irq
**Shared:** vic_raster_irq
irq_chain_table owns the raster compare; stable_raster_irq runs inside irq_chain_table's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of irq_chain_table's handler or as one more entry in irq_chain_table's chain, not as a second interrupt setup.

## shared_register (soft): irq_chain_table × stable_raster_irq
**Shared:** IRQMSK, VICIRQ, RASTER, SCROLY
Both techniques touch register(s) IRQMSK, VICIRQ, RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_contention (hard): irq_chain_table × raster_bars
**Shared:** vic_raster_irq
Both irq_chain_table and raster_bars own vic_raster_irq: each writes or holds it every frame and expects no one else to.
**Resolution:** irq_chain_table is the host: rewrite raster_bars's raster handler(s) as entries in irq_chain_table's table, so the table alone programs $D012 and raster_bars runs inside it.

## shared_register (soft): irq_chain_table × raster_bars
**Shared:** EXTCOL, VICIRQ, RASTER
Both techniques touch register(s) EXTCOL, VICIRQ, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): irq_chain_table × sprite_sine_chain
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): irq_chain_table × screen_wipe
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): irq_chain_table × pal_ntsc_detection
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): irq_chain_table × raster_profile_bars
**Shared:** EXTCOL
Both techniques touch register(s) EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## unit_shared (soft): stable_raster_irq × raster_bars
**Shared:** vic_raster_irq
raster_bars owns the raster compare; stable_raster_irq runs inside raster_bars's raster interrupt and does not arm $D012 on its own.
**Resolution:** Run stable_raster_irq as the entry of raster_bars's handler or as one more entry in raster_bars's chain, not as a second interrupt setup.

## shared_register (soft): stable_raster_irq × raster_bars
**Shared:** VICIRQ, RASTER
Both techniques touch register(s) VICIRQ, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): stable_raster_irq × sprite_sine_chain
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): stable_raster_irq × screen_wipe
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): stable_raster_irq × pal_ntsc_detection
**Shared:** RASTER, SCROLY
Both techniques touch register(s) RASTER, SCROLY. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_bars × sprite_sine_chain
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_bars × screen_wipe
**Shared:** BGCOL0, RASTER
Both techniques touch register(s) BGCOL0, RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_bars × pal_ntsc_detection
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): raster_bars × raster_profile_bars
**Shared:** EXTCOL
Both techniques touch register(s) EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_sine_chain × screen_wipe
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): sprite_sine_chain × pal_ntsc_detection
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.

## shared_register (soft): screen_wipe × pal_ntsc_detection
**Shared:** RASTER
Both techniques touch register(s) RASTER. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.


## Shared Infrastructure (info)
- **frame_sync_loop** (prerequisite, not in the set): required by raster_profile_bars; included in the check as implied. Set it up first.
- **sid_voice_setup** (prerequisite, not in the set): required by sid_play_routine_pattern; included in the check as implied. Set it up first.
- **DC0F** (Register) shared via recipe(s): kickassembler-tech-tech
- **DC0E** (Register) shared via recipe(s): kickassembler-tech-tech, kickassembler-dysp
- **DC07** (Register) shared via recipe(s): kickassembler-tech-tech
- **DC06** (Register) shared via recipe(s): kickassembler-tech-tech
- **DC05** (Register) shared via recipe(s): kickassembler-tech-tech, kickassembler-dysp
- **DC04** (Register) shared via recipe(s): kickassembler-tech-tech, kickassembler-dysp
- **BGCOL0** (Register) shared via recipe(s): kickassembler-tech-tech, oscar64-raster-bars, kickassembler-cracktro-template
- **EXTCOL** (Register) shared via recipe(s): kickassembler-tech-tech, oscar64-raster-bars, kickassembler-cracktro-template
- **IRQMSK** (Register) shared via recipe(s): kickassembler-tech-tech, kickassembler-dysp, kickassembler-cracktro-template
- **VICIRQ** (Register) shared via recipe(s): kickassembler-tech-tech, oscar64-raster-bars, kickassembler-dysp, kickassembler-cracktro-template
- **VMCSB** (Register) shared via recipe(s): kickassembler-tech-tech, kickassembler-cracktro-template
- **SCROLX** (Register) shared via recipe(s): kickassembler-tech-tech, kickassembler-dysp, kickassembler-cracktro-template
- **RASTER** (Register) shared via recipe(s): kickassembler-tech-tech, oscar64-raster-bars, kickassembler-dysp, kickassembler-cracktro-template
- **SCROLY** (Register) shared via recipe(s): kickassembler-tech-tech, kickassembler-dysp, kickassembler-cracktro-template
- **SP3COL** (Register) shared via recipe(s): kickassembler-dysp
- **SP2COL** (Register) shared via recipe(s): kickassembler-dysp
- **SP1COL** (Register) shared via recipe(s): kickassembler-dysp
- **SP0COL** (Register) shared via recipe(s): kickassembler-dysp
- **XXPAND** (Register) shared via recipe(s): kickassembler-dysp
- **SPMC** (Register) shared via recipe(s): kickassembler-dysp
- **YXPAND** (Register) shared via recipe(s): kickassembler-dysp
- **SPENA** (Register) shared via recipe(s): kickassembler-dysp
- **MSIGX** (Register) shared via recipe(s): kickassembler-dysp
- **M3Y** (Register) shared via recipe(s): kickassembler-dysp
- **M3X** (Register) shared via recipe(s): kickassembler-dysp
- **M2Y** (Register) shared via recipe(s): kickassembler-dysp
- **M2X** (Register) shared via recipe(s): kickassembler-dysp
- **M1Y** (Register) shared via recipe(s): kickassembler-dysp
- **M1X** (Register) shared via recipe(s): kickassembler-dysp
- **M0Y** (Register) shared via recipe(s): kickassembler-dysp
- **M0X** (Register) shared via recipe(s): kickassembler-dysp
- **DC0D** (Register) shared via recipe(s): kickassembler-cracktro-template
- **DC00** (Register) shared via recipe(s): kickassembler-cracktro-template
- **SIGVOL** (Register) shared via recipe(s): kickassembler-cracktro-template
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

What the warnings mean for this program:

- irq_chain_table x raster_bars, hard (both own vic_raster_irq): taken as the
  tool says. The bars are not a ring of their own; they are one row of the
  main part's chain, and only the dispatcher's table programs `$D012`.
- irq_chain_table x stable_raster_irq and stable_raster_irq x raster_bars,
  unit_shared: the stable entry is a subroutine (`stabilise`) that a slot
  handler calls. It arms its second interrupt three lines on, then puts the
  line the table armed back before it returns.
- The shared_register notes (RASTER, SCROLY, EXTCOL, BGCOL0): the dispatcher
  owns `$D012` and `$D011` bit 7; the bar kernel owns `$D020`/`$D021` on the
  bar lines and puts the border colour back after the last one; the wipe
  writes screen RAM only; model detection reads `$D012` before the chain
  starts; the meter writes no VIC register.
- frame_sync_loop (implied prerequisite of raster_profile_bars): there is no
  polling loop; the frame slot at the end of every chain is the frame's one
  once-a-frame point. sid_voice_setup: the player sets its voices at init.

## Budget

Command: `npx tsx src/cli.ts plan-budget irq_chain_table stable_raster_irq raster_bars sprite_sine_chain char_scroll_buffer_h sid_play_routine_pattern screen_wipe:transition pal_ntsc_detection:init raster_profile_bars --region both --screen on --sprites 8 --sprite-lines 42`

```text
# Budget plan: undetermined

Techniques: irq_chain_table, stable_raster_irq, raster_bars, sprite_sine_chain, char_scroll_buffer_h, sid_play_routine_pattern, screen_wipe:transition, pal_ntsc_detection:init, raster_profile_bars

## play (PAL, 19656 cycles a frame): undetermined

Range 2381 + 1873 fixed cycles; floor 1873; weakest basis estimated; IRQ slots 16.

Summed:
- irq_chain_table: 273 (estimated, on kickassembler-irq-chain (three empty slots))
- stable_raster_irq: 124 (arithmetic, recipe not stated)
- raster_bars: 990 (estimated, recipe not stated)
- sprite_sine_chain: 200 (estimated, on kickassembler-sprite-sine-chain (eight sprites; not timed))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

To measure:
- char_scroll_buffer_h: no **Cost:** line; measure it on kickassembler-big-font-scroller

Notes:
- Fixed losses 1873 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 798; arithmetic) charged because irq_chain_table, stable_raster_irq, raster_bars, sprite_sine_chain, sid_play_routine_pattern, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Unknown is not zero: char_scroll_buffer_h has no cycles figure, so the verdict cannot be fits.

## play (NTSC, 17095 cycles a frame): undetermined

Range 2381 + 1873 fixed cycles; floor 1873; weakest basis estimated; IRQ slots 16.

Summed:
- irq_chain_table: 273 (estimated, on kickassembler-irq-chain (three empty slots))
- stable_raster_irq: 124 (arithmetic, recipe not stated)
- raster_bars: 990 (estimated, recipe not stated)
- sprite_sine_chain: 200 (estimated, on kickassembler-sprite-sine-chain (eight sprites; not timed))
- sid_play_routine_pattern: 327 (measured-vice, on oscar64-sfx-engine (the recipe's stub tune; a real player costs several times more))
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

To measure:
- char_scroll_buffer_h: no **Cost:** line; measure it on kickassembler-big-font-scroller

Notes:
- Fixed losses 1873 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 798; arithmetic) charged because irq_chain_table, stable_raster_irq, raster_bars, sprite_sine_chain, sid_play_routine_pattern, raster_profile_bars are not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Unknown is not zero: char_scroll_buffer_h has no cycles figure, so the verdict cannot be fits.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## transition (PAL, 19656 cycles a frame): fits

Range 709 + 1873 fixed cycles; floor 1873; weakest basis measured-vice; IRQ slots 0.

Summed:
- screen_wipe: 709 (measured-vice, on kickassembler-screen-wipe (one reveal step, worst row))

Notes:
- Fixed losses 1873 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 798; arithmetic) charged because screen_wipe is not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- The transition phase is judged against one frame too; a transition that takes several frames drops frames, which may be acceptable there.

## transition (NTSC, 17095 cycles a frame): fits

Range 709 + 1873 fixed cycles; floor 1873; weakest basis measured-vice; IRQ slots 0.

Summed:
- screen_wipe: 709 (measured-vice, on kickassembler-screen-wipe (one reveal step, worst row))

Notes:
- Fixed losses 1873 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 798; arithmetic) charged because screen_wipe is not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- The transition phase is judged against one frame too; a transition that takes several frames drops frames, which may be acceptable there.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## init (PAL, 19656 cycles a frame): undetermined

Range 0 cycles; floor 0; weakest basis (nothing summed); IRQ slots 0.

To measure:
- pal_ntsc_detection: no **Cost:** line; measure it on kickassembler-dysp

Notes:
- Unknown is not zero: pal_ntsc_detection has no cycles figure, so the verdict cannot be fits.
- The init phase is judged against one frame too; an init that takes several frames drops frames, which may be acceptable there.

## init (NTSC, 17095 cycles a frame): undetermined

Range 0 cycles; floor 0; weakest basis (nothing summed); IRQ slots 0.

To measure:
- pal_ntsc_detection: no **Cost:** line; measure it on kickassembler-dysp

Notes:
- Unknown is not zero: pal_ntsc_detection has no cycles figure, so the verdict cannot be fits.
- The init phase is judged against one frame too; an init that takes several frames drops frames, which may be acceptable there.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

Sum 1112 over raster_bars, sprite_sine_chain; a floor, since irq_chain_table, stable_raster_irq, char_scroll_buffer_h, sid_play_routine_pattern, screen_wipe, pal_ntsc_detection, raster_profile_bars state no bytes.

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
- Sprites: 8 a line on 42 lines, (3 + 2 × 8) × 42 = 798 cycles of DMA a frame (3 + 2n measured in VICE x64sc for sprites numbered without gaps).
```

What is unknown and how the meter settles it:

- raster_bars' 990 cycles is ten chained IRQs that spin one line each. This
  kernel holds the CPU from the stable slot's line to the last bar line:
  148 to 211, 63 lines, about 3,970 cycles on PAL by arithmetic, before the
  frame slot's work. Expect the meter well above the plan's 2,381 + 1,873.
- char_scroll_buffer_h has no figure; the scroller's shift frame (one row of
  39 moves) is in the meter's worst.
- The tune is original and bigger than the stub the sid_play_routine_pattern
  figure was measured on; the meter includes it.
- pal_ntsc_detection runs once before the chain; not in any frame.
- The meter brackets every IRQ from the dispatcher's first instruction to
  its exit (`METER_START` / `METER_PAUSE`) and the main loop records the sum
  once a frame (`FrameMeterEnd`). The KERNAL's 7 + 29 cycles of entry and the
  `$EA81` exit are outside the brackets.

## Memory and screen

- `$0801` BASIC stub, `$0810` up: start-up, the main loop, the framework,
  the part table, the title part. `$1000` up: the music player and tune
  (`$1000` init, `$1003` play). `$1400` up: the main part with its two bar
  kernels, the verdict, the meter, then the page-aligned tables.
- `$0340-$037F`: the sprite image (block 13, the tape buffer), copied there
  at start.
- Screen `$0400`, the power-on character set. Row 24 columns 0 to 18: the
  verdict line; columns 20 to 39: the meter (AUTOPILOT builds).
- Raster layout of the main part (PAL and NTSC use the same lines): logo
  rows 0 to 4 and subtitle row 5 (lines 51 to 98), sprites on lines 101 to
  145, the stable slot at 148, bars on lines 155 to 210 (rows 13 to 19 are
  blank cells), scroller on row 22 (lines 227 to 234), meter and verdict on
  row 24. (An earlier version of this plan said logo rows 1 to 6 and bars
  153 to 208: the layout before the kernel's lead was measured.)
- Zero page: none of the program's own. `$02FF`: the verdict byte. CIA2
  timer A: the meter.

## Autopilot and checks

A demo has no input, so the AUTOPILOT script is the timeline itself: title
card 60 frames, wipe 20 frames, then the main part. At the main part's
156th update (XSCROLL 3) the AUTOPILOT build freezes every animation (the chain keeps
drawing the same frame) and the main loop grades: part 1 running, the wipe
finished and the title's teardown run, the eight sprites' registers against
positions the assembler computed from the sine formula, the scroller's
XSCROLL, message index and the 38 cells of row 22 against the message, the
bar colour table against the table the assembler computed, and the music's
call count against the frame count (every frame on PAL, five in six on
NTSC). `$02FF` = `$01` and a green border on pass, `$02` and red on fail.
FORCE_FAULT starts the sprite chain sixteen sine steps ahead: the verdict and
the sprite checks fail together.

`expect.json` is written by `tools/gen_expect.py` from the same constants,
computed again in Python: the verdict, the logo and subtitle, the
scroller's ink pixels at XSCROLL 3 and its 38-column border, every bar line as a full-width one-line rect (pixel-exact left border
to right border), the lines above and below the bars, eight sprite boxes,
the title card's cells now blank, rows 0 to 23 the same on PAL and NTSC,
and the meter with its frame count.

## Decisions and open questions

- KERNAL left in, IRQs through `$0314` and out through `$EA81`, as the
  recipes measure them. A part that banks the KERNAL out must move the
  dispatcher to `$FFFE` and re-measure the sync padding.
- Part init runs in the main loop (Spindle calls this `prepare`), with the
  frame slot alone playing the music, so a heavy init never stops the tune.
- The meter's `hold` (232) covers the title, the wipe and the main part up
  to the freeze; 150 of the 232 are main-part frames, so the median is one.

## Measured

`make shot check`, VICE x64sc 3.10, 232 recorded frames: PAL worst 7,332,
typical 6,586; NTSC worst 7,480, typical 6,734. (The first build read 7,171
/ 6,473 and 7,351 / 6,612; the review's fixes moved code and made part 1's
init clear the screen, and the dispatcher's lateness counters add about 30
cycles an IRQ.) README.md, "The measured
frame", has the per-phase samples and the comparison with plan-budget.
- Open: the sync padding and the kernel's lead are measured in VICE x64sc
  3.10 only, on the 6569 and 6567R8 models. Not on hardware.
