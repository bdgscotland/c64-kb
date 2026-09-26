---
kind: studied
---
<!-- doc-type: game-design -->

# Study: Commando (Elite, 1985)

How the C64 Commando is put together, measured with the RE tools in VICE
x64sc 3.10 (`-default`: PAL C64C, VIC-II 8565, SID 8580, CIA 8521). The
image is the maintainer's own copy, a cracked release on a D64; it is not
in this repository (`game-design/reference-game-sources.md`). The page
holds addresses, raster lines, cycle counts and layouts, never the game's
code, graphics, music or map bytes.

Rungs follow the repository's ladder (CLAUDE.md rule 3): (1) run here in
VICE; (2) two independent instruments or documents agree; (3) arithmetic
from stated values; (4) unverifiable here, such as a published interview.
A claim read from the game's code or tables in a RAM dump, but not
watched happening in a run, says "(from the game's code, not seen
running)". Observation IDs (`commando#…`) are entries in
`game-design/studies/observations/commando.json`. "Frame" is one PAL
frame, 312 lines × 63 = 19,656 cycles.

## Commando (Elite, 1985), studied

**Game design:** `commando_1985`
**Instance of:** vertical_run_and_gun
**Region:** PAL
**Studied from:** Commando (1985, Chris Butler, Rob Hubbard, Elite); image sha1=b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f; session studies/sessions/commando.json
**Composes:** vic_bank_select (init), frame_sync_loop, soft_scroll_v, threshold_scroll_v, row_map_redraw, scroll_panel_split, invalid_mode_band, sprite_multiplex_game, sprite_slot_parking, object_pool, wave_director, char_attribute_flags, facing_turn_step, grenade_lob, area_end_gate_wave, sfx_voice_takeover, sid_play_routine_pattern, decimal_print, checkpoint_respawn (transition), high_score_table_insert (transition)
**IRQ chain:** play pal: $41C5 @ line 30, $4284 @ line 50/60, $4389 @ line 161/198, $4137 @ line 213, $4188 @ line 222 (measured-vice, obs commando#irq-1-#irq-6 from c64_re_irq_chain on the session, 1264 play frames with no input; the $4389 extremes 161 and 198 from obs commando#frame-2, 750 frames with up held)
**Memory map:** VIC bank 3; $DD00=$94; screen $E000-$E3E7; charset area 0 $C000-$C7FF; charset area 1 $C800-$CFFF; HUD charset $D000-$D7FF; sprite blocks $E400-$FFBF; blank sprite (block $FF) $FFC0-$FFFF; variables and objects $0400-$0504; code and tables $0850-$44FF; sound $5000-$5FB1; map area 0 $6000-$7E9F; map area 1 $8000-$9D37; charset area 3 $D800-$DFFF; map area 3 $A000-$BD37; free $4500-$4FFF; $01=$36 in play; $D018=$80 in area 0; $D018=$86 in area 3; $D018=$84 in HUD band (measured-vice, obs commando#snap-1 and #mem-1-#mem-5, #map-1 and #area3-1)
**Diverges from archetype:** extra: vic_bank_select, scroll_panel_split, sid_play_routine_pattern, decimal_print, high_score_table_insert
**Measured frame:** play pal worst=13664 typical=11524 (measured-vice-study, normal frames only: 19656 minus the idle wait measured per frame over 590 standing frames, obs commando#frame-1 and #frame-3)
**Measured frame:** play pal worst=18797 typical=18004 (measured-vice-study, redraw frames only: 19656 minus the idle wait over 77 hard-scroll frames with up held, obs commando#frame-1 and #frame-3)

Chris Butler programmed it and Rob Hubbard wrote the music: rung 4, from
Butler's published Zzap!64 interview as quoted in
`game-design/production-planning.md`. The game's RAM holds no credit
string. The two Measured frame lines are one phase split by frame kind:
the grammar has one `play` phase, so each line's source names its kind. The title `Commando` matches the
Production that `vertical_shmup`'s reference titles create.

`vertical_run_and_gun` was written from this study, so its fingerprint
holds every technique Commando was measured to use in play except the
five on the Diverges line, and nothing is missing. That agreement is
circular and proves nothing about the archetype.

Commando's raster chain is the ring form that `irq_chain_table`'s "Why"
describes, not its table: each part re-arms `$D012` and re-points a RAM
vector at the next. It keeps the KERNAL in and writes under it, so it
does not use `ram_under_kernal`, which banks the KERNAL out. Its hit
boxes are one per object type, not per animation frame, so
`per_frame_hitbox` is not listed.

### Main loop and state machine

- There is no state variable. The program counter is the state: title and
  attract ($0F48), game start ($0899), area start ($08B8), the frame loop
  ($08CB), respawn ($08C2), game over ($09A4), name entry ($0C88), score
  table ($0E0F). Rung 1 for each address hit in a run.
- The raster chain only draws and plays music. All game logic runs in the
  main loop, which waits at $402A for the frame counter `$040B`; the
  line-213 part increments it at line 216, so logic starts at line 217.
- Normal frame, in order: move all 16 objects ($3D48), sort ($3F24),
  grenade key ($38C3), enemy slots ($24B3), spawn check ($1BA9), player
  shot and grenade slots ($3641), player and joystick ($3AAA), player hit
  test ($100F). Median return to the wait: line 74.
- Redraw frame (every 8th while scrolling): when the fine scroll wraps to
  7, the loop decrements the map row, moves the objects and redraws the
  playfield, then goes straight back to the wait. Input, AI, spawning,
  sorting and collision are skipped. 90 of 91 gaps between redraw frames
  were exactly 8 frames; the other spanned a death.
- Death: state `$0503` = 1 for a hit, 2 for deadly terrain; an 80-frame
  animation; then the respawn pass re-initialises objects, screen and
  chain in 57,840-59,999 cycles over 3 frames. The only multi-frame pass.
- Area end: at map row 0 the scroll stops and 20 soldiers come out
  (`$04EF` left to spawn, `$04F4` alive). When both are 0 a script walks
  the player into the gate, an interlude runs ($1240), and the next area
  starts. Areas run 0, 1, 3 and loop (`$04F3`); index 2 selects the
  interlude screen (from the game's code, not seen running).
- The enemy fire mask `$0504` is read from a table at $3ED2 indexed by
  `$04F3` AND 7: $3F, $1F, $0F, then $0F for every later index, so from
  the second loop on it stays $0F (from the game's code, not seen
  running past loop 2, where $0F was measured). No other use of
  difficulty was found (from the game's code, not seen running).

### Object tables

- 16 virtual sprites in parallel 16-byte arrays, $10 apart from $040D:
  X bit 8 ($00/$FF), X, Y (the sort key), priority ($00/$FF, to `$D01B`),
  colour, pointer, dx, dy, type. Display Y is a copy at $04C2. Slot 0 is
  the player, 1-3 his bullets, 4 his grenade or a fourth bullet (one
  slot for both: with a grenade in flight at most three bullets fly),
  5-15 an 11-slot pool for enemies, their shots, explosions and items.
- Pool slots have an aux byte at $04A1, an aim byte at $04AC (the value a
  shot's direction is taken from) and an age at $04B7.
  $24B3 dispatches each pool slot through a word table at $24F2 indexed by
  type: 38,244 traced handler entries all matched the table.
- Every normal frame a Shell sort (gaps 7, 3, 1) orders a 16-byte index
  list at $4B-$5A by Y: 2,668 cycles median, 3,478 worst in 750 frames.
  It is skipped on the redraw frame, whose multiplex uses the old order.
- A free slot is parked: pointer $FF (the blank block), X 356, and a fixed
  Y (194, 40 or 30) that sorts it out of the way. The raster code never
  tests whether a slot is active (from the game's code, not seen
  running). There is no flicker and no overload
  handling: a sprite that misses its hardware slot is not drawn.
- The move routine copies Y to the display copy before moving slots 1-15,
  so their drawn Y is one frame behind their X; the player's is not.
- Enemy shots fire only when a shooter's age is a multiple of 64 and the
  aim sector and a free slot agree: 37 of 37 shots, all in area 0 with
  the fire mask at $3F. How the mask changes this in later areas was not
  measured. Player bullets fly 15
  frames (6 px a frame up, 8 sideways) and are tested on moves 1-14 only.
- Hit tests are boxes on the X and Y differences, low < d ≤ high: bullet
  (-10, +10] × (-12, +12], grenade blast (-18, +18] × (-22, +22], enemy
  touching player (-4, +4] × (-8, +8]. A bullet at X 250 misses a target at
  X 255: X + 10 wraps in 8 bits (measured defect).
- Score: two BCD bytes and a fixed "00"; an extra man every 10,000; the
  area end gives 1,400 (an earlier teardown note said 2,000; the score
  moved 010000 → 011400 on the walk-out).

### Level and data formats

- Map: raw screen codes, 40 bytes a row, row 0 at the top (the area's end),
  no tiles and no compression. One map per area in an 8 KB slot:

  | area | map | rows | charset | colour RAM | start row |
  |---|---|---|---|---|---|
  | 0 | $6000-$7E9F | 196 | $C000 | $0D | 175 |
  | 1 | $8000-$9D37 | 187 | $C800 | $0E | 166 |
  | 3 | $A000-$BD37 | 187 | $D800 | $0D (from the game's code, not seen running) | 166 |

  Rows run from 0 to start row + 20, the rows a player can see from the
  start (obs commando#map-1, #area3-1). Area 3 was measured by setting
  `$04F3` to 3 at area start: start row 166, `$D018` = $86, and all 840
  screen bytes equal the map at $A000 + 166 × 40. An earlier version gave
  area 3 start row 178, 199 rows and an end of $BF17, from the height of
  map-like bytes in the slot; those bytes run on past $BD37 but are never
  shown from the start, and what reads them is not settled.

- Screen rows equal `map + row × 40`, with the row in `$0403` counting down
  as the player advances (rung 1 in all three areas).
- Colour RAM is filled once per area with one multicolour value and never
  scrolled.
- Char attribute table, 256 bytes per area ($17A9, $18A9, $1AA9): bit 0
  blocks walking, bit 1 puts the sprite behind the scenery (`$043D` =
  $FF on 519 of 519 frames where the probe cell had it), bit 2 kills
  (`$0503` = 2). Area 0 has no bit-2 characters; area 1's table has 20 and
  area 3's 31 (counted in the tables; deaths measured in area 1 only).
- The map cell under a pixel is `base + ((Y − $1E)/8 + row) × 40 +
  (X − $10)/8`, plus 32 when X bit 8 is set, computed at $172F (from the
  game's code, not seen running). It ignores the fine scroll. Collision
  reads the map, never the screen: a CPU read of $E000 returns KERNAL ROM.
- Spawns: a per-area event list of four parallel byte arrays (trigger row,
  descending and $FF-terminated; X; a parameter; a handler index into a
  word table at $1C06), cursor `$04E8`. An event fires when its row equals
  `$0403`, one per frame. Area 0 has 40 events (measured); area 1's list
  has 32 and area 3's 34 (counted in the tables). A full
  pool lets an event overwrite a live object. Random side-entry grenadiers
  top up the scroll, about one per 140 scroll frames.
- Checkpoints: five ascending rows per area (area 0: 19, 61, 97, 131, 175).
  A restart takes the first entry at or above the current row, the nearest
  checkpoint behind the player: a death at row $8C restarted at $AF.
- Sound: one driver for music and effects, $5000-$5FB1 (4,018 bytes), play
  call $5012 once a frame. Three songs (title and game, high-score entry,
  area end); 16 effects. An effect takes voices 1 and 2; the tune keeps
  voice 3 and keeps stepping 1 and 2 silently. The last request wins. No
  filter; `$D418` is always $0F. Player gunfire makes no sound.
- Load: two crack depackers, which are the cracker's, not the game's. RUN
  to game entry at $0850 takes about 12.2 M cycles (12.4 s PAL). Init
  writes a CBM80 reset signature over the first 9 bytes of area 1's map.

### How it fits the frame

One raster source (`$D01A` = $F1, CIA1 timer A stopped). Every interrupt
enters the KERNAL at $FF48 (29 cycles), jumps through `$0314` to $4134,
and $4134 jumps through the vector at $0406. Each part re-arms `$D012`,
writes the next part's address there, acknowledges and ends with its own
register restore and RTI; $EA31 never runs. Fixed cost per interrupt: 63
cycles (rung 3 from the opcode timings, matching the trace).

| Part | Line | Does | Cycles min / median / max, 750 frames standing |
|---|---|---|---|
| $41C5 | 30 | YSCROLL, colours, 8 sprites (sorted 0-7 into hardware 7-0), area charset | 1,097 / 1,097 / 1,273 |
| $4284 | Y(sorted 3) + 20: 50 or 60 | sorted 8-11 into hardware 7-4 | 442 / 442 / 538 |
| $4389 | Y(sorted 12) − 2: 161-198 | sorted 12-15 into hardware 3-0 | 426 / 457 / 536 |
| $4137 | 213 | ECM+BMM on (black band), sprites 0-3 blank, YSCROLL 7, HUD charset, frame counter | 194 / 255 / 255 |
| $4188 | 222 | text mode again, HUD colours, music and effects | 529 / 974 / 1,449 |
| all five | | | 2,324 / 3,250 / 3,725 |

| Frame kind | n | IRQs median | Logic median | Idle min / median |
|---|---|---|---|---|
| normal, standing | 590 | 3,298 | 8,209 | 5,992 / 8,132 |
| normal, walking up | 587 | 3,344 | 8,220 | 6,229 / 8,030 |
| redraw, walking up | 77 | 3,329 | 14,589 | 859 / 1,652 |

- No frame was dropped in 1,500 play frames. The worst margin before the
  next frame counter step: 6,630 cycles on a normal frame, 1,040 on a
  redraw frame.
- The redraw copies 21 rows (840 bytes) with a self-modified load/store
  pair, from line 244 to line 181 of the next frame: 15,714 cycles with
  interrupts. It stays at least 26 lines ahead of the beam, so one screen
  serves without a tear.
- Screen: 24-row mode hides the top edge; the playfield shows on lines
  55-213 at every scroll phase; the ECM+BMM band blanks lines 214-222 and
  hides the bottom edge, the unstabilised interrupt jitter (2-7 cycles,
  up to 45 on a badline) and the forced YSCROLL 7; the HUD row is lines
  223-230. The band does not hide sprites, so the line-213 part points
  sprites 0-3 at the blank block.
- The music call costs 929 cycles median and 1,558 worst in play, and
  1,961 worst during the area-end jingle.
- The chain first runs after a start or respawn with the line-213 part
  entered at line 223 or 224 for one frame, since the arming routine sets
  `$D012` = 223 (rung 1 in both the tool run and the teardown).

### What an agent should copy as a mechanism

- Logic in the main loop, drawing and music in the raster chain, joined by
  one frame counter the chain increments at the bottom split
  (`frame_sync_loop`). Start logic right after the split, so the frame's
  largest job begins in the border.
- A threshold line instead of camera tracking, a one-way scroll, and the
  scroll step subtracted from every object's Y (`threshold_scroll_v`).
- On the coarse step, redraw the playfield from a raw row map starting in
  the bottom border and skip the rest of that frame's logic
  (`row_map_redraw`). To keep logic on all 8 frames, spread the copy or
  double-buffer with `$D018`; Commando does neither.
- A black ECM+BMM band over the playfield/HUD seam, with sprites blanked
  by pointer, since the band does not hide them (`invalid_mode_band`).
- Park free sprite slots on a blank block, off-screen X and a fixed Y, so
  the multiplexer never branches on "in use" (`sprite_slot_parking`).
- One attribute byte per character code for blocking, draw-behind and
  deadly terrain, read from the map rather than the screen
  (`char_attribute_flags`).
- Spawns keyed to map rows, and checkpoint rows for restarts
  (`wave_director`, `checkpoint_respawn`).
- Do not copy: the X-wrap in the hit test (compare with the bit-8 byte, or
  in 16 bits), and 24 KB of uncompressed maps that leave about 4.5 KB free.

### Evidence

No public disassembly of Commando is known, so no claim here has a rung-2
check against a source. Gridrunner, whose disassembly is public, is where
the RE tools are checked against one (issue #61). The teardown notes behind
this page stay on the maintainer's machine, because they quote a RAM image
of a commercial game. The tools' output on the session, and the teardown
figures the study lines rest on, are in the observations file; anyone
with the same image can replay them from the session file.

| Claim | Rung | Where measured | Observations |
|---|---|---|---|
| Five-part chain, handlers and lines | 2 | `c64_re_irq_chain` on the session (1,264 play frames, no input: $4389 on lines 177-192) and a separate monitor trace (750 frames still, 750 walking: $4389 on 161-198) agree | commando#irq-1-#irq-7, #frame-2 |
| Bank 3, screen $E000, `$01` = $36 at play start | 1 | `c64_re_snapshot` at the session's `in_play` ($0FEB, clock 35,080,026) | commando#snap-1 |
| `$01` never written in play; `$DD00` written once, $94 | 1 | store traces, 1,910 play frames | commando#mem-1, #mem-2 |
| Area charsets, HUD charset, `$D018` per band | 1 | `$D018` store trace in area 0; area 3 by setting `$04F3`; HUD row rendered with each charset | commando#mem-3, #area3-1 |
| Map bases, start rows, rows shown | 1 | screen compared with the map in areas 0, 1 and 3 | commando#map-1, #area3-1 |
| Free RAM $4500-$4FFF and the rest | 1 | VICE memmap from init to 1,910 play frames | commando#mem-4 |
| Sprite blocks $90-$FF | 1 | pointer stores over 1,910 frames | commando#mem-5 |
| Part costs, frame budget, no dropped frame | 1 | checkpoint trace on every part, 750 + 750 frames | commando#frame-1, #frame-2 |
| Measured frame figures | 3 | 19,656 minus the measured idle wait per frame | commando#frame-3 |
| Redraw cost 15,714 and the beam lead | 1 | trace of the copy, entry to RTS | commando#frame-4 |
| Load span, stubs, depack stages, entry $0850 | 1 | `c64_re_load_map` on the session | commando#load-1-#load-3 |
| Playfield lines 55-213, band 214-222, HUD 223-230 | 1 | exit screenshots measured with PIL | teardown only |
| Object fields, dispatch, sort, parking | 1 | traces and RAM pokes | teardown only |
| Hit boxes, shot timing, scores, terrain bits | 1 | poke trials (60) and scripted runs in areas 0 and 1 | teardown only |
| Event list, checkpoints, area-end wave | 1 | traces with `$04EF`/`$04F4` poked and deaths at known rows | teardown only |
| Sound driver cost, voices, no filter | 1 | SID store trace over 95 M cycles | teardown only |
| Credits (Butler, Hubbard) | 4 | Butler's Zzap!64 interview (issue 17, 1986) as quoted in `production-planning.md`; no credit string in RAM | none |

"Teardown only" rows are rung 1 monitor traces whose scripts and logs stay
local; they have no entry in the observations file yet.

Open, not settled here: what the $4389 part does when its Y-derived line
is already past; the `$41C5` entries at lines 286-287 in the tool run;
whether the stale sort on a redraw frame ever shows a sprite in the wrong
zone; what reads area 3's slot past $BD37; the 6569 (`-model c64`) timings, not run.
