# Plan: hello-kick

hello in KickAssembler alone, to prove the harness's pure-KickAssembler
path and the KickAssembler frame meter. The minimal starter. It exists to prove the harness end to end, so its plan
is small. The tool output below was produced on 2026-09-23 by c64-kb 0.13.0
(KB data 756) and pasted whole.

## Concept

One hardware sprite, moved by joystick port 2, fire toggles its colour. The
frame's work is timed by the harness meter's KickAssembler macros. PAL and
NTSC.

## Briefing

No briefing was run for hello: its techniques were chosen to exercise the
harness, not proposed by a brief. A real starter runs
`npx tsx src/cli.ts game-briefing "<concept>" --archetype <name>` here.

## Techniques

| Technique | Why | Recipe it starts from | Pitfalls read (`pitfalls-for`) |
|---|---|---|---|
| frame_sync_loop | one pass of the loop a frame, synced on raster line 250 | oscar64-frame-sync-loop (ported) | badline_cycle_loss, d012_wrap_around, raster_line_count_difference, vic_colour_register_upper_nibble_reads_set, and the rest of its list |
| joystick_edge_detect | fire toggles the colour once per press, not once per frame | oscar64-joystick-input, oscar64-headless-verify (the autopilot) | cia1_ddr_cleared_kills_keyboard, colour_ram_index_past_last_cell_hits_cia1, joystick2_scan_phantom_press |
| raster_profile_bars | the frame meter is its CIA-timed half, on CIA2 timer A | oscar64-raster-profile-bars | badline_cycle_loss, vic_bus_takeover_on_dma, vic_colour_register_upper_nibble_reads_set |

## Compatibility

Command: `npx tsx src/cli.ts check-compatibility frame_sync_loop joystick_edge_detect raster_profile_bars`

```text
# Compatibility: frame_sync_loop + joystick_edge_detect + raster_profile_bars

**Verdict:** WARNINGS

Unit claims are stated for 1 of 3 techniques; a unit conflict cannot be ruled out for: frame_sync_loop, raster_profile_bars. The zero-page bytes and interrupt vectors a recipe chooses are not checked yet (issue #22, step 8).

## shared_register (soft): frame_sync_loop × raster_profile_bars
**Shared:** EXTCOL
Both techniques touch register(s) EXTCOL. This says they write the same registers, not that they fight: keep each one's writes in its own raster region, or have one of them own the register and the other read a shadow copy.


## Shared Infrastructure (info)
- **CLRCHN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKOUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHKIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CLOSE** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **OPEN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETNAM** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **SETLFS** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **DC0F** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC07** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC06** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP6COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP5COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP4COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP3COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP2COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP1COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SP0COL** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **BGCOL0** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks
- **EXTCOL** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks
- **IRQMSK** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **VICIRQ** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **SPENA** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **RASTER** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks
- **SCROLY** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks
- **MSIGX** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **M0Y** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **M0X** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **RANDOM** (Register) shared via recipe(s): oscar64-platformer-scaffold
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
- **DC03** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **DC02** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWHI1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **PWLO1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FREHI1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **FRELO1** (Register) shared via recipe(s): oscar64-platformer-scaffold
- **READST** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **DC00** (Register) shared via recipe(s): oscar64-platformer-scaffold, oscar64-falling-blocks
- **CHRIN** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **CHROUT** (KernalRoutine) shared via recipe(s): oscar64-platformer-scaffold
- **DC0E** (Register) shared via recipe(s): oscar64-falling-blocks
- **DC05** (Register) shared via recipe(s): oscar64-falling-blocks
- **DC04** (Register) shared via recipe(s): oscar64-falling-blocks
- **raster_discipline**: Multiple raster-discipline techniques present. Verify IRQ stack ordering and timing budget.
```

What the warnings mean for this program:

- EXTCOL shared by frame_sync_loop and raster_profile_bars: hello uses no
  border bars; only the verdict writes `$D020`, once.
- The shared-infrastructure list comes from another recipe
  (platformer-scaffold) that uses these techniques; hello calls no KERNAL
  routine after `SEI`.

## Budget

Command: `npx tsx src/cli.ts plan-budget frame_sync_loop joystick_edge_detect raster_profile_bars --region both --sprites 1 --sprite-lines 21`

```text
# Budget plan: undetermined

Techniques: frame_sync_loop, joystick_edge_detect, raster_profile_bars

## play (PAL, 19656 cycles a frame): undetermined

Range 467 + 1180 fixed cycles; floor 1180; weakest basis measured-vice; IRQ slots 0.

Summed:
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

To measure:
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-attract-replay

Notes:
- Fixed losses 1180 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 105; arithmetic) charged because raster_profile_bars is not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Unknown is not zero: frame_sync_loop, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.

## play (NTSC, 17095 cycles a frame): undetermined

Range 467 + 1180 fixed cycles; floor 1180; weakest basis measured-vice; IRQ slots 0.

Summed:
- raster_profile_bars: 467 (measured-vice, on oscar64-raster-profile-bars (worst frame, screen blanked))

To measure:
- frame_sync_loop: the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active); measure it on oscar64-frame-sync-loop
- joystick_edge_detect: no **Cost:** line; measure it on oscar64-attract-replay

Notes:
- Fixed losses 1180 cycles (badlines 25 × 43 = 1075, lines 51-243 every eighth with YSCROLL 3, sprite DMA 105; arithmetic) charged because raster_profile_bars is not stated as measured with the screen on. A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall.
- Unknown is not zero: frame_sync_loop, joystick_edge_detect have no cycles figure, so the verdict cannot be fits.
- Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.

## Bytes

No member states a byte figure that can be summed.
- frame_sync_loop: 985 bytes left out, the whole program, not the technique

## Assumptions

- Region PAL and NTSC: PAL 19656, NTSC 17095 cycles a frame.
- Screen on: unless every summed figure says it was measured with the screen on, the 25 badlines × 43 cycles outside any band charge are charged.
- Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.
- Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.
- Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.
- Sprites: 1 a line on 21 lines, (3 + 2 × 1) × 21 = 105 cycles of DMA a frame (3 + 2n measured in VICE x64sc for sprites numbered without gaps).
```

Measured by the meter (`make shot check`, VICE x64sc 3.10, 200 frames): worst
453 cycles (the frame that grades the result and prints it), typical 136,
the same on PAL and NTSC. The bracket runs from line 250 in the lower border,
so no badline and no sprite DMA lands in it; the plan's 1,180 fixed cycles are
real but fall outside the bracket.

## Memory and screen

- `$0340-$037E` sprite 0's image (block 13, the tape buffer).
- `$0801` up: the program, then the meter's code and variables
  (`FrameMeterCode`, no zero page).
- `$0400` screen, power-on character set. Row 24, columns 20 to 39: the meter.
- `$02FF` the verdict byte. CIA2 timer A: the meter.

## Autopilot and checks

Script (frames, port byte): 30 idle, 64 right, 40 down, 16 fire, 24 up and
right, then idle. End state by arithmetic: sprite X 188, Y 116, cyan. Frame 180
reads the sprite registers back, stores the verdict at `$02FF` and sets the
border. `expect.json` checks the border, the title and verdict text, the
sprite's corners and the pixels beside it, rows 0 to 23 identical on PAL and
NTSC, and the meter (200 frames recorded, worst within one frame).

## Decisions and open questions

- `SEI` at start: no KERNAL interrupt lands inside the meter's bracket.
