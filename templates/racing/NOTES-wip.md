# racing #110 work notes (not committed)

State at 2026-10-01 (after /tmp wipe):
- Last commit 51bee88: far rows coarse, 9.2 PAL frames a picture.
- Uncommitted: lean far-row renderer (far_row_fine, d 32-56 via main render slow entries),
  DCOARSE2=32 coarse rows, stage-2-only track padding, centre line max 2 pairs (tc_pages 2),
  main() at $0860 and C right after the blob, traffic an eighth a step, bot a quarter a step,
  event-driven lower kernel (EV_LINE 188; slots at $C880 written by ev_scan at kernel_exit;
  ev_sleep/irq_ev), roadcheck model reads K_POS and NPOLL blocks.
- Measured before the event kernel debug: PAL 3.15 steps/picture (6.3 frames), NTSC 3.51 (8.4).
- Open: exit screenshots sometimes show a frame with HUD/road colours wrong; ring log found no
  missing IRQs (CIA frame count vs tick: the 256 offset was the 8-bit tick wrapping). Check with
  roadcheck on the static still and a sequence of shots.
- KB findings so far: Oscar64 (signed char)i strength-reduction (local + v1.32.273, repro lost
  with /tmp: rewrite); Oscar64 NumberSet.h assertion on `signed char dx = ox - lanes[l]` compare;
  the earlier set_stage_colours index-drop.
- Tools: tools/vmon.py, tools/roadcheck.py in tree; helper scripts were in /tmp (gone).

Later on 2026-10-01:
- Debug code stripped; tree builds; roadcheck PASS PAL+NTSC; verdict FAIL a,b (stage 2 timed
  out, 5/8 checkpoints) since the traffic/bot-rate change. Committed d7245c7 (unmerged).
- origin/main has a separate racing step-1 rewrite by another session (870abf7, bbbe9b3,
  12b9aa4): static slanted glyphs, cycle-exact kernel, 3.0 PAL frames a picture,
  slanted_glyph_road in the KB. The merge conflicts across templates/racing; aborted. Waiting
  for the lead to choose one base.

## Port onto main (branch racing-port-110 from d6aad3b), 2026-10-01

Baseline: make shot check 68/68, watch PASS. Meter typical/worst per frame (VICE x64sc 3.10):
PAL step+IRQs 9,025/10,502; NTSC 9,254/10,955. PROF=2 cars 1,665/3,342; PROF=3 hud+sound 301/1,479.
Builder per picture ~32K PAL (10,630 x 3.04), ~39K NTSC (7,840 x 5.03) (rung 3).

Oscar64 repro: repro/schar-cast.c; -O1..-O3 fail on local and v1.32.273 (built from tag in
scratchpad o273/): c * 8 from (signed char)i in an unsigned loop = 248*8.

### Multiplexer design, and the KB answer behind each choice
- Sprites 0-2 only on road lines: kickassembler-road-sprite-lines (3-7 fetch over the stores) and
  main's README. KB silent on reuse inside the blocks: recipe lists it under "not established".
- Pads per line by the set of sprites fetching (5 + 2(last-first)): road-sprite-lines /
  vic_bus_takeover_on_dma; main's PadFor already does it, extended to a list of uses.
- Reuse spacing: new Y >= old Y + 21 (sprite_dma_overflow: 100 then 120 lost, 121 shown).
- Writes land after the old use's last line and Y is written in the gap: sprite_multiplex_game
  Variations, "just after the old sprite"; here the writes are block store slots, not an IRQ.
- Sort by Y; reject what does not fit (sprite_multiplex_game How 1, 3).
- Double-buffered table: main's two road copies (the back copy's slots), sprite_multiplex_game How 2.
- $D010 precalculated per write in line order: sprite_multiplex_game How 2,
  sprite_x_high_bit_wrong_register.
- No zone IRQs, so irq_table_rebuilt_per_frame_loses_close_entries and the late guard do not apply.
- Badlines get no slots (badline_cycle_loss: 43 cycles gone).

### KB findings for the lead
1. check-compatibility slanted_glyph_road sprite_multiplex_game: INCOMPATIBLE on vic_raster_irq,
   but a multiplexer that writes from the road's own blocks has no IRQ. The KB has no form of
   sprite_multiplex_game without interrupts.
2. Full list: three hard conflicts (pseudo_3d_road_raster x slanted_glyph_road on vic_xscroll;
   slanted_glyph_road x screen_double_buffer_d018 on vic_matrix_base; slanted_glyph_road x
   charset_copy_rom_to_ram on vic_char_base) are one writer each: the claims cannot say
   "implements" or "shares the store".
3. plan-budget: slanted_glyph_road 6,048 "recipe not stated"; sprite_multiplex_game's 8,995-16,600
   is an IRQ multiplexer's cost, not a slot one's.
4. road-sprite-lines: reuse down the road not built or measured (the port will measure it).

### Step 1a done (uncommitted): road-line multiplexer on main's 3 opponents
- engine.asm: two slots (LDA #, STA abs) in every F/N/L block at offset 9, +10 bytes, +12 cycles;
  slot_dummy; slot_off/slot_on labels. PROBE build has none.
- builder.asm: lmask from a use list (u_n/u_line/u_bit, MAXUSE 12), last picture's cleared.
- road.c: picture_begin lists cars in view by Y; schedule() builds up from the player
  (sprite 0 lowest use), nearest first, Y + 21 spacing, 5 slots per reuse; sprites_x();
  write_slots() (old slots back to dummy, $D010 values in beam order). Phases 0..5.
- roadcheck models slot stores + per-use pointer; reports uses and slot stores.
- verdict still: car 3 at 44 units right lane (a reuse); expect.json car 3 box (182,135)-(189,138).
- Measured: check 70/70 both, roadcheck PASS (4 uses, 5 slot stores), late 0, spr_dropped 0.
  Pictures in 3,607 race steps: PAL 953 (3.78 frames) vs base 1,111 (3.25); NTSC 605 (5.96)
  vs 694 (5.20). PIECETIME PAL means: schedule 3,500, sprites_x 1,540, slots 1,332 (C pieces).
- Next: schedule/sprites_x/slots into asm to win the rate back; then the 16-car field (world.asm).

### Step 1 (uncommitted, 2026-10-01 late): 16-car field + asm mux + asm projection
- New: src/mux.asm (schedule/sort/X/slots, pieces of 4 cars), src/world.asm (field: quarter a
  step, 4 frames' worth; think one a step; lanes every 4th; w_ahead for bot; collect nearest 8),
  src/project.asm (mx_cars: binary search line, size, Y, offset; floor rounding), cars.c (player +
  contact glue, opp_place), road.c phases 0,6,7,1,8,2,rows,4,5. Stack 1 KB (stackprobe <256 B).
- Bug found+fixed: collect entered its insertion loop with CPY #8's flags; Y ran below 0 and
  overwrote its own JMP operand -> jump into heap -> KERNAL banked in -> machine wedged.
- Measured: verdict PASS both, late 0, roadcheck PASS; meter typical 9,059 PAL.
  Rate PAL 5.94 / NTSC 9.15 frames a picture (main 3.25/5.20). NOAVOID+MCMAX0 3.70; NOAVOID+8 5.41;
  avoid+0 4.59; caps 1/3/5: 5.1/5.74/5.9. Builder own ~56K/picture vs ~33K.
- Pins to update: FINISHED 8TH, POS  8/17, lap times L1 0:39.2 L2 0:38.4 (PAL), 0:32.6/0:32.0 NTSC.
- Debug hooks present: PIECETIME (piece_osum), STACKPROBE, TRTIME, NOAVOID, KICKASS :MCMAX.
- Waiting on lead: commit now vs optimise (slots+pads one pass; fixed picture lines for cars).

### Committed 41670fb (step 1) and 6f37329 (step 1b), branch racing-port-110, not on main
- 1b: all opponents move every step (quarter-step moves jumped +-30 units); slots one pass;
  lmask reuse; FIXEDLINES switch. Rates PAL/NTSC frames a picture: 6.02/9.63; FIXEDLINES 6.09/9.42.
- Strips: ~/Developer/c64/c64kb-write/racer/cars-smooth.png, cars-fixedlines.png (race frame 151).
- Breakdown (NOAVOID, PIECETIME): 0 cars on screen 40.8K own/picture, 8 cars 54.0K: projection 4.4K,
  schedule 2.4K, slots 2.2K, rb_begin +0.9K, X +0.5K, rows +3.4K. Visible car range is short:
  a car 180 units ahead already sits by the horizon (ZN 24, W0 136).
- Bot tailgates the car ahead at 40-70 units for long spells (step 5 tuning).
- Tools in scratchpad: stats.py, pieces.py (CDEFS/KFLAGS env), trtime.sh, fixed.sh, strip.py.

### 2026-10-01 evening: e1ac6d9 step 2, e80ce1b mountains, 6758913 car art, 9ada6ad tuning
- Rates PAL/NTSC frames a picture: step2 6.16/9.62; mountains 6.84/11.07; art 6.89/11.4; tuning 7.3/12.2.
- Memory: VRAM $0400-$07FF (size_of_w, wscale, op_*, slot_cnt, mu_*), VRAM2 $EA00-$ECFF (lmask,
  rowbuf, rs_*, wr_pos), VRAM3 $C800-$CA73 (d016, zlc, line_s, row_cref). C free ~230 B (auto build).
  Sprite blocks: 48-56 cars; free 57-63 and 12-14 ($C300), 28-30 ($C700) for roadside objects.
- Tuning table: game.h T_*. Bot finishes 14th; stage times 57.9 / 73.0 PAL.
- PIECETIME arrays live at $0200-$02FB (debug only). Debug counters: mt_draws, crash_wall.
- Next: step 3 roadside objects (memory! ~230 B C free), step 4 music, step 5 bot/verdict, then optimisation.
