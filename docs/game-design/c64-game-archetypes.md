---
kind: game
---

<!-- doc-type: archetype-reference -->

# C64 Game Archetypes

This catalog lists eleven game archetypes (genres) of the Commodore 64 library. Each entry gives the defining mechanic, the scene tradition around the genre, a technique fingerprint (the graph Technique nodes to consider when implementing the archetype), the pitfalls most likely to surface during development, three to five historical reference titles, and any known modern or homebrew revivals. It feeds `c64_game_briefing` and is a starting point for agent-built game plans.

The technique fingerprints use snake_case names that match Technique nodes in the graph. Only confirmed node names appear here. Where a technique has no graph node, the prose describes it in plain terms; find related content with `c64_search` or `c64_techniques_for`. Pitfall names match H2 headings in `docs/pitfalls/`. Each archetype is an `Archetype` node in the graph, named by its `**Archetype:**` line; the fingerprint and pitfall lines become its `FEATURES` and `RISKS` edges, and `c64_game_briefing` reads them (`docs/CONVENTIONS-archetypes.md`).

Scope: stock PAL and NTSC C64 hardware only. No C128-specific tricks, no REU scrolling shortcuts, no designs that require EasyFlash. Before finalising a timing-sensitive loop that must run on NTSC, consult the pal_ntsc_diff tool and the region-timing pitfalls section.

---

## Vertical Shmup

**Archetype:** `vertical_shmup`

**Starter:** `shmup-vertical`

The vertical shooter is one of the oldest C64 archetypes and one of the most demanding. The play field scrolls continuously toward the player, enemies arrive from the top of the screen in waves or patterns, and the player's ship moves freely within a zone near the bottom. Every frame the CPU pays for the scroll, an enemy fleet of a dozen or more sprites at once, and SID music and sound effects that must not drop beats. Commando (1985) is a well-known C64 example; its programmer, Chris Butler, told Zzap!64 it was his first time splitting sprites (`production-planning.md`). (An earlier version named Uridium and Delta as the benchmark and credited "Armalyte's vertical mode"; all three scroll horizontally, and no vertical mode of Armalyte is known here, issue #40.)

Vertical fine scrolling on the C64 is cheap: $D011's fine-scroll field moves the display by up to seven pixels before a coarse row shift is needed. A coarse shift moves the whole screen: 960 bytes of screen RAM and the same in colour RAM. That does not fit the blanking period (7,680 cycles unrolled for screen RAM alone, against 7,056 off-screen cycles on PAL, `char_scroll_buffer_v` in `techniques/scroll.md`), so it is copied behind the beam or into a second matrix; if the beam crosses the copy, the screen tears. (An earlier version said the shift must finish within the blanking period.) Raster IRQs split the frame into zones: a scroll update zone near the top, a sprite-multiplexer zone through the middle, and a SID service call near the bottom.

Enemy bullets and player missiles are usually sprites in the multiplex pool, not character data, so the active sprite count can exceed eight. The game multiplexer (`sprite_multiplex_game`) repositions by raster: each time the VIC finishes one sprite's scanlines, the handler moves that sprite's Y coordinate to the next object below it. It keeps a persistent sort and a double-buffered table, so sprites can go anywhere on the screen. Collision detection can use the hardware registers `$D01E` (sprite-sprite) and `$D01F` (sprite-background), but both are read-to-clear latches that must be read every frame without a miss, and a multiplexed sprite's bit does not say which object it was showing. Boxes per animation frame, tested by group (`per_frame_hitbox`), say which bullet hit which enemy.

The score panel is a fixed band under or over the scrolling field: a raster split resets the scroll registers for it every frame (`scroll_panel_split`). The waves are data, not code: each wave starts at a scroll position and each enemy follows a path program (`wave_director`).

A road shooter has a car for a ship: in Spy Hunter the road scrolls toward the player and enemy cars and a helicopter attack the player's car. Its extra parts are the car's handling, where throttle is the scroll speed (`vehicle_control`), cars that shove each other off the road (`car_contact_response`), and pursuit cars that pull alongside and ram (`lane_pursuit_ai`). They are not in the fingerprint because a ship shooter has none of them; a brief that names a car or a road finds them by its words.

**Technique fingerprint:** `soft_scroll_v`, `scroll_panel_split`, `sprite_multiplex_game`, `per_frame_hitbox`, `wave_director`, `sid_voice_setup`, `sid_play_routine_pattern`, `sfx_in_player`, `sprite_collision_detect`

An earlier fingerprint named `raster_bars`, which nothing in this section uses, and `sprite_multiplex_24`, whose own page scopes it to Oscar64's `vspr_*` path and the fixed-band demo recipe; it named neither the panel split, the hitboxes nor the wave director. Until #41 it also named `stable_raster_irq` and `double_irq`: the panel split polls for its line and times its writes from a delay table, as `kickassembler-scroll-panel-split` and the `shmup-vertical` starter's `kernel.asm` do, so neither is needed (the starter's PLAN.md drops both). `sfx_in_player`, which the starter uses for its effects, was missing.

**Brief words:** vertical shooter, vertical shmup, vertically scrolling, vertical scrolling, vertical scroller, road shooter, road, car, spy hunter

**Common pitfalls:** `sprite_dma_overflow`, `badline_cycle_loss`, `sprite_priority_collision_silent`, `raster_irq_first_line_jitter`

**Reference titles:** Commando (1985), Warhawk (1986), Lightforce (1986). Genre and year from general knowledge, not checked against a source here. (An earlier version listed Uridium, Delta, IO, Nemesis and Zynaps, which are horizontal shooters, issue #40.)

**Modern examples:** Scramble Spirits (scene release 2018, by Saul Cross)

---

## Horizontal Shmup

**Archetype:** `horizontal_shmup`

The horizontal shooter scrolls the play field from right to left while the player ship moves vertically against side-scrolling enemy formations. Armalyte (1988) and Katakis (1987) are the canonical C64 examples; R-Type's official conversion (1988) was commercially significant. The defining problem is parallax: depth needs at least two layers scrolling at different rates, which in character mode means two logical screen buffers or sprite tiles over a slower-moving background.

Character mode scrolls horizontally with $D016's fine-scroll field (0-7 pixels), plus a coarse column shift that moves data within screen RAM. The coarse step moves every row one column: 39 × 25 = 975 bytes of screen RAM plus the same in colour RAM (`char_scroll_buffer_h` in `techniques/scroll.md`), about as much as a vertical row shift (960). The standard engine is `infinite_scroll_h`: XSCROLL in $D016 moves the display 0-7 pixels, and when it wraps the screen shifts one column and the new right-hand column is filled from a map wider than 40 columns. (An earlier version said a column shift touches only 25 non-contiguous bytes, costs more than a row shift, and that the engine touches one column per frame; the whole screen moves every eighth pixel.)

Enemy formations in a horizontal shmup often span the full height of the screen, so the multiplex scheduler must handle objects spread vertically as well as horizontally. The parallax layer is usually slower-scrolling sprites (or a second character layer via sprite overlay) behind the main play field. Color clash is managed by palette assignment: the C64's per-character-cell color restriction means background art must avoid patterns that look wrong when a sprite passes over them.

**Technique fingerprint:** `soft_scroll_h`, `infinite_scroll_h`, `parallax_dual_layer`, `sprite_multiplex_24`, `stable_raster_irq`, `sid_voice_setup`, `sid_play_routine_pattern`, `sprite_collision_detect`

**Common pitfalls:** `sprite_dma_overflow`, `badline_cycle_loss`, `sprite_x_high_bit_wrong_register`, `raster_irq_first_line_jitter`

**Brief words:** horizontal shooter, horizontal shmup, horizontally scrolling, horizontal scrolling, side scrolling shooter, side scroller, katakis, armalyte, r type

**Reference titles:** Katakis (1987), R-Type (1988), Armalyte (1988), Hawkeye (1988), Enforcer (1992)

**Modern examples:** Berzerk Ball 2 (2011, tribute release)

---

## Single-Screen Platformer

**Archetype:** `single_screen_platformer`

The single-screen platformer's arena fits entirely on the 40x25 character display. Platforms, ladders and hazards are character tiles; the player and enemies are sprites that obey tile-based collision rules. Bubble Bobble (1987) is a clear example; Manic Miner (1983) set the template earlier. (An earlier version also named Bombuzal, a puzzle game, not a platformer; genres here are from general knowledge, not a source.) With no scroll there is no frame split, but collision detection must run for several actors every frame within the character grid.

Tile-based collision on the C64 is a CPU operation, not a hardware one. The game converts a sprite's X/Y position to a screen-RAM row and column, reads the character code at that cell, and looks it up in a table of solid tiles. With eight or more actors each checking several points (top-left, top-right, bottom-left, bottom-right), the per-frame cost adds up. Self-modifying code and zero-page burst loads are the common optimisations: the hot collision table is copied into zero page at load time, and the inner check loop uses zero-page addressing to save a cycle per access.

Enemy AI state machines take a large share of the CPU budget in this genre. Each enemy has a movement state (wandering, chasing, fleeing, dying), an animation frame counter, and often a small finite automaton for reversals and turnarounds. It is the sprite state machine of sports games, simpler because there is no scroll to synchronise with. Music and sound effects share the SID: the play routine is called once per frame from the main loop, not from a raster IRQ. That works because a raster wait at the top of the game loop locks the frame rate, not interrupt-driven timing.

**Technique fingerprint:** `stable_raster_irq`, `sprite_collision_detect`, `tile_grid_collision`, `sprite_multiplex_8`, `sid_voice_setup`, `sid_play_routine_pattern`, `self_modifying_code`, `zero_page_burst`

**Common pitfalls:** `sprite_priority_collision_silent`, `sprite_dma_overflow`, `badline_cycle_loss`, `kernal_clobbers_a_x_y`

**Brief words:** single screen platformer, single screen, ladder, manic miner, bubble bobble

**Reference titles:** Manic Miner (1983), Bubble Bobble (1987), Rainbow Islands (1990), Toki (1991), Creatures (1990)

**Modern examples:** Gridrunner Revolution port (scene, 2014)

---

## Scrolling Platformer

**Archetype:** `scrolling_platformer`

**Starter:** `platformer`

The scrolling platformer combines continuous horizontal (sometimes also vertical) scroll with multi-layer environments, large tile-based worlds and complex player physics. Mayhem in Monsterland (1993) and Turrican (1990) are the genre peaks on C64. Every frame must advance the scroll, render the new column of tile data at the off-screen buffer edge, update the sprite multiplex for all visible actors, run physics and collision for the player, and call the SID play routine, all within one frame. A PAL frame is 19,656 cycles (63 × 312); badlines take about 1,000 of them (25 × 40), and sprite DMA and the IRQ chain take more. The net is not measured here. (An earlier version said approximately 16,000 cycles, with no derivation.)

The tilemap is the central data structure. A world wider than 40 columns is stored as a compressed array of tile indices. Each frame the scroll counter increments, a new column of tile data is decoded into the screen-RAM edge, and the VIC's fine-scroll register advances. When the fine scroll reaches 7, the coarse shift happens and the process repeats. Parallax layers are usually separate character-mode or sprite-mode backgrounds scrolled at half or quarter speed by their own scroll registers, on a raster split below the play field.

Physics (gravity, jumping arcs, enemy movement) must be integer-based and fast. Fixed point in 8.8 or 16.8 is standard; the representation, the signed add, the table multiply and a measured jump arc are `fixed_point_8_8`, `table_multiply_8x8` and `jump_arc_table` in `techniques/maths.md`. Platform collision uses the tile lookup of the single-screen platformer but must add the scroll offset when converting sprite positions to tile indices. A large world map also needs a streaming tile cache: only the visible columns plus a small lookahead need to be in screen RAM at any time. Exomizer or Krill's loader can decompress world chunks from disk into RAM during play, but the load must finish before the scroll reaches the new section (a multi-load sequencing problem).

**Technique fingerprint:** `soft_scroll_h`, `infinite_scroll_h`, `parallax_dual_layer`, `sprite_multiplex_24`, `stable_raster_irq`, `double_irq`, `sid_play_routine_pattern`, `self_modifying_code`, `exomizer_basics`, `krill_loader_integration`, `multi_load_sequencing`, `sprite_collision_detect`, `fixed_point_8_8`, `jump_arc_table`, `joystick_edge_detect`, `frame_sync_loop`, `tile_map_render`, `tile_grid_collision`, `lfsr_random`

**Common pitfalls:** `badline_cycle_loss`, `sprite_dma_overflow`, `raster_irq_first_line_jitter`, `sprite_x_high_bit_wrong_register`

**Brief words:** scrolling platformer, scrolling platform game, run and gun, turrican, giana sisters

**Reference titles:** Turrican (1990), Turrican II (1991), Creatures (1990), Mayhem in Monsterland (1993), The Great Giana Sisters (1987)

**Modern examples:** Planet Golf (2024, RGCD)

---

## Top-Down Adventure

**Archetype:** `top_down_adventure`

The top-down adventure shows the world from above, with character tiles for terrain and sprites for the player and NPCs. The Last Ninja (1987) uses an isometric view, treating the tile grid as a diamond layout. (An earlier version called Bruce Lee pure top-down and Beyond the Forbidden Forest top-down exploration; both are side-view games, from general knowledge, and are dropped.) The main problem is world representation: a large multi-room or multi-zone world is loaded from disk piece by piece, and the tile art alone must show walkable versus blocked terrain, without a scrolling parallax layer.

Character mode fits. The 40x25 grid can show a detailed environment with careful tile design. Custom character sets replace the char ROM ($D018 points to charset data in RAM) for game-specific tile art. Sprites carry the player and up to seven other actors. Collision is per tile: the game keeps a separate collision attribute map (one byte per cell: passable/solid/hazard/interactable), often compressed and decompressed at room load.

Isometric projection (Last Ninja style) adds a transform: the logical grid is rotated 45 degrees, so each diagonal step in it is a 2:1 pixel move (right+down or left+down) on screen. A character walking behind a tree or wall must dip behind that background tile, which the C64's sprite-background priority register ($D01B) handles only coarsely. Advanced implementations clip sprites with raster IRQ splits.

**Technique fingerprint:** `stable_raster_irq`, `sprite_multiplex_8`, `sprite_collision_detect`, `sid_voice_setup`, `sid_play_routine_pattern`, `mob_priority`, `char_rom_under_vic`, `screen_ram_relocation`, `krill_loader_integration`

**Common pitfalls:** `sprite_priority_collision_silent`, `vic_bank_visibility_collision`, `kernal_io_mapping_dependency`, `ram_under_rom_traps`

**Brief words:** top down adventure, action adventure, rpg, dungeon, overworld

**Reference titles:** Green Beret (1986), The Last Ninja (1987), Zak McKracken (1988), Times of Lore (1988)

**Modern examples:** none widely known

---

## Puzzle

**Archetype:** `puzzle`

**Starter:** `action-puzzle`

Puzzle games run on a tile grid without continuous scroll. The player moves tiles, characters or objects by fixed rules to reach a target state. Boulder Dash (1984) is the canonical example: a grid of earth, boulders and diamonds where physics-like rules (boulders fall, diamonds slide) are simulated one cell at a time on a 40x25 grid. Lemmings-style games need actor pathfinding and state transitions per entity. Pipe Dream (1990) is placement-based. In all of them the CPU spends most of its budget on game logic, not rendering.

The display is a static or near-static character grid. Screen RAM is updated only where a tile changes state, by writing its character code to that cell; there is no scroll and no full-screen refresh. Rendering is cheap, so nearly all the CPU budget goes to game logic. A 40x25 board with 32 distinct cell types fits in a single character set page (256 chars with spares). Animation is the exception: tiles that cycle through frames (a twinkling diamond, a pulsing exit door) need a per-frame list that walks only the animated cells, not the full screen.

Puzzle games are one of the few C64 genres where the SID play routine can share the main loop without raster scheduling, because the frame rate need not be pixel-perfect. A raster wait at the top of the frame (spin on $D011 bit 7 until the blanking period) is enough. The harder work is the puzzle rules: Boulder Dash's diagonal-fall and explosion logic is a small state machine per cell, and running it for all 1000 cells 50 times a second needs careful ordering to avoid simulation artifacts.

**Technique fingerprint:** `frame_sync_loop`, `cave_scan_engine`, `charset_animation`, `sid_voice_setup`, `sid_play_routine_pattern`, `zero_page_burst`, `self_modifying_code`, `text_mode_overlay_render`

Until #41 the fingerprint named `sprite_multiplex_8` and `stable_raster_irq`. Neither fits the section: every object is a cell, not a sprite, and a raster wait at the top of the frame is enough. The `action-puzzle` starter, a Boulder Dash-style cave game, uses no sprites and a polled `frame_sync_loop`, and builds on `cave_scan_engine` and `charset_animation`, which the fingerprint did not name.

**Common pitfalls:** `badline_cycle_loss`, `kernal_clobbers_a_x_y`, `d012_wrap_around`, `sprite_priority_collision_silent`

**Brief words:** puzzle, boulder dash, sokoban, pipe dream

**Reference titles:** Boulder Dash (1984), Boulderdash II (1985), Pipe Dream (1990), Oxyd (1990), Sokoban (various ports, 1988)

**Modern examples:** Tileworld64 (2022, hobbyist)

---

## Text Adventure / Parser-Driven

**Archetype:** `text_adventure`

**Starter:** `adventure`

Text adventures present a prose narrative and accept natural-language commands typed at a prompt. Infocom's C64 ports (Zork, Hitchhiker's Guide, etc.) are the commercial standard; hobbyist games built with AGT and GAC followed. Nearly all CPU time goes to parsing, string matching and world-state management. Sprites are rare or absent; the display is character mode, often 40-column text with no scrolling. KERNAL I/O routines (CHRIN, CHROUT, GETIN) handle keyboard input and terminal output.

Memory is the main constraint. A large text adventure needs story text (often 50-100 KB), verb/noun tables, object databases and the parser engine, all in 64 KB with BASIC ROM, KERNAL ROM and I/O mapped in. Common strategies: bank out BASIC ROM to recover $A000-$BFFF (16 KB), keep story data in RAM under the KERNAL while calling KERNAL routines through the jump table, and compress message text with Huffman or a similar scheme. Infocom's Z-machine interpreter is one approach: the story file is a separate data blob and the interpreter is a small virtual machine that runs it, so the same parser runs many stories.

The SID plays simple sound effects (a beep on input, a chord on success or death) or nothing. The VIC-II runs its default 40-column character mode with no custom charset. IRQs, if used, only blink the cursor or keep a real-time clock for timed puzzles. The genre puts the least load on C64-specific hardware and the most on software architecture and data compression.

**Technique fingerprint:** `adventure_database_engine`, `two_word_parser`, `text_input_line`, `kernal_file_write_seq`, `kernal_file_read_seq`, `error_channel_check`, `sid_voice_setup`

Until #41 the fingerprint led with `ram_under_kernal`, `cpu_io_port_bank` and `exomizer_basics`, the strategies of the paragraph above for a story too large for 64 KB with the ROMs in. They are for that large game only; the `adventure` starter fits under $A000 with the ROMs in and drops all three (its PLAN.md). Look them up by name when a game needs them. The fingerprint named neither the engine, the input line nor the save and load a parser game needs.

**Common pitfalls:** `kernal_clobbers_a_x_y`, `kernal_io_mapping_dependency`, `kernal_assumes_sei_cleared`, `ram_under_rom_traps`

**Brief words:** text adventure, interactive fiction, parser, zork, infocom

**Reference titles:** Zork I (C64 port, 1982), The Hitchhiker's Guide to the Galaxy (1984), Leather Goddesses of Phobos (1986), Silicon Dreams trilogy (1985), Guild of Thieves (1987)

**Modern examples:** none widely known

---

## Action-Puzzle

**Archetype:** `action_puzzle`

The action-puzzle genre combines real-time input with a falling-tile or placement mechanic. Tetris is the archetype: pieces fall faster over time, and the player rotates and drops them to complete rows. Klax (1990) adds diagonal placement. The play field is small (10-20 columns wide, 20 rows tall) in the centre of the screen, with a score HUD beside it. Pieces are often large sprites used as oversized tiles rather than character cells, which allows smooth per-pixel movement during the drop animation.

A Tetris-style play field uses a fraction of the 40x25 character grid. HUD elements (score, level, next-piece preview) fill the outer area as character data. The play field itself can be character mode (custom charset tiles for filled and empty cells) or sprites (each falling piece as 2x2 or 3x3 sprites). Sprites allow positions finer than a character cell during the drop but use up the sprite slots quickly if several pieces are on screen at once.

Action-puzzle input needs debounce logic: when the player holds a direction key, the piece shifts once immediately, then repeats after a delay. The KERNAL's keyboard scan table suits this poorly: GETIN returns one character per call and does not tell a held key from a new press. Most implementations read the CIA keyboard matrix directly (CIA1 $DC00/$DC01) and keep their own key-state array with per-key age counters; that pattern, with its delay and repeat rates in frames and an exhaustive check of the logic, is `joystick_autorepeat` and `keyboard_matrix_scan` in `techniques/input.md`. The SID play routine is called once per frame from the main loop.

**Technique fingerprint:** `stable_raster_irq`, `sprite_multiplex_8`, `sprite_expand`, `sid_voice_setup`, `sid_play_routine_pattern`, `mcm_text`, `joystick_edge_detect`, `joystick_autorepeat`, `keyboard_matrix_scan`, `frame_sync_loop`, `text_mode_overlay_render`

**Common pitfalls:** `sprite_dma_overflow`, `badline_cycle_loss`, `kernal_clobbers_a_x_y`, `d012_wrap_around`

**Brief words:** action puzzle, puzzle, tetris, falling block, falling piece, klax, match three

**Reference titles:** Tetris (1988), Klax (1990), Columns (1990), Dr. Mario (unofficial port), Welltris (1990)

**Modern examples:** Petscii Robots (2020) adjacent; C64Tetris (various homebrew versions, ongoing)

---

## Sports

**Archetype:** `sports`

Sports games range from one-on-one fighting (International Karate, 1985) to multi-event track and field (Summer Games, 1984). The main technical problem is animation: athletes need many frames of motion (a sprinter may have 8-12 unique stride frames, a judoka a library of throws and stances), switched by game state. Sprite multiplexing is usually needed because athletes are large (2-3 sprites wide) and two to four players may be on screen at once.

International Karate and its sequels use many sprites: each fighter is two or three overlaid hardware sprites in multicolor mode, which gives a 24-pixel-wide character at the cost of color precision. The fight engine is a state machine (standing, walking, blocking, attacking, hit-recovery); each state has an animation sequence and a set of permitted transitions. Hit boxes are bounding boxes checked in software (sprite-to-sprite distances, not only $D01E), because the hardware collision register cannot tell a leg strike from a body strike.

Multi-event sports games (Summer Games, World Games) are a different problem: each event is a separate sub-game with its own controls, physics and rendering mode. The game loads each event from disk and sets up a fresh environment. A multi-load design with a common launcher stub keeps the code manageable. The SID carries a short fanfare between events and ambient sound during play, not a full music track.

**Technique fingerprint:** `sprite_multiplex_24`, `sprite_color_swap_mid_line`, `stable_raster_irq`, `sid_voice_setup`, `sid_play_routine_pattern`, `multi_load_sequencing`, `sprite_collision_detect`, `krill_loader_integration`

**Common pitfalls:** `sprite_dma_overflow`, `sprite_priority_collision_silent`, `sprite_x_high_bit_wrong_register`, `sprite_y_expand_double_register_write`

**Brief words:** sports, football, soccer, tennis, athletics, decathlon, olympic, summer games, one on one, combat, karate, joust, duel, knight games

**Reference titles:** Summer Games (1984), International Karate (1985), Summer Games II (1985), World Games (1986), International Karate + (1987)

**Modern examples:** none widely known

---

## Racing

**Archetype:** `racing`

**Starter:** `racing`

Racing games show speed and perspective by warping the road ahead of the player. The pseudo-3D road on the C64 uses raster IRQs to change $D016 (horizontal scroll) per scanline, so the road appears to curve toward a vanishing point. (An earlier version also offered changing "character widths per scanline"; the VIC-II has no character-width setting, only XSCROLL, CSEL and MCM in $D016, `hardware/vic-ii-reference.md`.) Pitstop II (1984) uses a split-screen view; Buggy Boy (1988) renders a wide, tree-lined track; Outrun-style racers need horizon color changes and road-stripe scheduling. Here the raster IRQ is the rendering primitive.

The road is a row of character cells per scanline, not a sprite or bitmap shape. A per-scanline horizontal shift via $D016 fine scroll makes the curve. Wider curves need larger shifts on consecutive lines; hills are approximated by varying the scanline count given to near and far road sections. Sprites represent other cars: a car at the horizon is a small sprite; as it approaches it moves to a larger Y coordinate and may be expanded with $D017 (Y-expand) or $D01D (X-expand). The scaling steps through discrete sizes, not continuously, but with enough sprite frames the illusion holds.

Color changes for road stripes, sky gradients and roadside scenery are all raster-IRQ-driven. A typical racing game has 30-50 raster interrupt points per frame, each updating one or more VIC registers. This is the demo-scene raster bar machinery, run at game speed alongside the physics. Road position update, car physics, sprite scale selection and SID play all share the non-IRQ CPU time between the scanline splits.

**Technique fingerprint:** `stable_raster_irq`, `double_irq`, `raster_bars`, `raster_split_modes`, `sprite_multiplex_8`, `sprite_expand`, `sid_voice_setup`, `sid_play_routine_pattern`

**Common pitfalls:** `badline_cycle_loss`, `raster_irq_first_line_jitter`, `d012_wrap_around`, `raster_line_count_difference`

**Brief words:** racing, racer, race, pseudo 3d, lap, grand prix, pitstop, out run, outrun

**Reference titles:** Pitstop II (1984), Buggy Boy (1988), Street Surfer (1986), Stunt Car Racer (1989), Super Cycle (1986)

**Modern examples:** Slipstream 5200 (2020, homebrew by Sarah Jane Avory)

---

## Beat-em-up

**Archetype:** `beat_em_up`

**Starter:** `beat-em-up`

The beat-em-up scrolls horizontally through urban or fantasy environments while the player fights several opponents on screen at once. Renegade (1987) and Target: Renegade (1988) are the defining C64 examples; IK+ (1987) bridges sports and beat-em-up. The genre needs the most simultaneous sprites of any non-shmup archetype: a player character (2-3 sprites wide), three to four enemies (2 sprites each), health bars and HUD elements, and possibly projectiles. That is twelve to sixteen hardware sprite slots, which needs a multiplexer even when enemies stay in one plane.

The play field scrolls horizontally as the player advances. Unlike the scrolling platformer, a beat-em-up uses a pseudo-3D layout: characters walk along a narrow horizontal band, and their Y coordinate is depth as well as screen position (walking toward the bottom of the screen moves the character forward, increasing Y). So the scroll is a modest background pan (walls, buildings, fences), not a tile-engine world map. The background is often a large character-mode scene in screen RAM, scrolled slowly; sprites carry foreground detail.

Enemy AI in beat-em-ups is more complex than in platformers or puzzle games. Each opponent is a state machine (patrol, approach, attack, stunned, knocked-down, getting-up), with stun and recovery timed by frame counters. Enemies must not collide with each other, so inter-enemy distance checks run every frame. The AI pass, the scroll update, the sprite multiplex repositioning and the SID play call must finish within one PAL frame: 19,656 cycles (63 × 312), less about 1,000 for badlines and whatever sprite DMA and the IRQ chain take, not measured here (an earlier version said approximately 16,000 non-IRQ cycles); the raster IRQ chain handles the exact timing of VIC register writes.

**Technique fingerprint:** `soft_scroll_h`, `sprite_multiplex_24`, `stable_raster_irq`, `sid_voice_setup`, `sid_play_routine_pattern`, `sprite_collision_detect`, `self_modifying_code`, `zero_page_burst`, `lane_depth_engine`

**Common pitfalls:** `sprite_dma_overflow`, `badline_cycle_loss`, `sprite_x_high_bit_wrong_register`, `sprite_priority_collision_silent`

**Brief words:** beat em up, brawler, fighting game, double dragon, renegade

**Reference titles:** Renegade (1987), Target: Renegade (1988), IK+ (1987), Double Dragon (1988), Barbarian (1987)

**Modern examples:** none widely known

- Production planning for any archetype (build order, memory budget, scope and region, editors): `./production-planning.md`.
