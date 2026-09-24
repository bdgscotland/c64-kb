---
category: logic
---

<!-- doc-type: pitfall-reference -->

# Logic Pitfalls

Pitfalls in the game logic a title runs on the 6510: the searches, distance maps and state tables that stand between the input and the screen. Each one passes on the level it was tested with and fails on the level that is a little larger, and each figure below was measured in VICE x64sc 3.10 with Oscar64 and KickAssembler 5.25 unless it says otherwise.

---

## bfs_distance_byte_wraps_past_254 — A one-byte distance map with 255 for "unreached" wraps on a path longer than 254 cells, and chasers past the wrap walk to a false zero

**Severity:** medium
**Region:** both
**Triggered by techniques:** bfs_distance_map

### Symptom

The maze is a little larger, or more winding, than the one the flood was tested on. Chasers near the player still home in. Chasers far from the player walk part of the way, then gather at one cell in the middle of the maze and stand there, while a chaser that started one cell nearer than that spot walks two cells away from the player and joins them. With the distance digits shown, the digits along the long corridor run up to 4 and then read 1, 0, 1, 2, 3 in the middle of open floor, as if a second player stood there. The map checks out against a Python model on the test maze and nothing in the flood changed.

### Mechanism

The flood stores a cell's distance in one byte and uses 255 both for a wall and for a cell not yet reached. A popped cell at distance 254 writes 255 into its neighbours. That is the true distance, and it is also the sentinel, so the cell is "reached" and "unreached" at once. The queue still carries it, so it is popped, and its distance plus one is now 256, which the byte holds as 0: its far neighbour is written 0 and pushed. When that neighbour is popped it writes 1 into every neighbour that reads 255, and the cell at true distance 255 still does, so it is overwritten with 1 and pushed a second time. From there the flood runs on as if from a fresh source at the cell of true distance 256: 1, 2, 3 and so on, all the way to the far end.

The chasers' rule, step to the strictly lowest neighbour, then fails in three ways depending on where a chaser stands. A chaser at 254 sees 253 on one side and 1 on the other, and takes the 1: two cells away from the player. A chaser anywhere past the wrap walks downhill toward the false zero, which happens to be toward the player, and stops on it with 1 on both sides. Nothing ever moves it again while the player stays put, because a fresh flood writes the same bytes. The flood itself terminates: the only cells that are written twice are those at true distance 255, and once overwritten they no longer read as the sentinel.

Measured on the recipe's program with its maze replaced by a serpentine corridor on the same 40 by 22 grid, 390 open cells, the far end 389 steps from the player, the player stationary at (1,1). The live map read from the running machine differs from a Python flood with unbounded integers in 135 of the 390 open cells, the first at (22,13), true distance 255, which reads 1. Along row 13, where the path runs left to right, the bytes at x = 18 to 30 are:

```text
true distance  251 252 253 254 255 256 257 258 259 260 261 262 263
byte in map     FB  FC  FD  FE  01  00  01  02  03  04  05  06  07
```

Four chasers stepped once every four frames on that map. Chaser 1 started at (21,13), true distance 254; at frame 20, after two steps, it stood at (23,13), true distance 256, byte 0, and it was still there at frame 600. Chaser 2 started at (30,15), true distance 281, byte 25; it stood at (32,15) at frame 20 and (37,15) at frame 40, both nearer the player, and at (23,13) at frame 600. Chaser 3 started at the far end, (1,19), true distance 388; it was at (23,13) at frame 600 too. Chaser 0, which started 29 cells from the player, reached the player's cell. The flood took 15 frames and ran once, as the recipe's HUD showed.

The recipe's own maze cannot show this: its longest path is 76 cells (the recipe's model), and both the unmodified flood and the saturating one below pass its verdict, `$02FF` = `01`, on that maze.

### Fix

Keep the sentinel out of the range the flood can write. The cheapest way is to saturate: when the popped cell's distance plus one would be 255, write 254 instead. Every cell more than 253 steps away then reads 254, which means "far, direction unknown", and 255 is a wall or an unreached cell and nothing else. A chaser on a 254 cell next to a 253 walks home; a chaser deeper in reads 254 on every side and stands still under the recipe's rule. A game can add a fallback for that case, such as a step toward the player's coordinates when its own cell reads 254 (not measured here; in a serpentine that step can walk into a dead end). If the far chasers have to home in, widen the distance to two bytes, with `$FFFF` as the sentinel: twice the map memory and a 16-bit compare per neighbour. A third choice is the technique page's window variation, which bounds the flood at a radius well under 255 and never meets the wrap. Whichever is chosen, put a corridor longer than 254 cells in the test set; the recipe's maze reaches 76.

Saturating build, same corridor, same four chasers: the bytes along row 13 read `FB FC FD FE FE FE FE FE FE FE FE FE FE` for true distances 251 to 263, so 254 stands from the 254th cell to the far end. Chaser 1, which had walked away, now walks home: (19,13) at frame 20, (14,13) at frame 40, (30,5) at frame 600, true distance 107. Chasers 2 and 3, in the 254 region, stayed on their start cells through frame 600. Chaser 0 reached the player.

Two-byte build: the live map matches the Python model in all 390 open cells, `00FF` at true 255 and `0100` at true 256, and all four chasers close in: chaser 3 from true distance 386 at frame 20 to 241 at frame 600, chaser 2 from 279 to 134, chaser 1 to 107, chaser 0 to the player's cell. The wider map costs 1,760 bytes per map instead of 880 and its clear takes two frames at 880 bytes each; the slice cost was not measured here.

### Worked example

The flood's write, in the form an assembler flood would use; `work` is the map being filled and `next_d` the value the four neighbours receive.

```asm
// BAD: a popped cell at 254 hands its neighbours 255, the sentinel;
// a popped cell at 255 hands them 0 and the flood restarts from there.
            lda work,y          // the popped cell's distance
            clc
            adc #1
            sta next_d

// GOOD: saturate at 254; 255 stays the mark for walls and unreached cells.
            lda work,y
            cmp #254
            bcs cap             // 254 already: keep 254
            adc #1              // carry is clear here
            jmp store
cap:        lda #254
store:      sta next_d
```

The recipe's C form is `char d = work[o] + 1;`; the saturating form is `if (d == UNSEEN) d = UNSEEN - 1;` on the next line, and the two-byte form declares the maps and `d` as `unsigned` with `UNSEEN` at `0xffff`. Measured on the serpentine, read from the running machine with the monitor's `m` command after the first flood completed (map row 13, x = 18 to 30; chaser cells are (x,y), stepping every fourth frame):

```text
true distance   251 252 253 254 255 256 257 258 259 260 261 262 263
one byte, +1     FB  FC  FD  FE  01  00  01  02  03  04  05  06  07
one byte, cap    FB  FC  FD  FE  FE  FE  FE  FE  FE  FE  FE  FE  FE
two bytes       0FB 0FC 0FD 0FE 0FF 100 101 102 103 104 105 106 107

chaser 1 from (21,13), true 254:
  +1    frame 20 (23,13) true 256   frame 600 (23,13) true 256
  cap   frame 20 (19,13) true 252   frame 600 (30,5)  true 107
  wide  frame 20 (19,13) true 252   frame 600 (30,5)  true 107
chaser 3 from (1,19), true 388:
  +1    frame 20 (3,19)  true 386   frame 600 (23,13) true 256
  cap   frame 20 (1,19)  true 388   frame 600 (1,19)  true 388
  wide  frame 20 (3,19)  true 386   frame 600 (8,13)  true 241
cells differing from the Python model: +1 135 of 390, cap 135 of 390 (all read 254), wide 0
recipe's own maze, longest path 76: $02FF = 01 with +1 and with cap
```

### Cross-references

- Technique `bfs_distance_map` (`docs/techniques/logic.md`): the one-byte map with 255 as the sentinel, and the window variation that bounds the flood at a radius.
- `docs/recipes/oscar64/bfs-distance-map.md`: the program these figures were measured on; its maze peaks at 76 and cannot show the wrap.
- Technique `ghost_target_tile_ai` (`docs/techniques/logic.md`): the coordinate-steering rule a chaser on a saturated cell can fall back to.
