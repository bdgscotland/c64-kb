---
kind: game
---

<!-- doc-type: archetype-reference -->

# C64 Game Archetypes

This catalog documents the eleven canonical game archetypes (genres) that shaped the Commodore 64 library. Each entry is structured as a reference card: the defining mechanic, the scene tradition around that genre, a technique fingerprint that names the graph Technique nodes an agent should consider when implementing that archetype, the pitfalls most likely to surface during development, three to five historical reference titles, and any known modern or homebrew revivals. The catalog is intended to feed `c64_game_briefing` and serve as a starting point for agent-driven game construction plans.

The technique fingerprints use snake_case names that match Technique nodes loaded into the graph. Only confirmed node names appear here. Where a natural technique concept lacks a graph node, the prose section describes it in plain terms and the agent should use `c64_search` or `c64_techniques_for` to find related content. Pitfall names match H2 headings in `docs/pitfalls/`. Each archetype is an `Archetype` node in the graph, named by its `**Archetype:**` line; the fingerprint and pitfall lines become its `FEATURES` and `RISKS` edges, and `c64_game_briefing` reads them (`docs/CONVENTIONS-archetypes.md`).

A brief note on scope: the catalog covers stock PAL and NTSC C64 hardware only. No C128-specific tricks, no REU scrolling shortcuts, no EasyFlash-required game designs. Where NTSC compatibility is relevant, the pal_ntsc_diff tool and the region-timing pitfalls section should be consulted before finalising any timing-sensitive loop.

---

## Vertical Shmup

**Archetype:** `vertical_shmup`

The vertical shooter is one of the oldest and most demanding C64 archetypes. The play field scrolls continuously toward the player, enemies arrive from the top of the screen in waves or patterns, and the player's ship moves freely within a defined zone near the bottom. The CPU budget is extreme: the scroll consumes bandwidth every frame, the enemy fleet may number a dozen or more simultaneous sprites, and the SID must maintain music and sound effects without dropping beats. Titles like Uridium and Delta set the benchmark in 1986-87, and Armalyte's vertical mode demonstrated that the hardware could sustain truly dense sprite populations when the multiplexer was tuned correctly.

The central technical constraint is that vertical scrolling on the C64 is cheap at the hardware level — $D011's fine-scroll field moves the display by up to seven pixels before a coarse row-shift must be performed — but coarse shifts require rotating the entire screen RAM buffer, a CPU-intensive operation that must complete within the blanking period or produce visible tearing. Raster IRQs partition the frame into zones: a scroll update zone near the top, a sprite-multiplexer zone through the middle, and a SID service call near the bottom. Every cycle counts.

Enemy bullets and player missiles are typically rendered as sprites in the multiplex pool, not as character data, so the total active sprite count can easily exceed eight. The `sprite_multiplex_24` technique handles this through raster-scheduled repositioning — each time the VIC completes one sprite's scanlines, the handler repositions that sprite's Y-coordinate to the next logical object below it. Collision detection uses hardware `$D01E` (sprite-sprite) and `$D01F` (sprite-background) registers, but both are read-to-clear latches that must be polled on every frame without missing a read.

**Technique fingerprint:** `soft_scroll_v`, `sprite_multiplex_24`, `stable_raster_irq`, `double_irq`, `sid_voice_setup`, `sid_play_routine_pattern`, `sprite_collision_detect`, `raster_bars`

**Common pitfalls:** `sprite_dma_overflow`, `badline_cycle_loss`, `sprite_priority_collision_silent`, `raster_irq_first_line_jitter`

**Reference titles:** Uridium (1986), Delta (1987), IO (1987), Nemesis (1987), Zynaps (1987)

**Modern examples:** Scramble Spirits (scene release 2018, by Saul Cross)

---

## Horizontal Shmup

**Archetype:** `horizontal_shmup`

The horizontal shooter scrolls the play field from right to left while the player ship maneuvers vertically against side-scrolling enemy formations. Armalyte (1988) and Katakis (1987) are the canonical C64 examples; R-Type's official conversion (1988) was commercially significant. The defining challenge is parallax: a convincing sense of depth requires at least two independently scrolling layers moving at different rates, which on character hardware means maintaining two logical screen buffers or blending sprite tiles over a slower-moving background.

Horizontal scrolling in character mode is handled by $D016's fine-scroll field (0-7 pixels), with a coarse column-shift performed by moving data within screen RAM. The column shift is more expensive than a row shift because C64 screen RAM is laid out row-major: moving a column requires touching 25 non-contiguous bytes. The standard optimization is the infinite scroll technique, where a logical screen buffer wider than 40 columns is maintained and a hardware window reveals the correct slice via $D016 plus a column-rotation step that only touches one column per frame.

Sprite use in horizontal shmups is slightly different from vertical: enemy formations often stretch across the full height of the screen, so the multiplex scheduler must handle objects spread vertically as well as horizontally. The parallax layer is usually implemented by placing slower-scrolling sprites (or a second character layer via sprite overlay) behind the main play field. Color clash is managed by careful palette assignment — the C64's per-character-cell color restriction means background artwork must avoid patterns that look wrong when a sprite passes over them.

**Technique fingerprint:** `soft_scroll_h`, `infinite_scroll_h`, `parallax_dual_layer`, `sprite_multiplex_24`, `stable_raster_irq`, `sid_voice_setup`, `sid_play_routine_pattern`, `sprite_collision_detect`

**Common pitfalls:** `sprite_dma_overflow`, `badline_cycle_loss`, `sprite_x_high_bit_wrong_register`, `raster_irq_first_line_jitter`

**Reference titles:** Katakis (1987), R-Type (1988), Armalyte (1988), Hawkeye (1988), Enforcer (1992)

**Modern examples:** Berzerk Ball 2 (2011, tribute release)

---

## Single-Screen Platformer

**Archetype:** `single_screen_platformer`

The single-screen platformer presents a fixed-height arena that fits entirely on the 40x25 character display. Platforms, ladders, and hazards are encoded in character tiles; the player and enemies are sprites that must respect tile-based collision rules. Bubble Bobble (1987) and Bombuzal (1988) are the clearest examples, though earlier titles like Manic Miner (1983) established the template. The lack of scroll removes the frame-split complexity but replaces it with a different problem: collision detection must be fast enough to run for multiple actors on every frame within the character grid.

Tile-based collision on the C64 is a CPU operation, not a hardware one. The game reads a sprite's X/Y position, converts to a screen-RAM row and column index, reads the character code at that cell, and compares against a lookup table of solid tiles. With eight or more on-screen actors each checking multiple collision points (top-left, top-right, bottom-left, bottom-right), the per-frame cost adds up. Self-modifying code and zero-page burst loads are common optimizations: the hot collision table is copied into zero page at load time, and the check inner loop uses zero-page addressing to save a cycle per access.

Enemy AI state machines occupy a significant fraction of the CPU budget in this genre. Each enemy has a movement state (wandering, chasing, fleeing, dying), an animation frame counter, and often a simple finite automaton for reversals and turnarounds. The pattern is identical to the sprite state machines used in sports games but simpler because there is no scroll to synchronize with. Music and sound effects share the SID: a play routine is called once per frame from the main loop rather than from a raster IRQ, which is acceptable because the frame rate is locked by a waiting-for-raster spin at the top of the game loop rather than by interrupt-driven timing.

**Technique fingerprint:** `stable_raster_irq`, `sprite_collision_detect`, `tile_grid_collision`, `sprite_multiplex_8`, `sid_voice_setup`, `sid_play_routine_pattern`, `self_modifying_code`, `zero_page_burst`

**Common pitfalls:** `sprite_priority_collision_silent`, `sprite_dma_overflow`, `badline_cycle_loss`, `kernal_clobbers_a_x_y`

**Reference titles:** Manic Miner (1983), Bubble Bobble (1987), Rainbow Islands (1990), Toki (1991), Creatures (1990)

**Modern examples:** Gridrunner Revolution port (scene, 2014)

---

## Scrolling Platformer

**Archetype:** `scrolling_platformer`

The scrolling platformer combines continuous horizontal (sometimes also vertical) scroll with multi-layer environments, large tile-based worlds, and complex player physics. Mayhem in Monsterland (1993) and Turrican (1990) are the genre peaks on C64. The defining constraint is that every frame must advance the scroll, render the new column of tile data into the off-screen buffer edge, update the sprite multiplex for all visible actors, run physics and collision for the player, and call the SID play routine — all within approximately 16,000 cycles on PAL. There is no slack.

The tilemap is the central data structure. A world wider than 40 columns is stored as a compressed array of tile indices. Each frame the scroll counter increments, a new column of tile data is decoded and written into the screen-RAM edge, and the VIC's fine-scroll register advances. When the fine scroll reaches 7, the coarse shift happens and the process repeats. Parallax layers are usually separate character-mode or sprite-mode backgrounds scrolled at a fractional rate — typically half or quarter speed — by updating their scroll registers independently on a raster split below the play field.

Physics simulation (gravity, jumping arcs, enemy movement) must be integer-based and fast. Fixed-point arithmetic using 8.8 or 16.8 representation is standard; the representation, the signed add, the table multiply and a measured jump arc are `fixed_point_8_8`, `table_multiply_8x8` and `jump_arc_table` in `techniques/maths.md`. Platform collision uses the same tile-lookup approach as the single-screen platformer but must account for the scroll offset when converting sprite positions to tile indices. With a large world map, the agent must also design a streaming tile cache: only the visible columns plus a small lookahead need to be in screen RAM at any time. Exomizer or Krill's loader can decompress world chunks from disk into RAM on the fly, but the load must complete before the scroll reaches the new section — a multi-load sequencing problem.

**Technique fingerprint:** `soft_scroll_h`, `infinite_scroll_h`, `parallax_dual_layer`, `sprite_multiplex_24`, `stable_raster_irq`, `double_irq`, `sid_play_routine_pattern`, `self_modifying_code`, `exomizer_basics`, `krill_loader_integration`, `multi_load_sequencing`, `sprite_collision_detect`, `fixed_point_8_8`, `jump_arc_table`, `joystick_edge_detect`, `frame_sync_loop`, `tile_map_render`, `tile_grid_collision`, `lfsr_random`

**Common pitfalls:** `badline_cycle_loss`, `sprite_dma_overflow`, `raster_irq_first_line_jitter`, `sprite_x_high_bit_wrong_register`

**Reference titles:** Turrican (1990), Turrican II (1991), Creatures (1990), Mayhem in Monsterland (1993), The Great Giana Sisters (1987)

**Modern examples:** Planet Golf (2024, RGCD)

---

## Top-Down Adventure

**Archetype:** `top_down_adventure`

The top-down adventure renders a world from above, using character tiles to represent terrain and sprites for the player and NPCs. The Last Ninja (1987) adds an isometric perspective, treating the tile grid as a diamond layout; Bruce Lee (1984) uses pure top-down; Beyond the Forbidden Forest (1983) mixes vertical scrolling with top-down exploration. The defining challenge is world representation: a large multi-room or multi-zone world must be loaded from disk incrementally, and the tile art must carry enough visual information to convey walkable versus blocked terrain without a scrolling parallax layer.

Character mode is the natural fit. The 40x25 grid can represent a rich environment using careful tile design. The char ROM can be replaced with custom character sets ($D018 points to RAM-resident charset data) to provide game-specific tile art. Sprite overlays handle the player and up to seven additional actors. Collision is per-tile: the game maintains a separate collision attribute map (one byte per cell indicating passable/solid/hazard/interactable), often compressed and decompressed at room load time.

Isometric projection (Last Ninja style) adds a geometric transform: the logical world grid is rotated 45 degrees, so each diagonal step in the logical grid corresponds to a 2:1 pixel movement (right+down or left+down) on screen. Sprite priorities must be managed carefully — characters walking behind a tree or wall must dip behind the relevant background tile, which the C64's sprite-background priority system ($D01B) can handle only coarsely. Advanced implementations use sprite clipping via raster IRQ splits.

**Technique fingerprint:** `stable_raster_irq`, `sprite_multiplex_8`, `sprite_collision_detect`, `sid_voice_setup`, `sid_play_routine_pattern`, `mob_priority`, `char_rom_under_vic`, `screen_ram_relocation`, `krill_loader_integration`

**Common pitfalls:** `sprite_priority_collision_silent`, `vic_bank_visibility_collision`, `kernal_io_mapping_dependency`, `ram_under_rom_traps`

**Reference titles:** Bruce Lee (1984), Green Beret (1986), The Last Ninja (1987), Zak McKracken (1988), Times of Lore (1988)

**Modern examples:** none widely known

---

## Puzzle

**Archetype:** `puzzle`

Puzzle games operate on a tile grid without continuous scroll. The player moves tiles, characters, or objects according to fixed rules; the goal is to reach a target state. Boulder Dash (1984) is the canonical example: a grid of earth, boulders, and diamonds where physics-like rules (boulders fall, diamonds slide) are simulated one cell at a time on a 40x25 grid. Lemmings-style games require actor pathfinding and state transitions per entity. Pipe Dream (1990) is placement-based. The common factor is that the CPU spends most of its budget on game-logic simulation rather than rendering.

The display is typically a static or near-static character grid. Screen RAM is updated by writing individual character codes to the relevant cells when a tile changes state — no scroll, no full-screen refresh. This makes the rendering cheap and allows the CPU budget to be directed almost entirely at game logic. A 40x25 board with 32 distinct cell types fits in a single character set page (256 chars with spares). The trick is animation: tiles that cycle through frames (a twinkling diamond, a pulsing exit door) need a per-frame update list that walks only the animated cells rather than the full screen.

Puzzle games are one of the few C64 genres where the SID play routine can share the main loop without raster scheduling, because the frame rate need not be pixel-perfect. A simple top-of-frame raster wait (spin on $D011 bit 7 until the blanking period) is sufficient. The bigger engineering challenge is implementing the puzzle rules correctly and efficiently: Boulder Dash's diagonal-fall and explosion logic is a small state machine per cell, and running it for all 1000 cells 50 times a second requires careful ordering to avoid simulation artifacts.

**Technique fingerprint:** `stable_raster_irq`, `sid_voice_setup`, `sid_play_routine_pattern`, `sprite_multiplex_8`, `zero_page_burst`, `self_modifying_code`, `text_mode_overlay_render`

**Common pitfalls:** `badline_cycle_loss`, `kernal_clobbers_a_x_y`, `d012_wrap_around`, `sprite_priority_collision_silent`

**Reference titles:** Boulder Dash (1984), Boulderdash II (1985), Pipe Dream (1990), Oxyd (1990), Sokoban (various ports, 1988)

**Modern examples:** Tileworld64 (2022, hobbyist)

---

## Text Adventure / Parser-Driven

**Archetype:** `text_adventure`

Text adventure games present a prose narrative and accept natural-language commands typed at a prompt. Infocom's C64 ports (Zork, Hitchhiker's Guide, etc.) are the commercial standard; homegrown AGT and GAC-built games followed. The defining characteristic is that nearly all CPU time goes to parsing, string matching, and world-state management. Sprites are rare or absent; the display is pure character mode, often rendering 40-column text with no scrolling. KERNAL I/O routines (CHRIN, CHROUT, GETIN) handle keyboard input and terminal output.

The main technical constraint is memory. A large text adventure needs story text (often 50-100 KB), verb/noun tables, object databases, and the parser engine — all crammed into 64 KB with BASIC ROM, KERNAL ROM, and I/O mapped in. Common strategies: bank out BASIC ROM to recover $A000-$BFFF (16 KB), use RAM-under-KERNAL for story data while keeping KERNAL routines accessible via jump table, and compress message text using Huffman or similar schemes. Infocom's Z-machine interpreter demonstrates one approach: the story file is a separate data blob, and the interpreter is a small virtual machine that operates on it, allowing the same parser to run multiple stories.

The SID is typically used only for simple sound effects (a beep on input, a chord on success or death) or not at all. The VIC-II runs in its default 40-column character mode with no custom charset. IRQs, if used, exist only to blink the cursor or implement a real-time clock for timed puzzles. This genre places the lightest possible load on C64-specific hardware and the heaviest load on software architecture and data compression.

**Technique fingerprint:** `ram_under_kernal`, `cpu_io_port_bank`, `exomizer_basics`, `sid_voice_setup`

**Common pitfalls:** `kernal_clobbers_a_x_y`, `kernal_io_mapping_dependency`, `kernal_assumes_sei_cleared`, `ram_under_rom_traps`

**Reference titles:** Zork I (C64 port, 1982), The Hitchhiker's Guide to the Galaxy (1984), Leather Goddesses of Phobos (1986), Silicon Dreams trilogy (1985), Guild of Thieves (1987)

**Modern examples:** none widely known

---

## Action-Puzzle

**Archetype:** `action_puzzle`

The action-puzzle genre combines real-time input with a falling-tile or placement mechanic. Tetris is the archetype: pieces fall at a rate that increases over time, and the player rotates and drops them to complete rows. Klax (1990) adds diagonal placement. The defining feature is a small, well-defined play field (typically 10-20 columns wide, 20 rows tall) rendered in the center of the screen, with a score HUD flanking it. Pieces are often rendered as large sprites used as oversized tiles rather than as character cells, allowing smooth per-pixel movement during the drop animation.

The play field in Tetris-style games uses only a fraction of the 40x25 character grid. The outer area is filled with HUD elements (score, level, next-piece preview) drawn as character data. The active play field itself can be character-mode (using custom charset tiles to represent filled and empty cells) or sprite-mode (each falling piece rendered as 2x2 or 3x3 sprites). The sprite approach allows sub-character-cell positioning during the drop animation but consumes the sprite slots quickly if multiple pieces are on screen simultaneously.

Real-time input handling in action-puzzle games requires debounce logic: the player holds a direction key and the piece should shift once immediately, then repeat after a delay. The KERNAL's keyboard scan table is not ideally suited for this because GETIN returns a single character per call and does not distinguish held-from-newly-pressed. Most implementations read the CIA keyboard matrix directly (CIA1 $DC00/$DC01) and maintain their own key-state array with per-key age counters; that pattern, with its delay and repeat rates in frames and an exhaustive check of the logic, is `joystick_autorepeat` and `keyboard_matrix_scan` in `techniques/input.md`. The SID play routine is called once per frame from the main loop.

**Technique fingerprint:** `stable_raster_irq`, `sprite_multiplex_8`, `sprite_expand`, `sid_voice_setup`, `sid_play_routine_pattern`, `mcm_text`, `joystick_edge_detect`, `joystick_autorepeat`, `keyboard_matrix_scan`, `frame_sync_loop`, `text_mode_overlay_render`

**Common pitfalls:** `sprite_dma_overflow`, `badline_cycle_loss`, `kernal_clobbers_a_x_y`, `d012_wrap_around`

**Reference titles:** Tetris (1988), Klax (1990), Columns (1990), Dr. Mario (unofficial port), Welltris (1990)

**Modern examples:** Petscii Robots (2020) adjacent; C64Tetris (various homebrew versions, ongoing)

---

## Sports

**Archetype:** `sports`

Sports games range from one-on-one fighting (International Karate, 1985) to multi-event track-and-field competitions (Summer Games, 1984). The defining technical challenge is animation complexity: athletes require many frames of motion — a sprinter may have 8-12 unique stride frames, a judoka a library of throws and stances — and switching between them based on game state. Sprite multiplex is usually critical because athletes are large (2-3 sprites wide) and there may be two to four players on screen simultaneously.

International Karate and its sequels are sprite-intensive: each fighter is typically composed of two or three overlaid hardware sprites using the multicolor sprite mode, with the combination producing a 24-pixel-wide character at the cost of color precision. The fight engine is a state machine with states for standing, walking, blocking, attacking, and hit-recovery; each state has an animation sequence and a set of permitted transitions. Collision detection for hit boxes is bounding-box based (checking sprite-to-sprite distances in software, not relying solely on $D01E) because the hardware collision register does not provide enough spatial resolution to distinguish a leg strike from a body strike.

Multi-event sports games (Summer Games, World Games) present a different challenge: each event is essentially a separate sub-game with its own control scheme, physics, and rendering mode. The game must load each event from disk and initialize a fresh environment. A structured multi-load design with a common launcher stub keeps the code manageable. The SID typically carries a short fanfare between events and ambient sound during play, not a full music track.

**Technique fingerprint:** `sprite_multiplex_24`, `sprite_color_swap_mid_line`, `stable_raster_irq`, `sid_voice_setup`, `sid_play_routine_pattern`, `multi_load_sequencing`, `sprite_collision_detect`, `krill_loader_integration`

**Common pitfalls:** `sprite_dma_overflow`, `sprite_priority_collision_silent`, `sprite_x_high_bit_wrong_register`, `sprite_y_expand_double_register_write`

**Reference titles:** Summer Games (1984), International Karate (1985), Summer Games II (1985), World Games (1986), International Karate + (1987)

**Modern examples:** none widely known

---

## Racing

**Archetype:** `racing`

Racing games simulate speed and perspective by warping the road ahead of the player. The pseudo-3D road technique on the C64 uses raster IRQs to modify $D016 (horizontal scroll) or character widths per scanline to create the illusion of a curving road receding into a vanishing point. Pitstop II (1984) uses a split-screen view; Buggy Boy (1988) renders a wide, tree-lined track; Outrun-style racers require horizon color changes and road-stripe scheduling. The raster IRQ is not merely useful here — it is the rendering primitive.

The road is not drawn as a sprite or bitmap shape. Instead, each scanline of road is a row of character cells, and the per-scanline horizontal shift applied via $D016 fine scroll creates the road curve. Wider curves require larger shifts on consecutive lines; hills are approximated by varying the scanline count assigned to near versus far road sections. Scaled sprites represent other cars: a car at the horizon is rendered with a small sprite; as it approaches, the sprite is repositioned to a larger Y coordinate and optionally expanded with $D017 (Y-expand) or $D01D (X-expand). The scaling is not continuous — it steps through discrete sizes — but with enough sprite frames the illusion holds.

Color changes for road stripes, sky gradients, and roadside scenery are all raster-IRQ-driven. A typical racing game has 30-50 raster interrupt points per frame, each one updating one or more VIC registers. This is the same infrastructure as the demo-scene raster bar technique but applied at game speed with simultaneous physics updates. The CPU budget is extremely tight: road position update, car physics, sprite scale selection, and SID play must all share the non-IRQ time between scanline splits.

**Technique fingerprint:** `stable_raster_irq`, `double_irq`, `raster_bars`, `raster_split_modes`, `sprite_multiplex_8`, `sprite_expand`, `sid_voice_setup`, `sid_play_routine_pattern`

**Common pitfalls:** `badline_cycle_loss`, `raster_irq_first_line_jitter`, `d012_wrap_around`, `raster_line_count_difference`

**Reference titles:** Pitstop II (1984), Buggy Boy (1988), Street Surfer (1986), Stunt Car Racer (1989), Super Cycle (1986)

**Modern examples:** Slipstream 5200 (2020, homebrew by Sarah Jane Avory)

---

## Beat-em-up

**Archetype:** `beat_em_up`

The beat-em-up scrolls horizontally through a sequence of urban or fantasy environments while the player character fights multiple on-screen opponents simultaneously. Renegade (1987) and Target: Renegade (1988) are the defining C64 examples; IK+ (1987) bridges sports and beat-em-up. The genre demands the highest simultaneous sprite count of any non-shmup archetype: a player character (2-3 sprites wide), three to four enemy characters (2 sprites each), health bars and HUD elements, and possibly projectiles — easily twelve to sixteen hardware sprite slots in use, requiring a multiplexer even when enemies are constrained to one plane.

The play field scrolls horizontally as the player advances. Unlike the scrolling platformer, beat-em-ups typically use a pseudo-3D layout: characters walk along a narrow horizontal band, and their Y-coordinate represents depth as well as screen position (walking toward the bottom of the screen moves the character forward, increasing Y). This means the scroll is usually a modest background pan (walls, buildings, fences) rather than a tile-engine world map. The background is often a large character-mode scene painted into screen RAM and scrolled at a gentle pace; foreground detail is handled by sprites.

Enemy AI in beat-em-ups is necessarily more complex than in platformers or puzzle games. Each opponent has a state machine with states including patrol, approach, attack, stunned, knocked-down, and getting-up, with timing on stun and recovery governed by frame counters. Multiple enemies must not collide with each other, which requires inter-enemy distance checks every frame. The entire AI pass, the scroll update, the sprite multiplex repositioning, and the SID play call must complete within one PAL frame (approximately 16,000 non-IRQ cycles), leaving the raster IRQ chain to handle the precise timing of VIC register writes.

**Technique fingerprint:** `soft_scroll_h`, `sprite_multiplex_24`, `stable_raster_irq`, `sid_voice_setup`, `sid_play_routine_pattern`, `sprite_collision_detect`, `self_modifying_code`, `zero_page_burst`

**Common pitfalls:** `sprite_dma_overflow`, `badline_cycle_loss`, `sprite_x_high_bit_wrong_register`, `sprite_priority_collision_silent`

**Reference titles:** Renegade (1987), Target: Renegade (1988), IK+ (1987), Double Dragon (1988), Barbarian (1987)

**Modern examples:** none widely known
