# Compatibility census of the visual techniques (issue #55, item 1)

Recorded 2026-09-24 at 06542bd (main f781473 plus the #99 and #93 commits), from a throwaway
graph ingested from that tree (0 dropped references). Not ingested:
`src/ingest/files.ts` skips `docs/superpowers/`.

## What was asked

Issue #55, proposal source 1: a pairwise `check-compatibility` census
over the visual techniques (categories effect, raster, bitmap) that
ranks pairs and triples which are COMPATIBLE or WARNINGS (soft conflicts
only), fit `plan-budget`, and appear together in no recipe. This is the
candidate list for the scout and judge stages; nothing below has been
built or measured as a combination.

## Method

1. The technique set is `techniques-for --category` for effect (21),
   raster (19) and bitmap (12): 52 techniques.
2. Every pair (1326) went through `checkCompatibility` (the function behind
   `check-compatibility`). Verdicts: 371 COMPATIBLE, 769
   WARNINGS, 186 INCOMPATIBLE.
3. Each COMPATIBLE or WARNINGS pair went through `planBudgetTool` (the
   function behind `plan-budget`), PAL, screen on, both in the play phase:
   249 fit, 891 undetermined (a member has no cycle figure),
   none over.
4. A pair was dropped as recorded when a Recipe has IMPLEMENTS edges to
   both (58 pairs), when one recipe page in `docs/recipes/` names both
   snake_case names (17 more), or when one technique REQUIRES the other
   (up to four hops) or lists it under `**Cost includes:**` (13 more).
   1052 pairs are left: 221 that fit and 831 undetermined.
5. Ranking, in this order: fits before undetermined; no infrastructure or
   primitive member before one or two (infrastructure: `stable_raster_irq`,
   `double_irq`, `frame_sync_loop`, `irq_chain_table`,
   `pal_ntsc_detection`, `clock_slide_raster_irq`,
   `badline_synchronization`, `raster_profile_bars`; primitives: the plot,
   line and circle routines, the plain bitmap and text modes and
   `koala_format`), since every effect recipe already stands on them; then
   fewer of the four transitions (`colour_fade`, `screen_wipe`,
   `screen_dissolve_lfsr`, `colour_cycling`); COMPATIBLE before WARNINGS;
   fewer soft conflicts; two categories before one; more PAL frame left.
   The ranking rule is this census's judgement, not a tool's output.
6. Triples: every three techniques whose three pairs are all in the
   fitting list with no infrastructure or primitive member (187) went
   through both tools as a set: 180 WARNINGS and fit, 7 WARNINGS and
   undetermined, none COMPATIBLE. Triples with more than one
   transition are left out below; 104 remain.

The scratch scripts that did this read the graph through the same
functions the MCP tools call; they are not in the repository.

## What the tools cannot see

- A WARNINGS pair shares a register (`shared_register`) or a hardware
  unit under one owner's protocol (`unit_shared`, `prerequisite_conflict`
  on the raster IRQ). Each is a scheduling problem, not a refusal: the
  tool's resolution text says who writes first. Same-line merges are
  proposal source 2 and need the frame compiler.
- `plan-budget` sums each member's stated cost. It does not know that
  two per-line techniques cannot share raster lines unless a Cost line or
  a `cpu_every_line` claim says so. Pair 2 below (`vector_balls_sprites`
  with `fli_image`) passes both tools, yet `check-compatibility` itself
  says, for FLI against another per-line technique, that FLI needs every
  CPU cycle of lines 45 to 251: the balls' sprite updates must fit in the lines FLI leaves.
  The judge stage has to read each candidate, not trust the rank.
- A pair can be novel for this corpus and old for the scene. Novelty here
  is against `docs/techniques` and `docs/recipes` only, as #55 says.

## Pairs that fit, no infrastructure or primitive member

84 pairs. Cycles are `plan-budget`'s high figure for the play
phase on PAL (frame 19,656).

| # | Pair | Categories | Verdict | Soft conflicts | Predicted cycles a PAL frame |
|---|---|---|---|---|---|
| 1 | `vector_balls_sprites` + `topbottom_border_open` | effect, raster | COMPATIBLE | none | 1,760 |
| 2 | `vector_balls_sprites` + `fli_image` | effect, bitmap | COMPATIBLE | none | 14,430 |
| 3 | `dot_flag_sine_plotter` + `raster_bars` | effect, raster | COMPATIBLE | none | 17,569 |
| 4 | `dot_flag_sine_plotter` + `vector_balls_sprites` | effect, effect | COMPATIBLE | none | 17,487 |
| 5 | `vector_balls_sprites` + `mci_interlace_bitmap` | effect, bitmap | WARNINGS | shared_register RASTER | 1,439 |
| 6 | `vector_balls_sprites` + `sprites_only_screen_mode` | effect, raster | WARNINGS | shared_register RASTER | 2,145 |
| 7 | `vector_balls_sprites` + `raster_bars` | effect, raster | WARNINGS | shared_register RASTER | 2,860 |
| 8 | `vector_balls_sprites` + `fld_flexible_line_distance` | effect, raster | WARNINGS | shared_register RASTER | 3,909 |
| 9 | `vector_balls_sprites` + `kefrens_bars` | effect, raster | WARNINGS | shared_register RASTER | 12,162 |
| 10 | `twister` + `topbottom_border_open` | effect, raster | WARNINGS | shared_register SCROLY | 13,932 |
| 11 | `twister` + `sprites_only_screen_mode` | effect, raster | WARNINGS | shared_register SCROLY/RASTER | 14,317 |
| 12 | `twister` + `raster_bars` | effect, raster | WARNINGS | shared_register RASTER/EXTCOL/BGCOL0 | 15,032 |
| 13 | `twister` + `fld_flexible_line_distance` | effect, raster | WARNINGS | shared_register SCROLY/RASTER | 16,081 |
| 14 | `twister` + `sideborder_open` | effect, raster | WARNINGS | shared_register SCROLX | 16,207 |
| 15 | `dot_flag_sine_plotter` + `topbottom_border_open` | effect, raster | WARNINGS | shared_register SCROLY | 16,469 |
| 16 | `dot_flag_sine_plotter` + `sprites_only_screen_mode` | effect, raster | WARNINGS | shared_register SCROLY | 16,854 |
| 17 | `tech_tech_wobbler` + `vector_balls_sprites` | effect, effect | WARNINGS | shared_register RASTER | 6,835 |
| 18 | `twister` + `vector_balls_sprites` | effect, effect | WARNINGS | shared_register RASTER | 14,950 |
| 19 | `topbottom_border_open` + `mci_interlace_bitmap` | raster, bitmap | WARNINGS | prerequisite_conflict vic_raster_irq; shared_register SCROLY | 421 |
| 20 | `sprites_only_screen_mode` + `mci_interlace_bitmap` | raster, bitmap | WARNINGS | prerequisite_conflict vic_raster_irq; shared_register SCROLY/RASTER | 806 |
| 21 | `raster_bars` + `mci_interlace_bitmap` | raster, bitmap | WARNINGS | prerequisite_conflict vic_raster_irq; shared_register RASTER | 1,521 |
| 22 | `fld_flexible_line_distance` + `mci_interlace_bitmap` | raster, bitmap | WARNINGS | prerequisite_conflict vic_raster_irq; shared_register SCROLY/RASTER | 2,570 |
| 23 | `kefrens_bars` + `mci_interlace_bitmap` | raster, bitmap | WARNINGS | prerequisite_conflict vic_raster_irq; shared_register SCROLY/RASTER | 10,823 |
| 24 | `pseudo_3d_road_raster` + `topbottom_border_open` | effect, raster | WARNINGS | prerequisite_conflict vic_raster_irq; shared_register SCROLY | 18,346 |
| 25 | `sideborder_open` + `mci_interlace_bitmap` | raster, bitmap | WARNINGS | prerequisite_conflict vic_raster_irq; shared_register SCROLX; unit_shared vic_xscroll | 2,696 |
| 26 | `tech_tech_wobbler` + `mci_interlace_bitmap` | effect, bitmap | WARNINGS | prerequisite_conflict vic_raster_irq; shared_register SCROLY/RASTER/SCROLX/VMCSB; unit_shared vic_matrix_base/vic_xscroll | 5,496 |
| 27 | `dysp_side_border_sprites` + `mci_interlace_bitmap` | raster, bitmap | WARNINGS | prerequisite_conflict vic_raster_irq; shared_register SCROLY/RASTER/SCROLX; unit_shared vic_xscroll | 10,193 |
| 28 | `colour_fade` + `topbottom_border_open` | effect, raster | COMPATIBLE | none | 771 |
| 29 | `screen_wipe` + `topbottom_border_open` | effect, raster | COMPATIBLE | none | 1,080 |
| 30 | `colour_fade` + `sideborder_open` | effect, raster | COMPATIBLE | none | 3,046 |
| 31 | `screen_wipe` + `sideborder_open` | effect, raster | COMPATIBLE | none | 3,355 |
| 32 | `screen_dissolve_lfsr` + `topbottom_border_open` | effect, raster | COMPATIBLE | none | 3,574 |
| 33 | `colour_cycling` + `topbottom_border_open` | effect, raster | COMPATIBLE | none | 3,636 |
| 34 | `screen_dissolve_lfsr` + `sideborder_open` | effect, raster | COMPATIBLE | none | 5,849 |
| 35 | `colour_cycling` + `sideborder_open` | effect, raster | COMPATIBLE | none | 5,911 |
| 36 | `colour_fade` + `fli_image` | effect, bitmap | COMPATIBLE | none | 13,441 |
| 37 | `screen_wipe` + `fli_image` | effect, bitmap | COMPATIBLE | none | 13,750 |
| 38 | `screen_dissolve_lfsr` + `fli_image` | effect, bitmap | COMPATIBLE | none | 16,244 |
| 39 | `colour_cycling` + `fli_image` | effect, bitmap | COMPATIBLE | none | 16,306 |
| 40 | `colour_fade` + `dot_flag_sine_plotter` | effect, effect | COMPATIBLE | none | 16,498 |
| 41 | `dot_flag_sine_plotter` + `screen_wipe` | effect, effect | COMPATIBLE | none | 16,807 |
| 42 | `colour_fade` + `mci_interlace_bitmap` | effect, bitmap | WARNINGS | shared_register RASTER | 450 |
| 43 | `screen_wipe` + `mci_interlace_bitmap` | effect, bitmap | WARNINGS | shared_register RASTER | 759 |
| 44 | `colour_fade` + `sprites_only_screen_mode` | effect, raster | WARNINGS | shared_register RASTER | 1,156 |
| 45 | `screen_wipe` + `sprites_only_screen_mode` | effect, raster | WARNINGS | shared_register RASTER | 1,465 |
| 46 | `colour_fade` + `raster_bars` | effect, raster | WARNINGS | shared_register RASTER/EXTCOL/BGCOL0 | 1,871 |
| 47 | `screen_wipe` + `raster_bars` | effect, raster | WARNINGS | shared_register RASTER/BGCOL0 | 2,180 |
| 48 | `colour_fade` + `fld_flexible_line_distance` | effect, raster | WARNINGS | shared_register RASTER | 2,920 |
| 49 | `screen_wipe` + `fld_flexible_line_distance` | effect, raster | WARNINGS | shared_register RASTER | 3,229 |
| 50 | `screen_dissolve_lfsr` + `mci_interlace_bitmap` | effect, bitmap | WARNINGS | shared_register RASTER | 3,253 |
| 51 | `colour_cycling` + `mci_interlace_bitmap` | effect, bitmap | WARNINGS | shared_register RASTER | 3,315 |
| 52 | `screen_dissolve_lfsr` + `sprites_only_screen_mode` | effect, raster | WARNINGS | shared_register RASTER | 3,959 |
| 53 | `colour_cycling` + `sprites_only_screen_mode` | effect, raster | WARNINGS | shared_register RASTER | 4,021 |
| 54 | `screen_dissolve_lfsr` + `raster_bars` | effect, raster | WARNINGS | shared_register RASTER | 4,674 |
| 55 | `colour_cycling` + `raster_bars` | effect, raster | WARNINGS | shared_register RASTER/BGCOL0 | 4,736 |
| 56 | `screen_dissolve_lfsr` + `fld_flexible_line_distance` | effect, raster | WARNINGS | shared_register RASTER | 5,723 |
| 57 | `colour_cycling` + `fld_flexible_line_distance` | effect, raster | WARNINGS | shared_register RASTER | 5,785 |
| 58 | `colour_fade` + `dysp_side_border_sprites` | effect, raster | WARNINGS | shared_register RASTER | 10,543 |
| 59 | `screen_wipe` + `dysp_side_border_sprites` | effect, raster | WARNINGS | shared_register RASTER | 10,852 |
| 60 | `colour_fade` + `kefrens_bars` | effect, raster | WARNINGS | shared_register RASTER | 11,173 |
| 61 | `screen_wipe` + `kefrens_bars` | effect, raster | WARNINGS | shared_register RASTER | 11,482 |
| 62 | `screen_dissolve_lfsr` + `dysp_side_border_sprites` | effect, raster | WARNINGS | shared_register RASTER | 13,346 |
| 63 | `colour_cycling` + `dysp_side_border_sprites` | effect, raster | WARNINGS | shared_register RASTER | 13,408 |
| 64 | `screen_dissolve_lfsr` + `kefrens_bars` | effect, raster | WARNINGS | shared_register RASTER | 13,976 |
| 65 | `colour_cycling` + `kefrens_bars` | effect, raster | WARNINGS | shared_register RASTER | 14,038 |
| 66 | `colour_fade` + `vector_balls_sprites` | effect, effect | WARNINGS | shared_register RASTER | 1,789 |
| 67 | `screen_wipe` + `vector_balls_sprites` | effect, effect | WARNINGS | shared_register RASTER | 2,098 |
| 68 | `screen_dissolve_lfsr` + `vector_balls_sprites` | effect, effect | WARNINGS | shared_register RASTER | 4,592 |
| 69 | `colour_cycling` + `vector_balls_sprites` | effect, effect | WARNINGS | shared_register RASTER | 4,654 |
| 70 | `colour_fade` + `tech_tech_wobbler` | effect, effect | WARNINGS | shared_register RASTER | 5,846 |
| 71 | `screen_wipe` + `tech_tech_wobbler` | effect, effect | WARNINGS | shared_register RASTER | 6,155 |
| 72 | `screen_dissolve_lfsr` + `tech_tech_wobbler` | effect, effect | WARNINGS | shared_register RASTER | 8,649 |
| 73 | `colour_cycling` + `tech_tech_wobbler` | effect, effect | WARNINGS | shared_register RASTER | 8,711 |
| 74 | `colour_fade` + `twister` | effect, effect | WARNINGS | shared_register RASTER/EXTCOL/BGCOL0 | 13,961 |
| 75 | `screen_wipe` + `twister` | effect, effect | WARNINGS | shared_register RASTER/BGCOL0 | 14,270 |
| 76 | `screen_dissolve_lfsr` + `twister` | effect, effect | WARNINGS | shared_register RASTER | 16,764 |
| 77 | `colour_cycling` + `twister` | effect, effect | WARNINGS | shared_register RASTER/BGCOL0 | 16,826 |
| 78 | `colour_fade` + `pseudo_3d_road_raster` | effect, effect | WARNINGS | shared_register RASTER/BGCOL0 | 18,375 |
| 79 | `colour_fade` + `screen_wipe` | effect, effect | WARNINGS | shared_register RASTER/BGCOL0 | 1,109 |
| 80 | `colour_fade` + `screen_dissolve_lfsr` | effect, effect | WARNINGS | shared_register RASTER | 3,603 |
| 81 | `colour_cycling` + `colour_fade` | effect, effect | WARNINGS | shared_register RASTER/BGCOL0 | 3,665 |
| 82 | `screen_dissolve_lfsr` + `screen_wipe` | effect, effect | WARNINGS | shared_register RASTER | 3,912 |
| 83 | `colour_cycling` + `screen_wipe` | effect, effect | WARNINGS | shared_register RASTER/BGCOL0 | 3,974 |
| 84 | `colour_cycling` + `screen_dissolve_lfsr` | effect, effect | WARNINGS | shared_register RASTER | 6,468 |

## Triples that fit

| # | Triple | Verdict | Soft conflicts | Predicted cycles a PAL frame |
|---|---|---|---|---|
| 1 | `colour_fade` + `topbottom_border_open` + `vector_balls_sprites` | WARNINGS | 1 | 2,160 |
| 2 | `screen_wipe` + `topbottom_border_open` + `vector_balls_sprites` | WARNINGS | 1 | 2,469 |
| 3 | `screen_dissolve_lfsr` + `topbottom_border_open` + `vector_balls_sprites` | WARNINGS | 1 | 4,963 |
| 4 | `colour_cycling` + `topbottom_border_open` + `vector_balls_sprites` | WARNINGS | 1 | 5,025 |
| 5 | `colour_fade` + `fli_image` + `vector_balls_sprites` | WARNINGS | 1 | 14,830 |
| 6 | `fli_image` + `screen_wipe` + `vector_balls_sprites` | WARNINGS | 1 | 15,139 |
| 7 | `colour_fade` + `dot_flag_sine_plotter` + `topbottom_border_open` | WARNINGS | 1 | 16,869 |
| 8 | `dot_flag_sine_plotter` + `screen_wipe` + `topbottom_border_open` | WARNINGS | 1 | 17,178 |
| 9 | `fli_image` + `screen_dissolve_lfsr` + `vector_balls_sprites` | WARNINGS | 1 | 17,633 |
| 10 | `colour_cycling` + `fli_image` + `vector_balls_sprites` | WARNINGS | 1 | 17,695 |
| 11 | `dot_flag_sine_plotter` + `topbottom_border_open` + `vector_balls_sprites` | WARNINGS | 1 | 17,858 |
| 12 | `colour_fade` + `dot_flag_sine_plotter` + `raster_bars` | WARNINGS | 1 | 17,969 |
| 13 | `dot_flag_sine_plotter` + `raster_bars` + `screen_wipe` | WARNINGS | 1 | 18,278 |
| 14 | `colour_fade` + `dot_flag_sine_plotter` + `vector_balls_sprites` | WARNINGS | 1 | 17,887 |
| 15 | `dot_flag_sine_plotter` + `screen_wipe` + `vector_balls_sprites` | WARNINGS | 1 | 18,196 |
| 16 | `colour_fade` + `topbottom_border_open` + `twister` | WARNINGS | 2 | 14,332 |
| 17 | `screen_wipe` + `topbottom_border_open` + `twister` | WARNINGS | 2 | 14,641 |
| 18 | `topbottom_border_open` + `twister` + `vector_balls_sprites` | WARNINGS | 2 | 15,321 |
| 19 | `colour_fade` + `sideborder_open` + `twister` | WARNINGS | 2 | 16,607 |
| 20 | `screen_wipe` + `sideborder_open` + `twister` | WARNINGS | 2 | 16,916 |
| 21 | `screen_dissolve_lfsr` + `topbottom_border_open` + `twister` | WARNINGS | 2 | 17,135 |
| 22 | `colour_cycling` + `topbottom_border_open` + `twister` | WARNINGS | 2 | 17,197 |
| 23 | `colour_fade` + `dot_flag_sine_plotter` + `sprites_only_screen_mode` | WARNINGS | 2 | 17,254 |
| 24 | `dot_flag_sine_plotter` + `screen_wipe` + `sprites_only_screen_mode` | WARNINGS | 2 | 17,563 |
| 25 | `dot_flag_sine_plotter` + `sprites_only_screen_mode` + `vector_balls_sprites` | WARNINGS | 2 | 18,243 |
| 26 | `colour_fade` + `mci_interlace_bitmap` + `topbottom_border_open` | WARNINGS | 3 | 821 |
| 27 | `mci_interlace_bitmap` + `screen_wipe` + `topbottom_border_open` | WARNINGS | 3 | 1,130 |
| 28 | `mci_interlace_bitmap` + `topbottom_border_open` + `vector_balls_sprites` | WARNINGS | 3 | 1,810 |
| 29 | `colour_fade` + `mci_interlace_bitmap` + `vector_balls_sprites` | WARNINGS | 3 | 1,839 |
| 30 | `mci_interlace_bitmap` + `screen_wipe` + `vector_balls_sprites` | WARNINGS | 3 | 2,148 |
| 31 | `colour_fade` + `sprites_only_screen_mode` + `vector_balls_sprites` | WARNINGS | 3 | 2,545 |
| 32 | `screen_wipe` + `sprites_only_screen_mode` + `vector_balls_sprites` | WARNINGS | 3 | 2,854 |
| 33 | `colour_fade` + `raster_bars` + `vector_balls_sprites` | WARNINGS | 3 | 3,260 |
| 34 | `raster_bars` + `screen_wipe` + `vector_balls_sprites` | WARNINGS | 3 | 3,569 |
| 35 | `mci_interlace_bitmap` + `screen_dissolve_lfsr` + `topbottom_border_open` | WARNINGS | 3 | 3,624 |
| 36 | `colour_cycling` + `mci_interlace_bitmap` + `topbottom_border_open` | WARNINGS | 3 | 3,686 |
| 37 | `colour_fade` + `fld_flexible_line_distance` + `vector_balls_sprites` | WARNINGS | 3 | 4,309 |
| 38 | `fld_flexible_line_distance` + `screen_wipe` + `vector_balls_sprites` | WARNINGS | 3 | 4,618 |
| 39 | `mci_interlace_bitmap` + `screen_dissolve_lfsr` + `vector_balls_sprites` | WARNINGS | 3 | 4,642 |
| 40 | `colour_cycling` + `mci_interlace_bitmap` + `vector_balls_sprites` | WARNINGS | 3 | 4,704 |
| 41 | `screen_dissolve_lfsr` + `sprites_only_screen_mode` + `vector_balls_sprites` | WARNINGS | 3 | 5,348 |
| 42 | `colour_cycling` + `sprites_only_screen_mode` + `vector_balls_sprites` | WARNINGS | 3 | 5,410 |
| 43 | `raster_bars` + `screen_dissolve_lfsr` + `vector_balls_sprites` | WARNINGS | 3 | 6,063 |
| 44 | `colour_cycling` + `raster_bars` + `vector_balls_sprites` | WARNINGS | 3 | 6,125 |
| 45 | `fld_flexible_line_distance` + `screen_dissolve_lfsr` + `vector_balls_sprites` | WARNINGS | 3 | 7,112 |
| 46 | `colour_cycling` + `fld_flexible_line_distance` + `vector_balls_sprites` | WARNINGS | 3 | 7,174 |
| 47 | `colour_fade` + `kefrens_bars` + `vector_balls_sprites` | WARNINGS | 3 | 12,562 |
| 48 | `kefrens_bars` + `screen_wipe` + `vector_balls_sprites` | WARNINGS | 3 | 12,871 |
| 49 | `colour_fade` + `sprites_only_screen_mode` + `twister` | WARNINGS | 3 | 14,717 |
| 50 | `screen_wipe` + `sprites_only_screen_mode` + `twister` | WARNINGS | 3 | 15,026 |
| 51 | `kefrens_bars` + `screen_dissolve_lfsr` + `vector_balls_sprites` | WARNINGS | 3 | 15,365 |
| 52 | `colour_cycling` + `kefrens_bars` + `vector_balls_sprites` | WARNINGS | 3 | 15,427 |
| 53 | `colour_fade` + `raster_bars` + `twister` | WARNINGS | 3 | 15,432 |
| 54 | `sprites_only_screen_mode` + `twister` + `vector_balls_sprites` | WARNINGS | 3 | 15,706 |
| 55 | `raster_bars` + `screen_wipe` + `twister` | WARNINGS | 3 | 15,741 |
| 56 | `raster_bars` + `twister` + `vector_balls_sprites` | WARNINGS | 3 | 16,421 |
| 57 | `colour_fade` + `fld_flexible_line_distance` + `twister` | WARNINGS | 3 | 16,481 |
| 58 | `fld_flexible_line_distance` + `screen_wipe` + `twister` | WARNINGS | 3 | 16,790 |
| 59 | `fld_flexible_line_distance` + `twister` + `vector_balls_sprites` | WARNINGS | 3 | 17,470 |
| 60 | `screen_dissolve_lfsr` + `sprites_only_screen_mode` + `twister` | WARNINGS | 3 | 17,520 |
| 61 | `colour_cycling` + `sprites_only_screen_mode` + `twister` | WARNINGS | 3 | 17,582 |
| 62 | `raster_bars` + `screen_dissolve_lfsr` + `twister` | WARNINGS | 3 | 18,235 |
| 63 | `colour_cycling` + `raster_bars` + `twister` | WARNINGS | 3 | 18,297 |
| 64 | `colour_fade` + `tech_tech_wobbler` + `vector_balls_sprites` | WARNINGS | 3 | 7,235 |
| 65 | `screen_wipe` + `tech_tech_wobbler` + `vector_balls_sprites` | WARNINGS | 3 | 7,544 |
| 66 | `screen_dissolve_lfsr` + `tech_tech_wobbler` + `vector_balls_sprites` | WARNINGS | 3 | 10,038 |
| 67 | `colour_cycling` + `tech_tech_wobbler` + `vector_balls_sprites` | WARNINGS | 3 | 10,100 |
| 68 | `colour_fade` + `twister` + `vector_balls_sprites` | WARNINGS | 3 | 15,350 |
| 69 | `screen_wipe` + `twister` + `vector_balls_sprites` | WARNINGS | 3 | 15,659 |
| 70 | `screen_dissolve_lfsr` + `twister` + `vector_balls_sprites` | WARNINGS | 3 | 18,153 |
| 71 | `colour_cycling` + `twister` + `vector_balls_sprites` | WARNINGS | 3 | 18,215 |
| 72 | `colour_fade` + `mci_interlace_bitmap` + `sprites_only_screen_mode` | WARNINGS | 4 | 1,206 |
| 73 | `mci_interlace_bitmap` + `screen_wipe` + `sprites_only_screen_mode` | WARNINGS | 4 | 1,515 |
| 74 | `colour_fade` + `mci_interlace_bitmap` + `raster_bars` | WARNINGS | 4 | 1,921 |
| 75 | `mci_interlace_bitmap` + `sprites_only_screen_mode` + `vector_balls_sprites` | WARNINGS | 4 | 2,195 |
| 76 | `mci_interlace_bitmap` + `raster_bars` + `screen_wipe` | WARNINGS | 4 | 2,230 |
| 77 | `mci_interlace_bitmap` + `raster_bars` + `vector_balls_sprites` | WARNINGS | 4 | 2,910 |
| 78 | `colour_fade` + `fld_flexible_line_distance` + `mci_interlace_bitmap` | WARNINGS | 4 | 2,970 |
| 79 | `colour_fade` + `mci_interlace_bitmap` + `sideborder_open` | WARNINGS | 4 | 3,096 |
| 80 | `fld_flexible_line_distance` + `mci_interlace_bitmap` + `screen_wipe` | WARNINGS | 4 | 3,279 |
| 81 | `mci_interlace_bitmap` + `screen_wipe` + `sideborder_open` | WARNINGS | 4 | 3,405 |
| 82 | `fld_flexible_line_distance` + `mci_interlace_bitmap` + `vector_balls_sprites` | WARNINGS | 4 | 3,959 |
| 83 | `mci_interlace_bitmap` + `screen_dissolve_lfsr` + `sprites_only_screen_mode` | WARNINGS | 4 | 4,009 |
| 84 | `colour_cycling` + `mci_interlace_bitmap` + `sprites_only_screen_mode` | WARNINGS | 4 | 4,071 |
| 85 | `mci_interlace_bitmap` + `raster_bars` + `screen_dissolve_lfsr` | WARNINGS | 4 | 4,724 |
| 86 | `colour_cycling` + `mci_interlace_bitmap` + `raster_bars` | WARNINGS | 4 | 4,786 |
| 87 | `fld_flexible_line_distance` + `mci_interlace_bitmap` + `screen_dissolve_lfsr` | WARNINGS | 4 | 5,773 |
| 88 | `colour_cycling` + `fld_flexible_line_distance` + `mci_interlace_bitmap` | WARNINGS | 4 | 5,835 |
| 89 | `mci_interlace_bitmap` + `screen_dissolve_lfsr` + `sideborder_open` | WARNINGS | 4 | 5,899 |
| 90 | `colour_cycling` + `mci_interlace_bitmap` + `sideborder_open` | WARNINGS | 4 | 5,961 |
| 91 | `colour_fade` + `kefrens_bars` + `mci_interlace_bitmap` | WARNINGS | 4 | 11,223 |
| 92 | `kefrens_bars` + `mci_interlace_bitmap` + `screen_wipe` | WARNINGS | 4 | 11,532 |
| 93 | `kefrens_bars` + `mci_interlace_bitmap` + `vector_balls_sprites` | WARNINGS | 4 | 12,212 |
| 94 | `kefrens_bars` + `mci_interlace_bitmap` + `screen_dissolve_lfsr` | WARNINGS | 4 | 14,026 |
| 95 | `colour_cycling` + `kefrens_bars` + `mci_interlace_bitmap` | WARNINGS | 4 | 14,088 |
| 96 | `colour_fade` + `mci_interlace_bitmap` + `tech_tech_wobbler` | WARNINGS | 5 | 5,896 |
| 97 | `mci_interlace_bitmap` + `screen_wipe` + `tech_tech_wobbler` | WARNINGS | 5 | 6,205 |
| 98 | `mci_interlace_bitmap` + `tech_tech_wobbler` + `vector_balls_sprites` | WARNINGS | 5 | 6,885 |
| 99 | `mci_interlace_bitmap` + `screen_dissolve_lfsr` + `tech_tech_wobbler` | WARNINGS | 5 | 8,699 |
| 100 | `colour_cycling` + `mci_interlace_bitmap` + `tech_tech_wobbler` | WARNINGS | 5 | 8,761 |
| 101 | `colour_fade` + `dysp_side_border_sprites` + `mci_interlace_bitmap` | WARNINGS | 5 | 10,593 |
| 102 | `dysp_side_border_sprites` + `mci_interlace_bitmap` + `screen_wipe` | WARNINGS | 5 | 10,902 |
| 103 | `dysp_side_border_sprites` + `mci_interlace_bitmap` + `screen_dissolve_lfsr` | WARNINGS | 5 | 13,396 |
| 104 | `colour_cycling` + `dysp_side_border_sprites` + `mci_interlace_bitmap` | WARNINGS | 5 | 13,458 |

## Pairs the budget cannot settle

These pairs pass the compatibility check and appear in no recipe, but a
member has no cycle figure, so `plan-budget` says undetermined. The
first 30 with no infrastructure, primitive or transition member, in the
same order as above (317 such pairs in all):

| Pair | Verdict | Soft conflicts |
|---|---|---|
| `dot_3d_rotator` + `agsp_free_scroll` | COMPATIBLE | none |
| `dot_3d_rotator` + `linecrunch` | COMPATIBLE | none |
| `mode7_lookalike` + `linecrunch` | COMPATIBLE | none |
| `starfield` + `agsp_free_scroll` | COMPATIBLE | none |
| `starfield` + `linecrunch` | COMPATIBLE | none |
| `starfield` + `raster_split_modes` | COMPATIBLE | none |
| `starfield` + `vsp_glitch` | COMPATIBLE | none |
| `starfield` + `afli_image` | COMPATIBLE | none |
| `starfield` + `ifli_image` | COMPATIBLE | none |
| `tunnel` + `agsp_free_scroll` | COMPATIBLE | none |
| `tunnel` + `linecrunch` | COMPATIBLE | none |
| `starfield` + `mci_interlace_bitmap` | COMPATIBLE | none |
| `dot_3d_rotator` + `topbottom_border_open` | COMPATIBLE | none |
| `mode7_lookalike` + `topbottom_border_open` | COMPATIBLE | none |
| `starfield` + `topbottom_border_open` | COMPATIBLE | none |
| `tunnel` + `topbottom_border_open` | COMPATIBLE | none |
| `dot_3d_rotator` + `sprites_only_screen_mode` | COMPATIBLE | none |
| `mode7_lookalike` + `sprites_only_screen_mode` | COMPATIBLE | none |
| `starfield` + `sprites_only_screen_mode` | COMPATIBLE | none |
| `tunnel` + `sprites_only_screen_mode` | COMPATIBLE | none |
| `vector_balls_sprites` + `raster_split_modes` | COMPATIBLE | none |
| `vector_balls_sprites` + `vsp_glitch` | COMPATIBLE | none |
| `vector_balls_sprites` + `afli_image` | COMPATIBLE | none |
| `vector_balls_sprites` + `ifli_image` | COMPATIBLE | none |
| `bobs_effect` + `raster_bars` | COMPATIBLE | none |
| `dot_3d_rotator` + `raster_bars` | COMPATIBLE | none |
| `mode7_lookalike` + `raster_bars` | COMPATIBLE | none |
| `solid_vector_3d` + `raster_bars` | COMPATIBLE | none |
| `starfield` + `raster_bars` | COMPATIBLE | none |
| `voxel_landscape` + `raster_bars` | COMPATIBLE | none |

The techniques that appear only in undetermined pairs, whose Cost line
would open them to the budget: `afli_image`, `agsp_free_scroll`, `badline_synchronization`, `bobs_effect`, `bresenham_line`, `dot_3d_rotator`, `ecm_mode`, `fire_effect`, `ifli_image`, `koala_format`, `linecrunch`, `mcm_text`, `mode7_lookalike`, `multicolor_bitmap`, `pal_ntsc_detection`, `plasma`, `raster_split_modes`, `shadebobs`, `solid_vector_3d`, `standard_bitmap`, `starfield`, `text_zoom`, `tunnel`, `voxel_landscape`, `vsp_glitch`, `wireframe_pipeline`.

## Next

The judge stage (#55's pipeline) reads the top of each list, drops the
pairs whose picture would show nothing neither member shows alone, and
hands the rest to a builder with the recipe harness. Measuring the Cost
of the techniques named in the last paragraph would widen the fitting
list more than any other single step.
