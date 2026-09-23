<!-- doc-type: reference -->

# C64 Game Design Patterns

Recurring mechanical patterns that C64 games use, described so that an AI
agent can match the right pattern to a brief. Each section names the
tradeoffs in C64 terms — cycle budgets, RAM budgets, and hardware
constraints — so the choice is mechanical, not aesthetic.

Cross-references: `../techniques/sprite.md` for multiplexer mechanics and
hardware sprite capabilities; `../techniques/scroll.md` for soft-scroll and
parallax; `./c64-game-archetypes.md` for which archetype pairs with which
patterns.

---

## Collision systems

Collision is the most expensive per-frame logic in an action game. C64
games use up to four distinct systems, sometimes in combination.

---

### Hardware sprite-sprite collision

Register $D01E reads back a bitmask of which sprites have overlapped
another sprite during the last frame. Reading the register clears it. The
chip sets bits automatically with zero CPU cost.

Constraints:

- **Lossy.** Only one bit per sprite pair; no record of which pair or when.
  If two separate collisions involve the same sprite in one frame, the
  register cannot distinguish them.
- **Position-after-the-fact.** The register reflects the state at read time,
  not at the frame-render cycle where the pixels overlapped. If you read at
  the top of the game loop, the collision happened somewhere in the previous
  frame.
- **Multiplexed sprites break it.** When a hardware sprite is reused to
  represent two logical actors via a multiplexer, $D01E reports hardware
  sprite collisions, not logical actor collisions. A read after the first
  multiplex band clears the register before the second band fires.

Use $D01E for: shmups where the player sprite never multiplexes and enemy
bullets are always in a known hardware sprite slot. The lossy single-bit
result is acceptable because any hit in the frame ends the player life
regardless of which bullet caused it.

```asm
    lda $D01E        ; read and clear sprite-sprite register
    and #%00000001   ; test bit 0 (player sprite)
    bne .hit         ; branch if player overlapped any sprite
```

---

### Hardware sprite-background collision

Register $D01F records which sprites overlapped a non-zero (non-space)
foreground character cell during rendering. Same single-bit-per-sprite
design, same read-clears semantics.

Constraints: identical to $D01E plus one more — the collision fires on
any foreground pixel, including decorative tiles. If your map has purely
decorative "solid-looking" character cells that are not walls, you must
arrange the character set so decorative tiles appear as background-colored
pixels at the ROM/RAM level (multicolor tricks) or use a separate solid
map and ignore $D01F entirely.

Use $D01F for: shmups where the terrain is a single-color foreground
charset and any contact with it is fatal or obstructing.

---

### Software bounding-box collision

Compare each actor's X, Y extents against every other actor's extents in
pure 6510 arithmetic. Typical cost is 28–35 cycles per pair.

```asm
; Actor A at (ax, ay), width aw, height ah
; Actor B at (bx, by), width bw, height bh
; Returns carry set on overlap

.check_bbox:
    lda ax
    clc
    adc aw
    cmp bx          ; A_right < B_left?
    bcc .no_hit
    lda bx
    clc
    adc bw
    cmp ax          ; B_right < A_left?
    bcc .no_hit
    lda ay
    clc
    adc ah
    cmp by          ; A_bottom < B_top?
    bcc .no_hit
    lda by
    clc
    adc bh
    cmp ay          ; B_bottom < A_top?
    bcc .no_hit
    sec             ; overlap
    rts
.no_hit:
    clc
    rts
```

At 8 actors, that is 28 pair-checks worst case (n*(n-1)/2). At 35 cycles
per check, 28 pairs cost ~980 cycles — under 1 % of a PAL frame. At 16
actors the cost is ~3920 cycles, still well within budget if bounded-box
is the only collision layer.

Use software bounding-box for: platformers where you need sub-tile accuracy
for landing/hitting platforms, and for adventure games where the player
rectangle must exactly enter a doorway hitbox.

---

### Tilemap-grid collision

For terrain that never moves, test the map grid directly rather than every
possible object pair. Convert the actor's bounding corners to tile
coordinates and read the tile index from screen RAM or a parallel solid-bit
array.

```asm
; Convert pixel (px, py) to tile (tx, ty):
;   tx = px / 8    (LSR three times for 8-pixel tiles)
;   ty = py / 8    likewise
; Screen RAM address = $0400 + ty*40 + tx

.solid_check:
    lda py
    lsr
    lsr
    lsr             ; ty = py >> 3
    tax
    lda row_lo, x   ; precomputed: row_lo[ty] = ($0400 + ty*40) lo
    sta ptr
    lda row_hi, x
    sta ptr+1
    lda px
    lsr
    lsr
    lsr             ; tx = px >> 3
    tay
    lda (ptr), y    ; read tile index from screen RAM
    cmp #solid_min  ; solid tiles are >= solid_min
    bcs .is_solid
    rts
.is_solid:
    ; handle blocked movement
```

A parallel solid-bit array (one bit per tile, 125 bytes for a 40×25 grid)
avoids comparing character codes and survives charset reassignments. Allocate
it in zero page or page 2 for fast access.

Tilemap-grid collision costs 20–40 cycles per corner tested. A four-corner
player check is 80–160 cycles — negligible for one player.

Use tilemap-grid for: all games where the terrain is tile-based (platformers,
adventure games, top-down mazes). Combine with software bounding-box for
actor-actor hits and hardware registers only where the constraints above are
acceptable.

**Decision table:**

| Game type       | Primary collision           | Secondary         |
|-----------------|-----------------------------|-------------------|
| Shmup           | $D01E + $D01F               | —                 |
| Platformer      | Tilemap-grid (terrain)      | SW bbox (actors)  |
| Adventure       | Tilemap-grid only           | —                 |
| Maze/Pac-style  | Tilemap-grid                | —                 |

---

## Map representations

The right map format depends on whether the game fits on one screen,
how far it scrolls, and whether ROM or disk space is the binding constraint.

---

### Screen-aligned tilemap

When the entire playfield fits within the 40×25 character grid, screen RAM
at $0400 is the map. Color RAM at $D800 holds per-tile colors. The map is
already in the VIC-II's native format; no copy loop is needed.

Cost: 1000 bytes screen RAM + 1000 bytes color RAM = 2 KB for the visible
state. Additional pages are a direct copy-to-screen-RAM operation (1000
LDA/STA pairs, ~6000 cycles, done in the vertical blank).

Use for: single-screen games (Pac-style mazes, single-room puzzles, fixed
arena shooters).

---

### Scrolling tilemap

Horizontal or vertical scrolling games maintain a map buffer wider or taller
than the visible area. The classic layout for a horizontally scrolling game:

- Map buffer: 48 columns × 25 rows of tile indices (1200 bytes for the
  logical map slice in RAM).
- A `scroll_col_offset` byte tracks which logical column is at the left
  edge of the visible 40 columns.
- On each 8-pixel scroll step, copy the new column of tiles into screen RAM
  and color RAM, then update `scroll_col_offset`.

The soft-scroll register ($D016 XSCROLL) handles the 0–7 pixel fine phase.
When XSCROLL wraps, the column copy fires. This is the canonical
soft-scroll pattern described in `../techniques/scroll.md`. Decoding the
map into that column (metatiles to characters and colour RAM, the RLE
decoder, the CharPad import path) is `tile_map_render` on the same page,
with the recipe `../recipes/oscar64/tile-map-render.md`.

Vertical scrolling uses $D011 YSCROLL the same way, with a row copy at the
8-pixel boundary.

RAM cost for the buffer slice: 1–2 KB depending on scroll depth. For large
worlds, the full map lives on disk or in a compressed block and is paged in
as the player approaches a boundary.

---

### Compressed maps

A 128-room dungeon at 40×25 tiles per room is 128 KB uncompressed — well
above the 64 KB address space. Compression is mandatory.

**RLE:** Consecutive identical tile runs are stored as (count, tile). The
ratio depends on the room: three 40×22 rooms measured in
`recipes/oscar64/level-rle-decoder.md` pack 4.13:1 (a platform room),
1.40:1 (a maze, the worst of the three) and 10.73:1 (a nearly empty
room). The decoder in that recipe is 80 bytes of 6510 code by hand, or
149 bytes compiled from C at `-O2`, and decodes one 880-byte room in
16,470 to 27,673 cycles by hand or 28,193 to 50,447 cycles from C
(measured in VICE x64sc 3.10). An earlier version of this paragraph said
3:1 to 5:1, a 20 to 30 byte decoder and a few hundred cycles per screen;
none of the three had been measured, and neither the size nor the
cycle figure matches what was measured for this format.

**Dictionary / token substitution:** Repeated 2×2 or 4×4 tile blocks are
assigned token IDs. The map stores tokens; the decoder expands them into
screen RAM. Achieves 8:1 or better on repeating tilesets (castle brickwork,
cave walls). Costs more decoder RAM but compresses aggressively.

For disk-based games, the decompressor runs during the load of each level.
For cartridge or single-load games, all levels must decompress from a
banked ROM into the map buffer on demand.

---

## Enemy / actor state machines

All moving non-player objects are actors. The C64 enforces an implicit actor
limit through the sprite system: eight hardware sprites per frame. Multiplexed
setups handle 16–32 logical sprites; software-rendered actors (character
graphics) can go higher but at steep cycle cost.

---

### Slot-based actor table

Allocate a fixed array of N actor slots. Each slot holds:

```
actor_x:     .byte 0   ; pixel X (0–255 or 16-bit for wide worlds)
actor_y:     .byte 0   ; pixel Y
actor_state: .byte 0   ; state machine index (0 = inactive)
actor_type:  .byte 0   ; type index (indexes into behavior tables)
actor_timer: .byte 0   ; general-purpose countdown
actor_dx:    .byte 0   ; signed velocity X
actor_dy:    .byte 0   ; signed velocity Y
```

Seven bytes per actor. Eight actors: 56 bytes. Sixteen actors: 112 bytes.
All actor arrays live in the same zero page / page 2 / $C000 block so
indexed addressing is fast.

The sprite multiplexer (see `../techniques/sprite.md`) draws the active
slots. Slots with `actor_state = 0` are skipped by both the update loop
and the multiplexer.

---

### Per-actor state byte and handler jump table

Each actor type has a jump table of state-handler addresses indexed by
`actor_state`. The game loop iterates slots, reads the type, loads the
handler pointer for the current state, and JMPs indirectly.

```asm
.update_actors:
    ldx #0
.next_slot:
    lda actor_state, x
    beq .skip              ; state 0 = inactive
    ldy actor_type, x
    lda handler_lo, y      ; handler table indexed by type
    sta jmp_ptr
    lda handler_hi, y
    sta jmp_ptr+1
    jmp (jmp_ptr)          ; handler receives X = slot index
.skip:
    inx
    cpx #MAX_ACTORS
    bne .next_slot
```

Each handler reads `actor_state, x`, branches on it to the correct
sub-handler, updates position/timer, and transitions state by writing a
new value to `actor_state, x`. Transitions to state 0 return the slot to
the free pool.

Cost: one indirect JMP per actor per frame (~6 cycles) plus the handler
body. A simple patrol enemy handler (move, wall-check, reverse) runs in
~80 cycles.

---

### Path-based vs reactive AI

**Path-based:** Actor follows a pre-baked waypoint list stored in ROM.
State byte indexes the current waypoint. On each update, move toward
waypoint[state]; when within 2 pixels, increment state to the next
waypoint; wrap at the end. Zero decision logic, predictable, suitable for
fixed patrol routes in platformers and maze games.

```asm
; Simplified path follower
.path_step:
    ldy actor_timer, x      ; timer = waypoint index
    lda waypoint_x, y
    sec
    sbc actor_x, x
    beq .match_x
    bmi .move_left
.move_right:
    inc actor_x, x
    jmp .check_y
.move_left:
    dec actor_x, x
    jmp .check_y
.match_x:
    ; advance waypoint only when X matches
    inc actor_timer, x
```

**Reactive AI:** Actor computes direction from its position to the player
each frame. Subtract player_x from actor_x to get dx; subtract player_y
from actor_y to get dy; adjust velocity by sign(dx) and sign(dy). The sign
extraction is a single BPL/BMI branch. Predictable pursuit; pair with a
short random timer that pauses the actor for variety.

Reactive AI costs ~40 cycles per actor for the subtraction and sign-branch.
Path-based costs ~20 cycles per actor. Use path-based for turrets and fixed
patrol routes; use reactive for chasers and bosses.

---

### Object pool: slot table, spawn and despawn

The slot table above is an object pool. The parts that recur in every
game are the allocator, the spawner that feeds it, and the tick that
walks only the live slots. All figures below are cycles measured with
CIA1 timer A in VICE x64sc 3.10, Oscar64 -O2, eight slots, net of the
call and loop around them (rung 1; the listing is
`../recipes/oscar64/object-pool.md`).

**Parallel arrays, not structs.** One array per attribute, indexed by
slot number, so every access is `lda obj_x,y` with the slot in a register.
A struct array needs a multiply or a stride-added pointer per field.
Oscar64 compiles the C below to the same absolute-indexed code.

**Find a free slot by scanning for state 0.** Cost grows with the slot
number found: 27 cycles when slot 0 is free, 64 when slot 3 is the first
free one, 124 for a full pool that refuses. About 12 cycles per slot
examined, so a 16-slot pool costs up to about 220 on a refusal (rung 3,
from the measured eight-slot figures). Refusals are the normal case in a
busy frame, so the full-pool number is the one to budget.

**Free-list alternative.** Keep a stack of free slot numbers; allocate by
popping, free by pushing. A pop and a push together measured 44 cycles,
constant whatever the pool size. The trade-offs: eight bytes plus a top
index; every free must go through the push, so a handler that clears
`obj_state` directly leaks the slot for good; and slots come back in
free order, not lowest first, which changes draw order on a multiplexer
that walks slots in index order. Use it for pools of 16 or more where the
scan's worst case matters; the scan is fine at eight.

**Spawn from a wave table.** Five bytes per entry, in frame order,
terminated by a frame byte of $ff:

| byte | meaning |
|---|---|
| 0 | frame on which the entry fires |
| 1 | type (indexes the per-type tables) |
| 2 | x of the first object |
| 3 | y |
| 4 | count; objects are placed 16 pixels apart in x |

The spawner keeps one position into the table and fires every entry
whose frame byte equals the current frame. A spawn into a full pool is
dropped, not queued: the wave loses that object and the game goes on.
The game skeleton recipe in issue #1 reuses this layout. A spawn that
fills slot 0 and frees it again measured 146 cycles, of which 27 is the
scan; the rest is six stores and, in the listing, two counters and a log
store that a game would not have.

**Despawn.** Writing 0 to `obj_state` frees the slot; the other fields
are left stale and overwritten by the next spawn. Two paths free a slot
inside the tick: y at or past the bottom of the window (the constant is
the game's choice; 250 in the listing) and a per-slot countdown timer
reaching 0. A hit does not free the slot: it sets a dying state and a
short timer, so the explosion frames play from the same slot and the
timer does the freeing. Timer 0 means no timer, for bosses and scenery.

**Iterate only active slots.** The tick tests `obj_state` and skips free
slots. Eight active slots: 380 cycles for the move, off-screen test and
timer, 47.5 per slot. Eight free slots: 106 cycles, 13.25 per slot
skipped. A 16-slot pool with 8 active is therefore about 486 cycles a
frame before any per-type behaviour runs (rung 3).

```c
// Object pool: parallel arrays, scan allocator, wave table, per-frame tick.
#define MAX_OBJ    8
#define NO_SLOT    0xff
#define OFF_BOTTOM 250

char obj_state[MAX_OBJ];    // 0 = free; anything else is active
char obj_type[MAX_OBJ];
char obj_x[MAX_OBJ];
char obj_y[MAX_OBJ];
char obj_dy[MAX_OBJ];
char obj_timer[MAX_OBJ];    // frames left; 0 = no timer

static const char type_life[4] = { 0, 12, 12, 40 };
static const char type_dy[4]   = { 0,  1,  1,  2 };

// frame, type, x, y, count; $ff ends the table. Entries in frame order.
static const char wave_table[] = {
    0, 1,  24, 50, 8,
    1, 3, 100, 70, 3,
    0xff };
static char wave_pos;

char pool_alloc(void)
{
    for (char i = 0; i < MAX_OBJ; i++)
        if (obj_state[i] == 0)
            return i;
    return NO_SLOT;
}

char spawn(char type, char x, char y)
{
    char s = pool_alloc();
    if (s == NO_SLOT)
        return NO_SLOT;             // pool full: the wave loses this one
    obj_type[s]  = type;
    obj_x[s]     = x;
    obj_y[s]     = y;
    obj_dy[s]    = type_dy[type];
    obj_timer[s] = type_life[type];
    obj_state[s] = 1;               // last: the slot is visible once set
    return s;
}

void wave_step(char frame)
{
    while (wave_table[wave_pos] == frame)
    {
        char type  = wave_table[wave_pos + 1];
        char x     = wave_table[wave_pos + 2];
        char y     = wave_table[wave_pos + 3];
        char count = wave_table[wave_pos + 4];
        for (char k = 0; k < count; k++)
            spawn(type, x + (k << 4), y);
        wave_pos += 5;
    }
}

void update_all(void)
{
    for (char i = 0; i < MAX_OBJ; i++)
    {
        if (obj_state[i] == 0)
            continue;               // free slot: skip
        char y = obj_y[i] + obj_dy[i];
        obj_y[i] = y;
        if (y >= OFF_BOTTOM)
            obj_state[i] = 0;       // left the screen
        else if (obj_timer[i] != 0 && --obj_timer[i] == 0)
            obj_state[i] = 0;       // timer ran out
    }
}
```

The fragment compiles with Oscar64 -O2 as written once a `main` calls
`wave_step` and `update_all` once a frame; the listing gate does not
build C fragments on this page. In the recipe's build the compiler emits
`update_all` as one absolute-indexed loop with the timer decrement
folded into an `sbc #0` that borrows from the off-screen compare, which
is the code a hand assembler would write (read from Oscar64's `.asm`
output for the recipe listing, not from this fragment). `../recipes/oscar64/simple-shmup.md` spawns
its four enemies inline into a fixed `enemies[]` array with an `active`
flag; the pool is what that becomes once counts vary per wave.

---

## Game loop patterns

---

### Single-buffer IRQ-driven scroll

The dominant C64 pattern. The game runs one logical screen buffer. A raster
IRQ fires at the bottom of the playfield to swap sprite pointers and perform
any split-screen HUD work. Scroll column copies happen in the vertical blank
IRQ. Everything is single-buffered: the CPU writes to screen RAM while the
VIC-II reads from it, which is safe because writes and reads contend only
during the 8 raster lines of badlines, producing at most one garbled
character per badline — the classic "scroll tear" that well-timed VBlank
copies avoid.

The frame structure:

```
VBlank IRQ fires (line 0 / line 300 PAL):
  - Copy new scroll column to screen RAM
  - Update XSCROLL / YSCROLL register
  - Update sprite positions from actor table
  - Acknowledge $D019, re-arm for HUD split

[Game logic runs in main loop during active display]

Raster IRQ fires at HUD split line:
  - Write HUD sprite data
  - Possibly change border color for debug
  - Acknowledge $D019, re-arm for next VBlank
```

The main loop processes input, advances actor states, resolves collision,
and updates score. On PAL (50 Hz) the loop has ~19 700 cycles of CPU time
per frame after IRQ overhead. The loop's wait-for-frame, frame counter,
dropped-frame detection and border-colour budget bar are the technique
`frame_sync_loop` in `techniques/raster.md` (recipe
`recipes/oscar64/frame-sync-loop.md`); reading the controls as press
events with auto-repeat is `techniques/input.md`; sub-pixel movement and
the jump arc are `techniques/maths.md`.

---

### Double-buffer

Two full screen RAM areas (1 KB each: 1,000 cells plus the sprite pointer
block in the last eight bytes of the page) alternate: the CPU draws into
the back buffer while the VIC-II displays the front buffer. At VBlank,
swap the VIC-II base address ($D018) to flip. The layout, the sprite
pointer block that moves with the page, and the frame-parity discipline
are `screen_double_buffer_d018` in `../techniques/memory-banking.md`, with
the recipe `../recipes/oscar64/double-buffer.md` and a companion that shows
the corrupted sprite you get without the pointer mirror.

Memory cost: 1 KB for the second screen RAM (an earlier version of this
section said 2 KB). Color RAM ($D800–$DBFF) cannot be double-buffered
(only one color RAM exists in hardware), so double-buffering only
eliminates screen-RAM tearing, not color-RAM tearing.

Use double-buffer only when the game redraws most of the screen each frame
(3D wireframe, full-screen bitmap effects) and tearing is visually
unacceptable. Standard tile-scroll games should prefer single-buffer plus
carefully timed column copies.

---

### 60 Hz vs 50 Hz update rate and cross-region releases

PAL runs at 50 frames/second; NTSC runs at ~60 frames/second. A game loop
tied to the frame rate runs 20 % faster on NTSC. Three strategies:

1. **PAL-only:** Ignore NTSC. Ship for the European market. Fastest to
   implement; widely acceptable for 1980s-style games.

2. **Dual-rate logic:** Detect region via raster line count ($D011 bit 7
   cycle comparison, or count raster lines in VBlank and compare to 312
   vs 263). Run game logic at the detected frame rate. Physics values
   (gravity, speeds) must be tuned separately per region, stored in two
   ROM tables selected at startup.

3. **Fixed-timestep decoupled from frame rate:** Run game logic at a fixed
   50 Hz tick using a CIA timer (CIA1 Timer A), fire an NMI or flag a
   semaphore, and render at the display frame rate. Correct but complex;
   the extra timer interrupt costs ~35 cycles per frame of overhead. Used
   by some later commercial titles.

For most games: PAL-only or dual-rate with two physics tables is the
practical choice. See `../hardware/pal-ntsc-reference.md` for region
detection details and the `c64_pal_ntsc_diff` tool for per-topic diffs.

---

## Memory layouts for game state

---

### The 38911-byte basic-free area

BASIC ROM occupies $A000–$BFFF. Switching it out (bit 0 of $0001) frees
8 KB for code or data but loses BASIC. All action games disable BASIC. With
BASIC and KERNAL both out ($0001 = %00110101), the full $A000–$FFFF range
(minus I/O at $D000–$DFFF) is available.

Practical RAM budget for a game without KERNAL:

```
$0002–$00FF   Zero page (254 bytes) — fast scratch, counters, pointers
$0100–$01FF   Stack (256 bytes, fixed)
$0200–$02FF   Page 2 (256 bytes) — actor tables, IRQ flag bytes
$0300–$03FF   Page 3 (256 bytes) — jump vectors; avoid overwriting $0314/$0315
$0400–$07FF   Screen RAM (1000 bytes used; 96 bytes spare)
$0800–$9FFF   ~38 KB — code, data, charset, music, level data
$A000–$BFFF   8 KB free when BASIC out — level data, extra code
$C000–$CFFF   4 KB — canonical "game state" block (see below)
$D000–$DFFF   I/O (VIC-II, SID, CIA, Color RAM) — never overwrite without banking
$E000–$FFFF   8 KB free when KERNAL out — fast data, but lose KERNAL routines
```

---

### $C000–$CFFF as the canonical game state block

The 4 KB at $C000 is above the typical code-and-data area but below the I/O
window. It is not shadowed by any ROM. Convention in C64 games:

- `$C000–$C0FF`: Current-level descriptor (tileset index, music track,
  enemy spawn table pointer, starting player position).
- `$C100–$C1FF`: Persistent game state (lives, score BCD, continues,
  unlocked levels, inventory flags).
- `$C200–$C2FF`: Per-frame scratch (collision result bits, input debounce
  state, IRQ semaphores).
- `$C300–$CFFF`: Overflow for large actor tables or a secondary map buffer
  when the main buffer at $0800 is insufficient.

This layout is a convention, not a hardware requirement. Its value is that
the MCP tools in this KB assume it when generating code, so briefings and
recipes stay consistent.

---

### Save state mechanisms

The C64 has no battery-backed RAM in stock hardware. Three historical
approaches:

**None.** Most arcade-style games. Progress resets on power-off. The entire
game fits in one session. Simplest; zero save-system code.

**Cassette write.** Use the KERNAL `SAVE` routine (or direct serial/tape
protocol) to write the $C100–$C1FF persistent state block to cassette.
Load it back with `LOAD`. Cassette save of 256 bytes takes ~10 seconds on
a stock 1530 datasette. Acceptable for turn-based or RPG games where the
player expects a save ritual.

**Disk write.** Open a sequential or relative file on the 1541 via the
KERNAL `OPEN`/`PRINT#`/`CLOSE` sequence and write the persistent state
block. A 256-byte block writes in under 1 second. Disk save is the standard
for C64 RPGs and adventure games. Requires the KERNAL to remain available
(do not page it out) during the save, or rebank it in for the save routine.
The call sequences, the error-channel check and a measured write-and-read
round-trip are `kernal_file_write_seq`, `kernal_file_read_seq` and
`error_channel_check` in `../techniques/file-io.md`.

### Save-file policy: first run, replace, version, missing drive

The file calls are the small part. What a game has to decide around
them is below; every figure is from
`../recipes/oscar64/high-score-persist.md`, measured in VICE x64sc 3.10
with its 1541 emulation and a disk formatted by c1541, unless marked.
The bare call sequences are in `../recipes/oscar64/save-load-seq-file.md`
and `../recipes/kickassembler/file-io-roundtrip.md` and are not repeated
here.

**Allow for the banner.** A 1541 answers its first status read after
reset with `73,CBM DOS V2.6 1541,00,00` (measured with a probe that
reads the channel before any other command). A check that treats any
non-zero code as failure refuses a healthy drive. The recipe's first
call is the OPEN of the save file, and the `62` or `00` that raises
replaces the banner before the channel is read; a game that reads the
channel first must accept `73` as healthy. The `2.6` in that line is
the DOS version the replies below come from.

**First run.** Try to read the file before writing anything. On a disk
that has never held it, OPEN for read succeeds (ST `00`), the read
returns 0 bytes with ST `$42`, and the error channel says `62, FILE NOT
FOUND,00,00`. That is the first-run signal, not a fault: show the
default table and write it at once, so the next run finds the file.

**Replace by scratch, then write.** OPEN of `NAME,S,W` on a name that
exists is refused with `63, FILE EXISTS,00,00`, and every byte written
into that channel afterwards comes back with ST `$80`, the
device-not-present bit (`KRNIO_NODEVICE` in Oscar64's `kernalio.h`): the
drive did not acknowledge bytes on a channel it never opened, and the
disk is unchanged. `@0:NAME,S,W` asks
DOS 2.6 for save-with-replace, a command with a long-reported
corruption defect that this KB has not measured (rung 4) and does not
recommend relying on (`../techniques/file-io.md`,
`kernal_file_write_seq`). Send `S0:NAME` on the command channel
instead, read the reply on the same open channel (`01, FILES
SCRATCHED,01,00`; closing channel 15 and reopening it reads `00, OK`
instead), then OPEN for write. Scratching a name that is not there
answers `01, FILES SCRATCHED,00,00` (count `00`) and changes nothing
(measured in VICE). Either way the close must be allowed to finish: a
run cut
before it leaves a splat file (`../pitfalls/kernal-and-io.md`,
`krnio_save_leaves_splat_file`).

**Version byte and a fixed-size record.** Put a magic pair and a
version byte at the head of the record and keep the record one fixed
size. On read, accept it only when the byte count, the magic and the
version all match; otherwise say so on screen, scratch it and write the
defaults. Run against a 15-byte version-0 file planted with c1541, the
recipe printed `OLD FORMAT 15 BYTES V0: RESET`, replaced it and read a
good record back. An old save is then readable or cleanly replaced,
never half-parsed.

**When drive 8 does not answer.** Two cases, and they look different.
A drive with no disk (VICE `-default` with no `-8`, which still
emulates a 1541) lets the OPEN for read succeed, returns 0 bytes with
ST `$42`, and says `74,DRIVE NOT READY,00,00`. Treat any first-read
code other than `00` or `62` as saving off for the session: show the
defaults, say that scores will not be saved, keep playing, and do not
attempt the write. No device on the bus at all (VICE with
`-drive8type 0`) is caught one call earlier: an OPEN that sends a
filename or command returns C=1 with ST bit 7 set (`KRNIO_NODEVICE`;
the KERNAL's code for it is 5, device not present), because nothing
pulled DATA low in answer to the
LISTEN (`../hardware/kernal-routines-reference.md`, CHKOUT entry; the
recipe prints `OPEN 0 ST=80` and `NO DEVICE`). An OPEN of channel 15
with an empty name cannot see this: the KERNAL sends nothing on the bus
when the filename length is zero, so it returns success with ST `00`
whether or not a drive exists (measured: `1 ST=00` with no drive, where
`I0` on the same channel gave `0 ST=80`). The first CHKIN on such a
channel then hangs with no timeout (same page, CHKIN entry), and a
status read through `krnio_gets` starts with CHKIN; an earlier build of
the recipe did exactly that and sat with its title line alone on screen
after 24,000,000 cycles. So the OPEN whose result decides whether the
drive exists must be one that sends bytes, the save file's own OPEN for
read is the natural one, and no status read may run before it has
succeeded.

**KERNAL banked in.** Every call in the sequence is a KERNAL call and
the serial code drives CIA2 directly, so the ROM at $E000-$FFFF and
the I/O area at $D000-$DFFF must both be mapped from the first OPEN to
the last CLOSE. A game that runs with the KERNAL out banks it back in
around the save routine and keeps its own interrupts off, or its
handler reachable through the ROM's $0314 vector, while the ROM is in.

---

## Scoring, lives, and HUD

---

### HUD via raster-IRQ split

The HUD (score, lives, timer) is most commonly placed above or below the
playfield using a raster-IRQ color and charset switch. The playfield
uses one charset; at the HUD split line the IRQ switches $D018 to point
to a second charset block where the score digits are custom-drawn,
restoring the playfield charset on the line where the playfield resumes.

Top-of-screen HUD (most common in platformers):

```
Raster IRQ at line 50 (start of playfield):
  - Restore playfield $D018 charset pointer
  - Restore playfield sprite colors
  - Acknowledge, re-arm for VBlank

VBlank: write updated score digits to HUD screen RAM rows ($0400–$04A7)
        before the beam returns
```

Bottom-of-screen HUD (common in shmups):

```
Raster IRQ at line 216 (after last playfield row):
  - Switch $D018 to HUD charset
  - Change sprite priority/colors for HUD icons
  - Acknowledge, re-arm for VBlank
```

Both HUD areas use the same physical screen RAM ($0400–$07E7). The split
just changes which charset the VIC-II uses to render the character codes in
those rows. Sprites can cross the split freely; only the character rendering
changes.

---

### Score update routines

Score is stored as BCD (binary-coded decimal) because display requires
per-digit output and BCD avoids a full binary-to-decimal conversion every
frame.

**Per-digit increment (simple):** Six bytes for a six-digit score. Each
byte holds two BCD digits (packed: high nibble = tens, low nibble = units).
Use the 6510 ADC instruction with the D (decimal) flag set (SED before ADC,
CLD after). Carry propagates automatically through packed BCD.

```asm
    sed                  ; set decimal mode
    clc
    lda score_lo
    adc points_lo        ; add points, BCD carry propagates
    sta score_lo
    lda score_hi
    adc points_hi
    sta score_hi
    cld                  ; clear decimal mode immediately
```

**Display:** Each score byte maps to two PETSCII or custom-charset digit
characters. Extract high nibble with LSR×4, add character-set base offset,
write to screen RAM. Extract low nibble with AND #$0F, add offset, write.

```asm
    lda score_hi
    lsr
    lsr
    lsr
    lsr                  ; high nibble
    clc
    adc #'0'             ; PETSCII digit base (or custom charset offset)
    sta $0402            ; write to HUD position
    lda score_hi
    and #$0F             ; low nibble
    clc
    adc #'0'
    sta $0403
```

For custom charsets, replace `#'0'` with the base character index of your
digit glyphs.

**Full-number convert (BCD to screen RAM):** If points are awarded in
binary (e.g. physics-derived values), convert to BCD using the double-dabble
algorithm before storing. Double-dabble on a 16-bit value costs 875
cycles in assembly with decimal mode, including the unpack to five screen
codes (measured in VICE x64sc 3.10 with CIA1 timer A; see "Printing
numbers" below). An earlier version of this page said ~300 cycles, which
was not measured. Run it in VBlank or on score-change events, not every
frame.

---

### Printing numbers

A binary value (a timer, a coordinate, a physics-derived score) has to
become digits on the screen. That is two jobs: converting binary to
decimal digits, and writing those digits into screen RAM.

**Screen codes, no KERNAL.** Digits `0`-`9` are screen codes `$30`-`$39`,
the same values as their PETSCII codes, so `digit + $30` is right whether
you think in screen codes or PETSCII. Space is `$20` in both. Letters are
not the same: `A` is screen code `$01` and PETSCII `$41`, so the hex
digits `A`-`F` are `$01`-`$06` on screen. Store the byte at
`$0400 + 40 * row + column` and set colour RAM at `$D800` once at start.
CHROUT is not needed for a HUD: it costs a cursor, a colour write and a
scroll check per character.

**Subtract-powers.** For each power of ten from 10000 down to 10, count
how many times it can be subtracted from the value; the count is the
digit, and what is left after 10 is the units. A 16-bit value needs four
powers, an 8-bit value two (100 and 10). The cost is proportional to the
digit sum: 65535 takes 19 subtractions, 59999 takes 32 (the 16-bit worst
case), 10000 takes one.

**Double-dabble.** Shift the value out from the top bit into a BCD
accumulator, doubling the accumulator each time. Before each doubling,
any BCD nibble of 5 or more has 3 added so the doubling carries a ten out
of it. On the 6502 the whole adjust step disappears: in decimal mode
(`SED`) `adc` of a byte to itself doubles a packed BCD pair correctly.
Sixteen passes of `asl / rol` on the value and three `adc` on the
accumulator give five BCD digits in a fixed time, with no tables. C has
no decimal mode, so a C double-dabble has to test every nibble and is the
slowest route measured below.

**Zero suppression and right alignment.** Print into a field of fixed
width. Keep a `lead` flag set until the first non-zero digit; while it is
set, a zero digit writes `$20` instead of `$30`. The last digit always
prints, so 0 shows as `0`. Because the field is fixed and the leading
cells are spaces, the value is right-aligned with no second pass. An
arcade score with leading zeros is the same routine without the `lead`
test.

**Hexadecimal for debugging.** High nibble by four `lsr`, low nibble by
`and #$0F`, each through a 16-entry screen-code table
(`$30`-`$39`, `$01`-`$06`). Two cells per byte, 74 cycles from C
(measured below), and it never lies about the byte the way a decimal
routine with a bug can.

**Measured cost of each route.** VICE x64sc 3.10, CIA1 timer A
force-loaded from `$FFFF`, display blanked and the timing started at the
next frame so no badline steals cycles, empty call subtracted: the
figures are the body of the routine without `JSR` and `RTS` (rung 1).
PAL and NTSC gave the same figures. The C listings are in
`recipes/oscar64/print-number.md` and both KickAssembler routines are
below; the same source assembled in a harness with the timer gave these
numbers.

| Route | Value | Cycles |
|---|---|---|
| KickAssembler subtract-powers (listing below) | 65535 | 879 |
| KickAssembler subtract-powers | 59999, worst case | 1,243 |
| KickAssembler double-dabble, decimal mode (listing below) | 65535 and 59999 | 875 |
| Oscar64 C subtract-powers, `fmt_dec_sub` | 65535 | 957 |
| Oscar64 C subtract-powers, `fmt_dec_sub` | 59999, worst case | 1,361 |
| Oscar64 C double-dabble, nibble adjust, `fmt_dec_dab` | 65535 | 2,537 |
| Oscar64 C hex byte, `fmt_hex8` | $FF | 74 |

The last few cycles depend on code placement: the same double-dabble
read 860 in an earlier build where its inner loop did not cross a page,
and 875 after a 12-byte insertion moved it (fifteen taken branches at
one extra cycle each, rung 3). A first version of the harness that
blanked the display and timed at once read 9 per cent higher on NTSC,
because the VIC-II samples the DEN bit once per frame, on line `$30`
(VIC-II documentation, not measured here; what was measured is that the
wait closes the 9 per cent NTSC gap). Both decimal routes were checked
against Python over
all 65,536 values (the `PASS` lines in the recipe).

**Which to use where.**

- Score kept in BCD (the routines above): no conversion at all. Unpack
  nibbles, add `$30`, write. Cheapest by far.
- 16-bit binary in assembly: double-dabble with `SED` (`dab_u16` below).
  Fixed 875 cycles, no tables, 106 bytes with the unpack (the
  subtract-powers routine below is 90 with its tables; both from the
  assembler's symbol file, rung 1).
  Subtract-powers wins only when
  values are usually small, since its cost falls with the digit sum
  (rung 3, not measured for small values here).
- 16-bit binary from Oscar64 C: subtract-powers. The C double-dabble is
  2.6 times slower. If the fixed cost matters, call the assembly
  double-dabble through `__asm`.
- 8-bit binary: subtract-powers with two powers, or a 256-entry table of
  packed BCD if the 256 bytes are spare (not measured here).
- Budget: 1,000 cycles is about 16 PAL raster lines (63 cycles per line,
  rung 3). Fine once per frame in VBlank for one or two fields, and fine
  on a score-change event. Do not convert inside a raster IRQ with a
  deadline, and do not convert per actor per frame.

**KickAssembler routine.** `num` holds the value and is destroyed; `dst`
is a zero-page pointer to the first of five cells. The demo below prints
65535 at the top left of the screen and returns to BASIC. This is the
exact text that measured 879 and 1,243 cycles above.

```asm
// print_u16.asm -- 16-bit binary to five screen codes, right-aligned,
// leading zeros as spaces, written straight to screen RAM.
BasicUpstart2(start)

.label dst   = $fb        // zero page pointer to the 5-cell field
.label num   = $fd        // 16-bit value, destroyed by the routine
.label digit = $02
.label lead  = $03

* = $0810
start:
    lda #<65535
    sta num
    lda #>65535
    sta num+1
    lda #<$0400           // top left of the default screen
    sta dst
    lda #>$0400
    sta dst+1
    jsr print_u16
    rts

// --- subtract-powers ------------------------------------------------------
// In: num (16-bit, destroyed), dst -> 5 cells. Out: value right-aligned,
// leading zeros as spaces. Uses digit, lead, A, X, Y.
print_u16:
    lda #$01
    sta lead
    ldy #$00
    ldx #$00
pu_loop:
    lda #$2f              // one below '0': the first pass always increments
    sta digit
    sec
pu_sub:
    inc digit
    lda num
    sbc pow_lo,x
    sta num
    lda num+1
    sbc pow_hi,x
    sta num+1
    bcs pu_sub            // still non-negative: subtract again
    lda num               // overshot by one power: add it back (C is clear)
    adc pow_lo,x
    sta num
    lda num+1
    adc pow_hi,x
    sta num+1
pu_done:
    lda digit
    cmp #$30
    bne pu_emit           // a real digit
    lda lead
    beq pu_zero           // a zero after a real digit
    lda #$20              // a leading zero: space
    sta (dst),y
    bne pu_next           // always
pu_zero:
    lda #$30
pu_emit:
    sta (dst),y
    lda #$00
    sta lead
pu_next:
    iny
    inx
    cpx #$04
    bne pu_loop
    lda num               // 0..9 remains
    ora #$30
    sta (dst),y
    rts

pow_lo: .byte <10000, <1000, <100, <10
pow_hi: .byte >10000, >1000, >100, >10
```

**KickAssembler double-dabble.** The same `num` and `dst`, plus three
zero-page bytes at `bcd` for the packed accumulator. The demo prints
65535 at the top left and returns to BASIC (run in VICE, rung 1). This
is the exact text that measured 875 cycles above, and the `db_loop`
whose page crossing moved the figure from 860.

```asm
// dab_u16.asm -- 16-bit binary to five screen codes by double-dabble in
// decimal mode, right-aligned, leading zeros as spaces, written straight
// to screen RAM. This is the text that measured 875 cycles.
BasicUpstart2(start)

.label dst   = $fb        // zero page pointer to the 5-cell field
.label num   = $fd        // 16-bit value, destroyed by the routine
.label lead  = $03
.label bcd   = $04        // 3 bytes packed BCD

* = $0810
start:
    lda #<65535
    sta num
    lda #>65535
    sta num+1
    lda #<$0400           // top left of the default screen
    sta dst
    lda #>$0400
    sta dst+1
    jsr dab_u16
    rts

// --- double-dabble with decimal mode -------------------------------------
// In: num (16-bit, destroyed), dst -> 5 cells. Doubles a 3-byte packed BCD
// accumulator in decimal mode 16 times, shifting one bit of num in each
// time, then unpacks with the same zero suppression.
dab_u16:
    lda #$00
    sta bcd
    sta bcd+1
    sta bcd+2
    ldx #$10
    sed
db_loop:
    asl num
    rol num+1             // C = next bit, MSB first
    lda bcd
    adc bcd
    sta bcd
    lda bcd+1
    adc bcd+1
    sta bcd+1
    lda bcd+2
    adc bcd+2
    sta bcd+2
    dex
    bne db_loop
    cld
    ldy #$00
    lda #$01
    sta lead
    lda bcd+2
    and #$0f
    jsr db_digit
    lda bcd+1
    lsr
    lsr
    lsr
    lsr
    jsr db_digit
    lda bcd+1
    and #$0f
    jsr db_digit
    lda bcd
    lsr
    lsr
    lsr
    lsr
    jsr db_digit
    lda bcd
    and #$0f
    ora #$30
    sta (dst),y
    rts
db_digit:                 // A = 0..9
    bne db_nz
    ldx lead
    beq db_nz             // zero after a real digit prints
    lda #$20
    sta (dst),y
    iny
    rts
db_nz:
    ora #$30
    sta (dst),y
    iny
    lda #$00
    sta lead
    rts
```

**Oscar64 routine.** `fmt_dec_sub` from `recipes/oscar64/print-number.md`,
which measured 957 and 1,361 cycles above. The recipe page carries the
whole program, the exhaustive check and the timer harness; this is the
routine on its own (not built by the gate on this page; it is the text
the recipe built).

```c
// Subtract-powers. Writes five screen codes to dst: the value right-aligned,
// leading zeros as spaces, so 0 becomes "    0" and 65535 fills the field.
__noinline void fmt_dec_sub(unsigned v, char *dst)
{
    static const unsigned pow10[4] = { 10000, 1000, 100, 10 };
    char lead = 1;
    for (char i = 0; i < 4; i++)
    {
        unsigned p = pow10[i];
        char d = 0x30;
        while (v >= p) { v -= p; d++; }
        if (d != 0x30 || !lead) { dst[i] = d; lead = 0; }
        else dst[i] = 0x20;
    }
    dst[4] = 0x30 + v;               // v is 0..9 here
}
```

Oscar64 -O2 keeps `v` in zero page and the digit count in a zero-page
temporary, and the inner loop is a compare-and-subtract of about 32
cycles per step (read from the compiler's `.asm` output, rung 1 for the
shape, rung 3 for the per-step figure). `__noinline` is documented in the
Oscar64 README; without it the compiler may inline the call at -O2.

---

## Cross-references

- `../techniques/sprite.md` — sprite multiplex mechanics, hardware sprite
  DMA, collision register details, sprite-background priority.
- `../techniques/scroll.md` — soft-scroll register usage, column copy
  timing, parallax layer technique.
- `./c64-game-archetypes.md` — which archetype (shmup, platformer,
  adventure, maze, racer) pairs with which patterns from this document,
  with recommended default pattern combinations per archetype.
